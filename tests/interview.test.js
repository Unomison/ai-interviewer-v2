/**
 * Milestone 8 — interview engine tests (spec §§4.4–4.6).
 *
 * No real LLM keys: the gateway is stubbed per task with deterministic,
 * schema-valid responses (the M6/M7 pattern). The mock end-to-end walks a
 * full interview through the ADR-002 round order.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  ROUND_ORDER,
  planContentSchema,
  turnOutputSchema,
  approachJudgeSchema,
} from '../apps/api/src/interview/schema.js';
import { scoreProblem, selectProblems } from '../apps/api/src/interview/selectProblems.js';
import { assemblePlan } from '../apps/api/src/interview/planner.js';
import {
  nextRound,
  checkTransition,
  applyJudgeVerdict,
  scoreDsaProblem,
  checkDsaAction,
  MAX_HINTS,
} from '../apps/api/src/interview/machine.js';
import { buildTurnContext, VERBATIM_TURNS } from '../apps/api/src/interview/interviewer.js';
import * as store from '../apps/api/src/interview/store.js';
import * as interview from '../apps/api/src/interview/index.js';
import {
  createSession as createIntakeSession,
  updateSession as updateIntakeSession,
} from '../apps/api/src/intake/store.js';

let intakeCounter = 0;

beforeEach(() => {
  store._clearMemStore();
});

/* --- Schemas --- */

describe('M8 — schemas', () => {
  test('plan content accepts a full valid shape', () => {
    const parsed = planContentSchema.parse({
      resume: { focusAreas: [{ project: 'X', angle: 'Y' }], numQuestions: 3 },
      cs: { topics: ['OS'] },
    });
    assert.equal(parsed.resume.numQuestions, 3);
    assert.deepEqual(parsed.dsa, { notes: '' });
  });

  test('plan content rejects out-of-range values', () => {
    assert.throws(() => planContentSchema.parse({ resume: { numQuestions: 99 } }));
  });

  test('turn output requires a non-empty message', () => {
    assert.throws(() => turnOutputSchema.parse({ message: '', endRound: false }));
    const ok = turnOutputSchema.parse({ message: 'Hello?' });
    assert.equal(ok.endRound, false);
    assert.equal(ok.advanceProblem, false);
  });

  test('judge output requires a valid verdict', () => {
    assert.throws(() =>
      approachJudgeSchema.parse({ matchesOptimal: true, bruteForceOnly: false, verdict: 'maybe', feedback: 'x' }),
    );
  });
});

describe('M8 — assemblePlan enforces ADR-002 order', () => {
  test('rounds come out in canonical order regardless of content', () => {
    const plan = assemblePlan({}, [{ slug: 'two-sum', title: 'Two Sum' }]);
    assert.deepEqual(plan.map((r) => r.type), ROUND_ORDER);
    assert.equal(plan.find((r) => r.type === 'dsa').problems[0].slug, 'two-sum');
  });

  test('CS falls back to default topics when the planner gives none', () => {
    const plan = assemblePlan({}, []);
    assert.ok(plan.find((r) => r.type === 'cs').topics.length > 0);
  });
});

/* --- Problem selection --- */

describe('M8 — selectProblems (deterministic)', () => {
  const fakeBank = [
    { slug: 'a-arrays', title: 'Array Fun', difficulty: 'easy', topics: ['arrays'] },
    { slug: 'b-hash', title: 'Hash Map Fun', difficulty: 'easy', topics: ['hash-map'] },
    { slug: 'c-hard', title: 'Hard One', difficulty: 'medium', topics: ['arrays'] },
  ];
  const listFn = async () => ({ problems: fakeBank });

  test('new-grad only sees easy problems', async () => {
    const picked = await selectProblems({ seniority: 'new-grad', listFn });
    assert.ok(picked.every((p) => p.difficulty === 'easy'));
    assert.equal(picked.length, 2);
  });

  test('gap-topic overlap ranks first, ties break by slug', async () => {
    const picked = await selectProblems({ seniority: 'mid', gapSkills: ['hash maps'], listFn });
    assert.equal(picked[0].slug, 'b-hash');
  });

  test('excludeSlugs is honoured', async () => {
    const picked = await selectProblems({ seniority: 'new-grad', excludeSlugs: ['a-arrays'], listFn });
    assert.ok(picked.every((p) => p.slug !== 'a-arrays'));
  });

  test('real bank returns two easy problems for new-grad', async () => {
    const picked = await selectProblems({ seniority: 'new-grad' });
    assert.equal(picked.length, 2);
    assert.ok(picked.every((p) => p.difficulty === 'easy'));
  });

  test('scoreProblem is 0 with no overlap', () => {
    assert.equal(scoreProblem(fakeBank[0], ['photonics']), 0);
    assert.ok(scoreProblem(fakeBank[1], ['hash maps']) > 0);
  });
});

