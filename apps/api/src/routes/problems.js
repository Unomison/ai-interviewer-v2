/**
 * Milestone 6 — GET /api/problems, GET /api/problems/:slug.
 *
 * Serves the validated problem bank (Mongo-first, bundled fallback).
 */
import { Router } from 'express';
import { listProblems, getProblem } from '../problems/index.js';

const router = Router();

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
