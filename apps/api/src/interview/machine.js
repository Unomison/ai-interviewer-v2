/**
 * Milestone 8 — interview state machine (spec §§4.4–4.6).
 *
 * Hand-written, fully tested, pure functions. Two levels:
 *
 * 1. Round machine (ADR 002 order):
 *      intro → resume → dsa → cs → behavioral → closing → done
 *    Transitions only move forward one step. Invalid transitions are
 *    rejected with a clear reason — this module never throws.
 *
 * 2. DSA per-problem sub-machine (spec §4.6):
 *      shown → approach → coding → submitted → scored
 *    The approach→coding edge is guarded by the approach judge:
 *      accept            → unlock (no penalty)
 *      hint (hints left) → serve next precomputed hint, stay in approach
 *      clarify           → ask one clarifying question, stay in approach
 *      hint (none left)  → unlock anyway, record it (spec §4.6)
 *      judge error       → unlock, record it (never hard-lock the candidate)
 */
import { ROUND_ORDER } from './schema.js';

export { ROUND_ORDER };

export const DSA_STATES = ['shown', 'approach', 'coding', 'submitted', 'scored'];

/** Max precomputed hints per problem (spec §4.6). */
export const MAX_HINTS = 3;
/** Score penalty per hint used (spec §4.6 default), capped. */
export const HINT_PENALTY = 5;
export const HINT_PENALTY_CAP = 15;

/** Next round after `round`, or 'done' when the interview is complete. Null for unknown input. */
export function nextRound(round) {
  const i = ROUND_ORDER.indexOf(round);
  if (i < 0) return null;
  return ROUND_ORDER[i + 1] || 'done';
}

/**
 * Validate a round transition. Returns { ok: true } or
 * { ok: false, reason } — never throws.
 */
export function checkTransition(from, to) {
  if (!ROUND_ORDER.includes(from)) return { ok: false, reason: `unknown round: ${from}` };
  if (to !== 'done' && !ROUND_ORDER.includes(to)) {
    return { ok: false, reason: `unknown round: ${to}` };
  }
  const expected = nextRound(from);
  if (to !== expected) {
    return { ok: false, reason: `cannot move from ${from} to ${to}; expected ${expected}` };
  }
  return { ok: true };
}

/**
 * Apply an approach-judge verdict to a DSA problem record (pure).
 *
 * @param {object} dsa   the problem record { hintsUsed, ... }
 * @param {'accept'|'hint'|'clarify'|'error'} verdict
 * @param {string|null} nextHint  the precomputed hint to serve (verdict 'hint')
 * @returns {{ patch, hintToServe, unlocked, unlockReason }}
 */
export function applyJudgeVerdict(dsa, verdict, nextHint = null) {
  const hintsUsed = dsa.hintsUsed || 0;
  if (verdict === 'accept' || verdict === 'error') {
    return {
      patch: { unlocked: true, unlockReason: verdict === 'error' ? 'judge-error' : 'accepted', state: 'coding' },
      hintToServe: null,
      unlocked: true,
      unlockReason: verdict === 'error' ? 'judge-error' : 'accepted',
    };
  }
  if (verdict === 'clarify') {
    return { patch: { state: 'approach' }, hintToServe: null, unlocked: false, unlockReason: null };
  }
  // verdict === 'hint'
  const newHintsUsed = hintsUsed + 1;
  if (newHintsUsed >= MAX_HINTS) {
    // Spec §4.6: hints exhausted → unlock anyway and record it.
    return {
      patch: {
        unlocked: true,
        unlockReason: 'hints-exhausted',
        state: 'coding',
        hintsUsed: newHintsUsed,
        hintsGiven: [...(dsa.hintsGiven || []), nextHint].filter(Boolean),
      },
      hintToServe: nextHint,
      unlocked: true,
      unlockReason: 'hints-exhausted',
    };
  }
  return {
    patch: {
      state: 'approach',
      hintsUsed: newHintsUsed,
      hintsGiven: [...(dsa.hintsGiven || []), nextHint].filter(Boolean),
    },
    hintToServe: nextHint,
    unlocked: false,
    unlockReason: null,
  };
}

/**
 * Score one DSA problem once its tests are submitted (spec §4.6 penalty).
 * Pure function — unit tested.
 *
 * @param {object} dsa      { hintsUsed, submissions: [{ results: { passed, total, verdict } }] }
 * @returns {number} 0–100
 */
export function scoreDsaProblem(dsa) {
  const last = (dsa.submissions || []).slice(-1)[0];
  const hintsUsed = dsa.hintsUsed || 0;
  const penalty = Math.min(hintsUsed * HINT_PENALTY, HINT_PENALTY_CAP);
  if (!last || !last.results || typeof last.results.total !== 'number' || last.results.total === 0) {
    return 0;
  }
  const { passed, total } = last.results;
  const base = Math.round((passed / total) * 100);
  return Math.max(0, base - penalty);
}

/**
 * Validate a DSA sub-state transition for a candidate action.
 * Returns { ok: true } or { ok: false, reason } — never throws.
 */
export function checkDsaAction(dsa, action) {
  const state = dsa?.state;
  if (!DSA_STATES.includes(state)) return { ok: false, reason: `unknown DSA state: ${state}` };
  const allowed = {
    shown: ['start-approach'],
    approach: ['submit-approach'],
    coding: ['submit-code'],
    submitted: ['follow-ups'],
    scored: ['next-problem'],
  }[state];
  if (!allowed.includes(action)) {
    return { ok: false, reason: `action "${action}" not allowed in DSA state "${state}"` };
  }
  return { ok: true };
}
