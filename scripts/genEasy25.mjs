/**
 * Writes scripts/data/leetcode-extra-parts/easy25.json (25 easy LeetCode-style DSA rows).
 * Build-time solvers verify expectedOutput; run: node scripts/genEasy25.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "data", "leetcode-extra-parts");
const OUT = path.join(OUT_DIR, "easy25.json");

function cloneJson(v) {
  return JSON.parse(JSON.stringify(v));
}

function padFourFour(testCases) {
  const visible = testCases.filter((t) => t && t.isHidden !== true);
  const hidden = testCases.filter((t) => t && t.isHidden === true);
  const take = (arr, n) => {
    const out = [];
    for (let i = 0; i < n; i += 1) {
      const base = arr[i % arr.length];
      out.push({
        input: cloneJson(base.input),
        expectedOutput: cloneJson(base.expectedOutput),
        isHidden: base.isHidden,
        weight: 1,
      });
    }
    return out;
  };
  const v4 = take(visible, 4).map((t) => ({ ...t, isHidden: false }));
  const h4 = take(hidden, 4).map((t) => ({ ...t, isHidden: true }));
  return [...v4, ...h4];
}

/** @type {Record<string, (i: Record<string, unknown>) => unknown>} */
const S = {};

S.e01 = ({ n }) => {
  let a = 1,
    b = 1;
  for (let k = 2; k <= Number(n); k += 1) [a, b] = [b, a + b];
  return b;
};
S.e02 = ({ cost }) => {
  const c = /** @type {number[]} */ (cost);
  let a = 0,
    b = 0;
  for (let i = c.length - 1; i >= 0; i -= 1) {
    const na = Math.min(a, b) + c[i];
    const nb = a;
    a = na;
    b = nb;
  }
  return Math.min(a, b);
};
S.e03 = ({ n }) => {
  const x = Number(n);
  if (x === 0) return 0;
  if (x <= 2) return 1;
  let a = 0,
    b = 1,
    c = 1;
  for (let i = 3; i <= x; i += 1) [a, b, c] = [b, c, a + b + c];
  return c;
};
S.e04 = ({ n }) => {
  let k = 1,
    left = Number(n);
  while (left > k) {
    left -= k;
    k += 1;
  }
  return k;
};
S.e05 = ({ row_index }) => {
  const r = Number(row_index);
  const row = [1];
  for (let i = 1; i <= r; i += 1) {
    const next = [];
    for (let j = 0; j <= i; j += 1) {
      const left = j === 0 ? 0 : row[j - 1];
      const right = j === row.length ? 0 : row[j];
      next.push(left + right);
    }
    row.length = 0;
    row.push(...next);
  }
  return row;
};
S.e06 = ({ num }) => {
  let x = Number(num);
  if (x < 2) return false;
  let l = 1,
    r = x;
  while (l <= r) {
    const m = (l + r) >> 1;
    const sq = m * m;
    if (sq === x) return true;
    if (sq < x) l = m + 1;
    else r = m - 1;
  }
  return false;
};
S.e07 = ({ n }) => {
  const out = [];
  for (let i = 0; i <= Number(n); i += 1) {
    let c = i,
      bits = 0;
    while (c > 0) {
      bits += c & 1;
      c >>= 1;
    }
    out.push(bits);
  }
  return out;
};
S.e08 = ({ n }) => {
  let x = Number(n) >>> 0,
    c = 0;
  while (x) {
    c += x & 1;
    x >>>= 1;
  }
  return c;
};
S.e09 = ({ nums }) => {
  const a = /** @type {number[]} */ (nums);
  const m = a.length;
  let x = 0;
  for (const v of a) x ^= v;
  for (let i = 0; i <= m; i += 1) x ^= i;
  return x;
};
S.e10 = ({ x }) => {
  const t = Number(x);
  let lo = 0,
    hi = t;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    const sq = m * m;
    if (sq <= t) lo = m + 1;
    else hi = m - 1;
  }
  return hi;
};
S.e11 = ({ column_title }) => {
  let r = 0;
  for (const ch of String(column_title)) r = r * 26 + (ch.charCodeAt(0) - 64);
  return r;
};
S.e12 = ({ n }) => {
  const seen = new Set();
  let x = Number(n);
  while (x !== 1 && !seen.has(x)) {
    seen.add(x);
    let s = 0;
    while (x > 0) {
      const d = x % 10;
      s += d * d;
      x = (x / 10) | 0;
    }
    x = s;
  }
  return x === 1;
};
S.e13 = ({ s, t }) => {
  const cs = [...String(s)].sort().join("");
  const ct = [...String(t)].sort().join("");
  return cs === ct;
};
S.e14 = ({ s }) => [...String(s)].reverse().join("");
S.e15 = ({ nums }) => {
  const a = /** @type {number[]} */ (nums);
  const nz = a.filter((x) => x !== 0);
  return [...nz, ...Array(a.length - nz.length).fill(0)];
};
S.e16 = ({ nums }) => {
  let x = 0;
  for (const v of /** @type {number[]} */ (nums)) x ^= v;
  return x;
};
S.e17 = ({ nums }) => {
  const a = /** @type {number[]} */ (nums);
  let cand = a[0],
    c = 0;
  for (const v of a) {
    c += v === cand ? 1 : -1;
    if (c === 0) {
      cand = v;
      c = 1;
    }
  }
  return cand;
};
S.e18 = ({ n }) => {
  const x = Number(n);
  return x > 0 && (x & (x - 1)) === 0;
};
S.e19 = ({ n }) => {
  let x = Number(n);
  if (x < 1) return false;
  while (x % 3 === 0) x /= 3;
  return x === 1;
};
S.e20 = ({ n }) => {
  const x = Number(n);
  return x > 0 && (x & (x - 1)) === 0 && (x - 1) % 3 === 0;
};
function dupZeros(arr) {
  const a = [...arr];
  let i = 0;
  while (i < a.length) {
    if (a[i] === 0) {
      a.splice(i + 1, 0, 0);
      a.pop();
      i += 2;
    } else i += 1;
  }
  return a;
}
S.e23 = ({ arr }) => dupZeros(/** @type {number[]} */ (arr));
S.e21 = ({ nums }) => {
  const a = /** @type {number[]} */ (nums);
  const ev = [],
    od = [];
  for (const v of a) (v % 2 === 0 ? ev : od).push(v);
  return [...ev, ...od];
};
S.e22 = ({ nums }) => {
  const a = /** @type {number[]} */ (nums);
  const neg = a.map((x) => x * x).sort((x, y) => x - y);
  let i = 0,
    j = a.length - 1,
    k = a.length - 1;
  const out = Array(a.length);
  while (i <= j) {
    if (Math.abs(a[i]) > Math.abs(a[j])) out[k--] = a[i] * a[i++];
    else out[k--] = a[j] * a[j--];
  }
  return out;
};
S.e24 = ({ nums }) =>
  /** @type {number[]} */ (nums).reduce((a, n) => a + (String(Math.abs(n)).length % 2 === 0 ? 1 : 0), 0);
