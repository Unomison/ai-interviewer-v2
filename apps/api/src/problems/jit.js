/**
 * Milestone 10 — just-in-time problems (spec §4.9 "Just-in-time (JIT) problems").
 *
 * When the planner wants a topic the bank does not cover:
 *  1. The server asks the LLM for a structured problem (statement, tests,
 *     reference + wrong solutions) via the `problem_gen` gateway task.
 *  2. The VISITOR'S BROWSER runs the validation in the real in-browser
 *     runners (JS/Python, C++ when the toolchain is loaded) and posts back
 *     a receipt — the server never executes this code (spec §4.9).
 *  3. The problem is used for this session only, with the time limit
 *     derived from the measured reference runtime × a safety factor.
 *  4. If validation fails or times out, the planner falls back to the
 *     closest bank problem — and says so honestly.
 *  5. A visitor can never write into the shared bank: validated JIT
 *     problems live in a session-scoped draft store, and every attempt is
 *     logged to `wanted_problems` for the next offline pipeline run.
 *
 * Security note: the JIT draft (including reference/wrong solutions) is
 * sent to the browser ONLY for validation, before the candidate ever sees
 * the problem, and only within their own session. This is a deliberate,
 * documented exception to the "never serve solutions" rule — the
 * alternative (server-side execution) is forbidden by the spec, and this
 * is a practice tool, not a contest.
 */
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { gateway } from '../llm/index.js';
import { getDbStatus } from '../db.js';
import { problemSchema, toClientProblem } from '@ai-interviewer/schemas';
import { listProblems } from './index.js';
import { getSession } from '../interview/store.js';

/** Safety factor: time limit = measured reference runtime × this. */
export const JIT_SAFETY_FACTOR = 5;
export const JIT_MIN_TIME_LIMIT_MS = 2000;
export const JIT_MAX_TIME_LIMIT_MS = 30000;
/** Drafts expire quickly — they are session-scoped and single-use. */
export const JIT_DRAFT_TTL_HOURS = 24;

function normTokens(s) {
  return String(s || '')
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .filter((t) => t.length > 2);
}

/** Token overlap between a topic phrase and a bank problem. */
export function topicOverlap(topic, problem) {
  const want = new Set(normTokens(topic));
  if (want.size === 0) return 0;
  const hay = new Set([
    ...(problem.topics || []).flatMap(normTokens),
    ...normTokens(problem.title),
  ]);
  let n = 0;
  for (const t of want) if (hay.has(t)) n += 1;
  return n;
}

/**
 * Does the bank cover this topic at the wanted difficulty?
 * Pure over a problem list — unit tested.
 */
export function bankCoversTopic(problems, topic, difficulty) {
  return problems.some((p) => p.difficulty === difficulty && topicOverlap(topic, p) > 0);
}

/**
 * Deterministic fallback: closest bank problem by topic overlap, then
 * difficulty match, then slug (fully deterministic, unit-tested).
 */
