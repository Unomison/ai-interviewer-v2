/**
 * Milestone 6 — bank: string problems (10).
 * Own wording throughout; each entry validated by the pipeline.
 */
import { P, T } from './helpers.js';

export const STRINGS = [
  P({
    slug: 'valid-palindrome',
    title: 'Valid Palindrome',
    statement:
      'A phrase is a palindrome if, after converting all uppercase letters to lowercase and ' +
      'removing all non-alphanumeric characters, it reads the same forward and backward. ' +
      'Given a string s, return true if it is a palindrome, or false otherwise.',
    examples: [
      { input: 's = "A man, a plan, a canal: Panama"', output: 'true' },
      { input: 's = "race a car"', output: 'false' },
    ],
    constraints: ['1 <= s.length <= 2 * 10^5', 's consists of printable ASCII characters'],
    params: [{ name: 's', type: 'string' }],
    returnType: 'bool',
    topics: ['strings', 'two-pointers'],
    tests: [
      T(['A man, a plan, a canal: Panama'], true),
      T(['race a car'], false),
      T([' '], true),
      T(['0P'], false, true),
      T(['ab_a'], true, true),
      T(['.,'], true, true),
    ],
    reference: {
      javascript: `function solve(s) {
  const t = s.toLowerCase().replace(/[^a-z0-9]/g, '');
  let l = 0, r = t.length - 1;
  while (l < r) { if (t[l] !== t[r]) return false; l++; r--; }
  return true;
}`,
      python: `def solve(s):
    t = ''.join(ch.lower() for ch in s if ch.isalnum())
    return t == t[::-1]`,
      cpp: `bool solve(string s) {
    string t;
    for (char ch : s) {
        if (isalnum((unsigned char)ch)) t += tolower((unsigned char)ch);
    }
    int l = 0, r = (int)t.size() - 1;
    while (l < r) { if (t[l] != t[r]) return false; l++; r--; }
    return true;
}`,
    },
    oracle: {
      language: 'javascript',
      note: 'Filter then compare with reversed copy — different implementation.',
      code: `function solve(s) {
  const t = [...s.toLowerCase()].filter((c) => /[a-z0-9]/.test(c)).join('');
  return t === [...t].reverse().join('');
}`,
    },
    wrong: {
      language: 'javascript',
      note: 'Compares the raw string without stripping non-alphanumerics or case.',
      code: `function solve(s) {
  const t = [...s].reverse().join('');
  return s === t;
}`,
    },
    source: 'classic:valid-palindrome (own wording)',
  }),

  P({
    slug: 'valid-anagram',
    title: 'Valid Anagram',
    statement:
      'Given two strings s and t, return true if t is an anagram of s — that is, if t can be ' +
      'formed by rearranging the letters of s — and false otherwise.',
    examples: [
      { input: 's = "anagram", t = "nagaram"', output: 'true' },
      { input: 's = "rat", t = "car"', output: 'false' },
    ],
    constraints: ['0 <= s.length, t.length <= 5 * 10^4', 's and t consist of lowercase English letters'],
    params: [
      { name: 's', type: 'string' },
      { name: 't', type: 'string' },
    ],
    returnType: 'bool',
    topics: ['strings', 'hash-map'],
    tests: [
      T(['anagram', 'nagaram'], true),
      T(['rat', 'car'], false),
      T(['a', 'a'], true),
      T(['ab', 'a'], false, true),
      T(['aacc', 'ccac'], false, true),
      T(['', ''], true, true),
    ],
    reference: {
      javascript: `function solve(s, t) {
  if (s.length !== t.length) return false;
  const freq = new Map();
  for (const ch of s) freq.set(ch, (freq.get(ch) || 0) + 1);
  for (const ch of t) {
    if (!freq.get(ch)) return false;
    freq.set(ch, freq.get(ch) - 1);
  }
  return true;
}`,
      python: `def solve(s, t):
    if len(s) != len(t):
        return False
    from collections import Counter
    return Counter(s) == Counter(t)`,
      cpp: `bool solve(string s, string t) {
    if (s.size() != t.size()) return false;
    vector<int> freq(26, 0);
    for (char ch : s) freq[ch - 'a']++;
    for (char ch : t) {
        if (--freq[ch - 'a'] < 0) return false;
    }
    return true;
}`,
    },
    oracle: {
      language: 'javascript',
      note: 'Sort both strings and compare — different algorithm.',
      code: `function solve(s, t) {
  const norm = (x) => [...x].sort().join('');
  return norm(s) === norm(t);
}`,
    },
    wrong: {
      language: 'javascript',
      note: 'Only requires counts to stay non-negative — misses surplus letters in t.',
      code: `function solve(s, t) {
  const freq = {};
  for (const ch of s) freq[ch] = (freq[ch] || 0) + 1;
  for (const ch of t) freq[ch] = (freq[ch] || 0) - 1;
  return Object.values(freq).every((v) => v >= 0);
}`,
    },
    source: 'classic:valid-anagram (own wording)',
  }),

  P({
    slug: 'longest-common-prefix',
    title: 'Longest Common Prefix',
    statement:
      'Write a function to find the longest common prefix string amongst an array of strings. ' +
      'If there is no common prefix, return an empty string.',
    examples: [
      { input: 'strs = ["flower", "flow", "flight"]', output: '"fl"' },
      { input: 'strs = ["dog", "racecar", "car"]', output: '""' },
    ],
    constraints: ['1 <= strs.length <= 200', '0 <= strs[i].length <= 200'],
    params: [{ name: 'strs', type: 'string[]' }],
    returnType: 'string',
    topics: ['strings'],
    tests: [
      T([['flower', 'flow', 'flight']], 'fl'),
      T([['dog', 'racecar', 'car']], ''),
      T([['a']], 'a'),
      T([['ab', 'a']], 'a', true),
      T([['', 'b']], '', true),
      T([['interspecies', 'interstellar', 'interstate']], 'inters', true),
    ],
    reference: {
      javascript: `function solve(strs) {
  if (!strs.length) return '';
  let pre = strs[0];
  for (let i = 1; i < strs.length; i++) {
    while (!strs[i].startsWith(pre)) pre = pre.slice(0, -1);
    if (!pre) return '';
  }
  return pre;
}`,
      python: `def solve(strs):
    if not strs:
        return ''
    pre = strs[0]
    for s in strs[1:]:
        while not s.startswith(pre):
            pre = pre[:-1]
            if not pre:
                return ''
    return pre`,
      cpp: `string solve(vector<string> strs) {
    if (strs.empty()) return "";
    string pre = strs[0];
    for (size_t i = 1; i < strs.size(); i++) {
        while (strs[i].rfind(pre, 0) != 0) {
            pre.pop_back();
            if (pre.empty()) return "";
        }
    }
    return pre;
}`,
    },
    oracle: {
      language: 'javascript',
      note: 'Vertical character scan — different algorithm.',
      code: `function solve(strs) {
  if (!strs.length) return '';
  let out = '';
  for (let i = 0; i < strs[0].length; i++) {
    const ch = strs[0][i];
    if (strs.every((s) => s[i] === ch)) out += ch;
    else break;
  }
  return out;
}`,
    },
    wrong: {
      language: 'javascript',
      note: 'Only compares the first two strings, ignoring the rest.',
      code: `function solve(strs) {
  if (strs.length < 2) return strs[0] || '';
  let i = 0;
  while (i < strs[0].length && i < strs[1].length && strs[0][i] === strs[1][i]) i++;
  return strs[0].slice(0, i);
}`,
    },
    source: 'classic:longest-common-prefix (own wording)',
  }),

  P({
    slug: 'length-of-last-word',
    title: 'Length of Last Word',
    statement:
      'Given a string s consisting of words and spaces, return the length of the last word in ' +
      'the string. A word is a maximal substring of non-space characters.',
    examples: [
      { input: 's = "Hello World"', output: '5' },
      { input: 's = "   fly me   to   the moon  "', output: '4' },
    ],
    constraints: ['1 <= s.length <= 10^4', 's consists of only English letters and spaces'],
    params: [{ name: 's', type: 'string' }],
    returnType: 'int',
    topics: ['strings'],
    tests: [
      T(['Hello World'], 5),
      T(['   fly me   to   the moon  '], 4),
      T(['luffy is still joyboy'], 6),
      T(['a'], 1, true),
      T(['a '], 1, true),
      T(['Hello'], 5, true),
    ],
    reference: {
      javascript: `function solve(s) {
  let i = s.length - 1, len = 0;
  while (i >= 0 && s[i] === ' ') i--;
  while (i >= 0 && s[i] !== ' ') { len++; i--; }
  return len;
}`,
      python: `def solve(s):
    return len(s.strip().split(' ')[-1]) if s.strip() else 0`,
      cpp: `int solve(string s) {
    int i = (int)s.size() - 1, len = 0;
    while (i >= 0 && s[i] == ' ') i--;
    while (i >= 0 && s[i] != ' ') { len++; i--; }
    return len;
}`,
    },
    oracle: {
      language: 'javascript',
      note: 'Split on whitespace runs — different implementation.',
      code: `function solve(s) {
  const words = s.trim().split(/\\s+/);
  return words.length ? words[words.length - 1].length : 0;
}`,
    },
    wrong: {
      language: 'javascript',
      note: 'Splits on single spaces without trimming: trailing spaces produce an empty last word.',
      code: `function solve(s) {
  const parts = s.split(' ');
  return parts[parts.length - 1].length;
}`,
    },
    source: 'classic:length-of-last-word (own wording)',
  }),

  P({
    slug: 'reverse-words-in-string',
    title: 'Reverse Words in a String',
    statement:
      'Given an input string s, reverse the order of the words. A word is a sequence of ' +
      'non-space characters. The returned string should have single spaces between words and ' +
      'no leading or trailing spaces.',
    examples: [
      { input: 's = "the sky is blue"', output: '"blue is sky the"' },
      { input: 's = "  hello world  "', output: '"world hello"' },
    ],
    constraints: ['1 <= s.length <= 10^4', 's contains English letters, digits and spaces'],
    params: [{ name: 's', type: 'string' }],
    returnType: 'string',
    topics: ['strings', 'two-pointers'],
    tests: [
      T(['the sky is blue'], 'blue is sky the'),
      T(['  hello world  '], 'world hello'),
      T(['a good   example'], 'example good a'),
      T(['word'], 'word', true),
      T(['  a   b '], 'b a', true),
      T(['x y z'], 'z y x', true),
    ],
    reference: {
      javascript: `function solve(s) {
  return s.trim().split(/\\s+/).reverse().join(' ');
}`,
      python: `def solve(s):
    return ' '.join(s.split()[::-1])`,
      cpp: `string solve(string s) {
    stringstream ss(s);
    vector<string> words;
    string w;
    while (ss >> w) words.push_back(w);
    string out;
    for (int i = (int)words.size() - 1; i >= 0; i--) {
        if (!out.empty()) out += ' ';
        out += words[i];
    }
    return out;
}`,
    },
    oracle: {
      language: 'javascript',
      note: 'Manual backward scan — different implementation.',
      code: `function solve(s) {
  const words = [];
  let cur = '';
  for (const ch of s + ' ') {
    if (ch === ' ') { if (cur) { words.push(cur); cur = ''; } }
    else cur += ch;
  }
  return words.reverse().join(' ');
}`,
    },
    wrong: {
      language: 'javascript',
      note: 'Splits on single spaces: multiple spaces become empty words in the output.',
      code: `function solve(s) {
  return s.split(' ').reverse().join(' ').trim();
}`,
    },
    source: 'classic:reverse-words-in-string (own wording)',
  }),

  P({
    slug: 'first-unique-character',
    title: 'First Unique Character in a String',
    statement:
      'Given a string s, find the first non-repeating character in it and return its index. ' +
      'If it does not exist, return -1.',
    examples: [
      { input: 's = "leetcode"', output: '0' },
      { input: 's = "loveleetcode"', output: '2' },
      { input: 's = "aabb"', output: '-1' },
    ],
    constraints: ['1 <= s.length <= 10^5', 's consists of lowercase English letters'],
    params: [{ name: 's', type: 'string' }],
    returnType: 'int',
    topics: ['strings', 'hash-map'],
    tests: [
      T(['leetcode'], 0),
      T(['loveleetcode'], 2),
      T(['aabb'], -1),
      T(['z'], 0, true),
      T(['aadadaad'], -1, true),
      T(['dddccdbba'], 8, true),
    ],
    reference: {
      javascript: `function solve(s) {
  const freq = new Map();
  for (const ch of s) freq.set(ch, (freq.get(ch) || 0) + 1);
  for (let i = 0; i < s.length; i++) if (freq.get(s[i]) === 1) return i;
  return -1;
}`,
      python: `def solve(s):
    from collections import Counter
    freq = Counter(s)
    for i, ch in enumerate(s):
        if freq[ch] == 1:
            return i
    return -1`,
      cpp: `int solve(string s) {
    vector<int> freq(26, 0);
    for (char ch : s) freq[ch - 'a']++;
    for (int i = 0; i < (int)s.size(); i++)
        if (freq[s[i] - 'a'] == 1) return i;
    return -1;
}`,
    },
    oracle: {
      language: 'javascript',
      note: 'indexOf/lastIndexOf comparison — different implementation.',
      code: `function solve(s) {
  for (let i = 0; i < s.length; i++) {
    if (s.indexOf(s[i]) === s.lastIndexOf(s[i])) return i;
  }
  return -1;
}`,
    },
    wrong: {
      language: 'javascript',
      note: 'Only checks the first occurrence, never verifying the character is unique.',
      code: `function solve(s) {
  for (let i = 0; i < s.length; i++) {
    if (s.indexOf(s[i]) === i) return i;
  }
  return -1;
}`,
    },
    source: 'classic:first-unique-character (own wording)',
  }),

  P({
    slug: 'ransom-note',
    title: 'Ransom Note',
    statement:
      'Given two strings ransomNote and magazine, return true if ransomNote can be constructed ' +
      'from magazine — each letter in magazine can be used at most once — and false otherwise.',
    examples: [
      { input: 'ransomNote = "a", magazine = "b"', output: 'false' },
      { input: 'ransomNote = "aa", magazine = "aab"', output: 'true' },
    ],
    constraints: ['0 <= ransomNote.length, magazine.length <= 10^5'],
    params: [
      { name: 'ransomNote', type: 'string' },
      { name: 'magazine', type: 'string' },
    ],
    returnType: 'bool',
    topics: ['strings', 'hash-map'],
    tests: [
      T(['a', 'b'], false),
      T(['aa', 'aab'], true),
      T(['aa', 'ab'], false),
      T(['', 'abc'], true, true),
      T(['abc', 'cba'], true, true),
      T(['aab', 'baa'], true, true),
    ],
    reference: {
      javascript: `function solve(ransomNote, magazine) {
  const freq = new Map();
  for (const ch of magazine) freq.set(ch, (freq.get(ch) || 0) + 1);
  for (const ch of ransomNote) {
    const left = (freq.get(ch) || 0) - 1;
    if (left < 0) return false;
    freq.set(ch, left);
  }
  return true;
}`,
      python: `def solve(ransomNote, magazine):
    from collections import Counter
    freq = Counter(magazine)
    for ch in ransomNote:
        if freq[ch] <= 0:
            return False
        freq[ch] -= 1
    return True`,
      cpp: `bool solve(string ransomNote, string magazine) {
    vector<int> freq(256, 0);
    for (unsigned char ch : magazine) freq[ch]++;
    for (unsigned char ch : ransomNote) {
        if (--freq[ch] < 0) return false;
    }
    return true;
}`,
    },
    oracle: {
      language: 'javascript',
      note: 'Sort-and-consume approach — different algorithm.',
      code: `function solve(ransomNote, magazine) {
  const pool = [...magazine].sort();
  for (const ch of [...ransomNote].sort()) {
    const i = pool.indexOf(ch);
    if (i < 0) return false;
    pool.splice(i, 1);
  }
  return true;
}`,
    },
    wrong: {
      language: 'javascript',
      note: 'Uses includes() without consuming letters: reuses the same magazine letter.',
      code: `function solve(ransomNote, magazine) {
  for (const ch of ransomNote) {
    if (!magazine.includes(ch)) return false;
  }
  return true;
}`,
    },
    source: 'classic:ransom-note (own wording)',
  }),

  P({
    slug: 'isomorphic-strings',
    title: 'Isomorphic Strings',
    statement:
      'Given two strings s and t, determine if they are isomorphic: every character in s can be ' +
      'replaced to get t, with a one-to-one mapping that preserves order — no two characters ' +
      'may map to the same character, and a character may not map to itself unless it stays.',
    examples: [
      { input: 's = "egg", t = "add"', output: 'true' },
      { input: 's = "foo", t = "bar"', output: 'false' },
      { input: 's = "paper", t = "title"', output: 'true' },
    ],
    constraints: ['1 <= s.length <= 5 * 10^4'],
    params: [
      { name: 's', type: 'string' },
      { name: 't', type: 'string' },
    ],
    returnType: 'bool',
    topics: ['strings', 'hash-map'],
    tests: [
      T(['egg', 'add'], true),
      T(['foo', 'bar'], false),
      T(['paper', 'title'], true),
      T(['ab', 'aa'], false, true),
      T(['aa', 'ab'], false, true),
      T(['a', 'a'], true, true),
    ],
    reference: {
      javascript: `function solve(s, t) {
  if (s.length !== t.length) return false;
  const st = new Map(), ts = new Map();
  for (let i = 0; i < s.length; i++) {
    const a = s[i], b = t[i];
    if ((st.has(a) && st.get(a) !== b) || (ts.has(b) && ts.get(b) !== a)) return false;
    st.set(a, b); ts.set(b, a);
  }
  return true;
}`,
      python: `def solve(s, t):
    if len(s) != len(t):
        return False
    st, ts = {}, {}
    for a, b in zip(s, t):
        if (a in st and st[a] != b) or (b in ts and ts[b] != a):
            return False
        st[a] = b
        ts[b] = a
    return True`,
      cpp: `bool solve(string s, string t) {
    if (s.size() != t.size()) return false;
    vector<int> st(256, -1), ts(256, -1);
    for (size_t i = 0; i < s.size(); i++) {
        unsigned char a = s[i], b = t[i];
        if ((st[a] != -1 && st[a] != b) || (ts[b] != -1 && ts[b] != a)) return false;
        st[a] = b; ts[b] = a;
    }
    return true;
}`,
    },
    oracle: {
      language: 'javascript',
      note: 'Compares first-occurrence index patterns — different algorithm.',
      code: `function solve(s, t) {
  if (s.length !== t.length) return false;
  const pattern = (x) => [...x].map((ch) => x.indexOf(ch));
  const a = pattern(s), b = pattern(t);
  return a.every((v, i) => v === b[i]);
}`,
    },
    wrong: {
      language: 'javascript',
      note: 'Only maps s→t: misses the case where two s-characters map to one t-character.',
      code: `function solve(s, t) {
  if (s.length !== t.length) return false;
  const m = new Map();
  for (let i = 0; i < s.length; i++) {
    if (m.has(s[i]) && m.get(s[i]) !== t[i]) return false;
    m.set(s[i], t[i]);
  }
  return true;
}`,
    },
    source: 'classic:isomorphic-strings (own wording)',
  }),

  P({
    slug: 'roman-to-integer',
    title: 'Roman to Integer',
    statement:
      'Roman numerals use the symbols I(1), V(5), X(10), L(50), C(100), D(500), M(1000). ' +
      'A smaller value before a larger one means subtraction (IV=4, IX=9, XL=40, XC=90, CD=400, ' +
      'CM=900). Given a valid roman numeral string s, return its integer value.',
    examples: [
      { input: 's = "III"', output: '3' },
      { input: 's = "LVIII"', output: '58' },
      { input: 's = "MCMXCIV"', output: '1994' },
    ],
    constraints: ['1 <= s.length <= 15', 's is a valid roman numeral'],
    params: [{ name: 's', type: 'string' }],
    returnType: 'int',
    topics: ['strings', 'hash-map'],
    tests: [
      T(['III'], 3),
      T(['LVIII'], 58),
      T(['MCMXCIV'], 1994),
      T(['IV'], 4, true),
      T(['IX'], 9, true),
      T(['MMXXVI'], 2026, true),
    ],
    reference: {
      javascript: `function solve(s) {
  const v = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const cur = v[s[i]], next = v[s[i + 1]] || 0;
    total += cur < next ? -cur : cur;
  }
  return total;
}`,
      python: `def solve(s):
    v = {'I': 1, 'V': 5, 'X': 10, 'L': 50, 'C': 100, 'D': 500, 'M': 1000}
    total = 0
    for i, ch in enumerate(s):
        cur = v[ch]
        nxt = v[s[i + 1]] if i + 1 < len(s) else 0
        total += -cur if cur < nxt else cur
    return total`,
      cpp: `int solve(string s) {
    unordered_map<char, int> v = {{'I',1},{'V',5},{'X',10},{'L',50},{'C',100},{'D',500},{'M',1000}};
    int total = 0;
    for (size_t i = 0; i < s.size(); i++) {
        int cur = v[s[i]];
        int nxt = (i + 1 < s.size()) ? v[s[i + 1]] : 0;
        total += (cur < nxt) ? -cur : cur;
    }
    return total;
}`,
    },
    oracle: {
      language: 'javascript',
      note: 'Right-to-left scan tracking the max seen — different algorithm.',
      code: `function solve(s) {
  const v = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let total = 0, seen = 0;
  for (let i = s.length - 1; i >= 0; i--) {
    const cur = v[s[i]];
    total += cur < seen ? -cur : cur;
    if (cur > seen) seen = cur;
  }
  return total;
}`,
    },
    wrong: {
      language: 'javascript',
      note: 'Adds every symbol value: ignores subtractive notation entirely.',
      code: `function solve(s) {
  const v = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  return [...s].reduce((t, ch) => t + v[ch], 0);
}`,
    },
    source: 'classic:roman-to-integer (own wording)',
  }),

  P({
    slug: 'add-strings',
    title: 'Add Strings',
    statement:
      'Given two non-negative integers num1 and num2 represented as strings, return their sum ' +
      'as a string. You must not convert the inputs directly into integers (they may be very long).',
    examples: [
      { input: 'num1 = "11", num2 = "123"', output: '"134"' },
      { input: 'num1 = "456", num2 = "77"', output: '"533"' },
    ],
    constraints: ['1 <= num1.length, num2.length <= 10^4'],
    params: [
      { name: 'num1', type: 'string' },
      { name: 'num2', type: 'string' },
    ],
    returnType: 'string',
    topics: ['strings', 'math'],
    tests: [
      T(['11', '123'], '134'),
      T(['456', '77'], '533'),
      T(['0', '0'], '0'),
      T(['999', '1'], '1000', true),
      T(['1', '99999999999999999999'], '100000000000000000000', true),
      T(['999', '999'], '1998', true),
    ],
    reference: {
      javascript: `function solve(num1, num2) {
  let i = num1.length - 1, j = num2.length - 1, carry = 0, out = '';
  while (i >= 0 || j >= 0 || carry) {
    const d = (i >= 0 ? +num1[i--] : 0) + (j >= 0 ? +num2[j--] : 0) + carry;
    out = (d % 10) + out;
    carry = Math.floor(d / 10);
  }
  return out;
}`,
      python: `def solve(num1, num2):
    i, j, carry, out = len(num1) - 1, len(num2) - 1, 0, []
    while i >= 0 or j >= 0 or carry:
        d = (ord(num1[i]) - 48 if i >= 0 else 0) + (ord(num2[j]) - 48 if j >= 0 else 0) + carry
        out.append(chr(d % 10 + 48))
        carry = d // 10
        i -= 1
        j -= 1
    return ''.join(reversed(out))`,
      cpp: `string solve(string num1, string num2) {
    int i = (int)num1.size() - 1, j = (int)num2.size() - 1, carry = 0;
    string out;
    while (i >= 0 || j >= 0 || carry) {
        int d = (i >= 0 ? num1[i--] - '0' : 0) + (j >= 0 ? num2[j--] - '0' : 0) + carry;
        out += char('0' + d % 10);
        carry = d / 10;
    }
    reverse(out.begin(), out.end());
    return out;
}`,
    },
    oracle: {
      language: 'javascript',
      note: 'Digit-array addition — different implementation.',
      code: `function solve(num1, num2) {
  const a = [...num1].reverse().map(Number), b = [...num2].reverse().map(Number);
  const out = [];
  let carry = 0;
  for (let i = 0; i < Math.max(a.length, b.length) || carry; i++) {
    const d = (a[i] || 0) + (b[i] || 0) + carry;
    out.push(d % 10);
    carry = Math.floor(d / 10);
  }
  return out.reverse().join('');
}`,
    },
    wrong: {
      language: 'javascript',
      note: 'Drops the carry between digit positions (fails 999+1).',
      code: `function solve(num1, num2) {
  const n = Math.max(num1.length, num2.length);
  const a = num1.padStart(n, '0'), b = num2.padStart(n, '0');
  let out = '';
  for (let i = n - 1; i >= 0; i--) {
    const d = Number(a[i]) + Number(b[i]);
    out = String(d % 10) + out;
  }
  return out.replace(/^0+/, '') || '0';
}`,
    },
    source: 'classic:add-strings (own wording)',
  }),
];
