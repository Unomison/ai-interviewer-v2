/**
 * Milestone 2 LLM gateway tests — fake providers, no real API keys.
 *
 * Uses Node's built-in test runner (node --test). A single fake HTTP server
 * mimics the Gemini REST shape (/v1beta/models/...) and the OpenAI-compatible
 * shape (/chat/completions) used by Groq/OpenRouter, with an independent
 * behaviour mode per endpoint. Adapters are pointed at it via *_BASE_URL env
 * overrides (documented test hooks). Each test builds a fresh gateway with an
 * explicit env object, so no real keys can leak in.
 *
 * Run from the repo root:  npm test
 */
import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { z } from 'zod';

import { createGateway } from '../apps/api/src/llm/gateway.js';
import { ValidationError, NoProviderAvailableError } from '../apps/api/src/llm/errors.js';

const FAKE_PORT = 5387;
const FAKE_BASE = `http://127.0.0.1:${FAKE_PORT}`;

// The schema every fake provider must satisfy in the happy path.
const AtsSchema = z.object({
  score: z.number().min(0).max(100),
  verdict: z.enum(['strong', 'average', 'weak']),
  missing: z.array(z.string()),
});
const VALID_PAYLOAD = { score: 82, verdict: 'strong', missing: ['docker'] };

// Mutable fake behaviour, reset before each test. Modes:
// 'ok' | '429' | '503' | 'invalid' (invalid = wrong JSON shape for the schema)
const fake = {
  geminiMode: 'ok',
  openaiMode: 'ok',
  requests: 0,
  geminiRequests: 0,
  openaiRequests: 0,
  models: [], // model IDs seen in request bodies, in order
};

function geminiBody(payloadText) {
  return JSON.stringify({
    candidates: [{ content: { parts: [{ text: payloadText }] } }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
  });
}

function openaiBody(payloadText) {
  return JSON.stringify({
    choices: [{ message: { content: payloadText } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  });
}

function respondForMode(res, mode, makeBody) {
  const payloadText =
    mode === 'invalid' ? JSON.stringify({ nope: true }) : JSON.stringify(VALID_PAYLOAD);
  if (mode === '429') {
    res.writeHead(429, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'rate limit exceeded' } }));
    return;
  }
  if (mode === '503') {
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'overloaded' } }));
    return;
  }
  if (mode === 'model_not_found') {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      error: {
        message: "The model `retired-model-x` does not exist or you do not have access to it.",
        type: 'invalid_request_error',
        code: 'model_not_found',
      },
    }));
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(makeBody(payloadText));
}

let server = null;

before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      fake.requests += 1;
      try {
        const parsed = JSON.parse(body || '{}');
        if (parsed.model) fake.models.push(parsed.model);
      } catch { /* non-JSON bodies are not model assertions */ }
      if (req.url.startsWith('/v1beta/models/')) {
        fake.geminiRequests += 1;
        respondForMode(res, fake.geminiMode, geminiBody);
      } else {
        fake.openaiRequests += 1;
        respondForMode(res, fake.openaiMode, openaiBody);
      }
    });
  });
  await new Promise((resolve) => server.listen(FAKE_PORT, '127.0.0.1', resolve));
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  fake.geminiMode = 'ok';
  fake.openaiMode = 'ok';
  fake.requests = 0;
  fake.geminiRequests = 0;
  fake.openaiRequests = 0;
  fake.models = [];
});

const quietLogger = { info() {}, warn() {}, error() {} };

/** Fresh gateway pointed at the fake server, with a fast test config. */
function testGateway(env, chain, extraOverrides = {}) {
  return createGateway({
    env,
    logger: quietLogger,
    configOverrides: {
      resilience: { backoffMs: 10, cooldownMs: 60000, requestTimeoutMs: 5000 },
      tasks: { parse: { chain } },
      ...extraOverrides,
    },
  });
}

function envFor(name) {
  return {
    gemini: { GEMINI_API_KEY: 'test-gemini-key', GEMINI_BASE_URL: FAKE_BASE },
    groq: { GROQ_API_KEY: 'test-groq-key', GROQ_BASE_URL: FAKE_BASE },
    openrouter: { OPENROUTER_API_KEY: 'test-or-key', OPENROUTER_BASE_URL: FAKE_BASE },
  }[name];
}

const PROMPT = 'Score this resume against the JD. Reply in JSON only.';

