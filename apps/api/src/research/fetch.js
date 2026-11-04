/**
 * Milestone 7 — polite plain-HTTP fetcher (spec Section 4.3, ADR 008).
 *
 * No headless browser: Render's free tier cannot run Playwright/Puppeteer,
 * so this is plain fetch() with guardrails:
 *  - per-request timeout (AbortSignal.timeout)
 *  - byte cap per page (streaming reader, then cancel)
 *  - redirects followed by fetch (default, capped at 20)
 *  - clear User-Agent identifying the research bot
 *  - basic robots.txt politeness: Disallow prefixes for `*` are honoured;
 *    robots.txt itself is cached per origin for 10 minutes
 *  - public pages only; 4xx/5xx are skipped, never retried aggressively
 *
 * `fetchImpl` is injectable for tests (defaults to global fetch).
 */

export const RESEARCH_USER_AGENT =
  'AI-Interviewer-Research/1.0 (+https://ai-interviewer-v2-delta.vercel.app; respects robots.txt)';

export const DEFAULT_FETCH_TIMEOUT_MS = 12000;
export const DEFAULT_MAX_BYTES = 400_000;

export class FetchError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FetchError';
    this.code = code; // 'timeout' | 'http' | 'too_large' | 'robots' | 'network'
  }
}

// In-memory robots.txt cache: origin -> { at, rules: string[] }
const robotsCache = new Map();
const ROBOTS_CACHE_MS = 10 * 60 * 1000;

function parseRobots(txt) {
  // Minimal parser: collect Disallow prefixes under `User-agent: *`.
  const rules = [];
  let applies = false;
  for (const rawLine of String(txt).split('\n')) {
    const line = rawLine.split('#')[0].trim();
    if (!line) continue;
    const [field, ...rest] = line.split(':');
    const value = rest.join(':').trim();
    if (/^user-agent$/i.test(field)) {
      applies = value === '*';
    } else if (applies && /^disallow$/i.test(field) && value) {
      rules.push(value);
    }
  }
  return rules;
}

/**
 * @returns {Promise<boolean>} false when robots.txt disallows the path.
 * A missing/unreachable robots.txt means "allowed" (fail-open, standard).
 */
export async function robotsAllows(url, fetchImpl = fetch) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const origin = parsed.origin;
  const cached = robotsCache.get(origin);
  let rules;
  if (cached && Date.now() - cached.at < ROBOTS_CACHE_MS) {
    rules = cached.rules;
  } else {
    try {
      const res = await fetchImpl(`${origin}/robots.txt`, {
        headers: { 'User-Agent': RESEARCH_USER_AGENT },
        signal: AbortSignal.timeout(8000),
      });
      rules = res.ok ? parseRobots(await res.text()) : [];
    } catch {
      rules = [];
    }
    robotsCache.set(origin, { at: Date.now(), rules });
  }
  return !rules.some((prefix) => prefix !== '/' && parsed.pathname.startsWith(prefix))
    && !rules.includes('/');
}

/** Test hook: clear the robots cache. */
export function _clearRobotsCache() {
  robotsCache.clear();
}

/**
 * Fetch one page politely.
 * @returns {Promise<{url, finalUrl, status, html, bytes, ms, title?}>}
 * @throws {FetchError}
 */
export async function fetchPage(
  url,
  { timeoutMs = DEFAULT_FETCH_TIMEOUT_MS, maxBytes = DEFAULT_MAX_BYTES, fetchImpl = fetch } = {},
) {
  const t0 = Date.now();
  let allowed = true;
  try {
    allowed = await robotsAllows(url, fetchImpl);
  } catch {
    allowed = true;
  }
  if (!allowed) {
    throw new FetchError('robots', `Disallowed by robots.txt: ${url}`);
  }

  let res;
  try {
    res = await fetchImpl(url, {
      headers: {
        'User-Agent': RESEARCH_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'follow',
    });
  } catch (err) {
    if (err?.name === 'TimeoutError' || /abort/i.test(err?.name || '')) {
      throw new FetchError('timeout', `Fetch timed out after ${timeoutMs}ms: ${url}`);
    }
    throw new FetchError('network', `Network error for ${url}: ${err?.message || err}`);
  }

  if (!res.ok) {
    throw new FetchError('http', `HTTP ${res.status} for ${url}`);
  }
  const contentType = res.headers?.get?.('content-type') || '';
  if (contentType && !/text\/html|application\/xhtml/i.test(contentType)) {
    throw new FetchError('http', `Non-HTML content (${contentType}): ${url}`);
  }

  // Stream with a byte cap — never buffer an unbounded body.
  const reader = res.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        throw new FetchError('too_large', `Page exceeds ${maxBytes} bytes: ${url}`);
      }
      chunks.push(value);
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* best effort */
    }
  }
  const html = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
  return {
    url,
    finalUrl: res.url || url,
    status: res.status,
    html,
    bytes,
    ms: Date.now() - t0,
  };
}
