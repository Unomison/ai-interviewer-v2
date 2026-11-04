/**
 * Milestone 6 — problem bank serving.
 *
 * Mongo-first with a bundled-JSON fallback (spec §4.9: the bank is versioned
 * and seeded via tools/seed-problems.js; the API must keep working when the
 * database is unavailable, e.g. local dev without Mongo).
 *
 * Only client-safe fields are ever served: solutions (reference/oracle/wrong)
 * are stripped via the shared toClientProblem(). Hidden tests are included —
 * the client needs them to judge submissions; the "hidden" flag only controls
 * display, not availability (same as the current playground).
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { toClientProblem } from '../../../../packages/schemas/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Bundled fallback emitted by the pipeline: apps/api/data/problems.client.json
const BUNDLED = path.resolve(HERE, '..', '..', 'data', 'problems.client.json');

let bundledCache = null;
function loadBundled() {
  if (bundledCache) return bundledCache;
  if (!existsSync(BUNDLED)) return { version: null, problems: [] };
  const raw = JSON.parse(readFileSync(BUNDLED, 'utf8'));
  // Pipeline emits { version, count, problems: [...] }
  bundledCache = {
    version: raw.version || null,
    problems: Array.isArray(raw.problems) ? raw.problems : [],
  };
  return bundledCache;
}

function problemModel() {
  if (mongoose.connection.readyState !== 1) return null;
  if (mongoose.models.Problem) return mongoose.models.Problem;
  const schema = new mongoose.Schema(
    { slug: String, bankVersion: String, data: mongoose.Schema.Types.Mixed },
    { collection: 'problems' }
  );
  return mongoose.model('Problem', schema);
}

/**
 * List client-safe problems. Source: "mongo" when the DB is connected and has
 * a seeded bank, otherwise "bundled".
 */
export async function listProblems() {
  const Model = problemModel();
  if (Model) {
    try {
      const docs = await Model.find({}).lean();
      if (docs.length > 0) {
        return {
          source: 'mongo',
          version: docs[0].bankVersion,
          problems: docs.map((d) => toClientProblem(d.data)),
        };
      }
    } catch {
      // Fall through to bundled on any DB error — never break the playground.
    }
  }
  const bundled = loadBundled();
  return { source: 'bundled', version: bundled.version, problems: bundled.problems };
}

/**
 * Get one client-safe problem by slug.
 */
export async function getProblem(slug) {
  const { problems } = await listProblems();
  return problems.find((p) => p.slug === slug) || null;
}

// Full bank (WITH solutions) for server-side use only — the approach judge
// needs the reference solution. Mongo stores the full document in `data`;
// the repo-root data/problems.json is the full bank file.
const FULL_BANK = path.resolve(HERE, '..', '..', '..', '..', 'data', 'problems.json');
let fullBankCache = null;
function loadFullBank() {
  if (fullBankCache) return fullBankCache;
  if (!existsSync(FULL_BANK)) return [];
  try {
    const raw = JSON.parse(readFileSync(FULL_BANK, 'utf8'));
    fullBankCache = Array.isArray(raw.problems) ? raw.problems : [];
  } catch {
    fullBankCache = [];
  }
  return fullBankCache;
}

/**
 * Get the FULL problem (including reference/oracle/wrong solutions and the
 * complete hint ladder) by slug. SERVER-SIDE ONLY — never send this to a
 * client. Used by the M8 approach judge.
 */
export async function getFullProblem(slug) {
  const Model = problemModel();
  if (Model) {
    try {
      const doc = await Model.findOne({ slug }).lean();
      if (doc?.data) return doc.data;
    } catch {
      // Fall through to the bundled full bank.
    }
  }
  return loadFullBank().find((p) => p.slug === slug) || null;
}

/**
 * Client-safe projection for the INTERVIEW (stricter than toClientProblem):
 * the full precomputed hint ladder is stripped — hints are served one at a
 * time by POST /api/interview/approach. Solutions are already stripped by
 * toClientProblem; this additionally removes `hints`.
 */
export function toClientSafeDsaProblem(full) {
  if (!full) return null;
  const client = toClientProblem(full);
  const { hints: _hints, ...rest } = client;
  return rest;
}
