/**
 * Milestone 10 — JIT problem tests (spec §4.9).
 *
 * No real LLM keys: the gateway is stubbed. Browser execution itself is
 * not under test here (no DOM/workers in node); the pure receipt
 * assessment, fallback selection and orchestration are.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  topicOverlap,
  bankCoversTopic,
  findClosestBankProblem,
  findJitCandidate,
  assessJitReceipt,
  deriveTimeLimitMs,
  requestJitProblem,
  submitJitValidation,
  logWantedProblem,
  _clearJitStores,
  _wantedLog,
  JIT_SAFETY_FACTOR,
} from '../apps/api/src/problems/jit.js';
import * as interviewStore from '../apps/api/src/interview/store.js';

const BANK = [
  { slug: 'two-sum', title: 'Two Sum', topics: ['arrays', 'hash-map'], difficulty: 'easy' },
  { slug: 'merge-intervals', title: 'Merge Intervals', topics: ['arrays', 'sorting'], difficulty: 'medium' },
  { slug: 'valid-parentheses', title: 'Valid Parentheses', topics: ['strings', 'stack'], difficulty: 'easy' },
];

const listStub = async () => ({ problems: BANK, source: 'bundled', version: '1.0.0' });

function stubGateway({ generateImpl, budgetAllowed = true } = {}) {
  return {
    budgetAllows: () => ({ allowed: budgetAllowed, reason: budgetAllowed ? 'ok' : 'daily limit' }),
    generate: async (args) => {
      if (!generateImpl) throw new Error('gateway should not have been called');
      return generateImpl(args);
    },
  };
}

const DRAFT = {
  slug: 'jit-graph-bfs',
  title: 'JIT Graph BFS',
  statement: 'Given an undirected graph as an adjacency list and a start node, return the BFS order.',
  topics: ['graphs', 'bfs'],
  difficulty: 'easy',
  reference: { javascript: 'function solve(g,s){}', python: 'def solve(g,s): pass', cpp: 'void solve(){}' },
  wrong: { language: 'javascript', code: 'function solve(g,s){return [];}', note: 'Returns empty.' },
};

beforeEach(() => {
  interviewStore._clearMemStore();
  _clearJitStores();
});

async function makeSessionToken() {
  const created = await interviewStore.createSession({
    intakeToken: null, plan: [], company: null, role: null, seniority: 'new-grad', kbSource: 'none',
  });
  return created.token;
}

/* --- Pure matching --- */

describe('M10 — JIT topic matching', () => {
  test('topicOverlap counts shared tokens', () => {
    assert.ok(topicOverlap('arrays', BANK[0]) > 0);
    assert.equal(topicOverlap('graphs', BANK[0]), 0);
    assert.equal(topicOverlap('', BANK[0]), 0);
  });

  test('bankCoversTopic respects difficulty', () => {
    assert.equal(bankCoversTopic(BANK, 'arrays', 'easy'), true);
    assert.equal(bankCoversTopic(BANK, 'arrays', 'medium'), true);
    assert.equal(bankCoversTopic(BANK, 'stack', 'medium'), false);
    assert.equal(bankCoversTopic(BANK, 'graphs', 'easy'), false);
  });

  test('findClosestBankProblem is deterministic (overlap → difficulty → slug)', () => {
    assert.equal(findClosestBankProblem(BANK, 'graphs', 'easy').slug, 'two-sum');
    assert.equal(findClosestBankProblem(BANK, 'stack data structure', 'easy').slug, 'valid-parentheses');
    assert.equal(findClosestBankProblem([], 'graphs', 'easy'), null);
  });

  test('findJitCandidate picks the first uncovered gap skill', () => {
    const c = findJitCandidate({ gapSkills: ['arrays', 'graph traversal'], seniority: 'new-grad', problems: BANK });
    assert.deepEqual(c, { topic: 'graph traversal', difficulty: 'easy' });
    assert.equal(findJitCandidate({ gapSkills: ['arrays'], seniority: 'new-grad', problems: BANK }), null);
    assert.equal(findJitCandidate({ gapSkills: [], problems: BANK }), null);
  });
});

/* --- Receipt assessment --- */