/* --- State machine --- */

describe('M8 — round machine', () => {
  test('nextRound follows the ADR-002 sequence', () => {
    const seq = [];
    let r = 'intro';
    while (r !== 'done') {
      seq.push(r);
      r = nextRound(r);
    }
    assert.deepEqual(seq, ['intro', 'resume', 'dsa', 'cs', 'behavioral', 'closing']);
  });

  test('valid forward transition accepted', () => {
    assert.deepEqual(checkTransition('resume', 'dsa'), { ok: true });
    assert.deepEqual(checkTransition('closing', 'done'), { ok: true });
  });

  test('skips, repeats and unknown rounds rejected — never throws', () => {
    for (const [from, to] of [['intro', 'dsa'], ['dsa', 'dsa'], ['resume', 'intro'], ['nope', 'dsa'], ['dsa', 'nope']]) {
      const res = checkTransition(from, to);
      assert.equal(res.ok, false, `${from} → ${to}`);
      assert.match(res.reason, /./);
    }
  });
});

describe('M8 — DSA sub-machine', () => {
  test('accept unlocks without penalty', () => {
    const out = applyJudgeVerdict({ hintsUsed: 0, hintsGiven: [] }, 'accept');
    assert.equal(out.unlocked, true);
    assert.equal(out.unlockReason, 'accepted');
    assert.equal(out.patch.state, 'coding');
  });

  test('hint serves the next hint and stays locked', () => {
    const out = applyJudgeVerdict({ hintsUsed: 0, hintsGiven: [] }, 'hint', 'hint-1');
    assert.equal(out.unlocked, false);
    assert.equal(out.hintToServe, 'hint-1');
    assert.equal(out.patch.hintsUsed, 1);
  });

  test('third hint unlocks anyway (spec §4.6)', () => {
    const out = applyJudgeVerdict({ hintsUsed: 2, hintsGiven: ['h1', 'h2'] }, 'hint', 'h3');
    assert.equal(out.unlocked, true);
    assert.equal(out.unlockReason, 'hints-exhausted');
    assert.equal(out.hintToServe, 'h3');
  });

  test('clarify stays locked without spending a hint', () => {
    const out = applyJudgeVerdict({ hintsUsed: 1, hintsGiven: ['h1'] }, 'clarify');
    assert.equal(out.unlocked, false);
    assert.equal(out.patch.hintsUsed, undefined);
  });

  test('judge error unlocks (never hard-lock)', () => {
    const out = applyJudgeVerdict({ hintsUsed: 0, hintsGiven: [] }, 'error');
    assert.equal(out.unlocked, true);
    assert.equal(out.unlockReason, 'judge-error');
  });

  test('scoring applies the hint penalty, capped', () => {
    const mk = (hintsUsed) => ({ hintsUsed, submissions: [{ results: { passed: 6, total: 6, verdict: 'all-pass' } }] });
    assert.equal(scoreDsaProblem(mk(0)), 100);
    assert.equal(scoreDsaProblem(mk(1)), 95);
    assert.equal(scoreDsaProblem(mk(3)), 85);
    assert.equal(scoreDsaProblem(mk(10)), 85); // capped at 15
    assert.equal(scoreDsaProblem({ hintsUsed: 0, submissions: [] }), 0);
    const partial = { hintsUsed: 0, submissions: [{ results: { passed: 3, total: 6, verdict: 'failed' } }] };
    assert.equal(scoreDsaProblem(partial), 50);
  });

  test('DSA action gating', () => {
    assert.deepEqual(checkDsaAction({ state: 'shown' }, 'start-approach'), { ok: true });
    assert.equal(checkDsaAction({ state: 'shown' }, 'submit-code').ok, false);
    assert.deepEqual(checkDsaAction({ state: 'coding' }, 'submit-code'), { ok: true });
    assert.equal(checkDsaAction({ state: 'bogus' }, 'submit-code').ok, false);
  });

  test('MAX_HINTS is 3 per spec', () => {
    assert.equal(MAX_HINTS, 3);
  });
});

/* --- Transcript bounding --- */

describe('M8 — buildTurnContext bounds the prompt', () => {
  test('short transcripts pass through verbatim', () => {
    const t = [
      { role: 'candidate', text: 'hi', round: 'intro' },
      { role: 'interviewer', text: 'hello', round: 'intro' },
    ];
    const ctx = buildTurnContext(t);
    assert.match(ctx, /hi/);
    assert.match(ctx, /hello/);
    assert.doesNotMatch(ctx, /condensed/);
  });

  test('long transcripts condense older turns', () => {
    const t = Array.from({ length: VERBATIM_TURNS + 5 }, (_, i) => ({
      role: i % 2 ? 'candidate' : 'interviewer',
      text: `message number ${i} with enough content to be realistic`,
      round: 'resume',
    }));
    const ctx = buildTurnContext(t);
    assert.match(ctx, /condensed/);
    assert.match(ctx, /message number 14/); // last verbatim turn present in full
  });
});

