/**
 * Milestone 10 — report, sharing & recorded demo tests (spec §4.10, §5, §6).
 *
 * No real LLM keys: the gateway is stubbed with deterministic,
 * schema-valid responses (the M6/M7/M8 pattern).
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  REPORT_DIMENSIONS,
  llmReportSchema,
  reportRequestSchema,
} from '../apps/api/src/report/schema.js';
import {
  computeReportStats,
  deterministicDimensionScores,
  overallScore,
  dsaProblemStats,
} from '../apps/api/src/report/stats.js';
import {
  quoteIsVerbatim,
  partitionEvidence,
  enforceDimensionEvidence,
  enforceReportEvidence,
} from '../apps/api/src/report/evidence.js';
import { generateReport, DISCLAIMER } from '../apps/api/src/report/generate.js';
import {
  saveReport,
  getReportBySession,
  getReportByShareToken,
  createShareToken,
  revokeShareToken,
  newShareToken,
  _clearMemStore as _clearReportMem,
} from '../apps/api/src/report/store.js';
import * as interviewStore from '../apps/api/src/interview/store.js';

beforeEach(() => {
  interviewStore._clearMemStore();
  _clearReportMem();
});

/* --- Schemas --- */

describe('M10 — report schemas', () => {
  test('llmReportSchema accepts a full valid payload', () => {
    const parsed = llmReportSchema.parse({
      summary: 'A solid practice run with clear communication throughout.',
      dimensions: {
        optimisation: { score: 80, assessment: 'Good.', evidence: [] },
        communication: { score: 90, assessment: 'Great.', evidence: [] },
        resume_depth: { score: null, assessment: 'Too little signal.', evidence: [] },
      },
      weakTopics: [],
      studyPlan: [{ topic: 'DP', why: 'Not attempted.', actions: ['Solve 5 easies.'] }],
    });
    assert.equal(parsed.dimensions.communication.score, 90);
  });

  test('llmReportSchema rejects an empty summary and empty study plan', () => {
    assert.throws(() =>
      llmReportSchema.parse({
        summary: '',
        dimensions: {
          optimisation: { score: 80, assessment: 'x', evidence: [] },
          communication: { score: 80, assessment: 'x', evidence: [] },
          resume_depth: { score: 80, assessment: 'x', evidence: [] },
        },
        weakTopics: [],
        studyPlan: [],
      }),
    );
  });

  test('reportRequestSchema requires a session token', () => {
    assert.throws(() => reportRequestSchema.parse({}));
    assert.throws(() => reportRequestSchema.parse({ sessionToken: '' }));
  });

  test('dimension weights sum to 100 (spec §4.10)', () => {
    const total = REPORT_DIMENSIONS.reduce((s, d) => s + d.weight, 0);
    assert.equal(total, 100);
    assert.deepEqual(
      REPORT_DIMENSIONS.map((d) => d.key).sort(),
      ['code_correctness', 'communication', 'optimisation', 'problem_solving', 'resume_depth'].sort(),
    );
  });
});

/* --- Deterministic stats --- */

function fakeSession() {
  const now = Date.now();
  return {
    transcript: [
      { role: 'interviewer', text: 'Tell me about your project.', round: 'resume', at: new Date(now - 500000) },
      { role: 'candidate', text: 'I built a URL shortener with Redis caching for rate limiting.', round: 'resume', at: new Date(now - 490000) },
      { role: 'interviewer', text: 'Code it.', round: 'dsa', at: new Date(now - 400000) },
      { role: 'candidate', text: 'The hash map approach is O(n) time and O(n) space.', round: 'dsa', at: new Date(now - 100000) },
    ],
    plan: [{ type: 'intro' }, { type: 'resume' }, { type: 'dsa' }],
    rounds: {
      intro: { status: 'done', startedAt: new Date(now - 600000), endedAt: new Date(now - 540000), assessment: null },
      resume: { status: 'done', startedAt: new Date(now - 540000), endedAt: new Date(now - 400000), assessment: 'Strong.' },
      dsa: { status: 'done', startedAt: new Date(now - 400000), endedAt: new Date(now - 60000), assessment: null },
    },
    dsa: {
      'two-sum': {
        slug: 'two-sum', title: 'Two Sum', hintsUsed: 2, approachAttempts: 3,
        unlocked: true, unlockReason: 'accepted',
        submissions: [
          { language: 'python', results: { passed: 6, total: 8, verdict: 'failed' } },
          { language: 'python', results: { passed: 8, total: 8, verdict: 'all-pass' } },
        ],
      },
    },
    startedAt: new Date(now - 600000),
    endedAt: new Date(now),
  };
}

