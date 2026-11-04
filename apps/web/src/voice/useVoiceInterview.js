/**
 * Milestone 9 — voice interview hook (spec §4.7).
 *
 * Owns the mic state machine, audio capture (MediaRecorder → Groq Whisper,
 * with a Web Speech API live-capture fallback), the TTS sentence queue, and
 * the persisted voice preferences. Turn submission stays in Interview.jsx —
 * this hook only delivers transcript text via onSendText / onReviewText.
 *
 * Privacy rule (non-negotiable): recording starts ONLY on an explicit mic
 * tap. No effect in this hook ever calls startCapture on its own.
 */
import { useCallback, useEffect, useRef, useReducer, useState } from 'react';
import { transcribeAudio, voiceStatus } from '../api.js';
import { SpeechQueue } from './speech.js';
import { micReducer, initialMicState, MIC_RECORDING } from './micMachine.js';

const PREFS_KEY = 'ai-interviewer-voice-prefs';
const MIN_RECORD_MS = 500; // spec §4.7: min length 0.5 s
const MAX_RECORD_MS = 3 * 60 * 1000; // spec §4.7: max 3 minutes

const DEFAULT_PREFS = {
  audioOn: true, // interviewer voice
  transcriptVisible: true,
  micEnabled: true,
  reviewBeforeSend: false, // spec §4.7 optional setting, default off
};

function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    /* corrupted prefs — fall back to defaults */
  }
  return { ...DEFAULT_PREFS };
}

function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return '';
}

/** Prefer a natural English voice; never break when none is available. */
function pickEnglishVoice() {
  try {
    const synth = window.speechSynthesis;
    const voices = (synth && typeof synth.getVoices === 'function' && synth.getVoices()) || [];
    const en = voices.filter((v) => /^en([-_]|$)/i.test(v.lang || ''));
    if (en.length === 0) return null;
    const scored = en.map((v) => {
      const n = (v.name || '').toLowerCase();
      let s = 0;
      if (/natural|neural/.test(n)) s += 3;
      if (/google us english/.test(n)) s += 2;
      if (/samantha|zira|david|aria|jenny/.test(n)) s += 1;
      if (v.default) s += 1;
      return [s, v];
    });
    scored.sort((a, b) => b[0] - a[0]);
    return scored[0][1];
  } catch {
    return null;
  }
}

function readLevel(analyser) {
  if (!analyser) return 0;
  try {
    const arr = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(arr);
    let sum = 0;
    for (let i = 0; i < arr.length; i += 1) {
      const v = (arr[i] - 128) / 128;
      sum += v * v;
    }
    return Math.min(1, Math.sqrt(sum / arr.length) * 3);
  } catch {
    return 0;
  }
}

