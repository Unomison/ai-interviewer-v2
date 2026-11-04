/**
 * Milestone 9 — speech helper tests (spec §4.7).
 *
 * Pure functions: no DOM, no audio APIs, no keys. The same module runs in
 * the browser and under node --test.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { splitSentences, stripUnspeakable, SpeechQueue } from '../apps/web/src/voice/speech.js';

describe('splitSentences', () => {
  test('basic splitting', () => {
    assert.deepEqual(splitSentences('Hello world. How are you? Fine!'), [
      'Hello world.',
      'How are you?',
      'Fine!',
    ]);
  });

  test('abbreviations do not split', () => {
    assert.deepEqual(splitSentences('Dr. Smith met Mr. Jones, e.g. at 3 p.m. yesterday.'), [
      'Dr. Smith met Mr. Jones, e.g. at 3 p.m. yesterday.',
    ]);
  });

  test('decimals and thousands do not split', () => {
    assert.deepEqual(splitSentences('It costs $3.14 or 1,000.50 total. Really.'), [
      'It costs $3.14 or 1,000.50 total.',
      'Really.',
    ]);
  });

  test('initials do not split', () => {
    assert.deepEqual(splitSentences('J. Smith wrote it. OK.'), ['J. Smith wrote it.', 'OK.']);
  });

  test('ellipsis does not split', () => {
    assert.deepEqual(splitSentences('Well... let me think. Done.'), ['Well... let me think.', 'Done.']);
  });

  test('code-adjacent text: O(n log n) has no periods to trip on', () => {
    assert.deepEqual(splitSentences('Use a hash map for O(n) time. Space is O(n).'), [
      'Use a hash map for O(n) time.',
      'Space is O(n).',
    ]);
  });

  test('empty / whitespace input', () => {
    assert.deepEqual(splitSentences(''), []);
    assert.deepEqual(splitSentences('   '), []);
  });

  test('trailing fragment without punctuation is kept', () => {
    assert.deepEqual(splitSentences('First sentence. trailing fragment'), [
      'First sentence.',
      'trailing fragment',
    ]);
  });
});

describe('stripUnspeakable', () => {
  test('fenced code blocks are removed', () => {
    const out = stripUnspeakable('Here is the idea:\n```js\nconst x = 1;\n```\nThat is all.');
    assert.ok(!out.includes('const x'));
    assert.ok(out.includes('Here is the idea'));
    assert.ok(out.includes('That is all.'));
  });

  test('inline code and URLs are removed', () => {
    const out = stripUnspeakable('Use the `map` function, see https://example.com/docs for details.');
    assert.ok(!out.includes('`map`'));
    assert.ok(!out.includes('https://example.com/docs'));
    assert.ok(out.includes('Use the'));
  });

  test('plain prose survives intact', () => {
    const prose = 'Tell me about a time you debugged a race condition.';
    assert.equal(stripUnspeakable(prose), prose);
  });
});

describe('SpeechQueue', () => {
  // No synth adapter: the queue drains synchronously through onUtterance,
  // which is exactly what we want for logic tests.
  function makeQueue() {
    const seen = [];
    const q = new SpeechQueue({
      createUtterance: (text) => ({ text }),
      pickVoice: () => null,
    });
    q.onUtterance = (_u, sentence) => seen.push(sentence);
    return { q, seen };
  }

  test('sentences are spoken in order', () => {
    const { q, seen } = makeQueue();
    const n = q.enqueueText('First. Second! Third?');
    assert.equal(n, 3);
    assert.deepEqual(seen, ['First.', 'Second!', 'Third?']);
    assert.deepEqual(q.spoken, ['First.', 'Second!', 'Third?']);
    assert.equal(q.speaking, false);
  });

  test('code is stripped before queueing', () => {
    const { q, seen } = makeQueue();
    q.enqueueText('The fix is simple:\n```python\nx = 1\n```\nAny questions?');
    assert.ok(seen.every((s) => !s.includes('x = 1')));
    assert.ok(seen.join(' ').includes('Any questions?'));
  });

  test('stop() clears the pending queue', () => {
    const { q, seen } = makeQueue();
    // Freeze the pump by holding `current` so sentences accumulate.
    q.current = { text: 'busy' };
    q.enqueueText('One. Two. Three.');
    assert.equal(q.pending, 4); // 1 current + 3 queued
    q.stop();
    assert.equal(q.pending, 0);
    assert.deepEqual(seen, []); // nothing was handed out while frozen
  });

  test('muted queue accepts nothing and stops speech', () => {
    const { q, seen } = makeQueue();
    q.setMuted(true);
    assert.equal(q.enqueueText('Hello. World.'), 0);
    assert.equal(q.enqueueSentence('Hi.'), false);
    assert.deepEqual(seen, []);
    q.setMuted(false);
    assert.equal(q.enqueueText('Hello. World.'), 2);
    assert.deepEqual(seen, ['Hello.', 'World.']);
  });

  test('voice picker failure never breaks speaking', () => {
    const seen = [];
    const q = new SpeechQueue({
      createUtterance: (text) => ({ text }),
      pickVoice: () => {
        throw new Error('no voices today');
      },
    });
    q.onUtterance = (_u, s) => seen.push(s);
    assert.equal(q.enqueueText('Still works.'), 1);
    assert.deepEqual(seen, ['Still works.']);
  });

  test('utterance factory failure falls back to a plain object', () => {
    const seen = [];
    const q = new SpeechQueue({
      createUtterance: () => {
        throw new Error('no SpeechSynthesisUtterance');
      },
    });
    q.onUtterance = (u) => seen.push(u.text);
    assert.equal(q.enqueueText('Fallback.'), 1);
    assert.deepEqual(seen, ['Fallback.']);
  });
});
