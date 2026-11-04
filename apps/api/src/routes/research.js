/**
 * Milestone 7 — POST /api/research (spec Section 4.3, ADR 002 decision 3).
 *
 * On-demand company/role research that runs ON THE SERVER (Render free
 * tier): { company, role } -> { kb, source: 'cache'|'fresh'|'partial'|'failed', ... }.
 *
 * Always answers 200 for well-formed input — research outcomes (including
 * timeouts and total failures) are data, not errors. 400 only for invalid
 * input. The 60s time-box is enforced inside the orchestrator; a slow run
 * returns `partial` with whatever was gathered.
 */
import { Router } from 'express';
import { researchCompany, RESEARCH_BUDGET_MS } from '../research/index.js';
import { researchRequestSchema } from '../research/schema.js';

const router = Router();

router.post('/research', async (req, res, next) => {
  let body;
  try {
    body = researchRequestSchema.parse(req.body ?? {});
  } catch (err) {
    return res.status(400).json({
      error: 'invalid_request',
      details: err.errors?.map((e) => e.message) ?? ['Invalid request body'],
    });
  }
  try {
    const result = await researchCompany({
      company: body.company,
      role: body.role || '',
      budgetMs: RESEARCH_BUDGET_MS,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
