#!/usr/bin/env node
/**
 * Milestone 7 — pre-crawl seed script (spec Section 4.3, Stage 1).
 *
 * Warms the research KB cache for a list of companies from ANY machine with
 * network access + LLM keys (owner's laptop, CI, GitHub Actions later).
 * The on-demand path (POST /api/research) then serves these instantly.
 *
 * Requirements (fail loudly otherwise):
 *  - MONGODB_URI env var (Atlas connection string)
 *  - a real LLM key (GEMINI_API_KEY and/or GROQ_API_KEY) — the summarizer
 *    refuses mock output, so seeded KBs are never fabrications.
 *
 * Usage:
 *   MONGODB_URI='...' GEMINI_API_KEY='...' node tools/seed-research.js \
 *     --companies "Nokia,Google,Microsoft" [--role "Associate Engineer"] \
 *     [--budget-ms 60000] [--ttl-days 30]
 *
 * The same companies can be re-seeded anytime to refresh stale entries.
 */
import mongoose from 'mongoose';

const args = process.argv.slice(2);
function flag(name, def = null) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
}

const companies = (flag('--companies') || '')
  .split(',')
  .map((c) => c.trim())
  .filter(Boolean);
const role = flag('--role') || '';
const budgetMs = parseInt(flag('--budget-ms') || '60000', 10);
const ttlDays = parseInt(flag('--ttl-days') || '30', 10);

if (companies.length === 0) {
  console.error('Usage: node tools/seed-research.js --companies "Nokia,Google" [--role "..."]');
  process.exit(2);
}
if (!process.env.MONGODB_URI) {
  console.error('MONGODB_URI is required (Atlas connection string).');
  process.exit(2);
}

// Import AFTER arg checks so usage errors don't pay import cost.
const { connectDb, disconnectDb } = await import('../apps/api/src/db.js');
const { researchCompany } = await import('../apps/api/src/research/index.js');
const { setCachedKb } = await import('../apps/api/src/research/cache.js');

const logger = { info: console.log, warn: console.warn, error: console.error };
const status = await connectDb(process.env.MONGODB_URI, logger);
if (status !== 'connected') {
  console.error(`Could not connect to MongoDB (status: ${status}).`);
  process.exit(1);
}

// Seed path reuses the on-demand orchestrator but overrides the cache
// write so the requested TTL applies, and treats non-fresh outcomes as
// failures worth reporting (never cache partials here either).
let ok = 0;
for (const company of companies) {
  const started = Date.now();
  try {
    const result = await researchCompany({
      company,
      role,
      budgetMs,
      setCachedKb: (c, r, kb) => setCachedKb(c, r, kb, ttlDays),
    });
    if (result.source === 'fresh' && result.kb) {
      ok += 1;
      console.log(
        JSON.stringify({
          company,
          action: 'seeded',
          pages: result.pages.length,
          angles: result.kb.interviewAngles?.length ?? 0,
          ms: Date.now() - started,
        }),
      );
    } else {
      console.log(
        JSON.stringify({
          company,
          action: 'skipped',
          source: result.source,
          note: result.note || null,
          ms: Date.now() - started,
        }),
      );
    }
  } catch (err) {
    // Mock-mode refusal lands here: keys missing. Loud, by design.
    console.log(JSON.stringify({ company, action: 'error', error: err.message }));
    if (/no keys/i.test(err.message)) {
      console.error('Aborting: summarization needs a real LLM key (mock output is never seeded).');
      await disconnectDb();
      process.exit(1);
    }
  }
}

await disconnectDb();
console.log(JSON.stringify({ done: true, seeded: ok, total: companies.length }));
process.exit(ok === companies.length ? 0 : 1);
