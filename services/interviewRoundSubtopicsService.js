import InterviewQuestion from "../models/InterviewQuestion.js";
import {
  getFocusOptionsForRoundType,
  roundTypeHasFocusPicker,
} from "../config/interviewRoundFocus.js";

const toSafeString = (value) =>
  typeof value === "string" && value.trim() ? value.trim() : "";

const escapeRegex = (value = "") => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeDifficulty = (value) => {
  const safe = toSafeString(value, "medium").toLowerCase();
  return safe === "easy" || safe === "medium" || safe === "hard" ? safe : "medium";
};

export const bankFocusId = (label) => {
  const token = toSafeString(label);
  if (!token) return "";
  return `bank:${encodeURIComponent(token)}`;
};

export const decodeBankFocusLabel = (focusId) => {
  const raw = toSafeString(focusId);
  if (!raw.startsWith("bank:")) return "";
  try {
    return decodeURIComponent(raw.slice(5)).trim();
  } catch {
    return raw.slice(5).trim();
  }
};

const slugKey = (value) =>
  toSafeString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Build Mongo filter clause matching bank `topics` / `subtopics` for a plan focus id.
 * Returns null for "general" / empty (no subtopic constraint).
 */
export const buildSubtopicMongoClause = (roundType, focusId) => {
  const focus = toSafeString(focusId);
  if (!focus || focus === "general") return null;

  if (focus.startsWith("bank:")) {
    const token = decodeBankFocusLabel(focus);
    if (!token) return null;
    const escaped = escapeRegex(token);
    return {
      $or: [
        { subtopics: { $regex: escaped, $options: "i" } },
        { topics: { $regex: escaped, $options: "i" } },
      ],
    };
  }

  const options = getFocusOptionsForRoundType(roundType);
  const opt = options.find((item) => item.id === focus);
  const patterns = Array.isArray(opt?.match) ? opt.match.filter(Boolean) : [];
  if (!patterns.length) return null;

  return {
    $or: patterns.flatMap((pattern) => {
      const escaped = escapeRegex(String(pattern));
      return [
        { subtopics: { $regex: escaped, $options: "i" } },
        { topics: { $regex: escaped, $options: "i" } },
      ];
    }),
  };
};

const buildStrictBankFilter = ({ roundType, role, companyCategoryId, difficulty }) => {
  const filter = {
    roundType: { $regex: `^${escapeRegex(toSafeString(roundType))}$`, $options: "i" },
    difficulty: normalizeDifficulty(difficulty),
  };
  const roleTag = toSafeString(role);
  const categoryId = toSafeString(companyCategoryId);
  if (roleTag) filter.roleTags = roleTag;
  if (categoryId) filter.category = categoryId;
  return filter;
};

/**
 * Static focus presets + bank-derived subtopics for mock plan UI.
 */
export async function listFocusOptionsForMock({
  roundType,
  role = "",
  company = "",
  companyCategoryId = "",
  difficulty = "medium",
  platform = false,
}) {
  const type = toSafeString(roundType);
  if (!type) {
    return { options: [], hasPicker: false };
  }

  const staticOpts = getFocusOptionsForRoundType(type).map((opt) => ({
    id: opt.id,
    label: opt.label,
    source: "static",
    count: null,
  }));

  const seen = new Set(staticOpts.map((opt) => slugKey(opt.label)));
  const merged = [...staticOpts];

  const baseFilter = platform
    ? buildStrictBankFilter({ roundType: type, role, companyCategoryId, difficulty })
    : {
        roundType: { $regex: `^${escapeRegex(type)}$`, $options: "i" },
        difficulty: normalizeDifficulty(difficulty),
      };

  const [subtopicRows, topicRows] = await Promise.all([
    InterviewQuestion.aggregate([
      { $match: baseFilter },
      { $unwind: "$subtopics" },
      {
        $group: {
          _id: "$subtopics",
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 32 },
    ]),
    InterviewQuestion.aggregate([
      { $match: baseFilter },
      { $unwind: "$topics" },
      {
        $group: {
          _id: "$topics",
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 24 },
    ]),
  ]);

  const appendBank = (rows) => {
    for (const row of rows) {
      const label = toSafeString(row?._id);
      if (!label || label.length > 80) continue;
      const key = slugKey(label);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push({
        id: bankFocusId(label),
        label,
        source: "bank",
        count: row.count || 0,
      });
    }
  };

  appendBank(subtopicRows);
  appendBank(topicRows);

  const hasPicker =
    merged.length > 1 && (roundTypeHasFocusPicker(type) || merged.some((opt) => opt.source === "bank"));

  return { options: merged, hasPicker };
}
