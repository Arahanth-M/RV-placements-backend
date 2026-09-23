/**
 * Per-round focus (subtopic) options for custom interview plans.
 * Stored on session rounds as `focus` + `about` and passed to question generation as `roundAbout`.
 */

const toSafeString = (value) =>
  typeof value === "string" && value.trim() ? value.trim() : "";

export const DSA_ROUND_ABOUT = "Data structures and algorithms";

export const INTERVIEW_ROUND_FOCUS_BY_TYPE = Object.freeze({
  DSA: [
    {
      id: "general",
      label: "Any topic",
      about: DSA_ROUND_ABOUT,
      match: [],
    },
    {
      id: "arrays",
      label: "Arrays & hashing",
      about: "Arrays, hashing, and two-pointer problems",
      match: ["array", "hash", "two pointer", "prefix sum", "sliding window"],
    },
    {
      id: "trees",
      label: "Trees & BST",
      about: "Trees, BST, and traversal problems",
      match: ["tree", "binary search tree", "bst"],
    },
    {
      id: "graphs",
      label: "Graphs & BFS/DFS",
      about: "Graph traversal and shortest-path style problems",
      match: ["graph", "bfs", "dfs", "breadth-first", "depth-first", "dijkstra"],
    },
    {
      id: "dp",
      label: "Dynamic programming",
      about: "Dynamic programming and memoization",
      match: ["dynamic programming", "dp", "memo"],
    },
    {
      id: "strings",
      label: "Strings",
      about: "String manipulation and pattern problems",
      match: ["string"],
    },
  ],
  "System Design": [
    {
      id: "general",
      label: "General design",
      about: "End-to-end system design",
      match: [],
    },
    {
      id: "scalability",
      label: "Scalability",
      about: "Scaling, load balancing, and bottlenecks",
      match: ["scal", "load balanc", "bottleneck"],
    },
    {
      id: "storage",
      label: "Storage & databases",
      about: "Storage, databases, and consistency",
      match: ["storage", "database", "consistency", "replicat"],
    },
    {
      id: "messaging",
      label: "Messaging & queues",
      about: "Queues, events, and async processing",
      match: ["queue", "message", "event", "kafka"],
    },
  ],
  SQL: [
    {
      id: "general",
      label: "General SQL",
      about: "SQL querying and relational design",
      match: [],
    },
    {
      id: "joins",
      label: "Joins",
      about: "Joins and relationships across tables",
      match: ["join"],
    },
    {
      id: "aggregations",
      label: "Aggregations",
      about: "GROUP BY, aggregates, and filtering",
      match: ["aggregat", "group by", "having"],
    },
    {
      id: "indexing",
      label: "Indexing & performance",
      about: "Indexes, query plans, and optimization",
      match: ["index", "query plan", "optim"],
    },
    {
      id: "window",
      label: "Window functions",
      about: "Window functions and analytics SQL",
      match: ["window"],
    },
  ],
  "Web Dev": [
    {
      id: "general",
      label: "General web",
      about: "Frontend and web development fundamentals",
      match: [],
    },
    {
      id: "javascript",
      label: "JavaScript",
      about: "JavaScript language and runtime behavior",
      match: ["javascript", "js", "dom", "event", "closure"],
    },
    {
      id: "react",
      label: "React",
      about: "React components, hooks, and rendering",
      match: ["react", "jsx", "hooks", "state"],
    },
    {
      id: "html_css",
      label: "HTML & CSS",
      about: "Markup, layout, and styling",
      match: ["html", "css", "flex", "grid", "accessibility"],
    },
    {
      id: "networks",
      label: "Web & HTTP",
      about: "HTTP, browsers, and web architecture",
      match: ["http", "browser", "network", "cors", "cache"],
    },
  ],
  "CS Fundamentals": [
    {
      id: "general",
      label: "General CS",
      about: "Core computer science fundamentals",
      match: [],
    },
    {
      id: "oop",
      label: "OOP",
      about: "Object-oriented programming concepts",
      match: ["oop", "object"],
    },
    {
      id: "dbms",
      label: "DBMS",
      about: "Database management and transactions",
      match: ["dbms", "acid", "transaction", "normalization"],
    },
    {
      id: "os",
      label: "Operating systems",
      about: "Processes, memory, and scheduling",
      match: ["operating", "process", "thread", "memory", "schedul", "virtual"],
    },
    {
      id: "networks",
      label: "Networks",
      about: "Networking protocols and architecture",
      match: ["network", "tcp", "udp", "http", "osi"],
    },
  ],
  HR: [
    {
      id: "general",
      label: "General behavioral",
      about: "Behavioral and HR interview themes",
      match: [],
    },
    {
      id: "teamwork",
      label: "Teamwork",
      about: "Collaboration and teamwork",
      match: ["team", "collaborat"],
    },
    {
      id: "conflict",
      label: "Conflict",
      about: "Conflict resolution and difficult situations",
      match: ["conflict", "disagree"],
    },
    {
      id: "leadership",
      label: "Leadership",
      about: "Leadership and ownership",
      match: ["lead", "ownership", "initiative"],
    },
    {
      id: "failure",
      label: "Failure & learning",
      about: "Failure, mistakes, and learning",
      match: ["fail", "mistake", "learn"],
    },
    {
      id: "why_company",
      label: "Why this company",
      about: "Motivation and fit for the company",
      match: ["why", "motivat", "company"],
    },
  ],
  Aptitude: [
    {
      id: "general",
      label: "General aptitude",
      about: "Quantitative and logical aptitude",
      match: [],
    },
    {
      id: "quant",
      label: "Quantitative",
      about: "Numbers, percentages, and arithmetic",
      match: ["percent", "ratio", "interest", "profit", "speed", "work"],
    },
    {
      id: "logical",
      label: "Logical reasoning",
      about: "Patterns, series, and deductions",
      match: ["series", "pattern", "logic", "coding-decoding"],
    },
  ],
  "ML/AI Technical": [
    {
      id: "general",
      label: "General ML/AI",
      about: "Machine learning and AI fundamentals",
      match: [],
    },
    {
      id: "supervised",
      label: "Supervised learning",
      about: "Classification, regression, and evaluation",
      match: ["supervised", "classification", "regression", "metric"],
    },
    {
      id: "deep_learning",
      label: "Deep learning",
      about: "Neural networks and deep learning",
      match: ["deep", "neural", "cnn", "transformer"],
    },
  ],
  "Case Interview": [
    {
      id: "general",
      label: "General case",
      about: "Structured case interview problems",
      match: [],
    },
    {
      id: "profitability",
      label: "Profitability",
      about: "Profit and cost driver cases",
      match: ["profit", "margin", "cost"],
    },
    {
      id: "market_entry",
      label: "Market entry",
      about: "Go-to-market and expansion cases",
      match: ["market", "entry", "expansion"],
    },
  ],
  "Core Technical": [
    {
      id: "general",
      label: "General technical",
      about: "Core technical concepts for the role",
      match: [],
    },
  ],
  "Circuit Design": [
    {
      id: "general",
      label: "General circuit design",
      about: "Digital and analog circuit design",
      match: [],
    },
  ],
  "Embedded Systems": [
    {
      id: "general",
      label: "General embedded",
      about: "Embedded systems and firmware",
      match: [],
    },
  ],
  "Project/Resume Deep Dive": [
    {
      id: "general",
      label: "General deep dive",
      about: "Projects, resume, and ownership stories",
      match: [],
    },
  ],
});