/* --- Full mock end-to-end --- */

function stubGateway(handlers) {
  return {
    generate: async ({ task, prompt, schema }) => {
      const data = await handlers[task]({ task, prompt, schema });
      return { provider: 'stub', model: 'stub', data };
    },
  };
}

async function makeIntake() {
  intakeCounter += 1;
  const token = `intake-test-${intakeCounter}`;
  const s = await createIntakeSession({ token, consent: true, noticeVersion: 'v1' });
  await updateIntakeSession(s.token, {
    resumeJson: { skills: ['Python'], projects: [{ name: 'P', tech: ['Python'], description: 'd' }], experience: [] },
    jdJson: { roleTitle: 'Engineer' },
    company: null, // skips the M7 research path (stubbed separately anyway)
    role: 'Engineer',
    seniority: 'new-grad',
    atsReport: { missingKeywords: { genuineGaps: ['multithreading'], unstatedButPresent: [] } },
  });
  return s.token;
}

const planStubData = {
  intro: { goals: ['Welcome'] },
  resume: { focusAreas: [{ project: 'P', angle: 'depth' }], numQuestions: 2 },
  dsa: { notes: '' },
  cs: { topics: ['OS'] },
  behavioral: { themes: ['ownership'] },
  closing: { goals: ['Wrap'] },
};

describe('M8 — full mock interview end-to-end', () => {
  test('a complete text interview walks the ADR-002 order and records everything', async () => {
    const intakeToken = await makeIntake();
    const gw = stubGateway({
      planner: async () => planStubData,
      interviewer: async () => ({
        message: 'Next question?',
        endRound: true,
        advanceProblem: false,
        roundAssessment: { score: 80, strengths: ['clear'], improvements: ['depth'], evidence: ['said X'] },
      }),
      approach_judge: async () => ({
        matchesOptimal: true,
        statedComplexity: 'O(n)',
        keyInsightsHit: ['hash map'],
        keyInsightsMissed: [],
        bruteForceOnly: false,
        verdict: 'accept',
        feedback: 'Solid approach.',
      }),
    });

    const started = await interview.startInterview({ intakeToken }, { gateway: gw });
    assert.equal(started.ok, true);
    assert.ok(started.sessionToken);
    assert.equal(started.state.currentRound, 'intro');

    const visited = ['intro'];
    for (let i = 0; i < 6; i++) {
      const turn = await interview.takeTurn({ sessionToken: started.sessionToken, text: `answer ${i}` }, { gateway: gw });
      assert.equal(turn.ok, true, JSON.stringify(turn));
      if (turn.transitionedTo && turn.transitionedTo !== 'done') visited.push(turn.transitionedTo);
      if (turn.done) break;
    }
    assert.deepEqual(visited, ROUND_ORDER);

    const { state } = await interview.getState({ token: started.sessionToken });
    assert.equal(state.done, true);
    assert.ok(state.transcript.length >= 12, 'full transcript recorded');
    for (const r of ROUND_ORDER) {
      assert.equal(state.rounds[r].status, 'done', `round ${r} done`);
      assert.ok(state.rounds[r].assessment, `round ${r} assessed`);
    }
    // Nothing sensitive leaks to the client.
    const blob = JSON.stringify(state);
    assert.doesNotMatch(blob, /reference/);
  });

  test('start rejects unknown intake tokens clearly', async () => {
    const gw = stubGateway({ planner: async () => planStubData });
    const res = await interview.startInterview({ intakeToken: 'nope' }, { gateway: gw });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'intake_not_found');
  });

  test('turn on unknown session is rejected, not thrown', async () => {
    const gw = stubGateway({});
    const res = await interview.takeTurn({ sessionToken: 'nope', text: 'hi' }, { gateway: gw });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'session_not_found');
  });

  test('empty turn text is rejected', async () => {
    const gw = stubGateway({});
    const res = await interview.takeTurn({ sessionToken: 'x', text: '   ' }, { gateway: gw });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'invalid_request');
  });
});

