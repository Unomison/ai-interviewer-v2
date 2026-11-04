/**
 * Milestone 8 — Zod schemas for the interview engine (spec Sections 4.4–4.6).
 *
 * Round order is fixed by ADR 002 decision 5:
 *   intro → resume → dsa → cs → behavioral → closing → done
 * The planner LLM fills per-round *content*; code enforces the order and
 * picks DSA problem slugs deterministically (no LLM needed for that).
 */
import { z } from 'zod';

/** Canonical round order (ADR 002). 'done' is terminal, not a round. */
export const ROUND_ORDER = ['intro', 'resume', 'dsa', 'cs', 'behavioral', 'closing'];

/**
 * Per-round content produced by ONE `planner` gateway call. Order is NOT
 * taken from the model — assemblePlan() lays these out in ROUND_ORDER.
 */
export const planContentSchema = z.object({
  intro: z
    .object({ goals: z.array(z.string().max(200)).max(4).default([]) })
    .default({}),
  resume: z
    .object({
      focusAreas: z
        .array(
          z.object({
            project: z.string().min(1).max(160),
            angle: z.string().min(1).max(300),
          }),
        )
        .max(4)
        .default([]),
      numQuestions: z.number().int().min(2).max(4).default(3),
    })
    .default({}),
  dsa: z.object({ notes: z.string().max(500).default('') }).default({}),
  cs: z
    .object({ topics: z.array(z.string().min(1).max(80)).max(6).default([]) })
    .default({}),
  behavioral: z
    .object({ themes: z.array(z.string().min(1).max(120)).max(4).default([]) })
    .default({}),
  closing: z
    .object({ goals: z.array(z.string().max(200)).max(4).default([]) })
    .default({}),
});

/**
 * One interviewer turn (spec §4.5 persona rules are in the prompt).
 * The model may end the current round (with an assessment for the report),
 * and inside the DSA round it may advance to the next problem.
 */
export const turnOutputSchema = z.object({
  message: z.string().min(1).max(1500),
  endRound: z.boolean().default(false),
  /** DSA round only: move to the next unscored problem after this message. */
  advanceProblem: z.boolean().default(false),
  roundAssessment: z
    .object({
      score: z.number().min(0).max(100),
      strengths: z.array(z.string().max(200)).max(5).default([]),
      improvements: z.array(z.string().max(200)).max(5).default([]),
      evidence: z.array(z.string().max(300)).max(5).default([]),
    })
    .nullable()
    .default(null),
});

/**
 * Approach-judge output (spec §4.6): the LLM compares the candidate's
 * explanation against the stored reference approach. `verdict` drives the
 * editor lock: accept → unlock; hint → serve next precomputed hint, stay
 * locked; clarify → ask one clarifying question, stay locked (no hint spent).
 */
export const approachJudgeSchema = z.object({
  matchesOptimal: z.boolean(),
  statedComplexity: z.string().max(120).default(''),
  keyInsightsHit: z.array(z.string().max(200)).max(8).default([]),
  keyInsightsMissed: z.array(z.string().max(200)).max(8).default([]),
  bruteForceOnly: z.boolean(),
  verdict: z.enum(['accept', 'hint', 'clarify']),
  feedback: z.string().min(1).max(600),
});

/* --- Request schemas (route layer) --- */

export const startRequestSchema = z.object({
  intakeToken: z.string().trim().min(1).max(200),
});

export const turnRequestSchema = z.object({
  sessionToken: z.string().trim().min(1).max(200),
  text: z.string().trim().min(1).max(4000),
});

export const approachRequestSchema = z.object({
  sessionToken: z.string().trim().min(1).max(200),
  problemSlug: z.string().trim().min(1).max(120),
  approachText: z.string().trim().min(1).max(4000),
});

export const dsaResultSchema = z.object({
  sessionToken: z.string().trim().min(1).max(200),
  problemSlug: z.string().trim().min(1).max(120),
  language: z.enum(['javascript', 'python', 'cpp']),
  code: z.string().min(1).max(60000),
  results: z.object({
    verdict: z.string().max(30),
    passed: z.number().int().min(0),
    total: z.number().int().min(0),
    firstFailure: z.unknown().nullable().default(null),
  }),
});

export const stateRequestSchema = z.object({
  token: z.string().trim().min(1).max(200),
});
