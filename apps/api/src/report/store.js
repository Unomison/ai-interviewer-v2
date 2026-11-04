/**
 * Milestone 10 — report store (spec §5: `reports` with unguessable share id,
 * TTL indexes on everything session-related).
 *
 * Same pattern as the M8 interview store: MongoDB with a TTL index on
 * `expiresAt`, plus an in-memory Map with lazy expiry when no database is
 * configured. Share links carry only the unguessable token — never the
 * session id (spec §5, §10).
 */
import mongoose from 'mongoose';
import { randomBytes, randomUUID } from 'node:crypto';
import { getDbStatus } from '../db.js';

export const REPORT_TTL_DAYS = 30;
/** 128-bit share tokens, hex-encoded. */
export const SHARE_TOKEN_BYTES = 16;

const reportSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    sessionToken: { type: String, required: true, index: true },
    createdAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    report: { type: Object, required: true },
    /** Unguessable share token (null until shared). */
    shareToken: { type: String, default: null, index: true, sparse: true },
    shareCreatedAt: { type: Date, default: null },
    shareRevoked: { type: Boolean, default: false },
  },
  { timestamps: false },
);
reportSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const Report = mongoose.models.Report || mongoose.model('Report', reportSchema);

const memStore = new Map(); // id -> doc
const memShareIndex = new Map(); // shareToken -> id

function useDb() {
  return getDbStatus() === 'connected';
}

function memGet(id) {
  const doc = memStore.get(id);
  if (!doc) return null;
  if (new Date(doc.expiresAt) < new Date()) {
    memStore.delete(id);
    if (doc.shareToken) memShareIndex.delete(doc.shareToken);
    return null;
  }
  return doc;
}

function clone(doc) {
  return JSON.parse(JSON.stringify(doc));
}

export function reportExpiry() {
  return new Date(Date.now() + REPORT_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/** Unguessable ≥128-bit share token. */
export function newShareToken() {
  return randomBytes(SHARE_TOKEN_BYTES).toString('hex');
}

export async function saveReport(sessionToken, report) {
  const doc = {
    id: randomUUID(),
    sessionToken,
    createdAt: new Date(),
    expiresAt: reportExpiry(),
    report: clone(report),
    shareToken: null,
    shareCreatedAt: null,
    shareRevoked: false,
  };
  if (useDb()) {
    await Report.create(doc);
    return clone(doc);
  }
  memStore.set(doc.id, clone(doc));
  return clone(doc);
}

export async function getReportBySession(sessionToken) {
  if (!sessionToken) return null;
  if (useDb()) {
    const doc = await Report.findOne({ sessionToken }).sort({ createdAt: -1 }).lean();
    if (!doc || new Date(doc.expiresAt) < new Date()) return null;
    return doc;
  }
  let best = null;
  for (const doc of memStore.values()) {
    if (doc.sessionToken !== sessionToken) continue;
    if (new Date(doc.expiresAt) < new Date()) continue;
    if (!best || new Date(doc.createdAt) > new Date(best.createdAt)) best = doc;
  }
  return best ? clone(best) : null;
}

/** Public share lookup: token only, never a session id. */
export async function getReportByShareToken(shareToken) {
  if (!shareToken) return null;
  if (useDb()) {
    const doc = await Report.findOne({ shareToken }).lean();
    if (!doc || new Date(doc.expiresAt) < new Date()) return null;
    return doc;
  }
  const id = memShareIndex.get(shareToken);
  if (!id) return null;
  return memGet(id);
}

async function setShareFields(id, patch) {
  if (useDb()) {
    return Report.findOneAndUpdate({ id }, { $set: patch }, { new: true }).lean();
  }
  const doc = memGet(id);
  if (!doc) return null;
  Object.assign(doc, clone(patch));
  memStore.set(id, doc);
  // Keep revoked tokens indexed (expiry still cleans them via memGet) so
  // lookups can honestly distinguish "revoked" (410) from "unknown" (404).
  if (doc.shareToken) memShareIndex.set(doc.shareToken, id);
  return clone(doc);
}

/** Create (or rotate) the share token for a report. Returns the token. */
export async function createShareToken(reportId) {
  const token = newShareToken();
  const doc = await setShareFields(reportId, {
    shareToken: token,
    shareCreatedAt: new Date(),
    shareRevoked: false,
  });
  return doc ? token : null;
}

/** Revoke a share link. Idempotent; returns true when the token existed. */
export async function revokeShareToken(shareToken) {
  const doc = await getReportByShareToken(shareToken);
  if (!doc) return false;
  await setShareFields(doc.id, { shareRevoked: true });
  return true;
}

/** Test helper: clear the in-memory store. */
export function _clearMemStore() {
  memStore.clear();
  memShareIndex.clear();
}
