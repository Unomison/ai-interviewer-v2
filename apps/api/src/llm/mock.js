/**
 * Deterministic mock responses for the LLM gateway.
 *
 * When NO provider keys are configured at all, the gateway serves mocks so
 * the pipeline works end-to-end with zero keys (owner decision, ADR 002).
 * Mocks are deterministic (seeded by task+prompt hash) and are validated
 * against the caller's Zod schema before being returned — a mock that fails
 * its own schema is a loud internal error, never silent bad data.
 *
 * Spec Section 2: the deployed demo never hard-requires a key to boot.
 */

import { createHash } from 'node:crypto';

/** mulberry32 PRNG seeded from a string — deterministic across runs. */
function seededRandom(seedStr) {
  const h = createHash('sha256').update(seedStr).digest();
  let s = h.readUInt32BE(0);
  return function rand() {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mockString(def, rand) {
  const checks = def.checks || [];
  let min = 0;
  let max = 200;
  let kind = null;
  for (const c of checks) {
    if (c.kind === 'min') min = Math.max(min, c.value);
    if (c.kind === 'max') max = Math.min(max, c.value);
    if (c.kind === 'length') {
      min = c.value;
      max = c.value;
    }
    if (c.kind === 'email') kind = 'email';
    else if (c.kind === 'url') kind = 'url';
    else if (c.kind === 'uuid') kind = 'uuid';
    else if (c.kind === 'datetime') kind = 'datetime';
  }
  if (kind === 'email') return 'mock@example.com';
  if (kind === 'url') return 'https://example.com/mock';
  if (kind === 'uuid') return '00000000-0000-4000-8000-000000000000';
  if (kind === 'datetime') return '2026-01-01T00:00:00.000Z';
  const len = Math.min(Math.max(min, 8), max);
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  let s = '';
  for (let i = 0; i < len; i++) s += alphabet[Math.floor(rand() * alphabet.length)];
  return s;
}

function mockNumber(def) {
  const checks = def.checks || [];
  let min = 0;
  let max = 100;
  let isInt = false;
  for (const c of checks) {
    if (c.kind === 'min') min = Math.max(min, c.value);
    if (c.kind === 'max') max = Math.min(max, c.value);
    if (c.kind === 'int') isInt = true;
  }
  let v = Number.isFinite(min) ? min : 0;
  if (v > max) v = max;
  return isInt ? Math.round(v) : v;
}

/**
 * Build a deterministic mock value for any Zod v3 schema.
 * Throws a loud error for shapes it cannot mock (extend as schemas grow).
 */
export function mockForSchema(schema, seed = 'mock') {
  const rand = seededRandom(`ai-interviewer-mock:${seed}`);
  const value = mockValue(schema, rand, 0);
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `mock generator produced output that fails schema validation: ${parsed.error.message}. ` +
        `Extend mock.js to cover this shape.`
    );
  }
  return parsed.data;
}

function mockValue(schema, rand, depth) {
  if (depth > 10) return null; // runaway recursion guard
  const def = schema._def;
  if (!def || !def.typeName) throw new Error('mockForSchema expects a Zod schema');

  switch (def.typeName) {
    case 'ZodString':
      return mockString(def, rand);
    case 'ZodNumber':
      return mockNumber(def);
    case 'ZodBoolean':
      return false;
    case 'ZodDate':
      return new Date('2026-01-01T00:00:00.000Z');
    case 'ZodEnum':
      return def.values[0];
    case 'ZodNativeEnum': {
      const vals = Object.values(def.values);
      return vals[0];
    }
    case 'ZodLiteral':
      return def.values[0];
    case 'ZodArray': {
      const minLen = (def.minLength?.value ?? 1);
      const n = Math.max(1, minLen);
      return Array.from({ length: Math.min(n, 3) }, () => mockValue(def.type, rand, depth + 1));
    }
    case 'ZodObject': {
      const out = {};
      for (const [key, fieldSchema] of Object.entries(def.shape())) {
        out[key] = mockValue(fieldSchema, rand, depth + 1);
      }
      return out;
    }
    case 'ZodRecord':
      return { key: mockValue(def.valueType, rand, depth + 1) };
    case 'ZodTuple':
      return def.items.map((s) => mockValue(s, rand, depth + 1));
    case 'ZodUnion':
    case 'ZodDiscriminatedUnion':
      return mockValue(def.options[0], rand, depth + 1);
    case 'ZodOptional':
    case 'ZodNullable':
    case 'ZodDefault':
      return mockValue(def.innerType, rand, depth + 1);
    case 'ZodEffects':
      // z.coerce.* / refinements: mock the inner type; safeParse at the end
      // is the backstop (e.g. z.coerce.date() accepts the Date we make).
      return mockValue(def.schema, rand, depth + 1);
    case 'ZodLazy':
      return mockValue(def.getter(), rand, depth + 1);
    case 'ZodAny':
    case 'ZodUnknown':
      return null;
    case 'ZodVoid':
      return undefined;
    default:
      throw new Error(`mock generator has no rule for ${def.typeName}; extend mock.js`);
  }
}

/**
 * Deterministic pseudo-random unit vector (mock embeddings).
 * Same text -> same vector, always.
 */
export function mockVector(dimensions, seedText) {
  const rand = seededRandom(`ai-interviewer-embed:${seedText}`);
  const v = Array.from({ length: dimensions }, () => rand() * 2 - 1);
  const norm = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}
