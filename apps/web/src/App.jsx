import { useEffect, useState } from 'react';
import { pingHealth, apiBase } from './api.js';
import SampleReport from './views/SampleReport.jsx';
import IntakeFlow from './views/IntakeFlow.jsx';
import Playground from './runner/components/Playground.jsx';

/**
 * Milestone 1 landing skeleton + Milestone 3 intake entry points
 * + Milestone 4 code playground.
 *
 * - Pings GET /api/health on first load (spec Section 6): while the free
 *   backend is still waking or unreachable we show a clear
 *   "waking the interviewer" state instead of a broken page.
 * - "Try the sample interview" → precomputed ATS report (zero LLM calls).
 * - "Start my own" → guest intake flow (consent → upload → JD → ATS report).
 * - "Code playground" → M4 in-browser runner (Monaco + Workers + Pyodide).
 */
function BackendStatus({ health, error }) {
  if (health) {
    return (
      <p className="text-sm text-emerald-600" role="status">
        ● Interviewer is awake
        <span className="text-slate-500"> (db: {health.db})</span>
      </p>
    );
  }
  if (error === 'waking') {
    return (
      <p className="text-sm text-amber-600" role="status" aria-live="polite">
        <span className="inline-block animate-pulse">⏳ Waking the interviewer…</span>
        <span className="block text-xs text-slate-500 mt-1">
          The free backend sleeps when idle and takes about a minute to wake. This page stays usable meanwhile.
        </span>
      </p>
    );
  }
  return null;
}

export default function App() {
  const [health, setHealth] = useState(null);
  const [status, setStatus] = useState('checking'); // 'checking' | 'online' | 'waking'
  const [choice, setChoice] = useState(null); // null | 'sample' | 'own' | 'playground'

  useEffect(() => {
    let cancelled = false;
    let retry = null;
    const check = () =>
      pingHealth({ timeoutMs: 8000 })
        .then((data) => {
          if (cancelled) return;
          setHealth(data);
          setStatus('online');
          // Backend is awake — stop polling.
          if (retry) clearInterval(retry);
        })
        .catch(() => {
          // Render's free tier sleeps after ~15 min idle; first request wakes it.
          // Show the "waking" state and keep polling quietly so the badge flips
          // to "awake" by itself once the backend is up.
          if (!cancelled) setStatus('waking');
        });
    check();
    retry = setInterval(check, 15000);
    return () => {
      cancelled = true;
      if (retry) clearInterval(retry);
    };
  }, []);

  if (choice === 'sample') {
    return <SampleReport onBack={() => setChoice(null)} />;
  }
  if (choice === 'own') {
    return <IntakeFlow onBack={() => setChoice(null)} />;
  }
  if (choice === 'playground') {
    return <Playground onBack={() => setChoice(null)} />;
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-5">
        <h1 className="text-lg font-bold">🎙️ AI Interviewer</h1>
        <BackendStatus health={health} error={status === 'waking' ? 'waking' : null} />
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-20 pt-14 text-center">
        <p className="text-sm font-medium uppercase tracking-widest text-indigo-600">
          Software engineering · mock interviews
        </p>
        <h2 className="mt-4 text-4xl font-extrabold tracking-tight sm:text-5xl">
          Practice real SDE interviews,
          <br />
          <span className="text-indigo-600">for free, no login.</span>
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-lg text-slate-600">
          A voice + transcript mock interview with a locked-editor DSA coding round and
          company-aware questions. Open the link and start — nothing to install.
        </p>

        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <button
            onClick={() => setChoice('sample')}
            className="w-full rounded-xl bg-indigo-600 px-7 py-3 text-base font-semibold text-white shadow hover:bg-indigo-700 sm:w-auto"
          >
            Try the sample interview
          </button>
          <button
            onClick={() => setChoice('own')}
            className="w-full rounded-xl border border-slate-300 bg-white px-7 py-3 text-base font-semibold text-slate-800 shadow-sm hover:bg-slate-100 sm:w-auto"
          >
            Start my own
          </button>
        </div>
        <p className="mt-4 text-xs text-slate-400">
          Sample mode uses preloaded data — no personal information needed.
        </p>
        <p className="mt-2 text-xs">
          <button onClick={() => setChoice('playground')} className="font-medium text-indigo-600 hover:text-indigo-800">
            Here for the coding round? Try the code playground →
          </button>
        </p>

        <section className="mx-auto mt-16 grid max-w-4xl gap-4 text-left sm:grid-cols-3">
          {[
            ['🎤', 'Voice interview', 'Tap-to-record answers with a full transcript, always available.'],
            ['💻', 'DSA coding round', 'Locked editor, real test runs in your browser — Python, JavaScript, C++.'],
            ['📊', 'Honest feedback', 'Scores with evidence from your transcript, plus a study plan.'],
          ].map(([icon, title, body]) => (
            <div key={title} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-2xl">{icon}</p>
              <h3 className="mt-2 font-semibold">{title}</h3>
              <p className="mt-1 text-sm text-slate-600">{body}</p>
            </div>
          ))}
        </section>

        <p className="mt-12 text-xs text-slate-400">
          Milestone 1 foundation build · API: {apiBase()}
        </p>
      </main>
    </div>
  );
}
