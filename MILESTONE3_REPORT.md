# Milestone 3 — Guest intake + ATS: completion report

Date: 2026-11-04 · Spec: *AI Interviewer: Build Specification (Zero to One)*, Rev 2, §4.1–4.2, §10, §13

## What is done

**Backend** (`apps/api/src/intake/`, `apps/api/src/routes/`, `apps/api/src/sample/`):

- **Consent** (`POST /api/intake/consent`): records consent to external AI
  processing, mints an unguessable 64-hex guest session token validated
  against the shared `guestSessionSchema` (`@ai-interviewer/schemas`), and
  returns it. `consent !== true` → friendly 400. No login anywhere.
- **Resume upload** (`POST /api/intake/resume`, multipart): PDF and DOCX,
  2 MB cap (multer, before parsing), ≤3 PDF pages, DOCX ~1800-word proxy
  (ADR 004). Scanned/image-only PDFs rejected with a friendly message.
  **PII redaction runs BEFORE any model call** (email, phone, links, street
  address stripped; name → "Candidate"; year ranges like "2020 - 2024"
  deliberately preserved). Then exactly **one** `parse` LLM call →
  `resume.json` (education, experience{company,title,dates,bullets},
  projects{name,tech,description,metrics}, normalised skills,
  certifications), Zod-validated, up to 2 validation retries, then a clear
  error. The raw file buffer is discarded immediately and never stored.
- **JD** (`POST /api/intake/jd`): pasted text or uploaded file → exactly one
  `parse` call → `jd.json` (role title, seniority, required vs preferred
  skills, responsibilities, domain keywords, company{name, ambiguous}).
- **Company field** (`intake/company.js`): ADR 002 implemented exactly —
  unambiguous JD company → auto-fill; ambiguous → empty for the user (never
  guessed); otherwise inferred from the most recent resume experience.
- **Role/seniority** (`intake/role.js`): from the JD when present, else
  `needsInput: ['role']`; seniority inferred intern/new-grad/mid/senior from
  resume years + title signals (drives problem difficulty later).
- **ATS report** (`POST /api/ats/report`): hybrid score with configurable
  weights (`intake/atsConfig.js`) —
  **keyword 40%** (deterministic: skill alias map + Fuse.js fuzzy matching,
  required ×2 vs preferred ×1), **semantic 25%** (gateway `embed()` cosine
  similarity between JD requirements and resume bullets),
  **structure 15%** (deterministic: section headings, extractable text,
  contact info present, sensible length), **impact 20%** (ONE `ats_rubric`
  LLM call: quantified results, action verbs, project relevance — the same
  call returns the rewrite suggestions). Output: total score, per-part
  breakdown, missing keywords split into "unstated but present" vs "genuine
  gap", before/after suggestions. **Suggestions only rephrase existing
  content** — any suggestion introducing a genuine-gap skill is dropped
  (tested). No JD → pseudo-JD from a built-in role template, clearly
  labelled `jdSource: 'role-template'`. The payload always carries the
  "this is an estimate" disclaimer (spec §4.2 honesty rule).
- **Sample path** (`GET /api/sample/ats-report`, `GET /api/sample/resume`):
  precomputed fixtures, **zero LLM calls** — the route module never imports
  the gateway (structural test guard) and answers 200 even with the gateway
  stubbed to throw.
- **Privacy** (`intake/store.js`): sessions in MongoDB with a **TTL index**
  on `expiresAt` (30 days, auto-delete); in-memory Map with lazy expiry when
  no DB is configured (graceful degradation). `DELETE /api/intake/session`
  is the "delete my data" button. Structured JSON logs; resume contents are
  never logged.
- **M3 is the gateway's first real consumer**: `parse` and `ats_rubric`
  tasks flow through `generate()` with strict Zod schemas; `embed()` powers
  the semantic part. Mock mode (no keys) keeps every test green.
- **Tests** (`tests/intake.ats.test.js`, `node --test`, zero real keys):
  23/23 passing — PII redaction (email/phone/links/address/name; year
  ranges preserved), keyword scoring + missing split + truthful-suggestion
  filter, ADR 002 company rule (all three branches), role/seniority,
  TTL index shape, sample path with stubbed-throwing gateway, full
  integration consent→upload→JD→report over HTTP (deterministic: two
  reports identical), role-template path, rejections (oversize, 4 pages,
  scanned, wrong type), 401 on missing session, delete-my-data.
- **Docs**: this report, `docs/decisions/004-resume-parsing-libraries.md`
  (pdf-parse v2 vs pdfjs-dist, mammoth, Fuse.js), README intake/ATS section.

