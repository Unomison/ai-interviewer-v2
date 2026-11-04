/**
 * Milestone 5 runner — C++ toolchain, harness, and session tests.
 *
 * Split (same philosophy as M4):
 *  - Pure unit tests (always run): harness codegen, the bits/stdc++.h shim,
 *    marker parsing, the WASI shim surface, toolchain constants, worker
 *    source structure, compile-error surfacing and the TLE/no-recompile
 *    path via fake workers.
 *  - Real end-to-end (gated on BROWSERCC_DIST=/path/to/browsercc/dist):
 *    the generated harness compiles with the REAL browsercc wasm-Clang and
 *    runs under the REAL CPP_RUNNER_WORKER_SOURCE (executed via node
 *    worker_threads) with the repo's own wasi-shim — including a genuine
 *    infinite-loop TLE where the next test reuses the already-compiled
 *    module. The compiler WORKER itself (a module worker importing the CDN)
 *    cannot run in node; its source gets structural tests.
 *
 * Run from the repo root:  npm test
 * With the toolchain:      BROWSERCC_DIST=/tmp/bcc/pkg/package/dist npm test
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  STDCPP_SHIM,
  buildCppHarness,
  buildCppSource,
  cppStdinForTest,
  parseCppMarkers,
} from '../apps/web/src/runner/harness.js';
import { createWasiShim } from '../apps/web/src/runner/wasi-shim.js';
import { getProblem, LANGUAGES } from '../apps/web/src/runner/problems.js';
import {
  BROWSERCC_VERSION,
  BROWSERCC_CDN,
  TOOLCHAIN_FILES,
  TOOLCHAIN_BYTES,
  CPP_FLAGS,
  CPP_COMPILER_WORKER_SOURCE,
  CPP_RUNNER_WORKER_SOURCE,
  CppToolchainError,
  CppCompileError,
  CPP_UNAVAILABLE_MESSAGE,
  ensureCppToolchain,
  getCppToolchainStatus,
  prewarmCppToolchain,
  CppSession,
  runCppTests,
  _resetCppToolchainForTests,
} from '../apps/web/src/runner/cpp.js';

const twoSum = getProblem('two-sum');
const nativeFetch = globalThis.fetch;

function stubFetch(impl) {
  globalThis.fetch = impl;
}
function restoreFetch() {
  globalThis.fetch = nativeFetch;
}
function okStreamResponse() {
  // Minimal fetch Response with an instantly-drained body.
  return {
    ok: true,
    body: { getReader: () => ({ read: async () => ({ done: true, value: undefined }) }) },
  };
}

describe('M5 — problem specs carry C++ starters', () => {
  test('cpp is a third language with a starter per problem', () => {
    assert.deepEqual(LANGUAGES, ['javascript', 'python', 'cpp']);
    for (const p of ['two-sum', 'valid-parentheses', 'reverse-string', 'contains-duplicate']) {
      const prob = getProblem(p);
      assert.ok(prob.starter.cpp, `${p} needs a cpp starter`);
      assert.match(prob.starter.cpp, /solve\s*\(/);
    }
  });
});

describe('M5 — bits/stdc++.h shim', () => {
  test('shim maps to real standard headers', () => {
    for (const h of [
      '<iostream>', '<string>', '<vector>', '<algorithm>', '<map>', '<set>',
      '<unordered_map>', '<unordered_set>', '<queue>', '<stack>', '<cmath>',
      '<limits>', '<numeric>', '<utility>',
    ]) {
      assert.ok(STDCPP_SHIM.includes(`#include ${h}`), `shim should pull in ${h}`);
    }
    assert.ok(STDCPP_SHIM.includes('#pragma once'));
  });
});

describe('M5 — C++ harness generation', () => {
  test('harness calls solve, parses one JSON test per stdin line, prints markers', () => {
    const h = buildCppHarness(twoSum);
    assert.match(h, /::solve\(/); // candidate solve at global scope
    assert.match(h, /std::getline\(std::cin, line\)/); // line-based stdin
    assert.match(h, /@@TEST/);
    assert.match(h, /@@RESULT/);
    assert.match(h, /@@TIME/);
    assert.match(h, /@@ERROR/);
    assert.match(h, /steady_clock/); // per-test timing
    const noComments = h.replace(/\/\/.*$/gm, '');
    assert.ok(!/\bthrow\b/.test(noComments), 'harness must not use exceptions (unavailable under WASI)');
  });

  test('harness converts all v1 param types used by the sample problems', () => {
    const h = buildCppHarness(twoSum);
    assert.match(h, /std::vector<int> __h_a0/);
    assert.match(h, /int __h_a1/);
    const vp = buildCppHarness(getProblem('valid-parentheses'));
    assert.match(vp, /std::string __h_a0/);
    assert.match(vp, /bool __h_r/);
  });

  test('buildCppSource prepends the shim include and the candidate code', () => {
    const src = buildCppSource(twoSum, 'int foo() { return 1; }');
    assert.ok(src.startsWith('#include <bits/stdc++.h>'));
    assert.ok(src.includes('int foo() { return 1; }'));
    assert.ok(src.indexOf('int foo()') < src.indexOf('namespace cppharness'));
  });

  test('cppStdinForTest encodes one JSON line per test', () => {
    assert.equal(cppStdinForTest(twoSum.tests[0]), '[[2,7,11,15],9]');
  });

  test('parseCppMarkers extracts result, time, and errors', () => {
    const out = '@@TEST 0\n@@RESULT [0,1]\n@@TIME 3\n';
    assert.deepEqual(parseCppMarkers(out), { result: [0, 1], timeMs: 3, error: undefined });
    const bad = '@@TEST 0\n@@ERROR bad test input\n';
    assert.equal(parseCppMarkers(bad).error, 'bad test input');
    assert.equal(parseCppMarkers('garbage\n').result, undefined);
  });
});

describe('M5 — WASI shim surface', () => {
  test('implements exactly the imports a browsercc module needs', () => {
    const shim = createWasiShim({ stdinBytes: new Uint8Array(0) });
    for (const fn of [
      'environ_get', 'environ_sizes_get', 'fd_close', 'fd_fdstat_get',
      'fd_prestat_get', 'fd_prestat_dir_name', 'fd_read', 'fd_seek',
      'fd_write', 'proc_exit',
    ]) {
      assert.equal(typeof shim.wasiImport[fn], 'function', fn);
    }
    assert.equal(typeof shim.setMemory, 'function');
  });

  test('proc_exit unwinds with a catchable marker carrying the code', () => {
    const shim = createWasiShim({});
    let caught = null;
    try {
      shim.wasiImport.proc_exit(3);
    } catch (e) {
      caught = e;
    }
    assert.ok(caught && caught.__wasiExit === true);
    assert.equal(caught.code, 3);
    assert.equal(shim.getExitCode(), 3);
  });

  test('fd_write routes fd 1 to onStdout and fd 2 to onStderr', () => {
    const mem = new WebAssembly.Memory({ initial: 1 });
    const bytes = new Uint8Array(mem.buffer);
    const seen = { out: [], err: [] };
    const shim = createWasiShim({
      onStdout: (c) => seen.out.push(c),
      onStderr: (c) => seen.err.push(c),
    });
    shim.setMemory(mem);
    const enc = new TextEncoder();
    const hello = enc.encode('hi');
    bytes.set(hello, 64);
    // iovec at 0: { ptr=64, len=2 }; nwritten at 16
    new DataView(mem.buffer).setUint32(0, 64, true);
    new DataView(mem.buffer).setUint32(4, 2, true);
    assert.equal(shim.wasiImport.fd_write(1, 0, 1, 16), 0);
    assert.equal(shim.wasiImport.fd_write(2, 0, 1, 16), 0);
    assert.equal(shim.wasiImport.fd_write(9, 0, 1, 16), 8); // EBADF
    const dec = new TextDecoder();
    assert.equal(dec.decode(seen.out[0]), 'hi');
    assert.equal(dec.decode(seen.err[0]), 'hi');
  });

  test('fd_read serves stdin bytes then EOF', () => {
    const mem = new WebAssembly.Memory({ initial: 1 });
    const view = new DataView(mem.buffer);
    const shim = createWasiShim({ stdinBytes: new TextEncoder().encode('ab') });
    shim.setMemory(mem);
    view.setUint32(0, 64, true);
    view.setUint32(4, 8, true);
    assert.equal(shim.wasiImport.fd_read(0, 0, 1, 16), 0);
    assert.equal(view.getUint32(16, true), 2);
    // second read: EOF → 0 bytes
    assert.equal(shim.wasiImport.fd_read(0, 0, 1, 16), 0);
    assert.equal(view.getUint32(16, true), 0);
    assert.equal(shim.wasiImport.fd_read(5, 0, 1, 16), 8); // EBADF
  });

  test('shim source is self-contained (safe to inline into a Blob worker)', () => {
    const src = createWasiShim.toString();
    assert.ok(!src.includes('import '), 'no imports allowed');
    assert.ok(!src.includes('require('), 'no require allowed');
  });
});

describe('M5 — toolchain constants', () => {
  test('version is pinned and the CDN base matches', () => {
    assert.equal(BROWSERCC_VERSION, '0.1.1');
    assert.equal(BROWSERCC_CDN, 'https://cdn.jsdelivr.net/npm/browsercc@0.1.1/dist/');
  });

  test('one-time download is ~24 MB (tens of MB, downloaded once)', () => {
    const names = TOOLCHAIN_FILES.map((f) => f.name);
    assert.ok(names.includes('clang.wasm') && names.includes('lld.wasm') && names.includes('sysroot.tar'));
    assert.ok(TOOLCHAIN_BYTES > 20 * 1048576 && TOOLCHAIN_BYTES < 40 * 1048576);
  });

  test('compile flags: C++17, no exceptions, 8 MB stack, 64 MB memory cap', () => {
    assert.ok(CPP_FLAGS.includes('-std=c++17'));
    assert.ok(CPP_FLAGS.includes('-fno-exceptions'));
    assert.ok(CPP_FLAGS.includes('-Wl,-z,stack-size=8388608'));
    assert.ok(CPP_FLAGS.includes('-Wl,--max-memory=67108864'));
  });

  test('fallback message is honest and suggests JS/Python', () => {
    assert.match(CPP_UNAVAILABLE_MESSAGE, /not available on this device/i);
    assert.match(CPP_UNAVAILABLE_MESSAGE, /JavaScript and Python/);
  });
});

describe('M5 — worker sources (structural)', () => {
  test('compiler worker imports browsercc from the pinned CDN and injects the shim', () => {
    assert.ok(CPP_COMPILER_WORKER_SOURCE.includes(BROWSERCC_CDN));
    assert.ok(CPP_COMPILER_WORKER_SOURCE.includes(`import(CDN + 'index.js')`));
    assert.ok(CPP_COMPILER_WORKER_SOURCE.includes('extraFiles'));
    assert.ok(CPP_COMPILER_WORKER_SOURCE.includes('bits/stdc++.h'));
    assert.ok(CPP_COMPILER_WORKER_SOURCE.includes('main.cpp'));
    assert.ok(CPP_COMPILER_WORKER_SOURCE.includes('-fno-exceptions'));
  });

  test('runner worker embeds the WASI shim and speaks the marker protocol', () => {
    assert.ok(CPP_RUNNER_WORKER_SOURCE.includes('wasi_snapshot_preview1'));
    assert.ok(CPP_RUNNER_WORKER_SOURCE.includes('createWasiShim'));
    assert.ok(CPP_RUNNER_WORKER_SOURCE.includes('_start'));
    assert.ok(CPP_RUNNER_WORKER_SOURCE.includes('__wasiExit'));
    assert.ok(CPP_RUNNER_WORKER_SOURCE.includes('stdinText'));
  });
});

describe('M5 — toolchain loader', () => {
  test('failed download → CppToolchainError (retryable), then retry succeeds', async () => {
    _resetCppToolchainForTests();
    stubFetch(async () => {
      throw new Error('socket hang up');
    });
    const seen = [];
    await assert.rejects(
      ensureCppToolchain((stage, text, frac) => seen.push([stage, frac])),
      (e) => e instanceof CppToolchainError && e.retryable === true && /Could not download/.test(e.message)
    );
    assert.equal(getCppToolchainStatus().status, 'error');
    assert.ok(seen.length > 0 && seen[0][0] === 'toolchain');

    // Retry with a working fetch: loader recovers.
    stubFetch(async () => okStreamResponse());
    await ensureCppToolchain();
    assert.equal(getCppToolchainStatus().status, 'ready');
    restoreFetch();
  });

  test('prewarm swallows errors (they surface when C++ is picked)', async () => {
    _resetCppToolchainForTests();
    stubFetch(async () => {
      throw new Error('offline');
    });
    prewarmCppToolchain();
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(getCppToolchainStatus().status, 'error');
    restoreFetch();
    _resetCppToolchainForTests();
  });
});

// --- fake workers for session plumbing tests --------------------------------

function fakeCompilerWorker(outcome, onCall) {
  return () => {
    onCall?.();
    return {
      post() {},
      onceResult: async () => outcome,
      terminate: async () => {},
    };
  };
}
function neverRespondingRunner() {
  return {
    post() {},
    onceResult: () => new Promise(() => {}), // hangs → timeout
    terminate: async () => {},
  };
}
function cannedRunnerWorker(stdoutFor) {
  const calls = [];
  // stdoutFor: (stdinText) => stdout — lets the test answer per-test.
  // Note: CppSession calls onceResult() BEFORE post(); the async body is
  // guaranteed to run after the synchronous post(), so lastMsg is set.
  const factory = () => {
    const worker = {
      lastMsg: null,
      post: (msg) => {
        calls.push(msg);
        worker.lastMsg = msg;
      },
      onceResult: async () => {
        await null; // async bodies run sync until the first await; yield so post() lands first
        return {
          ok: true,
          exitCode: 0,
          stdout:
            typeof stdoutFor === 'function' ? stdoutFor(worker.lastMsg.stdinText) : stdoutFor,
          stderr: '',
        };
      },
      terminate: async () => {},
    };
    return worker;
  };
  factory.calls = calls;
  return factory;
}
function readyToolchain() {
  _resetCppToolchainForTests();
  stubFetch(async () => okStreamResponse());
  return ensureCppToolchain().then(() => restoreFetch());
}

describe('M5 — compile-error surfacing (no hang)', () => {
  test('bad C++ → CppCompileError carrying the compiler output', async () => {
    await readyToolchain();
    let calls = 0;
    const session = new CppSession({
      code: 'this is not c++',
      problem: twoSum,
      createCompilerWorker: fakeCompilerWorker(
        { ok: false, error: "main.cpp:8:5: error: use of undeclared identifier 'retrn'" },
        () => calls++
      ),
      createRunnerWorker: neverRespondingRunner,
      onProgress: () => {},
    });
    await assert.rejects(session.ensureCompiled(), (e) => {
      assert.ok(e instanceof CppCompileError);
      assert.ok(e.compilerOutput.includes('undeclared identifier'));
      assert.match(e.message, /try\/catch/); // guidance included
      return true;
    });
    assert.equal(calls, 1);
    await session.dispose();
    _resetCppToolchainForTests();
  });
});

describe('M5 — TLE reuses the compiled module (no recompile)', () => {
  test('timeout → tle; next test reuses the module', async () => {
    await readyToolchain();
    let compilerCalls = 0;
    let runnerWorkers = 0;
    const session = new CppSession({
      code: 'int x;',
      problem: twoSum,
      createCompilerWorker: fakeCompilerWorker({ ok: true, module: { __fakeModule: true } }, () => compilerCalls++),
      createRunnerWorker: () => {
        runnerWorkers++;
        return neverRespondingRunner();
      },
      onProgress: () => {},
    });
    const r1 = await session.runTest({ test: twoSum.tests[0], index: 0, timeLimitMs: 60 });
    assert.equal(r1.status, 'tle');
    assert.match(r1.error, /Time limit exceeded/);
    const r2 = await session.runTest({ test: twoSum.tests[1], index: 1, timeLimitMs: 60 });
    assert.equal(r2.status, 'tle');
    assert.equal(compilerCalls, 1, 'module must be compiled once and reused after TLE');
    assert.equal(runnerWorkers, 2, 'each test gets a fresh runner worker');
    await session.dispose();
    _resetCppToolchainForTests();
  });
});

describe('M5 — runCppTests plumbing', () => {
  test('canned runner stdout flows through markers → compare → verdict', async () => {
    await readyToolchain();
    // Answer each test with its own expected value, encoded as harness markers.
    const factory = cannedRunnerWorker(
      (stdinText) => {
        const test = twoSum.tests.find((t) => JSON.stringify(t.args) + '\n' === stdinText);
        assert.ok(test, `unexpected stdin: ${stdinText}`);
        return `@@TEST 0\n@@RESULT ${JSON.stringify(test.expected)}\n@@TIME 2\n`;
      }
    );
    const out = await runCppTests({
      code: 'int x;',
      problem: twoSum,
      timeLimitMs: 2000,
      createCompilerWorker: fakeCompilerWorker({ ok: true, module: { __fakeModule: true } }),
      createRunnerWorker: factory,
      onProgress: () => {},
    });
    assert.equal(out.results.length, twoSum.tests.length);
    assert.ok(out.results.every((r) => r.status === 'pass'));
    assert.equal(out.allPass, true);
    // the compiled (fake) module was handed to every runner worker
    assert.ok(factory.calls.every((c) => c.module.__fakeModule === true));
    assert.ok(factory.calls[0].stdinText.endsWith('\n'));
    _resetCppToolchainForTests();
  });

  test('non-zero exit code → error result', async () => {
    await readyToolchain();
    const factory = () => ({
      post() {},
      onceResult: async () => ({ ok: true, exitCode: 1, stdout: '', stderr: 'boom' }),
      terminate: async () => {},
    });
    const out = await runCppTests({
      code: 'int x;',
      problem: twoSum,
      timeLimitMs: 2000,
      createCompilerWorker: fakeCompilerWorker({ ok: true, module: {} }),
      createRunnerWorker: factory,
      onProgress: () => {},
    });
    assert.ok(out.results.every((r) => r.status === 'error' && /exited with code 1/.test(r.error)));
    _resetCppToolchainForTests();
  });
});

// --- real end-to-end (needs the toolchain on disk) ----------------------------

const BCC_DIST = process.env.BROWSERCC_DIST;

async function importBrowsercc() {
  const dist = BCC_DIST;
  const { compile } = await import(path.join(dist, 'index.js'));
  return { dist, compile };
}

/** node worker_threads factory over the REAL browser runner-worker source. */
function createNodeCppRunnerWorker() {
  const prelude = `
const { parentPort } = require('node:worker_threads');
const self = { postMessage: (m) => parentPort.postMessage(m) };
Object.defineProperty(self, 'onmessage', {
  configurable: true,
  set(f) { parentPort.on('message', (msg) => f({ data: msg })); },
});
`;
  const w = new Worker(prelude + CPP_RUNNER_WORKER_SOURCE, { eval: true });
  return {
    post: (msg) => w.postMessage(msg),
    onceResult: () =>
      new Promise((resolve, reject) => {
        w.once('message', resolve);
        w.once('error', reject);
      }),
    terminate: async () => {
      await w.terminate();
    },
  };
}

