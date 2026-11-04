/**
 * Milestone 6 — problem pipeline unit tests (pure logic, no runtimes).
 *
 * Covers: canonical schema accept/reject, differential verdict (weak tests
 * caught), calibration math, seed idempotency (fake collection), playground /
 * canonical sync, and the generate.js loud failure without keys.
 *
 * The full 52-problem validation run (real JS/Python/C++ execution) is the
 * integration proof; its report is data/validation-report.json.
 *
 * Run from the repo root:  npm test
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { problemSchema, toClientProblem } from '../packages/schemas/index.js';
import {
  canonicalise,
  differentialVerdict,
  calibrateLimit,
  CALIBRATION,
  PipelineError,
} from '../tools/problem-pipeline/stages.js';
import { seedProblems } from '../tools/seed-problems.js';
import { BANK_VERSION, PLAYGROUND_SLUGS, loadBankSources } from '../tools/problem-pipeline/bank/index.js';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

function minimalProblem(overrides = {}) {
  return {
    slug: 'test-problem',
    title: 'Test Problem',
    statement: 'Do the thing with the numbers as described in detail here.',
    examples: [{ input: 'x', output: 'y' }],
    constraints: ['1 <= n'],
    params: [{ name: 'nums', type: 'int[]' }],
    returnType: 'int[]',
    comparison: 'exact',
    topics: ['arrays'],
    difficulty: 'easy',
    tests: [
      { args: [[1]], expected: [1], hidden: false },
      { args: [[2]], expected: [2], hidden: false },
      { args: [[3]], expected: [3], hidden: false },
      { args: [[4]], expected: [4], hidden: true },
      { args: [[5]], expected: [5], hidden: true },
      { args: [[6]], expected: [6], hidden: true },
    ],
    signatures: {
      javascript: 'function solve(nums) {}',
      python: 'def solve(nums):',
      cpp: 'vector<int> solve(vector<int> nums)',
    },
    starter: {
      javascript: 'function solve(nums) {\n}',
      python: 'def solve(nums):\n    pass',
      cpp: 'vector<int> solve(vector<int> nums) {\n}',
    },
    hints: ['hint'],
    reference: { javascript: 'x', python: 'x', cpp: 'x' },
    oracle: { language: 'javascript', code: 'y', note: 'oracle note' },
    wrong: { language: 'javascript', code: 'z', note: 'wrong note' },
    source: 'test',
    ...overrides,
  };
}

describe('problemSchema', () => {
  test('accepts a well-formed problem', () => {
    const p = problemSchema.parse(minimalProblem());
    assert.equal(p.slug, 'test-problem');
  });

  test('rejects fewer than 6 tests', () => {
    const bad = minimalProblem({ tests: minimalProblem().tests.slice(0, 5) });
    assert.throws(() => problemSchema.parse(bad), /at least 6/);
  });

  test('rejects fewer than 3 hidden tests', () => {
    const tests = minimalProblem().tests.map((t) => ({ ...t, hidden: false }));
    assert.throws(() => problemSchema.parse(minimalProblem({ tests })), /hidden/);
  });

  test('rejects args/params length mismatch', () => {
    const tests = minimalProblem().tests.map((t, i) =>
      i === 0 ? { ...t, args: [[1], [2]] } : t
    );
    assert.throws(() => problemSchema.parse(minimalProblem({ tests })), /args/);
  });

  test('rejects unknown difficulty', () => {
    assert.throws(() => problemSchema.parse(minimalProblem({ difficulty: 'hard' })));
  });

  test('toClientProblem strips solutions and adds id alias', () => {
    const client = toClientProblem(minimalProblem());
    assert.equal(client.id, 'test-problem');
    assert.equal(client.slug, 'test-problem');
    assert.ok(!('reference' in client));
    assert.ok(!('oracle' in client));
    assert.ok(!('wrong' in client));
    assert.ok(Array.isArray(client.tests));
  });
});

describe('canonicalise', () => {
  test('returns the problem on success', () => {
    const p = canonicalise(minimalProblem());
    assert.equal(p.slug, 'test-problem');
  });

  test('wraps schema errors in PipelineError with slug', () => {
    try {
      canonicalise(minimalProblem({ slug: 'bad one!' }));
      assert.fail('should have thrown');
    } catch (e) {
      assert.ok(e instanceof PipelineError);
      assert.match(e.message, /bad one!/);
    }
  });
});

// ---------------------------------------------------------------------------
// Differential verdict
// ---------------------------------------------------------------------------

function run(statuses) {
  // statuses: array of 'pass' | 'fail' | 'error'
  return {
    results: statuses.map((status, index) => ({ index, status, actual: status === 'pass' ? 1 : 0 })),
  };
}

describe('differentialVerdict', () => {
  const problem = { slug: 'x', comparison: 'exact' };

  test('passes (null) when wrong fails >=1 and oracle agrees', () => {
    const v = differentialVerdict({
      problem,
      wrongRun: run(['pass', 'pass', 'fail']),
      oracleRun: run(['pass', 'pass', 'pass']),
      referenceRuns: [{ language: 'javascript', results: run(['pass', 'pass', 'pass']).results }],
    });
    assert.equal(v, null);
  });

  test('fails when the wrong solution passes everything (weak tests)', () => {
    const v = differentialVerdict({
      problem,
      wrongRun: run(['pass', 'pass', 'pass']),
      oracleRun: run(['pass', 'pass', 'pass']),
      referenceRuns: [{ language: 'javascript', results: run(['pass', 'pass', 'pass']).results }],
    });
    assert.match(v, /wrong solution passes every test/);
  });

  test('fails when oracle disagrees with reference', () => {
    const v = differentialVerdict({
      problem,
      wrongRun: run(['fail', 'pass', 'pass']),
      oracleRun: run(['pass', 'fail', 'pass']),
      referenceRuns: [{ language: 'javascript', results: run(['pass', 'pass', 'pass']).results }],
    });
    assert.match(v, /oracle/);
  });
});

// ---------------------------------------------------------------------------
// Calibration
// ---------------------------------------------------------------------------

describe('calibrateLimit', () => {
  test('is 10x measured with 1000ms floor and 10000ms cap', () => {
    assert.equal(calibrateLimit(50), 1000); // floor
    assert.equal(calibrateLimit(208), 2080); // 10x
    assert.equal(calibrateLimit(5000), 10000); // cap
  });

  test('CALIBRATION documents the policy', () => {
    assert.equal(CALIBRATION.HEADROOM, 10);
    assert.equal(CALIBRATION.FLOOR_MS, 1000);
    assert.equal(CALIBRATION.CAP_MS, 10000);
  });
});

// ---------------------------------------------------------------------------
// Seed idempotency (fake collection)
// ---------------------------------------------------------------------------

function fakeModels() {
  const store = new Map(); // slug -> doc
  let meta = null;
  return {
    store,
    Problem: {
      async bulkWrite(ops) {
        let upserted = 0, modified = 0;
        for (const op of ops) {
          const slug = op.updateOne.filter.slug;
          if (store.has(slug)) modified++;
          else upserted++;
          store.set(slug, op.updateOne.update.$set);
        }
        return { upsertedCount: upserted, modifiedCount: modified };
      },
    },
    Meta: {
      findOne() {
        return {
          lean: async () => (meta ? { ...meta } : null),
        };
      },
      async updateOne(_filter, update) {
        meta = { key: 'bank', ...update.$set };
        return {};
      },
    },
  };
}

describe('seedProblems', () => {
  // Self-contained fixture: 2 problems, version 9.9.9-test. Does not depend on
  // the pipeline's emitted bank file.
  async function fixtureBankPath() {
    const { writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const bank = {
      version: '9.9.9-test',
      problems: [
        { slug: 'alpha', title: 'Alpha' },
        { slug: 'beta', title: 'Beta' },
      ],
    };
    const p = join(tmpdir(), `test-bank-${Date.now()}.json`);
    writeFileSync(p, JSON.stringify(bank));
    return p;
  }

  test('seeds, then no-ops on the same version (idempotent)', async () => {
    const models = fakeModels();
    const bankPath = await fixtureBankPath();
    const r1 = await seedProblems({ bankPath, models });
    assert.equal(r1.action, 'seeded');
    assert.equal(r1.count, 2);
    assert.equal(models.store.size, 2);

    const r2 = await seedProblems({ bankPath, models });
    assert.equal(r2.action, 'noop');
    assert.equal(r2.version, r1.version);
  });

  test('dry-run changes nothing', async () => {
    const models = fakeModels();
    const bankPath = await fixtureBankPath();
    const r = await seedProblems({ bankPath, models, dryRun: true });
    assert.equal(r.action, 'dry-run');
    assert.equal(models.store.size, 0);
  });
});

// ---------------------------------------------------------------------------
// Playground / canonical sync
// ---------------------------------------------------------------------------

describe('playground/canonical sync', () => {
  test('every playground slug exists in the canonical bank', () => {
    const sources = loadBankSources();
    const slugs = new Set(sources.map((p) => p.slug));
    for (const slug of PLAYGROUND_SLUGS) {
      assert.ok(slugs.has(slug), `playground slug ${slug} missing from bank`);
    }
  });

  test('bank version is set', () => {
    assert.match(BANK_VERSION, /^\d+\.\d+\.\d+$/);
  });
});

// ---------------------------------------------------------------------------
// generate.js fails loudly without keys
// ---------------------------------------------------------------------------

describe('generateProblem', () => {
  test('fails loudly when the gateway has no keys (mock provider)', async () => {
    const { generateProblem } = await import('../tools/problem-pipeline/generate.js');
    await assert.rejects(() => generateProblem({ topic: 'arrays' }), /mock|key|API key/i);
  });
});
