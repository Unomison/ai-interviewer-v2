/**
 * Milestone 9 — streaming turn tests (spec §4.7).
 *
 * Covers the partial-JSON message extractor, the streaming interviewer
 * generator, and takeTurnStream end-to-end against the in-memory session
 * store with a stubbed gateway. No keys, no network, no mic.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  extractMessageDelta,
  generateTurnChunks,
} from '../apps/api/src/interview/interviewer.js';
import * as store from '../apps/api/src/interview/store.js';
import { takeTurnStream } from '../apps/api/src/interview/index.js';

beforeEach(() => {
  store._clearMemStore();
});

describe('extractMessageDelta', () => {
  test('returns nothing until the "message" key opens', () => {
    assert.equal(extractMessageDelta('{"mess', 0), '');
    assert.equal(extractMessageDelta('{"message": "', 0), '');
  });

  test('progressive deltas concatenate to the full message', () => {
    const raw = '{"message": "Hello there!", "endRound": false}';
    let sent = 0;
    let out = '';
    for (let i = 1; i <= raw.length; i += 4) {
      const d = extractMessageDelta(raw.slice(0, i), sent);
      sent += d.length;
      out += d;
    }
    assert.equal(out, 'Hello there!');
  });

  test('handles escaped quotes and backslashes', () => {
    const raw = '{"message": "say \\"hi\\" \\\\ ok"}';
    let sent = 0;
    let out = '';
    for (let i = 1; i <= raw.length; i += 3) {
      const d = extractMessageDelta(raw.slice(0, i), sent);
      sent += d.length;
      out += d;
    }
    assert.equal(out, 'say "hi" \\ ok');
  });

  test('handles \\n and unicode escapes', () => {
    const raw = '{"message": "line1\\nline2 \\u0041"}';
    const d = extractMessageDelta(raw, 0);
    assert.equal(d, 'line1\nline2 A');
  });

  test('a cut-off escape at the end waits for more input', () => {
    const partial = '{"message": "abc\\';
    assert.equal(extractMessageDelta(partial, 0), 'abc');
    assert.equal(extractMessageDelta(partial + 'n', 0), 'abc\n');
  });

  test('keys in any order still work', () => {
    const raw = '{"endRound": false, "message": "late key"}';
    assert.equal(extractMessageDelta(raw, 0), 'late key');
  });
});

const TURN_JSON = {
  message: 'Hello! How are you today?',
  endRound: false,
  advanceProblem: false,
  roundAssessment: null,
};

function stubStreamGateway(turnJson, pieces = 4) {
  return {
    generate: async ({ stream }) => {
      assert.equal(stream, true, 'streaming path must request stream:true');
      const s = JSON.stringify(turnJson);
      const size = Math.max(1, Math.ceil(s.length / pieces));
      return {
        provider: 'stub',
        model: 'stub',
        textStream: (async function* () {
          for (let i = 0; i < s.length; i += size) yield s.slice(i, i + size);
        })(),
      };
    },
  };
}

const PLAN = [
  { type: 'intro', goals: ['warm up'] },
  { type: 'resume', goals: ['resume deep-dive'] },
  { type: 'closing', goals: ['wrap up'] },
];

async function makeSession() {
  const s = await store.createSession({
    intakeToken: null,
    plan: PLAN,
    company: 'TestCo',
    role: 'Engineer',
    seniority: 'junior',
  });
  return s.token;
}

describe('generateTurnChunks', () => {
  test('yields message deltas then a validated final turn', async () => {
    const gw = stubStreamGateway(TURN_JSON);
    const session = { plan: PLAN, currentRound: 'intro', transcript: [] };
    const events = [];
    for await (const ev of generateTurnChunks({ session, candidateText: 'hi' }, gw)) {
      events.push(ev);
    }
    const chunks = events.filter((e) => e.type === 'chunk');
    const finals = events.filter((e) => e.type === 'final');
    assert.ok(chunks.length > 0, 'expected chunk events');
    assert.equal(finals.length, 1);
    assert.equal(chunks.map((c) => c.text).join(''), TURN_JSON.message);
    assert.equal(finals[0].turn.message, TURN_JSON.message);
    assert.equal(finals[0].turn.endRound, false);
  });

  test('exactly one gateway call worth of chunks (no double generation)', async () => {
    let calls = 0;
    const gw = {
      generate: async () => {
        calls += 1;
        return { provider: 's', model: 's', textStream: (async function* () { yield JSON.stringify(TURN_JSON); })() };
      },
    };
    const session = { plan: PLAN, currentRound: 'intro', transcript: [] };
    for await (const _ of generateTurnChunks({ session, candidateText: 'hi' }, gw)) { /* drain */ }
    assert.equal(calls, 1);
  });
});

