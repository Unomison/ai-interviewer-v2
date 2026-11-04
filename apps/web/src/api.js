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
