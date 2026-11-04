/**
 * Milestone 6 — problem bank assembly.
 *
 * Hand-authored classic DSA problems (own wording; no scraped statements).
 * The pipeline validates every entry: canonicalise → verify (real JS/Python/
 * C++ runtimes) → differential (wrong solution must fail ≥1 test, oracle must
 * agree with reference) → calibrate → emit.
 */
import { SAMPLES } from './samples.js';
import { ARRAYS } from './arrays.js';
import { STRINGS } from './strings.js';
import { POINTERS_WINDOWS } from './pointers-windows.js';
import { STACK_SEARCH } from './stack-search.js';
import { SORTING_MATH } from './sorting-math.js';
import { HINTS } from './hints.js';

/** Bank version — bumped for every validated release; the seed script treats
 *  a version bump as a migration (new problems inserted, existing untouched).
 *  1.1.0 adds the M8 precomputed hint ladders (spec §4.6); solutions and
 *  tests are unchanged from the 1.0.0 validation. */
export const BANK_VERSION = '1.1.0';

/** Problems shown in the /playground demo (subset of the bank). */
export const PLAYGROUND_SLUGS = ['two-sum', 'valid-parentheses', 'reverse-string', 'contains-duplicate'];

/** All problem sources in validation order, with M8 hint ladders merged in. */
export function loadBankSources() {
  return [...SAMPLES, ...ARRAYS, ...STRINGS, ...POINTERS_WINDOWS, ...STACK_SEARCH, ...SORTING_MATH].map(
    (p) => (p.hints && p.hints.length > 0 ? p : { ...p, hints: HINTS[p.slug] || [] }),
  );
}
