/**
 * Milestone 6 — bank: array problems (12).
 * Own wording throughout; each entry validated by the pipeline.
 */
import { P, T } from './helpers.js';

export const ARRAYS = [
  P({
    slug: 'best-time-to-buy-sell-stock',
    title: 'Best Time to Buy and Sell Stock',
    statement:
      'You are given an array prices where prices[i] is the price of a stock on day i. ' +
      'Choose one day to buy and a later day to sell to maximise profit. Return the maximum ' +
      'profit you can achieve. If no profit is possible, return 0.',
    examples: [
      { input: 'prices = [7, 1, 5, 3, 6, 4]', output: '5' },
      { input: 'prices = [7, 6, 4, 3, 1]', output: '0' },
    ],
    constraints: ['1 <= prices.length <= 10^5', '0 <= prices[i] <= 10^4'],
    params: [{ name: 'prices', type: 'int[]' }],
    returnType: 'int',
    topics: ['arrays'],
    tests: [
      T([[7, 1, 5, 3, 6, 4]], 5),
      T([[7, 6, 4, 3, 1]], 0),
      T([[1, 2]], 1),
      T([[2, 4, 1]], 2, true),
      T([[3, 3, 3, 3]], 0, true),
      T([[1, 2, 3, 4, 5]], 4, true),
      T([Array.from({ length: 20000 }, (_, i) => 20000 - i)], 0, true),
    ],
    reference: {
      javascript: `function solve(prices) {
  let best = 0, low = Infinity;
  for (const p of prices) {
    if (p < low) low = p;
    if (p - low > best) best = p - low;
  }
  return best;
}`,
      python: `def solve(prices):
    best = 0
    low = float('inf')
    for p in prices:
        if p < low:
            low = p
        if p - low > best:
            best = p - low
    return best`,
      cpp: `int solve(vector<int> prices) {
    int best = 0, low = INT_MAX;
    for (int p : prices) {
        low = min(low, p);
        best = max(best, p - low);
    }
    return best;
}`,
    },
    oracle: {
      language: 'javascript',
      note: 'Brute-force all buy/sell pairs.',
      code: `function solve(prices) {
  let best = 0;
  for (let i = 0; i < prices.length; i++)
    for (let j = i + 1; j < prices.length; j++)
      best = Math.max(best, prices[j] - prices[i]);
  return best;
}`,
    },
    wrong: {
      language: 'javascript',
      note: 'Uses global max minus global min, ignoring that the sell must come after the buy.',
      code: `function solve(prices) {
  return Math.max(...prices) - Math.min(...prices);
}`,
    },
    source: 'classic:best-time-to-buy-sell-stock (own wording)',
  }),

  P({
    slug: 'maximum-subarray',
    title: 'Maximum Subarray',
    statement:
      'Given an integer array nums, find the contiguous subarray (containing at least one number) ' +
      'with the largest sum, and return that sum.',
    examples: [
      { input: 'nums = [-2, 1, -3, 4, -1, 2, 1, -5, 4]', output: '6' },
      { input: 'nums = [1]', output: '1' },
    ],
    constraints: ['1 <= nums.length <= 10^5', '-10^4 <= nums[i] <= 10^4'],
    params: [{ name: 'nums', type: 'int[]' }],
    returnType: 'int',
    topics: ['arrays', 'dp'],
    tests: [
      T([[-2, 1, -3, 4, -1, 2, 1, -5, 4]], 6),
      T([[1]], 1),
      T([[5, 4, -1, 7, 8]], 23),
      T([[-2, -1]], -1, true),
      T([[-1]], -1, true),
      T([[1, 2, 3, 4, 5]], 15, true),
      T([Array.from({ length: 50000 }, (_, i) => (i % 2 === 0 ? 1 : -1))], 1, true),
    ],
    reference: {
      javascript: `function solve(nums) {
  let best = nums[0], cur = nums[0];
  for (let i = 1; i < nums.length; i++) {
    cur = Math.max(nums[i], cur + nums[i]);
    best = Math.max(best, cur);
  }
  return best;
}`,
      python: `def solve(nums):
    best = cur = nums[0]
    for x in nums[1:]:
        cur = max(x, cur + x)
        best = max(best, cur)
    return best`,
      cpp: `int solve(vector<int> nums) {
    int best = nums[0], cur = nums[0];
    for (size_t i = 1; i < nums.size(); i++) {
        cur = max(nums[i], cur + nums[i]);
        best = max(best, cur);
    }
    return best;
}`,
    },
    oracle: {
      language: 'javascript',
      note: 'Brute-force all subarrays.',
      code: `function solve(nums) {
  let best = -Infinity;
  for (let i = 0; i < nums.length; i++) {
    let sum = 0;
    for (let j = i; j < nums.length; j++) {
      sum += nums[j];
      if (sum > best) best = sum;
    }
  }
  return best;
}`,
    },
    wrong: {
      language: 'javascript',
      note: 'Classic Kadane bug: best initialised to 0 instead of nums[0], so all-negative arrays return 0.',
      code: `function solve(nums) {
  let best = 0, cur = 0;
  for (const x of nums) {
    cur = Math.max(0, cur + x);
    best = Math.max(best, cur);
  }
  return best;
}`,
    },
    source: 'classic:maximum-subarray (own wording)',
  }),

  P({
    slug: 'product-except-self',
    title: 'Product of Array Except Self',
    statement:
      'Given an integer array nums, return an array answer such that answer[i] equals the product ' +
      'of all elements of nums except nums[i]. You must solve it in O(n) time and without using ' +
      'the division operator.',
    examples: [
      { input: 'nums = [1, 2, 3, 4]', output: '[24, 12, 8, 6]' },
      { input: 'nums = [-1, 1, 0, -3, 3]', output: '[0, 0, 9, 0, 0]' },
    ],
    constraints: ['2 <= nums.length <= 10^5', '-30 <= nums[i] <= 30'],
    params: [{ name: 'nums', type: 'int[]' }],
    returnType: 'int[]',
    topics: ['arrays'],
    difficulty: 'medium',
    tests: [
      T([[1, 2, 3, 4]], [24, 12, 8, 6]),
      T([[-1, 1, 0, -3, 3]], [0, 0, 9, 0, 0]),
      T([[2, 2]], [2, 2]),
      T([[0, 0]], [0, 0], true),
      T([[1, 0]], [0, 1], true),
      T([[5]], [1], true),
    ],
    reference: {
      javascript: `function solve(nums) {
  const n = nums.length, out = new Array(n).fill(1);
  let left = 1;
  for (let i = 0; i < n; i++) { out[i] = left; left *= nums[i]; }
  let right = 1;
  for (let i = n - 1; i >= 0; i--) { out[i] *= right; right *= nums[i]; }
  return out;
}`,
      python: `def solve(nums):
    n = len(nums)
    out = [1] * n
    left = 1
    for i in range(n):
        out[i] = left
        left *= nums[i]
    right = 1
    for i in range(n - 1, -1, -1):
        out[i] *= right
        right *= nums[i]
    return out`,
      cpp: `vector<int> solve(vector<int> nums) {
    int n = nums.size();
    vector<int> out(n, 1);
    long long left = 1;
    for (int i = 0; i < n; i++) { out[i] = (int)left; left *= nums[i]; }
    long long right = 1;
    for (int i = n - 1; i >= 0; i--) { out[i] = (int)(out[i] * right); right *= nums[i]; }
    return out;
}`,
    },
    oracle: {
      language: 'javascript',
      note: 'O(n²) nested product — different algorithm, same answers.',
      code: `function solve(nums) {
  return nums.map((_, i) => nums.reduce((p, x, j) => (j === i ? p : p * x), 1));
}`,
    },
    wrong: {
      language: 'javascript',
      note: 'Uses division: breaks on zeroes and violates the no-division requirement.',
      code: `function solve(nums) {
  const total = nums.reduce((p, x) => p * x, 1);
  return nums.map((x) => total / x);
}`,
    },
    source: 'classic:product-except-self (own wording)',
  }),

  P({
    slug: 'rotate-array',
    title: 'Rotate Array',
    statement:
      'Given an integer array nums, rotate it to the right by k steps, where k is non-negative. ' +
      'Return the rotated array.',
    examples: [
      { input: 'nums = [1, 2, 3, 4, 5, 6, 7], k = 3', output: '[5, 6, 7, 1, 2, 3, 4]' },
      { input: 'nums = [-1, -100, 3, 99], k = 2', output: '[3, 99, -1, -100]' },
    ],
    constraints: ['1 <= nums.length <= 10^5', '0 <= k <= 10^9'],
    params: [
      { name: 'nums', type: 'int[]' },
      { name: 'k', type: 'int' },
    ],
    returnType: 'int[]',
    topics: ['arrays'],
    tests: [
      T([[1, 2, 3, 4, 5, 6, 7], 3], [5, 6, 7, 1, 2, 3, 4]),
      T([[-1, -100, 3, 99], 2], [3, 99, -1, -100]),
      T([[1, 2, 3], 0], [1, 2, 3]),
      T([[1, 2], 3], [2, 1], true),
      T([[1], 99], [1], true),
      T([[1, 2, 3, 4], 4], [1, 2, 3, 4], true),
    ],
    reference: {
      javascript: `function solve(nums, k) {
  const n = nums.length;
  k = ((k % n) + n) % n;
  const rev = (a, l, r) => { while (l < r) { const t = a[l]; a[l] = a[r]; a[r] = t; l++; r--; } };
  const a = [...nums];
  rev(a, 0, n - 1); rev(a, 0, k - 1); rev(a, k, n - 1);
  return a;
}`,
      python: `def solve(nums, k):
    n = len(nums)
    k %= n
    return nums[-k:] + nums[:-k] if k else list(nums)`,
      cpp: `vector<int> solve(vector<int> nums, int k) {
    int n = nums.size();
    k %= n;
    vector<int> out(n);
    for (int i = 0; i < n; i++) out[(i + k) % n] = nums[i];
    return out;
}`,
    },
    oracle: {
      language: 'javascript',
      note: 'Slice-based rotation — different implementation.',
      code: `function solve(nums, k) {
  const n = nums.length;
  k = ((k % n) + n) % n;
  return nums.slice(n - k).concat(nums.slice(0, n - k));
}`,
    },
    wrong: {
      language: 'javascript',
      note: 'Rotates LEFT instead of right.',
      code: `function solve(nums, k) {
  const n = nums.length;
  k = ((k % n) + n) % n;
  return nums.slice(k).concat(nums.slice(0, k));
}`,
    },
    source: 'classic:rotate-array (own wording)',
  }),

  P({
    slug: 'move-zeroes',
    title: 'Move Zeroes',
    statement:
      'Given an integer array nums, move all 0s to the end of it while maintaining the relative ' +
      'order of the non-zero elements. Return the resulting array.',
    examples: [{ input: 'nums = [0, 1, 0, 3, 12]', output: '[1, 3, 12, 0, 0]' }],
    constraints: ['1 <= nums.length <= 10^4'],
    params: [{ name: 'nums', type: 'int[]' }],
    returnType: 'int[]',
    topics: ['arrays', 'two-pointers'],
    tests: [
      T([[0, 1, 0, 3, 12]], [1, 3, 12, 0, 0]),
      T([[0]], [0]),
      T([[1, 2, 3]], [1, 2, 3]),
      T([[0, 0, 1]], [1, 0, 0], true),
      T([[4, 0, 5, 0, 0, 3]], [4, 5, 3, 0, 0, 0], true),
      T([[0, 0, 0, 1]], [1, 0, 0, 0], true),
    ],
    reference: {
      javascript: `function solve(nums) {
  const out = [];
  let zeros = 0;
  for (const x of nums) { if (x === 0) zeros++; else out.push(x); }
  while (zeros--) out.push(0);
  return out;
}`,
      python: `def solve(nums):
    out = [x for x in nums if x != 0]
    out += [0] * (len(nums) - len(out))
    return out`,
      cpp: `vector<int> solve(vector<int> nums) {
    vector<int> out;
    int zeros = 0;
    for (int x : nums) { if (x == 0) zeros++; else out.push_back(x); }
    while (zeros--) out.push_back(0);
    return out;
}`,
    },
    oracle: {
      language: 'javascript',
      note: 'Stable partition via filter/concat — different implementation.',
      code: `function solve(nums) {
  const nz = nums.filter((x) => x !== 0);
  return nz.concat(new Array(nums.length - nz.length).fill(0));
}`,
    },
    wrong: {
      language: 'javascript',
      note: 'Sorts the array: zeroes end up last but relative order is destroyed.',
      code: `function solve(nums) {
  return [...nums].sort((a, b) => a - b);
}`,
    },
    source: 'classic:move-zeroes (own wording)',
  }),

  P({
    slug: 'majority-element',
    title: 'Majority Element',
    statement:
      'Given an array nums of size n, return the majority element — the element that appears ' +
      'more than n / 2 times. You may assume the majority element always exists.',
    examples: [
      { input: 'nums = [3, 2, 3]', output: '3' },
      { input: 'nums = [2, 2, 1, 1, 1, 2, 2]', output: '2' },
    ],
    constraints: ['1 <= nums.length <= 5 * 10^4'],
    params: [{ name: 'nums', type: 'int[]' }],
    returnType: 'int',
    topics: ['arrays'],
    tests: [
      T([[3, 2, 3]], 3),
      T([[2, 2, 1, 1, 1, 2, 2]], 2),
      T([[1]], 1),
      T([[1, 2, 3, 2, 2]], 2, true),
      T([[6, 5, 5]], 5, true),
      T([[2, 2, 2, 3, 3]], 2, true),
    ],
    reference: {
      javascript: `function solve(nums) {
  let cand = nums[0], count = 0;
  for (const x of nums) {
    if (count === 0) cand = x;
    count += x === cand ? 1 : -1;
  }
  return cand;
}`,
      python: `def solve(nums):
    cand, count = nums[0], 0
    for x in nums:
        if count == 0:
            cand = x
        count += 1 if x == cand else -1
    return cand`,
      cpp: `int solve(vector<int> nums) {
    int cand = nums[0], count = 0;
    for (int x : nums) {
        if (count == 0) cand = x;
        count += (x == cand) ? 1 : -1;
    }
    return cand;
}`,
    },
    oracle: {
      language: 'javascript',
      note: 'Hash-map frequency count — different algorithm.',
      code: `function solve(nums) {
  const freq = new Map();
  for (const x of nums) freq.set(x, (freq.get(x) || 0) + 1);
  for (const [x, c] of freq) if (c > nums.length / 2) return x;
  return nums[0];
}`,
    },
    wrong: {
      language: 'javascript',
      note: 'Wrong algorithm: assumes the first element is the majority.',
      code: `function solve(nums) {
  return nums[0];
}`,
    },
    source: 'classic:majority-element (own wording)',
  }),

  P({
    slug: 'plus-one',
    title: 'Plus One',
    statement:
      'You are given a large integer represented as an integer array digits, where each digits[i] ' +
      'is the ith digit of the integer (most significant first). Increment the integer by one and ' +
      'return the resulting array of digits.',
    examples: [
      { input: 'digits = [1, 2, 3]', output: '[1, 2, 4]' },
      { input: 'digits = [9]', output: '[1, 0]' },
    ],
    constraints: ['1 <= digits.length <= 100', '0 <= digits[i] <= 9'],
    params: [{ name: 'digits', type: 'int[]' }],
    returnType: 'int[]',
    topics: ['arrays', 'math'],
    tests: [
      T([[1, 2, 3]], [1, 2, 4]),
      T([[4, 3, 2, 1]], [4, 3, 2, 2]),
      T([[9]], [1, 0]),
      T([[9, 9, 9]], [1, 0, 0, 0], true),
      T([[0]], [1], true),
      T([Array(18).fill(9)], [1, ...Array(18).fill(0)], true),
    ],
    reference: {
      javascript: `function solve(digits) {
  const a = [...digits];
  for (let i = a.length - 1; i >= 0; i--) {
    if (a[i] < 9) { a[i]++; return a; }
    a[i] = 0;
  }
  return [1, ...a];
}`,
      python: `def solve(digits):
    a = list(digits)
    for i in range(len(a) - 1, -1, -1):
        if a[i] < 9:
            a[i] += 1
            return a
        a[i] = 0
    return [1] + a`,
      cpp: `vector<int> solve(vector<int> digits) {
    for (int i = (int)digits.size() - 1; i >= 0; i--) {
        if (digits[i] < 9) { digits[i]++; return digits; }
        digits[i] = 0;
    }
    digits.insert(digits.begin(), 1);
    return digits;
}`,
    },
    oracle: {
      language: 'javascript',
      note: 'BigInt-based increment — different implementation.',
      code: `function solve(digits) {
  const s = (BigInt(digits.join('')) + 1n).toString();
  return s.split('').map(Number);
}`,
    },
    wrong: {
      language: 'javascript',
      note: 'Forgets to prepend 1 on all-9s overflow (returns [0,0,0] for [9,9,9]).',
      code: `function solve(digits) {
  const a = [...digits];
  for (let i = a.length - 1; i >= 0; i--) {
    if (a[i] < 9) { a[i]++; return a; }
    a[i] = 0;
  }
  return a;
}`,
    },
    source: 'classic:plus-one (own wording)',
  }),

  P({
    slug: 'running-sum',
    title: 'Running Sum of 1d Array',
    statement:
      'Given an array nums, return the running sum: result[i] is the sum of nums[0] through nums[i].',
    examples: [
      { input: 'nums = [1, 2, 3, 4]', output: '[1, 3, 6, 10]' },
      { input: 'nums = [1, 1, 1, 1, 1]', output: '[1, 2, 3, 4, 5]' },
    ],
    constraints: ['1 <= nums.length <= 1000'],
    params: [{ name: 'nums', type: 'int[]' }],
    returnType: 'int[]',
    topics: ['arrays'],
    tests: [
      T([[1, 2, 3, 4]], [1, 3, 6, 10]),
      T([[1, 1, 1, 1, 1]], [1, 2, 3, 4, 5]),
      T([[3, 1, 2, 10, 1]], [3, 4, 6, 16, 17]),
      T([[-1, 2, -3]], [-1, 1, -2], true),
      T([[7]], [7], true),
      T([[5, -2, 3]], [5, 3, 6], true),
    ],
    reference: {
      javascript: `function solve(nums) {
  const out = [];
  let s = 0;
  for (const x of nums) { s += x; out.push(s); }
  return out;
}`,
      python: `def solve(nums):
    out = []
    s = 0
    for x in nums:
        s += x
        out.append(s)
    return out`,
      cpp: `vector<int> solve(vector<int> nums) {
    vector<int> out;
    int s = 0;
    for (int x : nums) { s += x; out.push_back(s); }
    return out;
}`,
    },
    oracle: {
      language: 'javascript',
      note: 'Prefix sums via map over slice sums — different implementation.',
      code: `function solve(nums) {
  return nums.map((_, i) => nums.slice(0, i + 1).reduce((a, b) => a + b, 0));
}`,
    },
    wrong: {
      language: 'javascript',
      note: 'Off-by-one: each entry sums only the elements strictly before it.',
      code: `function solve(nums) {
  const out = [];
  for (let i = 0; i < nums.length; i++) {
    let s = 0;
    for (let j = 0; j < i; j++) s += nums[j];
    out.push(s);
  }
  return out;
}`,
    },
    source: 'classic:running-sum (own wording)',
  }),

  P({
    slug: 'merge-sorted-array',
    title: 'Merge Two Sorted Arrays',
    statement:
      'You are given two integer arrays a and b, each sorted in non-decreasing order. ' +
      'Return a single array containing all elements of both, sorted in non-decreasing order.',
    examples: [
      { input: 'a = [1, 2, 3], b = [2, 5, 6]', output: '[1, 2, 2, 3, 5, 6]' },
      { input: 'a = [1], b = []', output: '[1]' },
    ],
    constraints: ['0 <= a.length, b.length <= 500'],
    params: [
      { name: 'a', type: 'int[]' },
      { name: 'b', type: 'int[]' },
    ],
    returnType: 'int[]',
    topics: ['arrays', 'two-pointers'],
    tests: [
      T([[1, 2, 3], [2, 5, 6]], [1, 2, 2, 3, 5, 6]),
      T([[1], []], [1]),
      T([[], [1]], [1]),
      T([[-5, 0], [-3, -1]], [-5, -3, -1, 0], true),
      T([[2, 2, 2], [2]], [2, 2, 2, 2], true),
      T([[1, 3, 5], [2, 4, 6]], [1, 2, 3, 4, 5, 6], true),
    ],
    reference: {
      javascript: `function solve(a, b) {
  const out = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] <= b[j]) out.push(a[i++]);
    else out.push(b[j++]);
  }
  while (i < a.length) out.push(a[i++]);
  while (j < b.length) out.push(b[j++]);
  return out;
}`,
      python: `def solve(a, b):
    out = []
    i = j = 0
    while i < len(a) and j < len(b):
        if a[i] <= b[j]:
            out.append(a[i]); i += 1
        else:
            out.append(b[j]); j += 1
    out.extend(a[i:]); out.extend(b[j:])
    return out`,
      cpp: `vector<int> solve(vector<int> a, vector<int> b) {
    vector<int> out;
    size_t i = 0, j = 0;
    while (i < a.size() && j < b.size()) {
        if (a[i] <= b[j]) out.push_back(a[i++]);
        else out.push_back(b[j++]);
    }
    while (i < a.size()) out.push_back(a[i++]);
    while (j < b.size()) out.push_back(b[j++]);
    return out;
}`,
    },
    oracle: {
      language: 'javascript',
      note: 'Concatenate then sort — different algorithm.',
      code: `function solve(a, b) {
  return a.concat(b).sort((x, y) => x - y);
}`,
    },
    wrong: {
      language: 'javascript',
      note: 'Forgets the leftover elements once one array is exhausted.',
      code: `function solve(a, b) {
  const out = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] <= b[j]) out.push(a[i++]);
    else out.push(b[j++]);
  }
  return out;
}`,
    },
    source: 'classic:merge-sorted-array (own wording)',
  }),

  P({
    slug: 'remove-duplicates-sorted',
    title: 'Remove Duplicates from Sorted Array',
    statement:
      'Given an integer array nums sorted in non-decreasing order, return a new array with the ' +
      'duplicates removed, keeping one copy of each value in the original order.',
    examples: [
      { input: 'nums = [1, 1, 2]', output: '[1, 2]' },
      { input: 'nums = [0, 0, 1, 1, 1, 2, 2, 3, 3, 4]', output: '[0, 1, 2, 3, 4]' },
    ],
    constraints: ['1 <= nums.length <= 3 * 10^4'],
    params: [{ name: 'nums', type: 'int[]' }],
    returnType: 'int[]',
    topics: ['arrays', 'two-pointers'],
    tests: [
      T([[1, 1, 2]], [1, 2]),
      T([[0, 0, 1, 1, 1, 2, 2, 3, 3, 4]], [0, 1, 2, 3, 4]),
      T([[1, 2, 3]], [1, 2, 3]),
      T([[1, 1, 1]], [1], true),
      T([[-3, -3, -1, 0, 0]], [-3, -1, 0], true),
      T([[1, 1, 1, 1]], [1], true),
    ],
    reference: {
      javascript: `function solve(nums) {
  const out = [nums[0]];
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] !== nums[i - 1]) out.push(nums[i]);
  }
  return out;
}`,
      python: `def solve(nums):
    out = [nums[0]]
    for x in nums[1:]:
        if x != out[-1]:
            out.append(x)
    return out`,
      cpp: `vector<int> solve(vector<int> nums) {
    vector<int> out;
    out.push_back(nums[0]);
    for (size_t i = 1; i < nums.size(); i++)
        if (nums[i] != nums[i - 1]) out.push_back(nums[i]);
    return out;
}`,
    },
    oracle: {
      language: 'javascript',
      note: 'Set-based dedup preserving first-seen order — different implementation.',
      code: `function solve(nums) {
  return [...new Set(nums)];
}`,
    },
    wrong: {
      language: 'javascript',
      note: 'Misreads the task: drops every value that appears more than once, instead of collapsing runs.',
      code: `function solve(nums) {
  const freq = new Map();
  for (const x of nums) freq.set(x, (freq.get(x) || 0) + 1);
  return nums.filter((x) => freq.get(x) === 1);
}`,
    },
    source: 'classic:remove-duplicates-sorted (own wording)',
  }),

  P({
    slug: 'missing-number',
    title: 'Missing Number',
    statement:
      'Given an array nums containing n distinct numbers in the range [0, n], return the one ' +
      'number in the range that is missing from the array.',
    examples: [
      { input: 'nums = [3, 0, 1]', output: '2' },
      { input: 'nums = [0, 1]', output: '2' },
    ],
    constraints: ['1 <= nums.length <= 10^4'],
    params: [{ name: 'nums', type: 'int[]' }],
    returnType: 'int',
    topics: ['arrays', 'math'],
    tests: [
      T([[3, 0, 1]], 2),
      T([[0, 1]], 2),
      T([[9, 6, 4, 2, 3, 5, 7, 0, 1]], 8),
      T([[0]], 1, true),
      T([[1]], 0, true),
      T([[5, 4, 3, 2, 0]], 1, true),
    ],
    reference: {
      javascript: `function solve(nums) {
  const n = nums.length;
  const want = (n * (n + 1)) / 2;
  const have = nums.reduce((a, b) => a + b, 0);
  return want - have;
}`,
      python: `def solve(nums):
    n = len(nums)
    return n * (n + 1) // 2 - sum(nums)`,
      cpp: `int solve(vector<int> nums) {
    long long n = nums.size();
    long long want = n * (n + 1) / 2, have = 0;
    for (int x : nums) have += x;
    return (int)(want - have);
}`,
    },
    oracle: {
      language: 'javascript',
      note: 'Set lookup for the missing value — different algorithm.',
      code: `function solve(nums) {
  const s = new Set(nums);
  for (let i = 0; i <= nums.length; i++) if (!s.has(i)) return i;
  return -1;
}`,
    },
    wrong: {
      language: 'javascript',
      note: 'Wrong algorithm: assumes the missing number is always n.',
      code: `function solve(nums) {
  return nums.length;
}`,
    },
    source: 'classic:missing-number (own wording)',
  }),

  P({
    slug: 'squares-of-sorted-array',
    title: 'Squares of a Sorted Array',
    statement:
      'Given an integer array nums sorted in non-decreasing order, return an array of the squares ' +
      'of each number, also sorted in non-decreasing order.',
    examples: [
      { input: 'nums = [-4, -1, 0, 3, 10]', output: '[0, 1, 9, 16, 100]' },
      { input: 'nums = [-7, -3, 2, 3, 11]', output: '[4, 9, 9, 49, 121]' },
    ],
    constraints: ['1 <= nums.length <= 10^4'],
    params: [{ name: 'nums', type: 'int[]' }],
    returnType: 'int[]',
    topics: ['arrays', 'two-pointers'],
    tests: [
      T([[-4, -1, 0, 3, 10]], [0, 1, 9, 16, 100]),
      T([[-7, -3, 2, 3, 11]], [4, 9, 9, 49, 121]),
      T([[1, 2, 3]], [1, 4, 9]),
      T([[-5, -4, -3]], [9, 16, 25], true),
      T([[0]], [0], true),
      T([[-2, -1]], [1, 4], true),
    ],
    reference: {
      javascript: `function solve(nums) {
  const n = nums.length, out = new Array(n);
  let l = 0, r = n - 1;
  for (let i = n - 1; i >= 0; i--) {
    if (Math.abs(nums[l]) > Math.abs(nums[r])) { out[i] = nums[l] * nums[l]; l++; }
    else { out[i] = nums[r] * nums[r]; r--; }
  }
  return out;
}`,
      python: `def solve(nums):
    n = len(nums)
    out = [0] * n
    l, r = 0, n - 1
    for i in range(n - 1, -1, -1):
        if abs(nums[l]) > abs(nums[r]):
            out[i] = nums[l] * nums[l]
            l += 1
        else:
            out[i] = nums[r] * nums[r]
            r -= 1
    return out`,
      cpp: `vector<int> solve(vector<int> nums) {
    int n = nums.size();
    vector<int> out(n);
    int l = 0, r = n - 1;
    for (int i = n - 1; i >= 0; i--) {
        if (abs(nums[l]) > abs(nums[r])) { out[i] = nums[l] * nums[l]; l++; }
        else { out[i] = nums[r] * nums[r]; r--; }
    }
    return out;
}`,
    },
    oracle: {
      language: 'javascript',
      note: 'Square then sort — different algorithm.',
      code: `function solve(nums) {
  return nums.map((x) => x * x).sort((a, b) => a - b);
}`,
    },
    wrong: {
      language: 'javascript',
      note: 'Squares each element but forgets to sort the result.',
      code: `function solve(nums) {
  return nums.map((x) => x * x);
}`,
    },
    source: 'classic:squares-of-sorted-array (own wording)',
  }),
];
