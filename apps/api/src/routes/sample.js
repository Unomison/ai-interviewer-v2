/**
 * Sample ATS report (Milestone 3, spec Section 13).
 *
 * Served from PRECOMPUTED fixtures with ZERO LLM calls — visitors see a full
 * ATS report without uploading anything or spending quota.
 *
 * INVARIANT (guarded by tests/intake.ats.test.js): this module must never
 * import the LLM gateway. The sample path is pure data.
 */
import { Router } from 'express';
import { SAMPLE_ATS_REPORT, SAMPLE_RESUME, SAMPLE_JD } from '../sample/fixtures.js';

const router = Router();

/** Exported for direct unit testing (no server needed). */
export function sampleAtsReportHandler(_req, res) {
  res.json({
    report: SAMPLE_ATS_REPORT,
    meta: {
      sample: true,
      llmCalls: 0,
      note: 'Precomputed sample data — no personal information needed, no AI calls made.',
    },
  });
}

/** Exported for direct unit testing. */
export function sampleResumeHandler(_req, res) {
  res.json({ resume: SAMPLE_RESUME, jd: SAMPLE_JD, meta: { sample: true, llmCalls: 0 } });
}

router.get('/sample/ats-report', sampleAtsReportHandler);
router.get('/sample/resume', sampleResumeHandler);

export default router;
