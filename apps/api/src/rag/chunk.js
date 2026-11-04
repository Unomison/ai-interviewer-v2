/**
 * Milestone 11 — KB chunking (spec §4.9).
 *
 * Turns an M7 knowledge-base JSON document into compact, self-contained
 * chunks, each carrying the spec's metadata:
 *   company, role, round, topic, difficulty, year, source_url, confidence
 * plus bookkeeping: kind, chunk_index, source_id, ingested_at,
 * embedding_model, embedding_dim.
 *
 * Design notes (ADR 012):
 * - One chunk per interview angle (the highest-signal unit for the planner),
 *   one for the overview, one for the tech stack, one per practice/culture
 *   item, one per recent development. Chunks stay ≤ MAX_CHUNK_CHARS so the
 *   512 MB Atlas cap is never a concern (a company KB is ~15-30 chunks).
 * - `round` is null for KB chunks: company knowledge applies to every round;
 *   metadataMatches() treats null as a wildcard.
 * - Confidence is heuristic and documented: provenance fresh > cache >
 *   partial, angles > overview > stack > practices > culture. The ingestion
 *   tool prunes below a threshold (default 0.55).
 */

export const MAX_CHUNK_CHARS = 600;
/** Default prune threshold for the ingestion tool. */
export const DEFAULT_MIN_CONFIDENCE = 0.55;

const PROVENANCE_CONFIDENCE = { fresh: 0.85, cache: 0.75, partial: 0.55 };

function provenanceOf(kb) {
  const p = kb?.provenance;
  return PROVENANCE_CONFIDENCE[p] ?? 0.6;
}

function yearOf(kb) {
  const m = String(kb?.researchedAt || '').match(/^(\d{4})/);
  return m ? Number(m[1]) : null;
}

function clean(s, max = MAX_CHUNK_CHARS) {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * @param {object} kb        validated M7 KB JSON document
 * @param {object} opts      { sourceId, embeddingModel, embeddingDim, ingestedAt }
 * @returns {Array} chunks, each { chunkId, sourceId, text, metadata, ingestedAt,
 *   embeddingModel, embeddingDim } — embedding filled in by the caller.
 */
export function chunkKbDocument(kb, opts = {}) {
  if (!kb || typeof kb !== 'object' || !kb.company) return [];
  const {
    sourceId = `kb:${String(kb.company).toLowerCase()}|${String(kb.role || '').toLowerCase()}`,
    embeddingModel = null,
    embeddingDim = null,
    ingestedAt = new Date().toISOString(),
  } = opts;

  const company = kb.company;
  const role = kb.role || null;
  const year = yearOf(kb);
  const baseConf = provenanceOf(kb);
  const chunks = [];
  let idx = 0;
  const push = (kind, text, extra = {}) => {
    const t = clean(text);
    if (!t) return;
    chunks.push({
      chunkId: `${sourceId}#${idx}`,
      sourceId,
      text: t,
      metadata: {
        company,
        role,
        round: null,
        topic: extra.topic || null,
        difficulty: null,
        year,
        source_url: extra.source_url || null,
        confidence: Math.min(1, Math.max(0, extra.confidence ?? baseConf)),
        kind,
        chunk_index: idx,
      },
      ingestedAt,
      embeddingModel,
      embeddingDim,
    });
    idx++;
  };

  // Overview — one chunk, highest confidence.
  if (kb.overview) {
    push('overview', `Company overview — ${company}: ${kb.overview}`, {
      topic: 'company overview',
      source_url: kb.sources?.[0]?.url || null,
      confidence: Math.min(1, baseConf + 0.05),
    });
  }

  // Tech stack — one compact chunk.
  if (Array.isArray(kb.techStack) && kb.techStack.length > 0) {
    push('tech-stack', `${company} tech stack signals: ${kb.techStack.join(', ')}.`, {
      topic: 'tech stack',
      source_url: kb.sources?.[0]?.url || null,
      confidence: baseConf - 0.1,
    });
  }

  // Interview angles — one chunk EACH (the planner's highest-signal unit).
  for (const angle of kb.interviewAngles || []) {
    push('angle', `Interview angle — ${angle.topic}: ${angle.why}`, {
      topic: angle.topic,
      source_url: angle.sourceUrls?.[0] || kb.sources?.[0]?.url || null,
      confidence: Math.min(1, baseConf + 0.05),
    });
  }

  // Engineering practices.
  for (const p of kb.engineeringPractices || []) {
    push('practice', `${company} engineering practice: ${p}`, {
      topic: 'engineering practices',
      source_url: kb.sources?.[0]?.url || null,
      confidence: baseConf - 0.15,
    });
  }

  // Culture signals.
  for (const c of kb.culture || []) {
    push('culture', `${company} culture signal: ${c}`, {
      topic: 'culture',
      source_url: kb.sources?.[0]?.url || null,
      confidence: baseConf - 0.2,
    });
  }

  // Recent developments.
  for (const r of kb.recentDevelopments || []) {
    push('news', `${company} recent development: ${r}`, {
      topic: 'recent developments',
      source_url: kb.sources?.[0]?.url || null,
      confidence: baseConf - 0.1,
    });
  }

  return chunks;
}

/** Drop chunks below the confidence threshold (spec: "prune low-confidence ones"). */
export function pruneChunks(chunks, minConfidence = DEFAULT_MIN_CONFIDENCE) {
  return (chunks || []).filter((c) => (c.metadata?.confidence ?? 0) >= minConfidence);
}

/** Total characters across chunks — the 512 MB cap sanity check. */
export function chunksBytes(chunks) {
  return (chunks || []).reduce((n, c) => n + Buffer.byteLength(c.text || '', 'utf8'), 0);
}
