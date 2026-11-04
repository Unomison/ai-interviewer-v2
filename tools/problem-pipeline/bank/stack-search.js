/**
 * Milestone 6 — bank: stack + binary-search problems (7).
 * Own wording throughout; each entry validated by the pipeline.
 */
import { P, T } from './helpers.js';

export const STACK_SEARCH = [
  P({
    slug: 'baseball-game',
    title: 'Baseball Game',
    statement:
      'You are keeping score for a baseball game with a list of operations ops. Start with an ' +
      'empty score list. For each op: an integer x means record a new score x; "C" removes the ' +
      'previous score; "D" records double the previous score; "+" records the sum of the ' +
      'previous two scores. Return the sum of all recorded scores.',
    examples: [
      { input: 'ops = ["5", "2", "C", "D", "+"]', output: '30' },
      { input: 'ops = ["5", "-2", "4", "C", "D", "9", "+", "+"]', output: '27' },
    ],
    constraints: ['1 <= ops.length <= 1000'],
    params: [{ name: 'ops', type: 'string[]' }],
    returnType: 'int',
    topics: ['arrays', 'stack'],
    tests: [
      T([['5', '2', 'C', 'D', '+']], 30),
      T([['5', '-2', '4', 'C', 'D', '9', '+', '+']], 27),
      T([['1']], 1),
      T([['1', '2', '+']], 6, true),
      T([['3', 'C']], 0, true),
      T([['10', '20', '+']], 60, true),
    ],
    reference: {
      javascript: `function solve(ops) {
  const st = [];
  for (const op of ops) {
    if (op === 'C') st.pop();
    else if (op === 'D') st.push(2 * st[st.length - 1]);
    else if (op === '+') st.push(st[st.length - 1] + st[st.length - 2]);
    else st.push(Number(op));
  }
  return st.reduce((a, b) => a + b, 0);
}`,
      python: `def solve(ops):
    st = []
    for op in ops:
        if op == 'C':
            st.pop()
        elif op == 'D':
            st.append(2 * st[-1])
        elif op == '+':
            st.append(st[-1] + st[-2])
        else:
            st.append(int(op))
    return sum(st)`,
      cpp: `int solve(vector<string> ops) {
    vector<int> st;
    for (auto &op : ops) {
        if (op == "C") st.pop_back();
        else if (op == "D") st.push_back(2 * st.back());
        else if (op == "+") st.push_back(st[st.size()-1] + st[st.size()-2]);
        else st.push_back(stoi(op));
    }
    int sum = 0;
    for (int x : st) sum += x;
    return sum;
}`,
    },
    oracle: {
      language: 'javascript',
      note: 'Index-pointer simulation without push/pop — different implementation.',
      code: `function solve(ops) {
  const st = [];
  let top = -1;
  for (const op of ops) {
    if (op === 'C') top--;
    else if (op === 'D') st[++top] = 2 * st[top - 1];
    else if (op === '+') st[++top] = st[top - 1] + st[top - 2];
    else st[++top] = Number(op);
  }
  let sum = 0;
  for (let i = 0; i <= top; i++) sum += st[i];
  return sum;
}`,
    },
    wrong: {
      language: 'javascript',
      note: 'Bug: "+" records the sum of ALL previous scores, not just the last two.',
      code: `function solve(ops) {
  const st = [];
  for (const op of ops) {
    if (op === 'C') st.pop();
    else if (op === 'D') st.push(2 * st[st.length - 1]);
    else if (op === '+') st.push(st.reduce((a, b) => a + b, 0));
    else st.push(Number(op));
  }
  return st.reduce((a, b) => a + b, 0);
}`,
    },
    source: 'classic:baseball-game (own wording)',
  }),

  P({
    slug: 'backspace-string-compare',
    title: 'Backspace String Compare',
    statement:
      'Given two strings s and t, return true if they are equal after processing backspaces. ' +
      'The character "#" means backspace: it deletes the previous character (or nothing if the ' +
      'result so far is empty).',
    examples: [
      { input: 's = "ab#c", t = "ad#c"', output: 'true' },
      { input: 's = "ab##", t = "c#d#"', output: 'true' },
      { input: 's = "a#c", t = "b"', output: 'false' },
    ],
    constraints: ['1 <= s.length, t.length <= 200'],
    params: [
      { name: 's', type: 'string' },
      { name: 't', type: 'string' },
    ],
    returnType: 'bool',
    topics: ['strings', 'stack', 'two-pointers'],
    tests: [
      T(['ab#c', 'ad#c'], true),
      T(['ab##', 'c#d#'], true),
      T(['a#c', 'b'], false),
      T(['###', ''], true, true),
      T(['a##b', 'b'], true, true),
      T(['xy#z', 'xzz#'], true, true),
    ],
    reference: {
      javascript: `function solve(s, t) {
  const build = (x) => {
    const st = [];
    for (const ch of x) {
      if (ch === '#') st.pop();
      else st.push(ch);
    }
    return st.join('');
  };
  return build(s) === build(t);
}`,
      python: `def solve(s, t):
    def build(x):
        st = []
        for ch in x:
            if ch == '#':
                if st:
                    st.pop()
            else:
                st.append(ch)
        return ''.join(st)
    return build(s) == build(t)`,
      cpp: `bool solve(string s, string t) {
    auto build = [](string x) {
        string st;
        for (char ch : x) {
            if (ch == '#') { if (!st.empty()) st.pop_back(); }
            else st.push_back(ch);
        }
        return st;
    };
    return build(s) == build(t);
}`,
    },
    oracle: {
      language: 'javascript',
      note: 'Two pointers from the end, skipping deleted chars — different algorithm.',
      code: `function solve(s, t) {
  const next = (x, i) => {
    let skip = 0;
    while (i >= 0) {
      if (x[i] === '#') { skip++; i--; }
      else if (skip > 0) { skip--; i--; }
      else break;
    }
    return i;
  };
  let i = s.length - 1, j = t.length - 1;
  while (true) {
    i = next(s, i);
    j = next(t, j);
    if (i < 0 || j < 0) return i === j;
    if (s[i] !== t[j]) return false;
    i--; j--;
  }
}`,
    },
    wrong: {
      language: 'javascript',
      note: 'Applies only ONE backspace per string (single regex replace).',
      code: `function solve(s, t) {
  const once = (x) => x.replace(/.?#/, '');
  return once(s) === once(t);
}`,
    },
    source: 'classic:backspace-string-compare (own wording)',
  }),

  P({
    slug: 'next-greater-element-i',
    title: 'Next Greater Element I',
    statement:
      'You are given two arrays nums1 and nums2 where nums1 is a subset of nums2 (all values ' +
      'distinct). For each element x in nums1, find the first element to its right in nums2 that ' +
      'is greater than x — the "next greater" element. Return an array of these values, using ' +
      '-1 where no greater element exists.',
    examples: [
      { input: 'nums1 = [4, 1, 2], nums2 = [1, 3, 4, 2]', output: '[-1, 3, -1]' },
      { input: 'nums1 = [2, 4], nums2 = [1, 2, 3, 4]', output: '[3, -1]' },
    ],
    constraints: ['1 <= nums1.length <= nums2.length <= 1000', 'all values distinct'],
    params: [
      { name: 'nums1', type: 'int[]' },
      { name: 'nums2', type: 'int[]' },
    ],
    returnType: 'int[]',
    topics: ['arrays', 'stack', 'hash-map'],
    tests: [
      T([[4, 1, 2], [1, 3, 4, 2]], [-1, 3, -1]),
      T([[2, 4], [1, 2, 3, 4]], [3, -1]),
      T([[1], [1]], [-1]),
      T([[2, 1], [1, 2]], [-1, 2]),
      T([[3, 1, 5], [5, 6, 3, 1, 2]], [-1, 2, 6], true),
      T([[1, 3, 5, 2, 4], [6, 5, 4, 3, 2, 1, 7]], [7, 7, 7, 7, 7], true),
      T([[5], [5, 4, 3, 2, 1]], [-1], true),
    ],
    reference: {
      javascript: `function solve(nums1, nums2) {
  const next = new Map(), st = [];
  for (const x of nums2) {
    while (st.length && st[st.length - 1] < x) next.set(st.pop(), x);
    st.push(x);
  }
  return nums1.map((x) => (next.has(x) ? next.get(x) : -1));
}`,
      python: `def solve(nums1, nums2):
    nxt = {}
    st = []
    for x in nums2:
        while st and st[-1] < x:
            nxt[st.pop()] = x
        st.append(x)
    return [nxt.get(x, -1) for x in nums1]`,
      cpp: `vector<int> solve(vector<int> nums1, vector<int> nums2) {
    unordered_map<int, int> nxt;
    vector<int> st;
    for (int x : nums2) {
        while (!st.empty() && st.back() < x) { nxt[st.back()] = x; st.pop_back(); }
        st.push_back(x);
    }
    vector<int> out;
    for (int x : nums1) out.push_back(nxt.count(x) ? nxt[x] : -1);
    return out;
}`,
    },
    oracle: {
      language: 'javascript',
      note: 'Brute-force scan right for the first greater — different algorithm.',
      code: `function solve(nums1, nums2) {
  return nums1.map((x) => {
    const i = nums2.indexOf(x);
    for (let j = i + 1; j < nums2.length; j++) {
      if (nums2[j] > x) return nums2[j];
    }
    return -1;
  });
}`,
    },
    wrong: {
      language: 'javascript',
      note: 'Misreads "next greater" as "maximum greater to the right".',
      code: `function solve(nums1, nums2) {
  return nums1.map((x) => {
    const i = nums2.indexOf(x);
    let best = -1;
    for (let j = i + 1; j < nums2.length; j++) {
      if (nums2[j] > x) best = Math.max(best, nums2[j]);
    }
    return best;
  });
}`,
    },
    source: 'classic:next-greater-element-i (own wording)',
  }),

  P({
    slug: 'binary-search',
    title: 'Binary Search',
    statement:
      'Given an array of integers nums sorted in ascending order and an integer target, return ' +
      'the index of target in nums, or -1 if target is not present. You must write an algorithm ' +
      'with O(log n) runtime complexity.',
    examples: [
      { input: 'nums = [-1, 0, 3, 5, 9, 12], target = 9', output: '4' },
      { input: 'nums = [-1, 0, 3, 5, 9, 12], target = 2', output: '-1' },
    ],
    constraints: ['1 <= nums.length <= 10^4', 'nums sorted ascending, all distinct'],
    params: [
      { name: 'nums', type: 'int[]' },
      { name: 'target', type: 'int' },
    ],
    returnType: 'int',
    topics: ['arrays', 'binary-search'],
    tests: [
      T([[-1, 0, 3, 5, 9, 12], 9], 4),
      T([[-1, 0, 3, 5, 9, 12], 2], -1),
      T([[5], 5], 0),
      T([[1, 2, 3, 4, 5], 1], 0, true),
      T([[1, 2, 3, 4, 5], 5], 4, true),
      T([[2, 5], 5], 1, true),
    ],
    reference: {
      javascript: `function solve(nums, target) {
  let lo = 0, hi = nums.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (nums[mid] === target) return mid;
    if (nums[mid] < target) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}`,
      python: `def solve(nums, target):
    lo, hi = 0, len(nums) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if nums[mid] == target:
            return mid
        if nums[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1`,
      cpp: `int solve(vector<int> nums, int target) {
    int lo = 0, hi = (int)nums.size() - 1;
    while (lo <= hi) {
        int mid = lo + (hi - lo) / 2;
        if (nums[mid] == target) return mid;
        if (nums[mid] < target) lo = mid + 1;
        else hi = mid - 1;
    }
    return -1;
}`,
    },
    oracle: {
      language: 'javascript',
      note: 'Linear indexOf — different (slower) implementation, same answers.',
      code: `function solve(nums, target) {
  return nums.indexOf(target);
}`,
    },
    wrong: {
      language: 'javascript',
      note: 'Loop condition lo < hi never inspects the final single-element range.',
      code: `function solve(nums, target) {
  let lo = 0, hi = nums.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (nums[mid] === target) return mid;
    if (nums[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return -1;
}`,
    },
    source: 'classic:binary-search (own wording)',
  }),

  P({
    slug: 'search-insert-position',
    title: 'Search Insert Position',
    statement:
      'Given a sorted array of distinct integers nums and a target value, return the index if ' +
      'the target is found. Otherwise return the index where it would be inserted to keep the ' +
      'array sorted. Write an O(log n) algorithm.',
    examples: [
      { input: 'nums = [1, 3, 5, 6], target = 5', output: '2' },
      { input: 'nums = [1, 3, 5, 6], target = 2', output: '1' },
      { input: 'nums = [1, 3, 5, 6], target = 7', output: '4' },
    ],
    constraints: ['1 <= nums.length <= 10^4', 'nums sorted ascending, all distinct'],
    params: [
      { name: 'nums', type: 'int[]' },
      { name: 'target', type: 'int' },
    ],
    returnType: 'int',
    topics: ['arrays', 'binary-search'],
    tests: [
      T([[1, 3, 5, 6], 5], 2),
      T([[1, 3, 5, 6], 2], 1),
      T([[1, 3, 5, 6], 7], 4),
      T([[1, 3, 5, 6], 0], 0, true),
      T([[1], 0], 0, true),
      T([[1, 3, 5, 6], 4], 2, true),
    ],
    reference: {
      javascript: `function solve(nums, target) {
  let lo = 0, hi = nums.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (nums[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}`,
      python: `def solve(nums, target):
    lo, hi = 0, len(nums)
    while lo < hi:
        mid = (lo + hi) // 2
        if nums[mid] < target:
            lo = mid + 1
        else:
            hi = mid
    return lo`,
      cpp: `int solve(vector<int> nums, int target) {
    int lo = 0, hi = (int)nums.size();
    while (lo < hi) {
        int mid = lo + (hi - lo) / 2;
        if (nums[mid] < target) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}`,
    },
    oracle: {
      language: 'javascript',
      note: 'Linear scan — different implementation.',
      code: `function solve(nums, target) {
  for (let i = 0; i < nums.length; i++) {
    if (nums[i] >= target) return i;
  }
  return nums.length;
}`,
    },
    wrong: {
      language: 'javascript',
      note: 'Returns length-1 instead of length when the target belongs at the end.',
      code: `function solve(nums, target) {
  for (let i = 0; i < nums.length; i++) {
    if (nums[i] >= target) return i;
  }
  return nums.length - 1;
}`,
    },
    source: 'classic:search-insert-position (own wording)',
  }),

  P({
    slug: 'sqrtx',
    title: 'Sqrt(x)',
    statement:
      'Given a non-negative integer x, return the square root of x rounded DOWN to the nearest ' +
      'integer. Do not use any built-in exponent or root function.',
    examples: [
      { input: 'x = 4', output: '2' },
      { input: 'x = 8', output: '2' },
    ],
    constraints: ['0 <= x <= 2^31 - 1'],
    params: [{ name: 'x', type: 'int' }],
    returnType: 'int',
    topics: ['math', 'binary-search'],
    tests: [
      T([4], 2),
      T([8], 2),
      T([0], 0),
      T([1], 1),
      T([15], 3, true),
      T([2147395599], 46339, true),
      T([16], 4, true),
    ],
    reference: {
      javascript: `function solve(x) {
  if (x < 2) return x;
  let lo = 1, hi = x >> 1, ans = 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const sq = mid * mid;
    if (sq === x) return mid;
    if (sq < x) { ans = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return ans;
}`,
      python: `def solve(x):
    if x < 2:
        return x
    lo, hi, ans = 1, x // 2, 1
    while lo <= hi:
        mid = (lo + hi) // 2
        sq = mid * mid
        if sq == x:
            return mid
        if sq < x:
            ans, lo = mid, mid + 1
        else:
            hi = mid - 1
    return ans`,
      cpp: `int solve(int x) {
    if (x < 2) return x;
    long long lo = 1, hi = x / 2, ans = 1;
    while (lo <= hi) {
        long long mid = lo + (hi - lo) / 2;
        long long sq = mid * mid;
        if (sq == x) return (int)mid;
        if (sq < x) { ans = mid; lo = mid + 1; }
        else hi = mid - 1;
    }
    return (int)ans;
}`,
    },
    oracle: {
      language: 'javascript',
      note: 'Linear scan upward — different (slower) implementation.',
      code: `function solve(x) {
  let r = 0;
  while ((r + 1) * (r + 1) <= x) r++;
  return r;
}`,
    },
    wrong: {
      language: 'javascript',
      note: 'Rounds instead of flooring: sqrt(8)≈2.83 becomes 3.',
      code: `function solve(x) {
  return Math.round(Math.sqrt(x));
}`,
    },
    source: 'classic:sqrtx (own wording)',
  }),

  P({
    slug: 'find-min-rotated',
    title: 'Find Minimum in Rotated Sorted Array',
    statement:
      'Suppose an array of length n sorted in ascending order is rotated between 1 and n times. ' +
      'Given the rotated array nums of unique elements, return its minimum element. ' +
      'Write an O(log n) algorithm.',
    examples: [
      { input: 'nums = [3, 4, 5, 1, 2]', output: '1' },
      { input: 'nums = [4, 5, 6, 7, 0, 1, 2]', output: '0' },
      { input: 'nums = [11, 13, 15, 17]', output: '11' },
    ],
    constraints: ['1 <= nums.length <= 5000', 'all elements unique'],
    params: [{ name: 'nums', type: 'int[]' }],
    returnType: 'int',
    topics: ['arrays', 'binary-search'],
    difficulty: 'medium',
    tests: [
      T([[3, 4, 5, 1, 2]], 1),
      T([[4, 5, 6, 7, 0, 1, 2]], 0),
      T([[11, 13, 15, 17]], 11),
      T([[2, 1]], 1),
      T([[1]], 1, true),
      T([[5, 1, 2, 3, 4]], 1, true),
      T([[2, 3, 4, 5, 1]], 1, true),
    ],
    reference: {
      javascript: `function solve(nums) {
  let lo = 0, hi = nums.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (nums[mid] > nums[hi]) lo = mid + 1;
    else hi = mid;
  }
  return nums[lo];
}`,
      python: `def solve(nums):
    lo, hi = 0, len(nums) - 1
    while lo < hi:
        mid = (lo + hi) // 2
        if nums[mid] > nums[hi]:
            lo = mid + 1
        else:
            hi = mid
    return nums[lo]`,
      cpp: `int solve(vector<int> nums) {
    int lo = 0, hi = (int)nums.size() - 1;
    while (lo < hi) {
        int mid = lo + (hi - lo) / 2;
        if (nums[mid] > nums[hi]) lo = mid + 1;
        else hi = mid;
    }
    return nums[lo];
}`,
    },
    oracle: {
      language: 'javascript',
      note: 'Linear minimum — different (slower) implementation.',
      code: `function solve(nums) {
  let m = nums[0];
  for (const x of nums) if (x < m) m = x;
  return m;
}`,
    },
    wrong: {
      language: 'javascript',
      note: 'Returns the INDEX of the minimum instead of the minimum value.',
      code: `function solve(nums) {
  let m = 0;
  for (let i = 1; i < nums.length; i++) if (nums[i] < nums[m]) m = i;
  return m;
}`,
    },
    source: 'classic:find-min-rotated (own wording)',
  }),
];
