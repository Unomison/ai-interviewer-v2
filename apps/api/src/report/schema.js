/**
 * Milestone 10 — report schemas (spec §4.10).
 *
 * Two layers:
 *  1. `llmReportSchema` — what the single `report` gateway call returns.
 *     The LLM scores only the judgement dimensions (optimisation,
 *     communication, resume_depth) and writes prose; deterministic
 *     dimensions (problem_solving, code_correctness) are computed in code
 *     from executed results, never by the model.
 *  2. `reportDocSchema` — the stored/served report: deterministic stats +
 *     merged dimensions + evidence enforcement flags + share metadata.
 */
import { z } from 'zod';

/** Spec §4.10 default weights. Overridable per call via generateReport opts. */
export const REPORT_DIMENSIONS = [
  { key: 'problem_solving', label: 'Problem solving / approach', weight: 30 },
  { key: 'code_correctness', label: 'Code correctness', weight: 30 },
  { key: 'optimisation', label: 'Optimisation & complexity', weight: 15 },
  { key: 'communication', label: 'Communication', weight: 15 },
  { key: 'resume_depth', label: 'Resume / project depth', weight: 10 },
];

export const DIMENSION_KEYS = REPORT_DIMENSIONS.map((d) => d.key);

export const reportRequestSchema = z.object({
  sessionToken: z.string().min(1).max(200),
});

export const evidenceQuoteSchema = z.object({
  /** Verbatim excerpt from the transcript (checked by evidence.js). */
  quote: z.string().min(1).max(400),
  speaker: z.enum(['candidate', 'interviewer']),
});

/** One LLM-scored dimension (optimisation / communication / resume_depth). */
export const llmDimensionSchema = z.object({
  /** null = the model judges there is too little signal. */
  score: z.number().min(0).max(100).nullable(),
  assessment: z.string().min(1).max(1500),
  evidence: z.array(evidenceQuoteSchema).max(4).default([]),
});

export const weakTopicSchema = z.object({
  topic: z.string().min(1).max(80),
  reason: z.string().min(1).max(500),
  evidence: z.array(evidenceQuoteSchema).max(2).default([]),
});

export const studyStepSchema = z.object({
  topic: z.string().min(1).max(80),
  why: z.string().min(1).max(500),
  actions: z.array(z.string().min(1).max(200)).min(1).max(4),
  suggestedProblems: z.array(z.string().min(1).max(60)).max(4).default([]),
});

/** Exact shape the `report` gateway task must return (Zod-validated). */
export const llmReportSchema = z.object({
  summary: z.string().min(20).max(2000),
  dimensions: z.object({
    optimisation: llmDimensionSchema,
    communication: llmDimensionSchema,
    resume_depth: llmDimensionSchema,
  }),
  weakTopics: z.array(weakTopicSchema).max(8).default([]),
  studyPlan: z.array(studyStepSchema).min(1).max(8),
});

/** One merged dimension in the final report. */
export const reportDimensionSchema = z.object({
  key: z.enum(DIMENSION_KEYS),
  label: z.string(),
  weight: z.number(),
  /** null = insufficient data (spec §4.10). */
  score: z.number().min(0).max(100).nullable(),
  /** Where the score came from: executed results vs model judgement. */
  scoreSource: z.enum(['deterministic', 'llm']),
  assessment: z.string(),
  evidence: z.array(evidenceQuoteSchema).default([]),
  /** True when no verifiable evidence backs the claims. */
  insufficientData: z.boolean().default(false),
  /** Claims whose quotes could not be verified are flagged, not dropped. */
  inference: z.boolean().default(false),
});

export const dsaResultSchema = z.object({
  slug: z.string(),
  title: z.string(),
  passRate: z.number().min(0).max(100).nullable(),
  hintsUsed: z.number(),
  approachAttempts: z.number(),
  unlocked: z.boolean(),
  unlockReason: z.string().nullable(),
  languages: z.array(z.string()),
});

export const reportStatsSchema = z.object({
  interviewDurationMs: z.number().nullable(),
  totalTurns: z.number(),
  candidateTurns: z.number(),
  rounds: z.array(
    z.object({
      round: z.string(),
      durationMs: z.number().nullable(),
      turns: z.number(),
      assessment: z.string().nullable(),
    }),
  ),
  dsa: z.array(dsaResultSchema),
  hintsUsedTotal: z.number(),
  ats: z
    .object({
      score: z.number().nullable(),
      genuineGaps: z.array(z.string()).default([]),
    })
    .nullable(),
});

/** Stored report document (Mongo TTL + in-memory fallback, like M8 store). */
export const reportDocSchema = z.object({
  id: z.string(),
  sessionToken: z.string(),
  createdAt: z.string(),
  expiresAt: z.string(),
  summary: z.string(),
  overallScore: z.number().min(0).max(100).nullable(),
  dimensions: z.array(reportDimensionSchema).length(5),
  weakTopics: z.array(weakTopicSchema),
  studyPlan: z.array(studyStepSchema),
  stats: reportStatsSchema,
  evidenceReport: z.object({
    verifiedQuotes: z.number(),
    inferenceClaims: z.number(),
  }),
  disclaimer: z.string(),
  /** Share metadata: unguessable token, never the session id. */
  shareToken: z.string().nullable(),
  shareCreatedAt: z.string().nullable(),
  shareRevoked: z.boolean(),
});
