/**
 * Milestone 8 — interview engine routes (spec §§4.4–4.6).
 *
 *   POST /api/interview/start       { intakeToken } → session + intro message
 *   POST /api/interview/turn        { sessionToken, text } → next interviewer message
 *   GET  /api/interview/state?token=… → resumable state (refresh/crash)
 *   POST /api/interview/approach    { sessionToken, problemSlug, approachText } → judge → lock decision
 *   POST /api/interview/dsa-result  { sessionToken, problemSlug, language, code, results }
 *
 * Contract: 200 for valid input (even when the interview logic declines, e.g.
 * unknown session → 404 with a clear error body); 400 only for malformed
 * input; 503 when the interviewer LLM is unavailable. Never a bare 500 —
 * unexpected errors are caught and reported honestly.
 */
import { Router } from 'express';
import {
  startRequestSchema,
  turnRequestSchema,
  approachRequestSchema,
  dsaResultSchema,
  stateRequestSchema,
} from '../interview/schema.js';
import * as interview from '../interview/index.js';

const router = Router();

function badInput(res, issues) {
  return res.status(400).json({
    error: 'invalid_request',
    details: issues?.issues?.map((i) => i.message) || ['Invalid request body.'],
  });
}

function sendResult(res, result) {
  const statusByError = {
    intake_not_found: 404,
    session_not_found: 404,
    problem_not_found: 404,
    invalid_request: 400,
    invalid_transition: 409,
    not_in_dsa_round: 409,
    unknown_problem: 404,
    editor_locked: 409,
    interview_complete: 409,
    interviewer_unavailable: 503,
    planner_failed: 502,
  };
  if (!result.ok) {
    const status = statusByError[result.error] || 500;
    return res.status(status).json({ error: result.error, message: result.message || result.error });
  }
  return res.json(result);
}

router.post('/interview/start', async (req, res, next) => {
  try {
    const parsed = startRequestSchema.safeParse(req.body);
    if (!parsed.success) return badInput(res, parsed.error);
    sendResult(res, await interview.startInterview(parsed.data));
  } catch (err) {
    next(err);
  }
});

router.post('/interview/turn', async (req, res, next) => {
  try {
    const parsed = turnRequestSchema.safeParse(req.body);
    if (!parsed.success) return badInput(res, parsed.error);
    sendResult(res, await interview.takeTurn(parsed.data));
  } catch (err) {
    next(err);
  }
});

router.get('/interview/state', async (req, res, next) => {
  try {
    const parsed = stateRequestSchema.safeParse(req.query);
    if (!parsed.success) return badInput(res, parsed.error);
    sendResult(res, await interview.getState(parsed.data));
  } catch (err) {
    next(err);
  }
});

router.post('/interview/approach', async (req, res, next) => {
  try {
    const parsed = approachRequestSchema.safeParse(req.body);
    if (!parsed.success) return badInput(res, parsed.error);
    sendResult(res, await interview.submitApproach(parsed.data));
  } catch (err) {
    next(err);
  }
});

router.post('/interview/dsa-result', async (req, res, next) => {
  try {
    const parsed = dsaResultSchema.safeParse(req.body);
    if (!parsed.success) return badInput(res, parsed.error);
    sendResult(res, await interview.submitDsaResult(parsed.data));
  } catch (err) {
    next(err);
  }
});

export default router;
