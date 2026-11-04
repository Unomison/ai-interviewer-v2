/**
 * Milestone 9 — Groq Whisper transcription tests (spec §4.7).
 *
 * No real keys, no network: fetchImpl/env are injected. Route-level tests
 * spin a real Express app on a loopback port and POST hand-rolled multipart
 * bodies (missing file / wrong type / oversized / no-key paths).
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import express from 'express';
import {
  transcribeAudio,
  TranscriptionError,
  WHISPER_MODEL,
  MAX_AUDIO_BYTES,
} from '../apps/api/src/voice/transcribe.js';
import voiceRouter from '../apps/api/src/routes/voice.js';

const fakeAudio = () => Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0x01, 0x02, 0x03]);

function okFetch(jsonBody, capture) {
  return async (url, opts) => {
    if (capture) capture.push({ url, opts });
    return {
      ok: true,
      status: 200,
      json: async () => jsonBody,
    };
  };
}

describe('transcribeAudio', () => {
  test('returns trimmed text on success', async () => {
    const calls = [];
    const r = await transcribeAudio(
      { buffer: fakeAudio(), mimetype: 'audio/webm;codecs=opus' },
      { env: { GROQ_API_KEY: 'k' }, fetchImpl: okFetch({ text: '  hello world  ' }, calls) },
    );
    assert.equal(r.text, 'hello world');
    assert.equal(r.empty, false);
    assert.equal(r.provider, 'groq-whisper');
    assert.equal(r.model, WHISPER_MODEL);
    // key travels in the Authorization header of the server-to-Groq call only
    assert.equal(calls[0].opts.headers.Authorization, 'Bearer k');
    assert.match(calls[0].url, /audio\/transcriptions$/);
  });

  test('passes the vocabulary hint as the Whisper prompt', async () => {
    const calls = [];
    await transcribeAudio(
      { buffer: fakeAudio(), mimetype: 'audio/webm', vocabularyHint: 'memoization, BFS, mutex' },
      { env: { GROQ_API_KEY: 'k' }, fetchImpl: okFetch({ text: 'x' }, calls) },
    );
    const form = calls[0].opts.body;
    assert.equal(form.get('model'), WHISPER_MODEL);
    assert.equal(form.get('prompt'), 'memoization, BFS, mutex');
    assert.equal(form.get('temperature'), '0');
  });

  test('empty transcript is reported, not thrown', async () => {
    const r = await transcribeAudio(
      { buffer: fakeAudio(), mimetype: 'audio/webm' },
      { env: { GROQ_API_KEY: 'k' }, fetchImpl: okFetch({ text: '   ' }) },
    );
    assert.equal(r.empty, true);
    assert.equal(r.text, '');
  });

  test('missing key → 503 transcription_unavailable (never leaks the key)', async () => {
    let boom = null;
    try {
      await transcribeAudio(
        { buffer: fakeAudio(), mimetype: 'audio/webm' },
        { env: {}, fetchImpl: okFetch({ text: 'x' }) },
      );
    } catch (e) {
      boom = e;
    }
    assert.ok(boom instanceof TranscriptionError);
    assert.equal(boom.code, 'transcription_unavailable');
    assert.equal(boom.status, 503);
    assert.ok(!boom.message.includes('GROQ_API_KEY'));
  });

  test('401 from Groq → 503 (key rejected, honest message)', async () => {
    const fetchImpl = async () => ({ ok: false, status: 401, text: async () => 'bad key' });
    await assert.rejects(
      transcribeAudio(
        { buffer: fakeAudio(), mimetype: 'audio/webm' },
        { env: { GROQ_API_KEY: 'bad' }, fetchImpl },
      ),
      (e) => e.code === 'transcription_unavailable' && e.status === 503,
    );
  });

  test('provider 500 → 502 transcription_failed', async () => {
    const fetchImpl = async () => ({ ok: false, status: 500, text: async () => 'oops' });
    await assert.rejects(
      transcribeAudio(
        { buffer: fakeAudio(), mimetype: 'audio/webm' },
        { env: { GROQ_API_KEY: 'k' }, fetchImpl },
      ),
      (e) => e.code === 'transcription_failed' && e.status === 502,
    );
  });

  test('network failure → 503', async () => {
    const fetchImpl = async () => {
      throw new TypeError('fetch failed');
    };
    await assert.rejects(
      transcribeAudio(
        { buffer: fakeAudio(), mimetype: 'audio/webm' },
        { env: { GROQ_API_KEY: 'k' }, fetchImpl },
      ),
      (e) => e.code === 'transcription_unavailable' && e.status === 503,
    );
  });

  test('oversized audio → 400', async () => {
    await assert.rejects(
      transcribeAudio(
        { buffer: Buffer.alloc(MAX_AUDIO_BYTES + 1), mimetype: 'audio/webm' },
        { env: { GROQ_API_KEY: 'k' }, fetchImpl: okFetch({ text: 'x' }) },
      ),
      (e) => e.code === 'invalid_request' && e.status === 400,
    );
  });

  test('empty buffer → 400', async () => {
    await assert.rejects(
      transcribeAudio(
        { buffer: Buffer.alloc(0), mimetype: 'audio/webm' },
        { env: { GROQ_API_KEY: 'k' }, fetchImpl: okFetch({ text: 'x' }) },
      ),
      (e) => e.code === 'invalid_request' && e.status === 400,
    );
  });
});

describe('POST /api/voice/transcribe (route)', () => {
  let server;
  let base;
  const realKey = process.env.GROQ_API_KEY;

  before(async () => {
    delete process.env.GROQ_API_KEY; // route reads process.env directly
    const app = express();
    app.use('/api', voiceRouter);
    server = app.listen(0, '127.0.0.1');
    await new Promise((r) => server.on('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (realKey !== undefined) process.env.GROQ_API_KEY = realKey;
    await new Promise((r) => server.close(r));
  });

  function multipart({ fields = {}, files = [] }) {
    const boundary = '----testboundary';
    const parts = [];
    for (const [name, value] of Object.entries(fields)) {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
    }
    for (const f of files) {
      parts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${f.field}"; filename="${f.filename}"\r\nContent-Type: ${f.mimetype}\r\n\r\n`,
        ),
      );
      parts.push(f.buffer);
      parts.push(Buffer.from('\r\n'));
    }
    parts.push(Buffer.from(`--${boundary}--\r\n`));
    return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
  }

  function post(path, { body, contentType }) {
    return new Promise((resolve, reject) => {
      const req = http.request(
        base + path,
        {
          method: 'POST',
          headers: { 'Content-Type': contentType, 'Content-Length': body.length },
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () =>
            resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString() || '{}') }),
          );
        },
      );
      req.on('error', reject);
      req.end(body);
    });
  }

  test('400 when no audio file is attached', async () => {
    const { body, contentType } = multipart({ fields: { vocabularyHint: 'x' }, files: [] });
    const r = await post('/api/voice/transcribe', { body, contentType });
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'invalid_request');
  });

  test('400 when the file is not audio', async () => {
    const { body, contentType } = multipart({
      files: [{ field: 'audio', filename: 'x.txt', mimetype: 'text/plain', buffer: fakeAudio() }],
    });
    const r = await post('/api/voice/transcribe', { body, contentType });
    assert.equal(r.status, 400);
  });

  test('400 when audio exceeds the size cap', async () => {
    const { body, contentType } = multipart({
      files: [
        { field: 'audio', filename: 'big.webm', mimetype: 'audio/webm', buffer: Buffer.alloc(MAX_AUDIO_BYTES + 8) },
      ],
    });
    const r = await post('/api/voice/transcribe', { body, contentType });
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'audio_too_large');
  });

  test('503 with honest JSON when no Groq key is configured', async () => {
    const { body, contentType } = multipart({
      files: [{ field: 'audio', filename: 'a.webm', mimetype: 'audio/webm', buffer: fakeAudio() }],
    });
    const r = await post('/api/voice/transcribe', { body, contentType });
    assert.equal(r.status, 503);
    assert.equal(r.json.error, 'transcription_unavailable');
    assert.ok(typeof r.json.message === 'string' && r.json.message.length > 0);
  });

  test('GET /api/voice/status reports the STT path honestly', async () => {
    const json = await new Promise((resolve, reject) => {
      http
        .get(base + '/api/voice/status', (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString())));
        })
        .on('error', reject);
    });
    assert.equal(json.ok, true);
    assert.equal(json.stt, 'browser-fallback'); // no key in this test env
    assert.equal(json.tts, 'browser-speech-synthesis');
    assert.ok(json.maxAudioBytes > 0);
  });
});
