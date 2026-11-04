/**
 * Milestone 11 — VectorStore interface (spec §4.9, ADR 012).
 *
 * The spec requires indirection: "Put it behind a VectorStore interface so
 * a self-hosted Qdrant can replace it later without touching the app."
 *
 * Interface (all methods async):
 *   upsert(chunks)                    -> { upserted }
 *   query(vector, { filters, limit }) -> [{ chunk, score }]
 *   deleteBySource(sourceId)          -> { deleted }
 *   count(filters)                   -> number
 *   indexReady()                      -> { ready: bool, reason }
 *
 * Implementations:
 *   MemoryVectorStore — cosine similarity, in-memory. Used in tests and for
 *     graceful local runs without a database.
 *   AtlasVectorStore  — MongoDB Atlas Vector Search ($vectorSearch) on the
 *     kb_chunks collection. indexReady() probes for the search index and
 *     caches the answer briefly; a missing index is a normal, non-fatal
 *     state (the owner creates it manually — see
 *     docs/atlas-vector-index-walkthrough.md).
 *
 * Nothing here throws for "index not found": callers (retrieve.js) treat
 * not-ready as a signal to fall back to the M7 direct KB lookup.
 */
import mongoose from 'mongoose';
import { getDbStatus } from '../db.js';

/** Cosine similarity of two equal-length vectors. Pure, exported for tests. */
export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Case-insensitive metadata match; null/undefined filter values are wildcards. */
export function metadataMatches(metadata, filters) {
  const md = metadata || {};
  for (const [key, want] of Object.entries(filters || {})) {
    if (want === null || want === undefined || want === '') continue;
    const got = md[key];
    if (got === null || got === undefined || got === '') continue; // chunk has no opinion
    if (String(got).toLowerCase() !== String(want).toLowerCase()) return false;
  }
  return true;
}

/** Base class documenting the interface. Not instantiated directly. */
export class VectorStore {
  // eslint-disable-next-line no-unused-vars
  async upsert(chunks) { throw new Error('VectorStore.upsert not implemented'); }
  // eslint-disable-next-line no-unused-vars
  async query(vector, opts = {}) { throw new Error('VectorStore.query not implemented'); }
  // eslint-disable-next-line no-unused-vars
  async deleteBySource(sourceId) { throw new Error('VectorStore.deleteBySource not implemented'); }
  // eslint-disable-next-line no-unused-vars
  async count(filters = {}) { throw new Error('VectorStore.count not implemented'); }
  async indexReady() { return { ready: false, reason: 'not implemented' }; }
}

/**
 * In-memory vector store. Cosine similarity over stored chunk embeddings,
 * with the same metadata-filter semantics as the Atlas implementation so
 * behaviour is comparable in tests.
 *
 * Chunk shape: { chunkId, text, embedding: number[], metadata: object }
 */
export class MemoryVectorStore extends VectorStore {
  constructor() {
    super();
    this.chunks = new Map(); // chunkId -> chunk
  }

  async upsert(chunks) {
    let upserted = 0;
    for (const c of chunks || []) {
      if (!c || !c.chunkId || !Array.isArray(c.embedding)) continue;
      this.chunks.set(c.chunkId, c);
      upserted++;
    }
    return { upserted };
  }

  async query(vector, { filters = {}, limit = 5 } = {}) {
    const scored = [];
    for (const chunk of this.chunks.values()) {
      if (!metadataMatches(chunk.metadata, filters)) continue;
      scored.push({ chunk, score: cosineSimilarity(vector, chunk.embedding) });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, Math.max(1, limit));
  }

  async deleteBySource(sourceId) {
    let deleted = 0;
    for (const [id, chunk] of this.chunks) {
      if (chunk.sourceId === sourceId) {
        this.chunks.delete(id);
        deleted++;
      }
    }
    return { deleted };
  }

  async count(filters = {}) {
    let n = 0;
    for (const chunk of this.chunks.values()) {
      if (metadataMatches(chunk.metadata, filters)) n++;
    }
    return n;
  }

  async indexReady() {
    return { ready: true, reason: 'memory store is always ready' };
  }

  clear() {
    this.chunks.clear();
  }
}

const kbChunkSchema = new mongoose.Schema(
  {
    chunkId: { type: String, required: true, unique: true },
    sourceId: { type: String, required: true, index: true },
    text: { type: String, required: true },
    embedding: { type: [Number], required: true },
    embeddingModel: { type: String, required: true },
    embeddingDim: { type: Number, required: true },
    metadata: { type: Object, default: {} },
    ingestedAt: { type: Date, required: true },
  },
  { timestamps: false },
);
// NOTE: no TTL index here — freshness is enforced by the ingestion tool
// (spec §4.9: "store the ingestion date and re-run ingestion when data is
// older than a configurable TTL"), not by auto-deletion.

const KbChunk = mongoose.models.KbChunk || mongoose.model('KbChunk', kbChunkSchema);

export const KB_CHUNKS_COLLECTION = 'kb_chunks';
/** Must match the index created in docs/atlas-vector-index-walkthrough.md. */
export const KB_VECTOR_INDEX_NAME = 'kb_chunks_vector_index';

