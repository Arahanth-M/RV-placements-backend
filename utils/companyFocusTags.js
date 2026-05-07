/**
 * Derives focus tags from visit-level technical content only
 * (OA + interview questions + interview process).
 */

const TECH_KEYWORDS = [
  // DSA - Detailed
  "arrays", "linked lists", "stacks", "queues", "trees", "graphs", "heaps", "hashing", 
  "recursion", "backtracking", "dynamic programming", "dp", "greedy", "sorting", 
  "searching", "bit manipulation", "string matching", "tries", "segment trees",
  "sliding window", "two pointers", "bfs", "dfs", "topological sort", "dijkstra",
  
  // CS Fundamentals - Detailed
  "operating systems", "os", "dbms", "sql", "nosql", "mongodb", "computer networks",
  "tcp/ip", "oops", "object oriented programming", "system design", "lld", "hld",
  "memory management", "virtual memory", "deadlocks", "indexing", "normalization",
  "transactions", "acid properties", "rest api", "microservices", "docker",
  
  // Languages & Tech
  "java", "python", "cpp", "c++", "javascript", "react", "node.js", "aws", "cloud",
  
  // Advanced Tech
  "machine learning", "ml", "artificial intelligence", "ai", "deep learning", 
  "nlp", "computer vision", "statistics", "data science", "neural networks"
];

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
]);

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function keywordRegex(keyword) {
  const normalized = String(keyword || "").trim().toLowerCase();
  if (!normalized) return null;

  // Keep slash-separated tokens like tcp/ip strict.
  if (normalized.includes("/")) {
    return new RegExp(`(?<![a-z0-9])${escapeRegExp(normalized)}(?![a-z0-9])`, "i");
  }

  // Short acronyms must be standalone tokens to avoid false positives
  // like "position" -> "os" or "paid" -> "ai".
  if (SHORT_TOKEN_KEYWORDS.has(normalized)) {
    return new RegExp(`\\b${escapeRegExp(normalized)}\\b`, "i");
  }

  // Multi-word phrases: allow punctuation/space between words.
  if (normalized.includes(" ")) {
    const words = normalized
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => escapeRegExp(w));
    return new RegExp(`\\b${words.join("[^a-z0-9]+")}\\b`, "i");
  }

  return new RegExp(`\\b${escapeRegExp(normalized)}\\b`, "i");
}

function getAnalyzableText(company) {
  if (!company) return "";
  const parts = [];

  const oa = company.onlineQuestions;
  if (Array.isArray(oa)) {
    oa.forEach((q) => {
      if (typeof q === "string") parts.push(q);
      else if (q && typeof q === "object" && q.question) parts.push(q.question);
    });
  }

  const iq = company.interviewQuestions;
  if (Array.isArray(iq)) {
    iq.forEach((q) => {
      if (typeof q === "string") parts.push(q);
      else if (q && typeof q === "object" && q.question) parts.push(q.question);
    });
  }

  const process = company.interviewProcess;
  if (Array.isArray(process)) {
    process.forEach((p) => {
      if (typeof p === "string") parts.push(p);
      else if (p && typeof p === "object" && p.content) parts.push(p.content);
    });
  }

  return parts.join(" ").toLowerCase();
}

/**
 * Returns focus tags for the company.
 * Prioritizes Must_Do_Topics but falls back to broad analysis if needed.
 * @param {Object} company - Company document
 * @returns {string[]}
 */
function getCompanyFocusTags(company) {
  const candidates = new Set();
  const text = getAnalyzableText(company);
  if (text) {
    for (const kw of TECH_KEYWORDS) {
      const pattern = keywordRegex(kw);
      if (pattern && pattern.test(text)) {
        const formatted = kw.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
        candidates.add(formatted);
        if (candidates.size >= 5) break;
      }
    }
  }

  const result = Array.from(candidates);

  // Fallback to broad categories if still empty
  if (result.length === 0) {
    const text = getAnalyzableText(company);
    if (/\bdsa\b|\balgorithms?\b/i.test(text)) result.push("DSA");
    if (/\bfundamentals?\b|\bcs\b/i.test(text)) result.push("CS Fundamentals");
  }

  // Return top 3 as requested
  return result.length > 0 ? result.slice(0, 3) : ["General"];
}

export { getCompanyFocusTags, getAnalyzableText };
