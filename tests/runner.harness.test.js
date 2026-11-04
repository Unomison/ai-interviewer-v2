/**
 * Milestone 4 runner — harness unit tests (pure functions, no browser).
 *
 * Covers: canonical output comparison (exact / float tolerance / unordered,
 * nested arrays), verdict aggregation, the first-failing-case rule (hidden
 * inputs stay hidden), and the locked-editor state mapping.
 *
 * Run from the repo root:  npm test
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  canonicalize,
  compareResults,
  aggregateVerdict,
  firstVisibleFailure,
  getEditorLockState,
  buildPythonHarness,
} from '../apps/web/src/runner/harness.js';
import { getProblem } from '../apps/web/src/runner/problems.js';

const twoSum = getProblem('two-sum');

describe('canonicalize', () => {
  test('normalises -0 to 0 and sorts object keys', () => {
    assert.deepEqual(canonicalize(-0), 0);
    assert.deepEqual(canonicalize({ b: 1, a: 2 }), { a: 2, b: 1 });
    assert.deepEqual(canonicalize([[3, -0], 'x']), [[3, 0], 'x']);
  });
});

describe('compareResults', () => {
  test('exact: nested arrays and primitives', () => {
    const p = { comparison: 'exact' };
    assert.equal(compareResults([1, [2, 3]], [1, [2, 3]], p).pass, true);
    assert.equal(compareResults([1, [2, 3]], [1, [3, 2]], p).pass, false);
    assert.equal(compareResults('olleh', 'olleh', p).pass, true);
    assert.equal(compareResults(true, false, p).pass, false);
  });

  test('float: tolerance-based comparison', () => {
    const p = { comparison: 'float', floatTolerance: 1e-6 };
    assert.equal(compareResults(0.1 + 0.2, 0.3, p).pass, true);
    assert.equal(compareResults(1.0, 1.5, p).pass, false);
    assert.equal(compareResults([1.0000001], [1.0], p).pass, true);
  });

  test('unordered: array order does not matter', () => {
    const p = { comparison: 'unordered' };
    assert.equal(compareResults([1, 0], [0, 1], p).pass, true);
    assert.equal(compareResults([0, 1], [0, 2], p).pass, false);
    assert.equal(compareResults('nope', [0, 1], p).pass, false);
  });

  test('two-sum uses unordered comparison', () => {
    assert.equal(compareResults([1, 0], [0, 1], twoSum).pass, true);
    assert.equal(compareResults([0, 0], [0, 1], twoSum).pass, false);
  });
});

describe('aggregateVerdict', () => {
  test('all-pass verdict', () => {
    const v = aggregateVerdict([
      { index: 0, status: 'pass' },
      { index: 1, status: 'pass' },
    ]);
    assert.equal(v.allPass, true);
    assert.equal(v.verdict, 'all-pass');
    assert.equal(v.total, 2);
  });

  test('mixed statuses aggregate correctly', () => {
    const v = aggregateVerdict([
      { index: 0, status: 'pass' },
      { index: 1, status: 'fail' },
      { index: 2, status: 'tle' },
      { index: 3, status: 'error' },
    ]);
    assert.equal(v.allPass, false);
    assert.equal(v.passed, 1);
    assert.equal(v.failed, 1);
    assert.equal(v.tles, 1);
    assert.equal(v.errors, 1);
  });

  test('empty results are not all-pass', () => {
    assert.equal(aggregateVerdict([]).allPass, false);
  });
});

describe('firstVisibleFailure', () => {
  const mkResults = (statuses) => statuses.map((status, index) => ({ index, status, runtimeMs: 5 }));

  test('no failure → null', () => {
    assert.equal(firstVisibleFailure(mkResults(['pass', 'pass']), twoSum), null);
  });

  test('first failing visible test reveals details', () => {
    const f = firstVisibleFailure(mkResults(['pass', 'fail', 'fail']), twoSum);
    assert.equal(f.hidden, false);
    assert.equal(f.index, 1);
    assert.deepEqual(f.test.args, twoSum.tests[1].args);
    assert.equal(f.result.index, 1);
  });

  test('first failing test hidden → inputs never displayed', () => {
    // two-sum tests 3..5 are hidden; fail test 0 (visible) then 3 (hidden)
    const f = firstVisibleFailure(mkResults(['fail', 'pass', 'pass', 'fail']), twoSum);
    assert.equal(f.hidden, false); // visible failure comes first
    assert.equal(f.index, 0);
  });

  test('only hidden tests fail → hidden marker, no args leaked', () => {
    const f = firstVisibleFailure(
      mkResults(['pass', 'pass', 'pass', 'fail', 'fail']),
      twoSum,
    );
    assert.equal(f.hidden, true);
    assert.equal(f.index, 3);
    // The failure descriptor must not carry the hidden test's args.
    assert.equal(f.test, undefined);
    assert.equal(JSON.stringify(f).includes('[-1,-2,-3,-4,-5]'), false);
  });
});

describe('getEditorLockState', () => {
  test('locked → readOnly with the spec overlay text', () => {
    const s = getEditorLockState({ locked: true });
    assert.equal(s.readOnly, true);
    assert.equal(s.overlay, true);
    assert.equal(s.overlayText, 'Explain your approach to unlock');
  });

  test('unlocked → editable, no overlay', () => {
    const s = getEditorLockState({ locked: false });
    assert.equal(s.readOnly, false);
    assert.equal(s.overlay, false);
    assert.equal(s.overlayText, null);
  });
});

describe('buildPythonHarness', () => {
  test('harness calls solve and returns JSON', () => {
    const src = buildPythonHarness();
    assert.ok(src.includes('solve(*__call_args)'));
    assert.ok(src.includes('__json.dumps'));
    assert.ok(src.includes('__user_code'));
    assert.ok(src.includes('__args_json'));
  });
});

describe('problem specs', () => {
  test('every problem has visible + hidden tests and starters', () => {
    for (const p of [getProblem('two-sum'), getProblem('valid-parentheses'), getProblem('reverse-string'), getProblem('contains-duplicate')]) {
      assert.ok(p, 'problem exists');
      assert.ok(p.tests.some((t) => !t.hidden), `${p.id} needs visible tests`);
      assert.ok(p.tests.some((t) => t.hidden), `${p.id} needs hidden tests`);
      assert.ok(p.starter.javascript.includes('function solve'), `${p.id} js starter`);
      assert.ok(p.starter.python.includes('def solve'), `${p.id} python starter`);
      assert.ok(p.functionName === 'solve');
    }
  });
});
