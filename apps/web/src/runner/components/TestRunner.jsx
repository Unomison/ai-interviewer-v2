import { useRef, useState } from 'react';
import { runJavaScriptTests, runPythonTests } from '../executor.js';
import { runCppTests, createBrowserCppCompilerWorker, createBrowserCppRunnerWorker } from '../cpp.js';
import { createPythonWorker } from '../pyodide.js';
import { firstVisibleFailure, statusLabel } from '../harness.js';

/**
 * Milestone 4 — test runner UI (spec §4.6 results panel).
 *
 * - "Run tests" executes the candidate's code in a Web Worker (JS native,
 *   Python via Pyodide, C++ compiled in-browser with Clang → wasm) with
 *   per-test timeouts; the worker is terminated on overrun and the test is
 *   marked TLE. C++ compile errors surface the compiler output (no hang).
 * - Per-test pass/fail, runtime ms, errors. The FIRST failing case may be
 *   shown (configurable); hidden test inputs are never displayed.
 * - Overall verdict banner: all pass / failed / TLE / error.
 */

function fmtMs(ms) {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function fmtValue(v) {
  try {
    const s = JSON.stringify(v);
    return s === undefined ? String(v) : s;
  } catch {
    return String(v);
  }
}

function StatusDot({ status }) {
  const color =
    status === 'pass'
      ? 'bg-emerald-500'
      : status === 'fail'
        ? 'bg-red-500'
        : status === 'tle'
          ? 'bg-amber-500'
          : 'bg-slate-400';
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${color}`} aria-hidden="true" />;
}

export default function TestRunner({ problem, code, language, showFirstFailure = true }) {
  const [phase, setPhase] = useState('idle'); // idle | running | done
  const [results, setResults] = useState([]);
  const [summary, setSummary] = useState(null);
  const [progress, setProgress] = useState(null); // {done,total} | {stage,text}
  const [runError, setRunError] = useState(null);
  const runId = useRef(0);

  const run = async () => {
    const id = ++runId.current;
    setPhase('running');
    setResults([]);
    setSummary(null);
    setRunError(null);
    setProgress({ done: 0, total: problem.tests.length });
    try {
      const onTestDone = (r) => {
        if (runId.current !== id) return;
        setResults((prev) => [...prev, r]);
        setProgress((p) => (p && typeof p.done === 'number' ? { ...p, done: p.done + 1 } : p));
      };
      const onProgress = (stage, text) => {
        if (runId.current !== id) return;
        setProgress({ stage, text });
      };
      const out =
        language === 'python'
          ? await runPythonTests({ code, problem, createWorker: createPythonWorker, onProgress, onTestDone })
          : language === 'cpp'
            ? await runCppTests({
                code,
                problem,
                createCompilerWorker: createBrowserCppCompilerWorker,
                createRunnerWorker: createBrowserCppRunnerWorker,
                onProgress,
                onTestDone,
              })
            : await runJavaScriptTests({ code, problem, onTestDone });
      if (runId.current !== id) return;
      setSummary(out);
      setPhase('done');
      setProgress(null);
    } catch (err) {
      if (runId.current !== id) return;
      setRunError(err?.message || String(err));
      setPhase('done');
      setProgress(null);
    }
  };

  const failure = summary && showFirstFailure ? firstVisibleFailure(summary.results, problem) : null;

  const verdictBanner = () => {
    if (!summary) return null;
    if (summary.allPass) {
      return (
        <div className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800" role="status">
          ✅ All {summary.total} tests passed
        </div>
      );
    }
    const parts = [];
    if (summary.failed) parts.push(`${summary.failed} failed`);
    if (summary.errors) parts.push(`${summary.errors} errored`);
    if (summary.tles) parts.push(`${summary.tles} timed out`);
    return (
      <div className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-800" role="status">
        ❌ {summary.passed}/{summary.total} passed — {parts.join(', ')}
      </div>
    );
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Test runs</h3>
        <button
          type="button"
          onClick={run}
          disabled={phase === 'running'}
          className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {phase === 'running' ? 'Running…' : '▶ Run tests'}
        </button>
      </div>

      {phase === 'running' && progress && (
        <p className="mt-3 text-sm text-slate-600" role="status" aria-live="polite">
          {typeof progress.done === 'number'
            ? `Running test ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`
            : `⏳ ${progress.text || 'Working…'}`}
        </p>
      )}

      {runError && (
        <div className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          <pre className="whitespace-pre-wrap font-sans">{runError}</pre>
        </div>
      )}

      {results.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {results.map((r) => {
            const test = problem.tests[r.index];
            return (
              <li
                key={r.index}
                className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm"
              >
                <span className="flex items-center gap-2">
                  <StatusDot status={r.status} />
                  <span className="font-medium">
                    {test.hidden ? `Hidden test #${r.index + 1}` : `Test #${r.index + 1}`}
                  </span>
                  <span className="text-slate-500">{statusLabel(r.status)}</span>
                </span>
                <span className="text-xs text-slate-500">{fmtMs(r.runtimeMs)}</span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3">{verdictBanner()}</div>

      {failure && !failure.hidden && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
          <p className="font-semibold text-amber-900">
            First failing case (test #{failure.index + 1}){failure.status === 'error' ? ' — runtime error' : ''}:
          </p>
          <dl className="mt-2 space-y-1 font-mono text-xs">
            <div>
              <dt className="inline font-semibold">input: </dt>
              <dd className="inline break-all">{fmtValue(failure.test.args)}</dd>
            </div>
            <div>
              <dt className="inline font-semibold">expected: </dt>
              <dd className="inline break-all">{fmtValue(failure.test.expected)}</dd>
            </div>
            {failure.status === 'fail' && (
              <div>
                <dt className="inline font-semibold">got: </dt>
                <dd className="inline break-all">{fmtValue(failure.result.actual)}</dd>
              </div>
            )}
            {failure.result.error && (
              <div>
                <dt className="inline font-semibold">error: </dt>
                <dd className="inline break-all text-red-700">{failure.result.error}</dd>
              </div>
            )}
          </dl>
        </div>
      )}
      {failure && failure.hidden && (
        <p className="mt-3 rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-600">
          A hidden test failed — its input is not shown. Check edge cases and try again.
        </p>
      )}
    </div>
  );
}
