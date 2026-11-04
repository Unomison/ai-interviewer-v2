/**
 * Milestone 3 intake + ATS tests — mock LLM (zero real keys), real HTTP.
 *
 * Uses Node's built-in test runner (node --test).
 *  - Unit: PII redaction, keyword split, truthful-suggestion filter,
 *    company/role resolution, TTL index shape.
 *  - Integration: boot the real Express server as a child process, then
 *    consent → upload → JD → ATS report over HTTP with generated PDFs.
 *  - Sample path: the gateway singleton is stubbed to throw; the sample
 *    handler must still answer 200 from precomputed data (zero LLM calls).
 *
 * Run from the repo root:  npm test
 */
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

import { redactPII, detectName } from '../apps/api/src/intake/redact.js';
import {
  normalizeSkill,
  buildResumeCorpus,
  scoreKeywords,
  splitMissing,
  scoreStructure,
  filterTruthfulSuggestions,
} from '../apps/api/src/intake/ats.js';
import { resolveCompany } from '../apps/api/src/intake/company.js';
import { resolveRoleSeniority, inferSeniority } from '../apps/api/src/intake/role.js';
import { getTtlIndexes } from '../apps/api/src/intake/store.js';
import { pseudoJd } from '../apps/api/src/routes/intake.js';
import {
  sampleAtsReportHandler,
  sampleResumeHandler,
} from '../apps/api/src/routes/sample.js';
import { SAMPLE_ATS_REPORT } from '../apps/api/src/sample/fixtures.js';
import { gateway } from '../apps/api/src/llm/index.js';
import { atsReportSchema } from '../apps/api/src/intake/schemas.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const apiDir = path.join(repoRoot, 'apps', 'api');

/* ------------------------------------------------------------------ */
/* Minimal PDF generator (one text op per line — pdf.js friendly).     */
/* ------------------------------------------------------------------ */
function makePdf(pages) {
  let out = '%PDF-1.4\n';
  const offsets = [];
  const add = (body) => {
    offsets.push(out.length);
    out += `${offsets.length} 0 obj\n${body}\nendobj\n`;
  };
  const n = pages.length;
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add(`<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + i * 2} 0 R`).join(' ')}] /Count ${n} >>`);
  const fontNum = 3 + n * 2;
  const esc = (t) => t.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  pages.forEach((lines, i) => {
    let stream = 'BT /F1 12 Tf 72 720 Td\n';
    lines.forEach((line, j) => {
      if (j > 0) stream += '0 -15 Td\n';
      stream += `(${esc(line)}) Tj\n`;
    });
    stream += 'ET';
    add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontNum} 0 R >> >> /Contents ${3 + i * 2 + 1} 0 R >>`,
    );
    add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const xrefPos = out.length;
  out += `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((o) => {
    out += `${String(o).padStart(10, '0')} 00000 n \n`;
  });
  out += `trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

const RESUME_LINES = [
  'Aarav Sharma',
  'aarav.sharma@example.com | +91 98765 43210 | github.com/aaravsharma',
  '123 MG Road, Bengaluru',
  'Experience',
  'Software Engineering Intern, Nimbus Labs, 2024-06 to 2024-12',
  'Built React dashboards with JavaScript and TypeScript',
  'Wrote Python ETL scripts loading 2M rows into PostgreSQL',
  'Education',
  'B.Tech Computer Engineering, Pune Institute of Technology, 2021-2025',
  'Skills',
  'JavaScript Python React Node SQL Git',
];

/* ------------------------------------------------------------------ */
/* 1. PII redaction                                                    */
/* ------------------------------------------------------------------ */
describe('PII redaction (before any model call)', () => {
  test('name becomes "Candidate"', () => {
    const { redacted, name } = redactPII('Aarav Sharma\nSoftware Engineer\n');
    assert.equal(name, 'Candidate');
    assert.ok(redacted.startsWith('Candidate\n'));
    assert.ok(!redacted.includes('Aarav Sharma'));
  });

  test('email, phone, links and street address are stripped', () => {
    const raw = [
      'Aarav Sharma',
      'aarav.sharma@example.com',
      '+91 98765 43210',
      'https://github.com/aaravsharma',
      '123 MG Road, Bengaluru',
      'Worked 2020 - 2024 at Acme.',
    ].join('\n');
    const { redacted, hadContact } = redactPII(raw);
    assert.ok(hadContact);
    assert.ok(redacted.includes('[email]'));
    assert.ok(redacted.includes('[phone]'));
    assert.ok(redacted.includes('[link]'));
    assert.ok(redacted.includes('[address]'));
    // Year ranges are resume content, not PII — they must survive.
    assert.ok(redacted.includes('2020 - 2024'));
    assert.ok(!redacted.includes('aarav.sharma@example.com'));
    assert.ok(!redacted.includes('98765 43210'));
  });

  test('bare years and US-style phones', () => {
    const { redacted } = redactPII('Jane Doe\nGraduated 2022\nCall 415-555-0132\n');
    assert.ok(redacted.includes('2022'), 'year must survive');
    assert.ok(redacted.includes('[phone]'), 'phone must be redacted');
    assert.ok(!redacted.includes('415-555-0132'));
  });

  test('detectName rejects non-name first lines', () => {
    assert.equal(detectName('Senior Software Engineer\n...'), null);
    assert.equal(detectName('aarav@example.com\n...'), null);
    assert.equal(detectName('A\n...'), null);
  });
});

