# Free-tier facts relied on (Milestone 1)

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
| Gemini free tier quotas | Not needed until M2 | **UNVERIFIED** | Verify in M2 before building the LLM gateway |
| Groq Whisper free tier (≈20 req/min, 2000/day) | Spec's reported figure; not needed until M9 | **UNVERIFIED** | Verify before voice work |
| Public Piston API freeness | Spec §4.8 reports it stopped being free | **UNVERIFIED** | Verify if a hosted executor is ever considered (M5) |

**Rule for this repo (spec rule 4):** put every limit in config, not in code.
When a later milestone needs a number from this table, it becomes an env var
or a config entry with the verification date next to it.