**Frontend** (`apps/web` — the M1 "coming in Milestone 3" placeholders are gone):

- "Try the sample interview" → sample ATS report view (precomputed, works
  with zero LLM calls).
- "Start my own" → intake flow: consent notice → resume upload (rules
  surfaced: PDF/DOCX, 2 MB, 3 pages, no scans) → optional JD (paste or
  skip → generic template) → review step (company prefilled per ADR 002 or
  left empty; role required when not in JD; seniority select) → ATS report.
- ATS report UI: total score, four weighted breakdown bars, the two
  missing-keyword lists, before/after suggestions, "estimated from a generic
  template" notice when applicable, and the estimate disclaimer — always.
- Landing hero and backend wake-up ping unchanged; session token persisted
  in localStorage; "delete my data" button on the report.

## What is NOT done (later milestones)

No interview engine yet (M8 consumes resume.json/jd.json/ATS); research
module (M7) will replace the role-template pseudo-JDs with research-driven
ones; Mongo-backed gateway cache (M8); per-interview call budget accounting
(M8); OCR for scanned PDFs (offline tooling only, per spec); DOCX page
count is a word-count proxy (ADR 004).

## Acceptance criteria status (spec §13)

| Criterion | Status |
|---|---|
| Consent | ✅ required before upload, recorded with TTL |
| Upload (PDF/DOCX, limits) | ✅ 2 MB / 3 pages / scanned rejection, friendly errors |
| PII redaction | ✅ before any model call, unit-tested |
| resume.json / jd.json | ✅ one LLM call each, Zod-validated, max 2 retries |
| ATS report UI | ✅ score + breakdown + missing split + suggestions + disclaimer |
| Sample interview data (precomputed, cached) | ✅ zero-LLM fixtures, tested |
| "Done when a visitor with no account gets a deterministic score breakdown and suggestions, and the sample path works with zero LLM calls" | ✅ integration test asserts identical reports; sample test asserts zero gateway invocations |

## Verification (all run, all green)

```bash
npm install            # multer + pdf-parse + mammoth + fuse.js, exit 0
npm test               # 38 pass, 0 fail (3 M1 health + 12 M2 gateway + 23 M3 intake/ATS)
npm run build          # vite build → dist/ in ~2.4s, exit 0
# manual: boot API, full flow in mock mode (no keys)
(PORT=5299 node apps/api/src/server.js &) ; sleep 3
curl -X POST :5299/api/intake/consent -d '{"consent":true}'      # → 201 {token}
curl -X POST :5299/api/intake/resume -H "x-session-token: $T" -F resume=@resume.pdf
curl -X POST :5299/api/intake/jd     -H "x-session-token: $T" -d '{"text":"..."}'
curl -X POST :5299/api/ats/report    -H "x-session-token: $T" -d '{}'
# → 200 {report: {totalScore, breakdown{keyword,semantic,structure,impact},
#     missingKeywords{unstatedButPresent,genuineGaps}, suggestions, disclaimer}}
# determinism: two reports → identical breakdown; sample: llmCalls 0
```

All background servers killed after verification; no stray processes
(verified with `ps`).

## Defaults applied

- Session TTL 30 days (`SESSION_TTL_DAYS` in `store.js`).
- ATS weights 40/25/15/20 and skill importance required×2/preferred×1 in
  `intake/atsConfig.js` — the single tuning surface.
- Fuse.js thresholds: 0.35 match, 0.55 evidenced-but-unstated.
- Mock mode (no keys): deterministic parses, so the whole intake→ATS flow
  runs end-to-end locally and in CI.

## What is needed from the owner

1. **Push the new code to GitHub** (`Unomison/ai-interviewer-v2`) so
   Render (backend) and Vercel (frontend) auto-deploy Milestone 3 —
   nothing was pushed from here.
2. **Keys**: confirm `GEMINI_API_KEY` + `GROQ_API_KEY` are Render env vars
   (created 2026-11-03; never in chat/git) — with real keys the parse and
   rubric calls return real data instead of mock data.
3. **Decision**: approve starting Milestone 4 (in-browser runner + locked
   editor), or redirect.

## New concepts explained (spec rule 1)

- **PII redaction**: personal details are stripped from the resume *before*
  any AI sees it — the model only ever receives "Candidate".
- **Hybrid ATS score**: four independent parts (keyword matching, semantic
  similarity, document structure, AI rubric) blended by weights you can tune.
- **Pseudo-JD**: when no job description is given, we score against a
  generic role template and label it clearly as an estimate.
- **TTL auto-delete**: session data carries an expiry date; the database
  deletes it automatically — no manual cleanup, no lingering personal data.
