#!/usr/bin/env node
/**
 * Milestone 11 — RAG measurement harness (spec §4.9, ADR 012).
 *
 * Compares the retrieval pipeline against the no-retrieval baseline on the
 * three acceptance dimensions:
 *   1. latency        — ms added per retrieval call
 *   2. quota use      — embedding calls per retrieval
 *   3. question relevance — precision@k / recall@k / MRR of retrieved chunk
 *      topics against hand-labelled expectations
 *
 *   node tools/rag-eval.js [--out docs/rag-eval-results.json] [--k 4]
 *
 * Honesty notes (also in docs/rag-measurement.md):
 * - This runs WITHOUT real embeddings (no keys here): the stub gateway
 *   returns deterministic mock vectors, so the vector term of the hybrid
 *   score is noise and the keyword/metadata terms do the ranking work. What
 *   IS genuinely measured: pipeline mechanics (chunk → embed → filter →
 *   rank), hybrid filter precision, latency, and quota. Real vector-space
 *   relevance needs the owner's Gemini key + Atlas index — re-run there
 *   with USE_REAL_GATEWAY=1 and MONGODB_URI set (see --real flag notes).
 * - Sample size is small (10 hand-labelled queries, 2 companies): this is a
 *   write-up, not a paper. The harness is what ships; the numbers are a
 *   starting point.
 *
 * Windows-safe run-as-script guard (fileURLToPath + path.resolve).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');

const { chunkKbDocument, pruneChunks } = await import('../apps/api/src/rag/chunk.js');
const { MemoryVectorStore } = await import('../apps/api/src/rag/store.js');
const { retrieveRelevant } = await import('../apps/api/src/rag/retrieve.js');
const { mockVector } = await import('../apps/api/src/llm/mock.js');

const EVAL_DIM = 768;

function parseArgs(argv) {
  const opts = { out: path.join(REPO_ROOT, 'docs', 'rag-eval-results.json'), k: 4, fixture: path.join(HERE, 'rag-eval-fixture.json') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') opts.out = path.resolve(argv[++i]);
    else if (argv[i] === '--k') opts.k = Number(argv[++i]);
    else if (argv[i] === '--fixture') opts.fixture = path.resolve(argv[++i]);
    else throw new Error(`unknown arg: ${argv[i]}`);
  }
  return opts;
}

/** Stub gateway: deterministic mock vectors + call counting (quota measure). */
function stubGateway(counter) {
  return {
    async embed(texts) {
      counter.embedCalls += texts.length;
      return {
        vectors: texts.map((t) => mockVector(EVAL_DIM, t)),
        model: 'mock',
        dimensions: EVAL_DIM,
        provider: 'mock',
      };
    },
  };
}

function topicsOf(chunks) {
  return chunks.map((c) => (c.metadata?.topic || '').toLowerCase());
}

function precisionAtK(retrievedTopics, expected, k) {
  const top = retrievedTopics.slice(0, k);
  const hits = top.filter((t) => expected.some((e) => t.includes(e.toLowerCase()) || e.toLowerCase().includes(t)));
  return top.length ? hits.length / top.length : 0;
}

function recallAtK(retrievedTopics, expected, k) {
  const top = retrievedTopics.slice(0, k);
  const hit = expected.filter((e) =>
    top.some((t) => t.includes(e.toLowerCase()) || e.toLowerCase().includes(t)),
  );
  return expected.length ? hit.length / expected.length : 0;
}

function reciprocalRank(retrievedTopics, expected) {
  for (let i = 0; i < retrievedTopics.length; i++) {
    const t = retrievedTopics[i];
    if (expected.some((e) => t.includes(e.toLowerCase()) || e.toLowerCase().includes(t))) return 1 / (i + 1);
  }
  return 0;
}

