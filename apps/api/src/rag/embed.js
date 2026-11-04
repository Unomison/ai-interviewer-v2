/**
 * Milestone 11 — embedding identity (spec §4.9, ADR 012).
 *
 * "a free hosted embedding model ... used for both ingestion and queries so
 * the vector space always matches. Store the model name and dimension with
 * every chunk and re-embed if the model changes; never mix models in one
 * index."
 *
 * This module is the single place that knows the canonical embedding
 * identity. It reads the same config.yaml the gateway uses, so the model
 * can only change in one place — and every consumer enforces the match.
 */
import { readFileSync } from 'node:fs';
import YAML from 'yaml';
import { gateway as defaultGateway } from '../llm/index.js';

const CONFIG_PATH = new URL('../llm/config.yaml', import.meta.url);

function loadIdentity() {
  try {
    const cfg = YAML.parse(readFileSync(CONFIG_PATH, 'utf8'));
    return {
      model: cfg?.providers?.gemini?.embeddingModel || 'gemini-embedding-001',
      dimensions: cfg?.providers?.gemini?.embeddingDimensions || 768,
    };
  } catch {
    return { model: 'gemini-embedding-001', dimensions: 768 };
  }
}

/** Canonical identity: { model, dimensions }. */
export const EMBEDDING_IDENTITY = loadIdentity();

/**
 * Embed texts via the gateway. Returns the raw gateway result
 * { vectors, model, dimensions, provider } plus a normalized identity.
 */
export async function embedTexts(texts, gw = defaultGateway) {
  const result = await gw.embed(texts);
  return {
    vectors: result.vectors,
    provider: result.provider,
    model: result.model,
    dimensions: result.dimensions,
  };
}

/**
 * Check a gateway embed result against the canonical identity.
 *
 * @returns {{ ok: true } | { ok: false, reason }}
 * Mock mode (no keys — CI/local tests) returns model 'mock' with the
 * configured dimensions: accepted as ok:true with mock:true so tests can
 * exercise the pipeline, but the ingestion tool refuses mock vectors for
 * real indexes unless --allow-mock is passed.
 */
export function checkEmbeddingIdentity(result) {
  const expected = EMBEDDING_IDENTITY;
  if (!result || !Array.isArray(result.vectors)) {
    return { ok: false, reason: 'embed returned no vectors' };
  }
  if (result.model === 'mock') {
    if (result.dimensions !== expected.dimensions) {
      return { ok: false, reason: `mock embedding dim ${result.dimensions} != configured ${expected.dimensions}` };
    }
    return { ok: true, mock: true };
  }
  if (result.model !== expected.model) {
    return {
      ok: false,
      reason: `embedding model mismatch: got ${result.model}, index expects ${expected.model} — re-embed before upserting`,
    };
  }
  if (result.dimensions !== expected.dimensions) {
    return {
      ok: false,
      reason: `embedding dimension mismatch: got ${result.dimensions}, index expects ${expected.dimensions}`,
    };
  }
  return { ok: true, mock: false };
}

/**
 * Verify a stored chunk belongs to the current vector space.
 * Used by the ingestion tool (skip upsert) and retrieval (filter out).
 */
export function chunkIdentityMatches(chunk) {
  const expected = EMBEDDING_IDENTITY;
  return (
    chunk &&
    chunk.embeddingModel === expected.model &&
    chunk.embeddingDim === expected.dimensions &&
    Array.isArray(chunk.embedding) &&
    chunk.embedding.length === expected.dimensions
  );
}
