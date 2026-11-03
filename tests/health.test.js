/**
 * Milestone 1 API tests — real server, real HTTP, no mocks.
 *
 * Uses Node's built-in test runner (node --test). Each test boots the actual
 * Express server as a child process, waits for it to answer /api/health,
 * asserts the response shape, then shuts the server down.
 *
 * Run from the repo root:  npm test
 */
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const apiDir = path.join(repoRoot, 'apps', 'api');

// Fixed high port for the test server; unlikely to be in use on a dev box.
const TEST_PORT = 5199;
const BASE = `http://127.0.0.1:${TEST_PORT}`;

let child = null;

function startServer(env = {}) {
  return new Promise((resolve, reject) => {
    child = spawn(process.execPath, ['src/server.js'], {
      cwd: apiDir,
      env: { ...process.env, PORT: String(TEST_PORT), ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0 && code !== null) reject(new Error(`server exited with code ${code}`));
    });
    resolve(child);
  });
}

/** Poll /api/health until it answers or the timeout expires. */
async function waitForHealth(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return await res.json();
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`server did not become healthy in time: ${lastErr?.message}`);
}

function stopServer() {
  return new Promise((resolve) => {
    // Capture the target in a local: the module-level `child` is reassigned
    // by the next suite's before() hook, and a late fallback timer must never
    // signal the *new* server.
    const target = child;
    if (!target || target.exitCode !== null) return resolve();
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    target.on('exit', finish);
    target.kill('SIGTERM');
    // Safety net: never hang the test run on a stuck child.
    setTimeout(() => {
      try {
        target.kill('SIGKILL');
      } catch {
        /* already dead */
      }
      finish();
    }, 5000).unref();
  });
}

describe('API health endpoint (Milestone 1)', () => {
  before(async () => {
    await startServer(); // no MONGODB_URI
  });

  after(async () => {
    await stopServer();
  });

  test('GET /api/health returns 200 with status, db and time fields', async () => {
    const body = await waitForHealth();
    assert.equal(body.status, 'ok');
    assert.equal(body.db, 'not_configured');
    assert.match(body.time, /^\d{4}-\d{2}-\d{2}T/, 'time should be an ISO string');
  });

  test('unknown API routes return JSON 404, not an HTML crash page', async () => {
    const res = await fetch(`${BASE}/api/does-not-exist`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, 'not_found');
  });
});

describe('graceful degradation without a reachable database', () => {
  before(async () => {
    // Port 27099 has nothing listening: connection must fail fast and the
    // server must still boot and serve traffic.
    await startServer({ MONGODB_URI: 'mongodb://127.0.0.1:27099/ai_test' });
  });

  after(async () => {
    await stopServer();
  });

  test('server stays up and reports db:"unreachable"', async () => {
    // The driver takes the full serverSelectionTimeoutMS (~5s) to declare the
    // host dead, so poll until the status settles instead of asserting on the
    // first response (which still shows the initial "not_configured").
    const deadline = Date.now() + 20000;
    let body = null;
    while (Date.now() < deadline) {
      body = await waitForHealth(20000);
      if (body.db === 'unreachable') break;
      await new Promise((r) => setTimeout(r, 500));
    }
    assert.equal(body.status, 'ok');
    assert.equal(body.db, 'unreachable');
  });
});
