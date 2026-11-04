/**
 * ATS report view (Milestone 3, spec Section 4.2).
 *
 * Shows the total score, the four-part breakdown, the two missing-keyword
 * lists, before/after rewrite suggestions, and — always — the honesty note
 * that this is an estimate (real ATS products rarely expose scores).
 */

const PART_LABELS = {
  keyword: 'Keyword / skill match',
  semantic: 'Semantic match',
  structure: 'Structure & parseability',
  impact: 'Impact quality (AI rubric)',
};

function scoreColor(score) {
  if (score >= 70) return 'text-emerald-600';
  if (score >= 50) return 'text-amber-600';
  return 'text-rose-600';
}

function barColor(score) {
  if (score >= 70) return 'bg-emerald-500';
  if (score >= 50) return 'bg-amber-500';
  return 'bg-rose-500';
}

function BreakdownBar({ part, score, weight }) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium text-slate-700">{PART_LABELS[part]}</span>
        <span className="text-slate-500">
          <span className={`font-bold ${scoreColor(score)}`}>{score}</span>
          <span className="ml-1 text-xs">· weight {Math.round(weight * 100)}%</span>
        </span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${barColor(score)}`} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}

export default function AtsReport({ report, sample = false }) {
  if (!report) return null;
  const { breakdown, weights, missingKeywords, suggestions } = report;
  return (
    <div className="mx-auto max-w-3xl text-left">
      {sample && (
        <p className="mb-4 inline-block rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
          Sample data — precomputed, no upload needed, zero AI calls
        </p>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xl font-bold text-slate-900">ATS match report</h2>
          <p className={`text-4xl font-extrabold ${scoreColor(report.totalScore)}`}>
            {report.totalScore}
            <span className="text-lg text-slate-400">/100</span>
          </p>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          {report.role}
          {report.company ? ` · ${report.company}` : ''}
          {report.seniority ? ` · ${report.seniority}` : ''}
        </p>
        {report.jdSource === 'role-template' && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            No job description was provided, so this was scored against a generic{' '}
            {report.role} template. Paste a real JD for a precise score.
          </p>
        )}

        <div className="mt-5 space-y-4">
          {Object.keys(PART_LABELS).map((part) => (
            <BreakdownBar key={part} part={part} score={breakdown[part]} weight={weights[part]} />
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="font-semibold text-slate-900">Mention it — you have it</h3>
          <p className="mt-1 text-xs text-slate-500">
            These appear in your resume but were never stated outright.
          </p>
          {missingKeywords.unstatedButPresent.length === 0 ? (
            <p className="mt-3 text-sm text-slate-400">Nothing here — good.</p>
          ) : (
            <ul className="mt-3 flex flex-wrap gap-2">
              {missingKeywords.unstatedButPresent.map((k) => (
                <li key={k} className="rounded-full bg-indigo-50 px-3 py-1 text-sm text-indigo-700">
                  {k}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="font-semibold text-slate-900">Genuine gaps</h3>
          <p className="mt-1 text-xs text-slate-500">
            No evidence of these in your resume. Learn them — don't claim them.
          </p>
          {missingKeywords.genuineGaps.length === 0 ? (
            <p className="mt-3 text-sm text-slate-400">No gaps detected.</p>
          ) : (
            <ul className="mt-3 flex flex-wrap gap-2">
              {missingKeywords.genuineGaps.map((k) => (
                <li key={k} className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-600">
                  {k}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="font-semibold text-slate-900">Rewrite suggestions</h3>
        <p className="mt-1 text-xs text-slate-500">
          Before → after. Only rephrasing — nothing here invents experience.
        </p>
        {suggestions.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400">No suggestions this time.</p>
        ) : (
          <ul className="mt-3 space-y-4">
            {suggestions.map((s, i) => (
              <li key={i} className="rounded-xl bg-slate-50 p-4">
                <p className="text-sm text-slate-500 line-through decoration-rose-300">{s.before}</p>
                <p className="mt-1 text-sm font-medium text-slate-800">{s.after}</p>
                <p className="mt-1 text-xs text-slate-500">{s.reason}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="mt-4 rounded-xl bg-slate-100 px-4 py-3 text-xs leading-relaxed text-slate-500">
        {report.disclaimer}
      </p>
    </div>
  );
}
