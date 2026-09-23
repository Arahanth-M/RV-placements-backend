import InterviewQuestion from "../models/InterviewQuestion.js";
import { buildSubtopicMongoClause } from "./interviewRoundSubtopicsService.js";
import { decodeBankFocusLabel } from "./interviewRoundSubtopicsService.js";
import { normalizeMcqBankDoc } from "../utils/normalizeMcqBankDoc.js";
import { bankDocSatisfiesCodeGrading } from "./interviewCodeGradingGuards.js";
import { isCsFundamentalsRoundType } from "../utils/csFundamentalsRoundPlan.js";

const toSafeString = (value, fallback = "") =>
  typeof value === "string" && value.trim() ? value.trim() : fallback;

const DIFFICULTIES = ["easy", "medium", "hard"];

const normalizeDifficulty = (value) => {
  const safe = toSafeString(value, "medium").toLowerCase();
  return DIFFICULTIES.includes(safe) ? safe : "medium";
};

const escapeRegex = (value = "") => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeExclusions = (values = []) => {
  if (!Array.isArray(values)) return [];
  return values.map((value) => toSafeString(value)).filter(Boolean);
};

function difficultyOrder(preferred) {
  const p = normalizeDifficulty(preferred);
  const rest = DIFFICULTIES.filter((d) => d !== p);
  return [p, ...rest];
}

function docPassesBankFilter(roundType, doc, questionKind) {
  const strat = toSafeString(doc?.evaluationStrategy).toLowerCase();
  if (questionKind === "mcq") {
    return strat === "mcq_exact" && normalizeMcqBankDoc(doc) != null;
  }
  if (questionKind === "theory") {
    if (strat === "mcq_exact" || strat === "code_execution" || strat === "sql_execution") {
      return false;
    }
    return bankDocSatisfiesCodeGrading(roundType, doc);
  }
  if (strat === "mcq_exact") {
    return normalizeMcqBankDoc(doc) != null;
  }
  return bankDocSatisfiesCodeGrading(roundType, doc);
}

function roleMatches(doc, roleTag) {
  const roles = Array.isArray(doc?.roleTags) ? doc.roleTags : [];
  if (!roles.length) return true;
  if (!roleTag) return false;
  return roles.some((r) => toSafeString(r).toLowerCase() === roleTag.toLowerCase());
}

function companyTagMatches(doc, companyTag) {
  if (!companyTag) return false;
  const tags = Array.isArray(doc?.companyTags) ? doc.companyTags : [];
  const needle = companyTag.toLowerCase();
  return tags.some((t) => toSafeString(t).toLowerCase() === needle);
}

function categoryMatches(doc, categoryId) {
  if (!categoryId) return false;
  const cats = Array.isArray(doc?.category) ? doc.category : [];
  return cats.some((c) => toSafeString(c).toLowerCase() === categoryId.toLowerCase());
}

function isSingleRoleMatch(doc, roleTag) {
  const roles = Array.isArray(doc?.roleTags) ? doc.roleTags : [];
  if (roles.length !== 1 || !roleTag) return false;
  return toSafeString(roles[0]).toLowerCase() === roleTag.toLowerCase();
}

/** Tier 1–4 per product spec (2 before 3). Higher score = better. */
function platformTierScore(doc, { companyTag, categoryId, roleTag }) {
  const companyHit = companyTagMatches(doc, companyTag);
  const categoryHit = categoryMatches(doc, categoryId);
  const singleRole = isSingleRoleMatch(doc, roleTag);

  if (companyHit && singleRole) return 4;
  if (!companyHit && categoryHit && singleRole) return 3;
  if (companyHit && !singleRole && roleMatches(doc, roleTag)) return 2;
  if (!companyHit && categoryHit && roleMatches(doc, roleTag)) return 1;
  return 0;
}

function focusSoftBoost(doc, roundFocus, roundType) {
  const focus = toSafeString(roundFocus);
  if (!focus || focus === "general") return 0;
  const clause = buildSubtopicMongoClause(roundType, focus);
  if (!clause?.$or?.length) return 0;

  const patterns = [];
  if (focus.startsWith("bank:")) {
    const label = decodeBankFocusLabel(focus);
    if (label) patterns.push(label.toLowerCase());
  }

  const topics = [...(doc.topics || []), ...(doc.subtopics || [])]
    .map((t) => toSafeString(t).toLowerCase())
    .filter(Boolean);

  for (const p of patterns) {
    if (topics.some((t) => t.includes(p) || p.includes(t))) return 0.15;
  }
  return 0;
}

function verifiedRank(doc) {
  return doc?.sourceMetadata?.verified === true || doc?.verified === true ? 1 : 0;
}

