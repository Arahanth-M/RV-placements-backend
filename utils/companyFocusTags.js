/**
 * Derives focus tags for a company by analyzing interview process,
 * interview questions, OA questions, and must-do topics.
 * Used on company cards to show what the company mainly focuses on (DSA, CS Fundamentals, ML, etc.).
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

function getAnalyzableText(company) {
  if (!company) return "";
  const parts = [];

  const mustDo = company.Must_Do_Topics || company.must_do_topics || company.mustDoTopics;
  if (Array.isArray(mustDo)) {
    mustDo.forEach((t) => {
      if (typeof t === "string") parts.push(t);
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
  const mustDo = company.Must_Do_Topics || company.must_do_topics || company.mustDoTopics || [];
  const candidates = new Set();

  // 1. First, check Must_Do_Topics for short, descriptive strings
  mustDo.forEach(topic => {
    if (typeof topic !== 'string') return;
    const cleanTopic = topic.trim();
    
    // If it's a short topic (1-3 words, < 25 chars), use it directly
    if (cleanTopic.length > 0 && cleanTopic.length < 25 && cleanTopic.split(' ').length <= 3) {
      // Capitalize first letter of each word
      const formatted = cleanTopic.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
      candidates.add(formatted);
    }
  });

  // 2. If we don't have 3 candidates yet, scan all text for specific keywords
  if (candidates.size < 3) {
    const text = getAnalyzableText(company);
    if (text) {
      for (const kw of TECH_KEYWORDS) {
        if (text.includes(kw)) {
          const formatted = kw.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
          candidates.add(formatted);
          if (candidates.size >= 5) break; 
        }
      }
    }
  }

  const result = Array.from(candidates);

  // Fallback to broad categories if still empty
  if (result.length === 0) {
    const text = getAnalyzableText(company);
    if (text.includes("dsa") || text.includes("algorithm")) result.push("DSA");
    if (text.includes("fundamentals") || text.includes("cs")) result.push("CS Fundamentals");
  }

  // Return top 3 as requested
  return result.length > 0 ? result.slice(0, 3) : ["General"];
}

export { getCompanyFocusTags, getAnalyzableText };
