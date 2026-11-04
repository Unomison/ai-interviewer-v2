/**
 * Milestone 7 — on-demand research orchestrator (spec Section 4.3, ADR 008).
 *
 * researchCompany({ company, role, budgetMs }) runs the whole pipeline:
 *   cache → discover → fetch (≤3 concurrent) → extract → summarize → cache
 *
 * Hard server constraints (ADR 002 decision 3):
 *  - ~60s time-box, enforced here. On timeout the run returns gracefully
 *    with `source: 'partial'` and whatever was gathered — never a throw.
 *  - Only `fresh` (fully summarized) KBs are cached. Partials are returned
 *    to the caller but never stored.
 *  - Total failure (no pages at all) returns `source: 'failed'` with
 *    `fallback: 'role-generic'` so M8 can continue with generic patterns.
 *  - The HTTP layer always answers 200; research outcomes are data.
 *
 * All side-effecting deps are injectable for tests:
 *   { fetchPage, discoverUrls, gateway, getCachedKb, setCachedKb, now }
 */

import { fetchPage as realFetchPage } from './fetch.js';
import { discoverUrls as realDiscoverUrls } from './discover.js';
import { htmlToText } from './extract.js';
import { summarizeResearch } from './summarize.js';
import { getCachedKb as realGetCachedKb, setCachedKb as realSetCachedKb } from './cache.js';
import { gateway as realGateway } from '../llm/index.js';

export const RESEARCH_BUDGET_MS = 60000;
export const MAX_PAGES = 5;
export const FETCH_CONCURRENCY = 3;

/**
 * @returns {Promise<{
 *   company, role, source: 'cache'|'fresh'|'partial'|'failed',
 *   kb: object|null, pages: Array<{url,title,chars}>,
 *   extracts?: Array<{url,title,text}>, strategies?: object,
 *   ms: number, note?: string, fallback?: 'role-generic'
 * }>}
 */
export async function researchCompany({
  company,
  role = '',
  budgetMs = RESEARCH_BUDGET_MS,
  fetchPage = realFetchPage,
  discoverUrls = realDiscoverUrls,
  gateway = realGateway,
  getCachedKb = realGetCachedKb,
  setCachedKb = realSetCachedKb,
  now = Date.now,
} = {}) {
  const t0 = now();
  const cleanCompany = String(company || '').trim();
  const cleanRole = String(role || '').trim();
  if (!cleanCompany) throw new Error('researchCompany: company is required');
  const deadline = t0 + budgetMs;
  const timeLeft = () => Math.max(0, deadline - now());

  // 1. Cache first — a hit means zero crawl.
  try {
    const cached = await getCachedKb(cleanCompany, cleanRole);
    if (cached?.kb) {
      return {
        company: cleanCompany,
        role: cleanRole,
        source: 'cache',
        kb: { ...cached.kb, provenance: 'cache' },
        pages: (cached.kb.sources || []).map((s) => ({ url: s.url, title: s.title, chars: 0 })),
        ms: now() - t0,
      };
    }
  } catch {
    /* cache read failure must not kill research */
  }

  const gathered = []; // extracted pages accumulated for partial results
  let strategies = {};

  const run = (async () => {
    // 2. Discover candidate URLs.
    if (timeLeft() < 2000) return { timedOut: true };
    const { urls, strategies: s } = await discoverUrls(cleanCompany, cleanRole, {
      gateway,
    });
    strategies = s;

    // 3. Fetch + extract, bounded concurrency, each fetch bounded by timeLeft.
    const queue = urls.slice(0, MAX_PAGES);
    const workers = Array.from({ length: Math.min(FETCH_CONCURRENCY, queue.length) }, async () => {
      while (queue.length > 0 && timeLeft() > 1500) {
        const url = queue.shift();
        try {
          const page = await fetchPage(url, {
            timeoutMs: Math.min(12000, timeLeft()),
          });
          const { title, description, text } = htmlToText(page.html);
          if (text.length < 200) return; // thin/JS-shell page — skip
          const finalUrl = page.finalUrl || url;
          if (gathered.some((g) => g.url === finalUrl)) return; // www/non-www redirect dupes
          gathered.push({
            url: finalUrl,
            title: title || new URL(url).hostname,
            description,
            text,
            ms: page.ms,
          });
        } catch {
          /* per-URL failures are expected (403s, DNS, bot walls) — skip */
        }
      }
    });
    await Promise.all(workers);
    if (gathered.length === 0) return { noPages: true };

    // 4. Summarize via the gateway (ONE call). Mock mode throws loudly —
    //    degrade to `partial` instead of caching fabrications.
    if (timeLeft() < 5000) return { timedOut: true };
    try {
      const kb = await summarizeResearch(cleanCompany, cleanRole, gathered, gateway);
      kb.provenance = 'fresh';

      // 5. Cache the fresh KB (best effort).
      try {
        await setCachedKb(cleanCompany, cleanRole, kb);
      } catch {
        /* cache write failure must not fail the response */
      }
      return { kb };
    } catch (err) {
      return { summarizerDown: err?.message || String(err) };
    }
  })();

  const timeoutRace = new Promise((resolve) => {
    const wait = timeLeft();
    if (wait <= 0) {
      resolve({ timedOut: true });
      return;
    }
    // unref: the deadline timer must not hold the process open after the
    // research itself has settled (matters for tests and the seed script).
    const t = setTimeout(() => resolve({ timedOut: true }), wait);
    if (typeof t.unref === 'function') t.unref();
  });

  const outcome = await Promise.race([run, timeoutRace]);
  const ms = now() - t0;

  const pageSummaries = gathered.map((p) => ({ url: p.url, title: p.title, chars: p.text.length }));

  if (outcome?.kb) {
    return {
      company: cleanCompany,
      role: cleanRole,
      source: 'fresh',
      kb: outcome.kb,
      pages: pageSummaries,
      strategies,
      ms,
    };
  }
  if (outcome?.noPages) {
    return {
      company: cleanCompany,
      role: cleanRole,
      source: 'failed',
      kb: null,
      pages: [],
      strategies,
      ms,
      fallback: 'role-generic',
      note: 'No public pages could be fetched for this company.',
    };
  }
  // Timeout, summarizer down (e.g. mock mode — no keys), or slow discovery:
  // graceful partial with whatever was gathered. Never a throw.
  const extracts = gathered.map((p) => ({
    url: p.url,
    title: p.title,
    text: p.text.slice(0, 2000),
  }));
  let note;
  if (outcome?.summarizerDown) {
    note = /no keys/i.test(outcome.summarizerDown)
      ? 'Summarization needs LLM keys on this server; returning extracted pages only.'
      : `Summarization failed (${outcome.summarizerDown}); returning extracted pages only.`;
  } else {
    note = 'Research hit the 60s time-box; returning what was gathered.';
  }
  if (gathered.length > 0) note += ` ${gathered.length} page(s) extracted below.`;
  return {
    company: cleanCompany,
    role: cleanRole,
    source: 'partial',
    kb: null,
    pages: pageSummaries,
    extracts,
    strategies,
    ms,
    note,
  };
}
