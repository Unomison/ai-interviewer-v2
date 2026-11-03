/**
 * API client for the interviewer backend.
 *
 * API base comes from VITE_API_URL at build time (see .env.example).
 * Deployed: the Render backend URL. Local: http://localhost:5000.
 */
const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:5000').replace(/\/$/, '');

async function fetchJson(path, { timeoutMs = 8000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}${path}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export function pingHealth() {
  return fetchJson('/api/health');
}

export function apiBase() {
  return API_BASE;
}
