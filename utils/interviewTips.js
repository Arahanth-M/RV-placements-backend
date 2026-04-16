const normalizeText = (value, fallback = "") =>
  typeof value === "string" && value.trim() ? value.trim() : fallback;

const uniqueTips = (tips) => {
  const seen = new Set();
  return (Array.isArray(tips) ? tips : []).filter((tip) => {
    const safe = normalizeText(tip);
    if (!safe) return false;
    const key = safe.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const tipsByRoundType = {
  DSA: [
    "Start by stating the brute-force idea so the interviewer sees your baseline reasoning.",
    "Call out the core data structure choice early and explain why it fits the problem.",
    "Mention the time and space complexity before you finish so your trade-offs are explicit.",
    "Use a small example input to validate your approach before jumping into optimization.",
    "Say the edge cases out loud: empty input, duplicates, single element, overflow, and limits.",
    "If you optimize, explain what bottleneck the optimization removes from the brute-force version.",
    "Name the invariant your pointers, heap, stack, or map is maintaining throughout the solution.",
    "If recursion is involved, clearly define the base case and what each recursive call returns.",
    "When using hashing, mention collision expectations, lookup guarantees, and why order may not matter.",
    "If the problem is graph-based, say whether you are modeling it as BFS, DFS, shortest path, or topo sort.",
    "For dynamic programming, define the state, transition, and why overlapping subproblems exist.",
    "Before coding, confirm what should happen for invalid or extreme inputs.",
  ],
  "System Design": [
    "Begin with requirements: users, traffic, latency, consistency, scale, and failure expectations.",
    "Separate the design into API layer, core services, storage, and asynchronous components.",
    "State one reasonable traffic assumption so your scaling decisions feel grounded.",
    "Discuss read-heavy vs write-heavy behavior because it changes storage and caching strategy.",
    "Mention the first likely bottlenecks and how you would reduce them incrementally.",
    "Call out trade-offs explicitly: consistency vs latency, simplicity vs flexibility, cost vs performance.",
    "If caching is suggested, explain cache keys, TTL, invalidation, and the risk of stale reads.",
    "If queues are useful, say what work becomes asynchronous and why that improves reliability or latency.",
    "Talk through database choice based on access patterns, not just familiarity.",
    "Cover failure handling: retries, idempotency, circuit breakers, graceful degradation, and monitoring.",
    "Explain how the system evolves from an MVP to a higher-scale production design.",
    "Mention observability: logs, metrics, tracing, and the main SLA signals you would track.",
  ],
  HR: [
    "Use the STAR structure so the interviewer can follow context, action, and measurable impact.",
    "Lead with the situation in one or two lines, then spend most of the answer on your actions.",
    "Be specific about your contribution instead of describing only what the team did.",
    "Quantify outcomes where possible: timeline, scope, metric improvement, or stakeholder impact.",
    "If the story involved conflict, explain how you resolved it professionally without sounding defensive.",
    "Show self-awareness by mentioning what you learned and how you changed afterward.",
    "Keep the answer concise first; add details only if the interviewer asks for them.",
    "Choose examples that show ownership, communication, resilience, and judgment under pressure.",
    "If describing a mistake, focus on accountability, corrective action, and prevention.",
    "Mirror the company context when possible by highlighting teamwork, adaptability, or customer focus.",
    "End with a clean takeaway so the interviewer remembers the point of the story.",
    "Avoid vague phrases like 'we managed it somehow' and describe concrete decisions you made.",
  ],
};

export const defaultTips = [
  "Take two seconds to structure your answer before speaking so it sounds deliberate.",
  "Lead with the main idea first, then support it with reasoning and examples.",
  "Keep the answer step-by-step so the interviewer can follow your thought process.",
  "If you are unsure, state your assumption clearly and continue with a reasonable approach.",
  "Make trade-offs explicit instead of leaving them implied.",
  "Use concise language, then expand only where depth matters.",
  "Summarize your conclusion at the end so the answer feels complete.",
  "If you change direction, briefly explain why your new approach is better.",
];

const difficultyTips = {
  easy: [
    "Do not rush easy questions; clean reasoning and correctness matter more than speed.",
    "Use simple examples first to show that your fundamentals are solid.",
  ],
  medium: [
    "For medium difficulty, balance correctness, structure, and one meaningful optimization.",
    "If there are multiple valid approaches, briefly compare them before choosing one.",
  ],
  hard: [
    "For hard questions, narrate your reasoning in layers so the interviewer sees progress even before the full answer.",
    "When the problem is difficult, make assumptions explicit and break it into smaller subproblems.",
  ],
};

const questionSignalTips = [
  {
    match: /(edge case|boundary|null|empty|duplicate|overflow|constraint)/i,
    tip: "This question likely has hidden corner cases, so mention boundary conditions before finalizing the answer.",
  },
  {
    match: /(optimi|complexity|time complexity|space complexity|efficient)/i,
    tip: "Optimization seems relevant here, so compare the baseline approach with your improved one clearly.",
  },
  {
    match: /(cache|queue|retry|latency|throughput|scale|consisten|partition)/i,
    tip: "This prompt has system trade-offs, so explain why your design choices fit the expected scale and reliability needs.",
  },
  {
    match: /(experience|challenge|conflict|team|deadline|mistake|leadership)/i,
    tip: "This answer will land better if you focus on your decisions, not just the background story.",
  },
];

export function buildInterviewTips({
  roundType,
  difficulty,
  currentQuestion,
  companyName,
  currentQuestionIndex,
  desiredCount = 8,
}) {
  const safeRoundType = normalizeText(roundType, "General");
  const safeDifficulty = normalizeText(difficulty, "medium").toLowerCase();
  const safeQuestion = normalizeText(currentQuestion);
  const safeCompanyName = normalizeText(companyName);
  const questionNumber = Number(currentQuestionIndex) + 1;

  const baseTips = tipsByRoundType[safeRoundType] || defaultTips;
  const extraTips = [];

  if (safeCompanyName) {
    extraTips.push(
      `Keep your answer grounded in how you would discuss this in an interview at ${safeCompanyName}.`
    );
  }

  if (Number.isFinite(questionNumber) && questionNumber > 0) {
    extraTips.push(
      `Question ${questionNumber} is a good place to stay composed and show steady reasoning rather than rushing to a final answer.`
    );
  }

  if (difficultyTips[safeDifficulty]) {
    extraTips.push(...difficultyTips[safeDifficulty]);
  }

  for (const entry of questionSignalTips) {
    if (entry.match.test(safeQuestion)) {
      extraTips.push(entry.tip);
    }
  }

  const orderedTips = uniqueTips([...extraTips, ...baseTips, ...defaultTips]);
  return orderedTips.slice(0, Math.max(4, Number(desiredCount) || 8));
}
