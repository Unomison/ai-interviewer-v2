/**
 * Milestone 7 tests — research crawler + knowledge base.
 *
 * Unit tests use stubbed fetch/gateway (no network, no keys). Two tests go
 * live on purpose and are marked as such:
 *  - "live smoke" fetches https://example.com (1 tiny page) to prove the
 *    plain-HTTP fetcher works outside mocks;
 *  - the route test boots the real server and POSTs a nonsense company,
 *    asserting a graceful 200 (not a hang or 500).
 *
 * Run from the repo root: npm test
 */
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { htmlToText, truncateForPrompt } from '../apps/api/src/research/extract.js';
import {
  companyToSlug,
  deterministicUrls,
  parseDdgHtml,
  ddgSearch,
  discoverUrls,
} from '../apps/api/src/research/discover.js';
import {
  fetchPage,
  robotsAllows,
  _clearRobotsCache,
  FetchError,
} from '../apps/api/src/research/fetch.js';
import { summarizeResearch, NO_KEYS_MESSAGE } from '../apps/api/src/research/summarize.js';
import {
  cacheKey,
  getCachedKb,
  setCachedKb,
  _clearMemCache,
  RESEARCH_TTL_DAYS,
} from '../apps/api/src/research/cache.js';
import { researchCompany } from '../apps/api/src/research/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// HTML -> text extraction
// ---------------------------------------------------------------------------
describe('research extract', () => {
  test('strips scripts/nav and keeps main text', () => {
    const html = `<!doctype html><html><head><title>Acme Careers</title>
      <meta name="description" content="Join Acme."></head>
      <body><nav><a href="/x">Menu</a></nav>
      <script>alert("evil")</script>
      <main><h1>Careers at Acme</h1><p>We build &amp; ship routers.</p></main>
      <footer>Copyright 2026</footer></body></html>`;
    const { title, description, text } = htmlToText(html);
    assert.equal(title, 'Acme Careers');
    assert.equal(description, 'Join Acme.');
    assert.match(text, /Careers at Acme/);
    assert.match(text, /We build & ship routers\./);
    assert.doesNotMatch(text, /evil/);
    assert.doesNotMatch(text, /Menu/);
    assert.doesNotMatch(text, /Copyright/);
  });

  test('truncateForPrompt caps length', () => {
    const t = truncateForPrompt('x'.repeat(9000), 100);
    assert.ok(t.length < 9000 && t.endsWith('[…truncated]'));
  });
});

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------
describe('research discover', () => {
  test('companyToSlug normalizes names', () => {
    assert.equal(companyToSlug('Nokia'), 'nokia');
    assert.equal(companyToSlug('Goldman Sachs Inc.'), 'goldmansachs');
    assert.equal(companyToSlug('  Foo-Bar Labs LLC '), 'foobarlabs');
  });

  test('deterministicUrls proposes careers/about pages', () => {
    const urls = deterministicUrls('Nokia');
    assert.ok(urls.includes('https://www.nokia.com/careers/'));
    assert.ok(urls.includes('https://nokia.com/about-us/'));
    assert.equal(new Set(urls).size, urls.length);
  });

  test('parseDdgHtml extracts result links from fixture', () => {
    const html = `<div><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.acme.com%2Fcareers%2F&rut=x">Acme</a>
      <a class="result__a" href="https://example.com/about">Ex</a></div>`;
    const urls = parseDdgHtml(html);
    assert.deepEqual(urls, ['https://www.acme.com/careers/', 'https://example.com/about']);
  });

  test('ddgSearch resolves [] on failure (never throws)', async () => {
    const failFetch = async () => {
      throw new Error('blocked');
    };
    assert.deepEqual(await ddgSearch('whatever', { fetchImpl: failFetch }), []);
    const challengeFetch = async () => ({
      ok: true,
      text: async () => '<html>anomaly detected captcha</html>',
    });
    assert.deepEqual(await ddgSearch('whatever', { fetchImpl: challengeFetch }), []);
  });

  test('discoverUrls falls back to deterministic when DDG is blocked', async () => {
    const failFetch = async () => {
      throw new Error('blocked');
    };
    const { urls, strategies } = await discoverUrls('Nokia', '', {
      fetchImpl: failFetch,
      gateway: null,
    });
    assert.ok(urls.length > 0 && urls.length <= 5);
    assert.ok(strategies.deterministic > 0);
    assert.equal(strategies.ddg, 0);
  });
});

