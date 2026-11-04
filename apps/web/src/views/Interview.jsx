import { useCallback, useEffect, useRef, useState } from 'react';
import {
  startInterview,
  interviewTurn,
  interviewTurnStream,
  getInterviewState,
  submitApproach,
  submitDsaResult,
} from '../api.js';
import { useVoiceInterview } from '../voice/useVoiceInterview.js';
import { MicButton, MicNote, VoiceToggles } from '../voice/VoiceControls.jsx';
import { splitSentences, stripUnspeakable } from '../voice/speech.js';
import LockedEditor from '../runner/components/LockedEditor.jsx';
import TestRunner from '../runner/components/TestRunner.jsx';
import { firstVisibleFailure } from '../runner/harness.js';
import { prewarmCppToolchain } from '../runner/cpp.js';

const INTAKE_TOKEN_KEY = 'ai-interviewer-session';
const INTERVIEW_TOKEN_KEY = 'ai-interviewer-interview';

const ROUND_LABELS = {
  intro: 'Intro',
  resume: 'Resume',
  dsa: 'DSA coding',
  cs: 'CS fundamentals',
  behavioral: 'Behavioral',
  closing: 'Closing',
};
const ROUND_ORDER = ['intro', 'resume', 'dsa', 'cs', 'behavioral', 'closing'];
const LANGUAGES = ['javascript', 'python', 'cpp'];
const LANGUAGE_LABELS = { javascript: 'JavaScript', python: 'Python', cpp: 'C++' };

function starterFor(problem, language) {
  return problem?.starter?.[language] || '';
}