/**
 * Store factory. Atlas when a database is connected, in-memory otherwise
 * (tests / local runs without a DB — retrieval then degrades to the direct
 * KB lookup in retrieve.js).
 */
let _singleton = null;
export function getVectorStore({ kind = null } = {}) {
  const resolved = kind || (getDbStatus() === 'connected' ? 'atlas' : 'memory');
  if (resolved === 'memory') return new MemoryVectorStore();
  if (!_singleton || _singleton._kind !== 'atlas') {
    _singleton = new AtlasVectorStore();
    _singleton._kind = 'atlas';
  }
  return _singleton;
}

/** Test helper: drop the cached Atlas singleton. */
export function _resetVectorStore() {
  _singleton = null;
}

const INDEX_PROBE_TTL_MS = 60_000;

/**
 * Atlas Vector Search store. All Atlas-specific code lives here; swapping
 * to Qdrant means writing one new subclass, per the spec.
 */
export class AtlasVectorStore extends VectorStore {
  constructor({ indexName = KB_VECTOR_INDEX_NAME } = {}) {
    super();
    this.indexName = indexName;
    this._probe = null; // { at, result }
  }

  _collection() {
    if (getDbStatus() !== 'connected') return null;
    return mongoose.connection.db.collection(KB_CHUNKS_COLLECTION);
  }

  async indexReady() {
    const now = Date.now();
    if (this._probe && now - this._probe.at < INDEX_PROBE_TTL_MS) return this._probe.result;
    const coll = this._collection();
    let result;
    if (!coll) {
      result = { ready: false, reason: 'no database connection' };
    } else {
      try {
        const cursor = await coll.listSearchIndexes(this.indexName);
        const indexes = await cursor.toArray();
        const found = indexes.find((ix) => ix.name === this.indexName && ix.status === 'READY');
        result = found
          ? { ready: true, reason: 'index ready' }
          : { ready: false, reason: 'vector search index not found or not ready (see docs/atlas-vector-index-walkthrough.md)' };
      } catch (err) {
        result = { ready: false, reason: `index probe failed: ${err.message}` };
      }
    }
    this._probe = { at: now, result };
    return result;
  }

  async upsert(chunks) {
    const coll = this._collection();
    if (!coll) throw new Error('AtlasVectorStore.upsert: no database connection');
    let upserted = 0;
    for (const c of chunks || []) {
      if (!c || !c.chunkId || !Array.isArray(c.embedding)) continue;
      await coll.updateOne(
        { chunkId: c.chunkId },
        {
          $set: {
            sourceId: c.sourceId || null,
            text: c.text,
            embedding: c.embedding,
            embeddingModel: c.embeddingModel,
            embeddingDim: c.embeddingDim,
            metadata: c.metadata || {},
            ingestedAt: c.ingestedAt || new Date(),
          },
        },
        { upsert: true },
      );
      upserted++;
    }
    return { upserted };
  }

  /**
   * Hybrid-capable query: $vectorSearch with a metadata pre-filter, then
   * the caller (retrieve.js) blends in the keyword score. Atlas applies the
   * filter inside the vector index for efficiency.
   */
  async query(vector, { filters = {}, limit = 5 } = {}) {
    const coll = this._collection();
    if (!coll) throw new Error('AtlasVectorStore.query: no database connection');
    const filter = {};
    for (const [k, v] of Object.entries(filters)) {
      if (v === null || v === undefined || v === '') continue;
      filter[`metadata.${k}`] = { $eq: v };
    }
    const pipeline = [
      {
        $vectorSearch: {
          index: this.indexName,
          path: 'embedding',
          queryVector: vector,
          numCandidates: Math.max(20, limit * 10),
          limit: Math.max(1, limit * 3), // over-fetch; retrieve.js re-ranks
          ...(Object.keys(filter).length > 0 ? { filter } : {}),
        },
      },
      {
        $project: {
          _id: 0,
          chunkId: 1,
          sourceId: 1,
          text: 1,
          embedding: 1,
          embeddingModel: 1,
          embeddingDim: 1,
          metadata: 1,
          ingestedAt: 1,
          score: { $meta: 'vectorSearchScore' },
        },
      },
    ];
    const docs = await coll.aggregate(pipeline).toArray();
    return docs.map((d) => ({ chunk: d, score: d.score ?? 0 }));
  }

  async deleteBySource(sourceId) {
    const coll = this._collection();
    if (!coll) throw new Error('AtlasVectorStore.deleteBySource: no database connection');
    const res = await coll.deleteMany({ sourceId });
    return { deleted: res.deletedCount || 0 };
  }

  async count(filters = {}) {
    const coll = this._collection();
    if (!coll) return 0;
    const q = {};
    for (const [k, v] of Object.entries(filters)) {
      if (v === null || v === undefined || v === '') continue;
      q[`metadata.${k}`] = v;
    }
    return coll.countDocuments(q);
  }

  /** Freshness helper for the ingestion tool: newest ingestedAt for a source. */
  async newestIngestedAt(sourceId) {
    const coll = this._collection();
    if (!coll) return null;
    const doc = await coll.find({ sourceId }).sort({ ingestedAt: -1 }).limit(1).project({ ingestedAt: 1 }).toArray();
    return doc[0]?.ingestedAt || null;
  }
}