describe('M5 — real end-to-end (browsercc + runner worker)', () => {
  test('two-sum: real compile, real worker, all 6 tests pass', async (t) => {
    if (!BCC_DIST) {
      t.skip('set BROWSERCC_DIST=/path/to/browsercc/dist for the real toolchain e2e');
      return;
    }
    const { dist, compile } = await importBrowsercc();
    // Loader flow against LOCAL files (exercises progress + ready states).
    _resetCppToolchainForTests();
    stubFetch(async (url) => {
      const href = String(url);
      if (href.startsWith(BROWSERCC_CDN)) {
        const buf = readFileSync(path.join(dist, href.slice(BROWSERCC_CDN.length)));
        return new Response(buf, { status: 200 });
      }
      if (href.startsWith('file://')) {
        return new Response(readFileSync(new URL(href)), { status: 200 });
      }
      return nativeFetch(url);
    });

    const candidate = [
      'std::vector<int> solve(std::vector<int> nums, int target) {',
      '    std::unordered_map<int,int> m;',
      '    for (int i = 0; i < (int)nums.size(); i++) {',
      '        int need = target - nums[i];',
      '        auto it = m.find(need);',
      '        if (it != m.end()) return {it->second, i};',
      '        m[nums[i]] = i;',
      '    }',
      '    return {};',
      '}',
    ].join('\n');
    const { module, compileOutput } = await compile({
      source: buildCppSource(twoSum, candidate),
      fileName: 'main.cpp',
      flags: CPP_FLAGS,
      extraFiles: { 'bits/stdc++.h': STDCPP_SHIM },
    });
    assert.ok(module, `real compile failed:\n${compileOutput}`);

    let compilerCalls = 0;
    const out = await runCppTests({
      code: candidate,
      problem: twoSum,
      timeLimitMs: 5000,
      createCompilerWorker: fakeCompilerWorker({ ok: true, module }, () => compilerCalls++),
      createRunnerWorker: createNodeCppRunnerWorker,
      onProgress: () => {},
    });
    assert.equal(compilerCalls, 1);
    assert.equal(out.results.length, 6);
    assert.ok(
      out.results.every((r) => r.status === 'pass'),
      JSON.stringify(out.results)
    );
    assert.equal(out.allPass, true);
    restoreFetch();
    _resetCppToolchainForTests();
  });

  test('infinite loop → TLE, next test reuses the compiled module and passes', async (t) => {
    if (!BCC_DIST) {
      t.skip('set BROWSERCC_DIST=/path/to/browsercc/dist for the real toolchain e2e');
      return;
    }
    const { dist, compile } = await importBrowsercc();
    _resetCppToolchainForTests();
    stubFetch(async (url) => {
      const href = String(url);
      if (href.startsWith(BROWSERCC_CDN)) {
        return new Response(readFileSync(path.join(dist, href.slice(BROWSERCC_CDN.length))), { status: 200 });
      }
      if (href.startsWith('file://')) {
        return new Response(readFileSync(new URL(href)), { status: 200 });
      }
      return nativeFetch(url);
    });
    const looper = 'bool solve(std::string s) { while (true) {} return true; }';
    const problem = getProblem('valid-parentheses');
    const { module, compileOutput } = await compile({
      source: buildCppSource(problem, looper),
      fileName: 'main.cpp',
      flags: CPP_FLAGS,
      extraFiles: { 'bits/stdc++.h': STDCPP_SHIM },
    });
    assert.ok(module, `real compile failed:\n${compileOutput}`);

    let compilerCalls = 0;
    const session = new CppSession({
      code: looper,
      problem,
      createCompilerWorker: fakeCompilerWorker({ ok: true, module }, () => compilerCalls++),
      createRunnerWorker: createNodeCppRunnerWorker,
      onProgress: () => {},
    });
    const r1 = await session.runTest({ test: problem.tests[0], index: 0, timeLimitMs: 800 });
    assert.equal(r1.status, 'tle');
    // The compiled module survives the TLE: run the remaining tests against
    // a good module to prove the worker pool recovered.
    await session.dispose();

    const good = 'bool solve(std::string s) { return s == "()"; }';
    const { module: goodModule } = await compile({
      source: buildCppSource(problem, good),
      fileName: 'main.cpp',
      flags: CPP_FLAGS,
      extraFiles: { 'bits/stdc++.h': STDCPP_SHIM },
    });
    const session2 = new CppSession({
      code: good,
      problem,
      createCompilerWorker: fakeCompilerWorker({ ok: true, module: goodModule }, () => compilerCalls++),
      createRunnerWorker: createNodeCppRunnerWorker,
      onProgress: () => {},
    });
    // test 0 is ["()"] → passes; proves the worker pool recovered after TLE
    const r2 = await session2.runTest({ test: problem.tests[0], index: 0, timeLimitMs: 5000 });
    assert.equal(r2.status, 'pass');
    await session2.dispose();
    restoreFetch();
    _resetCppToolchainForTests();
  });

  test('real compiler rejects bad C++ with diagnostics (no hang)', async (t) => {
    if (!BCC_DIST) {
      t.skip('set BROWSERCC_DIST=/path/to/browsercc/dist for the real toolchain e2e');
      return;
    }
    const { compile } = await importBrowsercc();
    stubFetch(async (url) => {
      const href = String(url);
      if (href.startsWith('file://')) {
        return new Response(readFileSync(new URL(href)), { status: 200 });
      }
      return nativeFetch(url);
    });
    const { module, compileOutput } = await compile({
      source: buildCppSource(twoSum, 'std::vector<int> solve(std::vector<int> nums, int target) { retrn {}; }'),
      fileName: 'main.cpp',
      flags: CPP_FLAGS,
      extraFiles: { 'bits/stdc++.h': STDCPP_SHIM },
    });
    assert.equal(module, null);
    assert.match(compileOutput, /error/i);
    // Emscripten's node quit_() sets process.exitCode on failure — a node-only
    // quirk (browsers have no process.exitCode). Reset so the suite exits 0.
    process.exitCode = 0;
    restoreFetch();
  });
});
