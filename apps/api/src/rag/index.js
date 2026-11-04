/**
 * Milestone 11 — RAG module barrel (spec §4.9, ADR 012).
 *
 * getRagStatus() is the honest health signal for the whole feature:
 *   - disabled    — no database configured (local dev / CI)
 *   - not-indexed — database connected but the Atlas Vector Search index
 *                   doesn't exist yet (the owner creates it manually; see
 *                   docs/atlas-vector-index-walkthrough.md)
 *   - indexed     — ready: chunk count + embedding identity included
 *
 * Retrieval falls back to the M7 direct KB lookup in every state except
 * `indexed`. Nothing in this module throws past getRagStatus().
 */
import { getDbStatus } from '../db.js';
import { getVectorStore, KB_VECTOR_INDEX_NAME } from './store.js';
import { EMBEDDING_IDENTITY } from './embed.js';

export { VectorStore, MemoryVectorStore, AtlasVectorStore, cosineSimilarity, metadataMatches, getVectorStore, _resetVectorStore, KB_VECTOR_INDEX_NAME } from './store.js';
export { chunkKbDocument, pruneChunks, chunksBytes, DEFAULT_MIN_CONFIDENCE, MAX_CHUNK_CHARS } from './chunk.js';
export { EMBEDDING_IDENTITY, embedTexts, checkEmbeddingIdentity, chunkIdentityMatches } from './embed.js';
export {
  retrieveRelevant, getRagContext, retrieveForTurn, noteAskedQuestions,
  citationsFor, keywordOverlap, hybridScore, setReranker, getReranker,
  RAG_TOP_K, RAG_TURN_TOP_K, DEDUP_SIMILARITY_THRESHOLD, _clearRagCaches,
} from './retrieve.js';

export async function getRagStatus(deps = {}) {
  const base = {
    embeddingModel: EMBEDDING_IDENTITY.model,
    embeddingDimensions: EMBEDDING_IDENTITY.dimensions,
    indexName: KB_VECTOR_INDEX_NAME,
    collection: 'kb_chunks',
  };
  try {
    if (getDbStatus() !== 'connected') {
      return { ...base, mode: 'disabled', indexed: false, chunkCount: 0, note: 'no database configured — planner uses the direct KB lookup' };
    }
    const store = deps.store || getVectorStore();
    const ready = await store.indexReady();
    if (!ready.ready) {
      return { ...base, mode: 'not-indexed', indexed: false, chunkCount: 0, note: ready.reason };
    }
    const chunkCount = await store.count();
    return { ...base, mode: 'indexed', indexed: true, chunkCount, note: `${chunkCount} chunks indexed` };
  } catch (err) {
    return { ...base, mode: 'not-indexed', indexed: false, chunkCount: 0, note: `status check failed: ${err.message}` };
  }
}
