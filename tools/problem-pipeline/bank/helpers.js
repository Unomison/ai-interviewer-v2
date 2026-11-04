/**
 * Milestone 6 — bank authoring helpers.
 *
 * Hand-authoring 50+ problems stays manageable by deriving the mechanical
 * parts (signatures, starter templates) from params/returnType. Statements,
 * tests and solutions are always hand-written.
 */
import { CPP_TYPES } from '../../../apps/web/src/runner/harness.js';

const PY_TYPES = {
  int: 'int',
  float: 'float',
  bool: 'bool',
  string: 'str',
  'int[]': 'list[int]',
  'float[]': 'list[float]',
  'bool[]': 'list[bool]',
  'string[]': 'list[str]',
  'int[][]': 'list[list[int]]',
  'float[][]': 'list[list[float]]',
};

const JS_TYPES = {
  int: 'number',
  float: 'number',
  bool: 'boolean',
  string: 'string',
  'int[]': 'number[]',
  'float[]': 'number[]',
  'bool[]': 'boolean[]',
  'string[]': 'string[]',
  'int[][]': 'number[][]',
  'float[][]': 'number[][]',
};

function cppDecl(t) {
  const e = CPP_TYPES[t];
  if (!e) throw new Error(`no C++ mapping for type ${t}`);
  return e.decl;
}

/** Derive per-language signatures from params/returnType. */
export function signaturesFor(params, returnType, functionName = 'solve') {
  const names = params.map((p) => p.name).join(', ');
  return {
    javascript: `function ${functionName}(${names})`,
    python: `def ${functionName}(${params.map((p) => `${p.name}: ${PY_TYPES[p.type]}`).join(', ')}) -> ${PY_TYPES[returnType]}:`,
    cpp: `${cppDecl(returnType)} ${functionName}(${params.map((p) => `${cppDecl(p.type)} ${p.name}`).join(', ')})`,
  };
}

/** Starter templates with typed doc comments, derived from the spec. */
export function startersFor(problem) {
  const fn = problem.functionName || 'solve';
  const jsParams = problem.params.map((p) => `@param {${JS_TYPES[p.type]}} ${p.name}`).join('\n * ');
  const jsRet = `@return {${JS_TYPES[problem.returnType]}}`;
  const pySig = problem.signatures.python;
  const cppSig = problem.signatures.cpp;
  return {
    javascript: `/**\n * ${jsParams}\n * ${jsRet}\n */\nfunction ${fn}(${problem.params.map((p) => p.name).join(', ')}) {\n  // your code here\n}\n`,
    python: `${pySig}\n    """\n    ${problem.params.map((p) => `${p.name}: ${PY_TYPES[p.type]}`).join(', ')} -> ${PY_TYPES[problem.returnType]}\n    """\n    # your code here\n    pass\n`,
    cpp: `#include <bits/stdc++.h>\n\n${cppSig} {\n    // your code here\n}\n`,
  };
}

/**
 * Problem factory: fills mechanical defaults so each bank file only states
 * what is unique. `spec` must include: slug, title, statement, examples,
 * constraints, params, returnType, tests, topics, reference, oracle, wrong.
 */
export function P(spec) {
  const functionName = spec.functionName || 'solve';
  const signatures = spec.signatures || signaturesFor(spec.params, spec.returnType, functionName);
  const problem = {
    functionName,
    comparison: 'exact',
    difficulty: 'easy',
    timeLimitMs: 2000,
    memoryMb: 64,
    hints: [],
    ...spec,
    signatures,
  };
  problem.starter = spec.starter || startersFor(problem);
  return problem;
}

/** Shorthand for a test: T(args, expected, hidden=false). */
export function T(args, expected, hidden = false) {
  return { args, expected, hidden };
}
