/**
 * PII redaction (Milestone 3, spec Sections 4.1 + 10).
 *
 * HARD RULE: this runs BEFORE any text reaches a model. Email, phone, links
 * and street addresses are stripped; the candidate's name becomes "Candidate".
 * Pure function — no I/O, no network — so it is cheap to unit test.
 */

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const URL_RE = /https?:\/\/[^\s)]+|\bwww\.[^\s)]+|\b(?:linkedin\.com|github\.com|gitlab\.com)[^\s)]*/gi;
// Phone: groups of digits with common separators. Deliberately does NOT match
// bare 4-digit years ("2022") or year ranges ("2020 - 2024") — those are
// resume content, not PII. Checked by the replacer below.
const PHONE_RE = /(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,5}\)?[\s.-]?){2,}\d{2,6}/g;
const YEAR_RANGE_RE = /^\d{4}\s*[-–—]\s*\d{4}$/;
const STREET_RE =
  /^\s*\d{1,5}\s+[A-Z][\w.'-]*\s+(Street|St|Avenue|Ave|Road|Rd|Lane|Ln|Drive|Dr|Boulevard|Blvd|Nagar|Marg|Colony|Enclave|Layout)[^\n]*/gim;

/**
 * Words that mark a line as a headline/job title rather than a name.
 */
const TITLE_WORDS =
  /\b(engineer|developer|manager|designer|analyst|consultant|intern|internship|lead|architect|scientist|specialist|associate|founder|director)\b/i;

/**
 * Best-effort name detection: the first non-empty line of a resume is
 * almost always the candidate's name. Returns null when the first line
 * does not look like a name (e.g. it is a headline or an email).
 */
export function detectName(text) {
  const first = (text.split('\n').find((l) => l.trim().length > 0) || '').trim();
  if (!first || first.length > 40) return null;
  if (/\d/.test(first) || first.includes('@')) return null;
  if (TITLE_WORDS.test(first)) return null;
  const words = first.split(/\s+/);
  if (words.length < 2 || words.length > 4) return null;
  if (!/^[A-Za-z][A-Za-z .'-]*$/.test(first)) return null;
  return first;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @returns {{ redacted: string, name: string|null, hadContact: boolean }}
 * `hadContact` is used by the ATS structure score (contact info present);
 * it is computed from the RAW text before redaction.
 */
export function redactPII(rawText) {
  const hadContact =
    EMAIL_RE.test(rawText) || PHONE_RE.test(rawText) || URL_RE.test(rawText);
  // Reset lastIndex for the global regexes reused below.
  EMAIL_RE.lastIndex = 0;
  PHONE_RE.lastIndex = 0;
  URL_RE.lastIndex = 0;

  const name = detectName(rawText);
  let text = rawText;

  text = text.replace(EMAIL_RE, '[email]');
  text = text.replace(URL_RE, '[link]');
  text = text.replace(PHONE_RE, (m) => (YEAR_RANGE_RE.test(m.trim()) ? m : '[phone]'));
  text = text.replace(STREET_RE, '[address]');
  if (name) {
    text = text.replace(new RegExp(`\\b${escapeRegExp(name)}\\b`, 'gi'), 'Candidate');
  }
  return { redacted: text, name: name ? 'Candidate' : null, hadContact };
}
