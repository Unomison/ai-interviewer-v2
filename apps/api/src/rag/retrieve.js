/**
 * Milestone 11 — retrieval orchestration (spec §4.9, ADR 012).
 *
 * The four spec uses:
 *   (1) planner      → getRagContext() — company/role pattern chunks for the
 *       planner prompt, replacing/augmenting the direct KB read.
 *   (2) per-turn     → retrieveForTurn() — bounded top-k patterns for
 *       follow-up questions, cached per session.
 *   (3) dedup        → noteAskedQuestions() + dedup nudge — embedding
 *       similarity against already-asked questions.
 *   (4) citations    → citationsFor() — source_urls travel with chunks into
 *       the session and the M10 report.
 *
 * Hybrid retrieval (spec): vector score blended with a deterministic keyword
 * overlap score, plus metadata pre-filters (company/role/round/topic).
 * Reranking: the hybrid scorer IS the ranker; setReranker() allows a swap
 * if evals ever show the need (they didn't — see docs/rag-measurement.md).
 *
 * Everything here is best-effort: any failure degrades to "no retrieval"
 * (the M7/M8 direct-KB path), never a throw past this module's boundary.
 */

import { gateway as defaultGateway } from '../llm/index.js';
import { getCachedKb } from '../research/cache.js';
import { EMBEDDING_IDENTITY, embedTexts, checkEmbeddingIdentity } from './embed.js';
import { getVectorStore } from './store.js';

export const RAG_TOP_K = 4;
export const RAG_TURN_TOP_K = 3;
/** Cosine similarity above which an interviewer question counts as a repeat. */
export const DEDUP_SIMILARITY_THRESHOLD = 0.92;
const TURN_CACHE_TTL_MS = 5 * 60 * 1000;
const LEDGER_TTL_MS = 24 * 60 * 60 * 1000;
const LEDGER_MAX_QUESTIONS = 50;

const STOPWORDS = new Set(
  'a,an,the,of,for,to,in,on,at,by,with,from,as,is,are,was,were,be,been,do,does,did,what,when,where,which,who,how,why,can,could,should,would,you,your,we,our,they,their,it,its,this,that,these,those,and,or,not,no,me,my,i'.split(','),
);

function tokens(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !STOPWORDS.has(t));
}

/** Deterministic keyword overlap in [0,1]. Exported for tests. */
export function keywordOverlap(query, text) {
  const q = new Set(tokens(query));
  if (q.size === 0) return 0;
  const t = new Set(tokens(text));
  let hit = 0;
  for (const tok of q) if (t.has(tok)) hit++;
  return hit / q.size;
}

/**
 * Hybrid score: 0.7 vector cosine + 0.3 keyword overlap.
 * The vector term carries semantic signal (real embeddings); the keyword
 * term keeps retrieval sane for jargon-heavy queries. Weights are
 * documented, not tuned — see docs/rag-measurement.md.
 */
export function hybridScore(vectorScore, kwScore) {
  return 0.7 * vectorScore + 0.3 * kwScore;
}

let reranker = null;
/** Swap the ranker if evals ever show the need (spec §4.9). */
export function setReranker(fn) {
  reranker = fn;
}
export function getReranker() {
  return reranker;
}

function defaultRank(query, scored) {
  return scored
    .map((s) => ({ ...s, hybrid: hybridScore(s.score, keywordOverlap(query, s.chunk.text)) }))
    .sort((a, b) => b.hybrid - a.hybrid);
}

/**
 * Vector + hybrid retrieval over the store.
 *
 * @returns {Promise<{ chunks: Array<{text, metadata, score, hybrid}>, latencyMs, mode: 'vector' }>}
 */
export async function retrieveRelevant(
  { query, company = null, role = null, round = null, topic = null, limit = RAG_TOP_K },
  deps = {},
) {
  const t0 = Date.now();
  const gw = deps.gw || defaultGateway;
  const store = deps.store || getVectorStore();
  const q = String(query || '').trim();
  if (!q) return { chunks: [], latencyMs: 0, mode: 'vector' };

  const emb = await embedTexts([q], gw);
  const check = checkEmbeddingIdentity(emb);
  if (!check.ok) throw new Error(`RAG embed identity: ${check.reason}`);

  const filters = { company, role, round, topic };
  const scored = await store.query(emb.vectors[0], { filters, limit: limit * 3 });
  const ranked = (reranker || defaultRank)(q, scored);
  return {
    chunks: ranked.slice(0, limit).map((r) => ({
      text: r.chunk.text,
      metadata: r.chunk.metadata || {},
      source_url: r.chunk.metadata?.source_url || null,
      score: r.score,
      hybrid: r.hybrid ?? r.score,
    })),
    latencyMs: Date.now() - t0,
    mode: 'vector',
  };
}

/**
 * Planner entry point (spec use #1).
 *
 * Tries vector retrieval; falls back to the direct M7 KB read when the
 * index isn't ready (or anything fails). Never throws.
 *
 * @returns {Promise<{ mode: 'vector'|'direct'|'none', chunks, citations, latencyMs, note }>}
 */