describe('takeTurnStream', () => {
  test('streams chunks, persists the transcript, returns the done payload', async () => {
    const token = await makeSession();
    const gw = stubStreamGateway(TURN_JSON);
    const events = [];
    for await (const ev of takeTurnStream({ sessionToken: token, text: 'my answer' }, { gateway: gw })) {
      events.push(ev);
    }
    const chunks = events.filter((e) => e.type === 'chunk');
    const done = events.find((e) => e.type === 'done');
    assert.ok(chunks.length > 0);
    assert.ok(done, 'expected a done event');
    assert.equal(chunks.map((c) => c.text).join(''), TURN_JSON.message);
    assert.equal(done.message, TURN_JSON.message);
    assert.equal(done.currentRound, 'intro');
    assert.equal(done.done, false);
    assert.ok(done.state);

    // The session transcript matches the non-streaming contract exactly:
    // candidate turn then interviewer turn, both in the intro round.
    const session = await store.getSession(token);
    assert.equal(session.transcript.length, 2);
    assert.equal(session.transcript[0].role, 'candidate');
    assert.equal(session.transcript[0].text, 'my answer');
    assert.equal(session.transcript[1].role, 'interviewer');
    assert.equal(session.transcript[1].text, TURN_JSON.message);
  });

  test('round transition works through the stream (endRound=true)', async () => {
    const token = await makeSession();
    const turnJson = {
      ...TURN_JSON,
      message: 'Great, moving on.',
      endRound: true,
      roundAssessment: { score: 80, strengths: ['clear'], improvements: [], evidence: [] },
    };
    // The opening message for the new round goes through generateTurn
    // (non-streaming); the stub answers both shapes.
    const gw = {
      generate: async ({ stream }) => {
        const payload = JSON.stringify(turnJson);
        if (stream) {
          return {
            provider: 's', model: 's',
            textStream: (async function* () { yield payload.slice(0, 10); yield payload.slice(10); })(),
          };
        }
        return { provider: 's', model: 's', data: { ...TURN_JSON, message: 'Welcome to the resume round.' } };
      },
    };
    const events = [];
    for await (const ev of takeTurnStream({ sessionToken: token, text: 'done with intro' }, { gateway: gw })) {
      events.push(ev);
    }
    const done = events.find((e) => e.type === 'done');
    assert.ok(done);
    assert.equal(done.transitionedTo, 'resume');
    assert.equal(done.openingMessage, 'Welcome to the resume round.');
    const session = await store.getSession(token);
    assert.equal(session.currentRound, 'resume');
    assert.ok(session.rounds.intro.assessment, 'round assessment persisted');
  });

  test('invalid input yields an error event, never throws', async () => {
    const events = [];
    for await (const ev of takeTurnStream({ sessionToken: '', text: '' }, { gateway: stubStreamGateway(TURN_JSON) })) {
      events.push(ev);
    }
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'error');
    assert.equal(events[0].error, 'invalid_request');
  });

  test('unknown session yields session_not_found', async () => {
    const events = [];
    for await (const ev of takeTurnStream(
      { sessionToken: 'nope', text: 'hi' },
      { gateway: stubStreamGateway(TURN_JSON) },
    )) {
      events.push(ev);
    }
    assert.equal(events[0].type, 'error');
    assert.equal(events[0].error, 'session_not_found');
  });

  test('gateway failure yields interviewer_unavailable', async () => {
    const token = await makeSession();
    const gw = {
      generate: async () => {
        throw new Error('provider exploded');
      },
    };
    const events = [];
    for await (const ev of takeTurnStream({ sessionToken: token, text: 'hi' }, { gateway: gw })) {
      events.push(ev);
    }
    assert.equal(events[0].type, 'error');
    assert.equal(events[0].error, 'interviewer_unavailable');
  });
});
