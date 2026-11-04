/**
 * Milestone 8 — precomputed hint ladders (spec §4.6).
 *
 * "Hints are precomputed offline and stored with the problem (consistent,
 * fast, and zero extra LLM calls). Max 3."
 *
 * Each ladder is progressive: hint 1 validates or nudges the brute force,
 * hint 2 points at the key insight, hint 3 nearly describes the approach —
 * without ever writing the solution. The M8 approach judge serves these one
 * at a time; the four M4 sample problems already carry their own hints.
 */
export const HINTS = {
  'best-time-to-buy-sell-stock': [
    'A brute-force double loop checks every buy/sell pair — O(n²). As you scan left to right, what single value about the past would let you evaluate today?',
    'Track the lowest price seen so far; the best profit ending today is just today\u2019s price minus that minimum.',
  ],
  'maximum-subarray': [
    'Brute force checks every subarray — O(n²). At each position you only need one decision: extend the previous subarray or start fresh here.',
    'Keep a running sum; when it goes negative, reset it — a negative prefix can never help a future subarray.',
  ],
  'product-except-self': [
    'Division is off the table. For each position, the answer is (product of everything to the left) × (product of everything to the right).',
    'Two passes: first write the left-products into the answer, then multiply by a running right-product — O(n) time, O(1) extra space.',
  ],
  'rotate-array': [
    'Try the O(n)-space version first: each element moves to index (i + k) % n. Then think about doing it in place.',
    'Reversing is your friend: reverse the whole array, then reverse the first k elements and the rest separately.',
  ],
  'move-zeroes': [
    'You need non-zeroes first, order preserved, in place. Imagine a write pointer that only advances when you see a non-zero value.',
    'One pass: copy each non-zero to the write index and bump it; when the scan ends, fill the tail with zeroes.',
  ],
  'majority-element': [
    'Sorting works — O(n log n). Can you do it in one pass with O(1) space?',
    'Boyer–Moore voting: keep a candidate and a count; same value → count++, different → count−−. The true majority always survives.',
  ],
  'plus-one': [
    'Walk from the last digit: a 9 becomes 0 and carries, anything else just increments and you are done.',
    'The only tricky case is all 9s — then the answer is a 1 followed by zeroes, one digit longer than the input.',
  ],
  'running-sum': [
    'Each answer[i] is just answer[i−1] + nums[i]. One pass, O(1) extra space beyond the output.',
  ],
  'merge-sorted-array': [
    'Merging from the front overwrites values you have not processed yet. Where is the guaranteed empty space?',
    'Fill from the back: two pointers at the ends of the valid regions, write the larger one at the tail and move backwards.',
  ],
  'remove-duplicates-sorted': [
    'Two pointers: one scans every element, one marks where the next kept value goes.',
    'The array is sorted, so duplicates sit together — copy a value forward only when it differs from the previous one.',
  ],
  'missing-number': [
    'Sorting and scanning works. Can you use arithmetic instead of ordering?',
    'Sum of 0..n minus the array\u2019s actual sum is the missing number — equivalently, XOR everything together.',
  ],
  'squares-of-sorted-array': [
    'Squaring then sorting is O(n log n). After squaring, where do the largest values come from in a sorted array?',
    'Two pointers at both ends; write the larger square at the back of the answer and move inward.',
  ],
  'valid-palindrome': [
    'Ignore (or skip in place) anything that is not a letter or digit, then compare from both ends toward the middle.',
  ],
  'valid-anagram': [
    'Two strings are anagrams exactly when their character counts match — one hash map (or a 26-slot array) does it in a single pass.',
  ],
  'longest-common-prefix': [
    'Compare character by character across all strings and stop at the first mismatch.',
    'Alternative: sort the array — then you only ever need to compare the first and last strings.',
  ],
  'length-of-last-word': [
    'Skip trailing spaces first, then count characters until the next space. One right-to-left pass.',
  ],
  'reverse-words-in-string': [
    'Split on whitespace, drop the empties, reverse the word list, and rejoin with single spaces.',
  ],
  'first-unique-character': [
    'Count every character in a first pass, then scan once more for the first character whose count is 1.',
  ],
  'ransom-note': [
    'Count the magazine\u2019s letters, then consume one per ransom-note letter — if any count runs out, the answer is false.',
  ],
  'isomorphic-strings': [
    'Map s→t as you scan, but also enforce the reverse: two different s-characters must never map to the same t-character.',
  ],
  'roman-to-integer': [
    'Scan left to right: when a symbol is smaller than the one after it, subtract it; otherwise add it.',
  ],
  'add-strings': [
    'Add digit by digit from the right with a carry, exactly like paper addition — build the answer reversed, then flip it.',
  ],
  'container-with-most-water': [
    'Brute force tries every pair — O(n²). The area is limited by the shorter line, so start with the widest container and move inward.',
    'Two pointers at the ends; always move the shorter side — moving the taller side can never improve the area.',
  ],
  '3sum': [
    'Sort first. Then fix one element and solve two-sum on the rest — with two pointers, since the array is sorted.',
    'Skip duplicate values at each position so every triplet is reported exactly once.',
  ],
  'two-sum-ii-sorted': [
    'The input is sorted, so no hash map is needed: two pointers from both ends, moving based on whether the sum is too big or too small.',
  ],
  'remove-element': [
    'Same shape as remove-duplicates: a write pointer keeps every value that is not val, preserving order.',
  ],
  'max-average-subarray-i': [
    'Recomputing each window\u2019s sum from scratch is O(n·k). Slide instead: subtract the element leaving the window, add the one entering.',
  ],
  'longest-substring-without-repeating': [
    'Keep a window [left, right] plus a set of seen characters. When s[right] repeats, shrink from the left until the window is unique again.',
    'Track each character\u2019s last index in a map so you can jump left forward in one step instead of shrinking one by one.',
  ],
  'minimum-size-subarray-sum': [
    'Expand the right edge adding values; once the sum reaches the target, shrink the left edge while recording the smallest window. Each index moves at most twice — O(n).',
  ],
  'contains-duplicate-ii': [
    'A set holds the current window of size k. For each number: if it is already in the set → true; add it; then drop the element that fell k behind.',
  ],
  'baseball-game': [
    'Simulate with a stack of scores: a number pushes, "C" pops, "D" pushes double the top, "+" pushes the sum of the top two.',
  ],
  'backspace-string-compare': [
    'Build each final string with a stack (push characters, pop on "#") and compare — or do it in O(1) space scanning from the ends with skip counters.',
  ],
  'next-greater-element-i': [
    'For each element, the answer is the first larger value to its right — a stack scanning right-to-left finds all of them in O(n).',
    'Pop smaller elements off the stack; whatever remains on top (if anything) is the next greater. Store answers in a map for the queries.',
  ],
  'binary-search': [
    'Halve the search space each step: compare mid with the target and discard the wrong half. Write mid as lo + (hi − lo)/2 to avoid overflow.',
  ],
  'search-insert-position': [
    'It is binary search where the answer is the insertion point: when the loop ends without a hit, return lo.',
  ],
  'sqrtx': [
    'Binary search the answer itself: find the largest m with m·m ≤ x. Compare with m ≤ x/m to avoid overflow.',
  ],
  'find-min-rotated': [
    'Binary search still works, but the rotation breaks the order: compare mid with the rightmost element to decide which half holds the minimum.',
  ],
  'sort-colors': [
    'Counting the 0s, 1s and 2s then rewriting is the easy two-pass version. For one pass, use the Dutch-flag: three regions maintained with lo/mid/hi pointers.',
  ],
  'kth-largest-element': [
    'Sorting is O(n log n) and perfectly acceptable, but a min-heap of size k gives O(n log k) — evict the smallest whenever the heap grows past k.',
  ],
  'height-checker': [
    'Sort a copy of the array, then count the positions where the original differs from the sorted version.',
  ],
  'fibonacci': [
    'Naive recursion recomputes the same values exponentially many times. Memoize the results — or just iterate with two variables for O(n) time and O(1) space.',
  ],
  'climbing-stairs': [
    'To reach step n you must have come from n−1 or n−2, so ways(n) = ways(n−1) + ways(n−2). It is the Fibonacci sequence in disguise.',
  ],
  'palindrome-number': [
    'Reversing the whole number risks overflow. Reverse only half the digits, then compare the halves (dropping the middle digit for odd lengths).',
  ],
  'reverse-integer': [
    'Pop digits with % 10 and append them to the answer — but check for overflow *before* multiplying by 10 (compare against INT_MAX/10).',
  ],
  'fizz-buzz': [
    'Test divisibility by 3 and 5 for each number; handle the both-divisible case (15) explicitly, or build each string from the two checks.',
  ],
  'single-number': [
    'XOR cancels pairs (a ^ a = 0), so XORing the whole array leaves exactly the single number — O(n) time, O(1) space.',
  ],
  'power-of-two': [
    'Powers of two have exactly one bit set: n > 0 && (n & (n − 1)) === 0.',
  ],
  'counting-bits': [
    'The popcount of i relates to i/2: bits[i] = bits[i >> 1] + (i & 1). Fill the array in one increasing pass — no per-number loop.',
  ],
};
