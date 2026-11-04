/**
 * Milestone 11 — VectorStore tests (spec §4.9).
 *
 * No Atlas, no keys: MemoryVectorStore is fully exercised; AtlasVectorStore
 * is tested for graceful degradation (no DB → honest not-ready, no throw).
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  VectorStore,
  MemoryVectorStore,
  AtlasVectorStore,
  cosineSimilarity,
  metadataMatches,
  getVectorStore,
  _resetVectorStore,
} from '../apps/api/src/rag/store.js';

const V = (xs) => xs; // readability

function chunk(id, embedding, metadata = {}, sourceId = 's1') {
  return { chunkId: id, sourceId, text: `text ${id}`, embedding, metadata };
}

describe('cosineSimilarity', () => {
  test('1 for identical vectors, 0 for orthogonal, -1 for opposite', () => {
    assert.ok(Math.abs(cosineSimilarity(V([1, 0]), V([1, 0])) - 1) < 1e-9);
    assert.ok(Math.abs(cosineSimilarity(V([1, 0]), V([0, 1])) - 0) < 1e-9);
    assert.ok(Math.abs(cosineSimilarity(V([1, 0]), V([-1, 0])) + 1) < 1e-9);
  });

  test('0 for mismatched lengths or empty vectors', () => {
    assert.equal(cosineSimilarity([1], [1, 2]), 0);
    assert.equal(cosineSimilarity([], []), 0);
  });
});

describe('metadataMatches', () => {
  test('null/empty filters are wildcards; chunk nulls are wildcards', () => {
    assert.ok(metadataMatches({ company: 'nokia' }, {}));
    assert.ok(metadataMatches({ company: 'nokia' }, { company: null }));
    assert.ok(metadataMatches({}, { company: 'nokia' }));
    assert.ok(metadataMatches({ company: 'Nokia' }, { company: 'nokia' }));
    assert.ok(!metadataMatches({ company: 'nokia' }, { company: 'stripe' }));
  });
});

describe('VectorStore interface', () => {
  test('base class methods throw not-implemented', async () => {
    const s = new VectorStore();
    await assert.rejects(() => s.upsert([]), /not implemented/);
    await assert.rejects(() => s.query([1]), /not implemented/);
  });
});

describe('MemoryVectorStore', () => {
  let store;
  beforeEach(() => {
    store = new MemoryVectorStore();
  });

  test('upsert + query ranks by cosine similarity', async () => {
    await store.upsert([
      chunk('a', V([1, 0, 0])),
      chunk('b', V([0, 1, 0])),
      chunk('c', V([0.9, 0.1, 0])),
    ]);
    const res = await store.query(V([1, 0, 0]), { limit: 2 });
    assert.equal(res.length, 2);
    assert.equal(res[0].chunk.chunkId, 'a');
    assert.equal(res[1].chunk.chunkId, 'c'); // nearer than b
    assert.ok(res[0].score >= res[1].score);
  });

  test('metadata filters narrow results', async () => {
    await store.upsert([
      chunk('a', V([1, 0]), { company: 'nokia' }),
      chunk('b', V([1, 0]), { company: 'stripe' }),
    ]);
    const res = await store.query(V([1, 0]), { filters: { company: 'stripe' }, limit: 5 });
    assert.equal(res.length, 1);
    assert.equal(res[0].chunk.chunkId, 'b');
  });

  test('deleteBySource removes only that source', async () => {
    await store.upsert([chunk('a', V([1]), {}, 's1'), chunk('b', V([1]), {}, 's2')]);
    const { deleted } = await store.deleteBySource('s1');
    assert.equal(deleted, 1);
    assert.equal(await store.count(), 1);
  });

  test('upsert is idempotent on chunkId (overwrite)', async () => {
    await store.upsert([chunk('a', V([1, 0]), { company: 'nokia' })]);
    await store.upsert([chunk('a', V([0, 1]), { company: 'stripe' })]);
    assert.equal(await store.count(), 1);
    const res = await store.query(V([0, 1]), { limit: 1 });
    assert.equal(res[0].chunk.metadata.company, 'stripe');
  });

  test('indexReady is always true for the memory store', async () => {
    assert.deepEqual(await store.indexReady(), { ready: true, reason: 'memory store is always ready' });
  });

  test('skips chunks without chunkId or embedding', async () => {
    const { upserted } = await store.upsert([{ text: 'no id' }, { chunkId: 'x' }]);
    assert.equal(upserted, 0);
  });
});

describe('AtlasVectorStore graceful degradation', () => {
  test('indexReady reports not-ready without a DB, never throws', async () => {
    const store = new AtlasVectorStore();
    const r = await store.indexReady();
    assert.equal(r.ready, false);
    assert.match(r.reason, /no database connection/);
  });

  test('count returns 0 without a DB, never throws', async () => {
    const store = new AtlasVectorStore();
    assert.equal(await store.count(), 0);
  });

  test('upsert without a DB throws a clear error (caller falls back)', async () => {
    const store = new AtlasVectorStore();
    await assert.rejects(() => store.upsert([]), /no database connection/);
  });
});

describe('getVectorStore factory', () => {
  test('returns a memory store when no DB is connected', () => {
    _resetVectorStore();
    const s = getVectorStore();
    assert.ok(s instanceof MemoryVectorStore);
  });

  test('explicit kind=memory always works', () => {
    assert.ok(getVectorStore({ kind: 'memory' }) instanceof MemoryVectorStore);
  });
});
