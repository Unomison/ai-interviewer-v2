/**
 * Milestone 8 — interview session store (spec §4.4: "Sessions are persisted
 * every transition and resumable after refresh/crash").
 *
 * Same pattern as the M3 intake store: MongoDB with a TTL index on
 * `expiresAt` (guest data auto-deletes), plus an in-memory Map with lazy
 * expiry when no database is configured (local dev / CI keep working).
 *
 * Per session we record everything the M10 report will need: the full
 * transcript, per-round assessments, DSA artifacts (approach texts, judge
 * verdicts, hints used, code submissions + test results), and timing.
 */
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { getDbStatus } from '../db.js';
import { ROUND_ORDER } from './schema.js';

export const INTERVIEW_TTL_DAYS = 30;

const turnSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ['interviewer', 'candidate', 'system'], required: true },
    text: { type: String, required: true },
    round: { type: String, required: true },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const dsaProblemSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true },
    title: { type: String, default: '' },
    /** DSA sub-state: shown → approach → coding → submitted → scored */
    state: {
      type: String,
      enum: ['shown', 'approach', 'coding', 'submitted', 'scored'],
      default: 'shown',
    },
    approachAttempts: { type: Number, default: 0 },
    hintsUsed: { type: Number, default: 0 },
    hintsGiven: { type: [String], default: [] },
    unlocked: { type: Boolean, default: false },
    /** accepted | hints-exhausted | judge-error | null */
    unlockReason: { type: String, default: null },
    judgeVerdicts: { type: [Object], default: [] },
    submissions: { type: [Object], default: [] },
    /** 0-100 once scored; null until then */
    score: { type: Number, default: null },
    startedAt: { type: Date },
    scoredAt: { type: Date },
  },
  { _id: false },
);

const interviewSessionSchema = new mongoose.Schema(
  {
    token: { type: String, required: true, unique: true },
    intakeToken: { type: String, default: null },
    status: { type: String, enum: ['active', 'done'], default: 'active' },
    /** Ordered round plan (assembled by planner.js). */
    plan: { type: [Object], default: [] },
    currentRound: { type: String, default: 'intro' },
    /** Per-round bookkeeping: status, started/ended at, assessment. */
    rounds: { type: Object, default: {} },
    transcript: { type: [turnSchema], default: [] },
    /** DSA artifacts keyed by problem slug. */
    dsa: { type: Object, default: {} },
    /** Slug of the problem currently being worked on (null outside DSA). */
    activeProblemSlug: { type: String, default: null },
    company: { type: String, default: null },
    role: { type: String, default: null },
    seniority: { type: String, default: null },
    kbSource: { type: String, default: 'none' },
    /** Milestone 11 — how the planner got company knowledge. */
    ragMode: { type: String, enum: ['vector', 'direct', 'none'], default: 'direct' },
    /** Milestone 11 — source citations for KB-grounded claims (spec §4.9 use #4). */
    ragCitations: { type: [Object], default: [] },
    startedAt: { type: Date, default: Date.now },
    endedAt: { type: Date, default: null },
    /** TTL index: MongoDB auto-deletes the document at this time. */
    expiresAt: { type: Date, required: true },
  },
  { timestamps: false },
);
interviewSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const InterviewSession =
  mongoose.models.InterviewSession ||
  mongoose.model('InterviewSession', interviewSessionSchema);

// In-memory fallback (no DB configured): Map<token, doc> with lazy expiry.
const memStore = new Map();

function useDb() {
  return getDbStatus() === 'connected';
}

function memGet(token) {
  const doc = memStore.get(token);
  if (!doc) return null;
  if (doc.expiresAt < new Date()) {
    memStore.delete(token);
    return null;
  }
  return doc;
}

function clone(doc) {
  return JSON.parse(JSON.stringify(doc));
}

export function interviewExpiry() {
  return new Date(Date.now() + INTERVIEW_TTL_DAYS * 24 * 60 * 60 * 1000);
}

function initialRounds() {
  const rounds = {};
  for (const type of ROUND_ORDER) {
    rounds[type] = { status: type === 'intro' ? 'active' : 'pending', startedAt: type === 'intro' ? new Date() : null, endedAt: null, assessment: null };
  }
  return rounds;
}

export async function createSession({ intakeToken, plan, company, role, seniority, kbSource, ragCitations = [], ragMode = 'direct' }) {
  const dsaProblems = (plan.find((r) => r.type === 'dsa')?.problems || []).map((p) => p.slug);
  const dsa = {};
  for (const slug of dsaProblems) {
    dsa[slug] = {
      slug,
      title: (plan.find((r) => r.type === 'dsa')?.problems || []).find((p) => p.slug === slug)?.title || slug,
      state: 'shown',
      approachAttempts: 0,
      hintsUsed: 0,
      hintsGiven: [],
      unlocked: false,
      unlockReason: null,
      judgeVerdicts: [],
      submissions: [],
      score: null,
      startedAt: null,
      scoredAt: null,
    };
  }
  const doc = {
    token: randomUUID(),
    intakeToken: intakeToken || null,
    status: 'active',
    plan,
    currentRound: 'intro',
    rounds: initialRounds(),
    transcript: [],
    dsa,
    activeProblemSlug: dsaProblems[0] || null,
    company: company || null,
    role: role || null,
    seniority: seniority || null,
    kbSource: kbSource || 'none',
    ragMode,
    ragCitations: Array.isArray(ragCitations) ? ragCitations : [],
    startedAt: new Date(),
    endedAt: null,
    expiresAt: interviewExpiry(),
  };
  if (useDb()) {
    await InterviewSession.create(doc);
    return clone(doc);
  }
  memStore.set(doc.token, clone(doc));
  return clone(doc);
}

export async function getSession(token) {
  if (!token) return null;
  if (useDb()) {
    const doc = await InterviewSession.findOne({ token }).lean();
    if (!doc) return null;
    if (doc.expiresAt < new Date()) return null;
    return doc;
  }
  return memGet(token);
}

/** Persist a patch (spec: persisted every transition). Returns the fresh doc. */
export async function updateSession(token, patch) {
  if (useDb()) {
    const doc = await InterviewSession.findOneAndUpdate({ token }, { $set: patch }, { new: true }).lean();
    return doc;
  }
  const doc = memGet(token);
  if (!doc) return null;
  Object.assign(doc, clone(patch));
  memStore.set(token, doc);
  return clone(doc);
}

export async function appendTurn(token, role, text, round) {
  const turn = { role, text, round, at: new Date() };
  if (useDb()) {
    const doc = await InterviewSession.findOneAndUpdate(
      { token },
      { $push: { transcript: turn } },
      { new: true },
    ).lean();
    return doc;
  }
  const doc = memGet(token);
  if (!doc) return null;
  doc.transcript.push(clone(turn));
  memStore.set(token, doc);
  return clone(doc);
}

/** Test helper: clear the in-memory store. */
export function _clearMemStore() {
  memStore.clear();
}