/* ------------------------------------------------------------------ */
/* 2. Keyword scoring, missing split, truthful suggestions             */
/* ------------------------------------------------------------------ */
describe('ATS keyword scoring and honesty invariants', () => {
  const resume = {
    skills: ['JavaScript', 'Python', 'React'],
    experience: [
      {
        company: 'Acme',
        title: 'Intern',
        bullets: ['Built dashboards with React and TypeScript', 'Wrote Python scripts'],
      },
    ],
    projects: [{ name: 'X', tech: ['Node'], description: '', metrics: [] }],
    education: [],
    certifications: [],
  };

  test('exact + alias + fuzzy matching with required > preferred weights', () => {
    const corpus = buildResumeCorpus(resume);
    assert.ok(corpus.has('javascript'), 'alias map: js/jsx not needed here');
    assert.ok(corpus.has('typescript'), 'bullet token "TypeScript" normalised');
    const { score, missing } = scoreKeywords(corpus, [
      { skill: 'JavaScript', weight: 2 },
      { skill: 'TypeScript', weight: 2 },
      { skill: 'Kubernetes', weight: 2 },
      { skill: 'Docker', weight: 1 },
    ]);
    assert.ok(score > 0 && score < 100, `partial score, got ${score}`);
    assert.deepEqual(missing.sort(), ['Docker', 'Kubernetes']);
  });

  test('normalizeSkill applies the alias map', () => {
    assert.equal(normalizeSkill('JS'), 'javascript');
    assert.equal(normalizeSkill('k8s'), 'kubernetes');
    assert.equal(normalizeSkill('Node.js'), 'node');
  });

  test('missing split: evidenced-but-unstated vs genuine gaps', () => {
    const corpus = buildResumeCorpus(resume);
    const rawLower =
      'built dashboards with react and typescript. containerized services with docker.';
    const { unstatedButPresent, genuineGaps } = splitMissing(
      ['TypeScript', 'Docker', 'Kubernetes'],
      rawLower,
      corpus,
    );
    // TypeScript is in the corpus (forced through as "missing" here) and in
    // the text → evidenced. Docker is in the text → evidenced. Kubernetes is
    // nowhere → genuine gap.
    assert.ok(unstatedButPresent.includes('TypeScript'));
    assert.ok(unstatedButPresent.includes('Docker'));
    assert.deepEqual(genuineGaps, ['Kubernetes']);
  });

  test('filterTruthfulSuggestions drops claims of genuine-gap skills', () => {
    const corpus = new Set(['javascript', 'react']);
    const suggestions = [
      {
        before: 'Built dashboards',
        after: 'Built dashboards with React, improving load time 20%',
        reason: 'Quantifies.',
      },
      {
        before: 'Wrote scripts',
        after: 'Wrote Kubernetes operators to manage clusters',
        reason: 'Bad: invents Kubernetes.',
      },
    ];
    const kept = filterTruthfulSuggestions(suggestions, ['Kubernetes'], corpus);
    assert.equal(kept.length, 1);
    assert.ok(kept[0].after.includes('React'));
  });

  test('scoreStructure rewards headings, length, extractability, contact', () => {
    const good = [
      'Aarav Sharma',
      'aarav@example.com',
      'Experience',
      'Software Intern, Acme, 2024',
      'Built things with code and shipped features to production users daily.',
      'Education',
      'B.Tech, 2021-2025',
      'Skills',
      'JavaScript Python',
      'Projects',
      'Did a project.',
    ].join('\n');
    const s = scoreStructure(good.repeat(8), true);
    assert.ok(s >= 60, `expected decent structure score, got ${s}`);
  });
});