describe('M10 — deterministic stats', () => {
  test('computeReportStats counts turns, durations and DSA facts', () => {
    const stats = computeReportStats(fakeSession());
    assert.equal(stats.totalTurns, 4);
    assert.equal(stats.candidateTurns, 2);
    assert.equal(stats.interviewDurationMs, 600000);
    assert.equal(stats.rounds.find((r) => r.round === 'resume').turns, 2);
    assert.equal(stats.rounds.find((r) => r.round === 'resume').durationMs, 140000);
    assert.equal(stats.rounds.find((r) => r.round === 'resume').assessment, 'Strong.');
    assert.equal(stats.hintsUsedTotal, 2);
    const dsa = stats.dsa[0];
    assert.equal(dsa.passRate, 100); // last submission counts
    assert.deepEqual(dsa.languages, ['python']);
  });

  test('dsaProblemStats handles problems with no submissions', () => {
    const stats = dsaProblemStats({ x: { slug: 'x', hintsUsed: 0, approachAttempts: 0, submissions: [] } });
    assert.equal(stats[0].passRate, null);
  });

  test('deterministicDimensionScores applies the documented formula', () => {
    // 100 - min(2*10,30) - min((3-1)*8,24) = 100 - 20 - 16 = 64
    const { code_correctness, problem_solving } = deterministicDimensionScores(dsaProblemStats(fakeSession().dsa));
    assert.equal(code_correctness, 100);
    assert.equal(problem_solving, 64);
  });

  test('deterministic scores are null with no DSA data', () => {
    const { code_correctness, problem_solving } = deterministicDimensionScores([]);
    assert.equal(code_correctness, null);
    assert.equal(problem_solving, null);
  });

  test('overallScore is the renormalised weighted mean', () => {
    const dims = [
      { key: 'a', weight: 30, score: 100 },
      { key: 'b', weight: 30, score: 100 },
      { key: 'c', weight: 15, score: 90 },
      { key: 'd', weight: 15, score: 80 },
      { key: 'e', weight: 10, score: null },
    ];
    // (3000+3000+1350+1200)/90 = 95
    assert.equal(overallScore(dims), 95);
    assert.equal(overallScore(dims.map((d) => ({ ...d, score: null }))), null);
  });

  test('computeReportStats never throws on a sparse session', () => {
    const stats = computeReportStats({ transcript: [], plan: [], rounds: {} });
    assert.equal(stats.totalTurns, 0);
    assert.equal(stats.dsa.length, 0);
  });
});

/* --- Evidence enforcement --- */

const TRANSCRIPT = [
  { role: 'candidate', text: 'I built a URL shortener with Redis caching for rate limiting.' },
  { role: 'candidate', text: 'The hash map approach is O(n) time and O(n) space.' },
];

