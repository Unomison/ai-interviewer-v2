/**
 * Sample ATS report view (Milestone 3).
 *
 * "Try the sample interview" → this view. Precomputed data, zero LLM calls,
 * zero uploads — the M1 placeholder is gone.
 */
import { useEffect, useState } from 'react';
import { fetchSampleReport } from '../api.js';
import AtsReport from '../components/AtsReport.jsx';

export default function SampleReport({ onBack }) {
  const [report, setReport] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchSampleReport()
      .then((data) => {
        if (!cancelled) setReport(data.report);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto mb-6 max-w-3xl">
        <button
          onClick={onBack}
          className="text-sm font-medium text-slate-500 hover:text-slate-800"
        >
          ← Back to landing
        </button>
      </div>
      {error && (
        <p className="mx-auto max-w-3xl rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          Couldn't load the sample report: {error}
        </p>
      )}
      {!error && !report && (
        <p className="mx-auto max-w-3xl text-center text-slate-500">Loading the sample report…</p>
      )}
      {report && <AtsReport report={report} sample />}
    </div>
  );
}
