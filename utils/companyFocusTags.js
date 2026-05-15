/**
 * Derives card "focus tags" from visit Must Do topics (cluster-merged on company list).
 * - Short curated topics → shown as-is on the card.
 * - Long / sentence-like topics → short labels via keyword matching (tech + campus).
 */

const TECH_KEYWORDS = [
  "arrays",
  "linked lists",
  "stacks",
  "queues",
  "trees",
  "graphs",
  "heaps",
  "hashing",
  "recursion",
  "backtracking",
  "dynamic programming",
  "dp",
  "greedy",
  "sorting",
  "searching",
  "bit manipulation",
  "string matching",
  "tries",
  "segment trees",
  "sliding window",
  "two pointers",
  "bfs",
  "dfs",
  "topological sort",
  "dijkstra",
  "operating systems",
  "os",
  "dbms",
  "sql",
  "nosql",
  "mongodb",
  "computer networks",
  "tcp/ip",
  "oops",
  "object oriented programming",
  "system design",
  "lld",
  "hld",
  "memory management",
  "virtual memory",
  "deadlocks",
  "indexing",
  "normalization",
  "transactions",
  "acid properties",
  "rest api",
  "microservices",
  "docker",
  "java",
  "python",
  "cpp",
  "c++",
  "javascript",
  "react",
  "node.js",
  "aws",
  "cloud",
  "machine learning",
  "ml",
  "artificial intelligence",
  "ai",
  "deep learning",
  "nlp",
  "computer vision",
  "statistics",
  "data science",
  "neural networks",
];

/** Campus / placement prep terms not covered well by DSA–only keywords. */
const CAMPUS_KEYWORDS = [
  "aptitude",
  "quantitative aptitude",
  "verbal ability",
  "logical reasoning",
  "puzzles",
  "puzzle",
  "communication skills",
  "communication",
  "soft skills",
  "behavioral",
  "hr interview",
  "core fundamentals",
  "cs fundamentals",
  "competitive programming",
  "leetcode",
  "coding practice",
  "technical aptitude",
  "group discussion",
  "gd",
];

const ALL_KEYWORDS = [...CAMPUS_KEYWORDS, ...TECH_KEYWORDS];

const SHORT_TOKEN_KEYWORDS = new Set([
  "os",
  "ai",
  "ml",
  "dp",
  "bfs",
  "dfs",
  "lld",
  "hld",
  "sql",
  "cpp",
  "gd",
]);

/** Max chars for a must-do line to display verbatim on a card chip. */
const MAX_SHORT_TOPIC_CHARS = 48;
/** Max words for a short chip (above → keyword extraction). */
const MAX_SHORT_TOPIC_WORDS = 6;

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function keywordRegex(keyword) {
  const normalized = String(keyword || "").trim().toLowerCase();
  if (!normalized) return null;

  if (normalized.includes("/")) {
    return new RegExp(`(?<![a-z0-9])${escapeRegExp(normalized)}(?![a-z0-9])`, "i");
  }

  if (SHORT_TOKEN_KEYWORDS.has(normalized)) {
    return new RegExp(`\\b${escapeRegExp(normalized)}\\b`, "i");
  }

  if (normalized.includes(" ")) {
    const words = normalized
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => escapeRegExp(w));
    return new RegExp(`\\b${words.join("[^a-z0-9]+")}\\b`, "i");
  }

  return new RegExp(`\\b${escapeRegExp(normalized)}\\b`, "i");
}

function formatKeywordLabel(keyword) {
  return String(keyword || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      if (w.length <= 4 && w === w.toUpperCase()) return w;
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}

/**
 * @param {string} topic
 * @returns {boolean}
 */
function isLongFormTopic(topic) {
  const s = String(topic || "").trim();
  if (!s) return true;
  if (s.length > MAX_SHORT_TOPIC_CHARS) return true;
  if (/[.?!]/.test(s)) return true;
  const wordCount = s.split(/\s+/).filter(Boolean).length;
  return wordCount > MAX_SHORT_TOPIC_WORDS;
}

/**
 * @param {string} topic
 * @returns {string|null}
 */
function normalizeShortTopicChip(topic) {
  const s = String(topic || "").trim();
  if (!s || isLongFormTopic(s)) return null;
  if (/^[A-Z0-9][A-Z0-9\s/+.&-]{0,20}$/.test(s)) return s;
  return formatKeywordLabel(s);
}

/**
 * @param {Record<string, unknown>|null|undefined} company
 * @returns {string[]}
 */
function getMustDoTopics(company) {
  const raw = company?.Must_Do_Topics ?? company?.must_do_topics ?? [];
  if (!Array.isArray(raw)) return [];

  const seen = new Set();
  const out = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/**
 * Join must-do lines for broad keyword / fallback scans.
 * @param {Record<string, unknown>|null|undefined} company
 * @returns {string}
 */
function getAnalyzableText(company) {
  return getMustDoTopics(company).join(" ").toLowerCase();
}

/**
 * @param {string} text
 * @param {{ addTag: (label: string) => boolean, maxTags: number }} ctx
 */
function extractKeywordTagsFromText(text, ctx) {
  const lower = String(text || "").toLowerCase();
  if (!lower.trim()) return;

  let added = 0;
  const tryAdd = (label) => {
    if (added >= ctx.maxTags) return;
    if (ctx.addTag(label)) added += 1;
  };

  for (const kw of ALL_KEYWORDS) {
    if (added >= ctx.maxTags) break;
    const pattern = keywordRegex(kw);
    if (!pattern || !pattern.test(lower)) continue;
    tryAdd(formatKeywordLabel(kw));
  }

  if (added < ctx.maxTags && /\bdsa\b|\balgorithms?\b/i.test(lower)) {
    tryAdd("DSA");
  }
  if (added < ctx.maxTags && /\bfundamentals?\b|\bcore\s+cs\b/i.test(lower)) {
    tryAdd("CS Fundamentals");
  }
}

/**
 * @param {Object} company - Merged company + visit (Must_Do_Topics populated on list)
 * @returns {string[]}
 */
function getCompanyFocusTags(company) {
  const topics = getMustDoTopics(company);
  /** @type {string[]} */
  const tags = [];
  const seen = new Set();

  const addTag = (label) => {
    const trimmed = String(label || "").trim();
    if (!trimmed) return false;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    tags.push(trimmed);
    return true;
  };

  for (const topic of topics) {
    if (tags.length >= 3) break;

    if (isLongFormTopic(topic)) {
      extractKeywordTagsFromText(topic, {
        addTag,
        maxTags: 3 - tags.length,
      });
    } else {
      const chip = normalizeShortTopicChip(topic);
      if (chip) addTag(chip);
    }
  }

  if (tags.length === 0 && topics.length > 0) {
    extractKeywordTagsFromText(topics.join(" "), {
      addTag,
      maxTags: 3,
    });
  }

  return tags.length > 0 ? tags.slice(0, 3) : ["General"];
}

export {
  getCompanyFocusTags,
  getAnalyzableText,
  getMustDoTopics,
  isLongFormTopic,
  normalizeShortTopicChip,
};
