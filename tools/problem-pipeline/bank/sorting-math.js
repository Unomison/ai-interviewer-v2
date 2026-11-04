/**
 * Milestone 6 — bank: sorting + math/recursion problems (11).
 * Own wording throughout; each entry validated by the pipeline.
 */
import { P, T } from './helpers.js';

export const SORTING_MATH = [
  P({
    slug: 'sort-colors',
    title: 'Sort Colors',
    statement:
      'Given an array nums with n objects colored red (0), white (1), or blue (2), sort them ' +
      'in-place so that objects of the same color are adjacent, in the order red, white, blue. ' +
      'Return the sorted array. (You may use O(1) extra space beyond the output.)',
    examples: [
      { input: 'nums = [2, 0, 2, 1, 1, 0]', output: '[0, 0, 1, 1, 2, 2]' },
      { input: 'nums = [2, 0, 1]', output: '[0, 1, 2]' },
    ],
    constraints: ['1 <= nums.length <= 300', 'nums[i] is 0, 1 or 2'],
    params: [{ name: 'nums', type: 'int[]' }],
    returnType: 'int[]',
    topics: ['arrays', 'sorting', 'two-pointers'],
    difficulty: 'medium',
    tests: [
      T([[2, 0, 2, 1, 1, 0]], [0, 0, 1, 1, 2, 2]),
      T([[2, 0, 1]], [0, 1, 2]),
      T([[0]], [0]),
      T([[1, 2, 0]], [0, 1, 2]),
      T([[2, 2, 1, 1]], [1, 1, 2, 2]),
      T([[1, 0]], [0, 1], true),
      T([[2, 1, 0]], [0, 1, 2], true),
      T([[0, 0, 0]], [0, 0, 0], true),
    ],
    reference: {
      javascript: `function solve(nums) {
  const a = [...nums];
  let lo = 0, mid = 0, hi = a.length - 1;
  while (mid <= hi) {
    if (a[mid] === 0) { const t = a[lo]; a[lo] = a[mid]; a[mid] = t; lo++; mid++; }
    else if (a[mid] === 1) mid++;
    else { const t = a[mid]; a[mid] = a[hi]; a[hi] = t; hi--; }
  }
  return a;
}`,
      python: `def solve(nums):
    a = list(nums)
    lo = mid = 0
    hi = len(a) - 1
    while mid <= hi:
        if a[mid] == 0:
            a[lo], a[mid] = a[mid], a[lo]
            lo += 1
            mid += 1
        elif a[mid] == 1:
            mid += 1
        else:
            a[mid], a[hi] = a[hi], a[mid]
            hi -= 1
    return a`,
      cpp: `vector<int> solve(vector<int> nums) {
    int lo = 0, mid = 0, hi = (int)nums.size() - 1;
    while (mid <= hi) {
        if (nums[mid] == 0) { swap(nums[lo], nums[mid]); lo++; mid++; }
        else if (nums[mid] == 1) mid++;
        else { swap(nums[mid], nums[hi]); hi--; }
    }
    return nums;
}`,
    },
    oracle: {
      language: 'javascript',
      note: 'Counting sort — different algorithm.',
      code: `function solve(nums) {
  let z = 0, o = 0;
  for (const x of nums) { if (x === 0) z++; else if (x === 1) o++; }
  return [...Array(z).fill(0), ...Array(o).fill(1), ...Array(nums.length - z - o).fill(2)];
}`,
    },
    wrong: {
      language: 'javascript',
      note: 'Only sweeps 0s to the front; 1s and 2s stay jumbled.',
      code: `function solve(nums) {
  const a = [...nums];
  let p = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 0) { const t = a[i]; a[i] = a[p]; a[p] = t; p++; }
  }
  return a;
}`,
    },
    source: 'classic:sort-colors (own wording)',
  }),

  P({
    slug: 'kth-largest-element',
    title: 'Kth Largest Element in an Array',
    statement:
      'Given an integer array nums and an integer k, return the kth largest element in the ' +
      'array. Note that it is the kth largest in sorted order, not the kth distinct element.',
    examples: [
      { input: 'nums = [3, 2, 1, 5, 6, 4], k = 2', output: '5' },
      { input: 'nums = [3, 2, 3, 1, 2, 4, 5, 5, 6], k = 4', output: '4' },
    ],
    constraints: ['1 <= k <= nums.length <= 10^5'],
    params: [
      { name: 'nums', type: 'int[]' },
      { name: 'k', type: 'int' },
    ],
    returnType: 'int',
    topics: ['arrays', 'sorting'],
    difficulty: 'medium',
    tests: [
      T([[3, 2, 1, 5, 6, 4], 2], 5),
      T([[3, 2, 3, 1, 2, 4, 5, 5, 6], 4], 4),
      T([[1], 1], 1),
      T([[2, 1], 2], 1, true),
      T([[5, 5, 5, 5], 3], 5, true),
      T([[7, 10, 4, 3, 20, 15], 3], 10, true),
    ],
    reference: {
      javascript: `function solve(nums, k) {
  return [...nums].sort((a, b) => b - a)[k - 1];
}`,
      python: `def solve(nums, k):
    return sorted(nums, reverse=True)[k - 1]`,
      cpp: `int solve(vector<int> nums, int k) {
    sort(nums.begin(), nums.end(), greater<int>());
    return nums[k - 1];
}`,
    },
    oracle: {
      language: 'javascript',
      note: 'Repeatedly extracts the current maximum k times — different algorithm.',
      code: `function solve(nums, k) {
  const a = [...nums];
  for (let i = 0; i < k; i++) {
    let mi = 0;
    for (let j = 1; j < a.length; j++) if (a[j] > a[mi]) mi = j;
    if (i === k - 1) return a[mi];
    a.splice(mi, 1);
  }
}`,
    },
    wrong: {
      language: 'javascript',
      note: 'Returns the kth SMALLEST instead of the kth largest.',
      code: `function solve(nums, k) {
  return [...nums].sort((a, b) => a - b)[k - 1];
}`,
    },
    source: 'classic:kth-largest-element (own wording)',
  }),

  P({
    slug: 'height-checker',
    title: 'Height Checker',
    statement:
      'A school lines students up in non-decreasing order of height, but the current order in ' +
      'array heights may be wrong. Return the number of positions where heights[i] differs from ' +
      'the correctly sorted order.',
    examples: [
      { input: 'heights = [1, 1, 4, 2, 1, 3]', output: '3' },
      { input: 'heights = [5, 1, 2, 3, 4]', output: '5' },
      { input: 'heights = [1, 2, 3, 4, 5]', output: '0' },
    ],
    constraints: ['1 <= heights.length <= 100'],
    params: [{ name: 'heights', type: 'int[]' }],
    returnType: 'int',
    topics: ['arrays', 'sorting'],
    tests: [
      T([[1, 1, 4, 2, 1, 3]], 3),
      T([[5, 1, 2, 3, 4]], 5),
      T([[1, 2, 3, 4, 5]], 0),
      T([[2, 1]], 2),
      T([[1]], 0, true),
      T([[3, 3, 3]], 0, true),
      T([[4, 3, 2, 1]], 4, true),
    ],
    reference: {
      javascript: `function solve(heights) {
  const sorted = [...heights].sort((a, b) => a - b);
  let c = 0;
  for (let i = 0; i < heights.length; i++) if (heights[i] !== sorted[i]) c++;
  return c;
}`,
      python: `def solve(heights):
    s = sorted(heights)
    return sum(1 for a, b in zip(heights, s) if a != b)`,
      cpp: `int solve(vector<int> heights) {
    vector<int> s = heights;
    sort(s.begin(), s.end());
    int c = 0;
    for (size_t i = 0; i < heights.size(); i++) if (heights[i] != s[i]) c++;
    return c;
}`,
    },
    oracle: {
      language: 'javascript',
      note: 'Insertion sort then compare — different sorting implementation.',
      code: `function solve(heights) {
  const a = [...heights];
  for (let i = 1; i < a.length; i++) {
    const key = a[i];
    let j = i - 1;
    while (j >= 0 && a[j] > key) { a[j + 1] = a[j]; j--; }
    a[j + 1] = key;
  }
  let c = 0;
  for (let i = 0; i < heights.length; i++) if (heights[i] !== a[i]) c++;
  return c;
}`,
    },
    wrong: {
      language: 'javascript',
      note: 'Counts only positions where the student is TALLER than expected, missing shorter ones.',
      code: `function solve(heights) {
  const sorted = [...heights].sort((a, b) => a - b);
  let c = 0;
  for (let i = 0; i < heights.length; i++) if (heights[i] > sorted[i]) c++;
  return c;
}`,
    },
    source: 'classic:height-checker (own wording)',
  }),

  P({
    slug: 'fibonacci',
    title: 'Fibonacci Number',
    statement:
      'The Fibonacci numbers are defined by F(0) = 0, F(1) = 1, and F(n) = F(n-1) + F(n-2) for ' +
      'n > 1. Given n, return F(n).',
    examples: [
      { input: 'n = 2', output: '1' },
      { input: 'n = 3', output: '2' },
      { input: 'n = 4', output: '3' },
    ],
    constraints: ['0 <= n <= 30'],
    params: [{ name: 'n', type: 'int' }],
    returnType: 'int',
    topics: ['math', 'recursion', 'dp'],
    tests: [
      T([2], 1),
      T([3], 2),
      T([4], 3),
      T([0], 0, true),
      T([1], 1, true),
      T([10], 55, true),
      T([20], 6765, true),
    ],
    reference: {
      javascript: `function solve(n) {
  if (n < 2) return n;
  let a = 0, b = 1;
  for (let i = 2; i <= n; i++) { const c = a + b; a = b; b = c; }
  return b;
}`,
      python: `def solve(n):
    if n < 2:
        return n
    a, b = 0, 1
    for _ in range(2, n + 1):
        a, b = b, a + b
    return b`,
      cpp: `int solve(int n) {
    if (n < 2) return n;
    int a = 0, b = 1;
    for (int i = 2; i <= n; i++) { int c = a + b; a = b; b = c; }
    return b;
}`,
    },
    oracle: {
      language: 'javascript',
      note: 'Naive recursion — different implementation.',
      code: `function solve(n) {
  if (n < 2) return n;
  return solve(n - 1) + solve(n - 2);
}`,
    },
    wrong: {
      language: 'javascript',
      note: 'Wrong base case: F(0) = 1 instead of 0.',
      code: `function solve(n) {
  if (n <= 1) return 1;
  let a = 1, b = 1;
  for (let i = 2; i <= n; i++) { const c = a + b; a = b; b = c; }
  return b;
}`,
    },
    source: 'classic:fibonacci (own wording)',
  }),

  P({
    slug: 'climbing-stairs',
    title: 'Climbing Stairs',
    statement:
      'You are climbing a staircase with n steps. Each time you can climb 1 or 2 steps. ' +
      'In how many distinct ways can you reach the top?',
    examples: [
      { input: 'n = 2', output: '2' },
      { input: 'n = 3', output: '3' },
    ],
    constraints: ['1 <= n <= 45'],
    params: [{ name: 'n', type: 'int' }],
    returnType: 'int',
    topics: ['math', 'dp'],
    tests: [
      T([2], 2),
      T([3], 3),
      T([1], 1),
      T([5], 8, true),
      T([20], 10946, true),
      T([10], 89, true),
    ],
    reference: {
      javascript: `function solve(n) {
  if (n <= 2) return n;
  let a = 1, b = 2;
  for (let i = 3; i <= n; i++) { const c = a + b; a = b; b = c; }
  return b;
}`,
      python: `def solve(n):
    if n <= 2:
        return n
    a, b = 1, 2
    for _ in range(3, n + 1):
        a, b = b, a + b
    return b`,
      cpp: `int solve(int n) {
    if (n <= 2) return n;
    int a = 1, b = 2;
    for (int i = 3; i <= n; i++) { int c = a + b; a = b; b = c; }
    return b;
}`,
    },
    oracle: {
      language: 'javascript',
      note: 'Naive recursion — different implementation.',
      code: `function solve(n) {
  if (n <= 2) return n;
  return solve(n - 1) + solve(n - 2);
}`,
    },
    wrong: {
      language: 'javascript',
      note: 'Wrong model: assumes 2 independent choices per step, giving 2^(n-1).',
      code: `function solve(n) {
  return Math.pow(2, n - 1);
}`,
    },
    source: 'classic:climbing-stairs (own wording)',
  }),

  P({
    slug: 'palindrome-number',
    title: 'Palindrome Number',
    statement:
      'Given an integer x, return true if x is a palindrome — it reads the same backward as ' +
      'forward — and false otherwise. Negative numbers are never palindromes.',
    examples: [
      { input: 'x = 121', output: 'true' },
      { input: 'x = -121', output: 'false' },
      { input: 'x = 10', output: 'false' },
    ],
    constraints: ['-2^31 <= x <= 2^31 - 1'],
    params: [{ name: 'x', type: 'int' }],
    returnType: 'bool',
    topics: ['math'],
    tests: [
      T([121], true),
      T([-121], false),
      T([10], false),
      T([0], true, true),
      T([12321], true, true),
      T([1000021], false, true),
    ],
    reference: {
      javascript: `function solve(x) {
  if (x < 0 || (x % 10 === 0 && x !== 0)) return false;
  let rev = 0;
  while (x > rev) { rev = rev * 10 + (x % 10); x = Math.floor(x / 10); }
  return x === rev || x === Math.floor(rev / 10);
}`,
      python: `def solve(x):
    if x < 0 or (x % 10 == 0 and x != 0):
        return False
    rev = 0
    while x > rev:
        rev = rev * 10 + x % 10
        x //= 10
    return x == rev or x == rev // 10`,
      cpp: `bool solve(int x) {
    if (x < 0 || (x % 10 == 0 && x != 0)) return false;
    long long rev = 0;
    while (x > rev) { rev = rev * 10 + x % 10; x /= 10; }
    return x == rev || x == rev / 10;
}`,
    },
    oracle: {
      language: 'javascript',
      note: 'String reversal — different implementation.',
      code: `function solve(x) {
  if (x < 0) return false;
  const s = String(x);
  return s === [...s].reverse().join('');
}`,
    },
    wrong: {
      language: 'javascript',
      note: 'Compares a string to a number with ===: always false.',
      code: `function solve(x) {
  if (x < 0) return false;
  return String(x).split('').reverse().join('') === x;
}`,
    },
    source: 'classic:palindrome-number (own wording)',
  }),

  P({
    slug: 'reverse-integer',
    title: 'Reverse Integer',
    statement:
      'Given a signed 32-bit integer x, return x with its digits reversed. If reversing causes ' +
      'the value to go outside the signed 32-bit range [-2^31, 2^31 - 1], return 0 instead.',
    examples: [
      { input: 'x = 123', output: '321' },
      { input: 'x = -123', output: '-321' },
      { input: 'x = 120', output: '21' },
    ],
    constraints: ['-2^31 <= x <= 2^31 - 1'],
    params: [{ name: 'x', type: 'int' }],
    returnType: 'int',
    topics: ['math'],
    tests: [
      T([123], 321),
      T([-123], -321),
      T([120], 21),
      T([1534236469], 0, true),
      T([0], 0, true),
      T([-2147483648], 0, true),
    ],
    reference: {
      javascript: `function solve(x) {
  const LIM = 2 ** 31;
  let r = 0, n = x;
  while (n !== 0) {
    r = r * 10 + (n % 10);
    n = Math.trunc(n / 10);
  }
  return r >= LIM || r < -LIM ? 0 : r;
}`,
      python: `def solve(x):
    LIM = 2 ** 31
    r, n = 0, abs(x)
    while n:
        r = r * 10 + n % 10
        n //= 10
    r = -r if x < 0 else r
    return 0 if r >= LIM or r < -LIM else r`,
      cpp: `int solve(int x) {
    long long r = 0;
    while (x != 0) { r = r * 10 + x % 10; x /= 10; }
    if (r > INT_MAX || r < INT_MIN) return 0;
    return (int)r;
}`,
    },
    oracle: {
      language: 'javascript',
      note: 'String-based reversal with explicit bounds check — different implementation.',
      code: `function solve(x) {
  const LIM = 2 ** 31;
  const neg = x < 0;
  const r = Number(String(Math.abs(x)).split('').reverse().join(''));
  const v = neg ? -r : r;
  return v >= LIM || v < -LIM ? 0 : v;
}`,
    },
    wrong: {
      language: 'javascript',
      note: 'No overflow check: 1534236469 reverses to 9646324351 instead of 0.',
      code: `function solve(x) {
  const neg = x < 0;
  const r = Number(String(Math.abs(x)).split('').reverse().join(''));
  return neg ? -r : r;
}`,
    },
    source: 'classic:reverse-integer (own wording)',
  }),

  P({
    slug: 'fizz-buzz',
    title: 'Fizz Buzz',
    statement:
      'Given an integer n, return an array of strings answer[1..n] where: answer[i] is "FizzBuzz" ' +
      'if i is divisible by 3 and 5, "Fizz" if divisible by 3, "Buzz" if divisible by 5, and the ' +
      'decimal string of i otherwise.',
    examples: [
      { input: 'n = 3', output: '["1", "2", "Fizz"]' },
      { input: 'n = 5', output: '["1", "2", "Fizz", "4", "Buzz"]' },
      { input: 'n = 15', output: '["1", "2", "Fizz", "4", "Buzz", "Fizz", "7", "8", "Fizz", "Buzz", "11", "Fizz", "13", "14", "FizzBuzz"]' },
    ],
    constraints: ['1 <= n <= 10^4'],
    params: [{ name: 'n', type: 'int' }],
    returnType: 'string[]',
    topics: ['math', 'strings'],
    tests: [
      T([3], ['1', '2', 'Fizz']),
      T([5], ['1', '2', 'Fizz', '4', 'Buzz']),
      T([15], ['1', '2', 'Fizz', '4', 'Buzz', 'Fizz', '7', '8', 'Fizz', 'Buzz', '11', 'Fizz', '13', '14', 'FizzBuzz']),
      T([1], ['1'], true),
      T([2], ['1', '2'], true),
      T([6], ['1', '2', 'Fizz', '4', 'Buzz', 'Fizz'], true),
    ],
    reference: {
      javascript: `function solve(n) {
  const out = [];
  for (let i = 1; i <= n; i++) {
    if (i % 15 === 0) out.push('FizzBuzz');
    else if (i % 3 === 0) out.push('Fizz');
    else if (i % 5 === 0) out.push('Buzz');
    else out.push(String(i));
  }
  return out;
}`,
      python: `def solve(n):
    out = []
    for i in range(1, n + 1):
        if i % 15 == 0:
            out.append('FizzBuzz')
        elif i % 3 == 0:
            out.append('Fizz')
        elif i % 5 == 0:
            out.append('Buzz')
        else:
            out.append(str(i))
    return out`,
      cpp: `vector<string> solve(int n) {
    vector<string> out;
    for (int i = 1; i <= n; i++) {
        if (i % 15 == 0) out.push_back("FizzBuzz");
        else if (i % 3 == 0) out.push_back("Fizz");
        else if (i % 5 == 0) out.push_back("Buzz");
        else out.push_back(to_string(i));
    }
    return out;
}`,
    },
    oracle: {
      language: 'javascript',
      note: 'Rule-table driven — different implementation.',
      code: `function solve(n) {
  const rules = [[15, 'FizzBuzz'], [3, 'Fizz'], [5, 'Buzz']];
  const out = [];
  for (let i = 1; i <= n; i++) {
    let s = String(i);
    for (const [d, w] of rules) {
      if (i % d === 0) { s = w; break; }
    }
    out.push(s);
  }
  return out;
}`,
    },
    wrong: {
      language: 'javascript',
      note: 'Checks divisibility by 3 before 15: multiples of 15 print "Fizz".',
      code: `function solve(n) {
  const out = [];
  for (let i = 1; i <= n; i++) {
    if (i % 3 === 0) out.push('Fizz');
    else if (i % 5 === 0) out.push('Buzz');
    else out.push(String(i));
  }
  return out;
}`,
    },
    source: 'classic:fizz-buzz (own wording)',
  }),

  P({
    slug: 'single-number',
    title: 'Single Number',
    statement:
      'Given a non-empty array of integers nums, every element appears twice except for one. ' +
      'Find that single one. Solve it in linear time and constant extra space.',
    examples: [
      { input: 'nums = [2, 2, 1]', output: '1' },
      { input: 'nums = [4, 1, 2, 1, 2]', output: '4' },
    ],
    constraints: ['1 <= nums.length <= 3 * 10^4'],
    params: [{ name: 'nums', type: 'int[]' }],
    returnType: 'int',
    topics: ['arrays', 'math'],
    tests: [
      T([[2, 2, 1]], 1),
      T([[4, 1, 2, 1, 2]], 4),
      T([[1]], 1),
      T([[7, 3, 5, 3, 7]], 5),
      T([[-1, -1, -2]], -2, true),
      T([[9, 9, 8]], 8, true),
      T([[0, 1, 0]], 1, true),
    ],
    reference: {
      javascript: `function solve(nums) {
  let x = 0;
  for (const v of nums) x ^= v;
  return x;
}`,
      python: `def solve(nums):
    x = 0
    for v in nums:
        x ^= v
    return x`,
      cpp: `int solve(vector<int> nums) {
    int x = 0;
    for (int v : nums) x ^= v;
    return x;
}`,
    },
    oracle: {
      language: 'javascript',
      note: 'Sort then scan pairs — different algorithm.',
      code: `function solve(nums) {
  const a = [...nums].sort((x, y) => x - y);
  for (let i = 0; i < a.length; i += 2) {
    if (a[i] !== a[i + 1]) return a[i];
  }
  return a[a.length - 1];
}`,
    },
    wrong: {
      language: 'javascript',
      note: 'XOR loop skips the last element.',
      code: `function solve(nums) {
  let x = 0;
  for (let i = 0; i < nums.length - 1; i++) x ^= nums[i];
  return x;
}`,
    },
    source: 'classic:single-number (own wording)',
  }),

  P({
    slug: 'power-of-two',
    title: 'Power of Two',
    statement:
      'Given an integer n, return true if it is a power of two — that is, there exists an integer ' +
      'x with n == 2^x — and false otherwise.',
    examples: [
      { input: 'n = 1', output: 'true' },
      { input: 'n = 16', output: 'true' },
      { input: 'n = 3', output: 'false' },
    ],
    constraints: ['-2^31 <= n <= 2^31 - 1'],
    params: [{ name: 'n', type: 'int' }],
    returnType: 'bool',
    topics: ['math'],
    tests: [
      T([1], true),
      T([16], true),
      T([3], false),
      T([6], false, true),
      T([0], false, true),
      T([-16], false, true),
      T([1073741824], true, true),
    ],
    reference: {
      javascript: `function solve(n) {
  return n > 0 && (n & (n - 1)) === 0;
}`,
      python: `def solve(n):
    return n > 0 and (n & (n - 1)) == 0`,
      cpp: `bool solve(int n) {
    return n > 0 && (n & (n - 1)) == 0;
}`,
    },
    oracle: {
      language: 'javascript',
      note: 'Repeated halving — different implementation.',
      code: `function solve(n) {
  if (n <= 0) return false;
  while (n % 2 === 0) n /= 2;
  return n === 1;
}`,
    },
    wrong: {
      language: 'javascript',
      note: 'Only checks evenness: 6 passes but is not a power of two.',
      code: `function solve(n) {
  return n > 0 && n % 2 === 0;
}`,
    },
    source: 'classic:power-of-two (own wording)',
  }),

  P({
    slug: 'counting-bits',
    title: 'Counting Bits',
    statement:
      'Given an integer n, return an array ans of length n + 1 where ans[i] is the number of 1 ' +
      'bits in the binary representation of i.',
    examples: [
      { input: 'n = 2', output: '[0, 1, 1]' },
      { input: 'n = 5', output: '[0, 1, 1, 2, 1, 2]' },
    ],
    constraints: ['0 <= n <= 10^5'],
    params: [{ name: 'n', type: 'int' }],
    returnType: 'int[]',
    topics: ['math', 'dp'],
    tests: [
      T([2], [0, 1, 1]),
      T([5], [0, 1, 1, 2, 1, 2]),
      T([3], [0, 1, 1, 2]),
      T([0], [0], true),
      T([1], [0, 1], true),
      T([8], [0, 1, 1, 2, 1, 2, 2, 3, 1], true),
    ],
    reference: {
      javascript: `function solve(n) {
  const ans = new Array(n + 1).fill(0);
  for (let i = 1; i <= n; i++) ans[i] = ans[i >> 1] + (i & 1);
  return ans;
}`,
      python: `def solve(n):
    ans = [0] * (n + 1)
    for i in range(1, n + 1):
        ans[i] = ans[i >> 1] + (i & 1)
    return ans`,
      cpp: `vector<int> solve(int n) {
    vector<int> ans(n + 1, 0);
    for (int i = 1; i <= n; i++) ans[i] = ans[i >> 1] + (i & 1);
    return ans;
}`,
    },
    oracle: {
      language: 'javascript',
      note: 'Counts via string split — different implementation.',
      code: `function solve(n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    out.push(i.toString(2).split('').filter((c) => c === '1').length);
  }
  return out;
}`,
    },
    wrong: {
      language: 'javascript',
      note: 'Counts BITS IN THE LENGTH (bit-length) instead of set bits.',
      code: `function solve(n) {
  const out = [];
  for (let i = 0; i <= n; i++) out.push(i.toString(2).length);
  return out;
}`,
    },
    source: 'classic:counting-bits (own wording)',
  }),
];
