/**
 * LLM gateway (Milestone 2, spec Section 8).
 *
 * One module exposing:
 *   generate({ task, prompt, schema, stream }) -> validated result
 *   embed(texts)                              -> vectors
 *   budgetAllows(task)                        -> global budget check
 *
 * Behaviour:
 *  - Per-task provider chains from config.yaml (Gemini -> Groq -> OpenRouter;
 *    Ollama dev-only). Providers without keys are skipped.
 *  - Failover: 429 -> brief back-off, try next; 503/timeout -> provider goes
 *    into cool-down and is routed around; 401/403 -> skip (config problem);
 *    400 -> thrown immediately (our request is malformed; failing over would
 *    just burn quota elsewhere).
 *  - Quota awareness: per provider+model daily request/token counters against
 *    config limits; a global daily budget stops new calls gracefully.
 *  - Caching: successful responses cached by content hash (task+prompt+schema)
 *    in an in-memory LRU (Mongo-backed cache is a later milestone).
 *  - Structured output: JSON-schema constrained requests where supported,
 *    ALWAYS validated with Zod; one retry with the validation error appended,
 *    then a loud ValidationError.
 *  - Mock fallback: zero keys configured -> deterministic mocks that pass the
 *    schema, so the pipeline runs end-to-end with no keys (ADR 002).
 *  - Streaming: generate({stream:true}) returns { provider, model, textStream }
 *    (basic passthrough; real SSE wiring for the interviewer lands in M8).
 *
 * Nothing secret is ever logged; prompts are never logged (they may carry
 * redacted-but-sensitive candidate text — spec Section 10).
 */

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import YAML from 'yaml';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { geminiAdapter } from './adapters/gemini.js';
import { groqAdapter } from './adapters/groq.js';
import { openrouterAdapter } from './adapters/openrouter.js';
import { ollamaAdapter } from './adapters/ollama.js';
import { mockForSchema, mockVector } from './mock.js';
import {
  RateLimitError,
  ProviderUnavailableError,
  AuthError,
  BadRequestError,
  BudgetExhaustedError,
  ValidationError,
  NoProviderAvailableError,
} from './errors.js';

const ADAPTERS = {
  gemini: geminiAdapter,
  groq: groqAdapter,
  openrouter: openrouterAdapter,
  ollama: ollamaAdapter,
};

const DEFAULT_CONFIG_PATH = new URL('./config.yaml', import.meta.url);

function defaultLogger() {
  return {
    info: (msg, extra = {}) =>
      console.log(JSON.stringify({ level: 'info', msg, time: new Date().toISOString(), ...extra })),
    warn: (msg, extra = {}) =>
      console.log(JSON.stringify({ level: 'warn', msg, time: new Date().toISOString(), ...extra })),
    error: (msg, extra = {}) =>
      console.log(JSON.stringify({ level: 'error', msg, time: new Date().toISOString(), ...extra })),
  };
}

function loadYamlConfig(path) {
  return YAML.parse(readFileSync(path, 'utf8'));
}

