# Atlas Vector Search index — creation walkthrough

The RAG layer degrades gracefully until this index exists (`GET
/api/rag/status` reports `not-indexed` and the planner uses the direct KB
lookup). Creating the index is a one-time, ~5-minute manual step in the
Atlas dashboard. Do it once; every later deploy reuses it.

> Prerequisite: the `kb_chunks` collection must exist in your database. It is
> created automatically the first time `tools/ingest-kb.js` runs. If you
> prefer to create the index first, insert any document into `kb_chunks`
> (Atlas → Database → cluster0 → Browse Collections → Create Collection is
> **not** enough — the collection must exist; the ingest tool handles it).

## Steps

1. Go to [cloud.mongodb.com](https://cloud.mongodb.com) and sign in.
2. Left sidebar → **Database** → click your cluster (`cluster0`).
3. Top tabs of the cluster view → **Atlas Search** (not "Search Indexes" under
   a different product — you want the tab labelled Atlas Search).
4. Click **Create Search Index**.
5. **Index configuration method** → choose **JSON Editor** (not the visual
   editor — we need a `vectorSearch` index, which the visual editor cannot
   express on M0). Click **Next**.
6. **Database and Collection**:
   - Database: select the database your app uses (the one in your
     `MONGODB_URI`, e.g. `ai_interviewer` — check Render's `MONGODB_URI` env
     var if unsure; it's the path segment after the host).
   - Collection: `kb_chunks`.
   - Click **Next**.
7. **Index name:** `kb_chunks_vector_index` (exact — the app looks for this
   name).
8. **Replace the JSON** in the editor with the definition below. The only
   number you must get right is `numDimensions: 768` (matches
   `gemini-embedding-001` as configured in `apps/api/src/llm/config.yaml`).
9. Click **Create Search Index**.
10. Wait for **Status: Active** (usually 1–5 minutes; refresh the page). While
    it says "Building", `/api/rag/status` still reports `not-indexed` — that
    is expected.
11. Verify: `GET https://ai-interviewer-v2.onrender.com/api/rag/status` should
    flip to `"mode": "indexed"` with a `chunkCount` ≥ 0. Then run the ingest
    tool to fill it:
    `MONGODB_URI='...' node tools/ingest-kb.js --company "Nokia" --role "Associate Engineer"`

## Index definition JSON

```json
{
  "name": "kb_chunks_vector_index",
  "type": "vectorSearch",
  "definition": {
    "fields": [
      {
        "type": "vector",
        "path": "embedding",
        "numDimensions": 768,
        "similarity": "cosine"
      },
      { "type": "filter", "path": "metadata.company" },
      { "type": "filter", "path": "metadata.role" },
      { "type": "filter", "path": "metadata.round" },
      { "type": "filter", "path": "metadata.topic" }
    ]
  }
}
```

## What each part does

- `type: "vectorSearch"` — this is an Atlas **Vector Search** index (knnBeta
  is the legacy name; `vectorSearch` is current).
- `path: "embedding"` — the 768-dimension array stored on each chunk.
- `similarity: "cosine"` — matches the app's cosine scoring.
- The four `filter` fields let the app pre-filter by company/role/round/topic
  *inside* the vector index (efficient); without them, filtered queries fall
  back to post-filtering and are slower.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "Create Search Index" button missing | Wrong tab — use the cluster's **Atlas Search** tab, not Collection → Search Indexes. |
| Index stuck in "Building" > 15 min | Usually resolves on its own; if not, delete and recreate. Empty collections build instantly. |
| `/api/rag/status` still `not-indexed` after Active | Name mismatch — the app expects exactly `kb_chunks_vector_index`. Also confirm the database in `MONGODB_URI` matches the one you indexed. |
| Ingest fails with dimension errors | `numDimensions` must be 768. If you ever change `embeddingModel` in config.yaml, delete the index and recreate it with the new dimensions, then re-run ingest with `--force`. |
| M0 limits | Atlas Vector Search works on free M0 clusters. The 512 MB cap is shared with everything else — KB chunks are kilobytes per company; not a concern. |

## Cost

$0 — Atlas Search / Vector Search is included on M0.
