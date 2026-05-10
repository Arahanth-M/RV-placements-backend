import InterviewQuestion from "../models/InterviewQuestion.js";
import { normalizeExpectedPoints } from "./mcp/generateQuestion.js";

const toSafeString = (value, fallback = "") =>
  typeof value === "string" && value.trim() ? value.trim() : fallback;

const normalizeDifficulty = (value) => {
  const safe = toSafeString(value, "medium").toLowerCase();
  return safe === "easy" || safe === "medium" || safe === "hard" ? safe : "medium";
};

const inferExpectedAnswerMode = ({ roundType, evaluationStrategy, rubric = [] }) => {
  const explicitMode = toSafeString(rubric?.[0]?.expectedAnswerMode);
  if (explicitMode) return explicitMode;

  if (evaluationStrategy === "code_execution") {
    return "code";
  }
  if (evaluationStrategy === "behavioral_llm") {
    return "story";
  }
  if (evaluationStrategy === "rubric_llm" && toSafeString(roundType).toLowerCase().includes("system")) {
    return "design";
  }

  const rt = toSafeString(roundType).toLowerCase();
  if (rt.includes("dsa")) return "code";
  if (rt.includes("sql")) return "conceptual";
  if (rt.includes("system")) return "design";
  if (rt.includes("hr")) return "story";
  return "conceptual";
};

const normalizeExclusions = (values = []) => {
  if (!Array.isArray(values)) return [];
  return values.map((value) => toSafeString(value)).filter(Boolean);
};

const escapeRegex = (value = "") => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const buildRoundTypeMatcher = (roundType) => {
  const rt = toSafeString(roundType).toLowerCase();
  if (!rt) return null;

  if (
    rt.includes("dsa") ||
    rt.includes("coding") ||
    rt.includes("algorithm") ||
    rt.includes("data structure")
  ) {
    return { $regex: "(dsa|coding|algorithm|data\\s*structure)", $options: "i" };
  }
  if (rt.includes("sql") || rt.includes("database") || rt.includes("dbms")) {
    return { $regex: "(sql|database|dbms)", $options: "i" };
  }
  if (rt.includes("system")) {
    return { $regex: "system\\s*design", $options: "i" };
  }
  if (rt.includes("hr") || rt.includes("behavior")) {
    return { $regex: "(hr|behavior)", $options: "i" };
  }

  return { $regex: `^${escapeRegex(toSafeString(roundType))}$`, $options: "i" };
};

const pickOneQuestion = async (match) => {
  const [selected] = await InterviewQuestion.aggregate([
    { $match: match },
    {
      $addFields: {
        _verifiedRank: { $cond: [{ $eq: ["$sourceMetadata.verified", true] }, 1, 0] },
        _qualityRank: { $ifNull: ["$sourceMetadata.qualityScore", 0] },
        _randomTieBreaker: { $rand: {} },
      },
    },
    {
      $sort: {
        _verifiedRank: -1,
        _qualityRank: -1,
        _randomTieBreaker: -1,
      },
    },
    { $limit: 1 },
    {
      $project: {
        _verifiedRank: 0,
        _qualityRank: 0,
        _randomTieBreaker: 0,
      },
    },
  ]);
  return selected || null;
};

/**
 * Retrieval-first question selector.
 * Returns one question normalized to the generateQuestion contract + retrieval metadata.
 */
export async function retrieveQuestion({
  company,
  roundType,
  difficulty,
  excludedQuestionIds = [],
}) {
  const companyTag = toSafeString(company);
  const normalizedRoundType = toSafeString(roundType);
  const normalizedDifficulty = normalizeDifficulty(difficulty);
  const exclusions = normalizeExclusions(excludedQuestionIds);
  const roundTypeMatcher = buildRoundTypeMatcher(normalizedRoundType);

  if (!normalizedRoundType || !roundTypeMatcher) {
    return null;
  }

  const baseMatch = {
    roundType: roundTypeMatcher,
    difficulty: normalizedDifficulty,
  };
  if (exclusions.length > 0) baseMatch.questionId = { $nin: exclusions };

  // Retrieval cascade: strict -> relax difficulty -> relax company.
  const candidateMatches = [];
  if (companyTag) {
    candidateMatches.push({ ...baseMatch, companyTags: companyTag });
    candidateMatches.push({ roundType: roundTypeMatcher, companyTags: companyTag });
  }
  candidateMatches.push(baseMatch);
  candidateMatches.push({ roundType: roundTypeMatcher });

  let selected = null;
  for (const match of candidateMatches) {
    selected = await pickOneQuestion(match);
    if (selected) break;
  }

  if (!selected) {
    return null;
  }

  const expectedAnswerMode = inferExpectedAnswerMode({
    roundType: selected.roundType,
    evaluationStrategy: selected.evaluationStrategy,
    rubric: selected.rubric,
  });

  const expectedPoints = normalizeExpectedPoints(selected.rubric, {
    roundType: selected.roundType,
    expectedAnswerMode,
  });

  return {
    question: toSafeString(selected.question),
    expectedAnswerMode,
    expectedPoints,
    questionId: toSafeString(selected.questionId),
    evaluationStrategy: toSafeString(selected.evaluationStrategy),
    metadata: {
      title: toSafeString(selected.title),
      companyTags: Array.isArray(selected.companyTags) ? selected.companyTags : [],
      roundType: toSafeString(selected.roundType),
      difficulty: toSafeString(selected.difficulty),
      topics: Array.isArray(selected.topics) ? selected.topics : [],
      subtopics: Array.isArray(selected.subtopics) ? selected.subtopics : [],
      dsaMetadata: selected.dsaMetadata || {},
      sqlMetadata: selected.sqlMetadata || {},
      systemDesignMetadata: selected.systemDesignMetadata || {},
      hrMetadata: selected.hrMetadata || {},
      complexity: selected.complexity || {},
      sourceMetadata: selected.sourceMetadata || {},
    },
  };
}

export default retrieveQuestion;
