/**
 * Milestone 6 — bank: two-pointer + sliding-window problems (8).
 * Own wording throughout; each entry validated by the pipeline.
 */
import { P, T } from './helpers.js';

export const POINTERS_WINDOWS = [
  P({
    slug: 'container-with-most-water',
    title: 'Container With Most Water',
    statement:
      'You are given an integer array height of length n, where n vertical lines are drawn at ' +
      'positions 0..n-1 with heights height[i]. Find two lines that together with the x-axis form ' +
      'a container holding the most water. Return the maximum area. The container cannot be slanted.',
    examples: [
      { input: 'height = [1, 8, 6, 2, 5, 4, 8, 3, 7]', output: '49' },
      { input: 'height = [1, 1]', output: '1' },
    ],
    constraints: ['2 <= height.length <= 10^5', '0 <= height[i] <= 10^4'],
    params: [{ name: 'height', type: 'int[]' }],
    returnType: 'int',
    topics: ['arrays', 'two-pointers'],
    difficulty: 'medium',
    tests: [
      T([[1, 8, 6, 2, 5, 4, 8, 3, 7]], 49),
      T([[1, 1]], 1),
      T([[4, 3, 2, 1, 4]], 16),
      T([[1, 2, 1]], 2),
      T([[3, 1, 2]], 4),
      T([[0, 0]], 0),
      T([[1, 2, 3, 4, 5]], 6, true),
      T([[5, 4, 3, 2, 1]], 6, true),
      T([[2, 3, 10, 5, 7, 8, 9]], 36, true),
    ],
    reference: {
      javascript: `function solve(height) {
  let l = 0, r = height.length - 1, best = 0;
  while (l < r) {
    best = Math.max(best, Math.min(height[l], height[r]) * (r - l));
    if (height[l] < height[r]) l++;
    else r--;
  }
  return best;
}`,
      python: `def solve(height):
    l, r, best = 0, len(height) - 1, 0
    while l < r:
        best = max(best, min(height[l], height[r]) * (r - l))
        if height[l] < height[r]:
            l += 1
        else:
            r -= 1
    return best`,
      cpp: `int solve(vector<int> height) {
    int l = 0, r = (int)height.size() - 1, best = 0;
    while (l < r) {
        best = max(best, min(height[l], height[r]) * (r - l));
        if (height[l] < height[r]) l++;
        else r--;
    }
    return best;
}`,
    },
    oracle: {
      language: 'javascript',
      note: 'Brute-force all pairs.',
      code: `function solve(height) {
  let best = 0;
  for (let i = 0; i < height.length; i++)
    for (let j = i + 1; j < height.length; j++)
      best = Math.max(best, Math.min(height[i], height[j]) * (j - i));
  return best;
}`,
    },
    wrong: {
      language: 'javascript',
      note: 'Moves the TALLER pointer inward instead of the shorter one.',
      code: `function solve(height) {
  let l = 0, r = height.length - 1, best = 0;
  while (l < r) {
    best = Math.max(best, Math.min(height[l], height[r]) * (r - l));
    if (height[l] > height[r]) l++;
    else r--;
  }
  return best;
}`,
    },
    source: 'classic:container-with-most-water (own wording)',
  }),

  P({
    slug: '3sum',
    title: '3Sum',
    statement:
      'Given an integer array nums, return all the unique triplets [a, b, c] such that ' +
      'a + b + c = 0. The triplets must not contain duplicates; return each unique triplet ' +
      'once, with its three numbers in ascending order.',
    examples: [
      { input: 'nums = [-1, 0, 1, 2, -1, -4]', output: '[[-1, -1, 2], [-1, 0, 1]]' },
      { input: 'nums = [0, 1, 1]', output: '[]' },
    ],
    constraints: ['3 <= nums.length <= 3000'],
    params: [{ name: 'nums', type: 'int[]' }],
    returnType: 'int[][]',
    comparison: 'unordered',
    topics: ['arrays', 'two-pointers', 'sorting'],
    difficulty: 'medium',
    tests: [
      T([[-1, 0, 1, 2, -1, -4]], [[-1, -1, 2], [-1, 0, 1]]),
      T([[0, 1, 1]], []),
      T([[0, 0, 0]], [[0, 0, 0]]),
      T([[0, 0, 0, 0]], [[0, 0, 0]], true),
      T([[3, 0, -2, -1, 1, 2]], [[-2, -1, 3], [-2, 0, 2], [-1, 0, 1]], true),
      T([[-2, -1, -1, 0, 1, 2]], [[-2, 0, 2], [-1, -1, 2], [-1, 0, 1]], true),
    ],
    reference: {
      javascript: `function solve(nums) {
  nums.sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < nums.length - 2; i++) {
    if (i > 0 && nums[i] === nums[i - 1]) continue;
    let l = i + 1, r = nums.length - 1;
    while (l < r) {
      const s = nums[i] + nums[l] + nums[r];
      if (s === 0) {
        out.push([nums[i], nums[l], nums[r]]);
        while (l < r && nums[l] === nums[l + 1]) l++;
        while (l < r && nums[r] === nums[r - 1]) r--;
        l++; r--;
      } else if (s < 0) l++;
      else r--;
    }
  }
  return out;
}`,
      python: `def solve(nums):
    nums = sorted(nums)
    out = []
    for i in range(len(nums) - 2):
        if i > 0 and nums[i] == nums[i - 1]:
            continue
        l, r = i + 1, len(nums) - 1
        while l < r:
            s = nums[i] + nums[l] + nums[r]
            if s == 0:
                out.append([nums[i], nums[l], nums[r]])
                while l < r and nums[l] == nums[l + 1]:
                    l += 1
                while l < r and nums[r] == nums[r - 1]:
                    r -= 1
                l += 1
                r -= 1
            elif s < 0:
                l += 1
            else:
                r -= 1
    return out`,
      cpp: `vector<vector<int>> solve(vector<int> nums) {
    sort(nums.begin(), nums.end());
    vector<vector<int>> out;
    int n = nums.size();
    for (int i = 0; i < n - 2; i++) {
        if (i > 0 && nums[i] == nums[i - 1]) continue;
        int l = i + 1, r = n - 1;
        while (l < r) {
            int s = nums[i] + nums[l] + nums[r];
            if (s == 0) {
                out.push_back({nums[i], nums[l], nums[r]});
                while (l < r && nums[l] == nums[l + 1]) l++;
                while (l < r && nums[r] == nums[r - 1]) r--;
                l++; r--;
            } else if (s < 0) l++;
            else r--;
        }
    }
    return out;
}`,
    },
    oracle: {
      language: 'javascript',
      note: 'O(n³) brute force with dedup via key set — different algorithm.',
      code: `function solve(nums) {
  const seen = new Set(), out = [];
  for (let i = 0; i < nums.length; i++)
    for (let j = i + 1; j < nums.length; j++)
      for (let k = j + 1; k < nums.length; k++)
        if (nums[i] + nums[j] + nums[k] === 0) {
          const t = [nums[i], nums[j], nums[k]].sort((a, b) => a - b);
          const key = t.join(',');
          if (!seen.has(key)) { seen.add(key); out.push(t); }
        }
  return out;
}`,
    },
    wrong: {
      language: 'javascript',
      note: 'Never skips duplicate values: emits the same triplet many times.',
      code: `function solve(nums) {
  nums.sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < nums.length - 2; i++) {
    let l = i + 1, r = nums.length - 1;
    while (l < r) {
      const s = nums[i] + nums[l] + nums[r];
      if (s === 0) { out.push([nums[i], nums[l], nums[r]]); l++; r--; }
      else if (s < 0) l++;
      else r--;
    }
  }
  return out;
}`,
    },
    source: 'classic:3sum (own wording)',
  }),

  P({
    slug: 'two-sum-ii-sorted',
    title: 'Two Sum II — Sorted Array',
    statement:
      'Given a 1-indexed array numbers that is already sorted in non-decreasing order, find two ' +
      'numbers that add up to target. Return the 1-based indices [index1, index2] with ' +
      'index1 < index2. Exactly one solution exists and you may not use the same element twice.',
    examples: [
      { input: 'numbers = [2, 7, 11, 15], target = 9', output: '[1, 2]' },
      { input: 'numbers = [2, 3, 4], target = 6', output: '[1, 3]' },
    ],
    constraints: ['2 <= numbers.length <= 3 * 10^4'],
    params: [
      { name: 'numbers', type: 'int[]' },
      { name: 'target', type: 'int' },
    ],
    returnType: 'int[]',
    topics: ['arrays', 'two-pointers'],
    tests: [
      T([[2, 7, 11, 15], 9], [1, 2]),
      T([[2, 3, 4], 6], [1, 3]),
      T([[-1, 0], -1], [1, 2]),
      T([[1, 2, 3, 4, 4, 9, 56, 90], 8], [4, 5], true),
      T([[5, 25, 75], 100], [2, 3], true),
      T([[1, 2, 3, 4, 5], 9], [4, 5], true),
    ],
    reference: {
      javascript: `function solve(numbers, target) {
  let l = 0, r = numbers.length - 1;
  while (l < r) {
    const s = numbers[l] + numbers[r];
    if (s === target) return [l + 1, r + 1];
    if (s < target) l++;
    else r--;
  }
  return [];
}`,
      python: `def solve(numbers, target):
    l, r = 0, len(numbers) - 1
    while l < r:
        s = numbers[l] + numbers[r]
        if s == target:
            return [l + 1, r + 1]
        if s < target:
            l += 1
        else:
            r -= 1
    return []`,
      cpp: `vector<int> solve(vector<int> numbers, int target) {
    int l = 0, r = (int)numbers.size() - 1;
    while (l < r) {
        int s = numbers[l] + numbers[r];
        if (s == target) return {l + 1, r + 1};
        if (s < target) l++;
        else r--;
    }
    return {};
}`,
    },
    oracle: {
      language: 'javascript',
      note: 'Binary search for the complement of each element — different algorithm.',
      code: `function solve(numbers, target) {
  for (let i = 0; i < numbers.length; i++) {
    const need = target - numbers[i];
    let lo = i + 1, hi = numbers.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (numbers[mid] === need) return [i + 1, mid + 1];
      if (numbers[mid] < need) lo = mid + 1;
      else hi = mid - 1;
    }
  }
  return [];
}`,
    },
    wrong: {
      language: 'javascript',
      note: 'Returns 0-based indices instead of the required 1-based ones.',
      code: `function solve(numbers, target) {
  let l = 0, r = numbers.length - 1;
  while (l < r) {
    const s = numbers[l] + numbers[r];
    if (s === target) return [l, r];
    if (s < target) l++;
    else r--;
  }
  return [];
}`,
    },
    source: 'classic:two-sum-ii-sorted (own wording)',
  }),

  P({
    slug: 'remove-element',
    title: 'Remove Element',
    statement:
      'Given an integer array nums and an integer val, return a new array with all occurrences ' +
      'of val removed, keeping the relative order of the remaining elements.',
    examples: [
      { input: 'nums = [3, 2, 2, 3], val = 3', output: '[2, 2]' },
      { input: 'nums = [0, 1, 2, 2, 3, 0, 4, 2], val = 2', output: '[0, 1, 3, 0, 4]' },
    ],
    constraints: ['0 <= nums.length <= 100'],
    params: [
      { name: 'nums', type: 'int[]' },
      { name: 'val', type: 'int' },
    ],
    returnType: 'int[]',
    topics: ['arrays', 'two-pointers'],
    tests: [
      T([[3, 2, 2, 3], 3], [2, 2]),
      T([[0, 1, 2, 2, 3, 0, 4, 2], 2], [0, 1, 3, 0, 4]),
      T([[], 0], []),
      T([[1, 1, 1], 1], [], true),
      T([[4, 5], 9], [4, 5], true),
      T([[2, 2, 2], 2], [], true),
    ],
    reference: {
      javascript: `function solve(nums, val) {
  return nums.filter((x) => x !== val);
}`,
      python: `def solve(nums, val):
    return [x for x in nums if x != val]`,
      cpp: `vector<int> solve(vector<int> nums, int val) {
    vector<int> out;
    for (int x : nums) if (x != val) out.push_back(x);
    return out;
}`,
    },
    oracle: {
      language: 'javascript',
      note: 'Manual loop build — different implementation.',
      code: `function solve(nums, val) {
  const out = [];
  for (let i = 0; i < nums.length; i++) {
    if (nums[i] !== val) out.push(nums[i]);
  }
  return out;
}`,
    },
    wrong: {
      language: 'javascript',
      note: 'Removes only the FIRST occurrence of val.',
      code: `function solve(nums, val) {
  const a = [...nums];
  const i = a.indexOf(val);
  if (i >= 0) a.splice(i, 1);
  return a;
}`,
    },
    source: 'classic:remove-element (own wording)',
  }),

  P({
    slug: 'max-average-subarray-i',
    title: 'Maximum Average Subarray I',
    statement:
      'You are given an integer array nums of length n and an integer k. Find the contiguous ' +
      'subarray of length k with the maximum average value, and return that average.',
    examples: [{ input: 'nums = [1, 12, -5, -6, 50, 3], k = 4', output: '12.75' }],
    constraints: ['1 <= k <= nums.length <= 10^5'],
    params: [
      { name: 'nums', type: 'int[]' },
      { name: 'k', type: 'int' },
    ],
    returnType: 'float',
    comparison: 'float',
    floatTolerance: 1e-5,
    topics: ['arrays', 'sliding-window'],
    tests: [
      T([[1, 12, -5, -6, 50, 3], 4], 12.75),
      T([[5], 1], 5),
      T([[-1], 1], -1),
      T([[0, 1, 1, 3, 3], 4], 2, true),
      T([[-3, -1, -2], 2], -1.5, true),
      T([[8, 0, 0, 0], 2], 4, true),
    ],
    reference: {
      javascript: `function solve(nums, k) {
  let sum = 0;
  for (let i = 0; i < k; i++) sum += nums[i];
  let best = sum;
  for (let i = k; i < nums.length; i++) {
    sum += nums[i] - nums[i - k];
    if (sum > best) best = sum;
  }
  return best / k;
}`,
      python: `def solve(nums, k):
    s = sum(nums[:k])
    best = s
    for i in range(k, len(nums)):
        s += nums[i] - nums[i - k]
        if s > best:
            best = s
    return best / k`,
      cpp: `double solve(vector<int> nums, int k) {
    long long sum = 0;
    for (int i = 0; i < k; i++) sum += nums[i];
    long long best = sum;
    for (size_t i = k; i < nums.size(); i++) {
        sum += nums[i] - nums[i - k];
        best = max(best, sum);
    }
    return (double)best / k;
}`,
    },
    oracle: {
      language: 'javascript',
      note: 'Brute-force every window — different algorithm.',
      code: `function solve(nums, k) {
  let best = -Infinity;
  for (let i = 0; i + k <= nums.length; i++) {
    let s = 0;
    for (let j = i; j < i + k; j++) s += nums[j];
    best = Math.max(best, s / k);
  }
  return best;
}`,
    },
    wrong: {
      language: 'javascript',
      note: 'Off-by-one: averages windows of k+1 elements instead of k.',
      code: `function solve(nums, k) {
  let best = -Infinity;
  for (let i = 0; i + k < nums.length; i++) {
    let s = 0;
    for (let j = i; j <= i + k; j++) s += nums[j];
    best = Math.max(best, s / (k + 1));
  }
  return best === -Infinity ? 0 : best;
}`,
    },
    source: 'classic:max-average-subarray-i (own wording)',
  }),

  P({
    slug: 'longest-substring-without-repeating',
    title: 'Longest Substring Without Repeating Characters',
    statement:
      'Given a string s, find the length of the longest substring without repeating characters. ' +
      'A substring is a contiguous sequence of characters.',
    examples: [
      { input: 's = "abcabcbb"', output: '3' },
      { input: 's = "bbbbb"', output: '1' },
      { input: 's = "pwwkew"', output: '3' },
    ],
    constraints: ['0 <= s.length <= 5 * 10^4'],
    params: [{ name: 's', type: 'string' }],
    returnType: 'int',
    topics: ['strings', 'sliding-window', 'hash-map'],
    difficulty: 'medium',
    tests: [
      T(['abcabcbb'], 3),
      T(['bbbbb'], 1),
      T(['pwwkew'], 3),
      T(['abba'], 2, true),
      T([''], 0, true),
      T(['dvdf'], 3, true),
      T(['tmmzuxt'], 5, true),
    ],
    reference: {
      javascript: `function solve(s) {
  const last = new Map();
  let best = 0, start = 0;
  for (let i = 0; i < s.length; i++) {
    if (last.has(s[i]) && last.get(s[i]) >= start) start = last.get(s[i]) + 1;
    last.set(s[i], i);
    best = Math.max(best, i - start + 1);
  }
  return best;
}`,
      python: `def solve(s):
    last = {}
    best = start = 0
    for i, ch in enumerate(s):
        if ch in last and last[ch] >= start:
            start = last[ch] + 1
        last[ch] = i
        best = max(best, i - start + 1)
    return best`,
      cpp: `int solve(string s) {
    vector<int> last(256, -1);
    int best = 0, start = 0;
    for (int i = 0; i < (int)s.size(); i++) {
        unsigned char ch = s[i];
        if (last[ch] >= start) start = last[ch] + 1;
        last[ch] = i;
        best = max(best, i - start + 1);
    }
    return best;
}`,
    },
    oracle: {
      language: 'javascript',
      note: 'Brute-force all substrings with a set — different algorithm.',
      code: `function solve(s) {
  let best = 0;
  for (let i = 0; i < s.length; i++) {
    const seen = new Set();
    for (let j = i; j < s.length; j++) {
      if (seen.has(s[j])) break;
      seen.add(s[j]);
      best = Math.max(best, j - i + 1);
    }
  }
  return best;
}`,
    },
    wrong: {
      language: 'javascript',
      note: 'Moves the window start from a stale position: on a repeat it can jump start BACKWARD (fails "abba").',
      code: `function solve(s) {
  const last = new Map();
  let best = 0, start = 0;
  for (let i = 0; i < s.length; i++) {
    if (last.has(s[i])) start = last.get(s[i]) + 1;
    last.set(s[i], i);
    best = Math.max(best, i - start + 1);
  }
  return best;
}`,
    },
    source: 'classic:longest-substring-without-repeating (own wording)',
  }),

  P({
    slug: 'minimum-size-subarray-sum',
    title: 'Minimum Size Subarray Sum',
    statement:
      'Given an array of positive integers nums and a positive integer target, return the minimal ' +
      'length of a contiguous subarray whose sum is greater than or equal to target. If no such ' +
      'subarray exists, return 0.',
    examples: [
      { input: 'target = 7, nums = [2, 3, 1, 2, 4, 3]', output: '2' },
      { input: 'target = 4, nums = [1, 4, 4]', output: '1' },
      { input: 'target = 11, nums = [1, 1, 1, 1, 1, 1, 1, 1]', output: '0' },
    ],
    constraints: ['1 <= nums.length <= 10^5', 'all nums[i] are positive'],
    params: [
      { name: 'target', type: 'int' },
      { name: 'nums', type: 'int[]' },
    ],
    returnType: 'int',
    topics: ['arrays', 'sliding-window'],
    difficulty: 'medium',
    tests: [
      T([7, [2, 3, 1, 2, 4, 3]], 2),
      T([4, [1, 4, 4]], 1),
      T([11, [1, 1, 1, 1, 1, 1, 1, 1]], 0),
      T([11, [1, 2, 3, 4, 5]], 3, true),
      T([15, [1, 2, 3, 4, 5]], 5, true),
      T([3, [1, 1, 1]], 3, true),
    ],
    reference: {
      javascript: `function solve(target, nums) {
  let best = Infinity, sum = 0, left = 0;
  for (let right = 0; right < nums.length; right++) {
    sum += nums[right];
    while (sum >= target) {
      best = Math.min(best, right - left + 1);
      sum -= nums[left++];
    }
  }
  return best === Infinity ? 0 : best;
}`,
      python: `def solve(target, nums):
    best = float('inf')
    s = left = 0
    for right, x in enumerate(nums):
        s += x
        while s >= target:
            best = min(best, right - left + 1)
            s -= nums[left]
            left += 1
    return 0 if best == float('inf') else best`,
      cpp: `int solve(int target, vector<int> nums) {
    int best = INT_MAX, left = 0;
    long long sum = 0;
    for (int right = 0; right < (int)nums.size(); right++) {
        sum += nums[right];
        while (sum >= target) {
            best = min(best, right - left + 1);
            sum -= nums[left++];
        }
    }
    return best == INT_MAX ? 0 : best;
}`,
    },
    oracle: {
      language: 'javascript',
      note: 'Brute-force all subarrays — different algorithm.',
      code: `function solve(target, nums) {
  let best = Infinity;
  for (let i = 0; i < nums.length; i++) {
    let sum = 0;
    for (let j = i; j < nums.length; j++) {
      sum += nums[j];
      if (sum >= target) { best = Math.min(best, j - i + 1); break; }
    }
  }
  return best === Infinity ? 0 : best;
}`,
    },
    wrong: {
      language: 'javascript',
      note: 'On reaching the target it jumps the left edge past right instead of shrinking one step.',
      code: `function solve(target, nums) {
  let best = Infinity, sum = 0, left = 0;
  for (let right = 0; right < nums.length; right++) {
    sum += nums[right];
    if (sum >= target) {
      best = Math.min(best, right - left + 1);
      left = right + 1;
      sum = 0;
    }
  }
  return best === Infinity ? 0 : best;
}`,
    },
    source: 'classic:minimum-size-subarray-sum (own wording)',
  }),

  P({
    slug: 'contains-duplicate-ii',
    title: 'Contains Duplicate II',
    statement:
      'Given an integer array nums and an integer k, return true if there are two distinct indices ' +
      'i and j in the array such that nums[i] == nums[j] and |i - j| <= k.',
    examples: [
      { input: 'nums = [1, 2, 3, 1], k = 3', output: 'true' },
      { input: 'nums = [1, 0, 1, 1], k = 1', output: 'true' },
      { input: 'nums = [1, 2, 3, 1, 2, 3], k = 2', output: 'false' },
    ],
    constraints: ['1 <= nums.length <= 10^5'],
    params: [
      { name: 'nums', type: 'int[]' },
      { name: 'k', type: 'int' },
    ],
    returnType: 'bool',
    topics: ['arrays', 'hash-map', 'sliding-window'],
    tests: [
      T([[1, 2, 3, 1], 3], true),
      T([[1, 0, 1, 1], 1], true),
      T([[1, 2, 3, 1, 2, 3], 2], false),
      T([[99, 99], 2], true, true),
      T([[1, 2, 3, 4], 5], false, true),
      T([[1, 2, 1], 0], false, true),
    ],
    reference: {
      javascript: `function solve(nums, k) {
  const last = new Map();
  for (let i = 0; i < nums.length; i++) {
    if (last.has(nums[i]) && i - last.get(nums[i]) <= k) return true;
    last.set(nums[i], i);
  }
  return false;
}`,
      python: `def solve(nums, k):
    last = {}
    for i, x in enumerate(nums):
        if x in last and i - last[x] <= k:
            return True
        last[x] = i
    return False`,
      cpp: `bool solve(vector<int> nums, int k) {
    unordered_map<int, int> last;
    for (int i = 0; i < (int)nums.size(); i++) {
        auto it = last.find(nums[i]);
        if (it != last.end() && i - it->second <= k) return true;
        last[nums[i]] = i;
    }
    return false;
}`,
    },
    oracle: {
      language: 'javascript',
      note: 'Sliding window set of size k — different algorithm.',
      code: `function solve(nums, k) {
  const win = new Set();
  for (let i = 0; i < nums.length; i++) {
    if (win.has(nums[i])) return true;
    win.add(nums[i]);
    if (win.size > k) win.delete(nums[i - k]);
  }
  return false;
}`,
    },
    wrong: {
      language: 'javascript',
      note: 'Ignores k: reports any duplicate as a hit.',
      code: `function solve(nums, k) {
  return new Set(nums).size !== nums.length;
}`,
    },
    source: 'classic:contains-duplicate-ii (own wording)',
  }),
];