/** Deep-merge overrides onto the yaml config (tests use this). */
function mergeDeep(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return over ?? base;
  const out = { ...(base || {}) };
  for (const [k, v] of Object.entries(over)) out[k] = mergeDeep(base?.[k], v);
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const todayKey = () => new Date().toISOString().slice(0, 10);

export function createGateway(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetchImpl || fetch;
  const logger = options.logger || defaultLogger();

  let config = options.config || loadYamlConfig(options.configPath || DEFAULT_CONFIG_PATH);
  if (options.configOverrides) config = mergeDeep(config, options.configOverrides);

  const resilience = config.resilience || {};
  const REQUEST_TIMEOUT_MS = resilience.requestTimeoutMs ?? 45000;
  const COOLDOWN_MS = resilience.cooldownMs ?? 60000;
  const BACKOFF_MS = resilience.backoffMs ?? 500;
  const CACHE_MAX = config.cache?.maxEntries ?? 200;
  const CACHE_ENABLED = config.cache?.enabled !== false;
  const MOCK_ENABLED = config.mock?.enabled !== false;
  const MAX_DAILY_CALLS = config.budgets?.maxDailyCalls ?? 300;
  const MAX_DAILY_TOKENS = config.budgets?.maxDailyTokens ?? 2000000;

  // --- runtime state (in-memory in M2; Mongo-backed in a later milestone) ---
  const unhealthyUntil = new Map(); // provider -> epoch ms
  const usage = {}; // provider -> { requests, promptTokens, completionTokens, totalTokens, day }
  const daily = { calls: 0, tokens: 0, day: todayKey() };
  const cache = new Map(); // hash -> { data, text, provider, model, usage }

  function rollDay() {
    const t = todayKey();
    if (daily.day !== t) {
      daily.day = t;
      daily.calls = 0;
      daily.tokens = 0;
    }
  }

  function providerUsage(name) {
    const u = usage[name] || { requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, day: todayKey() };
    if (u.day !== todayKey()) {
      u.requests = 0;
      u.promptTokens = 0;
      u.completionTokens = 0;
      u.totalTokens = 0;
      u.day = todayKey();
    }
    usage[name] = u;
    return u;
  }

  function recordUsage(name, u) {
    const tokens = u?.totalTokens ?? 0;
    const p = providerUsage(name);
    p.requests += 1;
    p.promptTokens += u?.promptTokens ?? 0;
    p.completionTokens += u?.completionTokens ?? 0;
    p.totalTokens += tokens;
    rollDay();
    daily.calls += 1;
    daily.tokens += tokens;
  }

  function quotaAllows(name) {
    const limits = config.providers?.[name]?.limits;
    if (!limits) return true;
    const u = providerUsage(name);
    if (limits.requestsPerDay != null && u.requests >= limits.requestsPerDay) return false;
    if (limits.tokensPerDay != null && u.totalTokens >= limits.tokensPerDay) return false;
    return true;
  }

  function isUnhealthy(name) {
    const until = unhealthyUntil.get(name);
    if (!until) return false;
    if (Date.now() >= until) {
      unhealthyUntil.delete(name);
      return false;
    }
    return true;
  }

  function resolveModel(providerName, task) {
    const p = config.providers?.[providerName] || {};
    return p.taskModels?.[task] || p.model;
  }

  /** Any provider at all usable? (keys for gemini/groq/openrouter, or ollama enabled) */
  function anyProviderConfigured() {
    return Object.values(ADAPTERS).some((a) => a.isConfigured(env));
  }

  function toJsonSchema(schema) {
    if (!schema) return null;
    try {
      return zodToJsonSchema(schema, { target: 'jsonSchema7' });
    } catch (err) {
      logger.warn('llm.schema_convert_failed', { error: err?.message });
      return null;
    }
  }

  function cacheKey(task, prompt, jsonSchema) {
    return createHash('sha256')
      .update(task + '\n' + prompt + '\n' + (jsonSchema ? JSON.stringify(jsonSchema) : ''))
      .digest('hex');
  }

  function cacheGet(key) {
    const hit = cache.get(key);
    if (!hit) return null;
    cache.delete(key); // refresh LRU recency
    cache.set(key, hit);
    return hit;
  }

  function cacheSet(key, value) {
    cache.delete(key);
    cache.set(key, value);
    while (cache.size > CACHE_MAX) {
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
    }
  }

  /** Parse model text into JSON (strict, then best-effort block extract). */
  function parseJsonText(text) {
    const t = (text || '').trim();
    try {
      return { ok: true, value: JSON.parse(t) };
    } catch {
      const m = t.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
      if (m) {
        try {
          return { ok: true, value: JSON.parse(m[1]) };
        } catch {
          /* fall through */
        }
      }
      return { ok: false, error: 'response was not valid JSON' };
    }
  }

  function formatIssues(zodError) {
    return zodError.issues
      .map((i) => `- ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
  }

  /**
   * One provider attempt: HTTP call + usage recording + Zod validation with
   * a single retry-with-error. Throws the LlmError taxonomy.
   */
  async function attemptProvider(providerName, { task, prompt, schema, jsonSchema }) {
    const adapter = ADAPTERS[providerName];
    const model = resolveModel(providerName, task);
    const callArgs = { prompt, jsonSchema, model, timeoutMs: REQUEST_TIMEOUT_MS, env, fetchImpl };

    logger.info('llm.attempt', { task, provider: providerName, model });

    let raw = await adapter.generate(callArgs);
    recordUsage(providerName, raw.usage);

    if (!schema) {
      return {
        data: raw.text,
        text: raw.text,
        provider: providerName,
        model: raw.model,
        usage: raw.usage,
        cached: false,
        attempts: 1,
        validationRetries: 0,
      };
    }

    const tryValidate = (text) => {
      const parsed = parseJsonText(text);
      if (!parsed.ok) return { ok: false, error: parsed.error, value: undefined };
      const v = schema.safeParse(parsed.value);
      return v.success
        ? { ok: true, value: v.data }
        : { ok: false, error: formatIssues(v.error), value: undefined, zodError: v.error };
    };

    let checked = tryValidate(raw.text);
    let validationRetries = 0;
    if (!checked.ok) {
      // One retry with the validation error appended (spec Section 8).
      validationRetries = 1;
      logger.warn('llm.validation_retry', { task, provider: providerName, error: checked.error });
      const retryPrompt =
        `${prompt}\n\n` +
        `Your previous response failed validation. Fix ONLY the problems below and ` +
        `respond with valid JSON, nothing else:\n${checked.error}`;
      raw = await adapter.generate({ ...callArgs, prompt: retryPrompt });
      recordUsage(providerName, raw.usage);
      checked = tryValidate(raw.text);
      if (!checked.ok) {
        const ze = checked.zodError || new Error(checked.error);
        throw new ValidationError(providerName, ze, raw.text);
      }
    }

    return {
      data: checked.value,
      text: raw.text,
      provider: providerName,
      model: raw.model,
      usage: raw.usage,
      cached: false,
      attempts: 1,
      validationRetries,
    };
  }

  function mockResult(task, prompt, schema) {
    const seed = cacheKey(task, prompt, null);
    const data = schema ? mockForSchema(schema, seed) : { mock: true, task };
    const text = JSON.stringify(data);
    logger.info('llm.mock', { task });
    return {
      data,
      text,
      provider: 'mock',
      model: 'mock',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      cached: false,
      attempts: 0,
      validationRetries: 0,
    };
  }

  /**
   * Global daily budget check (spec Section 2). Fails gracefully BEFORE
   * quotas run out so in-flight interviews are never stranded mid-way.
   */
  function budgetAllows(task) {
    rollDay();
    if (daily.calls >= MAX_DAILY_CALLS) {
      return {
        allowed: false,
        reason: `daily call budget exhausted (${daily.calls}/${MAX_DAILY_CALLS} calls)`,
        remainingCalls: 0,
        remainingTokens: Math.max(0, MAX_DAILY_TOKENS - daily.tokens),
      };
    }
    if (daily.tokens >= MAX_DAILY_TOKENS) {
      return {
        allowed: false,
        reason: `daily token budget exhausted (${daily.tokens}/${MAX_DAILY_TOKENS} tokens)`,
        remainingCalls: Math.max(0, MAX_DAILY_CALLS - daily.calls),
        remainingTokens: 0,
      };
    }
    return {
      allowed: true,
      reason: null,
      remainingCalls: MAX_DAILY_CALLS - daily.calls,
      remainingTokens: MAX_DAILY_TOKENS - daily.tokens,
    };
  }

  async function generate({ task, prompt, schema = null, stream = false }) {
    if (!task || typeof prompt !== 'string' || prompt.length === 0) {
      throw new Error('generate() requires { task, prompt }');
    }
    const taskCfg = config.tasks?.[task];
    if (!taskCfg) throw new Error(`unknown LLM task "${task}" (no chain in config.yaml)`);

    const budget = budgetAllows(task);
    if (!budget.allowed) {
      logger.warn('llm.budget_blocked', { task, reason: budget.reason });
      throw new BudgetExhaustedError(budget.reason);
    }

    const jsonSchema = toJsonSchema(schema);

    if (stream) return generateStreamResult(taskCfg, { task, prompt, schema, jsonSchema });

    if (CACHE_ENABLED) {
      const key = cacheKey(task, prompt, jsonSchema);
      const hit = cacheGet(key);
      if (hit) {
        logger.info('llm.cache_hit', { task, provider: hit.provider });
        return { ...hit, cached: true };
      }
    }

    const attempts = [];
    let attemptCount = 0;
    for (const providerName of taskCfg.chain) {
      const adapter = ADAPTERS[providerName];
      if (!adapter) {
        attempts.push({ provider: providerName, error: 'unknown provider in chain' });
        continue;
      }
      if (!adapter.isConfigured(env)) {
        attempts.push({ provider: providerName, error: 'not configured (missing key)' });
        continue;
      }
      if (isUnhealthy(providerName)) {
        attempts.push({ provider: providerName, error: 'in cool-down after 503/timeout' });
        continue;
      }
      if (!quotaAllows(providerName)) {
        attempts.push({ provider: providerName, error: 'daily provider limit reached' });
        continue;
      }

      attemptCount += 1;
      try {
        const result = await attemptProvider(providerName, { task, prompt, schema, jsonSchema });
        result.attempts = attemptCount;
        if (CACHE_ENABLED) {
          cacheSet(cacheKey(task, prompt, jsonSchema), {
            data: result.data,
            text: result.text,
            provider: result.provider,
            model: result.model,
            usage: result.usage,
          });
        }
        logger.info('llm.success', {
          task,
          provider: providerName,
          model: result.model,
          promptTokens: result.usage.promptTokens,
          completionTokens: result.usage.completionTokens,
        });
        return result;
      } catch (err) {
        // Fail LOUDLY, never fail over: our request or the contract is wrong.
        if (err instanceof BadRequestError || err instanceof ValidationError || err instanceof BudgetExhaustedError) {
          throw err;
        }
        if (err instanceof RateLimitError) {
          logger.warn('llm.rate_limited', { task, provider: providerName });
          attempts.push({ provider: providerName, error: err.message });
          await sleep(BACKOFF_MS);
          continue;
        }
        if (err instanceof ProviderUnavailableError) {
          unhealthyUntil.set(providerName, Date.now() + COOLDOWN_MS);
          logger.warn('llm.provider_unhealthy', {
            task,
            provider: providerName,
            cooldownMs: COOLDOWN_MS,
            error: err.message,
          });
          attempts.push({ provider: providerName, error: err.message });
          continue;
        }
        if (err instanceof AuthError) {
          // Wrong key for this provider; the next provider has its own key.
          logger.warn('llm.auth_error', { task, provider: providerName });
          attempts.push({ provider: providerName, error: err.message });
          continue;
        }
        throw err; // unknown: do not swallow
      }
    }

    // Chain exhausted. Zero keys at all -> deterministic mock (ADR 002).
    if (MOCK_ENABLED && !anyProviderConfigured()) {
      return mockResult(task, prompt, schema);
    }
    logger.error('llm.chain_exhausted', { task, attempts });
    throw new NoProviderAvailableError(task, attempts);
  }

  /** Streaming passthrough (M2 basic; SSE wiring for the interviewer is M8). */
  async function generateStreamResult(taskCfg, { task, prompt, schema, jsonSchema }) {
    for (const providerName of taskCfg.chain) {
      const adapter = ADAPTERS[providerName];
      if (!adapter || !adapter.isConfigured(env) || isUnhealthy(providerName) || !quotaAllows(providerName)) {
        continue;
      }
      const model = resolveModel(providerName, task);
      logger.info('llm.stream_start', { task, provider: providerName, model });
      const textStream = (async function* () {
        // Cache check first: replay cached text as chunks.
        if (CACHE_ENABLED) {
          const hit = cacheGet(cacheKey(task, prompt, jsonSchema));
          if (hit) {
            logger.info('llm.cache_hit', { task, provider: hit.provider, stream: true });
            yield hit.text;
            return;
          }
        }
        try {
          yield* adapter.generateStream({
            prompt,
            jsonSchema,
            model,
            timeoutMs: REQUEST_TIMEOUT_MS,
            env,
            fetchImpl,
          });
          recordUsage(providerName, { promptTokens: 0, completionTokens: 0, totalTokens: 0 });
        } catch (err) {
          if (err instanceof ProviderUnavailableError) {
            unhealthyUntil.set(providerName, Date.now() + COOLDOWN_MS);
          }
          throw err;
        }
      })();
      return { provider: providerName, model, textStream };
    }
    if (MOCK_ENABLED && !anyProviderConfigured()) {
      const m = mockResult(task, prompt, schema);
      return {
        provider: 'mock',
        model: 'mock',
        textStream: (async function* () {
          // word-by-word so UIs can exercise their streaming path
          for (const word of m.text.split(/(\s+)/)) {
            if (word) yield word;
          }
        })(),
      };
    }
    throw new NoProviderAvailableError(task, []);
  }

  async function embed(texts) {
    if (!Array.isArray(texts) || texts.length === 0) throw new Error('embed(texts) needs a non-empty array');
    const taskCfg = config.tasks?.embed || { chain: ['gemini'] };

    const budget = budgetAllows('embed');
    if (!budget.allowed) throw new BudgetExhaustedError(budget.reason);

    for (const providerName of taskCfg.chain) {
      const adapter = ADAPTERS[providerName];
      if (!adapter || !adapter.isConfigured(env) || isUnhealthy(providerName)) continue;
      try {
        const out = await adapter.embed({
          texts,
          model: config.providers?.[providerName]?.embeddingModel,
          timeoutMs: REQUEST_TIMEOUT_MS,
          env,
          fetchImpl,
        });
        recordUsage(providerName, { promptTokens: 0, completionTokens: 0, totalTokens: 0 });
        logger.info('llm.embed', { provider: providerName, count: texts.length });
        return { vectors: out.vectors, model: out.model, dimensions: out.dimensions, provider: providerName };
      } catch (err) {
        // "does not provide embeddings" is a capability gap, not an outage:
        // try the next provider in the chain without a cool-down.
        if (err instanceof Error && /does not provide embeddings/.test(err.message)) continue;
        if (err instanceof ProviderUnavailableError) {
          unhealthyUntil.set(providerName, Date.now() + COOLDOWN_MS);
        }
        logger.warn('llm.embed_failed', { provider: providerName, error: err.message });
      }
    }

    if (MOCK_ENABLED && !anyProviderConfigured()) {
      const dimensions = config.providers?.gemini?.embeddingDimensions ?? 768;
      logger.info('llm.mock', { task: 'embed' });
      return {
        vectors: texts.map((t) => mockVector(dimensions, t)),
        model: 'mock',
        dimensions,
        provider: 'mock',
      };
    }
    throw new NoProviderAvailableError('embed', []);
  }

  return {
    generate,
    embed,
    budgetAllows,
    // Introspection for tests/ops (not part of the public contract):
    _config: config,
    _state: { unhealthyUntil, usage, daily, cache },
    _adapters: ADAPTERS,
  };
}

/** Default singleton (reads process.env lazily at call time). */
export const gateway = createGateway();

export { geminiAdapter, groqAdapter, openrouterAdapter, ollamaAdapter };
export * from './errors.js';
