# RAG vs no-retrieval: what retrieval actually buys

Milestone 11 measurement write-up (spec §4.9: "add retrieval and measure the
difference, so the project can show what RAG actually buys"). Re-run anytime
with `node tools/rag-eval.js`; raw numbers live in
`docs/rag-eval-results.json`.

## Setup

- **Corpus:** 2 hand-written company KBs (Nokia, Stripe) → 21 chunks via the
  real `chunkKbDocument()` (angles, overview, tech stack, practices, culture,
  news), pruned at confidence ≥ 0.55.
- **Queries:** 10 hand-labelled (company, role, query → expected topics).
- **Store:** `MemoryVectorStore` (cosine + metadata filters); the Atlas
  `$vectorSearch` path shares the same filter semantics.
- **Embeddings:** deterministic **mock** vectors (no keys on the build
  machine). This is the central caveat — read it before the numbers.

## Results (k=4)

| Dimension | Retrieval | No-retrieval baseline |
|---|---|---|
| Latency added | **0.5 ms** avg per retrieval (in-memory; Atlas adds network RTT, est. 50–200 ms) | 0 ms |
| Quota | **1 embed call** per retrieval (31 total incl. ingest of 21 chunks) | 0 embed calls |
| Relevance (hit rate) | **0.90** — expected topic in top-4 for 9/10 queries | 1.00 by construction (whole doc is in the prompt) |
| Relevance (MRR) | **0.85** — the right topic is usually ranked first | n/a |
| Prompt size (planner) | **~443 chars** avg top-k | 2,832 chars whole-KB dump (**84% smaller**) |

## Reading the numbers honestly

1. **The relevance numbers measure the hybrid pipeline, not vector search.**
   With mock embeddings the vector term of the hybrid score is seeded noise;
   ranking is carried by the keyword-overlap term and metadata filters. What
   this proves: chunking → embedding → filtering → hybrid ranking works
   end-to-end and surfaces the right topic first 85% of the time *even
   without semantic signal*.
2. **The one miss is the most informative result.** Query: *"protecting APIs
   from abuse with throttling"* → expected `rate limiting`, retrieved
   overview/API-design/databases/news. Neither "throttling" nor "abuse"
   appears in the rate-limiting chunk, so keyword overlap failed — this is
   exactly the paraphrase gap real embeddings close. With
   `gemini-embedding-001`, "throttling" ≈ "rate limiting" in vector space and
   this query should hit. (Re-run on the deployed stack to confirm.)
3. **Latency here is a floor, not a promise.** 0.5 ms is the in-memory
   store; Atlas Vector Search adds a network round-trip. Budget ~100 ms per
   retrieval in production planning — still negligible next to a 2–5 s LLM
   call.
4. **Quota is the real cost.** One `embed` call per planner run plus one per
   substantive turn (bounded: resume/cs/behavioral rounds, ≥20-char messages,
   5-min session cache). Against the ~30-call interview budget this is
   ~10 extra calls worst case — acceptable, and the prompt-token savings
   (84% smaller company context) partly pay it back.
5. **Sample size is small** (10 queries, 2 companies). This is a write-up,
   not a paper — the harness ships so the numbers can grow.

## What RAG buys (the portfolio answer)

- **Selectivity over dumping:** the planner gets 4 focused, citable chunks
  instead of a whole KB document — 84% less company context in the prompt,
  with source URLs attached for the report's citations.
- **Follow-up sharpness:** per-turn retrieval gives the interviewer
  company-specific angles for follow-ups, bounded and cached.
- **Deduplication:** asked-question embeddings catch repeats the prompt
  alone would miss.
- **Graceful everything:** no index → the M7 direct-KB path, same answers
  as before. Retrieval is strictly additive.

## What would change the numbers

Re-running `tools/rag-eval.js` against the real stack (owner's Gemini key +
Atlas index) should: fix the throttling-type misses (MRR → ~1.0 on this
set), add ~50–200 ms latency per retrieval, and keep quota at 1 embed call
per retrieval. If a larger labelled set ever shows the hybrid weights
(0.7/0.3) mis-ranking, `setReranker()` is the seam — no app code changes.
