#!/usr/bin/env node
/**
 * Milestone 6 — offline problem pipeline CLI (spec §4.4 / §4.9).
 *
 *   node tools/problem-pipeline/run.js [options]
 *
 * Stages per problem: canonicalise → verify → differential → calibrate → emit.
 *
 * Options:
 *   --only slug1,slug2     run only these problems (default: whole bank)
 *   --skip-verify          skip the verify stage (stage testing only)
 *   --no-emit              do not write emit artifacts
 *   --out <dir>            emit directory base (default: repo root layout)
 *   --browsercc-dist <dir> browsercc dist dir (default: $BROWSERCC_DIST or
 *                          a fresh download cached under .cache/)
 *   --list                 list bank slugs and exit
 *
 * Exit code: 0 when every selected problem validates; 1 otherwise.
 * Writes data/validation-report.json on every run (pass or fail).
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSERCC_VERSION } from '../../apps/web/src/runner/cpp.js';
import { canonicalise, verify, differential, calibrate, buildEmitArtifacts, PipelineError } from './stages.js';
import { BANK_VERSION, PLAYGROUND_SLUGS, loadBankSources } from './bank/index.js';

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const CACHE_DIR = path.join(HERE, '.cache');

function parseArgs(argv) {
  const opts = { only: null, skipVerify: false, emit: true, out: REPO_ROOT, browserccDist: process.env.BROWSERCC_DIST || null, list: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--only') opts.only = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--skip-verify') opts.skipVerify = true;
    else if (a === '--no-emit') opts.emit = false;
    else if (a === '--out') opts.out = path.resolve(argv[++i]);
    else if (a === '--browsercc-dist') opts.browserccDist = argv[++i];
    else if (a === '--list') opts.list = true;
    else throw new Error(`unknown arg: ${a}`);
  }
  return opts;
}

/**
 * The pipeline must not depend on /tmp (ephemeral). Resolve the browsercc
 * dist: explicit flag/env first, then a repo-local cache, else download the
 * pinned tarball fresh from the npm registry.
 */
async function ensureBrowserccDist(explicit) {
  const need = ['clang.wasm', 'lld.wasm', 'sysroot.tar', 'index.js'];
  const ok = (dir) => dir && need.every((f) => existsSync(path.join(dir, f)));
  if (ok(explicit)) return explicit;
  const cached = path.join(CACHE_DIR, 'browsercc', 'package', 'dist');
  if (ok(cached)) {
    console.log(`[pipeline] using cached browsercc dist at ${cached}`);
    return cached;
  }
  console.log(`[pipeline] downloading browsercc@${BROWSERCC_VERSION} dist (fresh, cached under tools/problem-pipeline/.cache)…`);
  const dlDir = path.join(CACHE_DIR, 'browsercc-dl');
  mkdirSync(dlDir, { recursive: true });
  await execFileAsync('npm', ['pack', `browsercc@${BROWSERCC_VERSION}`, '--silent'], { cwd: dlDir });
  await execFileAsync('tar', ['-xzf', `browsercc-${BROWSERCC_VERSION}.tgz`], { cwd: dlDir });
  const dist = path.join(dlDir, 'package', 'dist');
  if (!ok(dist)) throw new Error('browsercc download did not produce a usable dist dir');
  const finalDir = path.join(CACHE_DIR, 'browsercc');
  mkdirSync(finalDir, { recursive: true });
  await execFileAsync('cp', ['-r', path.join(dlDir, 'package'), finalDir]);
  return path.join(finalDir, 'package', 'dist');
}

