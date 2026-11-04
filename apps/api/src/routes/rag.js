/**
 * Milestone 11 — RAG status route (spec §4.9, ADR 012).
 *
 *   GET /api/rag/status → 200 always:
 *     { mode: 'disabled'|'not-indexed'|'indexed', indexed, chunkCount,
 *       embeddingModel, embeddingDimensions, indexName, collection, note }
 *
 * Honest by design: before the owner creates the Atlas Vector Search index
 * (docs/atlas-vector-index-walkthrough.md) this reports `not-indexed` and
 * the app keeps working via the M7 direct KB lookup. Never a bare 500.
 */
import { Router } from 'express';
import { getRagStatus } from '../rag/index.js';

const router = Router();

router.get('/rag/status', async (req, res, next) => {
  try {
    res.json({ ok: true, ...(await getRagStatus()) });
  } catch (err) {
    next(err);
  }
});

export default router;