export async function getRagContext({ company, role = '', kb = null, gw } = {}, deps = {}) {
  const t0 = Date.now();
  const store = deps.store || getVectorStore();
  const gateway = gw || deps.gw || defaultGateway;

  try {
    const ready = await store.indexReady();
    if (ready.ready && company) {
      const res = await retrieveRelevant(
        {
          query: `${company} ${role} interview patterns topics questions`,
          company,
          role: role || null,
          limit: RAG_TOP_K,
        },
        { gw: gateway, store },
      );
      if (res.chunks.length > 0) {
        return {
          mode: 'vector',
          chunks: res.chunks,
          citations: citationsFor(res.chunks),
          latencyMs: Date.now() - t0,
          note: `retrieved ${res.chunks.length} chunks via vector search`,
        };
      }
    }
  } catch {
    /* fall through to direct KB */
  }

  // Fallback: the M8 direct KB read (spec: "the planner reads research.json directly").
  let directKb = kb;
  if (!directKb && company) {
    try {
      const cached = await getCachedKb(company, role);
      directKb = cached?.kb || null;
    } catch {
      directKb = null;
    }
  }
  if (directKb) {
    return {
      mode: 'direct',
      chunks: [],
      citations: (directKb.sources || []).slice(0, 8).map((s) => ({ url: s.url, topic: s.title || 'source' })),
      latencyMs: Date.now() - t0,
      note: 'vector index not ready — planner reads the KB document directly (M7/M8 path)',
      kb: directKb,
    };
  }
  return { mode: 'none', chunks: [], citations: [], latencyMs: Date.now() - t0, note: 'no company research available' };
}

/** Dedupe source URLs from chunks into [{ url, topic }]. */
export function citationsFor(chunks) {
  const seen = new Map();
  for (const c of chunks || []) {
    const url = c.source_url || c.metadata?.source_url;
    if (!url || seen.has(url)) continue;
    seen.set(url, { url, topic: c.metadata?.topic || 'company research' });
  }
  return [...seen.values()];
}

// ---- per-turn retrieval (spec use #2) ----

const turnCache = new Map(); // token -> { at, key, extra }

function turnCacheKey(session, candidateText) {
  return `${session.currentRound}|${String(candidateText || '').slice(0, 80)}`;
}

/**
 * Bounded per-turn retrieval for follow-up questions. Returns a string to
 * append to the interviewer's extraContext ('' when retrieval is skipped).
 * Skipped (cheaply, no embed call) when: no company, short candidate text,
 * or a fresh cache entry exists. Never throws.
 */
export async function retrieveForTurn({ session, candidateText = '', gw } = {}, deps = {}) {
  try {
    if (!session?.company) return '';
    const text = String(candidateText || '').trim();
    if (text.length < 20) return '';
    if (!['resume', 'cs', 'behavioral'].includes(session.currentRound)) return '';

    const key = turnCacheKey(session, text);
    const cached = turnCache.get(session.token);
    if (cached && cached.key === key && Date.now() - cached.at < TURN_CACHE_TTL_MS) {
      return cached.extra;
    }

    const store = deps.store || getVectorStore();
    const ready = await store.indexReady();
    if (!ready.ready) return '';

    const res = await retrieveRelevant(
      { query: text, company: session.company, role: session.role, round: session.currentRound, limit: RAG_TURN_TOP_K },
      { gw: gw || defaultGateway, store },
    );
    let extra = '';
    if (res.chunks.length > 0) {
      const lines = res.chunks.map((c) => `- ${c.metadata?.topic || 'pattern'}: ${c.text.slice(0, 220)}`);
      extra = `Retrieved company patterns (use for a sharper follow-up if relevant):\n${lines.join('\n')}`;
    }
    const nudge = dedupNudge(session.token);
    if (nudge) extra += (extra ? '\n' : '') + nudge;
    turnCache.set(session.token, { at: Date.now(), key, extra });
    return extra;
  } catch {
    return '';
  }
}

// ---- question dedup (spec use #3) ----

const ledger = new Map(); // token -> { at, questions: [{ q, v }] }

function extractQuestions(text) {
  return String(text || '')
    .split(/(?<=[?!])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.endsWith('?') && s.length > 12 && s.length < 300);
}

function ledgerGet(token) {
  const e = ledger.get(token);
  if (!e || Date.now() - e.at > LEDGER_TTL_MS) {
    ledger.delete(token);
    return { at: Date.now(), questions: [] };
  }
  return e;
}

/**
 * Record the interviewer's questions from a turn message (best-effort).
 * @returns {Promise<{ recorded: number, duplicates: string[] }>}
 */
export async function noteAskedQuestions({ sessionToken, message, gw } = {}, deps = {}) {
  const out = { recorded: 0, duplicates: [] };
  try {
    const questions = extractQuestions(message);
    if (questions.length === 0 || !sessionToken) return out;
    const gateway = gw || deps.gw || defaultGateway;
    const emb = await embedTexts(questions, gateway);
    const check = checkEmbeddingIdentity(emb);
    if (!check.ok) return out;
    const entry = ledgerGet(sessionToken);
    questions.forEach((q, i) => {
      const v = emb.vectors[i];
      const dup = entry.questions.find((old) => cosineOf(v, old.v) > DEDUP_SIMILARITY_THRESHOLD);
      if (dup) out.duplicates.push(q);
      else {
        entry.questions.push({ q, v });
        out.recorded++;
      }
    });
    entry.questions = entry.questions.slice(-LEDGER_MAX_QUESTIONS);
    entry.at = Date.now();
    ledger.set(sessionToken, entry);
    return out;
  } catch {
    return out;
  }
}

/** Nudge for the next prompt when recent questions were near-duplicates. */
export function dedupNudge(sessionToken) {
  const entry = ledger.get(sessionToken);
  if (!entry || entry.questions.length === 0) return '';
  const recent = entry.questions.slice(-3).map((q) => `"${q.q}"`);
  return `Avoid re-asking questions already covered: ${recent.join('; ')}.`;
}

function cosineOf(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

/** Test helpers: clear module caches. */
export function _clearRagCaches() {
  turnCache.clear();
  ledger.clear();
}

export { EMBEDDING_IDENTITY };
