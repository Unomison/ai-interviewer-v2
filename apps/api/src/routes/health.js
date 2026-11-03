import { Router } from 'express';
import { getDbStatus } from '../db.js';

const router = Router();

/**
 * GET /api/health
 * Liveness + dependency snapshot. Always 200 while the process is alive,
 * so free hosts and the frontend wake-up ping get a reliable answer.
 * The db field is one of: "connected" | "not_configured" | "unreachable".
 */
router.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    db: getDbStatus(),
    time: new Date().toISOString(),
  });
});

export default router;
