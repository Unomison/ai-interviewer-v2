/**
 * LLM gateway error taxonomy (spec Section 8: graceful degradation).
 *
 * Adapters throw these; the gateway's failover loop decides per class:
 *  - RateLimitError (429)        -> brief back-off, try next provider
 *  - ProviderUnavailableError    -> mark provider unhealthy (cool-down), try next
 *    (503, timeout, network/DNS failure)
 *  - AuthError (401/403)         -> config problem; skip provider, no cool-down
 *  - BadRequestError (400/422)   -> our request is malformed; do NOT fail over
 *    (retrying the same prompt elsewhere wastes quota)
 *  - BudgetExhaustedError        -> global daily budget spent; friendly stop
 *  - ValidationError             -> provider answered but Zod rejected it,
 *    even after the one retry-with-error; fail loudly
 *  - NoProviderAvailableError    -> chain exhausted; the caller shows the
 *    "interviewer is resting" state (spec Section 2)
 */

export class LlmError extends Error {
  constructor(message, { provider = null, code = 'llm_error', status = null, cause = null } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.provider = provider;
    this.code = code;
    this.status = status;
    if (cause) this.cause = cause;
  }
}

export class RateLimitError extends LlmError {
  constructor(provider, { retryAfterMs = null, cause = null } = {}) {
    super(`rate limited by provider "${provider}" (429)`, {
      provider,
      code: 'rate_limited',
      status: 429,
      cause,
    });
    this.retryAfterMs = retryAfterMs;
  }
}

export class ProviderUnavailableError extends LlmError {
  constructor(provider, reason, { status = null, cause = null } = {}) {
    super(`provider "${provider}" unavailable: ${reason}`, {
      provider,
      code: 'provider_unavailable',
      status,
      cause,
    });
  }
}

export class AuthError extends LlmError {
  constructor(provider, status, detail = '') {
    super(`provider "${provider}" rejected the request (HTTP ${status}); check its API key. ${detail}`.trim(), {
      provider,
      code: 'auth_error',
      status,
    });
  }
}

export class BadRequestError extends LlmError {
  constructor(provider, status, detail = '') {
    super(`provider "${provider}" rejected the request as malformed (HTTP ${status}). ${detail}`.trim(), {
      provider,
      code: 'bad_request',
      status,
    });
  }
}

/**
 * The provider rejected the model ID itself (retired, renamed, or never
 * existed for this account). This is a CONFIGURATION problem, not a
 * transient outage: the gateway must not cool-down/retry it, and the
 * message names the fix (update config.yaml) instead of blaming the key.
 */
export class ModelNotFoundError extends LlmError {
  constructor(provider, model, detail = '') {
    super(
      `provider "${provider}": model "${model}" was not found or is retired for this account. ` +
        `Update the model ID in apps/api/src/llm/config.yaml. ${detail}`.trim(),
      { provider, code: 'model_not_found', status: 404 }
    );
    this.model = model;
  }
}

export class BudgetExhaustedError extends LlmError {
  constructor(reason) {
    // Friendly wording: this message may reach the visitor (spec Section 2:
    // "the interviewer is resting" page).
    super(`The interviewer is resting — ${reason}. Please try again tomorrow.`, {
      code: 'budget_exhausted',
    });
  }
}

export class ValidationError extends LlmError {
  constructor(provider, zodError, rawText) {
    super(
      `provider "${provider}" returned output that failed schema validation ` +
        `after one retry: ${zodError.message}`,
      { provider, code: 'validation_failed' }
    );
    this.zodIssues = zodError.issues;
    this.rawText = typeof rawText === 'string' ? rawText.slice(0, 2000) : rawText;
  }
}

export class NoProviderAvailableError extends LlmError {
  constructor(task, attempts) {
    const summary = attempts.map((a) => `${a.provider}: ${a.error}`).join('; ');
    super(
      `no LLM provider could serve task "${task}" (${attempts.length} attempt(s): ${summary || 'none configured'})`,
      { code: 'no_provider_available' }
    );
    this.attempts = attempts;
  }
}

/**
 * Map an HTTP status from a provider into the right error class.
 * `parseDetail` is a best-effort body snippet for the message.
 */
export function httpError(provider, status, parseDetail = '') {
  if (status === 429) return new RateLimitError(provider);
  if (status === 503 || status === 502 || status === 504)
    return new ProviderUnavailableError(provider, `HTTP ${status}`, { status });
  if (status === 401 || status === 403) return new AuthError(provider, status, parseDetail);
  if (status >= 400 && status < 500) {
    // Gemini (and some others) report an invalid API key as 400, not 401.
    // That is an auth problem: skip this provider and fail over instead of
    // treating it as a malformed request (which would burn no quota but also
    // never recover). Matched 2026-11-04 against a live invalid-key 400.
    if (/api key not valid|invalid[ _-]?api[ _-]?key|unauthorized/i.test(parseDetail || '')) {
      return new AuthError(provider, status, parseDetail);
    }
    // Retired/renamed model ID (Groq: {"code":"model_not_found","message":
    // "The model `x` does not exist..."}; Gemini: 404 "models/x is not found").
    // Diagnose the config clearly instead of lumping it with malformed requests.
    if (/model_not_found|model [`'"][^`'"]+[`'"] (was not found|does not exist|is not found)/i.test(parseDetail || '')) {
      const m = /model [`'"]([^`'"]+)[`'"]/i.exec(parseDetail || '');
      return new ModelNotFoundError(provider, m?.[1] || 'unknown', parseDetail);
    }
    return new BadRequestError(provider, status, parseDetail);
  }
  return new ProviderUnavailableError(provider, `HTTP ${status}`, { status });
}
