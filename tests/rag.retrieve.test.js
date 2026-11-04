/**
 * Milestone 11 — retrieval orchestration tests (spec §4.9).
 *
 * No Atlas, no keys: MemoryVectorStore + a stub gateway returning
 * deterministic mock vectors. Identity checks accept mock vectors (dim 768).
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { MemoryVectorStore } from '../apps/api/src/rag/store.js';
import { chunkKbDocument, pruneChunks } from '../apps/api/src/rag/chunk.js';
import {
  retrieveRelevant,
  getRagContext,
  retrieveForTurn,
  noteAskedQuestions,
  citationsFor,
  keywordOverlap,
  hybridScore,
  _clearRagCaches,
} from '../apps/api/src/rag/retrieve.js';
import { mockVector } from '../apps/api/src/llm/mock.js';

const DIM = 768;
const EVAL_KB = {
  company: 'Nokia',
  role: 'SDE',
  overview: 'Telecom infra.',
  techStack: ['C++'],
  engineeringPractices: [],
  culture: [],
  recentDevelopments: [],
  interviewAngles: [
    { topic: 'concurrency', why: 'Locks and races in the data plane.', sourceUrls: ['https://www.nokia.com/a'] },
    { topic: 'networking', why: 'TCP and routing basics.', sourceUrls: ['https://www.nokia.com/b'] },
  ],
  sources: [{ url: 'https://www.nokia.com/', title: 'home' }],
  researchedAt: '2026-11-01T00:00:00.000Z',
  provenance: 'fresh',
};

function stubGateway() {
  return {
    async embed(texts) {
      return {
        vectors: texts.map((t) => mockVector(DIM, t)),
        model: 'mock',
        dimensions: DIM,
        provider: 'mock',
      };
    },
  };
}

async function seededStore(gw) {
  const store = new MemoryVectorStore();
  const chunks = pruneChunks(chunkKbDocument(EVAL_KB, { embeddingModel: 'mock', embeddingDim: DIM }));
  const emb = await gw.embed(chunks.map((c) => c.text));
  chunks.forEach((c, i) => {
    c.embedding = emb.vectors[i];
  });
  await store.upsert(chunks);
  return store;
}

describe('keywordOverlap / hybridScore', () => {
  test('overlap is 1 for identical token sets, 0 for disjoint', () => {
    assert.equal(keywordOverlap('concurrency locks', 'concurrency locks'), 1);
    assert.equal(keywordOverlap('concurrency', 'databases'), 0);
    assert.equal(keywordOverlap('', 'anything'), 0);
  });

  test('hybrid blends 0.7 vector + 0.3 keyword', () => {
    assert.ok(Math.abs(hybridScore(1, 0) - 0.7) < 1e-9);
    assert.ok(Math.abs(hybridScore(0, 1) - 0.3) < 1e-9);
  });
});

describe('retrieveRelevant', () => {
  let gw;
  let store;
  beforeEach(async () => {
    _clearRagCaches();
    gw = stubGateway();
    store = await seededStore(gw);
  });

  test('returns top-k chunks with hybrid scores, filtered by company', async () => {
    const res = await retrieveRelevant(
      { query: 'concurrency interview questions', company: 'Nokia', limit: 2 },
      { gw, store },
    );
    assert.equal(res.mode, 'vector');
    assert.equal(res.chunks.length, 2);
    assert.ok(res.chunks[0].hybrid >= res.chunks[1].hybrid);
    assert.ok(res.latencyMs >= 0);
    // keyword term should surface the concurrency chunk first
    assert.equal(res.chunks[0].metadata.topic, 'concurrency');
  });

  test('company filter excludes other companies', async () => {
    const other = chunkKbDocument({ ...EVAL_KB, company: 'Stripe' }, { embeddingModel: 'mock', embeddingDim: DIM });
    const emb = await gw.embed(other.map((c) => c.text));
    other.forEach((c, i) => {
      c.embedding = emb.vectors[i];
    });
    await store.upsert(other);
    const res = await retrieveRelevant({ query: 'interview', company: 'Nokia', limit: 10 }, { gw, store });
    assert.ok(res.chunks.every((c) => c.metadata.company === 'Nokia'));
  });

  test('empty query returns no chunks without embedding', async () => {
    let calls = 0;
    const counting = { async embed(t) { calls++; return gw.embed(t); } };
    const res = await retrieveRelevant({ query: '   ', company: 'Nokia' }, { gw: counting, store });
    assert.deepEqual(res.chunks, []);
    assert.equal(calls, 0);
  });

  test('embedding identity mismatch throws a clear error', async () => {
    const bad = { async embed() { return { vectors: [[1, 2]], model: 'other-model', dimensions: 2, provider: 'x' }; } };
    await assert.rejects(
      () => retrieveRelevant({ query: 'x', company: 'Nokia' }, { gw: bad, store }),
      /mismatch/,
    );
  });
});

describe('getRagContext fallback', () => {
  test('not-indexed store → direct KB mode with citations, never throws', async () => {
    const notIndexed = { indexReady: async () => ({ ready: false, reason: 'no index yet' }) };
    const kb = EVAL_KB;
    const res = await getRagContext({ company: 'Nokia', role: 'SDE', kb }, { store: notIndexed, gw: stubGateway() });
    assert.equal(res.mode, 'direct');
    assert.ok(res.citations.length > 0);
    assert.ok(res.note.includes('direct'));
  });

  test('vector store with chunks → vector mode with citations', async () => {
    const gw = stubGateway();
    const store = await seededStore(gw);
    const res = await getRagContext({ company: 'Nokia', role: 'SDE' }, { store, gw });
    assert.equal(res.mode, 'vector');
    assert.ok(res.chunks.length > 0);
    assert.ok(res.citations.every((c) => c.url.startsWith('http')));
  });

  test('no company and no kb → mode none, never throws', async () => {
    const res = await getRagContext({}, { store: new MemoryVectorStore(), gw: stubGateway() });
    assert.equal(res.mode, 'none');
  });
});

describe('retrieveForTurn', () => {
  test('skips cheaply: no company, short text, or non-dialogue round', async () => {
    let calls = 0;
    const counting = { async embed(t) { calls++; return stubGateway().embed(t); } };
    const base = { token: 't1', currentRound: 'dsa', company: 'Nokia', role: 'SDE' };
    assert.equal(await retrieveForTurn({ session: base, candidateText: 'x'.repeat(50), gw: counting }), '');
    assert.equal(await retrieveForTurn({ session: { ...base, currentRound: 'resume' }, candidateText: 'short', gw: counting }), '');
    assert.equal(await retrieveForTurn({ session: { ...base, company: null, currentRound: 'resume' }, candidateText: 'x'.repeat(50), gw: counting }), '');
    assert.equal(calls, 0);
  });

  test('returns patterns for a substantive resume-round message', async () => {
    const gw = stubGateway();
    const store = await seededStore(gw);
    const session = { token: 't2', currentRound: 'resume', company: 'Nokia', role: 'SDE' };
    const extra = await retrieveForTurn(
      { session, candidateText: 'I worked on multithreaded packet processing with lock-free queues', gw },
      { store },
    );
    assert.match(extra, /Retrieved company patterns/);
  });

  test('caches per session+round+text (second call is free)', async () => {
    const gw = stubGateway();
    const store = await seededStore(gw);
    let calls = 0;
    const counting = { async embed(t) { calls++; return gw.embed(t); } };
    const session = { token: 't3', currentRound: 'cs', company: 'Nokia', role: 'SDE' };
    const text = 'I studied operating systems concurrency primitives in depth here';
    await retrieveForTurn({ session, candidateText: text, gw: counting }, { store });
    const afterFirst = calls;
    await retrieveForTurn({ session, candidateText: text, gw: counting }, { store });
    assert.equal(calls, afterFirst); // cache hit: no new embed call
  });
});

describe('question dedup', () => {
  test('records questions; flags near-duplicates', async () => {
    const gw = stubGateway();
    const r1 = await noteAskedQuestions({
      sessionToken: 'd1',
      message: 'Can you explain how you handle concurrency in your project?',
      gw,
    });
    assert.equal(r1.recorded, 1);
    // Same question again → duplicate (identical text → cosine 1.0)
    const r2 = await noteAskedQuestions({
      sessionToken: 'd1',
      message: 'Can you explain how you handle concurrency in your project?',
      gw,
    });
    assert.equal(r2.recorded, 0);
    assert.equal(r2.duplicates.length, 1);
  });

  test('non-questions are ignored', async () => {
    const r = await noteAskedQuestions({ sessionToken: 'd2', message: 'Great, moving on.', gw: stubGateway() });
    assert.deepEqual(r, { recorded: 0, duplicates: [] });
  });
});

describe('citationsFor', () => {
  test('dedupes urls, keeps topic', () => {
    const chunks = [
      { metadata: { topic: 'concurrency', source_url: 'https://x/a' } },
      { metadata: { topic: 'concurrency', source_url: 'https://x/a' } },
      { metadata: { topic: 'networking', source_url: 'https://x/b' } },
      { metadata: { topic: 'no-url' } },
    ];
    const cites = citationsFor(chunks);
    assert.equal(cites.length, 2);
    assert.deepEqual(cites[0], { url: 'https://x/a', topic: 'concurrency' });
  });
});
