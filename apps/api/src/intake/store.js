/**
 * Intake session store (Milestone 3, spec Sections 2 + 10).
 *
 * Guest sessions live in MongoDB with a TTL index on `expiresAt` — session
 * data auto-deletes, per the spec's privacy rules. When no database is
 * configured (local dev / CI), an in-memory Map with lazy expiry keeps the
 * API fully working (graceful degradation, same spirit as M1).
 *
 * Stored per session: consent record, resume.json, jd.json, redacted text
 * (needed for ATS), company/role/seniority. The RAW uploaded file is NEVER
 * stored — it is discarded right after parsing.
 */
import mongoose from 'mongoose';
import { getDbStatus } from '../db.js';

export const SESSION_TTL_DAYS = 30;

const intakeSessionSchema = new mongoose.Schema(
  {
    token: { type: String, required: true, unique: true, index: true },
    consent: { type: Boolean, default: false },
    consentAt: { type: Date },
    noticeVersion: { type: String },
    resumeJson: { type: Object },
    jdJson: { type: Object },
    /** Redacted resume text (PII-free) — used for ATS scoring. */
    redactedText: { type: String },
    /** Raw extracted text kept ONLY for the deterministic structure check
     *  (contact-info presence). Never sent to any model. */
    rawText: { type: String },
    hadContact: { type: Boolean },
    company: { type: String, default: null },
    companySource: { type: String, enum: ['jd', 'resume', 'user', null], default: null },
    role: { type: String, default: null },
    seniority: { type: String, default: null },
    atsReport: { type: Object },
    /** TTL index: MongoDB auto-deletes the document at this time. */
    expiresAt: { type: Date, required: true },
  },
  { timestamps: false },
);
// TTL index — the privacy guarantee. expireAfterSeconds: 0 deletes exactly at expiresAt.
intakeSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const IntakeSession =
  mongoose.models.IntakeSession || mongoose.model('IntakeSession', intakeSessionSchema);

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

export function sessionExpiry() {
  return new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export async function createSession({ token, consent, noticeVersion }) {
  const doc = {
    token,
    consent,
    consentAt: new Date(),
    noticeVersion,
    expiresAt: sessionExpiry(),
  };
  if (useDb()) {
    await IntakeSession.create(doc);
    return doc;
  }
  memStore.set(token, { ...doc });
  return doc;
}

export async function getSession(token) {
  if (!token) return null;
  if (useDb()) {
    const doc = await IntakeSession.findOne({ token }).lean();
    if (!doc) return null;
    if (doc.expiresAt < new Date()) {
      await IntakeSession.deleteOne({ token });
      return null;
    }
    return doc;
  }
  return memGet(token);
}

export async function updateSession(token, patch) {
  if (useDb()) {
    await IntakeSession.updateOne({ token }, { $set: patch });
    return getSession(token);
  }
  const doc = memGet(token);
  if (!doc) return null;
  memStore.set(token, { ...doc, ...patch });
  return memStore.get(token);
}

export async function deleteSession(token) {
  if (useDb()) {
    await IntakeSession.deleteOne({ token });
    return;
  }
  memStore.delete(token);
}

/** Exported for tests: assert the TTL index exists without a live database. */
export function getTtlIndexes() {
  return intakeSessionSchema.indexes();
}
