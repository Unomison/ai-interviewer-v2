/**
 * Milestone 10 — LLM budget status (spec §8).
 *
 * GET /api/llm/status → per-task budget state WITHOUT spending any calls.
 * The frontend uses this to offer the recorded demo when quota is
 * exhausted instead of showing a dead end.
 */
import { Router } from 'express';
import { gateway } from '../llm/index.js';

const router = Router();

const TASKS = ['interviewer', 'report', 'problem_gen', 'planner'];

router.get('/llm/status', (_req, res, next) => {
  try {
    const tasks = {};
    for (const task of TASKS) {
      try {
        tasks[task] = gateway.budgetAllows(task);
      } catch {
        tasks[task] = { allowed: true, reason: 'unknown' };
      }
    }
    return res.json({ ok: true, tasks });
  } catch (err) {
    next(err);
  }
});

export default router;