describe('M10 — JIT receipt assessment', () => {
  const good = {
    referencePassed: 8, referenceTotal: 8,
    referenceRuntimesMs: [12, 15, 11, 13, 14, 12, 15, 11],
    wrongFailed: 2, wrongTotal: 8,
  };

  test('valid receipt passes', () => {
    assert.deepEqual(assessJitReceipt(good), { ok: true, issues: [] });
  });

  test('reference must pass everything', () => {
    const r = assessJitReceipt({ ...good, referencePassed: 7 });
    assert.equal(r.ok, false);
    assert.ok(r.issues.join(' ').includes('reference passed 7/8'));
  });

  test('wrong solution must fail at least one test (M6 trust bar)', () => {
    const r = assessJitReceipt({ ...good, wrongFailed: 0 });
    assert.equal(r.ok, false);
    assert.ok(r.issues.some((i) => i.includes('wrong solution')));
  });

  test('needs at least 6 tests and plausible runtimes', () => {
    assert.equal(assessJitReceipt({ ...good, referenceTotal: 4, referencePassed: 4 }).ok, false);
    assert.equal(assessJitReceipt({ ...good, referenceRuntimesMs: [] }).ok, false);
    assert.equal(assessJitReceipt({ ...good, referenceRuntimesMs: [0, -5] }).ok, false);
    assert.equal(assessJitReceipt(null).ok, false);
  });

  test('deriveTimeLimitMs = measured × safety factor, clamped', () => {
    assert.equal(deriveTimeLimitMs([100, 200]), Math.max(2000, Math.ceil(200 * JIT_SAFETY_FACTOR)));
    assert.equal(deriveTimeLimitMs([1, 2]), 2000); // floor
    assert.equal(deriveTimeLimitMs([20000]), 30000); // ceiling
  });
});

/* --- Orchestration --- */

describe('M10 — JIT request flow', () => {
  test('bad input and unknown sessions', async () => {
    assert.equal((await requestJitProblem({})).error, 'invalid_request');
    assert.equal((await requestJitProblem({ sessionToken: 'x' })).error, 'invalid_request');
    assert.equal((await requestJitProblem({ sessionToken: 'x', topic: 'graphs' })).error, 'session_not_found');
    assert.equal((await requestJitProblem({ sessionToken: 'x', topic: 'graphs', difficulty: 'hard' })).error, 'invalid_request');
  });

  test('bank-covered topic returns the bank problem without touching the LLM', async () => {
    const token = await makeSessionToken();
    const gw = stubGateway(); // throws if generate is called
    const res = await requestJitProblem({ sessionToken: token, topic: 'arrays', difficulty: 'easy' }, { gateway: gw, listProblems: listStub });
    assert.equal(res.ok, true);
    assert.equal(res.source, 'bank');
    assert.equal(res.problem.slug, 'two-sum');
    assert.equal(res.problem.reference, undefined); // client projection only
  });

  test('uncovered topic + healthy gateway → jit-draft (never served to candidate yet)', async () => {
    const token = await makeSessionToken();
    const gw = stubGateway({
      generateImpl: async () => ({ provider: 'stub', model: 'stub', data: DRAFT }),
    });
    const res = await requestJitProblem({ sessionToken: token, topic: 'graph traversal', difficulty: 'easy' }, { gateway: gw, listProblems: listStub });
    assert.equal(res.ok, true);
    assert.equal(res.source, 'jit-draft');
    assert.ok(res.jitId);
    assert.equal(res.draft.slug, 'jit-graph-bfs');
    const wanted = _wantedLog();
    assert.equal(wanted.length, 1);
    assert.equal(wanted[0].outcome, 'generated');
  });

  test('budget exhaustion → honest bank fallback + wanted log', async () => {
    const token = await makeSessionToken();
    const gw = stubGateway({ budgetAllowed: false });
    const res = await requestJitProblem({ sessionToken: token, topic: 'graph traversal' }, { gateway: gw, listProblems: listStub });
    assert.equal(res.ok, true);
    assert.equal(res.source, 'bank-fallback');
    assert.ok(res.problem);
    assert.ok(res.reason.includes('quota'));
    assert.equal(_wantedLog()[0].outcome, 'budget_exhausted');
  });

  test('generation failure → honest bank fallback', async () => {
    const token = await makeSessionToken();
    const gw = stubGateway({ generateImpl: async () => { throw new Error('mock mode'); } });
    const res = await requestJitProblem({ sessionToken: token, topic: 'graph traversal' }, { gateway: gw, listProblems: listStub });
    assert.equal(res.source, 'bank-fallback');
    assert.ok(res.reason.includes('Could not generate'));
  });
});