describe('M2 gateway — each adapter serves the same schema-validated call', () => {
  for (const name of ['gemini', 'groq', 'openrouter']) {
    test(`${name} adapter returns validated data`, async () => {
      const gw = testGateway(envFor(name), [name]);
      const res = await gw.generate({ task: 'parse', prompt: PROMPT, schema: AtsSchema });
      assert.equal(res.provider, name);
      assert.deepEqual(res.data, VALID_PAYLOAD);
      assert.equal(res.cached, false);
      AtsSchema.parse(res.data); // the returned data really satisfies the schema
      assert.equal(res.usage.totalTokens, 15);
    });
  }
});

describe('M2 gateway — failover on 429', () => {
  test('429 on gemini fails over to groq with the same validated result', async () => {
    fake.geminiMode = '429';
    const gw = testGateway(
      { ...envFor('gemini'), ...envFor('groq') },
      ['gemini', 'groq']
    );
    const res = await gw.generate({ task: 'parse', prompt: PROMPT, schema: AtsSchema });
    assert.equal(res.provider, 'groq');
    assert.deepEqual(res.data, VALID_PAYLOAD);
    assert.equal(res.attempts, 2);
    assert.equal(fake.geminiRequests, 1);
    assert.equal(fake.openaiRequests, 1);
  });
});

describe('M2 gateway — 503 marks provider unhealthy (cool-down)', () => {
  test('503 on groq routes around it on the immediate second call', async () => {
    fake.openaiMode = '503'; // groq's endpoint 503s; gemini stays healthy
    const gw = testGateway(
      { ...envFor('groq'), ...envFor('gemini') },
      ['groq', 'gemini']
    );

    const first = await gw.generate({ task: 'parse', prompt: PROMPT, schema: AtsSchema });
    assert.equal(first.provider, 'gemini');
    assert.ok(gw._state.unhealthyUntil.has('groq'), 'groq should be in cool-down');
    assert.equal(fake.openaiRequests, 1, 'groq attempted exactly once');

    // Immediate second call (different prompt so the cache cannot answer it):
    // groq is still in cool-down and must be skipped without an HTTP attempt.
    const second = await gw.generate({ task: 'parse', prompt: PROMPT + ' (second)', schema: AtsSchema });
    assert.equal(second.provider, 'gemini');
    assert.equal(fake.openaiRequests, 1, 'groq must not be attempted while in cool-down');
  });
});

describe('M2 gateway — validation failure retries once, then throws loudly', () => {
  test('wrong-shaped payload: exactly one retry, then ValidationError', async () => {
    fake.openaiMode = 'invalid';
    const gw = testGateway(envFor('groq'), ['groq']);
    await assert.rejects(
      gw.generate({ task: 'parse', prompt: PROMPT, schema: AtsSchema }),
      (err) => {
        assert.ok(err instanceof ValidationError, `expected ValidationError, got ${err?.name}`);
        assert.match(err.message, /failed schema validation/);
        assert.equal(err.provider, 'groq');
        return true;
      }
    );
    assert.equal(fake.openaiRequests, 2, 'expected initial attempt + exactly one retry');
  });
});

describe('M2 gateway — content-hash caching', () => {
  test('identical second call is a cache hit; provider not called again', async () => {
    const gw = testGateway(envFor('gemini'), ['gemini']);
    const first = await gw.generate({ task: 'parse', prompt: PROMPT, schema: AtsSchema });
    assert.equal(first.cached, false);
    const second = await gw.generate({ task: 'parse', prompt: PROMPT, schema: AtsSchema });
    assert.equal(second.cached, true);
    assert.deepEqual(second.data, VALID_PAYLOAD);
    assert.equal(fake.geminiRequests, 1, 'provider should have been hit exactly once');
  });
});

describe('M2 gateway — mock fallback with zero keys', () => {
  test('deterministic mock passes schema validation', async () => {
    const gw = createGateway({ env: {}, logger: quietLogger });
    const first = await gw.generate({ task: 'parse', prompt: PROMPT, schema: AtsSchema });
    assert.equal(first.provider, 'mock');
    AtsSchema.parse(first.data); // must not throw
    const second = await gw.generate({ task: 'parse', prompt: PROMPT, schema: AtsSchema });
    assert.deepEqual(second.data, first.data, 'mock must be deterministic');
  });

  test('mock also serves a realistic nested schema', async () => {
    const Nested = z.object({
      resume: z.object({
        name: z.string(),
        email: z.string().email(),
        skills: z.array(z.string()).min(1),
        years: z.number().int().min(0),
      }),
      score: z.number().min(0).max(100),
      verdict: z.enum(['strong', 'average', 'weak']),
      notes: z.string().optional(),
    });
    const gw = createGateway({ env: {}, logger: quietLogger });
    const res = await gw.generate({ task: 'ats_rubric', prompt: 'mock me', schema: Nested });
    assert.equal(res.provider, 'mock');
    Nested.parse(res.data);
  });

  test('mock embed returns deterministic vectors of the configured dimension', async () => {
    const gw = createGateway({ env: {}, logger: quietLogger });
    const a = await gw.embed(['hello world']);
    assert.equal(a.provider, 'mock');
    assert.equal(a.dimensions, 768);
    assert.equal(a.vectors[0].length, 768);
    const b = await gw.embed(['hello world']);
    assert.deepEqual(b.vectors, a.vectors, 'same text -> same vector');
  });
});