export function useVoiceInterview({ onSendText, onReviewText, getVocabularyHint } = {}) {
  const [mic, dispatch] = useReducer(micReducer, initialMicState);
  const [prefs, setPrefsState] = useState(loadPrefs);
  const [sttMode, setSttMode] = useState('server'); // 'server' | 'browser' | 'unavailable'
  const [elapsedMs, setElapsedMs] = useState(0);
  const [level, setLevel] = useState(0);

  const micRef = useRef(mic);
  micRef.current = mic;
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const startedAtRef = useRef(0);
  const mediaRef = useRef(null);
  const wsRef = useRef(null); // web-speech capture session
  const stoppedByTapRef = useRef(false);
  const timersRef = useRef({ max: 0, tick: 0 });
  const queueRef = useRef(null);

  const setPrefs = useCallback((patch) => {
    setPrefsState((p) => {
      const next = { ...p, ...patch };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        /* private mode — prefs just won't persist */
      }
      return next;
    });
  }, []);

  // ---- TTS ---------------------------------------------------------------
  const getQueue = useCallback(() => {
    if (!queueRef.current) {
      const synth =
        typeof window !== 'undefined' && window.speechSynthesis ? window.speechSynthesis : null;
      queueRef.current = new SpeechQueue({
        synth,
        createUtterance:
          typeof window !== 'undefined' && typeof window.SpeechSynthesisUtterance !== 'undefined'
            ? (text) => {
                const u = new window.SpeechSynthesisUtterance(text);
                u.lang = 'en-US';
                u.rate = 1;
                return u;
              }
            : undefined,
        pickVoice: pickEnglishVoice,
      });
      // Warm the voice list (Chrome loads voices asynchronously).
      try {
        if (synth && typeof synth.getVoices === 'function') {
          synth.getVoices();
          synth.onvoiceschanged = () => {
            try {
              synth.getVoices();
            } catch {
              /* ignore */
            }
          };
        }
      } catch {
        /* ignore */
      }
    }
    return queueRef.current;
  }, []);

  const stopSpeaking = useCallback(() => {
    try {
      getQueue().stop();
    } catch {
      /* never break the interview on TTS teardown */
    }
  }, [getQueue]);

  /** Queue speakable sentences; returns the number queued (0 when muted/off). */
  const speakText = useCallback(
    (text, opts = {}) => {
      if (!opts.force && !prefsRef.current.audioOn) return 0;
      if (!text) return 0;
      try {
        return getQueue().enqueueText(text);
      } catch {
        return 0;
      }
    },
    [getQueue],
  );

  /** Queue ONE pre-split sentence (progressive streaming path). */
  const speakSentence = useCallback(
    (sentence, opts = {}) => {
      if (!opts.force && !prefsRef.current.audioOn) return false;
      try {
        return getQueue().enqueueSentence(sentence);
      } catch {
        return false;
      }
    },
    [getQueue],
  );

  // Muting the interviewer stops any speech in flight (spec §4.7).
  useEffect(() => {
    if (!prefs.audioOn) stopSpeaking();
    else getQueue().setMuted(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.audioOn]);

  // ---- STT path detection --------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await voiceStatus();
        if (cancelled) return;
        setSttMode(status.stt === 'groq-whisper' ? 'server' : 'browser');
      } catch {
        if (!cancelled) setSttMode('browser'); // status unreachable → assume fallback
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (sttMode !== 'browser') return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) setSttMode('unavailable');
  }, [sttMode]);

  // ---- capture teardown ----------------------------------------------------
  const clearTimers = useCallback(() => {
    clearTimeout(timersRef.current.max);
    clearInterval(timersRef.current.tick);
    timersRef.current = { max: 0, tick: 0 };
  }, []);

  const teardownMedia = useCallback(() => {
    const m = mediaRef.current;
    mediaRef.current = null;
    if (!m) return;
    try {
      cancelAnimationFrame(m.raf);
    } catch {
      /* ignore */
    }
    try {
      m.ctx && m.ctx.close();
    } catch {
      /* ignore */
    }
    try {
      m.stream.getTracks().forEach((t) => t.stop());
    } catch {
      /* ignore */
    }
    setLevel(0);
  }, []);

  const teardownWebSpeech = useCallback(() => {
    const w = wsRef.current;
    wsRef.current = null;
    if (!w) return '';
    const text = (w.getText() || '').trim();
    try {
      w.rec.onend = null;
      w.rec.onerror = null;
      w.rec.onresult = null;
      w.rec.stop();
    } catch {
      /* already stopped */
    }
    return text;
  }, []);

  // ---- delivery ------------------------------------------------------------
  const deliverText = useCallback(
    (text) => {
      const t = (text || '').trim();
      if (!t) {
        dispatch({ type: 'EMPTY_TRANSCRIPT' });
        return;
      }
      dispatch({ type: 'TRANSCRIBED' });
      if (prefsRef.current.reviewBeforeSend) {
        try {
          onReviewText && onReviewText(t);
        } catch {
          /* fall through to idle */
        }
        dispatch({ type: 'SENT' });
      } else {
        try {
          onSendText && onSendText(t);
        } catch {
          dispatch({ type: 'FAIL', note: 'Could not send your answer. Please type it instead.' });
        }
        // Interview.jsx calls markSent() when the turn finishes.
      }
    },
    [onSendText, onReviewText],
  );

  /** Interview.jsx calls this when the turn round-trips (success or fail). */
  const markSent = useCallback(() => {
    if (micRef.current.status === 'sending') dispatch({ type: 'SENT' });
  }, []);

  /** Dismiss the mic note (permission denied / error banners). */
  const dismissNote = useCallback(() => {
    dispatch({ type: 'DISMISS' });
  }, []);

  const transcribeAndDeliver = useCallback(
    async (blob) => {
      try {
        const hint = typeof getVocabularyHint === 'function' ? getVocabularyHint() || '' : '';
        const data = await transcribeAudio(blob, hint);
        if (!data || !data.text || !data.text.trim()) {
          dispatch({ type: 'EMPTY_TRANSCRIPT' });
          return;
        }
        deliverText(data.text);
      } catch (e) {
        if (e && (e.status === 503 || e.status === 502)) {
          // Server STT down/misconfigured → switch this client to the
          // browser fallback and say so honestly (spec §4.7).
          setSttMode('browser');
          dispatch({
            type: 'FAIL',
            note: 'Server transcription is unavailable — switched to browser transcription. Tap the mic to try again.',
          });
        } else {
          dispatch({ type: 'FAIL', note: (e && e.message) || 'Transcription failed.' });
        }
      }
    },
    [deliverText, getVocabularyHint],
  );

  // ---- MediaRecorder path ---------------------------------------------------
  // (stopMediaCapture is defined below startMediaCapture; both are only
  // *called* after render, so the reference is safe.)
  const stopMediaCapture = useCallback(
    async (send) => {
      const m = mediaRef.current;
      clearTimers();
      if (!m) {
        dispatch({ type: 'CANCEL' });
        return;
      }
      const elapsed = Date.now() - startedAtRef.current;
      const blob = await new Promise((resolve) => {
        const rec = m.rec;
        const finish = () => {
          teardownMedia();
          resolve(new Blob(m.chunks, { type: rec.mimeType || 'audio/webm' }));
        };
        try {
          rec.onstop = finish;
          rec.stop();
        } catch {
          finish();
        }
      });
      if (!send) {
        dispatch({ type: 'CANCEL' });
        return;
      }
      if (elapsed < MIN_RECORD_MS) {
        dispatch({ type: 'TOO_SHORT' });
        return;
      }
      dispatch({ type: 'STOP_TRANSCRIBE' });
      await transcribeAndDeliver(blob);
    },
    [clearTimers, teardownMedia, transcribeAndDeliver],
  );

  const startMediaCapture = useCallback(async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      dispatch({ type: 'NO_MIC_SUPPORT' });
      return;
    }
    dispatch({ type: 'START_REQUEST' });
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch (err) {
      if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
        dispatch({ type: 'PERMISSION_DENIED' });
      } else {
        dispatch({ type: 'NO_MIC_SUPPORT' });
      }
      return;
    }
    let analyser = null;
    let ctx = null;
    let raf = 0;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) {
        ctx = new Ctx();
        const src = ctx.createMediaStreamSource(stream);
        analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        src.connect(analyser);
      }
    } catch {
      /* level meter is best-effort */
    }
    const mimeType = pickMimeType();
    let rec;
    try {
      rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      dispatch({ type: 'NO_MIC_SUPPORT' });
      return;
    }
    const chunks = [];
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    mediaRef.current = { stream, rec, chunks, analyser, ctx, raf: 0 };
    try {
      rec.start(250);
    } catch {
      teardownMedia();
      dispatch({ type: 'NO_MIC_SUPPORT' });
      return;
    }
    startedAtRef.current = Date.now();
    dispatch({ type: 'START_RECORDING', at: startedAtRef.current });

    const loop = () => {
      setLevel(readLevel(mediaRef.current && mediaRef.current.analyser));
      if (mediaRef.current) mediaRef.current.raf = requestAnimationFrame(loop);
    };
    loop();
    timersRef.current.tick = setInterval(() => {
      setElapsedMs(Date.now() - startedAtRef.current);
    }, 200);
    timersRef.current.max = setTimeout(() => {
      // Spec §4.7: max 3 minutes — auto-stop and send.
      stopMediaCapture(true);
    }, MAX_RECORD_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teardownMedia, stopMediaCapture]);

  const stopWebSpeechCapture = useCallback(
    (send) => {
      stoppedByTapRef.current = !!send;
      const text = teardownWebSpeech();
      clearTimers();
      setLevel(0);
      if (!send) {
        dispatch({ type: 'CANCEL' });
        return;
      }
      const elapsed = Date.now() - startedAtRef.current;
      if (elapsed < MIN_RECORD_MS) {
        dispatch({ type: 'TOO_SHORT' });
        return;
      }
      dispatch({ type: 'STOP_TRANSCRIBE' });
      deliverText(text);
    },
    [clearTimers, teardownWebSpeech, deliverText],
  );

  // ---- Web Speech path (browser fallback — live mic capture) -----------------
  const startWebSpeechCapture = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      dispatch({ type: 'NO_MIC_SUPPORT' });
      return;
    }
    dispatch({ type: 'START_REQUEST' });
    const rec = new SR();
    rec.lang = 'en-US';
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    let finalText = '';
    stoppedByTapRef.current = false;
    rec.onresult = (e) => {
      let interim = '';
      for (const r of e.results) {
        const t = r[0] ? r[0].transcript : '';
        if (r.isFinal) finalText += t;
        else interim += t;
      }
      setLevel(interim ? 0.5 : 0.1); // fake liveness pulse; no analyser here
    };
    rec.onerror = (e) => {
      if (e && (e.error === 'not-allowed' || e.error === 'service-not-allowed')) {
        dispatch({ type: 'PERMISSION_DENIED' });
      } else if (!stoppedByTapRef.current) {
        dispatch({ type: 'FAIL', note: 'Browser transcription failed. Please type your answer instead.' });
      }
      wsRef.current = null;
      clearTimers();
    };
    rec.onend = () => {
      // Fires on manual stop AND on auto-stop (pauses). Only deliver on tap.
      if (!stoppedByTapRef.current) return;
      stoppedByTapRef.current = false;
      wsRef.current = null;
      clearTimers();
      setLevel(0);
      const elapsed = Date.now() - startedAtRef.current;
      if (elapsed < MIN_RECORD_MS) {
        dispatch({ type: 'TOO_SHORT' });
        return;
      }
      dispatch({ type: 'STOP_TRANSCRIBE' });
      deliverText(finalText);
    };
    wsRef.current = { rec, getText: () => finalText };
    try {
      rec.start();
    } catch {
      wsRef.current = null;
      dispatch({ type: 'NO_MIC_SUPPORT' });
      return;
    }
    startedAtRef.current = Date.now();
    dispatch({ type: 'START_RECORDING', at: startedAtRef.current });
    timersRef.current.tick = setInterval(() => {
      setElapsedMs(Date.now() - startedAtRef.current);
    }, 200);
    timersRef.current.max = setTimeout(() => {
      stopWebSpeechCapture(true);
    }, MAX_RECORD_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearTimers, deliverText]);

  // ---- public controls -------------------------------------------------------
  const sttModeRef = useRef(sttMode);
  sttModeRef.current = sttMode;

  const startCapture = useCallback(() => {
    if (!prefsRef.current.micEnabled) return;
    if (sttModeRef.current === 'browser') startWebSpeechCapture();
    else if (sttModeRef.current === 'server') startMediaCapture();
    // 'unavailable': mic button is disabled by the UI; nothing to do.
  }, [startMediaCapture, startWebSpeechCapture]);

  /**
   * The mic tap. Spec §4.7: tap = start recording; tap again = stop,
   * transcribe and send. Tapping while the interviewer speaks stops TTS first.
   */
  const toggleMic = useCallback(async () => {
    stopSpeaking(); // never talk over the candidate
    const status = micRef.current.status;
    if (status === MIC_IDLE || status === 'error' || status === 'denied') {
      if (status !== MIC_IDLE) dispatch({ type: 'DISMISS' });
      await startCapture();
    } else if (status === MIC_RECORDING) {
      if (sttModeRef.current === 'browser') stopWebSpeechCapture(true);
      else await stopMediaCapture(true);
    }
    // requesting/transcribing/sending: taps are ignored (no double-submit).
  }, [startCapture, stopMediaCapture, stopWebSpeechCapture, stopSpeaking]);

  const cancelRecording = useCallback(() => {
    if (sttModeRef.current === 'browser') stopWebSpeechCapture(false);
    else stopMediaCapture(false);
  }, [stopMediaCapture, stopWebSpeechCapture]);

  // Unmount safety: never leave a stream or recorder running.
  useEffect(
    () => () => {
      clearTimers();
      teardownMedia();
      try {
        wsRef.current && wsRef.current.rec && wsRef.current.rec.abort && wsRef.current.rec.abort();
      } catch {
        /* ignore */
      }
      try {
        queueRef.current && queueRef.current.stop();
      } catch {
        /* ignore */
      }
    },
    [clearTimers, teardownMedia],
  );

  return {
    mic,
    elapsedMs,
    level,
    sttMode, // 'server' | 'browser' | 'unavailable'
    prefs,
    setPrefs,
    toggleMic,
    cancelRecording,
    markSent,
    dismissNote,
    speakText,
    speakSentence,
    stopSpeaking,
    isSpeaking: () => {
      try {
        return !!(queueRef.current && queueRef.current.speaking);
      } catch {
        return false;
      }
    },
  };
}
