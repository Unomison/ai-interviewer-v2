/**
 * Milestone 11 — chunking tests (spec §4.9).
 *
 * No DB, no keys: pure functions over a fixture KB document.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  chunkKbDocument,
  pruneChunks,
  chunksBytes,
  DEFAULT_MIN_CONFIDENCE,
  MAX_CHUNK_CHARS,
} from '../apps/api/src/rag/chunk.js';

const KB = {
  company: 'Nokia',
  role: 'Associate Engineer',
  overview: 'Nokia builds telecom infrastructure.',
  techStack: ['C++', 'Python'],
  engineeringPractices: ['Code review culture'],
  culture: ['Collaborative'],
  recentDevelopments: ['5G rollout'],
  interviewAngles: [
    { topic: 'concurrency', why: 'Multithreaded data plane.', sourceUrls: ['https://www.nokia.com/careers/'] },
    { topic: 'networking', why: 'Routing fundamentals.', sourceUrls: [] },
  ],
  sources: [{ url: 'https://www.nokia.com/careers/', title: 'careers' }],
  researchedAt: '2026-11-01T00:00:00.000Z',
  provenance: 'fresh',
};

describe('chunkKbDocument', () => {
  test('one chunk per interview angle plus overview/stack/practices', () => {
    const chunks = chunkKbDocument(KB, { embeddingModel: 'gemini-embedding-001', embeddingDim: 768 });
    const kinds = chunks.map((c) => c.metadata.kind);
    assert.equal(kinds.filter((k) => k === 'angle').length, 2);
    assert.ok(kinds.includes('overview'));
    assert.ok(kinds.includes('tech-stack'));
    assert.ok(kinds.includes('practice'));
  });

  test('spec metadata carried on every chunk', () => {
    const chunks = chunkKbDocument(KB, { embeddingModel: 'gemini-embedding-001', embeddingDim: 768 });
    for (const c of chunks) {
      const m = c.metadata;
      assert.equal(m.company, 'Nokia');
      assert.equal(m.role, 'Associate Engineer');
      assert.equal(m.year, 2026);
      assert.ok(typeof m.confidence === 'number' && m.confidence > 0 && m.confidence <= 1);
      assert.ok(m.source_url === null || m.source_url.startsWith('http'));
      assert.equal(c.embeddingModel, 'gemini-embedding-001');
      assert.equal(c.embeddingDim, 768);
      assert.ok(c.text.length <= MAX_CHUNK_CHARS);
      assert.ok(c.chunkId.includes('#'));
    }
  });

  test('angle chunks keep their topic and source url', () => {
    const chunks = chunkKbDocument(KB, {});
    const angle = chunks.find((c) => c.metadata.kind === 'angle' && c.metadata.topic === 'concurrency');
    assert.ok(angle);
    assert.equal(angle.metadata.source_url, 'https://www.nokia.com/careers/');
    assert.match(angle.text, /concurrency/);
  });

  test('empty/invalid KB yields no chunks, never throws', () => {
    assert.deepEqual(chunkKbDocument(null), []);
    assert.deepEqual(chunkKbDocument({}), []);
    assert.deepEqual(chunkKbDocument({ company: '' }), []);
  });
});

describe('pruneChunks', () => {
  test('drops low-confidence chunks, keeps the rest', () => {
    const chunks = chunkKbDocument(KB, {});
    const pruned = pruneChunks(chunks, 0.8);
    assert.ok(pruned.length < chunks.length);
    assert.ok(pruned.every((c) => c.metadata.confidence >= 0.8));
  });

  test('default threshold matches the documented policy', () => {
    assert.equal(DEFAULT_MIN_CONFIDENCE, 0.55);
  });
});

describe('chunksBytes', () => {
  test('a company KB is kilobytes, nowhere near the 512 MB cap', () => {
    const chunks = chunkKbDocument(KB, {});
    assert.ok(chunksBytes(chunks) < 100_000);
    assert.ok(chunksBytes(chunks) > 0);
  });
});