export function findClosestBankProblem(problems, topic, difficulty) {
  const ranked = problems
    .map((p) => ({
      p,
      overlap: topicOverlap(topic, p),
      diffMatch: p.difficulty === difficulty ? 1 : 0,
    }))
    .sort(
      (a, b) =>
        b.overlap - a.overlap ||
        b.diffMatch - a.diffMatch ||
        (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
    );
  return ranked.length > 0 ? ranked[0].p : null;
}

/**
 * Planner trigger (spec §4.9): the top gap skill with ZERO bank coverage
 * becomes a JIT candidate. Returns { topic, difficulty } or null.
 * Pure over a problem list — unit tested.
 */
export function findJitCandidate({ gapSkills = [], seniority = 'new-grad', problems = [] } = {}) {
  const pool = seniority === 'mid' || seniority === 'senior' ? ['easy', 'medium'] : ['easy'];
  for (const gap of gapSkills || []) {
    const topic = String(gap).trim();
    if (!topic) continue;
    const covered = pool.some((d) => bankCoversTopic(problems, topic, d));
    if (!covered) return { topic, difficulty: pool[pool.length - 1] };
  }
  return null;
}

/* --- Draft store: session-scoped, Mongo TTL + in-memory fallback --- */

const draftSchema = new mongoose.Schema(
  {
    jitId: { type: String, required: true, unique: true },
    sessionToken: { type: String, required: true, index: true },
    topic: { type: String, required: true },
    difficulty: { type: String, required: true },
    draft: { type: Object, required: true },
    createdAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    validated: { type: Boolean, default: false },
  },
  { timestamps: false },
);
draftSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const JitDraft = mongoose.models.JitDraft || mongoose.model('JitDraft', draftSchema);
const memDrafts = new Map();

function useDb() {
  return getDbStatus() === 'connected';
}

function draftExpiry() {
  return new Date(Date.now() + JIT_DRAFT_TTL_HOURS * 60 * 60 * 1000);
}

async function storeDraft({ sessionToken, topic, difficulty, draft }) {
  const doc = {
    jitId: randomUUID(),
    sessionToken,
    topic,
    difficulty,
    draft,
    createdAt: new Date(),
    expiresAt: draftExpiry(),
    validated: false,
  };
  if (useDb()) {
    await JitDraft.create(doc);
    return doc.jitId;
  }
  memDrafts.set(doc.jitId, JSON.parse(JSON.stringify(doc)));
  return doc.jitId;
}

async function getDraft(jitId) {
  if (!jitId) return null;
  if (useDb()) {
    const doc = await JitDraft.findOne({ jitId }).lean();
    if (!doc || new Date(doc.expiresAt) < new Date()) return null;
    return doc;
  }
  const doc = memDrafts.get(jitId);
  if (!doc || new Date(doc.expiresAt) < new Date()) {
    memDrafts.delete(jitId);
    return null;
  }
  return doc;
}

async function markDraftValidated(jitId) {
  if (useDb()) {
    await JitDraft.findOneAndUpdate({ jitId }, { $set: { validated: true } });
    return;
  }
  const doc = memDrafts.get(jitId);
  if (doc) {
    doc.validated = true;
    memDrafts.set(jitId, doc);
  }
}

/* --- wanted_problems log (feeds the next offline pipeline run) --- */

const wantedSchema = new mongoose.Schema(
  {
    topic: { type: String, required: true },
    difficulty: { type: String, required: true },
    sessionToken: { type: String, default: null },
    outcome: { type: String, required: true }, // generated | validated | failed | fallback | budget_exhausted
    detail: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false },
);
const WantedProblem =
  mongoose.models.WantedProblem || mongoose.model('WantedProblem', wantedSchema);
const memWanted = [];

export async function logWantedProblem(entry) {
  const doc = { ...entry, createdAt: new Date() };
  if (useDb()) {
    try {
      await WantedProblem.create(doc);
    } catch {
      /* never break the interview over bookkeeping */
    }
    return;
  }
  memWanted.push(JSON.parse(JSON.stringify(doc)));
}

/** Test helper. */
export function _clearJitStores() {
  memDrafts.clear();
  memWanted.length = 0;
}
/** Test helper. */
export function _wantedLog() {
  return memWanted.slice();
}

/* --- Generation --- */

function buildJitPrompt(topic, difficulty) {
  return [
    'You are designing a coding-interview practice problem. Output ONLY JSON matching the required schema.',
    '',
    `Topic: ${topic}. Difficulty: ${difficulty} (easy = solvable in 10-15 min, medium = 20-30 min).`,
    '',
    'Rules:',
    '- Write the statement in your OWN words (never copy LeetCode/GFG text).',
    '- tests: at least 3 visible and 3 hidden; include edge cases (empty/single-element/boundary) and one larger input.',
    '- args are positional JSON values for solve(...); expected is the exact expected return value.',
    '- comparison: "exact" for ints/bools/strings, "unordered" when output order does not matter, "float" with floatTolerance for floats.',
    '- reference: optimal solution in all three languages. C++ must define solve(...) at global scope, must NOT define main, may use #include <bits/stdc++.h>.',
    '- oracle: a DIFFERENT, independently-written solution in ONE language — it must produce identical outputs.',
    '- wrong: a PLAUSIBLE buggy solution (off-by-one, missed edge case) that fails at least one of your tests; explain the bug in note.',
    '- Keep code short and dependency-free (no imports beyond the standard library / STL).',
    '- hints: exactly 3 progressive hints (nudge, strategy, near-solution).',
  ].join('\n');
}

function gwOf(deps) {
  return (deps && deps.gateway) || gateway;
}

/**
 * Request a JIT problem. Never throws on bad input; returns a result object.
 *
 * Outcomes:
 *  - { ok, source: 'bank', problem }            — bank already covers it
 *  - { ok, source: 'jit-draft', jitId, draft }  — validate in browser, then POST /jit/validate
 *  - { ok, source: 'bank-fallback', problem, reason } — generation/budget failed, honest fallback
 *  - { ok: false, error, message }              — bad input / unknown session
 */
export async function requestJitProblem(input, deps = {}) {
  const { sessionToken, topic, difficulty = 'easy' } = input || {};
  if (!sessionToken || typeof sessionToken !== 'string') {
    return { ok: false, error: 'invalid_request', message: 'sessionToken is required.' };
  }
  if (!topic || typeof topic !== 'string' || !topic.trim()) {
    return { ok: false, error: 'invalid_request', message: 'topic is required.' };
  }
  if (!['easy', 'medium'].includes(difficulty)) {
    return { ok: false, error: 'invalid_request', message: 'difficulty must be easy or medium.' };
  }
  const session = await getSession(sessionToken);
  if (!session) return { ok: false, error: 'session_not_found', message: 'No interview session found.' };

  const listFn = (deps && deps.listProblems) || listProblems;
  const { problems } = await listFn();
  const cleanTopic = topic.trim().slice(0, 80);

  // 1. Bank already covers it — no LLM call burned.
  if (bankCoversTopic(problems, cleanTopic, difficulty)) {
    const best = findClosestBankProblem(
      problems.filter((p) => p.difficulty === difficulty),
      cleanTopic,
      difficulty,
    );
    return { ok: true, source: 'bank', problem: toClientProblem(best) };
  }

  // 2. Budget check before spending a call.
  const gw = gwOf(deps);
  const budget = gw.budgetAllows ? gw.budgetAllows('problem_gen') : { allowed: true };
  if (!budget.allowed) {
    const fallback = findClosestBankProblem(problems, cleanTopic, difficulty);
    await logWantedProblem({
      topic: cleanTopic, difficulty, sessionToken,
      outcome: 'budget_exhausted', detail: budget.reason || 'LLM budget exhausted',
    });
    return {
      ok: true, source: 'bank-fallback', problem: fallback ? toClientProblem(fallback) : null,
      reason: 'LLM quota exhausted — using the closest bank problem instead.',
    };
  }

  // 3. Generate the draft.
  try {
    const res = await gw.generate({
      task: 'problem_gen',
      prompt: buildJitPrompt(cleanTopic, difficulty),
      schema: problemSchema,
    });
    if (res.provider === 'mock') throw new Error('mock mode: refusing to emit mock problems');
    const jitId = await storeDraft({ sessionToken, topic: cleanTopic, difficulty, draft: res.data });
    await logWantedProblem({ topic: cleanTopic, difficulty, sessionToken, outcome: 'generated', detail: jitId });
    return { ok: true, source: 'jit-draft', jitId, draft: res.data };
  } catch (err) {
    const fallback = findClosestBankProblem(problems, cleanTopic, difficulty);
    await logWantedProblem({
      topic: cleanTopic, difficulty, sessionToken,
      outcome: 'failed', detail: (err && err.message) || 'generation failed',
    });
    return {
      ok: true, source: 'bank-fallback', problem: fallback ? toClientProblem(fallback) : null,
      reason: `Could not generate a validated problem (${(err && err.message) || 'generation failed'}) — using the closest bank problem instead.`,
    };
  }
}

/* --- Validation (browser receipt assessment — pure) --- */

/**
 * Assess the browser's validation receipt (M6 trust bar, compressed):
 *  - reference must pass ALL tests (≥6 total)
 *  - wrong solution must fail ≥1 test
 *  - measured runtimes must be plausible
 * Pure — unit tested.
 */
export function assessJitReceipt(receipt) {
  const issues = [];
  const r = receipt || {};
  if (typeof r.referenceTotal !== 'number' || r.referenceTotal < 6) {
    issues.push('fewer than 6 reference tests were run');
  }
  if (r.referencePassed !== r.referenceTotal) {
    issues.push(`reference passed ${r.referencePassed}/${r.referenceTotal}`);
  }
  if (typeof r.wrongFailed !== 'number' || r.wrongFailed < 1) {
    issues.push('wrong solution failed 0 tests (it must fail at least one)');
  }
  const runtimes = Array.isArray(r.referenceRuntimesMs) ? r.referenceRuntimesMs : [];
  if (runtimes.length === 0 || !runtimes.every((ms) => typeof ms === 'number' && ms > 0 && ms < 60000)) {
    issues.push('implausible reference runtimes');
  }
  return { ok: issues.length === 0, issues };
}

/**
 * Time limit = measured reference runtime × safety factor, clamped.
 * Spec §4.9: "the time limit derived from the measured reference runtime
 * times a safety factor". Pure — unit tested.
 */
export function deriveTimeLimitMs(runtimesMs) {
  const max = Math.max(...runtimesMs);
  return Math.min(JIT_MAX_TIME_LIMIT_MS, Math.max(JIT_MIN_TIME_LIMIT_MS, Math.ceil(max * JIT_SAFETY_FACTOR)));
}

/**
 * Submit the browser validation receipt for a JIT draft.
 *  - valid → session-scoped problem served (client projection only)
 *  - invalid → honest fallback to the closest bank problem
 * Never serves an unvalidated JIT problem.
 */
export async function submitJitValidation(input, deps = {}) {
  const { sessionToken, jitId, receipt } = input || {};
  if (!sessionToken || !jitId || !receipt || typeof receipt !== 'object') {
    return { ok: false, error: 'invalid_request', message: 'sessionToken, jitId and receipt are required.' };
  }
  const session = await getSession(sessionToken);
  if (!session) return { ok: false, error: 'session_not_found', message: 'No interview session found.' };
  const draftDoc = await getDraft(jitId);
  if (!draftDoc || draftDoc.sessionToken !== sessionToken) {
    return { ok: false, error: 'jit_not_found', message: 'Unknown or expired JIT draft.' };
  }

  const assessment = assessJitReceipt(receipt);
  const listFn = (deps && deps.listProblems) || listProblems;
  const { problems } = await listFn();

  if (!assessment.ok) {
    const fallback = findClosestBankProblem(problems, draftDoc.topic, draftDoc.difficulty);
    await logWantedProblem({
      topic: draftDoc.topic, difficulty: draftDoc.difficulty, sessionToken,
      outcome: 'failed', detail: `validation failed: ${assessment.issues.join('; ')}`,
    });
    return {
      ok: true, source: 'bank-fallback',
      problem: fallback ? toClientProblem(fallback) : null,
      reason: `The generated problem failed browser validation (${assessment.issues.join('; ')}) — using the closest bank problem instead.`,
    };
  }

  const timeLimitMs = deriveTimeLimitMs(receipt.referenceRuntimesMs);
  await markDraftValidated(jitId);
  await logWantedProblem({
    topic: draftDoc.topic, difficulty: draftDoc.difficulty, sessionToken,
    outcome: 'validated', detail: `timeLimitMs=${timeLimitMs}`,
  });
  const problem = {
    ...toClientProblem(draftDoc.draft),
    timeLimitMs,
    jit: true,
    jitId,
  };
  return { ok: true, source: 'jit', problem };
}
