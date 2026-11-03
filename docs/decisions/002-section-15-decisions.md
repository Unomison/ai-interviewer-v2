# ADR 002 — Section 15 decisions confirmed by the owner

Date: 2026-11-02
Status: Accepted (confirmed by Utkarsh; he welcomes further clarifying questions anytime)

## Context

Spec Section 15 listed five decisions to confirm before Milestone 1. The owner
confirmed all five, with one important correction to the spec's default on the
research crawler (see decision 3).

## Decisions

### 1. Free provider keys: owner creates BOTH

Utkarsh will create a **Google AI Studio (Gemini)** key **and** a **Groq**
account. Design the M2 LLM gateway assuming both keys exist in production,
with graceful fallback when absent (mock/sample mode — the deployed demo must
never hard-require a key to boot, same spirit as the M1 DB degradation).

### 2. C++ toolchain download: approved

The one-time, lazily loaded, cached WebAssembly Clang toolchain download
(tens of MB) is acceptable. Load it only when the visitor picks C++, cache it
in the browser, show progress, and pre-warm while the candidate explains their
approach (spec §4.8).

### 3. On-demand research MUST work on the deployed link

Correction to the spec's laptop-first default: the **on-demand research path**
(spec §4.3, Stage 2) must be functional on the **deployed Render backend**, not
laptop-only. The pre-crawl seed may still run on the owner's laptop first
(GitHub Actions scheduling later), but a visitor opening the public link must
get company/role research without any laptop involved.

Constraints for the free tier (recorded here so M7 implements them, not wishes
them): time-box on-demand jobs to ~60s with visible progress, cache every
result in MongoDB (research collection, TTL per freshness config), fall back to
role-generic patterns on failure/timeout, and keep the Node on-demand module
light (no Playwright on the server — that's offline-only).

### 4. Company field resolution rule (intake design note)

Recorded now; the intake UI itself arrives in Milestone 3.

1. If a JD is given **and** the company is unambiguous → auto-fill it.
2. If ambiguous → leave the field **empty** for the user to fill (never guess).
3. If still unfilled → infer from the resume.

Rationale: a wrong auto-filled company poisons the research cache and the
interview plan; an empty field is honest and cheap to fill.

### 5. Behavioral round: in v1, and LAST

The optional behavioral round is included in v1 (LLM only, per spec default)
but runs **last** in the interview order, after the closing of technical
evaluation. Round order v1: intake → ATS → research → planning → intro →
resume round → DSA round → CS fundamentals → **behavioral** → closing → report.

## Consequences

- M2 gateway design: provider chain Gemini → Groq → OpenRouter free, with a
  no-key mock path; quota tracking per provider from day one.
- M5 C++ work can assume the toolchain download UX is approved.
- M7 must implement the on-demand research module for the server (light), not
  just the Python CLI.
- M3 intake implements the company resolution rule exactly as written above.
- M8 state machine puts the behavioral round last.
