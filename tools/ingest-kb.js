#!/usr/bin/env node
/**
 * Milestone 11 — KB ingestion CLI (spec §4.9, ADR 012).
 *
 * Chunks an M7 knowledge-base document, embeds the chunks with the gateway
 * (gemini-embedding-001 — same model as queries, enforced), and upserts them
 * into the Atlas kb_chunks collection for Vector Search.
 *
 *   MONGODB_URI='mongodb+srv://...' node tools/ingest-kb.js --company "Nokia" --role "Associate Engineer"
 *   node tools/ingest-kb.js --kb-file ./kb.json --dry-run
 *
 * Flags:
 *   --company, --role      KB to ingest (via the M7 research cache, or a fresh
 *                          research run when keys are available)
 *   --kb-file <path>       ingest a KB JSON file instead of researching
 *   --min-confidence <n>   prune chunks below this (default 0.55)
 *   --ttl-days <n>         skip re-ingest when existing chunks are younger
 *                          than this (default 30; --force overrides)
 *   --force                re-ingest even when fresh chunks exist
 *   --allow-mock           accept mock embeddings (testing only — never for
 *                          the real index; refused by default)
 *   --dry-run              chunk + report, no DB writes
 *
 * Windows-safe: the run-as-script guard compares via fileURLToPath +
 * path.resolve (see the seed-problems.js lesson — raw import.meta.url
 * comparison silently never matches on Windows).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');

const { chunkKbDocument, pruneChunks, chunksBytes, DEFAULT_MIN_CONFIDENCE } = await import(
  '../apps/api/src/rag/chunk.js'
);
const { AtlasVectorStore } = await import('../apps/api/src/rag/store.js');
const { EMBEDDING_IDENTITY, embedTexts, checkEmbeddingIdentity } = await import(
  '../apps/api/src/rag/embed.js'
);
const { researchCompany } = await import('../apps/api/src/research/index.js');
const { gateway } = await import('../apps/api/src/llm/index.js');

function parseArgs(argv) {
  const opts = {
    company: null,
    role: '',
    kbFile: null,
    minConfidence: DEFAULT_MIN_CONFIDENCE,
    ttlDays: 30,
    force: false,
    allowMock: false,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--company') opts.company = argv[++i];
    else if (a === '--role') opts.role = argv[++i];
    else if (a === '--kb-file') opts.kbFile = path.resolve(argv[++i]);
    else if (a === '--min-confidence') opts.minConfidence = Number(argv[++i]);
    else if (a === '--ttl-days') opts.ttlDays = Number(argv[++i]);
    else if (a === '--force') opts.force = true;
    else if (a === '--allow-mock') opts.allowMock = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--help' || a === '-h') {
      console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 30).join('\n'));
      process.exit(0);
    } else throw new Error(`unknown arg: ${a}`);
  }
  return opts;
}

async function loadKb(opts) {
  if (opts.kbFile) {
    return JSON.parse(readFileSync(opts.kbFile, 'utf8'));
  }
  if (!opts.company) throw new Error('give --company (and optionally --role) or --kb-file');
  console.log(`[ingest] researching "${opts.company}" / "${opts.role}" (cache-first, 60s budget)…`);
  const r = await researchCompany({ company: opts.company, role: opts.role });
  if (!r?.kb) throw new Error(`research produced no KB (outcome: ${r?.outcome || r?.source})`);
  console.log(`[ingest] KB source: ${r.outcome || r.source}`);
  return r.kb;
}

export async function ingestKb(opts) {
  const kb = await loadKb(opts);
  const company = kb.company || opts.company;
  const sourceId = `kb:${String(company).toLowerCase()}|${String(kb.role || opts.role || '').toLowerCase()}`;

  let chunks = chunkKbDocument(kb, {
    sourceId,
    embeddingModel: EMBEDDING_IDENTITY.model,
    embeddingDim: EMBEDDING_IDENTITY.dimensions,
  });
  const before = chunks.length;
  chunks = pruneChunks(chunks, opts.minConfidence);
  console.log(
    `[ingest] chunked into ${before} chunks, kept ${chunks.length} after pruning (< ${opts.minConfidence}), ` +
      `${chunksBytes(chunks)} bytes total`,
  );
  if (chunks.length === 0) throw new Error('no chunks survived pruning — nothing to ingest');

  let store = null;
  if (!opts.dryRun) {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI is not set. Refusing to ingest without an explicit database.');
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
    store = new AtlasVectorStore();
  }

  // Freshness (spec §4.9): skip when existing chunks are younger than TTL.
  if (store && !opts.force) {
    const newest = await store.newestIngestedAt(sourceId);
    if (newest) {
      const ageDays = (Date.now() - new Date(newest).getTime()) / 86_400_000;
      if (ageDays < opts.ttlDays) {
        console.log(
          `[ingest] SKIP — ${sourceId} already ingested ${ageDays.toFixed(1)}d ago (< ${opts.ttlDays}d TTL). Use --force to re-ingest.`,
        );
        await mongoose.disconnect();
        return { action: 'skipped', sourceId, ageDays };
      }
      console.log(`[ingest] existing chunks are ${ageDays.toFixed(1)}d old (TTL ${opts.ttlDays}d) — re-ingesting`);
      await store.deleteBySource(sourceId);
    }
  } else if (store && opts.force) {
    await store.deleteBySource(sourceId);
  }

  // Embed (batched) — same model as queries, enforced by checkEmbeddingIdentity.
  console.log(`[ingest] embedding ${chunks.length} chunks with ${EMBEDDING_IDENTITY.model}…`);
  const emb = await embedTexts(chunks.map((c) => c.text), gateway);
  const check = checkEmbeddingIdentity(emb);
  if (!check.ok) throw new Error(`embedding identity: ${check.reason}`);
  if (check.mock && !opts.allowMock) {
    throw new Error(
      'refusing to ingest MOCK embeddings into the index (no embedding provider configured). ' +
        'Set GEMINI_API_KEY (or use --allow-mock for a local experiment only).',
    );
  }
  chunks.forEach((c, i) => {
    c.embedding = emb.vectors[i];
  });

  if (opts.dryRun || !store) {
    console.log('[ingest] dry run — no writes. Sample chunk:');
    console.log(JSON.stringify({ ...chunks[0], embedding: `[${chunks[0].embedding.length}d vector]` }, null, 2));
    return { action: 'dry-run', sourceId, chunks: chunks.length };
  }

  const { upserted } = await store.upsert(chunks);
  await mongoose.disconnect();
  console.log(`[ingest] done — upserted ${upserted} chunks for ${sourceId} (${EMBEDDING_IDENTITY.model}/${EMBEDDING_IDENTITY.dimensions}d)`);
  return { action: 'ingested', sourceId, chunks: upserted };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  try {
    const result = await ingestKb(opts);
    console.log(`[ingest] result: ${JSON.stringify(result)}`);
  } catch (err) {
    console.error(`[ingest] fatal: ${err.message}`);
    try {
      await mongoose.disconnect();
    } catch { /* already down */ }
    process.exit(1);
  }
}

// process.argv[1] is C:\... on Windows — compare via fileURLToPath + resolve.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
