# tools/ — Python offline tooling (owner's laptop only)

**Nothing in this folder runs in production or in the visitor's browser.**

Per spec Section 3, Python is for *offline tooling only*: research ingestion,
the DSA problem pipeline (generate → differential-test → calibrate), knowledge-base
seeding, and evals. Its output is **data in MongoDB**, never a running server.
The deployed demo needs only the free hosts (Vercel + Render + Atlas M0).

This tooling arrives in Milestones 6–7. The placeholder script below just proves
the folder wiring; delete or replace it when the real CLIs land.

## Layout (planned)

- `research_ingest/` — the shared crawler pipeline (Python CLI), spec §4.3
- `problem_pipeline/` — canonicalise → generate → differential-test → calibrate, spec §4.4
- `seed/` — seed script for the first 50–100 validated problems
- `evals/` — golden sets for resume parsing, ATS stability, approach judging

## Quick check

```bash
python3 tools/hello.py
```
