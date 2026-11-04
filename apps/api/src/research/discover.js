/**
 * Milestone 7 — URL discovery (spec Section 4.3, ADR 008).
 *
 * Goal: 3–5 official public pages for a company (+ optional role):
 * careers page, about page, engineering blog.
 *
 * Strategies, in order (all keyless and server-safe unless noted):
 *  1. Deterministic official-domain guessing — `{slug}.com` + well-known
 *     paths (/careers, /about, /about-us). Zero network cost to *propose*;
 *     each candidate is verified by the fetcher. Surprisingly effective for
 *     real companies and immune to search-API blocking.
 *  2. LLM-suggested URLs — ask the gateway for likely official URLs, then
 *     verify each with a fetch. Strongest signal, but needs LLM keys
 *     (production Render has them; without keys this step is skipped).
 *  3. DuckDuckGo keyless HTML endpoint — best effort ONLY. Measured
 *     2026-11-04: both html.duckduckgo.com (HTTP 202) and lite.duckduckgo.com
 *     (anomaly challenge page) are blocked from datacenter IPs, exactly as
 *     the spec warned ("datacenter IPs are sometimes blocked"). Kept as a
 *     fallback for networks where it works; never depended upon.
 *
 * Reliability tradeoffs are documented in ADR 008.
 */

import { RESEARCH_USER_AGENT } from './fetch.js';

const CORPORATE_SUFFIXES =
  /\b(inc|incorporated|corp|corporation|ltd|limited|llc|llp|plc|gmbh|pvt|technologies|technology|labs|laboratories|systems|solutions|group|holdings)\.?$/i;

/** "Nokia" -> "nokia"; "Goldman Sachs" -> "goldmansachs". */
export function companyToSlug(company) {
  return String(company || '')
    .toLowerCase()
    .trim()
    .replace(CORPORATE_SUFFIXES, '')
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 40);
}

/**
 * Deterministic candidates — no network needed to propose. The fetcher
 * verifies each (DNS/HTTP failures just drop the candidate).
 */
export function deterministicUrls(company) {
  const slug = companyToSlug(company);
  if (!slug) return [];
  const urls = [];
  for (const host of [`https://www.${slug}.com`, `https://${slug}.com`]) {
    urls.push(`${host}/careers/`);
    urls.push(`${host}/about-us/`);
    urls.push(`${host}/about/`);
  }
  return [...new Set(urls)];
}

/** Parse DDG HTML-endpoint results into absolute URLs (best effort). */
export function parseDdgHtml(html) {
  const out = [];
  const re = /class="result__a"[^>]*href="([^"]+)"/gi;
  let m;
  while ((m = re.exec(String(html || ''))) && out.length < 10) {
    let href = m[1];
    // DDG wraps results in //duckduckgo.com/l/?uddg=<encoded>
    const uddg = href.match(/[?&]uddg=([^&]+)/);
    if (uddg) {
      try {
        href = decodeURIComponent(uddg[1]);
      } catch {
        continue;
      }
    }
    if (/^https?:\/\//i.test(href) && !/duckduckgo\.com/i.test(href)) out.push(href);
  }
  return [...new Set(out)];
}

/**
 * Best-effort DDG search. Resolves to [] on any failure (blocked IP,
 * challenge page, timeout) — callers must not depend on it.
 */
export async function ddgSearch(query, { fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  try {
    const res = await fetchImpl(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      {
        headers: { 'User-Agent': RESEARCH_USER_AGENT },
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    if (!res.ok) return [];
    const html = await res.text();
    // Challenge/anomaly pages carry no results.
    if (/anomaly|captcha/i.test(html)) return [];
    return parseDdgHtml(html);
  } catch {
    return [];
  }
}

/**
 * Ask the LLM for likely official URLs (careers / about / engineering blog).
 * Returns [] when the gateway is in mock mode (no keys) — discovery must
 * never consume mock output.
 */
export async function llmSuggestUrls(company, role, gw) {
  try {
    const prompt =
      `List the most likely OFFICIAL public web pages for the company "${company}"` +
      (role ? ` relevant to a "${role}" role` : '') +
      `: the careers/jobs page, the about page, and the engineering blog if one exists. ` +
      `Output ONLY a JSON array of absolute https:// URLs (3-6 items), no prose. ` +
      `Prefer the company's own domain. Never invent URLs for companies you are unsure about — ` +
      `return an empty array instead.`;
    const res = await gw.generate({ task: 'research', prompt, schema: null });
    if (res.provider === 'mock') return [];
    let urls = [];
    try {
      urls = JSON.parse(String(res.text || res.data || '[]'));
    } catch {
      return [];
    }
    return [...new Set(urls)].filter((u) => /^https?:\/\//i.test(u)).slice(0, 6);
  } catch {
    return [];
  }
}

export const MAX_DISCOVERY_URLS = 5;

/**
 * Full discovery pipeline.
 * @returns {Promise<{ urls: string[], strategies: object }>}
 */
export async function discoverUrls(
  company,
  role = '',
  { fetchImpl = fetch, gateway = null, maxUrls = MAX_DISCOVERY_URLS } = {},
) {
  const strategies = { deterministic: 0, llm: 0, ddg: 0 };
  const urls = [];

  // 1. Deterministic guesses (always available).
  for (const u of deterministicUrls(company)) {
    if (urls.length >= maxUrls) break;
    if (!urls.includes(u)) {
      urls.push(u);
      strategies.deterministic += 1;
    }
  }

  // 2. LLM suggestions (needs real keys).
  if (gateway && urls.length < maxUrls) {
    const suggested = await llmSuggestUrls(company, role, gateway);
    for (const u of suggested) {
      if (urls.length >= maxUrls) break;
      if (!urls.includes(u)) {
        urls.push(u);
        strategies.llm += 1;
      }
    }
  }

  // 3. DDG best-effort (usually blocked from servers; harmless when it is).
  if (urls.length < maxUrls) {
    const queries = [
      `${company} official careers page`,
      `${company} about company`,
    ];
    if (role) queries.push(`${company} ${role} engineering blog`);
    for (const q of queries) {
      if (urls.length >= maxUrls) break;
      const found = await ddgSearch(q, { fetchImpl });
      for (const u of found) {
        if (urls.length >= maxUrls) break;
        if (!urls.includes(u)) {
          urls.push(u);
          strategies.ddg += 1;
        }
      }
    }
  }

  return { urls: urls.slice(0, maxUrls), strategies };
}
