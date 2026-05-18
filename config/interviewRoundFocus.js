/**
 * Per-round focus (subtopic) options for custom interview plans.
 * Stored on session rounds as `about` and passed to question generation as `roundAbout`.
 */

const toSafeString = (value) =>
  typeof value === "string" && value.trim() ? value.trim() : "";

/** DSA rounds use the bank / difficulty only — no subtopic picker. */
export const DSA_ROUND_ABOUT = "Data structures and algorithms";

export const INTERVIEW_ROUND_FOCUS_BY_TYPE = Object.freeze({
  "System Design": [
    { id: "general", label: "General design", about: "End-to-end system design" },
    { id: "scalability", label: "Scalability", about: "Scaling, load balancing, and bottlenecks" },
    { id: "storage", label: "Storage & databases", about: "Storage, databases, and consistency" },
    { id: "messaging", label: "Messaging & queues", about: "Queues, events, and async processing" },
  ],
  SQL: [
    { id: "general", label: "General SQL", about: "SQL querying and relational design" },
    { id: "joins", label: "Joins", about: "Joins and relationships across tables" },
    { id: "aggregations", label: "Aggregations", about: "GROUP BY, aggregates, and filtering" },
    { id: "indexing", label: "Indexing & performance", about: "Indexes, query plans, and optimization" },
    { id: "window", label: "Window functions", about: "Window functions and analytics SQL" },
  ],
  "CS Fundamentals": [
    { id: "general", label: "General CS", about: "Core computer science fundamentals" },
    { id: "oop", label: "OOP", about: "Object-oriented programming concepts" },
    { id: "dbms", label: "DBMS", about: "Database management and transactions" },
    { id: "os", label: "Operating systems", about: "Processes, memory, and scheduling" },
    { id: "networks", label: "Networks", about: "Networking protocols and architecture" },
  ],
  HR: [
    { id: "general", label: "General behavioral", about: "Behavioral and HR interview themes" },
    { id: "teamwork", label: "Teamwork", about: "Collaboration and teamwork" },
    { id: "conflict", label: "Conflict", about: "Conflict resolution and difficult situations" },
    { id: "leadership", label: "Leadership", about: "Leadership and ownership" },
    { id: "failure", label: "Failure & learning", about: "Failure, mistakes, and learning" },
    { id: "why_company", label: "Why this company", about: "Motivation and fit for the company" },
  ],
});

const DEFAULT_LABEL_BY_TYPE = Object.freeze({
  DSA: "DSA/Coding Round",
  "System Design": "System Design Round",
  SQL: "SQL Round",
  "CS Fundamentals": "CS Fundamentals Round",
  HR: "HR/Behavioral Round",
});

export const getRoundPreviewLabel = (roundType) =>
  DEFAULT_LABEL_BY_TYPE[toSafeString(roundType)] || "General Interview Round";

export const roundTypeHasFocusPicker = (roundType) =>
  Boolean(INTERVIEW_ROUND_FOCUS_BY_TYPE[toSafeString(roundType)]);

export const getFocusOptionsForRoundType = (roundType) => {
  const type = toSafeString(roundType);
  if (type === "DSA") return [];
  return INTERVIEW_ROUND_FOCUS_BY_TYPE[type] || [];
};

export const resolveRoundAbout = (roundType, focusInput) => {
  const type = toSafeString(roundType) || "DSA";
  if (type === "DSA") {
    return DSA_ROUND_ABOUT;
  }
  const raw = toSafeString(focusInput);
  if (!raw) {
    return getFocusOptionsForRoundType(type)[0]?.about || getRoundPreviewLabel(type);
  }

  const options = getFocusOptionsForRoundType(type);
  const byId = options.find((opt) => opt.id === raw);
  if (byId) return byId.about;

  const byAbout = options.find(
    (opt) => opt.about.toLowerCase() === raw.toLowerCase() || opt.label.toLowerCase() === raw.toLowerCase()
  );
  if (byAbout) return byAbout.about;

  if (raw.length > 12 && raw.length <= 120) {
    return raw;
  }

  return options[0]?.about || getRoundPreviewLabel(type);
};

export const normalizeCustomRoundFocus = (roundType, focusInput) => {
  const type = toSafeString(roundType) || "DSA";
  if (type === "DSA") return "";
  const options = getFocusOptionsForRoundType(type);
  const raw = toSafeString(focusInput);
  if (!raw) return options[0]?.id || "general";

  const byId = options.find((opt) => opt.id === raw);
  if (byId) return byId.id;

  const byAbout = options.find(
    (opt) => opt.about.toLowerCase() === raw.toLowerCase() || opt.label.toLowerCase() === raw.toLowerCase()
  );
  if (byAbout) return byAbout.id;

  return options[0]?.id || "general";
};
