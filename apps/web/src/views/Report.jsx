import { useEffect, useState } from 'react';
import {
  generateReport,
  fetchReport,
  fetchSharedReport,
  revokeShare,
} from '../api.js';

/**
 * Milestone 10 — final report view (spec §4.10).
 *
 * Three modes:
 *  - owner:   { sessionToken } → generates (or re-fetches) the report
 *  - shared:  { shareToken }   → public read-only view, no session id anywhere
 *  - embedded demo data via `initialReport` (recorded demo page)
 *
 * Print/PDF: a print stylesheet hides chrome — the user prints to PDF from
 * the browser. No server-side PDF generation (free-tier decision, ADR 011).
 */

function ScoreBar({ score }) {
  if (score === null || score === undefined) {
    return <span className="text-sm italic text-slate-400">insufficient data</span>;
  }
  const color = score >= 75 ? 'bg-emerald-500' : score >= 50 ? 'bg-amber-500' : 'bg-rose-500';
  return (
    <div className="flex items-center gap-2">
      <div className="h-2.5 w-40 overflow-hidden rounded-full bg-slate-200 print:w-32">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-sm font-bold tabular-nums">{score}</span>
    </div>
  );
}

function EvidenceQuotes({ evidence }) {
  if (!evidence || evidence.length === 0) return null;
  return (
    <div className="mt-2 space-y-1.5">
      {evidence.map((e, i) => (
        <blockquote key={i} className="border-l-2 border-indigo-300 pl-3 text-sm italic text-slate-600">
          “{e.quote}”
          <span className="ml-2 not-italic text-xs text-slate-400">— {e.speaker}</span>
        </blockquote>
      ))}
    </div>
  );
}

function DimensionCard({ dim }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm print:break-inside-avoid print:shadow-none">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">
            {dim.label}
            <span className="ml-2 text-xs font-normal text-slate-400">weight {dim.weight}%</span>
          </h3>
          {dim.insufficientData && (
            <p className="mt-1 inline-block rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
              insufficient data
            </p>
          )}
          {dim.inference && !dim.insufficientData && (
            <p className="mt-1 inline-block rounded bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
              partly inferred — quotes below are verified
            </p>
          )}
        </div>
        <ScoreBar score={dim.score} />
      </div>
      <p className="mt-2 text-sm text-slate-700">{dim.assessment}</p>
      <p className="mt-1 text-xs text-slate-400">
        {dim.scoreSource === 'deterministic' ? 'Scored from executed results' : 'Scored by the interviewer model'}
      </p>
      <EvidenceQuotes evidence={dim.evidence} />
    </div>
  );
}

