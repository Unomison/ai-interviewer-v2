/**
 * Guest intake flow (Milestone 3, spec Sections 4.1–4.2).
 *
 * Steps: consent → resume upload → optional JD → review (company / role /
 * seniority, honouring the ADR 002 company rule) → ATS report.
 * No login anywhere; the session token lives in memory + localStorage.
 */
import { useState } from 'react';
import {
  submitConsent,
  uploadResume,
  submitJd,
  buildAtsReport,
  deleteMyData,
} from '../api.js';
import AtsReport from '../components/AtsReport.jsx';

const TOKEN_KEY = 'ai-interviewer-session';

function StepShell({ title, subtitle, children, onBack }) {
  return (
    <div className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <button onClick={onBack} className="text-sm font-medium text-slate-500 hover:text-slate-800">
        ← Back
      </button>
      <h2 className="mt-3 text-2xl font-bold text-slate-900">{title}</h2>
      {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      <div className="mt-6">{children}</div>
    </div>
  );
}

function ErrorBox({ error }) {
  if (!error) return null;
  return (
    <p className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
      {error}
    </p>
  );
}

const inputCls =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none';
const primaryBtn =
  'rounded-xl bg-indigo-600 px-6 py-3 text-base font-semibold text-white shadow hover:bg-indigo-700 disabled:opacity-50';

export default function IntakeFlow({ onBack, onStartInterview }) {
  const [step, setStep] = useState('consent');
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [file, setFile] = useState(null);
  const [jdText, setJdText] = useState('');
  const [jdResult, setJdResult] = useState(null);
  const [company, setCompany] = useState('');
  const [companyLocked, setCompanyLocked] = useState(false);
  const [role, setRole] = useState('');
  const [roleRequired, setRoleRequired] = useState(false);
  const [seniority, setSeniority] = useState('mid');
  const [report, setReport] = useState(null);
  const [deleted, setDeleted] = useState(false);

  async function run(fn) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const doConsent = () =>
    run(async () => {
      const data = await submitConsent();
      localStorage.setItem(TOKEN_KEY, data.token);
      setToken(data.token);
      setStep('upload');
    });

  const doUpload = () =>
    run(async () => {
      if (!file) {
        setError('Choose a PDF or DOCX file first.');
        return;
      }
      await uploadResume(token, file);
      setStep('jd');
    });

  const doJd = (skip) =>
    run(async () => {
      if (skip) {
        setJdResult(null);
        setCompany('');
        setCompanyLocked(false);
        setRole('');
        setRoleRequired(true);
        setSeniority('mid');
        setStep('review');
        return;
      }
      const data = await submitJd(token, jdText);
      setJdResult(data);
      setCompany(data.company || '');
      // ADR 002: ambiguous company → empty field for the user, never guessed.
      setCompanyLocked(!!(data.company && data.companySource === 'jd'));
      setRole(data.role || '');
      setRoleRequired((data.needsInput || []).includes('role'));
      setSeniority(data.seniority || 'mid');
      setStep('review');
    });

  const doReport = () =>
    run(async () => {
      if (roleRequired && !role.trim()) {
        setError('Please enter the role you are targeting.');
        return;
      }
      const data = await buildAtsReport(token, {
        company: company.trim() || null,
        role: role.trim() || null,
        seniority,
      });
      setReport(data.report);
      setStep('report');
    });

  const doDelete = () =>
    run(async () => {
      await deleteMyData(token);
      localStorage.removeItem(TOKEN_KEY);
      setToken(null);
      setDeleted(true);
    });

  if (deleted) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-10">
        <div className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h2 className="text-xl font-bold text-slate-900">Your data is deleted</h2>
          <p className="mt-2 text-sm text-slate-500">
            The session and everything in it is gone. Start again any time.
          </p>
          <button onClick={onBack} className="mt-6 rounded-lg border border-slate-300 px-5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            ← Back to landing
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      {step === 'consent' && (
        <StepShell
          title="Before you upload"
          subtitle="A quick consent notice — required by our privacy rules."
          onBack={onBack}
        >
          <ErrorBox error={error} />
          <ul className="list-disc space-y-2 pl-5 text-sm text-slate-600">
            <li>Your name, email, phone, links and street address are stripped <em>before</em> any AI sees your resume.</li>
            <li>The redacted text is processed by third-party AI services to parse it and score it.</li>
            <li>Your session auto-deletes after 30 days. You can delete it any time with the “delete my data” button.</li>
            <li>The raw file is discarded right after parsing — never stored.</li>
          </ul>
          <button onClick={doConsent} disabled={busy} className={`${primaryBtn} mt-6`}>
            {busy ? 'Starting…' : 'I agree — start my session'}
          </button>
        </StepShell>
      )}

      {step === 'upload' && (
        <StepShell
          title="Upload your resume"
          subtitle="PDF or DOCX · max 2 MB · max 3 pages · text-based (no scans)"
          onBack={() => setStep('consent')}
        >
          <ErrorBox error={error} />
          <input
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="block w-full text-sm text-slate-600 file:mr-4 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-indigo-700 hover:file:bg-indigo-100"
          />
          {file && <p className="mt-2 text-xs text-slate-500">{file.name} · {(file.size / 1024).toFixed(0)} KB</p>}
          <button onClick={doUpload} disabled={busy || !file} className={`${primaryBtn} mt-6`}>
            {busy ? 'Parsing… (one AI call)' : 'Upload & parse'}
          </button>
        </StepShell>
      )}

      {step === 'jd' && (
        <StepShell
          title="Paste the job description"
          subtitle="Optional — without it we score against a generic role template and say so."
          onBack={() => setStep('upload')}
        >
          <ErrorBox error={error} />
          <textarea
            value={jdText}
            onChange={(e) => setJdText(e.target.value)}
            rows={10}
            placeholder="Paste the full job description here…"
            className={inputCls}
          />
          <div className="mt-4 flex flex-wrap gap-3">
            <button onClick={() => doJd(false)} disabled={busy || jdText.trim().length < 50} className={primaryBtn}>
              {busy ? 'Parsing…' : 'Parse JD & continue'}
            </button>
            <button
              onClick={() => doJd(true)}
              disabled={busy}
              className="rounded-xl border border-slate-300 bg-white px-6 py-3 text-base font-semibold text-slate-700 hover:bg-slate-50"
            >
              Skip — use a generic template
            </button>
          </div>
        </StepShell>
      )}

      {step === 'review' && (
        <StepShell
          title="Check the details"
          subtitle="We filled what we could. Fix anything wrong before scoring."
          onBack={() => setStep('jd')}
        >
          <ErrorBox error={error} />
          <label className="block text-sm font-medium text-slate-700">
            Company
            <input
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder={jdResult ? 'Not stated clearly — fill it in' : 'e.g. Acme Corp'}
              className={`${inputCls} mt-1`}
            />
          </label>
          {companyLocked && (
            <p className="mt-1 text-xs text-slate-400">Taken from the job description.</p>
          )}
          <label className="mt-4 block text-sm font-medium text-slate-700">
            Role {roleRequired && <span className="text-rose-500">*</span>}
            <input
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="e.g. Software Engineer"
              className={`${inputCls} mt-1`}
            />
          </label>
          <label className="mt-4 block text-sm font-medium text-slate-700">
            Seniority
            <select value={seniority} onChange={(e) => setSeniority(e.target.value)} className={`${inputCls} mt-1`}>
              <option value="intern">Intern</option>
              <option value="new-grad">New grad</option>
              <option value="mid">Mid-level</option>
              <option value="senior">Senior</option>
            </select>
          </label>
          <button onClick={doReport} disabled={busy} className={`${primaryBtn} mt-6`}>
            {busy ? 'Scoring… (one AI rubric call)' : 'Generate ATS report'}
          </button>
        </StepShell>
      )}

      {step === 'report' && report && (
        <div>
          <div className="mx-auto mb-6 flex max-w-3xl items-center justify-between">
            <button onClick={onBack} className="text-sm font-medium text-slate-500 hover:text-slate-800">
              ← Back to landing
            </button>
            <button
              onClick={doDelete}
              disabled={busy}
              className="text-sm font-medium text-rose-600 hover:text-rose-800 disabled:opacity-50"
            >
              {busy ? 'Deleting…' : 'Delete my data'}
            </button>
          </div>
          <ErrorBox error={error} />
          <AtsReport report={report} />
          <div className="mx-auto mt-6 max-w-3xl text-center">
            <button onClick={onStartInterview} className={primaryBtn}>
              🎙️ Start my mock interview →
            </button>
            <p className="mt-2 text-xs text-slate-400">
              Text interview: intro → resume → DSA coding → CS fundamentals → behavioral → closing.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