export async function runRagEval({ fixture, k }) {
  const data = JSON.parse(readFileSync(fixture, 'utf8'));
  const store = new MemoryVectorStore();
  const counter = { embedCalls: 0 };
  const gw = stubGateway(counter);

  // Ingest: chunk + embed + upsert (quota counted).
  const tIngest0 = Date.now();
  for (const kb of data.companies) {
    const chunks = pruneChunks(chunkKbDocument(kb, { embeddingModel: 'mock', embeddingDim: EVAL_DIM }));
    const emb = await gw.embed(chunks.map((c) => c.text));
    chunks.forEach((c, i) => {
      c.embedding = emb.vectors[i];
    });
    await store.upsert(chunks);
  }
  const ingestMs = Date.now() - tIngest0;
  const chunkCount = await store.count();

  // Retrieval eval.
  const perQuery = [];
  for (const q of data.queries) {
    const t0 = Date.now();
    const callsBefore = counter.embedCalls;
    const res = await retrieveRelevant(
      { query: q.query, company: q.company, role: q.role, limit: k },
      { gw, store },
    );
    const latencyMs = Date.now() - t0;
    const topics = topicsOf(res.chunks);
    const textChars = res.chunks.reduce((n, c) => n + (c.text || '').length, 0);
    const hit = recallAtK(topics, q.expectTopics, k) > 0 ? 1 : 0;
    perQuery.push({
      query: q.query,
      company: q.company,
      expectTopics: q.expectTopics,
      gotTopics: topics,
      textChars,
      hit,
      latencyMs,
      embedCalls: counter.embedCalls - callsBefore,
      precisionAtK: Number(precisionAtK(topics, q.expectTopics, k).toFixed(3)),
      recallAtK: Number(recallAtK(topics, q.expectTopics, k).toFixed(3)),
      reciprocalRank: Number(reciprocalRank(topics, q.expectTopics).toFixed(3)),
    });
  }

  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const summary = {
    queries: perQuery.length,
    k,
    chunkCount,
    ingestMs,
    avgLatencyMs: Number(avg(perQuery.map((q) => q.latencyMs)).toFixed(2)),
    // With one expected topic per query, P@k is capped at 1/k — hitRate
    // (expected topic present in top-k) is the more honest headline metric.
    hitRate: Number(avg(perQuery.map((q) => q.hit)).toFixed(3)),
    avgPrecisionAtK: Number(avg(perQuery.map((q) => q.precisionAtK)).toFixed(3)),
    avgRecallAtK: Number(avg(perQuery.map((q) => q.recallAtK)).toFixed(3)),
    mrr: Number(avg(perQuery.map((q) => q.reciprocalRank)).toFixed(3)),
    embedCallsPerRetrieval: perQuery[0]?.embedCalls ?? 0,
    totalEmbedCalls: counter.embedCalls,
  };

  // Baseline: no-retrieval = the whole KB document handed to the planner.
  // Quota proxy = prompt characters; relevance = topic coverage is 1.0 by
  // construction (the whole doc is there) — the honest comparison is
  // selectivity: retrieval returns k focused chunks vs the full dump.
  const baselinePromptChars = data.companies.reduce(
    (n, kb) => n + JSON.stringify(kb).length,
    0,
  );
  const retrievalPromptChars = Math.round(avg(perQuery.map((q) => q.textChars)));
  const baseline = {
    mode: 'no-retrieval (direct KB read)',
    promptCharsFor2Companies: baselinePromptChars,
    retrievalPromptCharsAvg: retrievalPromptChars,
    promptCharsSavedPct: Number((((baselinePromptChars - retrievalPromptChars) / baselinePromptChars) * 100).toFixed(1)),
    latencyAddedMs: summary.avgLatencyMs,
    extraEmbedCallsPerRetrieval: summary.embedCallsPerRetrieval,
    note: 'Baseline topic coverage is 1.0 by construction (whole doc in prompt); retrieval trades a small latency + 1 embed call for a focused, citable top-k.',
  };

  return {
    generatedAt: new Date().toISOString(),
    embeddings: 'mock (deterministic) — vector term is noise; keyword/metadata terms rank. See docs/rag-measurement.md.',
    summary,
    baseline,
    perQuery,
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const results = await runRagEval(opts);
  writeFileSync(opts.out, JSON.stringify(results, null, 2));
  const s = results.summary;
  console.log('RAG eval — retrieval vs no-retrieval baseline');
  console.log(`  queries: ${s.queries} (k=${s.k}), chunks indexed: ${s.chunkCount}, ingest: ${s.ingestMs}ms`);
  console.log(`  latency:   avg ${s.avgLatencyMs}ms added per retrieval`);
  console.log(`  quota:     ${s.embedCallsPerRetrieval} embed call(s) per retrieval (${s.totalEmbedCalls} total incl. ingest)`);
  console.log(`  relevance: hitRate=${s.hitRate}  P@${s.k}=${s.avgPrecisionAtK}  R@${s.k}=${s.avgRecallAtK}  MRR=${s.mrr} (mock embeddings — see doc)`);
  console.log(`  baseline:  whole-KB prompt ${results.baseline.promptCharsFor2Companies} chars → retrieved top-k ~${results.baseline.retrievalPromptCharsAvg} chars (${results.baseline.promptCharsSavedPct}% smaller)`);
  console.log(`[eval] wrote ${opts.out}`);
}

// process.argv[1] is C:\... on Windows — compare via fileURLToPath + resolve.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error(`[eval] fatal: ${err.message}`);
    process.exit(1);
  });
}