describe('M8 — approach judge flow (mock)', () => {
  async function startDsaSession(gw) {
    const intakeToken = await makeIntake();
    const started = await interview.startInterview({ intakeToken }, { gateway: gw });
    assert.equal(started.ok, true);
    // Jump straight into the DSA round for a focused test (machine-tested transitions cover the walk).
    const session = await store.getSession(started.sessionToken);
    const rounds = { ...session.rounds };
    for (const r of ['intro', 'resume']) rounds[r] = { ...rounds[r], status: 'done', endedAt: new Date() };
    rounds.dsa = { ...rounds.dsa, status: 'active', startedAt: new Date() };
    const firstSlug = Object.keys(session.dsa)[0];
    const dsa = { ...session.dsa, [firstSlug]: { ...session.dsa[firstSlug], state: 'approach', startedAt: new Date() } };
    await store.updateSession(started.sessionToken, { rounds, currentRound: 'dsa', dsa, activeProblemSlug: firstSlug });
    return { token: started.sessionToken, slug: firstSlug };
  }

  const baseGw = {
    planner: async () => planStubData,
    interviewer: async () => ({ message: 'ok', endRound: false, advanceProblem: false, roundAssessment: null }),
  };

  test('accepted approach unlocks the editor', async () => {
    const gw = stubGateway({
      ...baseGw,
      approach_judge: async () => ({
        matchesOptimal: true, statedComplexity: 'O(n)', keyInsightsHit: [], keyInsightsMissed: [],
        bruteForceOnly: false, verdict: 'accept', feedback: 'Good.',
      }),
    });
    const { token, slug } = await startDsaSession(gw);
    const res = await interview.submitApproach({ sessionToken: token, problemSlug: slug, approachText: 'hash map, one pass' }, { gateway: gw });
    assert.equal(res.ok, true);
    assert.equal(res.accepted, true);
    assert.equal(res.unlocked, true);
    const { state } = await interview.getState({ token });
    assert.equal(state.dsa[slug].unlocked, true);
  });

  test('hint verdict serves one hint and stays locked', async () => {
    const gw = stubGateway({
      ...baseGw,
      approach_judge: async () => ({
        matchesOptimal: false, statedComplexity: 'O(n^2)', keyInsightsHit: [], keyInsightsMissed: ['complement'],
        bruteForceOnly: true, verdict: 'hint', feedback: 'Think about what you remember.',
      }),
    });
    const { token, slug } = await startDsaSession(gw);
    const res = await interview.submitApproach({ sessionToken: token, problemSlug: slug, approachText: 'two loops' }, { gateway: gw });
    assert.equal(res.ok, true);
    assert.equal(res.accepted, false);
    assert.ok(res.hint && res.hint.length > 0, 'a precomputed hint is served');
    assert.equal(res.hintsUsed, 1);
  });

  test('judge failure unlocks rather than hard-locking', async () => {
    const gw = stubGateway({
      ...baseGw,
      approach_judge: async () => { throw new Error('provider down'); },
    });
    const { token, slug } = await startDsaSession(gw);
    const res = await interview.submitApproach({ sessionToken: token, problemSlug: slug, approachText: 'something' }, { gateway: gw });
    assert.equal(res.ok, true);
    assert.equal(res.unlocked, true);
    assert.equal(res.judgeError, true);
  });

  test('approach outside the DSA round is rejected', async () => {
    const gw = stubGateway({ ...baseGw, approach_judge: async () => ({}) });
    const intakeToken = await makeIntake();
    const started = await interview.startInterview({ intakeToken }, { gateway: gw });
    const res = await interview.submitApproach({ sessionToken: started.sessionToken, problemSlug: 'two-sum', approachText: 'x' }, { gateway: gw });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'not_in_dsa_round');
  });

  test('dsa-result records the submission and gets an interviewer reaction', async () => {
    const gw = stubGateway({
      ...baseGw,
      approach_judge: async () => ({
        matchesOptimal: true, statedComplexity: 'O(n)', keyInsightsHit: [], keyInsightsMissed: [],
        bruteForceOnly: false, verdict: 'accept', feedback: 'Good.',
      }),
      interviewer: async () => ({ message: 'All green! What is the time complexity?', endRound: false, advanceProblem: false, roundAssessment: null }),
    });
    const { token, slug } = await startDsaSession(gw);
    await interview.submitApproach({ sessionToken: token, problemSlug: slug, approachText: 'hash map' }, { gateway: gw });
    const res = await interview.submitDsaResult({
      sessionToken: token, problemSlug: slug, language: 'python', code: 'def solve(nums, target): return [0, 1]',
      results: { verdict: 'all-pass', passed: 6, total: 6, firstFailure: null },
    }, { gateway: gw });
    assert.equal(res.ok, true);
    assert.equal(res.recorded, true);
    assert.match(res.message, /complexity/);
    const { state } = await interview.getState({ token });
    assert.equal(state.dsa[slug].submissions, 1);
  });

  test('client state never leaks hints ladder or solutions', async () => {
    const gw = stubGateway({ ...baseGw, approach_judge: async () => ({}) });
    const { token } = await startDsaSession(gw);
    const { state } = await interview.getState({ token });
    assert.ok(state.activeProblem, 'active problem served');
    assert.equal('hints' in state.activeProblem, false, 'no hint ladder leaked');
    assert.equal('reference' in state.activeProblem, false, 'no solutions leaked');
  });
});
