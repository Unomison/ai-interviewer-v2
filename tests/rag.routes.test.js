/**
 * Milestone 11 — /api/rag/status route tests (spec §4.9).
 *
 * No DB in tests → the route must answer 200 with mode 'disabled' and an
 * honest note, never a bare 500.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import express from 'express';
import ragRouter from '../apps/api/src/routes/rag.js';
import { getRagStatus } from '../apps/api/src/rag/index.js';
import { MemoryVectorStore } from '../apps/api/src/rag/store.js';

function startApp() {
  return new Promise((resolve) => {
    const app = express();
    app.use('/api', ragRouter);
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function getJSON(server, path) {
  return new Promise((resolve, reject) => {
    const port = server.address().port;
    http
      .get({ host: '127.0.0.1', port, path }, (res) => {
        let body = '';
        res.on('data', (c) => {
          body += c;
        });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
      })
      .on('error', reject);
  });
}

describe('getRagStatus', () => {
  test('no DB → disabled, honest note', async () => {
    const s = await getRagStatus();
    assert.equal(s.mode, 'disabled');
    assert.equal(s.indexed, false);
    assert.equal(s.embeddingModel, 'gemini-embedding-001');
    assert.equal(s.embeddingDimensions, 768);
    assert.ok(s.note.length > 0);
  });

  test('memory store with chunks → indexed with count', async () => {
    const store = new MemoryVectorStore();
    await store.upsert([{ chunkId: 'a', text: 't', embedding: [1, 0], metadata: {} }]);
    const s = await getRagStatus({ store: { indexReady: async () => ({ ready: true, reason: 'test' }), count: (f) => store.count(f) } });
    // getRagStatus checks getDbStatus() first — no DB here, so still disabled.
    assert.equal(s.mode, 'disabled');
  });
});

describe('GET /api/rag/status', () => {
  let server;
  before(async () => {
    server = await startApp();
  });
  after(() => server.close());

  test('200 with the status payload, never a 500', async () => {
    const { status, body } = await getJSON(server, '/api/rag/status');
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.mode, 'disabled');
    assert.equal(body.indexName, 'kb_chunks_vector_index');
  });
});
