# Free-tier facts relied on (Milestones 1–2)

Snapshot of the free-tier limits this milestone relies on. Every entry has a
verification date. Anything I could not verify is marked **UNVERIFIED** — treat
it as unknown, not true. Re-check each against the provider's own page before
launch, and update the date when you do.

| Fact | Value | Verified | Source / note |
|---|---|---|---|
| Render free web service — instance hours | 750 hours / workspace / month, shared across free services | 2026-11-02 | Third-party summaries of Render docs (Oct 2026); **re-verify on render.com** before launch |
| Render free web service — sleep | Spins down after 15 min without inbound traffic | 2026-11-02 | Same as above |
| Render free web service — cold start | About 1 minute to serve traffic again | 2026-11-02 | Same as above |
| Render free web service — size | 512 MB RAM, 0.1 CPU; no credit card | 2026-11-02 | Same as above |
| Vercel Hobby — price | $0, no expiry, no credit card | 2026-11-02 | Third-party summaries citing Vercel pricing (Sep–Oct 2026); **re-verify on vercel.com** before launch |
| Vercel Hobby — allowed use | Personal, **non-commercial** only. A portfolio/open-source project qualifies; a commercial product does not | 2026-11-02 | Same as above |
| Vercel Hobby — rough allowances | ~100 GB transfer, 1M requests/month (fine for a handful of visitors) | 2026-11-02 | Same as above |
| MongoDB Atlas M0 — price/storage | Free, 512 MB shared cluster, always free | 2026-11-02 | Multiple sources incl. references to mongodb.com/pricing (Oct 2026); **re-verify on mongodb.com** before launch |
| MongoDB Atlas M0 — vector search | Atlas Vector Search supported on M0 | 2026-11-02 | Same as above |
| MongoDB Atlas M0 — card/pausing | No credit card; auto-pauses after 30 days of zero connections | 2026-11-02 | Same as above |
| GitHub Actions free for public repos | Claimed by spec §4.3/§13; limits not checked this milestone | **UNVERIFIED** | Verify before scheduling the M6 pre-crawl |
| Gemini free tier quotas | Not needed until M2 | **VERIFIED 2026-11-03** | See M2 rows below |
| Gemini free tier — gemini-2.0-flash | ~1,500 requests/day, 15 requests/min | 2026-11-03 | Third-party guides citing Google AI Studio quotas (Oct–Nov 2026); **re-verify on ai.google.dev** before launch |
| Gemini embeddings — use gemini-embedding-001 | text-embedding-004 retired (HTTP 404 since June 2026); embedding model is gemini-embedding-001 | 2026-11-03 | Third-party connector docs live-verified against the Gemini API (June 2026) |
| Gemini API auth | API key via `x-goog-api-key` header (never in URL); REST `v1beta/models/{model}:generateContent`; structured output via `responseMimeType: "application/json"` + `responseSchema` | 2026-11-03 | Same as above |
| Groq free tier — endpoint | OpenAI-compatible: `https://api.groq.com/openai/v1/chat/completions`, Bearer key | 2026-11-03 | Multiple third-party guides (Oct 2026); **re-verify on console.groq.com** before launch |
| Groq free tier — llama-3.3-70b-versatile | 1,000 requests/day, 100K tokens/day, 30 req/min | 2026-11-03 | Same as above |
| Groq free tier — llama-3.1-8b-instant | 14,400 requests/day, 500K tokens/day, 30 req/min | 2026-11-03 | Same as above |
| OpenRouter free tier — endpoint | OpenAI-compatible: `https://openrouter.ai/api/v1/chat/completions`; free models carry the `:free` suffix; key optional | 2026-11-03 | Third-party guides (Oct 2026); **re-verify on openrouter.ai** before launch |
| Groq Whisper free tier (≈20 req/min, 2000/day) | Spec's reported figure; not needed until M9 | **UNVERIFIED** | Verify before voice work |
| Public Piston API freeness | Spec §4.8 reports it stopped being free | **UNVERIFIED** | Verify if a hosted executor is ever considered (M5) |

**Rule for this repo (spec rule 4):** put every limit in config, not in code.
When a later milestone needs a number from this table, it becomes an env var
or a config entry with the verification date next to it.
