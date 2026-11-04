#!/usr/bin/env node
/**
 * Milestone 6 — idempotent, versioned seed of the validated problem bank into MongoDB.
 *
 * Usage:
 *   MONGODB_URI='mongodb+srv://...' node tools/seed-problems.js [--file data/problems.json] [--dry-run]
 *
 * Semantics (migration, never edit):
 *   - The bank has a version (e.g. "1.0.0"). The script records the version it
 *     seeded in the `problem_bank_meta` collection.
 *   - Running the script with the SAME version is a no-op (idempotent).
 *   - Running with a NEWER version upserts every problem by `slug` and records
 *     the new version (a migration). Problems are never deleted.
 *   - `--dry-run` prints what would change without touching the database.
 *
 * The API serves problems from Mongo when available, falling back to the
 * bundled `apps/api/data/problems.client.json` (see apps/api/src/problems/).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const DEFAULT_BANK = path.join(REPO_ROOT, 'data', 'problems.json');

const problemSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, index: true },
    bankVersion: { type: String, required: true, index: true },
    // Full canonical problem (includes reference/oracle/wrong — never sent to clients directly).
    data: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { timestamps: true, collection: 'problems' }
);

const metaSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    bankVersion: { type: String, required: true },
    problemCount: { type: Number, required: true },
    seededAt: { type: Date, default: Date.now },
  },
  { collection: 'problem_bank_meta' }
);

function parseArgs(argv) {
  const opts = { file: DEFAULT_BANK, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--file') opts.file = path.resolve(argv[++i]);
    else if (argv[i] === '--dry-run') opts.dryRun = true;
    else throw new Error(`unknown arg: ${argv[i]}`);
  }
  return opts;
}

export async function seedProblems({ bankPath, dryRun = false, models = null } = {}) {
  const raw = readFileSync(bankPath, 'utf8');
  const bank = JSON.parse(raw);
  if (!bank.version || !Array.isArray(bank.problems)) {
    throw new Error(`invalid bank file ${bankPath}: missing version/problems`);
  }

  const Problem = models?.Problem || mongoose.model('Problem', problemSchema);
  const Meta = models?.Meta || mongoose.model('ProblemBankMeta', metaSchema);

  const existing = await Meta.findOne({ key: 'bank' }).lean();
  if (existing && existing.bankVersion === bank.version) {
    return { action: 'noop', version: bank.version, count: existing.problemCount };
  }

  const ops = bank.problems.map((p) => ({
    updateOne: {
      filter: { slug: p.slug },
      update: { $set: { slug: p.slug, bankVersion: bank.version, data: p } },
      upsert: true,
    },
  }));

  if (dryRun) {
    return { action: 'dry-run', version: bank.version, count: bank.problems.length, wouldUpsert: ops.length };
  }

  const bulk = await Problem.bulkWrite(ops, { ordered: false });
  await Meta.updateOne(
    { key: 'bank' },
    { $set: { bankVersion: bank.version, problemCount: bank.problems.length, seededAt: new Date() } },
    { upsert: true }
  );

  return {
    action: existing ? 'migrated' : 'seeded',
    from: existing?.bankVersion || null,
    version: bank.version,
    count: bank.problems.length,
    upserted: bulk.upsertedCount,
    modified: bulk.modifiedCount,
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set. Refusing to seed without an explicit database.');
    process.exit(2);
  }
  console.log(`[seed] bank file: ${opts.file}${opts.dryRun ? ' (dry run)' : ''}`);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  try {
    const result = await seedProblems({ bankPath: opts.file, dryRun: opts.dryRun });
    console.log('[seed] result:', JSON.stringify(result));
  } finally {
    await mongoose.disconnect();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('[seed] fatal:', err.message);
    process.exit(1);
  });
}
