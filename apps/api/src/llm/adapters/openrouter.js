/**
 * OpenRouter adapter — OpenAI-compatible chat completions.
 *
 * POST {base}/chat/completions, Bearer key, response_format json_object.
 * Default base: https://openrouter.ai/api/v1 (override: OPENROUTER_BASE_URL).
 * Sends HTTP-Referer / X-Title (OpenRouter attribution convention).
 * Key is OPTIONAL: the chain skips this provider when OPENROUTER_API_KEY
 * is absent (owner decision, ADR 002).
 */

import { chatCompletion, chatCompletionStream } from './openai-compat.js';

const DEFAULT_BASE = 'https://openrouter.ai/api/v1';

function baseUrl(env) {
  return (env.OPENROUTER_BASE_URL || DEFAULT_BASE).replace(/\/$/, '');
}

function attribution(env) {
  return {
    'HTTP-Referer': env.OPENROUTER_REFERER || 'https://github.com/Unomison/ai-interviewer-v2',
    'X-Title': 'AI Interviewer (portfolio demo)',
  };
}

export const openrouterAdapter = {
  name: 'openrouter',
  keyEnv: 'OPENROUTER_API_KEY',
  supportsStreaming: true,

  isConfigured(env) {
    return Boolean(env.OPENROUTER_API_KEY);
  },

  async generate({ prompt, jsonSchema = null, model, timeoutMs, env, fetchImpl = fetch }) {
    return chatCompletion({
      provider: 'openrouter',
      baseUrl: baseUrl(env),
      apiKey: env.OPENROUTER_API_KEY,
      model,
      prompt,
      jsonSchema,
      timeoutMs,
      fetchImpl,
      extraHeaders: attribution(env),
    });
  },

  async *generateStream(args) {
    yield* chatCompletionStream({
      provider: 'openrouter',
      baseUrl: baseUrl(args.env),
      apiKey: args.env.OPENROUTER_API_KEY,
      model: args.model,
      prompt: args.prompt,
      jsonSchema: args.jsonSchema ?? null,
      timeoutMs: args.timeoutMs,
      fetchImpl: args.fetchImpl ?? fetch,
      extraHeaders: attribution(args.env),
    });
  },

  async embed() {
    throw new Error('openrouter adapter does not provide embeddings');
  },
};
