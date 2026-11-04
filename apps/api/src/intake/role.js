/**
 * Role + seniority resolution (Milestone 3, spec Section 4.1).
 *
 * Role: from the JD when present, else the visitor must supply it
 * (`needsInput`). Seniority: from the JD when stated, else inferred from the
 * resume — it drives problem difficulty in later milestones.
 */

const SENIORITIES = ['intern', 'new-grad', 'mid', 'senior'];

/** Rough total years of experience from start/end year pairs. */
export function totalYearsExperience(experience = []) {
  const now = new Date().getFullYear();
  let months = 0;
  for (const exp of experience) {
    const startYear = parseYear(exp.start);
    const endYear = parseYear(exp.end) ?? now;
    if (startYear && endYear >= startYear && endYear - startYear < 60) {
      months += (endYear - startYear) * 12;
    }
  }
  return months / 12;
}

function parseYear(s) {
  if (!s) return null;
  const m = String(s).match(/\b(19|20)\d{2}\b/);
  return m ? parseInt(m[0], 10) : null;
}

export function inferSeniority(resumeJson) {
  const experience = resumeJson?.experience || [];
  const titles = experience.map((e) => (e.title || '').toLowerCase()).join(' | ');
  if (/\bintern(ship)?\b/.test(titles)) return 'intern';
  const years = totalYearsExperience(experience);
  if (years < 1) return 'new-grad';
  if (years < 4) return 'mid';
  return 'senior';
}

/**
 * @returns {{ role: string|null, seniority: string, senioritySource: 'jd'|'inferred', needsInput: string[] }}
 */
export function resolveRoleSeniority(jdJson, resumeJson) {
  const role = jdJson?.roleTitle?.trim() || null;
  const needsInput = role ? [] : ['role'];
  let seniority = 'mid';
  let senioritySource = 'inferred';
  if (jdJson?.seniority && jdJson.seniority !== 'unknown') {
    seniority = jdJson.seniority;
    senioritySource = 'jd';
  } else {
    seniority = inferSeniority(resumeJson);
  }
  if (!SENIORITIES.includes(seniority)) seniority = 'mid';
  return { role, seniority, senioritySource, needsInput };
}
