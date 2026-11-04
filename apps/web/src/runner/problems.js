/**
 * Milestone 4 — sample problem specs for the in-browser runner.
 *
 * Language-agnostic problem format (spec §4.8): each problem declares its
 * function signature, parameter/return types, comparison mode, and tests as
 * JSON {args, expected}. The JavaScript and Python runners call the
 * candidate's `solve(...)` directly; the C++ runner (M5) compiles a generated
 * harness that calls the candidate's `solve(...)` — so all languages run
 * identical tests. M6's offline problem pipeline will reuse this exact format.
 *
 * v1 types: int, float, bool, string, and 1D/2D arrays of those.
 * Comparison modes: 'exact' | 'float' (tolerance) | 'unordered' (arrays).
 *
 * Convention: `hidden: true` tests never have their inputs shown in the UI —
 * only the first failing *visible* test reveals input/expected/got.
 */

export const LANGUAGES = ['javascript', 'python', 'cpp'];

export const PROBLEMS = [
  {
    id: 'two-sum',
    title: 'Two Sum',
    statement:
      'Given an array of integers nums and an integer target, return the indices ' +
      'of the two numbers that add up to target. Each input has exactly one ' +
      'solution, and you may not use the same element twice.',
    constraints: [
      '2 <= nums.length <= 10^4',
      '-10^9 <= nums[i] <= 10^9',
      'Exactly one valid answer exists.',
    ],
    examples: [
      { input: 'nums = [2, 7, 11, 15], target = 9', output: '[0, 1]' },
      { input: 'nums = [3, 2, 4], target = 6', output: '[1, 2]' },
    ],
    functionName: 'solve',
    params: [
      { name: 'nums', type: 'int[]' },
      { name: 'target', type: 'int' },
    ],
    returnType: 'int[]',
    comparison: 'unordered',
    timeLimitMs: 2000,
    tests: [
      { args: [[2, 7, 11, 15], 9], expected: [0, 1], hidden: false },
      { args: [[3, 2, 4], 6], expected: [1, 2], hidden: false },
      { args: [[3, 3], 6], expected: [0, 1], hidden: false },
      { args: [[-1, -2, -3, -4, -5], -8], expected: [2, 4], hidden: true },
      { args: [[0, 4, 3, 0], 0], expected: [0, 3], hidden: true },
      { args: [[2147483647, -2147483648, 0], -1], expected: [0, 1], hidden: true },
    ],
    starter: {
      javascript:
        '/**\n * @param {number[]} nums\n * @param {number} target\n * @return {number[]}\n */\nfunction solve(nums, target) {\n  // your code here\n}\n',
      python:
        'def solve(nums, target):\n    """\n    nums: list[int], target: int -> list[int]\n    """\n    # your code here\n    pass\n',
      cpp:
        '#include <bits/stdc++.h>\n\nstd::vector<int> solve(std::vector<int> nums, int target) {\n    // your code here\n    return {};\n}\n',
    },
    hints: [
      'A brute-force double loop checks every pair — O(n²). Can you do better?',
      'As you scan the array, what would you need to have remembered to finish in one pass?',
    ],
  },
  {
    id: 'valid-parentheses',
    title: 'Valid Parentheses',
    statement:
      'Given a string s containing just the characters \'(\', \')\', \'{\', \'}\', ' +
      '\'[\' and \']\', determine if the input string is valid. A string is valid ' +
      'if open brackets are closed by the same type of bracket, and in the correct order.',
    constraints: [
      '1 <= s.length <= 10^4',
      's consists of parentheses only.',
    ],
    examples: [
      { input: 's = "()"', output: 'true' },
      { input: 's = "()[]{}"', output: 'true' },
      { input: 's = "(]"', output: 'false' },
    ],
    functionName: 'solve',
    params: [{ name: 's', type: 'string' }],
    returnType: 'bool',
    comparison: 'exact',
    timeLimitMs: 2000,
    tests: [
      { args: ['()'], expected: true, hidden: false },
      { args: ['()[]{}'], expected: true, hidden: false },
      { args: ['(]'], expected: false, hidden: false },
      { args: ['([)]'], expected: false, hidden: true },
      { args: ['{[]}'], expected: true, hidden: true },
      { args: ['((()))'], expected: true, hidden: true },
      { args: ['(()'], expected: false, hidden: true },
    ],
    starter: {
      javascript:
        '/**\n * @param {string} s\n * @return {boolean}\n */\nfunction solve(s) {\n  // your code here\n}\n',
      python:
        'def solve(s):\n    """\n    s: str -> bool\n    """\n    # your code here\n    pass\n',
      cpp:
        '#include <bits/stdc++.h>\n\nbool solve(std::string s) {\n    // your code here\n    return false;\n}\n',
    },
    hints: [
      'Which data structure naturally models "most recently opened, first closed"?',
      'Push opening brackets; on a closing bracket, check the top of the structure.',
    ],
  },
  {
    id: 'reverse-string',
    title: 'Reverse String',
    statement:
      'Write a function that reverses a string. The input string is given as an ' +
      'array of characters. Do this by modifying the input array in-place is ' +
      'optional here — simply return the reversed string.',
    constraints: ['1 <= s.length <= 10^5', 's consists of printable ASCII characters.'],
    examples: [{ input: 's = "hello"', output: '"olleh"' }],
    functionName: 'solve',
    params: [{ name: 's', type: 'string' }],
    returnType: 'string',
    comparison: 'exact',
    timeLimitMs: 2000,
    tests: [
      { args: ['hello'], expected: 'olleh', hidden: false },
      { args: ['a'], expected: 'a', hidden: false },
      { args: ['Interview'], expected: 'weivretnI', hidden: true },
      { args: ['12345'], expected: '54321', hidden: true },
    ],
    starter: {
      javascript:
        '/**\n * @param {string} s\n * @return {string}\n */\nfunction solve(s) {\n  // your code here\n}\n',
      python:
        'def solve(s):\n    """\n    s: str -> str\n    """\n    # your code here\n    pass\n',
      cpp:
        '#include <bits/stdc++.h>\n\nstd::string solve(std::string s) {\n    // your code here\n    return "";\n}\n',
    },
    hints: ['Two pointers from both ends work in O(1) extra space.'],
  },
  {
    id: 'contains-duplicate',
    title: 'Contains Duplicate',
    statement:
      'Given an integer array nums, return true if any value appears at least ' +
      'twice in the array, and false if every element is distinct.',
    constraints: [
      '1 <= nums.length <= 10^5',
      '-10^9 <= nums[i] <= 10^9',
    ],
    examples: [
      { input: 'nums = [1, 2, 3, 1]', output: 'true' },
      { input: 'nums = [1, 2, 3, 4]', output: 'false' },
    ],
    functionName: 'solve',
    params: [{ name: 'nums', type: 'int[]' }],
    returnType: 'bool',
    comparison: 'exact',
    timeLimitMs: 2000,
    tests: [
      { args: [[1, 2, 3, 1]], expected: true, hidden: false },
      { args: [[1, 2, 3, 4]], expected: false, hidden: false },
      { args: [[1, 1, 1, 3, 3, 4, 3, 2, 4, 2]], expected: true, hidden: true },
      { args: [[-5, 0, 5]], expected: false, hidden: true },
      { args: [[0]], expected: false, hidden: true },
    ],
    starter: {
      javascript:
        '/**\n * @param {number[]} nums\n * @return {boolean}\n */\nfunction solve(nums) {\n  // your code here\n}\n',
      python:
        'def solve(nums):\n    """\n    nums: list[int] -> bool\n    """\n    # your code here\n    pass\n',
      cpp:
        '#include <bits/stdc++.h>\n\nbool solve(std::vector<int> nums) {\n    // your code here\n    return false;\n}\n',
    },
    hints: [
      'Sorting first makes duplicates adjacent — O(n log n).',
      'A hash set gives O(n): have you seen this value before?',
    ],
  },
];

export function getProblem(id) {
  return PROBLEMS.find((p) => p.id === id) || null;
}