/* ------------------------------------------------------------------ */
/* 3. Company / role resolution (ADR 002)                              */
/* ------------------------------------------------------------------ */
describe('company and role resolution', () => {
  test('ADR 002 rule 1: unambiguous JD company is auto-filled', () => {
    const r = resolveCompany(
      { company: { name: 'Acme Corp', ambiguous: false } },
      { experience: [{ company: 'Other', title: 'X' }] },
    );
    assert.deepEqual(r, { company: 'Acme Corp', source: 'jd', needsInput: false });
  });

  test('ADR 002 rule 2: ambiguous JD company → empty, user fills', () => {
    const r = resolveCompany(
      { company: { name: null, ambiguous: true } },
      { experience: [{ company: 'Other', title: 'X' }] },
    );
    assert.deepEqual(r, { company: null, source: null, needsInput: true });
  });

  test('ADR 002 rule 3: no JD company → infer from resume', () => {
    const r = resolveCompany(null, { experience: [{ company: 'Nimbus Labs', title: 'Intern' }] });
    assert.deepEqual(r, { company: 'Nimbus Labs', source: 'resume', needsInput: false });
  });

  test('role from JD else needsInput; seniority inference', () => {
    const withJd = resolveRoleSeniority({ roleTitle: 'SWE', seniority: 'mid' }, {});
    assert.equal(withJd.role, 'SWE');
    assert.deepEqual(withJd.needsInput, []);
    const noJd = resolveRoleSeniority(null, {
      experience: [{ company: 'A', title: 'Software Engineering Intern', start: '2024', end: '2024' }],
    });
    assert.equal(noJd.role, null);
    assert.deepEqual(noJd.needsInput, ['role']);
    assert.equal(noJd.seniority, 'intern');
    assert.equal(
      inferSeniority({
        experience: [{ company: 'A', title: 'SWE', start: '2018', end: '2024' }],
      }),
      'senior',
    );
  });

  test('pseudoJd falls back to the generic template and is labelled', () => {
    const jd = pseudoJd('Quantum Wizard');
    assert.equal(jd.roleTitle, 'Software Engineer');
    assert.ok(jd.requiredSkills.length > 0);
  });
});

/* ------------------------------------------------------------------ */
/* 4. TTL index on the session schema (no live DB needed)              */
/* ------------------------------------------------------------------ */
describe('session TTL (privacy auto-delete)', () => {
  test('intake sessions carry a TTL index on expiresAt', () => {
    const indexes = getTtlIndexes();
    const ttl = indexes.find(([fields, opts]) => fields.expiresAt === 1);
    assert.ok(ttl, 'expected an expiresAt index');
    assert.equal(ttl[1].expireAfterSeconds, 0);
  });
});

