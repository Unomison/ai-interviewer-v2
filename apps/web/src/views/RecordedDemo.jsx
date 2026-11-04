import { useEffect, useState } from 'react';
import { fetchRecordedDemo } from '../api.js';
import Report from './Report.jsx';

/**
 * Milestone 10 — recorded demo page (spec §6).
 *
 * Shown when LLM quota is exhausted: a curated, fully pre-computed mock
 * interview (transcript + report). Zero LLM calls — the data is static.
 */
export default function RecordedDemo({ onBack }) {
  const [state, setState] = useState('loading');
  const [demo, setDemo] = useState(null);
  const [showTranscript, setShowTranscript] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchRecordedDemo()
      .then((data) => { if (!cancelled) { setDemo(data); setState('ready'); } })
      .catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, []);

  if (state === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <p className="animate-pulse text-slate-500">🎬 Loading the recorded demo…</p>
      </div>
    );
  }

  if (state === 'error' || !demo) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="max-w-md rounded-2xl border bg-white p-8 text-center shadow-sm">
          <p className="text-lg font-bold">Demo unavailable</p>
          <p className="mt-2 text-sm text-slate-600">The recorded demo could not be loaded. Please try again later.</p>
          {onBack && (
            <button onClick={onBack} className="mt-4 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white">
              ← Back
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-4xl px-4 pt-6">
        {onBack && (
          <button onClick={onBack} className="text-sm font-medium text-indigo-600 hover:text-indigo-800">← Back</button>
        )}
        <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">🎬 Recorded demo</p>
          <p className="mt-1 text-sm text-amber-800">
            {demo.meta.scenario}
          </p>
          <button
            onClick={() => setShowTranscript((v) => !v)}
            className="mt-2 text-sm font-medium text-amber-900 underline"
          >
            {showTranscript ? 'Hide' : 'Show'} the demo transcript
          </button>
        </div>
        {showTranscript && (
          <div className="mt-4 max-h-96 space-y-3 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4">
            {(demo.transcript || []).map((t, i) => (
              <div key={i} className={`flex ${t.role === 'candidate' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${
                    t.role === 'candidate' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-800'
                  }`}
                >
                  <p className="mb-0.5 text-[10px] uppercase tracking-wide opacity-70">
                    {t.role} · {t.round}
                  </p>
                  <p>{t.text}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <Report initialReport={{ ...demo.report, shareToken: null }} onBack={null} />
    </div>
  );
}
