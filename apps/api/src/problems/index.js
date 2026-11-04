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
