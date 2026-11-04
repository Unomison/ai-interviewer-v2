# ADR 004 — Resume parsing libraries (Milestone 3)

Date: 2026-11-04
Status: Accepted

## Context

Spec Section 4.1 requires PDF and DOCX intake (max ~2 MB, ~3 pages), friendly
rejection of scanned/image-only PDFs, and names the candidates to evaluate:
`pdfjs-dist` or `pdf-parse` (PDF), `mammoth` (DOCX).

## Decisions

### 1. PDF: `pdf-parse` v2 (not `pdfjs-dist`, not `pdf-parse` v1)

- **v2 over v1**: the npm install pulled `pdf-parse@2.4.5` — native ESM
  (`"type": "module"`), maintained, with a clean class API:
  `new PDFParse({ data: buffer })` → `getText()` returns `{ text, total }`
  (text plus page count in one call) and `destroy()` frees resources.
  v1's `pdfParse(buffer)` callback style is legacy.
- **Over `pdfjs-dist`**: pdfjs-dist exposes far more surface (per-page items,
  rendering, workers) than we need. Our requirements are exactly "text +
  page count", which pdf-parse v2 answers in three lines. Smaller API
  surface, fewer footguns.
- **Scanned detection**: a scanned PDF yields ~empty text from any parser, so
  the heuristic "fewer than 200 non-space characters → reject as scanned"
  works identically regardless of library. Verified with generated fixtures
  (text PDF extracts fully; empty-content PDF is rejected).

### 2. DOCX: `mammoth` (the spec's suggestion, no contest)

`mammoth.extractRawText({ buffer })` → plain text. It is the standard,
dependency-light choice; nothing else was seriously considered.

### 3. Page limits

- PDF: `total > 3` → friendly 400 (`too_many_pages`).
- DOCX has no reliable page count via mammoth, so a **~1800-word ceiling**
  (~600 words/page) is used as the 3-page proxy (`too_long`).
- Size is enforced one layer earlier by multer (`2 MB`), so oversized files
  never reach the parsers.

### 4. Fuzzy skill matching: `fuse.js`

Spec Section 4.2 suggests "Fuse.js or similar" — used as suggested
(threshold 0.35 for matches, 0.55 for the evidenced-but-unstated check).
No new evaluation needed.

## Consequences

- New runtime deps in `apps/api`: `multer`, `pdf-parse`, `mammoth`,
  `fuse.js` (+ `@ai-interviewer/schemas` workspace link for the session
  contract).
- `apps/api/src/intake/extract.js` owns all format logic; routes only see
  `{ text, pages, kind }` or a friendly `IntakeError`.
- If a future resume format arrives (e.g. ODT), it lands in `extract.js`
  behind the same interface.