/* ------------------------------------------------------------------ */
/* 5. Sample path: zero gateway invocations                            */
/* ------------------------------------------------------------------ */
describe('sample path serves precomputed data with zero LLM calls', () => {
  test('sampleAtsReportHandler answers 200 without touching the gateway', async () => {
    const origGenerate = gateway.generate;
    const origEmbed = gateway.embed;
    gateway.generate = () => {
      throw new Error('gateway must not be called on the sample path');
    };
    gateway.embed = () => {
      throw new Error('gateway must not be called on the sample path');
    };
    try {
      let status = null;
      let body = null;
      await sampleAtsReportHandler({}, { json: (b) => (body = b), status: (s) => ((status = s), { json: (b) => (body = b) }) });
      // Handler uses res.json directly (no explicit status) → 200 by default.
      assert.deepEqual(body.report, SAMPLE_ATS_REPORT);
      assert.equal(body.meta.llmCalls, 0);
      assert.equal(body.meta.sample, true);
      atsReportSchema.parse(body.report); // shape contract holds
    } finally {
      gateway.generate = origGenerate;
      gateway.embed = origEmbed;
    }
  });

  test('sample route module never imports the LLM gateway (structural guard)', () => {
    const src = readFileSync(new URL('../apps/api/src/routes/sample.js', import.meta.url), 'utf8');
    // Comments may mention the gateway; what matters is no import/require.
    assert.ok(!/from\s+['"][^'"]*llm\//.test(src), 'sample.js must not import from llm/');
    assert.ok(!/require\(\s*['"][^'"]*llm\//.test(src), 'sample.js must not require llm/');
    assert.ok(!/llm\/index/.test(src), 'sample.js must not reference the gateway module');
  });

  test('sampleResumeHandler serves fixtures', async () => {
    let body = null;
    await sampleResumeHandler({}, { json: (b) => (body = b) });
    assert.ok(body.resume.skills.length > 0);
    assert.equal(body.meta.llmCalls, 0);
  });
});

/* ------------------------------------------------------------------ */
/* 6. Integration: consent → upload → JD → ATS report (child server)   */
/* ------------------------------------------------------------------ */
const TEST_PORT = 5399;
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
  throw new Error(`server did not become healthy: ${lastErr?.message}`);
}

function stopServer() {
  return new Promise((resolve) => {
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
    setTimeout(() => {
      try {
        target.kill('SIGKILL');
      } catch { /* already dead */ }
      finish();
    }, 5000).unref();
  });
}

async function postJson(p, body, token) {
  const res = await fetch(`${BASE}${p}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'x-session-token': token } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function postFile(p, token, buffer, filename, mimetype) {
  const form = new FormData();
  form.append('resume', new Blob([buffer], { type: mimetype }), filename);
  const res = await fetch(`${BASE}${p}`, {
    method: 'POST',
    headers: token ? { 'x-session-token': token } : {},
    body: form,
  });
  return { status: res.status, body: await res.json() };
}

describe('intake → ATS integration (mock LLM)', () => {
  before(async () => {
    await startServer(); // no keys, no DB → mock gateway + memory store
    await waitForHealth();
  });

  after(async () => {
    await stopServer();
  });

  test('consent requires an explicit true', async () => {
    const { status, body } = await postJson('/api/intake/consent', { consent: false });
    assert.equal(status, 400);
    assert.equal(body.error, 'consent_required');
  });

  test('full flow: consent → upload → JD → report, deterministic', async () => {
    const c = await postJson('/api/intake/consent', { consent: true });
    assert.equal(c.status, 201);
    const token = c.body.token;
    assert.ok(token && token.length >= 32);

    const pdf = makePdf([RESUME_LINES]);
    const u = await postFile('/api/intake/resume', token, pdf, 'resume.pdf', 'application/pdf');
    assert.equal(u.status, 200);
    assert.equal(u.body.pages, 1);
    assert.ok(u.body.resume, 'parsed resume returned');

    const j = await postJson(
      '/api/intake/jd',
      {
        text: 'Hiring a Software Engineer at Acme Corp. Must have: JavaScript, Python, Git. Nice to have: React, Docker. Build REST APIs.',
      },
      token,
    );
    assert.equal(j.status, 200);
    assert.ok(j.body.role);

    const r1 = await postJson('/api/ats/report', {}, token);
    assert.equal(r1.status, 200);
    const report = r1.body.report;
    atsReportSchema.parse(report); // contract holds
    assert.equal(report.estimated, true);
    assert.ok(report.disclaimer.includes('estimate'));
    assert.ok(Array.isArray(report.missingKeywords.unstatedButPresent));
    assert.ok(Array.isArray(report.missingKeywords.genuineGaps));

    const r2 = await postJson('/api/ats/report', {}, token);
    assert.deepEqual(
      r2.body.report.breakdown,
      report.breakdown,
      'same resume+JD → identical deterministic breakdown',
    );
    assert.equal(r2.body.report.totalScore, report.totalScore);
  });

  test('ATS report without a JD uses the labelled role-template path', async () => {
    const c = await postJson('/api/intake/consent', { consent: true });
    const token = c.body.token;
    await postFile('/api/intake/resume', token, makePdf([RESUME_LINES]), 'r.pdf', 'application/pdf');
    const r = await postJson('/api/ats/report', { role: 'Software Engineer' }, token);
    assert.equal(r.status, 200);
    assert.equal(r.body.report.jdSource, 'role-template');
  });

  test('rejections: oversize, too many pages, scanned, wrong type', async () => {
    const c = await postJson('/api/intake/consent', { consent: true });
    const token = c.body.token;

    // >2 MB
    const big = Buffer.alloc(2 * 1024 * 1024 + 1, 0);
    const over = await postFile('/api/intake/resume', token, big, 'big.pdf', 'application/pdf');
    assert.equal(over.status, 400);
    assert.equal(over.body.error, 'file_too_large');

    // 4 pages
    const four = await postFile(
      '/api/intake/resume',
      token,
      makePdf([['a'], ['b'], ['c'], ['d']]),
      'long.pdf',
      'application/pdf',
    );
    assert.equal(four.status, 400);
    assert.equal(four.body.error, 'too_many_pages');

    // image-only (no text)
    const scanned = await postFile(
      '/api/intake/resume',
      token,
      makePdf([[' ']]),
      'scan.pdf',
      'application/pdf',
    );
    assert.equal(scanned.status, 400);
    assert.equal(scanned.body.error, 'scanned_pdf');

    // wrong type
    const txt = await postFile(
      '/api/intake/resume',
      token,
      Buffer.from('hello'),
      'notes.txt',
      'text/plain',
    );
    assert.equal(txt.status, 400);
    assert.equal(txt.body.error, 'unsupported_type');
  });

  test('protected routes reject missing sessions; delete-my-data works', async () => {
    const r = await postJson('/api/ats/report', {}, 'bogus-token');
    assert.equal(r.status, 401);

    const c = await postJson('/api/intake/consent', { consent: true });
    const token = c.body.token;
    const del = await fetch(`${BASE}/api/intake/session`, {
      method: 'DELETE',
      headers: { 'x-session-token': token },
    });
    assert.equal(del.status, 200);
    const after = await postJson('/api/ats/report', {}, token);
    assert.equal(after.status, 401, 'session is gone after delete');
  });
});
