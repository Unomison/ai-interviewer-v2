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

/* --- Milestone 9: voice ----------------------------------------------------- */

export function transcribeAudio(blob, vocabularyHint = '') {
  const form = new FormData();
  form.append('audio', blob, 'audio.webm');
  if (vocabularyHint) form.append('vocabularyHint', vocabularyHint);
  return request('/api/voice/transcribe', { method: 'POST', body: form, timeoutMs: 90000 });
}

export function voiceStatus() {
  return request('/api/voice/status', { timeoutMs: 8000 });
}

/**
 * Streaming interview turn over SSE (POST /api/interview/turn/stream).
 * onChunk receives speakable message-text deltas as they arrive; resolves
 * with the `done` payload ({ ok, message, openingMessage, currentRound,
 * transitionedTo, done, state }). Throws a coded Error on stream errors.
 */
export async function interviewTurnStream(sessionToken, text, { onChunk, signal } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180000);
  const forwardAbort = () => controller.abort();
  if (signal) signal.addEventListener('abort', forwardAbort, { once: true });
  try {
    const res = await fetch(`${API_BASE}/api/interview/turn/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionToken, text }),
      signal: controller.signal,
    });
    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => ({}));
      const err = new Error(data.message || `Request failed (HTTP ${res.status})`);
      err.code = data.error;
      err.status = res.status;
      throw err;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let donePayload = null;
    const handleEvent = (raw) => {
      const lines = raw.split('\n');
      const event = (lines.find((l) => l.startsWith('event:')) || '').slice(6).trim();
      const data = lines
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim())
        .join('\n');
      if (!event || !data) return; // heartbeat comment or keep-alive padding
      const parsed = JSON.parse(data);
      if (event === 'chunk') {
        if (onChunk && parsed.text) onChunk(parsed.text);
      } else if (event === 'done') {
        donePayload = parsed;
      } else if (event === 'error') {
        const err = new Error(parsed.message || parsed.error || 'Stream failed');
        err.code = parsed.error;
        throw err;
      }
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        if (raw.trim()) handleEvent(raw);
      }
    }
    if (!donePayload) throw new Error('The reply stream ended before finishing.');
    return donePayload;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', forwardAbort);
  }
}

/* --- Milestone 10: report, sharing, JIT ---------------------------------- */

export function generateReport(sessionToken) {
  return request('/api/report/generate', {
    method: 'POST',
    body: { sessionToken },
    timeoutMs: 120000,
  });
}

export function fetchReport(sessionToken) {
  return request(`/api/report?sessionToken=${encodeURIComponent(sessionToken)}`, { timeoutMs: 15000 });
}

export function fetchSharedReport(shareToken) {
  return request(`/api/report/share/${encodeURIComponent(shareToken)}`, { timeoutMs: 15000 });
}

export function revokeShare(shareToken) {
  return request(`/api/report/share/${encodeURIComponent(shareToken)}`, { method: 'DELETE', timeoutMs: 15000 });
}

export function fetchRecordedDemo() {
  return request('/api/report/demo', { timeoutMs: 15000 });
}

export function llmStatus() {
  return request('/api/llm/status', { timeoutMs: 8000 });
}

export function requestJitProblem(sessionToken, topic, difficulty = 'easy') {
  return request('/api/problems/jit', {
    method: 'POST',
    body: { sessionToken, topic, difficulty },
    timeoutMs: 120000,
  });
}

export function submitJitValidation(sessionToken, jitId, receipt) {
  return request('/api/problems/jit/validate', {
    method: 'POST',
    body: { sessionToken, jitId, receipt },
    timeoutMs: 30000,
  });
}
