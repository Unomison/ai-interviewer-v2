/**
 * Milestone 4 runner — executor tests.
 *
 * The JavaScript tests run the REAL execution path: the exact
 * JS_WORKER_SOURCE string the browser turns into a Blob worker is executed
 * here via node worker_threads ({ eval: true }), through the same runTests
 * core (worker-per-test, hard timeout, terminate on overrun).
 *
 * Python/Pyodide cannot run in node, so that path gets structural tests:
 * harness generation, the worker message protocol, timeout/TLE plumbing via
 * fake workers, and the CDN constants.
 *
 * Run from the repo root:  npm test
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';

import { JS_WORKER_SOURCE } from '../apps/web/src/runner/harness.js';
import { getProblem } from '../apps/web/src/runner/problems.js';
import {
  runTests,
  runPythonTests,
  PythonSession,
  DEFAULT_TIME_LIMIT_MS,
  LANGUAGE_TIME_MULTIPLIER,
} from '../apps/web/src/runner/executor.js';
import {
  PYODIDE_VERSION,
  PYODIDE_CDN,
  PYTHON_WORKER_SOURCE,
} from '../apps/web/src/runner/pyodide.js';

const twoSum = getProblem('two-sum');

/** node worker_threads factory over the real browser worker script. */
function createNodeJsWorker() {
  const w = new Worker(JS_WORKER_SOURCE, { eval: true });
  return {
    post: (msg) => w.postMessage(msg),
    onceResult: () =>
      new Promise((resolve) => {
        w.once('message', resolve);
        w.once('error', (e) => resolve({ ok: false, error: `Worker error: ${e.message}` }));
      }),
    terminate: () => w.terminate(),
  };
}

const CORRECT_TWO_SUM = `function solve(nums, target) {
  const seen = new Map();
  for (let i = 0; i < nums.length; i++) {
    const need = target - nums[i];
    if (seen.has(need)) return [seen.get(need), i];
    seen.set(nums[i], i);
  }
  return [];
}`;
const WRONG_TWO_SUM = `function solve(nums, target) { return [0, 0]; }`;
const INFINITE_LOOP = `function solve(nums, target) { while (true) {} }`;
const SYNTAX_ERROR = `function solve(nums, target) {`;
const NO_SOLVE = `const x = 1;`;
const THROWS = `function solve(nums, target) { throw new Error('boom'); }`;

describe('JavaScript execution (real worker_threads path)', () => {
  test('correct solution → all tests pass', async () => {
    const out = await runTests({
      language: 'javascript',
      code: CORRECT_TWO_SUM,
      problem: twoSum,
      createWorker: createNodeJsWorker,
    });
    assert.equal(out.allPass, true);
    assert.equal(out.verdict, 'all-pass');
    assert.equal(out.passed, twoSum.tests.length);
    assert.ok(out.results.every((r) => typeof r.runtimeMs === 'number'));
  });

  test('incorrect solution → fails with first case details', async () => {
    const out = await runTests({
      language: 'javascript',
      code: WRONG_TWO_SUM,
      problem: twoSum,
      createWorker: createNodeJsWorker,
    });
    assert.equal(out.allPass, false);
    assert.equal(out.verdict, 'failed');
    assert.ok(out.failed > 0);
    const firstFail = out.results.find((r) => r.status === 'fail');
    assert.ok(firstFail);
    assert.deepEqual(firstFail.expected, [0, 1]);
    assert.deepEqual(firstFail.actual, [0, 0]);
  });

  test('infinite loop → worker terminated, test marked TLE', async () => {
    const out = await runTests({
      language: 'javascript',
      code: INFINITE_LOOP,
      problem: twoSum,
      timeLimitMs: 300,
      createWorker: createNodeJsWorker,
    });
    assert.ok(out.tles > 0, 'at least one TLE');
    const tle = out.results.find((r) => r.status === 'tle');
    assert.ok(tle);
    assert.ok(tle.error.includes('Time limit exceeded'));
    assert.ok(tle.error.includes('terminated'));
  });

  test('syntax error → error status, not a hang', async () => {
    const out = await runTests({
      language: 'javascript',
      code: SYNTAX_ERROR,
      problem: twoSum,
      createWorker: createNodeJsWorker,
    });
    assert.equal(out.allPass, false);
    assert.ok(out.results.every((r) => r.status === 'error'));
    assert.ok(out.results[0].error.includes('Syntax error'));
  });

  test('missing solve() → clear error message', async () => {
    const out = await runTests({
      language: 'javascript',
      code: NO_SOLVE,
      problem: twoSum,
      createWorker: createNodeJsWorker,
    });
    assert.ok(out.results.every((r) => r.status === 'error'));
    assert.ok(out.results[0].error.includes('"solve" is not defined'));
  });

  test('runtime throw → error status with the message', async () => {
    const out = await runTests({
      language: 'javascript',
      code: THROWS,
      problem: twoSum,
      createWorker: createNodeJsWorker,
    });
    assert.ok(out.results.every((r) => r.status === 'error'));
    assert.ok(out.results[0].error.includes('boom'));
  });

  test('async solve() is awaited', async () => {
    const out = await runTests({
      language: 'javascript',
      code: `async function solve(nums, target) { return [0, 1]; }`,
      problem: { ...twoSum, tests: twoSum.tests.slice(0, 1) },
      createWorker: createNodeJsWorker,
    });
    assert.equal(out.allPass, true);
  });
});