describe('M2 gateway — budget', () => {
  test('budgetAllows reports remaining quota; exhausted budget throws the resting message', async () => {
    const gw = testGateway({ ...envFor('groq') }, ['groq'], {
      budgets: { maxDailyCalls: 1, maxDailyTokens: 1000000 },
    });
    const before = gw.budgetAllows('parse');
    assert.equal(before.allowed, true);
    assert.equal(before.remainingCalls, 1);

    await gw.generate({ task: 'parse', prompt: PROMPT, schema: AtsSchema }); // consumes the 1 call

    const after = gw.budgetAllows('parse');
    assert.equal(after.allowed, false);
    assert.match(after.reason, /daily call budget exhausted/);
    await assert.rejects(
      gw.generate({ task: 'parse', prompt: PROMPT + ' (over budget)' }),
      /interviewer is resting/
    );
  });

  test('chain exhausted with keys configured throws NoProviderAvailableError', async () => {
    fake.openaiMode = '503';
    const gw = testGateway(envFor('groq'), ['groq']); // only groq, always 503
    await assert.rejects(
      gw.generate({ task: 'parse', prompt: PROMPT, schema: AtsSchema }),
      (err) => {
        assert.ok(err instanceof NoProviderAvailableError, `got ${err?.name}`);
        assert.match(err.message, /no LLM provider could serve task "parse"/);
        return true;
      }
    );
  });
});

describe('httpError: invalid-key 400s are auth failures (2026-11-04 live bug)', () => {
  test('400 "API key not valid" maps to AuthError (fails over), not BadRequestError', async () => {
    const { httpError, AuthError, BadRequestError } = await import('../apps/api/src/llm/errors.js');
    const err = httpError('gemini', 400, '{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}');
    assert.ok(err instanceof AuthError, `expected AuthError, got ${err?.name}`);
    assert.equal(err.status, 400);
  });

  test('400 without key complaint still maps to BadRequestError (no failover)', async () => {
    const { httpError, BadRequestError, AuthError } = await import('../apps/api/src/llm/errors.js');
    const err = httpError('gemini', 400, '{"error":{"message":"Invalid JSON payload"}}');
    assert.ok(err instanceof BadRequestError, `expected BadRequestError, got ${err?.name}`);
    assert.ok(!(err instanceof AuthError));
  });

  test('401 still maps to AuthError', async () => {
    const { httpError, AuthError } = await import('../apps/api/src/llm/errors.js');
    assert.ok(httpError('groq', 401, 'invalid key') instanceof AuthError);
  });
});

describe('gemini adapter: responseSchema sanitization (2026-11-04 live bug)', () => {
  test('strips additionalProperties and $schema, keeps shape', async () => {
    const { geminiAdapter } = await import('../apps/api/src/llm/adapters/gemini.js');
    let captured = null;
    const fakeFetch = async (_url, opts) => {
      captured = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{}' }] } }], usageMetadata: {} }) };
    };
    const schema = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: {
        skills: { type: 'array', items: { type: 'string' }, additionalProperties: false },
      },
      required: ['skills'],
      additionalProperties: false,
    };
    await geminiAdapter.generate({ prompt: 'x', jsonSchema: schema, model: 'm', timeoutMs: 5000, env: { GEMINI_API_KEY: 'k' }, fetchImpl: fakeFetch });
    const rs = captured.generationConfig.responseSchema;
    assert.ok(!JSON.stringify(rs).includes('additionalProperties'), 'additionalProperties must be stripped');
    assert.ok(!JSON.stringify(rs).includes('$schema'), '$schema must be stripped');
    assert.equal(rs.type, 'object');
    assert.deepEqual(rs.required, ['skills']);
  });

  test('nullable union types convert to OpenAPI nullable form', async () => {
    const { geminiAdapter } = await import('../apps/api/src/llm/adapters/gemini.js');
    let captured = null;
    const fakeFetch = async (_url, opts) => {
      captured = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{}' }] } }], usageMetadata: {} }) };
    };
    const schema = {
      type: 'object',
      properties: {
        name: { type: ['string', 'null'] },
        count: { type: ['integer', 'null'] },
      },
      required: ['name'],
    };
    await geminiAdapter.generate({ prompt: 'x', jsonSchema: schema, model: 'm', timeoutMs: 5000, env: { GEMINI_API_KEY: 'k' }, fetchImpl: fakeFetch });
    const rs = captured.generationConfig.responseSchema;
    assert.equal(rs.properties.name.type, 'string');
    assert.equal(rs.properties.name.nullable, true);
    assert.equal(rs.properties.count.type, 'integer');
    assert.equal(rs.properties.count.nullable, true);
    assert.ok(!JSON.stringify(rs).includes('"null"'), 'no null union types may remain');
  });
});