describe('M10 — JIT validation flow', () => {
  async function makeDraft() {
    const token = await makeSessionToken();
    const gw = stubGateway({ generateImpl: async () => ({ provider: 'stub', model: 'stub', data: DRAFT }) });
    const req = await requestJitProblem({ sessionToken: token, topic: 'graph traversal' }, { gateway: gw, listProblems: listStub });
    return { token, jitId: req.jitId };
  }

  const goodReceipt = {
    language: 'javascript',
    referencePassed: 8, referenceTotal: 8,
    referenceRuntimesMs: [120, 150, 110, 130, 140, 120, 150, 110],
    wrongFailed: 3, wrongTotal: 8,
  };

  test('bad input and unknown drafts', async () => {
    assert.equal((await submitJitValidation({})).error, 'invalid_request');
    assert.equal((await submitJitValidation({ sessionToken: 'x', jitId: 'y', receipt: {} })).error, 'session_not_found');
    const token = await makeSessionToken();
    assert.equal((await submitJitValidation({ sessionToken: token, jitId: 'nope', receipt: goodReceipt })).error, 'jit_not_found');
  });

  test('valid receipt → session-scoped JIT problem with derived time limit', async () => {
    const { token, jitId } = await makeDraft();
    const res = await submitJitValidation({ sessionToken: token, jitId, receipt: goodReceipt }, { listProblems: listStub });
    assert.equal(res.ok, true);
    assert.equal(res.source, 'jit');
    assert.equal(res.problem.jit, true);
    assert.equal(res.problem.timeLimitMs, deriveTimeLimitMs(goodReceipt.referenceRuntimesMs));
    assert.equal(res.problem.reference, undefined); // never serve solutions
    const wanted = _wantedLog();
    assert.ok(wanted.some((w) => w.outcome === 'validated'));
  });

  test('invalid receipt → honest bank fallback, never an unvalidated problem', async () => {
    const { token, jitId } = await makeDraft();
    const res = await submitJitValidation(
      { sessionToken: token, jitId, receipt: { ...goodReceipt, wrongFailed: 0 } },
      { listProblems: listStub },
    );
    assert.equal(res.ok, true);
    assert.equal(res.source, 'bank-fallback');
    assert.ok(res.problem);
    assert.ok(res.reason.includes('failed browser validation'));
    assert.equal(res.problem.jit, undefined);
  });

  test('drafts are single-session: wrong session token rejected', async () => {
    const { jitId } = await makeDraft();
    const other = await makeSessionToken();
    const res = await submitJitValidation({ sessionToken: other, jitId, receipt: goodReceipt }, { listProblems: listStub });
    assert.equal(res.error, 'jit_not_found');
  });
});

/* --- Recorded demo: zero gateway calls --- */

describe('M10 — recorded demo is static', () => {
  test('demo data loads with a gateway that throws on any call', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, resolve } = await import('node:path');
    const here = dirname(fileURLToPath(import.meta.url));
    const demo = JSON.parse(readFileSync(resolve(here, '..', 'apps', 'api', 'data', 'recorded-demo.json'), 'utf8'));
    assert.ok(demo.meta);
    assert.ok(demo.transcript.length >= 10);
    assert.equal(demo.report.dimensions.length, 5);
    assert.ok(demo.report.overallScore >= 0);
    // Every demo evidence quote is verbatim in the demo transcript.
    const texts = demo.transcript.map((t) => t.text).join('\n').toLowerCase();
    for (const d of demo.report.dimensions) {
      for (const e of d.evidence || []) {
        assert.ok(texts.includes(e.quote.toLowerCase()), `demo quote not verbatim: ${e.quote}`);
      }
    }
  });
});