// ---------------------------------------------------------------------------
// Fetcher (local HTTP server — real sockets, no internet)
// ---------------------------------------------------------------------------
describe('research fetch', () => {
  let server;
  let base;
  const hits = { robots: 0 };

  before(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/robots.txt') {
        hits.robots += 1;
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('User-agent: *\nDisallow: /private/\n');
        return;
      }
      if (req.url === '/private/secret') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<html><body>secret</body></html>');
        return;
      }
      if (req.url === '/page') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<html><head><title>T</title></head><body><p>Hello</p></body></html>');
        return;
      }
      if (req.url === '/missing') {
        res.writeHead(404, { 'content-type': 'text/html' });
        res.end('nope');
        return;
      }
      if (req.url === '/slow') {
        setTimeout(() => {
          res.writeHead(200, { 'content-type': 'text/html' });
          res.end('<html><body>slow</body></html>');
        }, 1500);
        return;
      }
      if (req.url === '/big') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<html><body>' + 'x'.repeat(100000) + '</body></html>');
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
    _clearRobotsCache();
  });

  after(async () => {
    await new Promise((r) => server.close(r));
  });

  test('fetches a normal page', async () => {
    const p = await fetchPage(`${base}/page`);
    assert.equal(p.status, 200);
    assert.match(p.html, /Hello/);
    assert.ok(p.ms < 5000);
  });

  test('HTTP errors become FetchError(http)', async () => {
    await assert.rejects(fetchPage(`${base}/missing`), (e) => e instanceof FetchError && e.code === 'http');
  });

  test('robots.txt disallow is honoured', async () => {
    await assert.rejects(fetchPage(`${base}/private/secret`), (e) => e.code === 'robots');
    assert.ok(hits.robots >= 1);
    assert.equal(await robotsAllows(`${base}/page`), true);
    assert.equal(await robotsAllows(`${base}/private/secret`), false);
  });

  test('slow pages hit the timeout', async () => {
    await assert.rejects(fetchPage(`${base}/slow`, { timeoutMs: 300 }), (e) => e.code === 'timeout');
  });

  test('byte cap aborts large pages', async () => {
    await assert.rejects(
      fetchPage(`${base}/big`, { maxBytes: 1000 }),
      (e) => e.code === 'too_large',
    );
  });
});

// ---------------------------------------------------------------------------
// Summarizer (stubbed gateway)
// ---------------------------------------------------------------------------
describe('research summarize', () => {
  const pages = [{ url: 'https://x.test/', title: 'T', text: 'Acme builds routers.' }];

  test('refuses loudly in mock mode (no keys)', async () => {
    const mockGw = { generate: async () => ({ provider: 'mock', model: 'mock', data: {} }) };
    await assert.rejects(summarizeResearch('Acme', '', pages, mockGw), (e) =>
      e.message.includes('mock mode'),
    );
    assert.match(NO_KEYS_MESSAGE, /mock/);
  });

  test('returns gateway data when keys exist', async () => {
    const kb = { company: 'Acme', overview: 'Routers.' };
    const gw = { generate: async () => ({ provider: 'gemini', model: 'm', data: kb }) };
    assert.deepEqual(await summarizeResearch('Acme', '', pages, gw), kb);
  });

  test('requires at least one page', async () => {
    const gw = { generate: async () => ({ provider: 'gemini', data: {} }) };
    await assert.rejects(summarizeResearch('Acme', '', [], gw), /at least one/);
  });
});