describe('M2 gateway — per-task Groq model resolution (config.yaml)', () => {
  // resolveModel() reads providers.groq.taskModels[task] || providers.groq.model.
  // These tests pin the intended model per task so a retired ID can't slip back in.
  const EXPECTED = {
    parse: 'openai/gpt-oss-20b',        // explicit override: cheap extraction
    interviewer: 'openai/gpt-oss-20b',  // explicit override: high-volume turns
    planner: 'openai/gpt-oss-120b',     // default: judgement-heavy tasks
    ats_rubric: 'openai/gpt-oss-120b',  // default
    report: 'openai/gpt-oss-120b',      // default
  };

  for (const [task, expectedModel] of Object.entries(EXPECTED)) {
    test(`task "${task}" resolves to ${expectedModel} on groq`, async () => {
      const gw = testGateway(envFor('groq'), ['groq'], {
        tasks: { [task]: { chain: ['groq'] } },
      });
      const res = await gw.generate({ task, prompt: PROMPT, schema: AtsSchema });
      assert.equal(res.provider, 'groq');
      assert.equal(fake.models.length, 1, 'exactly one model should have been requested');
      assert.equal(fake.models[0], expectedModel);
      assert.equal(res.model, expectedModel);
    });
  }

  test('no task silently falls back to a retired llama model ID', async () => {
    const gw = testGateway(envFor('groq'), ['groq'], {
      tasks: {
        parse: { chain: ['groq'] },
        interviewer: { chain: ['groq'] },
        planner: { chain: ['groq'] },
      },
    });
    for (const task of ['parse', 'interviewer', 'planner']) {
      fake.models = [];
      await gw.generate({ task, prompt: PROMPT, schema: AtsSchema });
      assert.ok(!fake.models[0].startsWith('llama-'), `task ${task} used retired ${fake.models[0]}`);
    }
  });
});

describe('M2 gateway — model_not_found is diagnosed and failed over, not retried', () => {
  test('httpError maps Groq model_not_found 404 to ModelNotFoundError', async () => {
    const { httpError, ModelNotFoundError } = await import('../apps/api/src/llm/errors.js');
    const err = httpError(
      'groq',
      404,
      '{"error":{"message":"The model `llama-3.3-70b-versatile` does not exist or you do not have access to it.","type":"invalid_request_error","code":"model_not_found"}}'
    );
    assert.ok(err instanceof ModelNotFoundError);
    assert.equal(err.code, 'model_not_found');
    assert.equal(err.model, 'llama-3.3-70b-versatile');
    assert.ok(err.message.includes('config.yaml'), 'message must name the fix');
  });

  test('model_not_found on groq fails over to gemini (no loud failure, no cool-down)', async () => {
    fake.openaiMode = 'model_not_found'; // groq 404s; gemini stays healthy
    const gw = testGateway(
      { ...envFor('groq'), ...envFor('gemini') },
      ['groq', 'gemini']
    );
    const res = await gw.generate({ task: 'parse', prompt: PROMPT, schema: AtsSchema });
    assert.equal(res.provider, 'gemini', 'should fail over, not throw');
    assert.deepEqual(res.data, VALID_PAYLOAD);
    assert.ok(!gw._state.unhealthyUntil.has('groq'), 'model_not_found must not trigger cool-down');
    assert.equal(fake.openaiRequests, 1, 'groq attempted exactly once (no retry)');
  });
});
