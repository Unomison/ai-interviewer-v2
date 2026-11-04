import { useMemo, useState } from 'react';
import { PROBLEMS, getProblem, LANGUAGES } from '../problems.js';
import LockedEditor from '../components/LockedEditor.jsx';
import TestRunner from '../components/TestRunner.jsx';

/**
 * Milestone 4 — code runner playground (the M4 acceptance surface).
 *
 * A visitor picks a problem + language, writes code in the (demo-)locked
 * Monaco editor, and runs the tests in-browser. Full interview integration
 * (approach judging, hints, scoring) arrives in M8; this page proves the
 * runner, the locked editor, and the timeout semantics end to end.
 */

const LANGUAGE_LABEL = { javascript: 'JavaScript', python: 'Python' };

export default function Playground({ onBack }) {
  const [problemId, setProblemId] = useState(PROBLEMS[0].id);
  const [language, setLanguage] = useState('javascript');
  const problem = useMemo(() => getProblem(problemId), [problemId]);
  const [code, setCode] = useState(() => getProblem(PROBLEMS[0].id).starter.javascript);
  const [locked, setLocked] = useState(true);
  const [runKey, setRunKey] = useState(0);

  const pickProblem = (id) => {
    const p = getProblem(id);
    setProblemId(id);
    setCode(p.starter[language]);
    setLocked(true);
    setRunKey((k) => k + 1);
  };

  const pickLanguage = (lang) => {
    setLanguage(lang);
    setCode(problem.starter[lang]);
    setRunKey((k) => k + 1);
  };

  const visibleTests = problem.tests.filter((t) => !t.hidden);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-5">
        <button onClick={onBack} className="text-sm font-medium text-indigo-600 hover:text-indigo-800">
          ← Back to landing
        </button>
        <h1 className="text-lg font-bold">💻 Code playground</h1>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-20">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="text-sm font-medium">
            Problem:{' '}
            <select
              value={problemId}
              onChange={(e) => pickProblem(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              {PROBLEMS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-2 text-sm font-medium" role="group" aria-label="Language">
            Language:
            {LANGUAGES.map((lang) => (
              <button
                key={lang}
                type="button"
                onClick={() => pickLanguage(lang)}
                className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                  language === lang
                    ? 'bg-indigo-600 text-white'
                    : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                }`}
              >
                {LANGUAGE_LABEL[lang]}
              </button>
            ))}
          </div>
          {language === 'python' && (
            <p className="text-xs text-slate-500">Python loads a ~15 MB runtime on first run — cached afterwards.</p>
          )}
        </div>

        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold">{problem.title}</h2>
          <p className="mt-2 text-sm text-slate-700">{problem.statement}</p>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 font-mono text-xs text-slate-600">
            {problem.constraints.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <div className="mt-3 space-y-1 text-sm">
            {problem.examples.map((ex, i) => (
              <p key={i} className="font-mono text-xs text-slate-600">
                <span className="font-semibold">Example {i + 1}:</span> {ex.input} → {ex.output}
              </p>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Signature: <code className="font-mono">{`solve(${problem.params.map((p) => p.name).join(', ')})`}</code> →{' '}
            <code className="font-mono">{problem.returnType}</code> · {visibleTests.length} visible +{' '}
            {problem.tests.length - visibleTests.length} hidden tests
          </p>
        </section>

        <section className="mt-6">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold">Your solution</h2>
            <button
              type="button"
              onClick={() => setCode(problem.starter[language])}
              className="text-xs font-medium text-slate-500 hover:text-slate-800"
            >
              Reset to starter template
            </button>
          </div>
          <LockedEditor
            language={language}
            value={code}
            onChange={setCode}
            locked={locked}
            onUnlockRequest={() => setLocked(false)}
          />
        </section>

        <section className="mt-6">
          <TestRunner key={runKey} problem={problem} code={code} language={language} />
        </section>

        <p className="mt-8 text-center text-xs text-slate-400">
          Code runs entirely in your browser (Web Worker{language === 'python' ? ' + Pyodide' : ''}) — nothing is sent
          to any server. Hidden test inputs are never displayed.
        </p>
      </main>
    </div>
  );
}
