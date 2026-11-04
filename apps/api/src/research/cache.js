/**
 * Milestone 7 — research KB cache (spec Section 4.3, ADR 008).
 *
 * MongoDB collection with a TTL index (same pattern as M3's intake store):
 * company facts change slowly, so entries live RESEARCH_TTL_DAYS (default
 * 30 — cheap, and a stale KB only mildly degrades the planner; the visitor
 * can always re-run research). When no database is configured (local dev /
 * CI), an in-memory Map with lazy expiry keeps the API fully working.
 *
 * Cache key: normalized `company|role` — case/whitespace-insensitive so
 * "  Nokia " and "nokia" hit the same entry. Only `fresh` KBs are cached;
 * partial/failed runs are never stored.
 */
import mongoose from 'mongoose';
import { getDbStatus } from '../db.js';

export const RESEARCH_TTL_DAYS = 30;

/** Normalize the cache key: "  Nokia " + "SDE" -> "nokia|sde". */
export function cacheKey(company, role = '') {
  const c = String(company || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const r = String(role || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return `${c}|${r}`;
}

const researchKbSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    company: { type: String, required: true },
    role: { type: String, default: '' },
    /** The validated KB JSON document. */
    kb: { type: Object, required: true },
    /** TTL index: MongoDB auto-deletes the document at this time. */
    expiresAt: { type: Date, required: true },
  },
  { timestamps: false },
);
researchKbSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const ResearchKb =
  mongoose.models.ResearchKb || mongoose.model('ResearchKb', researchKbSchema);

// In-memory fallback (no DB configured): Map<key, doc> with lazy expiry.
const memStore = new Map();

function useDb() {
  return getDbStatus() === 'connected';
}

export function kbExpiry(ttlDays = RESEARCH_TTL_DAYS) {
  return new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
}

/** @returns {Promise<object|null>} the cached KB document, or null. */
export async function getCachedKb(company, role = '') {
  const key = cacheKey(company, role);
  if (useDb()) {
    const doc = await ResearchKb.findOne({ key }).lean();
    if (!doc) return null;
    if (doc.expiresAt < new Date()) return null; // TTL sweeper may lag
    return doc;
  }
  const doc = memStore.get(key);
  if (!doc) return null;
  if (doc.expiresAt < new Date()) {
    memStore.delete(key);
    return null;
  }
  return doc;
}

/** Store a FRESH kb only. @returns {Promise<object>} the stored doc. */
export async function setCachedKb(company, role, kb, ttlDays = RESEARCH_TTL_DAYS) {
  const key = cacheKey(company, role);
  const doc = {
    key,
    company: String(company).trim(),
    role: String(role || '').trim(),
    kb,
    expiresAt: kbExpiry(ttlDays),
  };
  if (useDb()) {
    await ResearchKb.findOneAndUpdate({ key }, doc, { upsert: true });
    return doc;
  }
  memStore.set(key, doc);
  return doc;
}

/** Test hook: clear the in-memory fallback. */
export function _clearMemCache() {
  memStore.clear();
}
