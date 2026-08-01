const STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "into",
  "your",
  "about",
  "using",
  "based",
  "basic",
  "basics",
  "focus",
  "practice",
  "review",
  "solve",
  "problem",
  "problems",
  "question",
  "questions",
  "topic",
  "topics",
  "hour",
  "hours",
  "day",
  "days",
  "min",
  "mins",
  "a",
  "an",
  "of",
  "to",
  "in",
  "on",
  "or",
  "as",
  "is",
  "are",
  "be",
  "by",
]);

const SOURCE_LABEL = {
  must_do: "Must-do",
  oa: "OA",
  interview_question: "Interview",
  interview_experience: "Experience",
};

function tokens(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !STOP.has(t));
}

function scoreOverlap(queryTokens, evidenceTokens) {
  if (!queryTokens.length || !evidenceTokens.length) return 0;
  const q = new Set(queryTokens);
  let hit = 0;
  for (const t of evidenceTokens) {
    if (q.has(t)) hit += 1;
  }
  return hit;
}

function clusterShort(cluster) {
  const c = String(cluster || "").trim();
  if (!c) return "";
  const lower = c.toLowerCase();
  if (lower.includes("computer") || lower === "cs" || lower === "cse") return "CSE";
  if (lower.includes("electronic") || lower === "ec" || lower === "ece") return "ECE";
  if (lower.includes("mechanical") || lower === "me") return "ME";
  if (lower.includes("chemical") || lower.includes("biotech") || lower === "chem")
    return "Chem/BT";
  return c.length > 28 ? `${c.slice(0, 28)}…` : c;
}

export function formatEvidenceLabel(ev) {
  const type = SOURCE_LABEL[ev.sourceType] || "Campus";
  const parts = [`Seen in RVCE visit data: ${type}`];
  if (ev.year) parts.push(String(ev.year));
  const branchOrCluster = clusterShort(ev.cluster) || String(ev.branch || "").trim();
  if (branchOrCluster) parts.push(branchOrCluster);
  return parts.join(" · ");
}

/**
 * Pick top evidence items that overlap a query string.
 */
export function matchCampusEvidence(queryText, evidenceBank, { limit = 2, minScore = 1 } = {}) {
  const bank = Array.isArray(evidenceBank) ? evidenceBank : [];
  if (!bank.length) return [];
  const qTokens = tokens(queryText);
  if (!qTokens.length) return [];

  const scored = bank
    .map((ev) => {
      const evTokens = ev._tokens || tokens(ev.text);
      return { ev, score: scoreOverlap(qTokens, evTokens) };
    })
    .filter((row) => row.score >= minScore)
    .sort((a, b) => b.score - a.score || Number(b.ev.year || 0) - Number(a.ev.year || 0));

  const seen = new Set();
  const out = [];
  for (const row of scored) {
    const key = `${row.ev.sourceType}|${row.ev.year}|${String(row.ev.text || "").slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      sourceType: row.ev.sourceType,
      snippet: String(row.ev.text || "").slice(0, 160),
      year: row.ev.year || null,
      cluster: row.ev.cluster || "",
      branch: row.ev.branch || "",
      label: formatEvidenceLabel(row.ev),
    });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Attach campusEvidence tags onto topicSections and days using visit evidence bank.
 * Deterministic — does not invent citations.
 */
export function attachCampusEvidenceToRoadmap(roadmap, evidenceBank) {
  const bank = (Array.isArray(evidenceBank) ? evidenceBank : []).map((ev) => ({
    ...ev,
    _tokens: tokens(ev.text),
  }));
  if (!roadmap || typeof roadmap !== "object" || !bank.length) {
    return roadmap;
  }

  const topics = Array.isArray(roadmap.topicSections) ? roadmap.topicSections : [];
  roadmap.topicSections = topics.map((t) => {
    const query = [
      t?.title,
      t?.why,
      ...(Array.isArray(t?.subtopics) ? t.subtopics.map((s) => s?.title) : []),
      ...(Array.isArray(t?.practiceHints) ? t.practiceHints : []),
    ]
      .filter(Boolean)
      .join(" ");
    return {
      ...t,
      campusEvidence: matchCampusEvidence(query, bank, { limit: 2, minScore: 1 }),
    };
  });

  const days = Array.isArray(roadmap.days) ? roadmap.days : [];
  roadmap.days = days.map((d) => {
    const query = [
      d?.focus,
      ...(Array.isArray(d?.tasks) ? d.tasks.map((task) => `${task?.title || ""} ${task?.notes || ""}`) : []),
    ]
      .filter(Boolean)
      .join(" ");
    return {
      ...d,
      campusEvidence: matchCampusEvidence(query, bank, { limit: 2, minScore: 1 }),
    };
  });

  // Enrich companySignals with year/cluster when a matching evidence item exists.
  if (Array.isArray(roadmap.companySignals)) {
    roadmap.companySignals = roadmap.companySignals.map((sig) => {
      const matches = matchCampusEvidence(sig?.point || "", bank, {
        limit: 1,
        minScore: 1,
      });
      const m = matches[0];
      if (!m) return sig;
      return {
        ...sig,
        year: m.year,
        cluster: m.cluster,
        branch: m.branch,
        label: m.label,
      };
    });
  }

  return roadmap;
}
