/**
 * Shared HTTP layer for OpenAI-compatible chat endpoints (Groq, OpenRouter).
 *
 * POST {baseUrl}/chat/completions
 *   { model, messages: [{role, content}], response_format?, stream? }
 * -> { choices: [{ message: { content } }], usage: { prompt_tokens,
 *      completion_tokens, total_tokens } }
 *
 * Streaming (SSE) events look like:  data: {"choices":[{"delta":{"content":".."}}]}
 * terminated by:  data: [DONE]
 *
 * `fetchImpl` is injectable so tests can point at fake local servers.
 */

import {
  RateLimitError,
  ProviderUnavailableError,
  AuthError,
  BadRequestError,
  httpError,
} from '../errors.js';

export function providerHeaders(apiKey, extra = {}) {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${apiKey}`,
    ...extra,
  };
}

/** Read the body (up to a cap) for error diagnostics. Never throws. */
async function readErrorSnippet(res, cap = 500) {
  try {
    const text = await res.text();
    return text.slice(0, cap);
  } catch {
    return '';
  }
}

function classifyNetworkError(provider, err) {
  if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
    return new ProviderUnavailableError(provider, `request timed out`, { cause: err });
  }
  return new ProviderUnavailableError(provider, `network error: ${err?.message || err}`, {
    cause: err,
  });
}

/**
 * Non-streaming chat completion. Returns { text, usage, model }.
 * Throws the classified LlmError taxonomy on failure.
 */
export async function chatCompletion({
  provider,
  baseUrl,
  apiKey,
  model,
  prompt,
  jsonSchema = null,
  timeoutMs,
  fetchImpl = fetch,
  extraHeaders = {},
  extraBody = {},
}) {
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    ...extraBody,
  };
  if (jsonSchema) body.response_format = { type: 'json_object' };

  let res;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: providerHeaders(apiKey, extraHeaders),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw classifyNetworkError(provider, err);
  }

  if (!res.ok) {
    throw httpError(provider, res.status, await readErrorSnippet(res));
  }

  let data;
  try {
    data = await res.json();
  } catch (err) {
    throw new ProviderUnavailableError(provider, 'invalid JSON in response', { cause: err });
  }

  const text = data?.choices?.[0]?.message?.content ?? '';
  const usage = {
    promptTokens: data?.usage?.prompt_tokens ?? 0,
    completionTokens: data?.usage?.completion_tokens ?? 0,
    totalTokens: data?.usage?.total_tokens ?? 0,
  };
  return { text, usage, model: data?.model || model };
}

/**
 * Streaming chat completion. Async generator yielding text deltas.
 * Throws the same taxonomy (failures surface on first read).
 */
export async function* chatCompletionStream({
  provider,
  baseUrl,
  apiKey,
  model,
  prompt,
  jsonSchema = null,
  timeoutMs,
  fetchImpl = fetch,
  extraHeaders = {},
  extraBody = {},
}) {
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    stream: true,
    ...extraBody,
  };
  if (jsonSchema) body.response_format = { type: 'json_object' };

  let res;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: providerHeaders(apiKey, extraHeaders),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw classifyNetworkError(provider, err);
  }
  if (!res.ok) throw httpError(provider, res.status, await readErrorSnippet(res));

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop();
      for (const event of events) {
        for (const line of event.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') return;
          try {
            const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content;
            if (delta) yield delta;
          } catch {
            /* ignore malformed SSE frames */
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// Re-export for adapters that want the taxonomy without a second import.
export { RateLimitError, ProviderUnavailableError, AuthError, BadRequestError };
