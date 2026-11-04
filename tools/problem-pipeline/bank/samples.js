/**
 * Milestone 6 — the 4 original playground problems as canonical bank entries.
 * Specs (statement/examples/constraints/params/tests/starters/hints) are
 * preserved verbatim from apps/web/src/runner/problems.js; the pipeline
 * adds reference/oracle/wrong solutions for validation. The playground's
 * problems.generated.js is emitted FROM these entries (single source of
 * truth; see the sync test).
 */
import { P, T } from './helpers.js';

const twoSum = P({
  slug: 'two-sum',
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
  params: [
    { name: 'nums', type: 'int[]' },
    { name: 'target', type: 'int' },
  ],
  returnType: 'int[]',
  comparison: 'unordered',
  topics: ['arrays', 'hash-map'],
  difficulty: 'easy',
  tests: [
    T([[2, 7, 11, 15], 9], [0, 1]),
    T([[3, 2, 4], 6], [1, 2]),
    T([[3, 3], 6], [0, 1]),
    T([[-1, -2, -3, -4, -5], -8], [2, 4], true),
    T([[0, 4, 3, 0], 0], [0, 3], true),
    T([[2147483647, -2147483648, 0], -1], [0, 1], true),
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
  reference: {
    javascript: `function solve(nums, target) {
  const seen = new Map();
  for (let i = 0; i < nums.length; i++) {
    const need = target - nums[i];
    if (seen.has(need)) return [seen.get(need), i];
    seen.set(nums[i], i);
  }
  return [];
}`,
    python: `def solve(nums, target):
    seen = {}
    for i, x in enumerate(nums):
        need = target - x
        if need in seen:
            return [seen[need], i]
        seen[x] = i
    return []`,
    cpp: `vector<int> solve(vector<int> nums, int target) {
    unordered_map<int, int> seen;
    for (int i = 0; i < (int)nums.size(); i++) {
        int need = target - nums[i];
        auto it = seen.find(need);
        if (it != seen.end()) return {it->second, i};
        seen[nums[i]] = i;
    }
    return {};
}`,
  },
  oracle: {
    language: 'javascript',
    note: 'Brute-force O(n²) double loop — different algorithm, same answers.',
    code: `function solve(nums, target) {
  for (let i = 0; i < nums.length; i++) {
    for (let j = i + 1; j < nums.length; j++) {
      if (nums[i] + nums[j] === target) return [i, j];
    }
  }
  return [];
}`,
  },
  wrong: {
    language: 'javascript',
    note: 'Inner loop starts at i instead of i+1, reusing the same element.',
    code: `function solve(nums, target) {
  for (let i = 0; i < nums.length; i++) {
    for (let j = i; j < nums.length; j++) {
      if (nums[i] + nums[j] === target) return [i, j];
    }
  }
  return [];
}`,
  },
  source: 'classic:two-sum (own wording)',
});

const validParentheses = P({
  slug: 'valid-parentheses',
  title: 'Valid Parentheses',
  statement:
    'Given a string s containing just the characters \'(\', \')\', \'{\', \'}\', ' +
    '\'[\' and \']\', determine if the input string is valid. A string is valid ' +
    'if open brackets are closed by the same type of bracket, and in the correct order.',
  constraints: ['1 <= s.length <= 10^4', 's consists of parentheses only.'],
  examples: [
    { input: 's = "()"', output: 'true' },
    { input: 's = "()[]{}"', output: 'true' },
    { input: 's = "(]"', output: 'false' },
  ],
  params: [{ name: 's', type: 'string' }],
  returnType: 'bool',
  topics: ['strings', 'stack'],
  difficulty: 'easy',
  tests: [
    T(['()'], true),
    T(['()[]{}'], true),
    T(['(]'], false),
    T(['([)]'], false, true),
    T(['{[]}'], true, true),
    T(['((()))'], true, true),
    T(['(()'], false, true),
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
  reference: {
    javascript: `function solve(s) {
  const stack = [];
  const match = { ')': '(', ']': '[', '}': '{' };
  for (const ch of s) {
    if (ch === '(' || ch === '[' || ch === '{') stack.push(ch);
    else if (stack.pop() !== match[ch]) return false;
  }
  return stack.length === 0;
}`,
    python: `def solve(s):
    stack = []
    match = {')': '(', ']': '[', '}': '{'}
    for ch in s:
        if ch in '([{':
            stack.append(ch)
        elif not stack or stack.pop() != match[ch]:
            return False
    return not stack`,
    cpp: `bool solve(string s) {
    vector<char> st;
    for (char ch : s) {
        if (ch == '(' || ch == '[' || ch == '{') st.push_back(ch);
        else {
            if (st.empty()) return false;
            char top = st.back(); st.pop_back();
            if ((ch == ')' && top != '(') || (ch == ']' && top != '[') || (ch == '}' && top != '{'))
                return false;
        }
    }
    return st.empty();
}`,
  },
  oracle: {
    language: 'javascript',
    note: 'Repeatedly deletes adjacent matching pairs — different algorithm.',
    code: `function solve(s) {
  let prev = null;
  while (prev !== s) {
    prev = s;
    s = s.replace(/\\(\\)|\\{\\}|\\[\\]/g, '');
  }
  return s.length === 0;
}`,
  },
  wrong: {
    language: 'javascript',
    note: 'Only counts each bracket type; ignores nesting order.',
    code: `function solve(s) {
  const count = (ch) => s.split(ch).length - 1;
  return count('(') === count(')') && count('{') === count('}') && count('[') === count(']');
}`,
  },
  source: 'classic:valid-parentheses (own wording)',
});

const reverseString = P({
  slug: 'reverse-string',
  title: 'Reverse String',
  statement:
    'Write a function that reverses a string. The input string is given as an ' +
    'array of characters. Do this by modifying the input array in-place is ' +
    'optional here — simply return the reversed string.',
  constraints: ['1 <= s.length <= 10^5', 's consists of printable ASCII characters.'],
  examples: [{ input: 's = "hello"', output: '"olleh"' }],
  params: [{ name: 's', type: 'string' }],
  returnType: 'string',
  topics: ['strings', 'two-pointers'],
  difficulty: 'easy',
  tests: [
    T(['hello'], 'olleh'),
    T(['a'], 'a'),
    T(['racecar'], 'racecar'),
    T(['Interview'], 'weivretnI', true),
    T(['12345'], '54321', true),
    T(['Hello, World!'], '!dlroW ,olleH', true),
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
  reference: {
    javascript: `function solve(s) {
  return s.split('').reverse().join('');
}`,
    python: `def solve(s):
    return s[::-1]`,
    cpp: `string solve(string s) {
    reverse(s.begin(), s.end());
    return s;
}`,
  },
  oracle: {
    language: 'javascript',
    note: 'Manual backward loop — different implementation.',
    code: `function solve(s) {
  let out = '';
  for (let i = s.length - 1; i >= 0; i--) out += s[i];
  return out;
}`,
  },
  wrong: {
    language: 'javascript',
    note: 'Off-by-one: drops the last character of the reversed string.',
    code: `function solve(s) {
  return s.split('').reverse().slice(0, -1).join('');
}`,
  },
  source: 'classic:reverse-string (own wording)',
});

const containsDuplicate = P({
  slug: 'contains-duplicate',
  title: 'Contains Duplicate',
  statement:
    'Given an integer array nums, return true if any value appears at least ' +
    'twice in the array, and false if every element is distinct.',
  constraints: ['1 <= nums.length <= 10^5', '-10^9 <= nums[i] <= 10^9'],
  examples: [
    { input: 'nums = [1, 2, 3, 1]', output: 'true' },
    { input: 'nums = [1, 2, 3, 4]', output: 'false' },
  ],
  params: [{ name: 'nums', type: 'int[]' }],
  returnType: 'bool',
  topics: ['arrays', 'hash-map'],
  difficulty: 'easy',
  tests: [
    T([[1, 2, 3, 1]], true),
    T([[1, 2, 3, 4]], false),
    T([[1, 2, 3, 4, 5, 1]], true),
    T([[1, 1, 1, 3, 3, 4, 3, 2, 4, 2]], true, true),
    T([[-5, 0, 5]], false, true),
    T([[0]], false, true),
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
  reference: {
    javascript: `function solve(nums) {
  return new Set(nums).size !== nums.length;
}`,
    python: `def solve(nums):
    return len(set(nums)) != len(nums)`,
    cpp: `bool solve(vector<int> nums) {
    unordered_set<int> seen;
    for (int x : nums) {
        if (seen.count(x)) return true;
        seen.insert(x);
    }
    return false;
}`,
  },
  oracle: {
    language: 'javascript',
    note: 'Sort then compare neighbours — different algorithm.',
    code: `function solve(nums) {
  const a = [...nums].sort((x, y) => x - y);
  for (let i = 0; i + 1 < a.length; i++) {
    if (a[i] === a[i + 1]) return true;
  }
  return false;
}`,
  },
  wrong: {
    language: 'javascript',
    note: 'Only compares adjacent elements without sorting first.',
    code: `function solve(nums) {
  for (let i = 0; i + 1 < nums.length; i++) {
    if (nums[i] === nums[i + 1]) return true;
  }
  return false;
}`,
  },
  source: 'classic:contains-duplicate (own wording)',
});

export const SAMPLES = [twoSum, validParentheses, reverseString, containsDuplicate];