function progress(stage, text) {
  console.log(`[pipeline] ${text}`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const sources = loadBankSources();
  if (opts.list) {
    for (const s of sources) console.log(s.slug);
    return;
  }
  const selected = opts.only ? sources.filter((s) => opts.only.includes(s.slug)) : sources;
  const missing = (opts.only || []).filter((slug) => !sources.some((s) => s.slug === slug));
  if (missing.length) throw new Error(`unknown slugs: ${missing.join(', ')}`);

  console.log(`[pipeline] bank v${BANK_VERSION}: ${selected.length}/${sources.length} problems selected`);
  const distDir = await ensureBrowserccDist(opts.browserccDist);
  process.env.BROWSERCC_DIST = distDir;

  const validated = [];
  const validations = {};
  let failed = 0;

  for (const candidate of selected) {
    const slug = candidate.slug || '<unknown>';
    const t0 = Date.now();
    try {
      const problem = canonicalise(candidate);
      let verifyOut = null;
      let diffOut = null;
      let calOut = null;
      if (!opts.skipVerify) {
        verifyOut = await verify(problem, { onProgress: progress });
        diffOut = await differential(problem, verifyOut, { onProgress: progress });
        calOut = calibrate(problem, verifyOut);
        problem.timeLimitMs = calOut.timeLimitMs;
        problem.memoryMb = calOut.memoryMb;
      }
      validated.push(problem);
      validations[slug] = {
        ok: true,
        ms: Date.now() - t0,
        verify: verifyOut
          ? Object.fromEntries(
              Object.entries(verifyOut).map(([lang, v]) => [
                lang,
                { maxRuntimeMs: v.maxRuntimeMs, compileMs: v.compileMs, tests: v.run.results.length },
              ]),
            )
          : null,
        differential: diffOut,
        calibration: calOut,
      };
      console.log(`[pipeline] ✓ ${slug} (${Date.now() - t0}ms)`);
    } catch (err) {
      failed++;
      const message = err instanceof PipelineError ? err.message : String((err && err.message) || err);
      validations[slug] = { ok: false, ms: Date.now() - t0, error: message };
      console.error(`[pipeline] ✗ ${slug}: ${message}`);
    }
  }

  const report = {
    version: BANK_VERSION,
    generatedAt: new Date().toISOString(),
    selected: selected.length,
    passed: validated.length,
    failed,
    validations,
  };
  mkdirSync(path.join(opts.out, 'data'), { recursive: true });
  writeFileSync(path.join(opts.out, 'data', 'validation-report.json'), JSON.stringify(report, null, 2));
  console.log(`[pipeline] validation report → data/validation-report.json`);

  if (opts.emit && validated.length > 0) {
    const { bank, clientAll, clientPlayground } = buildEmitArtifacts({
      version: BANK_VERSION,
      problems: validated,
      validations,
      playgroundSlugs: PLAYGROUND_SLUGS,
    });
    writeFileSync(path.join(opts.out, 'data', 'problems.json'), JSON.stringify(bank, null, 2));
    const apiDataDir = path.join(opts.out, 'apps', 'api', 'data');
    mkdirSync(apiDataDir, { recursive: true });
    writeFileSync(path.join(apiDataDir, 'problems.client.json'), JSON.stringify({ version: BANK_VERSION, count: clientAll.length, problems: clientAll }, null, 2));
    const genPath = path.join(opts.out, 'apps', 'web', 'src', 'runner', 'problems.generated.js');
    const genSrc =
      `/**\n * GENERATED by tools/problem-pipeline/run.js — do not edit by hand.\n` +
      ` * Client-safe projection of the canonical problem bank v${BANK_VERSION}\n` +
      ` * (playground sample problems only; reference solutions never ship here).\n` +
      ` * Regenerate: node tools/problem-pipeline/run.js\n */\n` +
      `export const BANK_VERSION = ${JSON.stringify(BANK_VERSION)};\n` +
      `export const PROBLEMS = ${JSON.stringify(clientPlayground, null, 2)};\n`;
    writeFileSync(genPath, genSrc);
    console.log(`[pipeline] emitted data/problems.json (${bank.count} problems), apps/api/data/problems.client.json, apps/web/src/runner/problems.generated.js`);
  }

  console.log(`[pipeline] done: ${validated.length} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(`[pipeline] fatal: ${(err && err.message) || err}`);
  process.exit(1);
});