function ShareBox({ shareToken, onRevoke }) {
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState(false);
  if (!shareToken) return null;
  const url = `${window.location.origin}${window.location.pathname}#/shared/${shareToken}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const revoke = async () => {
    if (!window.confirm('Revoke this share link? Anyone with the link will lose access.')) return;
    setRevoking(true);
    try {
      await revokeShare(shareToken);
      onRevoke();
    } finally {
      setRevoking(false);
    }
  };
  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 print:hidden">
      <p className="text-sm font-semibold text-indigo-900">🔗 Shareable private link</p>
      <p className="mt-1 text-xs text-indigo-700">
        Anyone with this link can view the report — no login needed. It expires with your interview data.
      </p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input
          readOnly
          value={url}
          onFocus={(e) => e.target.select()}
          className="flex-1 rounded-lg border border-indigo-200 bg-white px-3 py-2 font-mono text-xs text-slate-700"
        />
        <button
          onClick={copy}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          {copied ? '✓ Copied' : 'Copy link'}
        </button>
        <button
          onClick={revoke}
          disabled={revoking}
          className="rounded-lg border border-rose-300 bg-white px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
        >
          {revoking ? 'Revoking…' : 'Revoke'}
        </button>
      </div>
    </div>
  );
}

export default function Report({ sessionToken, shareToken, initialReport, onBack }) {
  const [state, setState] = useState(initialReport ? 'ready' : 'loading');
  const [report, setReport] = useState(initialReport || null);
  const [error, setError] = useState(null);
  const [shared, setShared] = useState(!!initialReport?.shareToken);
  const isSharedView = !!shareToken && !sessionToken;

  useEffect(() => {
    if (initialReport) return;
    let cancelled = false;
    const load = async () => {
      try {
        let data;
        if (shareToken) {
          data = await fetchSharedReport(shareToken);
        } else {
          // Owner view: reuse an existing report, else generate.
          try {
            data = await fetchReport(sessionToken);
          } catch (e) {
            if (e.status !== 404) throw e;
            data = await generateReport(sessionToken);
          }
        }
        if (!cancelled) {
          setReport(data.report);
          setShared(!!data.report.shareToken);
          setState('ready');
        }
      } catch (e) {
        if (!cancelled) {
          setError(e);
          setState('error');
        }
      }
    };
    load();
    return () => { cancelled = true; };
  }, [sessionToken, shareToken, initialReport]);

  const handlePrint = () => window.print();

  if (state === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <p className="animate-pulse text-slate-500">📊 Generating your report…</p>
      </div>
    );
  }

  if (state === 'error') {
    const gone = error && (error.status === 410 || error.code === 'share_revoked' || error.code === 'share_expired');
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="text-4xl">{gone ? '🔒' : '⚠️'}</p>
          <h2 className="mt-3 text-lg font-bold">
            {gone ? 'This share link is no longer available' : 'Could not load the report'}
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            {gone
              ? 'It was revoked or expired. Ask the owner for a fresh link.'
              : error?.code === 'interview_not_complete'
                ? 'The interview is still in progress — finish it first.'
                : error?.message || 'Something went wrong.'}
          </p>
          {onBack && (
            <button onClick={onBack} className="mt-4 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700">
              ← Back
            </button>
          )}
        </div>
      </div>
    );
  }

  const dims = report.dimensions || [];
  const stats = report.stats || {};
  const fmtMs = (ms) => (ms === null || ms === undefined ? '—' : `${Math.round(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 print:bg-white">
      <header className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4 print:hidden">
        {onBack ? (
          <button onClick={onBack} className="text-sm font-medium text-indigo-600 hover:text-indigo-800">← Back</button>
        ) : <span />}
        <button
          onClick={handlePrint}
          className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold shadow-sm hover:bg-slate-100"
        >
          🖨️ Print / save as PDF
        </button>
      </header>

      <main className="mx-auto max-w-4xl px-4 pb-16 print:max-w-none print:px-0 print:pb-0">
        <p className="text-sm font-medium uppercase tracking-widest text-indigo-600 print:text-slate-500">
          {report.demo ? 'Recorded demo report' : 'Interview report'}
        </p>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <h1 className="text-3xl font-extrabold tracking-tight">Your performance summary</h1>
          <div className="text-right">
            <p className="text-xs text-slate-400">Overall score</p>
            <p className="text-5xl font-extrabold tabular-nums text-indigo-700">
              {report.overallScore ?? '—'}
              <span className="text-xl text-slate-400">/100</span>
            </p>
          </div>
        </div>
        <p className="mt-3 max-w-3xl text-slate-700">{report.summary}</p>

        <section className="mt-8">
          <h2 className="text-xl font-bold">Dimension scores</h2>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            {dims.map((d) => <DimensionCard key={d.key} dim={d} />)}
          </div>
        </section>

        {(stats.dsa || []).length > 0 && (
          <section className="mt-8">
            <h2 className="text-xl font-bold">Coding rounds</h2>
            <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white print:shadow-none">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                    <th className="px-4 py-2">Problem</th>
                    <th className="px-4 py-2">Tests</th>
                    <th className="px-4 py-2">Hints</th>
                    <th className="px-4 py-2">Approach tries</th>
                    <th className="px-4 py-2">Unlock</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.dsa.map((p) => (
                    <tr key={p.slug} className="border-b border-slate-100 last:border-0">
                      <td className="px-4 py-2 font-medium">{p.title}</td>
                      <td className="px-4 py-2 tabular-nums">{p.passRate === null ? '—' : `${p.passRate}%`}</td>
                      <td className="px-4 py-2 tabular-nums">{p.hintsUsed}</td>
                      <td className="px-4 py-2 tabular-nums">{p.approachAttempts}</td>
                      <td className="px-4 py-2 text-xs text-slate-500">
                        {p.unlocked ? `yes (${p.unlockReason || 'accepted'})` : 'no'}
                        {p.languages?.length > 0 && <span className="block">{p.languages.join(', ')}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {(report.weakTopics || []).length > 0 && (
          <section className="mt-8">
            <h2 className="text-xl font-bold">Weak topics</h2>
            <div className="mt-3 space-y-3">
              {report.weakTopics.map((w, i) => (
                <div key={i} className="rounded-xl border border-slate-200 bg-white p-4 print:break-inside-avoid print:shadow-none">
                  <p className="font-semibold">
                    {w.topic}
                    {w.inference && <span className="ml-2 text-xs font-normal text-amber-600">(inferred)</span>}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">{w.reason}</p>
                  <EvidenceQuotes evidence={w.evidence} />
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="mt-8">
          <h2 className="text-xl font-bold">📚 Study plan</h2>
          <ol className="mt-3 space-y-3">
            {(report.studyPlan || []).map((s, i) => (
              <li key={i} className="rounded-xl border border-slate-200 bg-white p-4 print:break-inside-avoid print:shadow-none">
                <p className="font-semibold">
                  <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white print:bg-slate-700">{i + 1}</span>
                  {s.topic}
                </p>
                <p className="mt-1 text-sm text-slate-600">{s.why}</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
                  {(s.actions || []).map((a, j) => <li key={j}>{a}</li>)}
                </ul>
                {(s.suggestedProblems || []).length > 0 && (
                  <p className="mt-2 text-xs text-slate-500">
                    Practice: <span className="font-mono">{s.suggestedProblems.join(', ')}</span>
                  </p>
                )}
              </li>
            ))}
          </ol>
        </section>

        {(stats.rounds || []).length > 0 && !report.demo && (
          <section className="mt-8">
            <h2 className="text-xl font-bold">Timeline</h2>
            <div className="mt-3 space-y-1 text-sm text-slate-600">
              {stats.rounds.map((r) => (
                <p key={r.round}>
                  <span className="font-medium capitalize">{r.round}</span>
                  {' — '}{r.turns} turns{r.durationMs !== null && `, ${fmtMs(r.durationMs)}`}
                </p>
              ))}
              <p className="text-slate-400">
                Total: {stats.totalTurns} turns{stats.interviewDurationMs !== null && `, ${fmtMs(stats.interviewDurationMs)}`}
                {stats.hintsUsedTotal > 0 && `, ${stats.hintsUsedTotal} hint(s) used`}
              </p>
            </div>
          </section>
        )}

        {stats.ats && (
          <section className="mt-8">
            <h2 className="text-xl font-bold">ATS recap</h2>
            <p className="mt-2 text-sm text-slate-600">
              Resume score: <span className="font-bold tabular-nums">{stats.ats.score}/100</span>
              {(stats.ats.genuineGaps || []).length > 0 && (
                <span className="block">Genuine gaps: {stats.ats.genuineGaps.join(', ')}</span>
              )}
            </p>
          </section>
        )}

        <p className="mt-8 rounded-xl bg-slate-100 p-4 text-xs text-slate-500 print:bg-transparent print:p-0">
          {report.disclaimer}
          {report.evidenceReport && (
            <span className="block mt-1">
              {report.evidenceReport.verifiedQuotes} verified evidence quote(s)
              {report.evidenceReport.inferenceClaims > 0 && `, ${report.evidenceReport.inferenceClaims} claim(s) marked as inference`}.
            </span>
          )}
        </p>

        {!isSharedView && !report.demo && (
          <div className="mt-6">
            <ShareBox shareToken={shared ? report.shareToken : null} onRevoke={() => setShared(false)} />
            {!shared && (
              <p className="mt-2 text-xs text-slate-400">
                A private share link is created with your report — copy it from the box above once it appears.
              </p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
