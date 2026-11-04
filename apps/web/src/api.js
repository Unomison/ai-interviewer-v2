/**
 * API client for the interviewer backend.
 *
 * API base comes from VITE_API_URL at build time (see .env.example).
 * Deployed: the Render backend URL. Local: http://localhost:5000.
 *
 * Milestone 3 adds the intake + ATS calls. The guest session token travels
 * in the `x-session-token` header; there is no login anywhere (spec).
 */
const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:5000').replace(/\/$/, '');

async function request(path, { method = 'GET', body, token, timeoutMs = 8000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = {};
    if (token) headers['x-session-token'] = token;
    // FormData sets its own Content-Type (with boundary) — never override it.
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
    if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: isForm ? body : body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.message || `Request failed (HTTP ${res.status})`);
      err.code = data.error;
      err.status = res.status;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export function pingHealth() {
  return request('/api/health');
}

export function apiBase() {
  return API_BASE;
}

/* --- Milestone 3: intake + ATS ------------------------------------------- */

const NOTICE_VERSION = 'v1';

export function submitConsent() {
  return request('/api/intake/consent', {
    method: 'POST',
    body: { consent: true, noticeVersion: NOTICE_VERSION },
  });
}

export function uploadResume(token, file) {
  const form = new FormData();
  form.append('resume', file);
  return request('/api/intake/resume', { method: 'POST', body: form, token, timeoutMs: 90000 });
}

export function submitJd(token, text) {
  return request('/api/intake/jd', { method: 'POST', body: { text }, token, timeoutMs: 90000 });
}

export function buildAtsReport(token, overrides = {}) {
  return request('/api/ats/report', {
    method: 'POST',
    body: overrides,
    token,
    timeoutMs: 120000,
  });
}

export function deleteMyData(token) {
  return request('/api/intake/session', { method: 'DELETE', token });
}

export function fetchSampleReport() {
  return request('/api/sample/ats-report', { timeoutMs: 15000 });
}

/* --- Milestone 8: interview engine ---------------------------------------- */

export function startInterview(intakeToken) {
  return request('/api/interview/start', {
    method: 'POST',
    body: { intakeToken },
    timeoutMs: 180000, // research (≤60s) + planner + intro turn
  });
}

export function interviewTurn(sessionToken, text) {
  return request('/api/interview/turn', {
    method: 'POST',
    body: { sessionToken, text },
    timeoutMs: 120000,
  });
}

export function getInterviewState(sessionToken) {
  return request(`/api/interview/state?token=${encodeURIComponent(sessionToken)}`, {
    timeoutMs: 15000,
  });
}

export function submitApproach(sessionToken, problemSlug, approachText) {
  return request('/api/interview/approach', {
    method: 'POST',
    body: { sessionToken, problemSlug, approachText },
    timeoutMs: 120000,
  });
}

export function submitDsaResult(sessionToken, problemSlug, language, code, results) {
  return request('/api/interview/dsa-result', {
    method: 'POST',
    body: {
      sessionToken,
      problemSlug,
      language,
      code,
      results: {
        verdict: results.verdict,
        passed: results.passed,
        total: results.total,
        firstFailure: results.firstFailure || null,
      },
    },
    timeoutMs: 120000,
  });
}