describe('M10 — evidence enforcement', () => {
  test('quoteIsVerbatim matches case-insensitively, rejects short quotes', () => {
    assert.equal(quoteIsVerbatim('URL shortener with Redis caching', TRANSCRIPT), true);
    assert.equal(quoteIsVerbatim('url SHORTENER with redis caching', TRANSCRIPT), true);
    assert.equal(quoteIsVerbatim('something never said here at all', TRANSCRIPT), false);
    assert.equal(quoteIsVerbatim('yes', TRANSCRIPT), false); // too short to be evidence
  });

  test('partitionEvidence splits verified from unverified', () => {
    const { verified, unverified } = partitionEvidence(
      [
        { quote: 'URL shortener with Redis caching', speaker: 'candidate' },
        { quote: 'invented claim not in transcript', speaker: 'candidate' },
      ],
      TRANSCRIPT,
    );
    assert.equal(verified.length, 1);
    assert.equal(unverified.length, 1);
  });

  test('dimension without verifiable evidence becomes insufficient-data', () => {
    const out = enforceDimensionEvidence(
      { score: 70, assessment: 'Nice.', evidence: [{ quote: 'never said anywhere', speaker: 'candidate' }] },
      TRANSCRIPT,
    );
    assert.equal(out.score, null);
    assert.equal(out.insufficientData, true);
    assert.equal(out.inference, true);
    assert.equal(out.evidence.length, 0);
  });

  test('dimension with verified evidence keeps its score', () => {
    const out = enforceDimensionEvidence(
      { score: 85, assessment: 'Good.', evidence: [{ quote: 'URL shortener with Redis caching', speaker: 'candidate' }] },
      TRANSCRIPT,
    );
    assert.equal(out.score, 85);
    assert.equal(out.insufficientData || false, false);
  });

  test('enforceReportEvidence aggregates counts', () => {
    const r = enforceReportEvidence(
      {
        dimensions: {
          communication: { score: 80, assessment: 'x', evidence: [{ quote: 'URL shortener with Redis caching', speaker: 'candidate' }] },
          optimisation: { score: 60, assessment: 'y', evidence: [{ quote: 'made up entirely', speaker: 'candidate' }] },
        },
        weakTopics: [{ topic: 'DP', reason: 'r', evidence: [] }],
      },
      TRANSCRIPT,
    );
    assert.equal(r.verifiedQuotes, 1);
    assert.equal(r.dimensions.optimisation.insufficientData, true);
    assert.equal(r.weakTopics[0].inference, true); // no verifiable evidence → inferred
  });
});

/* --- generateReport --- */

function stubGateway(handlers) {
  return {
    generate: async ({ task, prompt, schema }) => {
      const data = await handlers[task]({ task, prompt, schema });
      return { provider: 'stub', model: 'stub', data };
    },
  };
}

const LLM_REPORT = {
  summary: 'A solid practice run with clear communication and a correct optimal solution.',
  dimensions: {
    optimisation: {
      score: 90,
      assessment: 'Correctly stated O(n) time and O(n) space.',
      evidence: [{ quote: 'The hash map approach is O(n) time and O(n) space.', speaker: 'candidate' }],
    },
    communication: {
      score: 85,
      assessment: 'Clear, structured answers.',
      evidence: [{ quote: 'I built a URL shortener with Redis caching for rate limiting.', speaker: 'candidate' }],
    },
    resume_depth: { score: null, assessment: 'Too little signal in this short session.', evidence: [] },
  },
  weakTopics: [{ topic: 'System design', reason: 'Not covered in this session.', evidence: [] }],
  studyPlan: [
    { topic: 'Dynamic programming', why: 'Not attempted.', actions: ['Solve 5 DP easy problems.'], suggestedProblems: ['climbing-stairs'] },
  ],
};

async function makeDoneSessionToken() {
  const s = fakeSession();
  const created = await interviewStore.createSession({
    intakeToken: null,
    plan: s.plan,
    company: 'DemoCorp',
    role: 'SDE',
    seniority: 'new-grad',
    kbSource: 'none',
  });
  await interviewStore.updateSession(created.token, {
    status: 'done',
    endedAt: s.endedAt,
    transcript: s.transcript,
    rounds: s.rounds,
    dsa: s.dsa,
  });
  return created.token;
}

