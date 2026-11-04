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

/** Bank version — bumped for every validated release; the seed script treats
 *  a version bump as a migration (new problems inserted, existing untouched). */
export const BANK_VERSION = '1.0.0';

/** Problems shown in the /playground demo (subset of the bank). */
export const PLAYGROUND_SLUGS = ['two-sum', 'valid-parentheses', 'reverse-string', 'contains-duplicate'];

/** All problem sources in validation order. */
export function loadBankSources() {
  return [...SAMPLES, ...ARRAYS, ...STRINGS, ...POINTERS_WINDOWS, ...STACK_SEARCH, ...SORTING_MATH];
}
