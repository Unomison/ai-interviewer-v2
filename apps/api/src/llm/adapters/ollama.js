/**
 * Ollama adapter — DEV ONLY (spec Section 0.3: heavy local tooling never in
 * the visitor's path).
 *
 * POST {base}/api/chat  { model, messages, stream: false, format: "json" }
 * -> { message: { content }, prompt_eval_count, eval_count }
 *
 * The gateway only considers this adapter when OLLAMA_ENABLED=true AND
 * OLLAMA_BASE_URL is set (default http://localhost:11434).
 */

import { httpError, ProviderUnavailableError } from '../errors.js';

const DEFAULT_BASE = 'http://localhost:11434';

function baseUrl(env) {
  return (env.OLLAMA_BASE_URL || DEFAULT_BASE).replace(/\/$/, '');
}

function classifyNetworkError(err) {
  if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
    return new ProviderUnavailableError('ollama', 'request timed out', { cause: err });
  }
  return new ProviderUnavailableError('ollama', `network error: ${err?.message || err}`, {
    cause: err,
  });
}

export const ollamaAdapter = {
  name: 'ollama',
  keyEnv: null, // no key; gated by OLLAMA_ENABLED instead
  supportsStreaming: false,

  isConfigured(env) {
    return env.OLLAMA_ENABLED === 'true' && Boolean(env.OLLAMA_BASE_URL || true);
  },

  async generate({ prompt, jsonSchema = null, model, timeoutMs, env, fetchImpl = fetch }) {
    const url = `${baseUrl(env)}/api/chat`;
    const body = {
      model,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
    };
    // format:"json" asks Ollama for JSON mode; schema validation still
    // happens in the gateway (Zod), like every other provider.
    if (jsonSchema) body.format = 'json';

    let res;
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw classifyNetworkError(err);
    }
    if (!res.ok) {
      let snippet = '';
      try {
        snippet = (await res.text()).slice(0, 500);
      } catch {
        /* ignore */
      }
      throw httpError('ollama', res.status, snippet);
    }
    let data;
    try {
      data = await res.json();
    } catch (err) {
      throw new ProviderUnavailableError('ollama', 'invalid JSON in response', { cause: err });
    }
    return {
      text: data?.message?.content ?? '',
      usage: {
        promptTokens: data?.prompt_eval_count ?? 0,
        completionTokens: data?.eval_count ?? 0,
        totalTokens: (data?.prompt_eval_count ?? 0) + (data?.eval_count ?? 0),
      },
      model,
    };
  },

  // M2: single-chunk passthrough; real NDJSON streaming can come later.
  async *generateStream(args) {
    const { text } = await this.generate(args);
    yield text;
  },

  async embed() {
    throw new Error('ollama adapter does not provide embeddings in M2');
  },
};