describe('M10 — generateReport', () => {
  test('rejects bad input and unknown sessions', async () => {
    assert.equal((await generateReport({})).error, 'invalid_request');
    assert.equal((await generateReport({ sessionToken: 'nope' })).error, 'session_not_found');
  });

  test('refuses sessions that are not done', async () => {
    const created = await interviewStore.createSession({ intakeToken: null, plan: [], company: null, role: null, seniority: null, kbSource: 'none' });
    const res = await generateReport({ sessionToken: created.token });
    assert.equal(res.error, 'interview_not_complete');
  });

  test('full report: deterministic dims + enforced LLM dims + share token', async () => {
    const token = await makeDoneSessionToken();
    const gw = stubGateway({ report: async () => LLM_REPORT });
    const res = await generateReport({ sessionToken: token }, { gateway: gw });
    assert.equal(res.ok, true);
    const r = res.report;
    assert.equal(typeof r.shareToken, 'string');
    assert.equal(r.shareToken.length, 32); // 128-bit hex

    const byKey = Object.fromEntries(r.dimensions.map((d) => [d.key, d]));
    assert.equal(byKey.code_correctness.score, 100);
    assert.equal(byKey.code_correctness.scoreSource, 'deterministic');
    assert.equal(byKey.problem_solving.score, 64);
    assert.equal(byKey.optimisation.score, 90);
    assert.equal(byKey.optimisation.evidence.length, 1);
    assert.equal(byKey.resume_depth.score, null);
    assert.equal(byKey.resume_depth.insufficientData, true);
    // (100*30 + 64*30 + 90*15 + 85*15) / 90 = 7545/90 = 83.83 → 84
    assert.equal(r.overallScore, 84);
    assert.equal(r.weakTopics[0].inference, true); // no verifiable quote → inferred
    assert.equal(r.studyPlan.length, 1);
    assert.equal(r.disclaimer, DISCLAIMER);
    assert.equal(r.evidenceReport.verifiedQuotes, 2);
    // inference claims: resume_depth (insufficient data) + weak topic (no evidence)
    assert.equal(r.evidenceReport.inferenceClaims, 2);
    assert.ok(r.stats);
    assert.equal(r.stats.hintsUsedTotal, 2);
  });

  test('gateway budget exhaustion maps to report_unavailable', async () => {
    const token = await makeDoneSessionToken();
    const gw = stubGateway({
      report: async () => { throw new Error('LLM budget exhausted for report: daily limit'); },
    });
    const res = await generateReport({ sessionToken: token }, { gateway: gw });
    assert.equal(res.error, 'report_unavailable');
  });

  test('gateway failure maps to report_unavailable', async () => {
    const token = await makeDoneSessionToken();
    const gw = stubGateway({ report: async () => { throw new Error('boom'); } });
    const res = await generateReport({ sessionToken: token }, { gateway: gw });
    assert.equal(res.error, 'report_unavailable');
  });
});

/* --- Sharing --- */

describe('M10 — share links', () => {
  test('newShareToken is 128-bit hex and unique', () => {
    const a = newShareToken();
    const b = newShareToken();
    assert.equal(a.length, 32);
    assert.match(a, /^[a-f0-9]{32}$/);
    assert.notEqual(a, b);
  });

  test('share → lookup → revoke lifecycle', async () => {
    const saved = await saveReport('sess-1', {
      summary: 's'.repeat(30), overallScore: 80, dimensions: [], weakTopics: [],
      studyPlan: [], stats: null, evidenceReport: { verifiedQuotes: 0, inferenceClaims: 0 }, disclaimer: 'd',
    });
    const token = await createShareToken(saved.id);
    assert.equal(typeof token, 'string');

    const found = await getReportByShareToken(token);
    assert.ok(found);
    assert.equal(found.sessionToken, 'sess-1');

    assert.equal(await revokeShareToken(token), true);
    const after = await getReportByShareToken(token);
    assert.equal(after.shareRevoked, true); // route layer turns this into 410

    assert.equal(await revokeShareToken('deadbeef'.repeat(4)), false);
    assert.equal(await getReportByShareToken('deadbeef'.repeat(4)), null);
  });

  test('getReportBySession returns the latest report', async () => {
    const mk = (summary) => saveReport('sess-2', {
      summary, overallScore: 70, dimensions: [], weakTopics: [],
      studyPlan: [], stats: null, evidenceReport: { verifiedQuotes: 0, inferenceClaims: 0 }, disclaimer: 'd',
    });
    await mk('first report, long enough to pass');
    await new Promise((r) => setTimeout(r, 5));
    await mk('second report, long enough to pass');
    const doc = await getReportBySession('sess-2');
    assert.equal(doc.report.summary, 'second report, long enough to pass');
    assert.equal(await getReportBySession('nope'), null);
  });
});
