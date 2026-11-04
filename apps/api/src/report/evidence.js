/**
 * Milestone 10 — evidence-quote enforcement (spec §4.10: "Rubric prompts
 * require evidence before scoring").
 *
 * Rule: every substantive LLM claim must carry 1–2 short quotes that appear
 * VERBATIM in the transcript. Quotes that cannot be found are not silently
 * dropped — the claim is kept but flagged `inference: true` so the reader
 * can tell evidence from interpretation. Dimensions with no verifiable
 * evidence are marked "insufficient data" (spec §4.10).
 *
 * Pure functions — no LLM, no I/O.
 */

export function normalizeText(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

/**
 * A quote counts as evidence only if it appears verbatim (modulo
 * whitespace/case) in some transcript turn AND is long enough to be
 * meaningful (avoids matching "yes" / "ok" everywhere).
 */
export function quoteIsVerbatim(quote, transcript) {
  const q = normalizeText(quote).toLowerCase();
  if (q.length < 12) return false;
  return (transcript || []).some((t) => normalizeText(t.text).toLowerCase().includes(q));
}

/** Split evidence list into { verified, unverified }. */
export function partitionEvidence(evidence, transcript) {
  const verified = [];
  const unverified = [];
  for (const e of evidence || []) {
    (quoteIsVerbatim(e.quote, transcript) ? verified : unverified).push(e);
  }
  return { verified, unverified };
}

/**
 * Enforce evidence on one LLM-scored dimension.
 * Returns the dimension with `evidence` (verified only), `inference` and
 * `insufficientData` flags set. A null model score stays null.
 */
export function enforceDimensionEvidence(dim, transcript) {
  const { verified, unverified } = partitionEvidence(dim.evidence, transcript);
  const out = { ...dim, evidence: verified };
  if (unverified.length > 0) out.inference = true;
  if (verified.length === 0) {
    // Spec §4.10: low-evidence dimensions are marked "insufficient data".
    out.insufficientData = true;
    out.score = null;
  }
  return out;
}

/**
 * Enforce evidence on a weak-topic claim. Topics without any verifiable
 * quote are kept but flagged as inference (the reason may still be valid,
 * e.g. derived from deterministic DSA stats).
 */
export function enforceTopicEvidence(topic, transcript) {
  const { verified, unverified } = partitionEvidence(topic.evidence, transcript);
  return { ...topic, evidence: verified, inference: verified.length === 0 };
}

/**
 * Run enforcement over a whole LLM report payload.
 * @returns {{ dimensions, weakTopics, verifiedQuotes, inferenceClaims }}
 */
export function enforceReportEvidence(llmReport, transcript) {
  const dimensions = {};
  let verifiedQuotes = 0;
  let inferenceClaims = 0;
  for (const [key, dim] of Object.entries(llmReport.dimensions || {})) {
    const enforced = enforceDimensionEvidence(dim, transcript);
    dimensions[key] = enforced;
    verifiedQuotes += enforced.evidence.length;
    if (enforced.inference || enforced.insufficientData) inferenceClaims += 1;
  }
  const weakTopics = (llmReport.weakTopics || []).map((t) => {
    const enforced = enforceTopicEvidence(t, transcript);
    verifiedQuotes += enforced.evidence.length;
    if (enforced.inference) inferenceClaims += 1;
    return enforced;
  });
  return { dimensions, weakTopics, verifiedQuotes, inferenceClaims };
}
