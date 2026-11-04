/**
 * Shared Zod schemas — single source of truth for API contracts.
 *
 * Spec Section 3: request/response contracts live in shared JSON schemas,
 * validated with Zod (Node) and Pydantic (Python tools). The Python mirror
 * arrives with the offline tooling; both must validate the same shapes.
 *
 * Milestone 1 ships only the smallest useful starting example:
 * guestSession (spec Section 5 — no users collection, guests only).
 */
import { z } from 'zod';

/**
 * A guest session: opaque, unguessable token + expiry.
 * TTL indexes on expiresAt auto-delete session data (spec Section 2/5).
 */
export const guestSessionSchema = z.object({
  /** Opaque session token — random and unguessable, never sequential. */
  token: z.string().min(32).max(128),
  /** When the session (and its TTL-managed data) expires. */
  expiresAt: z.coerce.date(),
  /** Client preferences, e.g. { audio: true, transcriptVisible: true }. */
  preferences: z
    .object({
      audio: z.boolean().default(true),
      transcriptVisible: z.boolean().default(true),
    })
    .default({}),
  createdAt: z.coerce.date().default(() => new Date()),
});

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  db: z.enum(['connected', 'not_configured', 'unreachable']),
  time: z.string().datetime(),
});

export const errorResponseSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
});

/**
 * Milestone 6 — canonical DSA problem schema.
 *
 * Single source of truth for every problem in the bank (spec §4.4/§4.9):
 * the offline pipeline validates candidate problems against this, and the
 * emit stage derives the client-safe projection via toClientProblem().
 * Reference/oracle/wrong solutions NEVER leave the pipeline — they are
 * stripped before anything reaches a client bundle, the API fallback file,
 * or Mongo (the API serves only the client projection).
 */
export const PROBLEM_TYPES = [
  'int', 'float', 'bool', 'string',
  'int[]', 'float[]', 'bool[]', 'string[]',
  'int[][]', 'float[][]',
];

export const problemParamSchema = z.object({
  name: z.string().min(1).max(64),
  type: z.enum(PROBLEM_TYPES),
});

export const problemTestSchema = z.object({
  /** Positional args for solve(...); length must equal params.length. */
  args: z.array(z.unknown()),
  expected: z.unknown(),
  hidden: z.boolean(),
});

export const problemExampleSchema = z.object({
  input: z.string().min(1),
  output: z.string().min(1),
});

const solutionMapSchema = z.object({
  javascript: z.string().min(1),
  python: z.string().min(1),
  cpp: z.string().min(1),
});

export const problemSchema = z
  .object({
    /** URL-safe unique id, e.g. "two-sum". */
    slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'slug must be kebab-case'),
    title: z.string().min(1).max(120),
    /** Own wording (never scraped) in markdown. */
    statement: z.string().min(20),
    examples: z.array(problemExampleSchema).min(1).max(6),
    constraints: z.array(z.string().min(1)).min(1).max(12),
    functionName: z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/).default('solve'),
    params: z.array(problemParamSchema).min(1).max(6),
    returnType: z.enum(PROBLEM_TYPES),
    comparison: z.enum(['exact', 'float', 'unordered']).default('exact'),
    floatTolerance: z.number().positive().optional(),
    topics: z.array(z.string().min(1)).min(1).max(8),
    difficulty: z.enum(['easy', 'medium']),
    /** Calibrated base time limit (ms); the runner applies per-language multipliers. */
    timeLimitMs: z.number().int().positive().max(60000).default(2000),
    memoryMb: z.number().int().positive().max(256).default(64),
    tests: z.array(problemTestSchema).min(6).max(16),
    signatures: z.object({
      javascript: z.string().min(1),
      python: z.string().min(1),
      cpp: z.string().min(1),
    }),
    starter: z
      .object({
        javascript: z.string().min(1),
        python: z.string().min(1),
        cpp: z.string().min(1),
      })
      .optional(),
    hints: z.array(z.string().min(1)).max(5).default([]),
    /** Pipeline-only: optimal reference solutions, one per language. */
    reference: solutionMapSchema,
    /** Pipeline-only: independently-written solution that must agree with reference. */
    oracle: z.object({
      language: z.enum(['javascript', 'python', 'cpp']),
      code: z.string().min(1),
      note: z.string().max(280).optional(),
    }),
    /** Pipeline-only: plausible buggy solution that must FAIL at least one test. */
    wrong: z.object({
      language: z.enum(['javascript', 'python', 'cpp']),
      code: z.string().min(1),
      note: z.string().min(1).max(280),
    }),
    /** Provenance, e.g. "classic:two-sum (own wording)". */
    source: z.string().max(200).optional(),
  })
  .superRefine((p, ctx) => {
    const visible = p.tests.filter((t) => !t.hidden).length;
    const hidden = p.tests.filter((t) => t.hidden).length;
    if (visible < 3) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `need >=3 visible tests, got ${visible}`, path: ['tests'] });
    }
    if (hidden < 3) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `need >=3 hidden tests, got ${hidden}`, path: ['tests'] });
    }
    p.tests.forEach((t, i) => {
      if (t.args.length !== p.params.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `test ${i}: ${t.args.length} args but ${p.params.length} params`,
          path: ['tests', i, 'args'],
        });
      }
    });
    if (p.comparison === 'float' && p.floatTolerance === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'float comparison needs floatTolerance', path: ['floatTolerance'] });
    }
  });

/**
 * Client-safe projection of a canonical problem: everything the browser or
 * API consumers may see. Strips reference/oracle/wrong solutions and
 * pipeline-only metadata. `id` aliases `slug` for the playground, which
 * predates the canonical schema.
 */
export function toClientProblem(p) {
  const {
    reference: _ref,
    oracle: _oracle,
    wrong: _wrong,
    source: _source,
    ...client
  } = p;
  return { ...client, id: p.slug };
}

/** Fields the API/DB layer must never store or serve (defence in depth). */
export const PROBLEM_SOLUTION_FIELDS = ['reference', 'oracle', 'wrong'];