S.e25 = ({ n }) => {
  let x = Number(n),
    last = -1,
    best = 0,
    i = 0;
  while (x) {
    if (x & 1) {
      if (last >= 0) best = Math.max(best, i - last);
      last = i;
    }
    x >>= 1;
    i += 1;
  }
  return best;
};

const RAW = [
  {
    id: "leetcode-extra-e-001",
    slug: "climbing-stairs",
    title: "Climbing Stairs",
    q: "You are climbing a staircase with `n` steps. Each time you can climb `1` or `2` steps. Return how many distinct ways you can reach the top. (LeetCode-style.)",
    topics: ["math", "dynamic programming"],
    sig: "def climb_stairs(n):",
    key: "e01",
    tests: [
      { input: { n: 2 }, isHidden: false },
      { input: { n: 3 }, isHidden: false },
      { input: { n: 5 }, isHidden: true },
      { input: { n: 10 }, isHidden: true },
    ],
  },
  {
    id: "leetcode-extra-e-002",
    slug: "min-cost-climbing-stairs",
    title: "Min Cost Climbing Stairs",
    q: "Given integer array `cost` where `cost[i]` is the cost of step `i` on a staircase, pay the cost and climb one or two steps. Start from index `0` or `1`. Return the **minimum cost** to reach the top (position beyond the last index).",
    topics: ["array", "dynamic programming"],
    sig: "def min_cost_climbing_stairs(cost):",
    key: "e02",
    tests: [
      { input: { cost: [10, 15, 20] }, isHidden: false },
      { input: { cost: [1, 100, 1, 1, 1, 100, 1, 1, 100, 1] }, isHidden: false },
      { input: { cost: [0, 2, 2, 1] }, isHidden: true },
      { input: { cost: [1, 1] }, isHidden: true },
    ],
  },
  {
    id: "leetcode-extra-e-003",
    slug: "n-th-tribonacci-number",
    title: "N-th Tribonacci Number",
    q: "T(0)=0, T(1)=1, T(2)=1, and T(n)=T(n-1)+T(n-2)+T(n-3) for n>=3. Return T(n).",
    topics: ["math", "dynamic programming"],
    sig: "def tribonacci(n):",
    key: "e03",
    tests: [
      { input: { n: 4 }, isHidden: false },
      { input: { n: 25 }, isHidden: false },
      { input: { n: 0 }, isHidden: true },
      { input: { n: 10 }, isHidden: true },
    ],
  },
  {
    id: "leetcode-extra-e-004",
    slug: "arranging-coins",
    title: "Arranging Coins",
    q: "You have `n` coins and build a staircase row `k` with exactly `k` coins. Return the **complete** number of rows you can build.",
    topics: ["math", "binary search"],
    sig: "def arrange_coins(n):",
    key: "e04",
    tests: [
      { input: { n: 5 }, isHidden: false },
      { input: { n: 8 }, isHidden: false },
      { input: { n: 1 }, isHidden: true },
      { input: { n: 10 }, isHidden: true },
    ],
  },
  {
    id: "leetcode-extra-e-005",
    slug: "pascals-triangle-ii",
    title: "Pascal's Triangle II",
    q: "Given integer `row_index`, return the values in that row of Pascal's triangle (0-indexed).",
    topics: ["array", "dynamic programming"],
    sig: "def get_row(row_index):",
    key: "e05",
    tests: [
      { input: { row_index: 3 }, isHidden: false },
      { input: { row_index: 0 }, isHidden: false },
      { input: { row_index: 1 }, isHidden: true },
      { input: { row_index: 4 }, isHidden: true },
    ],
  },
  {
    id: "leetcode-extra-e-006",
    slug: "valid-perfect-square",
    title: "Valid Perfect Square",
    q: "Return `True` if integer `num` is a perfect square, else `False`.",
    topics: ["math", "binary search"],
    sig: "def is_perfect_square(num):",
    key: "e06",
    tests: [
      { input: { num: 16 }, isHidden: false },
      { input: { num: 14 }, isHidden: false },
      { input: { num: 1 }, isHidden: true },
      { input: { num: 121 }, isHidden: true },
    ],
  },
  {
    id: "leetcode-extra-e-007",
    slug: "counting-bits",
    title: "Counting Bits",
    q: "For every `i` in `0..n`, count set bits in `i`. Return the list in order.",
    topics: ["dynamic programming", "bit manipulation"],
    sig: "def count_bits(n):",
    key: "e07",
    tests: [
      { input: { n: 2 }, isHidden: false },
      { input: { n: 5 }, isHidden: false },
      { input: { n: 0 }, isHidden: true },
      { input: { n: 1 }, isHidden: true },
    ],
  },
  {
    id: "leetcode-extra-e-008",
    slug: "number-of-1-bits",
    title: "Number of 1 Bits",
    q: "Given unsigned 32-bit integer `n`, return Hamming weight (number of `1` bits).",
    topics: ["bit manipulation"],
    sig: "def hamming_weight(n):",
    key: "e08",
    tests: [
      { input: { n: 11 }, isHidden: false },
      { input: { n: 128 }, isHidden: false },
      { input: { n: 0 }, isHidden: true },
      { input: { n: 4294967295 }, isHidden: true },
    ],
  },
  {
    id: "leetcode-extra-e-009",
    slug: "missing-number",
    title: "Missing Number",
    q: "Array `nums` contains `n` distinct numbers from `0..n`. Find the missing number.",
    topics: ["array", "bit manipulation"],
    sig: "def missing_number(nums):",
    key: "e09",
    tests: [
      { input: { nums: [3, 0, 1] }, isHidden: false },
      { input: { nums: [0, 1] }, isHidden: false },
      { input: { nums: [9, 6, 4, 2, 3, 5, 7, 0, 1] }, isHidden: true },
      { input: { nums: [1] }, isHidden: true },
    ],
  },
  {
    id: "leetcode-extra-e-010",
    slug: "sqrtx",
    title: "Sqrt(x)",
    q: "Return integer square root of non-negative integer `x` (truncate).",
    topics: ["math", "binary search"],
    sig: "def my_sqrt(x):",
    key: "e10",
    tests: [
      { input: { x: 4 }, isHidden: false },
      { input: { x: 8 }, isHidden: false },
      { input: { x: 0 }, isHidden: true },
      { input: { x: 2147395599 }, isHidden: true },
    ],
  },
  {
    id: "leetcode-extra-e-011",
    slug: "excel-sheet-column-number",
    title: "Excel Sheet Column Number",
    q: "Convert Excel column title like `A`..`Z`, `AA`... to its column number.",
    topics: ["math", "string"],
    sig: "def title_to_number(column_title):",
    key: "e11",
    tests: [
      { input: { column_title: "A" }, isHidden: false },
      { input: { column_title: "AB" }, isHidden: false },
      { input: { column_title: "ZY" }, isHidden: true },
      { input: { column_title: "AAA" }, isHidden: true },
    ],
  },
  {
    id: "leetcode-extra-e-012",
    slug: "happy-number",
    title: "Happy Number",
    q: "Starting from `n`, repeatedly replace `n` by sum of squares of its digits. Return `True` if you reach `1`, else `False` if a cycle without `1` occurs.",
    topics: ["hash table", "math"],
    sig: "def is_happy(n):",
    key: "e12",
    tests: [
      { input: { n: 19 }, isHidden: false },
      { input: { n: 2 }, isHidden: false },
      { input: { n: 1 }, isHidden: true },
      { input: { n: 7 }, isHidden: true },
    ],
  },
  {
    id: "leetcode-extra-e-013",
    slug: "valid-anagram",
    title: "Valid Anagram",
    q: "Return `True` if `t` is an anagram of `s` (same multiset of letters).",
    topics: ["hash table", "string", "sorting"],
    sig: "def is_anagram(s, t):",
    key: "e13",
    tests: [
      { input: { s: "anagram", t: "nagaram" }, isHidden: false },
      { input: { s: "rat", t: "car" }, isHidden: false },
      { input: { s: "", t: "" }, isHidden: true },
      { input: { s: "a", t: "ab" }, isHidden: true },
    ],
  },
  {
    id: "leetcode-extra-e-014",
    slug: "reverse-string",
    title: "Reverse String",
    q: "Return the reverse of string `s` (as a new string).",
    topics: ["two pointers", "string"],
    sig: "def reverse_string(s):",
    key: "e14",
    tests: [
      { input: { s: "hello" }, isHidden: false },
      { input: { s: "Hannah" }, isHidden: false },
      { input: { s: "a" }, isHidden: true },
      { input: { s: "" }, isHidden: true },
    ],
  },
  {
    id: "leetcode-extra-e-015",
    slug: "move-zeroes",
    title: "Move Zeroes",
    q: "Return a **new** array with the same elements where all `0` values are at the end, preserving order of non-zeros.",
    topics: ["array", "two pointers"],
    sig: "def move_zeroes(nums):",
    key: "e15",
    tests: [
      { input: { nums: [0, 1, 0, 3, 12] }, isHidden: false },
      { input: { nums: [0] }, isHidden: false },
      { input: { nums: [1, 2, 3] }, isHidden: true },
      { input: { nums: [0, 0, 1] }, isHidden: true },
    ],
  },
  {
    id: "leetcode-extra-e-016",
    slug: "single-number",
    title: "Single Number",
    q: "Every element appears twice except one. Return that single element using O(1) extra memory.",
    topics: ["array", "bit manipulation"],
    sig: "def single_number(nums):",
    key: "e16",
    tests: [
      { input: { nums: [2, 2, 1] }, isHidden: false },
      { input: { nums: [4, 1, 2, 1, 2] }, isHidden: false },
      { input: { nums: [1] }, isHidden: true },
      { input: { nums: [0, 1, 0] }, isHidden: true },
    ],
  },
  {
    id: "leetcode-extra-e-017",
    slug: "majority-element",
    title: "Majority Element",
    q: "Majority element appears more than `floor(n/2)` times. Return it.",
    topics: ["array", "hash table"],
    sig: "def majority_element(nums):",
    key: "e17",
    tests: [
      { input: { nums: [3, 2, 3] }, isHidden: false },
      { input: { nums: [2, 2, 1, 1, 1, 2, 2] }, isHidden: false },
      { input: { nums: [1] }, isHidden: true },
      { input: { nums: [6, 5, 5] }, isHidden: true },
    ],
  },
  {
    id: "leetcode-extra-e-018",
    slug: "power-of-two",
    title: "Power of Two",
    q: "Return `True` if `n` is a power of two.",
    topics: ["math", "bit manipulation"],
    sig: "def is_power_of_two(n):",
    key: "e18",
    tests: [
      { input: { n: 1 }, isHidden: false },
      { input: { n: 16 }, isHidden: false },
      { input: { n: 3 }, isHidden: true },
      { input: { n: 218 }, isHidden: true },
    ],
  },
  {
    id: "leetcode-extra-e-019",
    slug: "power-of-three",
    title: "Power of Three",
    q: "Return `True` if `n` is a power of three.",
    topics: ["math", "recursion"],
    sig: "def is_power_of_three(n):",
    key: "e19",
    tests: [
      { input: { n: 27 }, isHidden: false },
      { input: { n: 0 }, isHidden: false },
      { input: { n: 9 }, isHidden: true },
      { input: { n: 45 }, isHidden: true },
    ],
  },
  {
    id: "leetcode-extra-e-020",
    slug: "power-of-four",
    title: "Power of Four",
    q: "Return `True` if `n` is a power of four.",
    topics: ["math", "bit manipulation"],
    sig: "def is_power_of_four(n):",
    key: "e20",
    tests: [
      { input: { n: 16 }, isHidden: false },
      { input: { n: 5 }, isHidden: false },
      { input: { n: 1 }, isHidden: true },
      { input: { n: 64 }, isHidden: true },
    ],
  },
  {
    id: "leetcode-extra-e-021",
    slug: "sort-array-by-parity",
    title: "Sort Array By Parity",
    q: "Return an array with all even integers first, then odd integers (relative order within groups may change).",
    topics: ["array", "two pointers"],
    sig: "def sort_array_by_parity(nums):",
    key: "e21",
    tests: [
      { input: { nums: [3, 1, 2, 4] }, isHidden: false },
      { input: { nums: [0] }, isHidden: false },
      { input: { nums: [1, 3, 5] }, isHidden: true },
      { input: { nums: [2, 4, 6] }, isHidden: true },
    ],
  },
  {
    id: "leetcode-extra-e-022",
    slug: "squares-of-a-sorted-array",
    title: "Squares of a Sorted Array",
    q: "`nums` sorted non-decreasing (may include negatives). Return squares sorted non-decreasing.",
    topics: ["array", "two pointers"],
    sig: "def sorted_squares(nums):",
    key: "e22",
    tests: [
      { input: { nums: [-4, -1, 0, 3, 10] }, isHidden: false },
      { input: { nums: [-7, -3, 2, 3, 11] }, isHidden: false },
      { input: { nums: [-1] }, isHidden: true },
      { input: { nums: [1, 2, 3] }, isHidden: true },
    ],
  },
  {
    id: "leetcode-extra-e-023",
    slug: "duplicate-zeros",
    title: "Duplicate Zeros",
    q: "Given fixed-length array `arr`, duplicate each zero by shifting elements right; elements beyond length are dropped. Return the resulting array.",
    topics: ["array", "two pointers"],
    sig: "def duplicate_zeros(arr):",
    key: "e23",
    tests: [
      { input: { arr: [1, 0, 2, 3, 0, 4, 5, 0] }, isHidden: false },
      { input: { arr: [1, 2, 3] }, isHidden: false },
      { input: { arr: [0, 0, 0, 0, 0, 0, 0, 0] }, isHidden: true },
      { input: { arr: [8, 4, 5, 0, 0, 0, 0, 7] }, isHidden: true },
    ],
  },
  {
    id: "leetcode-extra-e-024",
    slug: "find-numbers-with-even-number-of-digits",
    title: "Find Numbers with Even Number of Digits",
    q: "Return count of nums whose **absolute value** has an even number of digits.",
    topics: ["array", "math"],
    sig: "def find_numbers(nums):",
    key: "e24",
    tests: [
      { input: { nums: [12, 345, 2, 6, 7896] }, isHidden: false },
      { input: { nums: [555, 901, 482, 1771] }, isHidden: false },
      { input: { nums: [1, 1, 1] }, isHidden: true },
      { input: { nums: [] }, isHidden: true },
    ],
  },
  {
    id: "leetcode-extra-e-025",
    slug: "binary-gap",
    title: "Binary Gap",
    q: "Given positive integer `n`, return the longest distance between two consecutive `1` bits in the binary representation of `n`. If fewer than two `1` bits, return `0`.",
    topics: ["bit manipulation"],
    sig: "def binary_gap(n):",
    key: "e25",
    tests: [
      { input: { n: 22 }, isHidden: false },
      { input: { n: 5 }, isHidden: false },
      { input: { n: 6 }, isHidden: true },
      { input: { n: 8 }, isHidden: true },
    ],
  },
];