export default function Interview({ onBack }) {
  const [phase, setPhase] = useState('starting'); // starting | active | error
  const [error, setError] = useState('');
  const [sessionToken, setSessionToken] = useState(null);
  const [istate, setIstate] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  // DSA panel state
  const [approachText, setApproachText] = useState('');
  const [judging, setJudging] = useState(false);
  const [judgeNote, setJudgeNote] = useState('');
  const [language, setLanguage] = useState('javascript');
  const [code, setCode] = useState('');
  const codeByLang = useRef({});
  const switchLanguage = (l) => {
    // Preserve per-language work across switches.
    codeByLang.current[language] = code;
    setLanguage(l);
    const ap = istate?.activeProblem;
    setCode(codeByLang.current[l] ?? starterFor(ap, l));
    setLastResults(null);
  };
  const [lastResults, setLastResults] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const bottomRef = useRef(null);
  const warmedCpp = useRef(false);
  const activeSlugRef = useRef(null);
  const idRef = useRef(0);
  const nextId = () => `m-${(idRef.current += 1)}`;

  // Refs so the voice hook's stable callbacks always see fresh values.
  const sessionTokenRef = useRef(null);
  const sendingRef = useRef(false);
  const istateRef = useRef(null);
  const voiceRef = useRef(null);
  const sendStreamTextRef = useRef(null);
  sessionTokenRef.current = sessionToken;
  sendingRef.current = sending;
  istateRef.current = istate;

  // ---- voice (Milestone 9) ---------------------------------------------------
  // Voice is a transport layer over the M8 text engine: speech in → text →
  // the same turn loop → streamed text out → speech out. Every voice turn is
  // recorded in the server transcript as text (report-ready for M10).
  const voice = useVoiceInterview({
    onSendText: (t) => sendStreamTextRef.current && sendStreamTextRef.current(t),
    onReviewText: (t) => setInput(t), // "review transcript before sending"
    getVocabularyHint: () =>
      [istateRef.current?.role, istateRef.current?.company].filter(Boolean).join(' '),
  });
  voiceRef.current = voice;

  const applyState = useCallback((state) => {
    setIstate(state);
    setMessages(
      (state.transcript || [])
        .filter((t) => t.role !== 'system')
        .map((t, i) => ({ id: `t-${i}`, role: t.role, text: t.text })),
    );
    const ap = state.activeProblem;
    if (ap && ap.slug !== activeSlugRef.current) {
      // New (or first) problem: reset the editor to its starter template.
      activeSlugRef.current = ap.slug;
      codeByLang.current = {};
      setLanguage('javascript');
      setCode(starterFor(ap, 'javascript'));
      setLastResults(null);
      setApproachText('');
      setJudgeNote('');
    }
  }, []);

  // Boot: resume an existing interview or start a new one from the intake session.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const existing = localStorage.getItem(INTERVIEW_TOKEN_KEY);
      if (existing) {
        try {
          const { state } = await getInterviewState(existing);
          if (cancelled) return;
          setSessionToken(existing);
          applyState(state);
          setPhase('active');
          return;
        } catch {
          localStorage.removeItem(INTERVIEW_TOKEN_KEY);
        }
      }
      const intakeToken = localStorage.getItem(INTAKE_TOKEN_KEY);
      if (!intakeToken) {
        if (!cancelled) {
          setError('No intake session found. Please complete the intake flow first.');
          setPhase('error');
        }
        return;
      }
      try {
        const data = await startInterview(intakeToken);
        if (cancelled) return;
        localStorage.setItem(INTERVIEW_TOKEN_KEY, data.sessionToken);
        setSessionToken(data.sessionToken);
        applyState(data.state);
        setPhase('active');
      } catch (e) {
        if (!cancelled) {
          setError(e.message || 'Could not start the interview.');
          setPhase('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyState]);

  // Prewarm the C++ toolchain while the candidate works through earlier rounds
  // (spec §4.6: start loading while they explain their approach).
  useEffect(() => {
    if (istate && !warmedCpp.current && ['intro', 'resume'].includes(istate.currentRound)) {
      warmedCpp.current = true;
      try {
        prewarmCppToolchain();
      } catch {
        /* best effort */
      }
    }
  }, [istate]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  /**
   * Unified turn sender (Milestone 9): streams the interviewer reply via SSE,
   * displays it progressively, and speaks it sentence-by-sentence as it
   * arrives (spec §4.7). Falls back to the non-streaming endpoint when the
   * stream cannot be established at all.
   */
  const doSendStreamText = async (text) => {
    const trimmed = (text || '').trim();
    const token = sessionTokenRef.current;
    if (!trimmed || sendingRef.current || !token) return;
    setSending(true);
    const v = voiceRef.current;
    if (v) v.stopSpeaking(); // never talk over the candidate's new message
    const candId = nextId();
    const streamId = nextId();
    setMessages((m) => [...m, { id: candId, role: 'candidate', text: trimmed }]);
    setMessages((m) => [...m, { id: streamId, role: 'interviewer', text: '', streaming: true }]);

    let acc = '';
    let gotChunk = false;
    let ttsSentences = 0; // sentences already handed to the TTS queue
    const feedTts = (isFinal) => {
      const vv = voiceRef.current;
      if (!vv) return;
      const sentences = splitSentences(stripUnspeakable(acc));
      // Speak all complete sentences; the last one may still be growing
      // mid-stream, so hold it back until the stream finishes.
      const end = isFinal ? sentences.length : Math.max(sentences.length - 1, ttsSentences);
      for (let i = ttsSentences; i < end; i += 1) {
        if (vv.speakSentence(sentences[i])) ttsSentences += 1;
        else break; // muted mid-stream — stop feeding
      }
    };
    const finishWith = (items, state) => {
      setMessages((m) => [...m.filter((msg) => msg.id !== streamId), ...items]);
      if (state) {
        applyState(state);
        if (state.done) {
          localStorage.removeItem(INTERVIEW_TOKEN_KEY);
          sessionTokenRef.current = null;
          setSessionToken(null);
        }
      }
    };

    try {
      const done = await interviewTurnStream(token, trimmed, {
        onChunk: (delta) => {
          gotChunk = true;
          acc += delta;
          setMessages((m) =>
            m.map((msg) => (msg.id === streamId ? { ...msg, text: acc } : msg)),
          );
          feedTts(false);
        },
      });
      feedTts(true);
      if (done.openingMessage && v) v.speakText(done.openingMessage);
      const next = [{ id: nextId(), role: 'interviewer', text: done.message }];
      if (done.openingMessage) {
        next.push({ id: nextId(), role: 'interviewer', text: done.openingMessage });
      }
      finishWith(next, done.state);
    } catch (e) {
      if (!gotChunk) {
        // Connection-level failure (SSE blocked/unreachable): fall back to
        // the plain endpoint. No turn was recorded yet, so this is safe.
        try {
          const data = await interviewTurn(token, trimmed);
          if (v) v.speakText(data.message);
          const next = [{ id: nextId(), role: 'interviewer', text: data.message }];
          if (data.openingMessage) {
            next.push({ id: nextId(), role: 'interviewer', text: data.openingMessage });
          }
          finishWith(next, data.state);
        } catch (e2) {
          finishWith(
            [
              {
                id: nextId(),
                role: 'interviewer',
                text: `⚠️ ${e2.message || 'Something went wrong. Please try again.'}`,
              },
            ],
            null,
          );
        }
      } else {
        // Mid-stream failure: the candidate turn is already stored
        // server-side — do NOT auto-retry (that would duplicate it).
        finishWith(
          [
            {
              id: nextId(),
              role: 'interviewer',
              text: '⚠️ The reply was interrupted. Please send your message again.',
            },
          ],
          null,
        );
      }
    } finally {
      setSending(false);
      const vv = voiceRef.current;
      if (vv) vv.markSent();
    }
  };
  sendStreamTextRef.current = doSendStreamText;

  const send = () => {
    const t = input.trim();
    if (!t) return;
    setInput('');
    doSendStreamText(t);
  };

  const sendApproach = async () => {
    const text = approachText.trim();
    if (!text || judging || !sessionToken || !istate?.activeProblem) return;
    setJudging(true);
    setJudgeNote('');
    try {
      const data = await submitApproach(sessionToken, istate.activeProblem.slug, text);
      const lines = [];
      if (data.feedback) lines.push(data.feedback);
      if (data.hint) lines.push(`💡 Hint ${data.hintsUsed}/3: ${data.hint}`);
      if (data.accepted) lines.push('✅ Approach accepted — the editor is unlocked.');
      if (data.judgeError) lines.push('⚠️ The judge was unavailable; the editor was unlocked so you can continue.');
      setJudgeNote(lines.join('\n\n'));
      if (data.accepted) setApproachText('');
      const { state } = await getInterviewState(sessionToken);
      applyState(state);
    } catch (e) {
      setJudgeNote(`⚠️ ${e.message || 'Could not judge the approach.'}`);
    } finally {
      setJudging(false);
    }
  };

  const submitSolution = async () => {
    if (!lastResults || submitting || !sessionToken || !istate?.activeProblem) return;
    setSubmitting(true);
    try {
      const failure = firstVisibleFailure(lastResults.results || [], istate.activeProblem);
      const data = await submitDsaResult(
        sessionToken,
        istate.activeProblem.slug,
        language,
        code,
        { ...lastResults, firstFailure },
      );
      if (data.message) {
        setMessages((m) => [...m, { role: 'interviewer', text: data.message, id: nextId() }]);
      }
      if (data.state) applyState(data.state);
      setLastResults(null);
      setCode('');
    } catch (e) {
      setJudgeNote(`⚠️ ${e.message || 'Could not submit the solution.'}`);
    } finally {
      setSubmitting(false);
    }
  };

  if (phase === 'starting') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <p className="text-slate-600" role="status">
          <span className="inline-block animate-pulse">⏳ Preparing your interview…</span>
          <span className="block text-xs text-slate-400 mt-2">Researching the company and planning your rounds.</span>
        </p>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="font-semibold text-slate-900">Couldn't start the interview</p>
          <p className="mt-2 text-sm text-slate-600">{error}</p>
          <button onClick={onBack} className="mt-4 rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
            ← Back
          </button>
        </div>
      </div>
    );
  }

  const roundIdx = ROUND_ORDER.indexOf(istate?.currentRound);
  const dsaInfo = istate?.activeProblem ? istate.dsa?.[istate.activeProblem.slug] : null;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <button onClick={onBack} className="text-sm font-medium text-indigo-600 hover:text-indigo-800">
            ← Back to landing
          </button>
          <h1 className="text-sm font-bold">🎙️ Mock interview</h1>
          <span className="text-xs text-slate-400">
            {istate?.company ? `${istate.company} · ` : ''}{istate?.role || ''}
          </span>
        </div>
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 pb-2">
          <VoiceToggles voice={voice} />
          <span className="text-xs text-slate-400">
            {voice.sttMode === 'browser' ? '🎙️ browser transcription' : voice.sttMode === 'server' ? '🎙️ server transcription' : ''}
          </span>
        </div>
        <div className="mx-auto flex max-w-4xl gap-1 overflow-x-auto px-4 pb-3">
          {ROUND_ORDER.map((r, i) => (
            <div
              key={r}
              className={`flex-1 whitespace-nowrap rounded-lg px-2 py-1 text-center text-xs font-medium ${
                i < roundIdx
                  ? 'bg-emerald-100 text-emerald-800'
                  : i === roundIdx
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-100 text-slate-400'
              }`}
            >
              {i < roundIdx ? '✓ ' : ''}{ROUND_LABELS[r]}
            </div>
          ))}
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 pb-40 pt-6">
        {voice.prefs.transcriptVisible ? (
          <div className="space-y-4">
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.role === 'candidate' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm ${
                    m.role === 'candidate'
                      ? 'bg-indigo-600 text-white'
                      : 'border border-slate-200 bg-white text-slate-800'
                  }`}
                >
                  {m.text}
                  {m.streaming && <span className="animate-pulse" aria-hidden="true">▍</span>}
                </div>
                {m.role === 'interviewer' && !voice.prefs.audioOn && m.text && !m.streaming && (
                  <button
                    onClick={() => voice.speakText(m.text, { force: true })}
                    title="Replay this message aloud"
                    aria-label="Replay message aloud"
                    className="ml-1 self-end rounded-lg px-1.5 py-1 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  >
                    🔊
                  </button>
                )}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
            <p className="text-sm font-medium text-slate-500">👁‍🗨 Transcript hidden</p>
            <p className="mt-1 text-xs text-slate-400">
              Hiding is display-only — every turn is still recorded for your interview report.
            </p>
          </div>
        )}

        {istate?.done ? (
          <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center">
            <p className="text-lg font-bold text-emerald-900">🎉 Interview complete</p>
            <p className="mt-1 text-sm text-emerald-700">
              Your full transcript and per-round results are saved. The detailed report arrives in Milestone 10.
            </p>
          </div>
        ) : (
          istate?.currentRound === 'dsa' &&
          istate.activeProblem && (
            <DsaPanel
              problem={istate.activeProblem}
              dsaInfo={dsaInfo}
              approachText={approachText}
              setApproachText={setApproachText}
              judging={judging}
              judgeNote={judgeNote}
              sendApproach={sendApproach}
              language={language}
              setLanguage={(l) => switchLanguage(l)}
              code={code}
              setCode={setCode}
              setLastResults={setLastResults}
              lastResults={lastResults}
              submitting={submitting}
              submitSolution={submitSolution}
            />
          )
        )}
      </main>

      {!istate?.done && (
        <footer className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 backdrop-blur">
          <MicNote voice={voice} onDismiss={voice.dismissNote} />
          <div className="mx-auto flex max-w-4xl items-center gap-2 px-4 py-3">
            <MicButton voice={voice} disabled={sending} />
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={
                istate?.currentRound === 'dsa'
                  ? 'Chat with the interviewer… (use the coding panel above for code)'
                  : 'Type your answer…'
              }
              className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:border-indigo-500 focus:outline-none"
              disabled={sending}
              aria-label="Your answer"
            />
            <button
              onClick={send}
              disabled={sending || !input.trim()}
              className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {sending ? '…' : 'Send'}
            </button>
          </div>
        </footer>
      )}
    </div>
  );
}

function DsaPanel(props) {
  const {
    problem, dsaInfo, approachText, setApproachText, judging, judgeNote, sendApproach,
    language, setLanguage, code, setCode, setLastResults, lastResults, submitting, submitSolution,
  } = props;
  const unlocked = !!dsaInfo?.unlocked;

  return (
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-label="Coding round">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold">💻 {problem.title}</h2>
        <span className="text-xs text-slate-400">
          {dsaInfo?.hintsUsed ? `Hints used: ${dsaInfo.hintsUsed}/3` : ''}
          {dsaInfo?.score != null ? ` · Score: ${dsaInfo.score}` : ''}
        </span>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{problem.statement}</p>
      {problem.examples?.length > 0 && (
        <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
          {problem.examples.slice(0, 2).map((e, i) => (
            <p key={i} className="font-mono">Input: {e.input} → Output: {e.output}</p>
          ))}
        </div>
      )}

      {!unlocked ? (
        <div className="mt-4">
          <label className="text-sm font-semibold" htmlFor="approach">
            Explain your approach to unlock the editor
          </label>
          <textarea
            id="approach"
            value={approachText}
            onChange={(e) => setApproachText(e.target.value)}
            rows={4}
            placeholder="e.g. I'll use a hash map to remember complements as I scan once — O(n) time, O(n) space…"
            className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            disabled={judging}
          />
          <button
            onClick={sendApproach}
            disabled={judging || !approachText.trim()}
            className="mt-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {judging ? 'Judging…' : 'Submit approach'}
          </button>
          {judgeNote && (
            <p className="mt-2 whitespace-pre-wrap rounded-xl bg-indigo-50 p-3 text-sm text-indigo-900">{judgeNote}</p>
          )}
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-600">Language:</span>
            {LANGUAGES.map((l) => (
              <button
                key={l}
                onClick={() => setLanguage(l)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                  language === l ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {LANGUAGE_LABELS[l]}
              </button>
            ))}
            {language === 'cpp' && (
              <span className="text-xs text-slate-400">C++ loads a ~24 MB toolchain on first run — cached afterwards.</span>
            )}
          </div>
          <LockedEditor
            language={language}
            value={code}
            onChange={setCode}
            locked={false}
            demoToggle={false}
          />
          <TestRunner
            problem={problem}
            code={code}
            language={language}
            onResults={setLastResults}
          />
          <button
            onClick={submitSolution}
            disabled={!lastResults || submitting}
            title={!lastResults ? 'Run the tests first, then submit' : 'Submit your solution to the interviewer'}
            className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
            {submitting ? 'Submitting…' : '✓ Submit solution'}
          </button>
        </div>
      )}
    </section>
  );
}
