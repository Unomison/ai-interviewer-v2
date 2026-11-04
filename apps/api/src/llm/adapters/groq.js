/**
 * Groq adapter — OpenAI-compatible chat completions.
 *
 * POST {base}/chat/completions, Bearer key, response_format json_object.
 * Default base: https://api.groq.com/openai/v1 (override: GROQ_BASE_URL).
 *
 * Spec Section 8: strongest model for judgement-heavy tasks, fast model for
 * high-volume interviewer turns (see taskModels in config.yaml).
 */

import { chatCompletion, chatCompletionStream } from './openai-compat.js';

const DEFAULT_BASE = 'https://api.groq.com/openai/v1';

function baseUrl(env) {
  return (env.GROQ_BASE_URL || DEFAULT_BASE).replace(/\/$/, '');
}

export const groqAdapter = {
  name: 'groq',
  keyEnv: 'GROQ_API_KEY',
  supportsStreaming: true,

  isConfigured(env) {
    return Boolean(env.GROQ_API_KEY);
  },

  async generate({ prompt, jsonSchema = null, model, timeoutMs, env, fetchImpl = fetch }) {
    return chatCompletion({
      provider: 'groq',
      baseUrl: baseUrl(env),
      apiKey: env.GROQ_API_KEY,
      model,
      prompt,
      jsonSchema,
      timeoutMs,
      fetchImpl,
    });
  },

  async *generateStream(args) {
    yield* chatCompletionStream({
      provider: 'groq',
      baseUrl: baseUrl(args.env),
      apiKey: args.env.GROQ_API_KEY,
      model: args.model,
      prompt: args.prompt,
      jsonSchema: args.jsonSchema ?? null,
      timeoutMs: args.timeoutMs,
      fetchImpl: args.fetchImpl ?? fetch,
    });
  },

  // Groq has no embedding endpoint on the free chat API; the gateway routes
  // embed() to Gemini (spec: one hosted embedding model everywhere).
  async embed() {
    throw new Error('groq adapter does not provide embeddings');
  },
};
