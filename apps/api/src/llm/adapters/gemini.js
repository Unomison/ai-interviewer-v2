/**
 * Gemini adapter — Google AI Studio (Gemini Developer API).
 *
 * REST: POST {base}/v1beta/models/{model}:generateContent
 *   header: x-goog-api-key: KEY   (never in the URL)
 *   body: { contents: [{ parts: [{ text }] }],
 *           generationConfig: { responseMimeType: "application/json",
 *                               responseSchema: <json-schema> } }
 * -> { candidates: [{ content: { parts: [{ text }] } }],
 *      usageMetadata: { promptTokenCount, candidatesTokenCount,
 *                       totalTokenCount } }
 *
 * Structured output via responseMimeType + responseSchema (spec Section 8).
 * Embeddings: POST {base}/v1beta/models/{model}:embedContent
 *   { content: { parts: [{ text }] } } -> { embedding: { values: [...] } }
 */

import { httpError, ProviderUnavailableError } from '../errors.js';

const DEFAULT_BASE = 'https://generativelanguage.googleapis.com';

function baseUrl(env) {
  return (env.GEMINI_BASE_URL || DEFAULT_BASE).replace(/\/$/, '');
}

function classifyNetworkError(err) {
  if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
    return new ProviderUnavailableError('gemini', 'request timed out', { cause: err });
  }
  return new ProviderUnavailableError('gemini', `network error: ${err?.message || err}`, {
    cause: err,
  });
}

async function postJson(url, apiKey, body, timeoutMs, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
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
    throw httpError('gemini', res.status, snippet);
  }
  try {
    return await res.json();
  } catch (err) {
    throw new ProviderUnavailableError('gemini', 'invalid JSON in response', { cause: err });
  }
}

function extractText(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts.map((p) => p.text || '').join('');
}

function extractUsage(data) {
  const u = data?.usageMetadata || {};
  return {
    promptTokens: u.promptTokenCount ?? 0,
    completionTokens: u.candidatesTokenCount ?? 0,
    totalTokens: u.totalTokenCount ?? 0,
  };
}

/**
 * Gemini's responseSchema accepts only a subset of JSON Schema (OpenAPI 3.0-ish:
 * type, enum, properties, required, items, format, description, nullable).
 * zod-to-json-schema emits `additionalProperties: false` (and `$schema`),
 * which Gemini rejects with 400 "Unknown name \"additionalProperties\"".
 * Seen live 2026-11-04. Strip unsupported keywords recursively; the shape
 * stays identical for validation purposes.
 */
function sanitizeSchemaForGemini(schema) {
  if (Array.isArray(schema)) return schema.map(sanitizeSchemaForGemini);
  if (schema && typeof schema === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(schema)) {
      if (k === 'additionalProperties' || k === '$schema') continue;
      out[k] = sanitizeSchemaForGemini(v);
    }
    // zod-to-json-schema emits nullable as type: ["string", "null"] (JSON
    // Schema unions). Gemini's OpenAPI 3.0 subset rejects union types;
    // convert to the OpenAPI 3.0 nullable form it understands.
    if (Array.isArray(out.type) && out.type.includes('null')) {
      const nonNull = out.type.filter((t) => t !== 'null');
      out.type = nonNull.length === 1 ? nonNull[0] : nonNull;
      out.nullable = true;
    }
    return out;
  }
  return schema;
}

export const geminiAdapter = {
  name: 'gemini',
  keyEnv: 'GEMINI_API_KEY',
  supportsStreaming: true,

  isConfigured(env) {
    return Boolean(env.GEMINI_API_KEY);
  },

  async generate({ prompt, jsonSchema = null, model, timeoutMs, env, fetchImpl = fetch }) {
    const url = `${baseUrl(env)}/v1beta/models/${model}:generateContent`;
    const generationConfig = {};
    if (jsonSchema) {
      generationConfig.responseMimeType = 'application/json';
      generationConfig.responseSchema = sanitizeSchemaForGemini(jsonSchema);
    }
    const data = await postJson(
      url,
      env.GEMINI_API_KEY,
      { contents: [{ parts: [{ text: prompt }] }], generationConfig },
      timeoutMs,
      fetchImpl
    );
    return { text: extractText(data), usage: extractUsage(data), model };
  },

  // M2: single-chunk passthrough. True token streaming (streamGenerateContent
  // SSE) is wired in M8 with the interviewer's SSE path.
  async *generateStream(args) {
    const { text } = await this.generate(args);
    yield text;
  },

  async embed({ texts, model, timeoutMs, env, fetchImpl = fetch }) {
    const url = `${baseUrl(env)}/v1beta/models/${model}:embedContent`;
    const vectors = [];
    for (const text of texts) {
      const data = await postJson(
        url,
        env.GEMINI_API_KEY,
        { content: { parts: [{ text }] } },
        timeoutMs,
        fetchImpl
      );
      vectors.push(data?.embedding?.values || []);
    }
    return { vectors, model, dimensions: vectors[0]?.length ?? 0 };
  },
};
