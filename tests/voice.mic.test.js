/**
 * Milestone 9 — mic state machine tests (spec §4.7).
 *
 * The reducer is pure: idle -> recording -> transcribing -> sending -> idle,
 * with cancel/deny/too-short/empty paths. Recording can only begin from an
 * explicit START_RECORDING action (the tap handler) — never spontaneously.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  micReducer,
  initialMicState,
  MIC_IDLE,
  MIC_REQUESTING,
  MIC_RECORDING,
  MIC_TRANSCRIBING,
  MIC_SENDING,
  MIC_DENIED,
  MIC_ERROR,
} from '../apps/web/src/voice/micMachine.js';

function run(...actions) {
  return actions.reduce(micReducer, initialMicState);
}

describe('micReducer', () => {
  test('happy path: idle → requesting → recording → transcribing → sending → idle', () => {
    const s = run(
      { type: 'START_REQUEST' },
      { type: 'START_RECORDING', at: 1000 },
      { type: 'STOP_TRANSCRIBE' },
      { type: 'TRANSCRIBED' },
      { type: 'SENT' },
    );
    assert.equal(s.status, MIC_IDLE);
    assert.equal(s.note, '');
  });

  test('START_RECORDING is ignored unless requesting/idle (never spontaneous)', () => {
    const s = run(
      { type: 'START_REQUEST' },
      { type: 'START_RECORDING', at: 1 },
      { type: 'STOP_TRANSCRIBE' },
      { type: 'START_RECORDING', at: 2 }, // from transcribing: ignored
    );
    assert.equal(s.status, MIC_TRANSCRIBING);
  });

  test('START_REQUEST from a non-idle state is ignored (no double capture)', () => {
    const s = run({ type: 'START_REQUEST' }, { type: 'START_RECORDING', at: 1 }, { type: 'START_REQUEST' });
    assert.equal(s.status, MIC_RECORDING);
  });

  test('CANCEL discards without sending', () => {
    const s = run({ type: 'START_RECORDING', at: 1 }, { type: 'CANCEL' });
    assert.equal(s.status, MIC_IDLE);
    assert.equal(s.note, '');
  });

  test('TOO_SHORT returns to idle with a helpful note', () => {
    const s = run({ type: 'START_RECORDING', at: 1 }, { type: 'TOO_SHORT' });
    assert.equal(s.status, MIC_IDLE);
    assert.match(s.note, /too short/i);
  });

  test('EMPTY_TRANSCRIPT is not sent; shows "didn\'t catch that"', () => {
    const s = run(
      { type: 'START_RECORDING', at: 1 },
      { type: 'STOP_TRANSCRIBE' },
      { type: 'EMPTY_TRANSCRIPT' },
    );
    assert.equal(s.status, MIC_IDLE);
    assert.match(s.note, /didn't catch that/i);
  });

  test('PERMISSION_DENIED explains how to re-allow the mic', () => {
    const s = run({ type: 'START_REQUEST' }, { type: 'PERMISSION_DENIED' });
    assert.equal(s.status, MIC_DENIED);
    assert.match(s.note, /denied/i);
    const dismissed = micReducer(s, { type: 'DISMISS' });
    assert.equal(dismissed.status, MIC_IDLE);
  });

  test('NO_MIC_SUPPORT degrades to typing', () => {
    const s = run({ type: 'START_REQUEST' }, { type: 'NO_MIC_SUPPORT' });
    assert.equal(s.status, MIC_ERROR);
    assert.match(s.note, /type your answer/i);
  });

  test('FAIL carries the failure note', () => {
    const s = run(
      { type: 'START_RECORDING', at: 1 },
      { type: 'STOP_TRANSCRIBE' },
      { type: 'FAIL', note: 'Server transcription is unavailable.' },
    );
    assert.equal(s.status, MIC_ERROR);
    assert.match(s.note, /unavailable/);
  });

  test('unknown actions leave state untouched', () => {
    const s = run({ type: 'START_RECORDING', at: 1 }, { type: 'BOGUS' });
    assert.equal(s.status, MIC_RECORDING);
  });

  test('status constants match the spec contract', () => {
    assert.deepEqual(
      [MIC_IDLE, MIC_REQUESTING, MIC_RECORDING, MIC_TRANSCRIBING, MIC_SENDING, MIC_DENIED, MIC_ERROR],
      ['idle', 'requesting', 'recording', 'transcribing', 'sending', 'denied', 'error'],
    );
  });
});