function qualityRank(doc) {
  const q = doc?.sourceMetadata?.qualityScore ?? doc?.qualityScore ?? 0;
  return Number.isFinite(Number(q)) ? Number(q) : 0;
}

function compareDocs(a, b, ctx) {
  const tierA = platformTierScore(a, ctx);
  const tierB = platformTierScore(b, ctx);
  if (tierB !== tierA) return tierB - tierA;

  const boostA = focusSoftBoost(a, ctx.roundFocus, ctx.roundType);
  const boostB = focusSoftBoost(b, ctx.roundFocus, ctx.roundType);
  if (boostB !== boostA) return boostB - boostA;

  const vA = verifiedRank(a);
  const vB = verifiedRank(b);
  if (vB !== vA) return vB - vA;

  const qA = qualityRank(a);
  const qB = qualityRank(b);
  if (qB !== qA) return qB - qA;

  return Math.random() - 0.5;
}

function buildEvalFilter(questionKind, roundType) {
  if (questionKind === "mcq") return { evaluationStrategy: "mcq_exact" };
  if (questionKind === "theory") {
    return { evaluationStrategy: "rubric_llm" };
  }
  if (isCsFundamentalsRoundType(roundType) && questionKind === "mcq") {
    return { evaluationStrategy: "mcq_exact" };
  }
  return {};
}

/**
 * @typedef {"category"|"any"} PoolMode
 */

async function fetchCandidateBatch({
  roundType,
  difficulty,
  categoryId,
  poolMode,
  questionKind,
  excludedQuestionIds,
}) {
  const match = {
    roundType: { $regex: `^${escapeRegex(roundType)}$`, $options: "i" },
    difficulty,
  };
  if (excludedQuestionIds.length) {
    match.questionId = { $nin: excludedQuestionIds };
  }
  Object.assign(match, buildEvalFilter(questionKind, roundType));

  if (poolMode === "category" && categoryId) {
    match.category = categoryId;
  }

  return InterviewQuestion.find(match).limit(200).lean();
}

function poolEligible(doc, { poolMode, categoryId, roleTag, companyTag, requireRole = true }) {
  if (requireRole && !roleMatches(doc, roleTag)) return false;
  if (poolMode === "category") {
    if (categoryId && categoryMatches(doc, categoryId)) return true;
    if (!companyTag && !categoryId) return true;
    return false;
  }
  return true;
}

/**
 * /general platform mock retrieval — campus path must not call this.
 */
export async function retrievePlatformQuestion({
  company,
  companyCategoryId,
  role,
  roundType,
  difficulty,
  excludedQuestionIds = [],
  questionKind = null,
  roundFocus = "",
}) {
  const companyTag = toSafeString(company);
  const roleTag = toSafeString(role);
  const normalizedRoundType = toSafeString(roundType);
  const categoryId = toSafeString(companyCategoryId);
  const normalizedQuestionKind = toSafeString(questionKind).toLowerCase() || null;
  const exclusions = normalizeExclusions(excludedQuestionIds);

  if (!normalizedRoundType || !companyTag || !roleTag) {
    return null;
  }

  const ctx = {
    companyTag,
    categoryId,
    roleTag,
    roundFocus,
    roundType: normalizedRoundType,
  };

  const poolModes = categoryId ? ["category", "any"] : ["any"];

  const pickFromPools = async ({ requireRole }) => {
    for (const diff of difficultyOrder(difficulty)) {
      for (const poolMode of poolModes) {
        const batch = await fetchCandidateBatch({
          roundType: normalizedRoundType,
          difficulty: diff,
          categoryId,
          poolMode,
          questionKind: normalizedQuestionKind,
          excludedQuestionIds: exclusions,
        });

        const eligible = batch.filter(
          (doc) =>
            poolEligible(doc, {
              poolMode,
              categoryId,
              roleTag,
              companyTag,
              requireRole,
            }) && docPassesBankFilter(normalizedRoundType, doc, normalizedQuestionKind)
        );

        if (!eligible.length) continue;

        eligible.sort((a, b) => compareDocs(a, b, ctx));
        return eligible[0];
      }
    }
    return null;
  };

  const roleMatched = await pickFromPools({ requireRole: true });
  if (roleMatched) return roleMatched;

  const roleRelaxed = await pickFromPools({ requireRole: false });
  if (roleRelaxed) {
    console.warn("[retrievePlatformQuestion] No role-tagged bank row; using same-round fallback", {
      role: roleTag,
      roundType: normalizedRoundType,
      questionKind: normalizedQuestionKind,
      questionId: roleRelaxed.questionId,
    });
  }
  return roleRelaxed;
}