// ---------------------------------------------------------------------------
// Cache (in-memory fallback — no DB in tests)
// ---------------------------------------------------------------------------
describe('research cache', () => {
  before(() => _clearMemCache());
  after(() => _clearMemCache());

  test('cacheKey normalizes company + role', () => {
    assert.equal(cacheKey('  Nokia ', 'SDE'), 'nokia|sde');
    assert.equal(cacheKey('Nokia'), 'nokia|');
  });

  test('set then get hits', async () => {
    await setCachedKb('Nokia', 'SDE', { company: 'Nokia' });
    const doc = await getCachedKb('  NOKIA ', 'sde');
    assert.ok(doc);
    assert.equal(doc.kb.company, 'Nokia');
  });

  test('miss returns null', async () => {
    assert.equal(await getCachedKb('NoSuchCorp', ''), null);
  });

  test('expired entries are treated as misses', async () => {
    await setCachedKb('OldCorp', '', { company: 'OldCorp' }, -1); // already expired
    assert.equal(await getCachedKb('OldCorp', ''), null);
  });

  test('TTL default is documented', () => {
    assert.equal(RESEARCH_TTL_DAYS, 30);
  });
});

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------
describe('research orchestrator', () => {
  const kbDoc = {
    company: 'Acme',
    role: '',
    overview: 'Acme builds routers.',
    techStack: ['Go'],
    engineeringPractices: [],
    culture: [],
    recentDevelopments: [],
    interviewAngles: [{ topic: 'Routing', why: 'Core domain', sourceUrls: [] }],
    sources: [{ url: 'https://acme.test/', title: 'T' }],
    researchedAt: new Date().toISOString(),
    provenance: 'fresh',
  };
  const fakeHtml = '<html><head><title>Acme</title></head><body><main><p>' + 'Acme builds routers. '.repeat(40) + '</p></main></body></html>';

  function stubDeps(overrides = {}) {
    const calls = { setCache: 0 };
    return {
      calls,
      deps: {
        discoverUrls: async () => ({ urls: ['https://acme.test/'], strategies: { deterministic: 1 } }),
        fetchPage: async () => ({ url: 'https://acme.test/', finalUrl: 'https://acme.test/', status: 200, html: fakeHtml, bytes: 999, ms: 5 }),
        gateway: { generate: async () => ({ provider: 'gemini', model: 'm', data: { ...kbDoc } }) },
        getCachedKb: async () => null,
        setCachedKb: async () => {
          calls.setCache += 1;
        },
        ...overrides,
      },
    };
  }

  test('cache hit returns instantly without fetching', async () => {
    let fetched = false;
    const { deps } = stubDeps({
      getCachedKb: async () => ({ kb: { ...kbDoc, provenance: 'cache' } }),
      fetchPage: async () => {
        fetched = true;
        throw new Error('should not fetch');
      },
    });
    const r = await researchCompany({ company: 'Acme', ...deps });
    assert.equal(r.source, 'cache');
    assert.equal(fetched, false);
    assert.equal(r.kb.company, 'Acme');
  });

  test('fresh run caches the KB', async () => {
    const { deps, calls } = stubDeps();
    const r = await researchCompany({ company: 'Acme', ...deps });
    assert.equal(r.source, 'fresh');
    assert.equal(r.kb.interviewAngles.length, 1);
    assert.equal(calls.setCache, 1);
    assert.equal(r.pages.length, 1);
  });

  test('mock gateway degrades to partial and never caches', async () => {
    const { deps, calls } = stubDeps({
      gateway: { generate: async () => ({ provider: 'mock', model: 'mock', data: {} }) },
    });
    const r = await researchCompany({ company: 'Acme', ...deps });
    assert.equal(r.source, 'partial');
    assert.equal(r.kb, null);
    assert.ok(r.pages.length >= 1);
    assert.match(r.note, /keys/i);
    assert.equal(calls.setCache, 0);
  });

  test('no fetchable pages -> failed with role-generic fallback', async () => {
    const { deps } = stubDeps({
      discoverUrls: async () => ({ urls: [], strategies: {} }),
    });
    const r = await researchCompany({ company: 'Nope', ...deps });
    assert.equal(r.source, 'failed');
    assert.equal(r.fallback, 'role-generic');
  });

  test('time-box: slow fetcher returns partial within budget', async () => {
    const { deps } = stubDeps({
      fetchPage: async () => {
        await new Promise((r) => setTimeout(r, 2000));
        throw new Error('too slow');
      },
    });
    const t0 = Date.now();
    const r = await researchCompany({ company: 'Acme', budgetMs: 500, ...deps });
    const ms = Date.now() - t0;
    assert.equal(r.source, 'partial');
    assert.ok(ms < 1500, `returned in ${ms}ms, expected < 1500ms`);
  });

  test('company is required', async () => {
    await assert.rejects(researchCompany({ company: '  ' }), /company is required/);
  });
});

// ---------------------------------------------------------------------------
// LIVE smoke: one real page fetch (proves the fetcher works outside mocks)
// ---------------------------------------------------------------------------
describe('research live smoke', () => {
  test('fetches https://example.com for real', async () => {
    const p = await fetchPage('https://example.com', { timeoutMs: 15000 });
    assert.equal(p.status, 200);
    const { text } = htmlToText(p.html);
    assert.match(text, /Example Domain/);
  });
});

// ---------------------------------------------------------------------------
// Route: real server, graceful behaviour
// ---------------------------------------------------------------------------
describe('research route', () => {
  const TEST_PORT = 5399;
  const BASE = `http://127.0.0.1:${TEST_PORT}`;
  let child = null;

  before(async () => {
    child = spawn(process.execPath, ['src/server.js'], {
      cwd: path.join(__dirname, '..', 'apps', 'api'),
      env: { ...process.env, PORT: String(TEST_PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // Wait for the server to answer.
    const deadline = Date.now() + 20000;
    for (;;) {
      try {
        const r = await fetch(`${BASE}/api/health`);
        if (r.ok) break;
      } catch {
        /* not up yet */
      }
      if (Date.now() > deadline) throw new Error('server did not start');
      await new Promise((r) => setTimeout(r, 250));
    }
  });

  after(async () => {
    if (child) {
      child.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 500));
    }
  });

  test('400 on empty company', async () => {
    const r = await fetch(`${BASE}/api/research`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ company: '' }),
    });
    assert.equal(r.status, 400);
  });

  test('graceful 200 for an unfetchable company (no hang, no 500)', async () => {
    const t0 = Date.now();
    const r = await fetch(`${BASE}/api/research`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ company: 'XyzzyNonexistentCorp123', role: 'SDE' }),
    });
    const ms = Date.now() - t0;
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.ok(['failed', 'partial', 'fresh'].includes(body.source));
    assert.ok(ms < 65000, `answered in ${ms}ms`);
  });
});
