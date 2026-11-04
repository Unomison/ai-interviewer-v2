/**
 * Milestone 6 — GET /api/problems, GET /api/problems/:slug.
 *
 * Serves the validated problem bank (Mongo-first, bundled fallback).
 */
import { Router } from 'express';
import { listProblems, getProblem } from '../problems/index.js';
import { requestJitProblem, submitJitValidation } from '../problems/jit.js';

const router = Router();

const jitStatusByError = {
  invalid_request: 400,
  session_not_found: 404,
  jit_not_found: 404,
};

function sendJitResult(res, result) {
  if (!result.ok) {
    const status = jitStatusByError[result.error] || 500;
    return res.status(status).json({ error: result.error, message: result.message || result.error });
  }
  return res.json(result);
}

/**
 * Milestone 10 — JIT problem request (spec §4.9).
 * POST /api/problems/jit { sessionToken, topic, difficulty }
 * → { source: 'bank' } (already covered — no LLM burned)
 * → { source: 'jit-draft', jitId, draft } (validate in the browser, then POST /jit/validate)
 * → { source: 'bank-fallback', problem, reason } (honest fallback)
 */
router.post('/problems/jit', async (req, res, next) => {
  try {
    sendJitResult(res, await requestJitProblem(req.body || {}));
  } catch (err) {
    next(err);
  }
});

/**
 * Milestone 10 — JIT browser validation receipt (spec §4.9).
 * POST /api/problems/jit/validate { sessionToken, jitId, receipt }
 * → { source: 'jit', problem } on passing validation
 * → { source: 'bank-fallback', problem, reason } otherwise
 * Never serves an unvalidated JIT problem.
 */
router.post('/problems/jit/validate', async (req, res, next) => {
  try {
    sendJitResult(res, await submitJitValidation(req.body || {}));
  } catch (err) {
    next(err);
  }
});

router.get('/problems', async (_req, res, next) => {
  try {
    const { source, version, problems } = await listProblems();
    res.json({ source, version, count: problems.length, problems });
  } catch (err) {
    next(err);
  }
});

router.get('/problems/:slug', async (req, res, next) => {
  try {
    const problem = await getProblem(req.params.slug);
    if (!problem) return res.status(404).json({ error: 'not_found' });
    res.json({ problem });
  } catch (err) {
    next(err);
  }
});

export default router;
