/**
 * Company field resolution — implements ADR 002 decision 4 EXACTLY:
 *
 * 1. JD given AND company unambiguous → auto-fill from the JD.
 * 2. JD company ambiguous → leave EMPTY for the user (never guess).
 * 3. No JD company → infer from the resume (most recent experience).
 *
 * Rationale (ADR 002): a wrong auto-filled company poisons the research
 * cache and the interview plan; an empty field is honest and cheap to fill.
 */

/**
 * @returns {{ company: string|null, source: 'jd'|'resume'|null, needsInput: boolean }}
 */
export function resolveCompany(jdJson, resumeJson) {
  const jdCompany = jdJson?.company;
  if (jdCompany?.name && !jdCompany.ambiguous) {
    return { company: jdCompany.name, source: 'jd', needsInput: false };
  }
  if (jdCompany?.ambiguous) {
    return { company: null, source: null, needsInput: true };
  }
  const recent = resumeJson?.experience?.find((e) => e.company)?.company;
  if (recent) {
    return { company: recent, source: 'resume', needsInput: false };
  }
  return { company: null, source: null, needsInput: true };
}
