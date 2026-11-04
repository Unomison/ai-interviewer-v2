/**
 * Milestone 6 — Python test worker (file-based, NOT eval).
 *
 * Runs one candidate solution against all of a problem's tests under
 * Pyodide. File-based so the pyodide npm package's internal relative
 * imports (./pyodide.asm.mjs) resolve correctly — eval workers resolve
 * them against the process CWD instead.
 *
 * workerData: { code, tests: [{ args }], harness }
 * parent messages: { ok: true, results: [{ index, ok, value?, error?, runtimeMs }] }
 *                  { ok: false, error }
 */
import { parentPort, workerData } from 'node:worker_threads';

const { code, tests, harness } = workerData;

try {
  const { loadPyodide } = await import('pyodide');
  const py = await loadPyodide();
  const results = [];
  for (let i = 0; i < tests.length; i++) {
    const t = tests[i];
    const t0 = Date.now();
    try {
      py.globals.set('__user_code', code);
      py.globals.set('__args_json', JSON.stringify(t.args));
      const raw = py.runPython(harness);
      results.push({ index: i, ok: true, value: JSON.parse(raw), runtimeMs: Date.now() - t0 });
    } catch (e) {
      const text = String((e && e.message) || e);
      const lines = text.split('\n').filter((l) => l.trim().length > 0);
      results.push({ index: i, ok: false, error: lines.length ? lines[lines.length - 1] : text, runtimeMs: Date.now() - t0 });
    }
  }
  parentPort.postMessage({ ok: true, results });
} catch (e) {
  parentPort.postMessage({ ok: false, error: 'pyodide worker failed: ' + String((e && e.message) || e) });
}