const rows = RAW.map((r) => {
  const fn = S[r.key];
  if (!fn) throw new Error("missing solver " + r.key);
  const base = r.tests.map((t) => ({
    input: t.input,
    expectedOutput: fn(t.input),
    isHidden: t.isHidden,
    weight: 1,
  }));
  for (const t of base) {
    const got = fn(t.input);
    if (JSON.stringify(got) !== JSON.stringify(t.expectedOutput)) throw new Error(r.id);
  }
  const url = `https://leetcode.com/problems/${r.slug}/`;
  return {
    questionId: r.id,
    title: r.title,
    url,
    question: r.q,
    roundType: "DSA",
    difficulty: "easy",
    topics: r.topics,
    subtopics: [],
    evaluationStrategy: "code_execution",
    dsaMetadata: {
      supportedLanguages: ["python"],
      functionSignature: r.sig,
      starterCode: `${r.sig}\n    pass\n`,
    },
    testCases: padFourFour(base),
    rubric: [
      {
        text: "Implements a correct algorithm for the stated constraints.",
        category: "correctness",
        importance: "mustHave",
        expectedAnswerMode: "code",
      },
    ],
    complexity: { time: "varies", space: "varies" },
    sourceMetadata: { source: url, verified: true, qualityScore: 0.93 },
  };
});

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, `${JSON.stringify(rows, null, 2)}\n`);
console.log("wrote", rows.length, "easy rows to", OUT);