describe('timeout configuration', () => {
  test('defaults and per-language multipliers', () => {
    assert.equal(DEFAULT_TIME_LIMIT_MS, 2000);
    assert.equal(LANGUAGE_TIME_MULTIPLIER.javascript, 1);
    assert.ok(LANGUAGE_TIME_MULTIPLIER.python >= 2, 'Python gets a slower-runtime multiplier');
  });
});

describe('Python path (structural, Pyodide stubbed)', () => {
  /** Fake Python worker factory with scripted behaviour. */
  function fakePythonWorkerFactory(behavior, onCreate) {
    return (onProgress) => {
      onCreate?.();
      const waiters = [];
      return {
        post: (msg) => {
          if (msg.type === 'run') {
            if (behavior === 'ok') {
              setImmediate(() => {
                const w = waiters.shift();
                if (w) w({ ok: true, value: [0, 1] });
              });
            } else if (behavior === 'error') {
              setImmediate(() => {
                const w = waiters.shift();
                if (w) w({ ok: false, error: 'NameError: name \'solve\' is not defined' });
              });
            }
            // 'never' → silence → the executor timeout must fire
          }
        },
        whenReady: async () => {},
        onceResult: () => new Promise((resolve) => waiters.push(resolve)),
        messageForTest: ({ code, test }) => ({ type: 'run', id: 't0', code, args: test.args }),
        terminate: async () => {},
      };
    };
  }

  test('messageForTest carries code and args in the run protocol', async () => {
    const factory = fakePythonWorkerFactory('ok');
    const worker = factory(() => {});
    const msg = worker.messageForTest({ code: 'def solve(): pass', test: twoSum.tests[0] });
    assert.equal(msg.type, 'run');
    assert.equal(msg.code, 'def solve(): pass');
    assert.deepEqual(msg.args, twoSum.tests[0].args);
  });

  test('silent worker → timeout → TLE, then worker re-created for next test', async () => {
    let creations = 0;
    const out = await runPythonTests({
      code: 'def solve(nums, target):\n    while True:\n        pass',
      problem: { ...twoSum, tests: twoSum.tests.slice(0, 2) },
      timeLimitMs: 200,
      createWorker: fakePythonWorkerFactory('never', () => creations++),
      onProgress: () => {},
    });
    assert.equal(out.tles, 2);
    assert.equal(creations, 2, 'worker re-initialised after each TLE termination');
    assert.ok(out.results[0].error.includes('terminated'));
  });

  test('worker error → error status with message', async () => {
    const out = await runPythonTests({
      code: 'x = 1',
      problem: { ...twoSum, tests: twoSum.tests.slice(0, 1) },
      timeLimitMs: 2000,
      createWorker: fakePythonWorkerFactory('error'),
      onProgress: () => {},
    });
    assert.equal(out.results[0].status, 'error');
    assert.ok(out.results[0].error.includes('NameError'));
  });

  test('PythonSession.dispose is safe when nothing is running', async () => {
    const s = new PythonSession({ createWorker: fakePythonWorkerFactory('ok') });
    await s.dispose();
  });

  test('CDN constants are pinned and consistent', () => {
    assert.match(PYODIDE_VERSION, /^\d+\.\d+\.\d+$/);
    assert.ok(PYODIDE_CDN.includes(PYODIDE_VERSION));
    assert.ok(PYODIDE_CDN.startsWith('https://cdn.jsdelivr.net/pyodide/'));
    assert.ok(PYODIDE_CDN.endsWith('/full/'));
  });

  test('worker source loads Pyodide via importScripts and reports progress', () => {
    assert.ok(PYTHON_WORKER_SOURCE.includes('importScripts('));
    assert.ok(PYTHON_WORKER_SOURCE.includes('loadPyodide'));
    assert.ok(PYTHON_WORKER_SOURCE.includes("type: 'progress'"));
    assert.ok(PYTHON_WORKER_SOURCE.includes("type: 'ready'"));
    assert.ok(PYTHON_WORKER_SOURCE.includes("type: 'init-error'"));
    assert.ok(PYTHON_WORKER_SOURCE.includes(PYODIDE_CDN));
  });
});
