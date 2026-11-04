/**
 * Milestone 9 — voice UI (spec §4.7).
 *
 * MicButton: tap = start recording; tap again = stop, transcribe and send.
 * Recording NEVER starts by itself — the only onClick path is the user's tap.
 * VoiceToggles: header toggles (audio on/off, transcript show/hide, mic
 * on/off, review-before-send), each usable at any time, persisted.
 */
import { MIC_RECORDING, MIC_TRANSCRIBING, MIC_SENDING, MIC_REQUESTING } from './micMachine.js';

function formatElapsed(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Footer mic cluster. Props:
 *   voice    — the useVoiceInterview() return
 *   disabled — true while a turn is being sent
 */
export function MicButton({ voice, disabled }) {
  const { mic, elapsedMs, level, sttMode, prefs, toggleMic, cancelRecording } = voice;
  if (!prefs.micEnabled) return null;

  const busy = [MIC_REQUESTING, MIC_TRANSCRIBING, MIC_SENDING].includes(mic.status);
  const recording = mic.status === MIC_RECORDING;
  const unusable = sttMode === 'unavailable';

  return (
    <div className="flex items-center gap-2">
      {recording && (
        <button
          onClick={cancelRecording}
          title="Cancel recording (discard without sending)"
          aria-label="Cancel recording"
          className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-500 hover:bg-slate-100"
        >
          ✕
        </button>
      )}
      <button
        onClick={toggleMic}
        disabled={disabled || busy || unusable}
        title={
          unusable
            ? 'Voice input is unavailable in this browser — please type instead'
            : recording
              ? 'Tap to stop, transcribe and send'
              : 'Tap to answer by voice'
        }
        aria-label={recording ? 'Stop recording and send' : 'Start voice recording'}
        aria-pressed={recording}
        className={`relative rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 ${
          recording ? 'bg-red-600 hover:bg-red-700' : 'bg-slate-700 hover:bg-slate-800'
        }`}
      >
        {recording && (
          <span className="absolute -left-1 -top-1 flex h-3 w-3" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
          </span>
        )}
        {busy ? '…' : recording ? '⏺️ Stop' : '🎙️ Mic'}
      </button>
      {recording && (
        <div className="flex items-center gap-2" aria-live="polite">
          <span className="font-mono text-sm text-slate-600">{formatElapsed(elapsedMs)}</span>
          <div
            className="h-2 w-16 overflow-hidden rounded-full bg-slate-200"
            role="meter"
            aria-label="Microphone level"
            aria-valuenow={Math.round(level * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full rounded-full bg-emerald-500 transition-[width]"
              style={{ width: `${Math.round(level * 100)}%` }}
            />
          </div>
          <span className="max-w-[140px] truncate text-xs text-slate-400">tap mic again to send</span>
        </div>
      )}
      {mic.status === MIC_TRANSCRIBING && <span className="text-xs text-slate-500">Transcribing…</span>}
      {mic.status === MIC_SENDING && <span className="text-xs text-slate-500">Sending…</span>}
      {sttMode === 'browser' && !recording && !busy && (
        <span className="hidden text-xs text-slate-400 sm:inline" title="Server transcription is unavailable; using the browser's built-in speech recognition.">
          using browser transcription
        </span>
      )}
    </div>
  );
}

/** Note line under the composer (permission hints, "didn't catch that", …). */
export function MicNote({ voice, onDismiss }) {
  const { mic } = voice;
  if (!mic.note) return null;
  const isError = ['denied', 'error'].includes(mic.status);
  return (
    <div
      className={`mx-auto flex max-w-4xl items-center justify-between gap-2 px-4 py-1.5 text-xs ${
        isError ? 'text-red-600' : 'text-slate-500'
      }`}
      role={isError ? 'alert' : 'status'}
    >
      <span>{mic.note}</span>
      {isError && (
        <button onClick={onDismiss || (() => {})} className="underline hover:no-underline">
          Dismiss
        </button>
      )}
    </div>
  );
}

/**
 * Header toggles (spec §4.7): usable at any time mid-interview, persisted.
 * Transcript hiding is UI-only — the transcript is always stored server-side.
 */
export function VoiceToggles({ voice }) {
  const { prefs, setPrefs } = voice;
  const btn = (active) =>
    `rounded-lg px-2.5 py-1.5 text-xs font-medium ${
      active ? 'bg-indigo-100 text-indigo-800' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
    }`;
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label="Voice settings">
      <button
        onClick={() => setPrefs({ audioOn: !prefs.audioOn })}
        className={btn(prefs.audioOn)}
        title={prefs.audioOn ? 'Mute the interviewer voice' : 'Unmute the interviewer voice'}
        aria-pressed={prefs.audioOn}
      >
        {prefs.audioOn ? '🔊 Audio' : '🔇 Muted'}
      </button>
      <button
        onClick={() => setPrefs({ transcriptVisible: !prefs.transcriptVisible })}
        className={btn(prefs.transcriptVisible)}
        title={prefs.transcriptVisible ? 'Hide the transcript (still recorded)' : 'Show the transcript'}
        aria-pressed={prefs.transcriptVisible}
      >
        {prefs.transcriptVisible ? '👁 Transcript' : '👁‍🗨 Hidden'}
      </button>
      <button
        onClick={() => setPrefs({ micEnabled: !prefs.micEnabled })}
        className={btn(prefs.micEnabled)}
        title={prefs.micEnabled ? 'Disable voice input' : 'Enable voice input'}
        aria-pressed={prefs.micEnabled}
      >
        {prefs.micEnabled ? '🎙️ Mic on' : '🎙️ Mic off'}
      </button>
      <button
        onClick={() => setPrefs({ reviewBeforeSend: !prefs.reviewBeforeSend })}
        className={btn(prefs.reviewBeforeSend)}
        title="Review the transcription in the text box before sending (default off)"
        aria-pressed={prefs.reviewBeforeSend}
      >
        {prefs.reviewBeforeSend ? '📝 Review on' : '📝 Review off'}
      </button>
    </div>
  );
}
