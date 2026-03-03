/**
 * Derives focus tags for a company by analyzing interview process,
 * interview questions, OA questions, and must-do topics.
 * Used on company cards to show what the company mainly focuses on (DSA, CS Fundamentals, ML, etc.).
 */

const DSA_KEYWORDS = [
  "dsa", "data structure", "data structures", "algorithm", "algorithms",
  "array", "arrays", "tree", "trees", "graph", "graphs", "dynamic programming", "dp",
  "recursion", "recursive", "sorting", "linked list", "stack", "queue", "heap",
  "binary search", "backtracking", "greedy", "hash", "hashmap", "hash map",
  "bst", "binary tree", "bfs", "dfs", "traversal", "string", "subarray",
  "subsequence", "sliding window", "two pointer", "prefix sum", "trie",
  "segment tree", "bit manipulation", "leetcode", "codeforces", "competitive programming",
];

const CS_FUNDAMENTALS_KEYWORDS = [
  "os", "operating system", "dbms", "database", "sql", "networking",
  "computer network", "oop", "object oriented", "system design", "low level design",
  "lld", "hld", "high level design", "computer architecture", "process", "thread",
  "threading", "synchronization", "deadlock", "memory management", "cpu",
  "cache", "indexing", "transaction", "acid", "normalization", "sql query",
  "networks", "tcp", "ip", "http", "rest", "api design", "scalability",
  "load balancing", "microservices", "distributed system",
];

const ML_KEYWORDS = [
  "machine learning", "ml", "deep learning", "neural network", "nlp",
  "natural language", "computer vision", "ai", "artificial intelligence",
  "statistics", "probability", "regression", "classification", "clustering",
  "tensorflow", "pytorch", "keras", "model", "training", "inference",
  "supervised", "unsupervised", "reinforcement", "cnn", "rnn", "transformer",
  "data science", "feature", "gradient", "optimization", "overfitting",
];

/**
 * Collects all analyzable text from a company document into a single lowercase string.
 * @param {Object} company - Company document (plain object or mongoose doc)
 * @returns {string}
 */
function getAnalyzableText(company) {
  if (!company) return "";
  const parts = [];

  // Interview process: can be array of strings or single string (legacy)
  const process = company.interviewProcess;
  if (Array.isArray(process)) {
    process.forEach((p) => {
      if (typeof p === "string") parts.push(p);
      else if (p && typeof p === "object" && p.content) parts.push(p.content);
    });
  } else if (typeof process === "string") {
    parts.push(process);
  }

  // Interview questions
  const iq = company.interviewQuestions;
  if (Array.isArray(iq)) {
    iq.forEach((q) => {
      if (typeof q === "string") parts.push(q);
      else if (q && typeof q === "object" && q.question) parts.push(q.question);
    });
  }

  // Must do topics
  const mustDo = company.Must_Do_Topics || company.must_do_topics || company.mustDoTopics;
  if (Array.isArray(mustDo)) {
    mustDo.forEach((t) => {
      if (typeof t === "string") parts.push(t);
    });
  }

  // OA / online questions (optional, still useful for "coding" vs "theory")
  const oa = company.onlineQuestions;
  if (Array.isArray(oa)) {
    oa.forEach((q) => {
      if (typeof q === "string") parts.push(q);
      else if (q && typeof q === "object" && q.question) parts.push(q.question);
    });
  }

  return parts.join(" ").toLowerCase();
}

/**
 * Counts how many keywords from the given list appear in the text.
 * @param {string} text - Lowercase concatenated text
 * @param {string[]} keywords - Lowercase keywords
 * @returns {number}
 */
function countKeywordMatches(text, keywords) {
  if (!text) return 0;
  let count = 0;
  for (const kw of keywords) {
    if (text.includes(kw)) count += 1;
  }
  return count;
}

/**
 * Returns focus tags for the company: e.g. ["DSA", "CS Fundamentals", "ML"].
 * Order reflects relative emphasis; max 4 tags to keep cards readable.
 * @param {Object} company - Company document
 * @returns {string[]}
 */
function getCompanyFocusTags(company) {
  const text = getAnalyzableText(company);
  if (!text.trim()) return ["General"];

  const dsaScore = countKeywordMatches(text, DSA_KEYWORDS);
  const csScore = countKeywordMatches(text, CS_FUNDAMENTALS_KEYWORDS);
  const mlScore = countKeywordMatches(text, ML_KEYWORDS);

  const tags = [];
  if (dsaScore > 0) tags.push({ label: "DSA", score: dsaScore });
  if (csScore > 0) tags.push({ label: "CS Fundamentals", score: csScore });
  if (mlScore > 0) tags.push({ label: "ML / AI", score: mlScore });

  // Sort by score descending and take top 4, then return only labels
  tags.sort((a, b) => b.score - a.score);
  const result = tags.slice(0, 4).map((t) => t.label);

  return result.length > 0 ? result : ["General"];
}

export { getCompanyFocusTags, getAnalyzableText };
