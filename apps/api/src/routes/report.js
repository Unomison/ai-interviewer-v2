/**
 * Milestone 10 — report routes (spec §4.10, §5).
 *
 *   POST /api/report/generate      { sessionToken } → full report + share token
 *   GET  /api/report?sessionToken= → the session's latest report (owner view)
 *   GET  /api/report/share/:token  → public shared report (unguessable token only)
 *   DELETE /api/report/share/:token → revoke the share link
 *   GET  /api/report/demo          → recorded demo (zero LLM calls)
 *
 * Contract: 200 for valid input; 400 malformed; 404 unknown session/report/
 * share; 409 interview not complete; 410 share revoked or expired; 503 when
 * the report LLM is unavailable. Never a bare 500.
 */
import { Router } from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { generateReport } from '../report/generate.js';
import {
  getReportBySession,
  getReportByShareToken,
  revokeShareToken,
} from '../report/store.js';

const router = Router();

const HERE = dirname(fileURLToPath(import.meta.url));
let demoCache = null;
function loadDemo() {
  if (demoCache) return demoCache;
  const raw = readFileSync(resolve(HERE, '..', '..', 'data', 'recorded-demo.json'), 'utf8');
  demoCache = JSON.parse(raw);
  return demoCache;
}

const statusByError = {
  invalid_request: 400,
  session_not_found: 404,
  interview_not_complete: 409,
  report_unavailable: 503,
  share_not_found: 404,
  share_revoked: 410,
  share_expired: 410,
};

function sendResult(res, result) {
  if (!result.ok) {
    const status = statusByError[result.error] || 500;
    return res.status(status).json({ error: result.error, message: result.message || result.error });
  }
  return res.json(result);
}

/** Public shape: report content + share metadata, no session internals. */
function publicReport(doc) {
  const r = doc.report || doc;
  return {
    id: doc.id || r.id,
    createdAt: doc.createdAt || r.createdAt,
    demo: !!r.demo,
    summary: r.summary,
    overallScore: r.overallScore,
    dimensions: r.dimensions,
    weakTopics: r.weakTopics,
    studyPlan: r.studyPlan,
    stats: r.stats,
    evidenceReport: r.evidenceReport,
    disclaimer: r.disclaimer,
    shareToken: doc.shareToken || r.shareToken || null,
    shareRevoked: !!doc.shareRevoked,
  };
}

router.post('/report/generate', async (req, res, next) => {
  try {
    sendResult(res, await generateReport(req.body || {}));
  } catch (err) {
    next(err);
  }
});

router.get('/report', async (req, res, next) => {
  try {
    const { sessionToken } = req.query || {};
    if (!sessionToken || typeof sessionToken !== 'string') {
      return res.status(400).json({ error: 'invalid_request', message: 'sessionToken query param is required.' });
    }
    const doc = await getReportBySession(sessionToken);
    if (!doc) return res.status(404).json({ error: 'report_not_found', message: 'No report for this session yet.' });
    return res.json({ ok: true, report: publicReport(doc) });
  } catch (err) {
    next(err);
  }
});

router.get('/report/share/:token', async (req, res, next) => {
  try {
    const doc = await getReportByShareToken(req.params.token);
    if (!doc) return res.status(404).json({ error: 'share_not_found', message: 'Unknown share link.' });
    if (doc.shareRevoked) return res.status(410).json({ error: 'share_revoked', message: 'This share link was revoked.' });
    return res.json({ ok: true, report: publicReport(doc) });
  } catch (err) {
    next(err);
  }
});

router.delete('/report/share/:token', async (req, res, next) => {
  try {
    const revoked = await revokeShareToken(req.params.token);
    if (!revoked) return res.status(404).json({ error: 'share_not_found', message: 'Unknown share link.' });
    return res.json({ ok: true, revoked: true });
  } catch (err) {
    next(err);
  }
});

/**
 * Recorded demo (spec §6): a curated pre-recorded interview + report for
 * LLM quota exhaustion. Static JSON — zero gateway calls, always 200.
 */
router.get('/report/demo', (_req, res, next) => {
  try {
    const demo = loadDemo();
    return res.json({
      ok: true,
      demo: true,
      meta: demo.meta,
      transcript: demo.transcript,
      report: publicReport({ id: 'recorded-demo', createdAt: new Date().toISOString(), report: { ...demo.report, demo: true } }),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