const DEFAULT_LABEL_BY_TYPE = Object.freeze({
  DSA: "DSA/Coding Round",
  "System Design": "System Design Round",
  SQL: "SQL Round",
  "CS Fundamentals": "CS Fundamentals Round",
  "Web Dev": "Web Dev Round",
  HR: "HR/Behavioral Round",
  Aptitude: "Aptitude Round",
  "Core Technical": "Core Technical Round",
  "Circuit Design": "Circuit Design Round",
  "Low-Level Design": "Low-Level Design Round",
  "ML/AI Technical": "ML/AI Technical Round",
  "Embedded Systems": "Embedded Systems Round",
  "Case Interview": "Case Interview",
  "Project/Resume Deep Dive": "Project/Resume Deep Dive",
});

export const getRoundPreviewLabel = (roundType) =>
  DEFAULT_LABEL_BY_TYPE[toSafeString(roundType)] || "General Interview Round";

export const roundTypeHasFocusPicker = (roundType) =>
  Boolean(INTERVIEW_ROUND_FOCUS_BY_TYPE[toSafeString(roundType)]);

export const getFocusOptionsForRoundType = (roundType) => {
  const type = toSafeString(roundType);
  return INTERVIEW_ROUND_FOCUS_BY_TYPE[type] || [];
};

export const resolveRoundAbout = (roundType, focusInput) => {
  const type = toSafeString(roundType) || "DSA";
  const raw = toSafeString(focusInput);

  if (raw.startsWith("bank:")) {
    const label = (() => {
      try {
        return decodeURIComponent(raw.slice(5)).trim();
      } catch {
        return raw.slice(5).trim();
      }
    })();
    if (label) {
      return `Focused practice: ${label}`;
    }
  }

  const options = getFocusOptionsForRoundType(type);
  if (!raw) {
    if (type === "DSA") return DSA_ROUND_ABOUT;
    return options[0]?.about || getRoundPreviewLabel(type);
  }

  const byId = options.find((opt) => opt.id === raw);
  if (byId) return byId.about;

  const byAbout = options.find(
    (opt) =>
      opt.about.toLowerCase() === raw.toLowerCase() ||
      opt.label.toLowerCase() === raw.toLowerCase()
  );
  if (byAbout) return byAbout.about;

  if (raw.length > 12 && raw.length <= 120) {
    return raw;
  }

  if (type === "DSA") return DSA_ROUND_ABOUT;
  return options[0]?.about || getRoundPreviewLabel(type);
};

export const normalizeCustomRoundFocus = (roundType, focusInput) => {
  const type = toSafeString(roundType) || "DSA";
  const options = getFocusOptionsForRoundType(type);
  const raw = toSafeString(focusInput);
  if (!raw) return options[0]?.id || "general";

  if (raw.startsWith("bank:")) {
    return raw.length <= 132 ? raw : options[0]?.id || "general";
  }

  const byId = options.find((opt) => opt.id === raw);
  if (byId) return byId.id;

  const byAbout = options.find(
    (opt) =>
      opt.about.toLowerCase() === raw.toLowerCase() ||
      opt.label.toLowerCase() === raw.toLowerCase()
  );
  if (byAbout) return byAbout.id;

  return options[0]?.id || "general";
};
