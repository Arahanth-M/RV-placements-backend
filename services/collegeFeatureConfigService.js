import CollegeFeatureConfig from "../models/CollegeFeatureConfig.js";
import {
  COLLEGE_ID_RVCE,
  collegeIdFromUser,
  normalizeCollegeId,
} from "../utils/collegeScope.js";

/** Keep in sync with frontend ONBOARDING_FEATURES ids/titles. */
export const FEATURE_CATALOG = [
  {
    id: "company_insights",
    title: "Company insights",
    text: "Roles, process, and what each company looks for.",
  },
  {
    id: "ai_interviews",
    title: "AI interviews by company & role",
    text: "Practice rounds with actionable feedback.",
  },
  {
    id: "prep_path",
    title: "PrepPath",
    text: "Guided plan toward target roles.",
  },
  {
    id: "resources_must_do",
    title: "Curated resources & must-dos",
    text: "Handpicked links and must-do topics.",
  },
  {
    id: "coding_experiences",
    title: "Coding Qs & interview experiences",
    text: "Real questions and campus stories.",
  },
  {
    id: "practice_challenges",
    title: "Daily & weekly challenges",
    text: "Short practice bursts vs peers.",
  },
  {
    id: "peer_mocks",
    title: "Peer mock pairing",
    text: "Book 30‑minute mocks with classmates.",
  },
  {
    id: "behavioral_coach",
    title: "Behavioral answer coach",
    text: "STAR-format practice for HR rounds.",
  },
  {
    id: "career_explorer",
    title: "Career explorer",
    text: "Roles, skills, JDs, and salary ranges.",
  },
  {
    id: "resume_builder",
    title: "Resume builder + ATS",
    text: "Live preview and ATS checks.",
  },
  {
    id: "drive_calendar",
    title: "Drive calendar & reminders",
    text: "Visits, deadlines, eligibility checklists.",
  },
  {
    id: "document_vault",
    title: "Private document vault",
    text: "Offers, resumes, certificates in one place.",
  },
  {
    id: "hear_from_seniors",
    title: "Hear from seniors",
    text: "Advice from people a step ahead on campus.",
  },
  {
    id: "performance_overview",
    title: "Performance overview",
    text: "Strengths, gaps, and progress across practice.",
  },
];

const FEATURE_IDS = new Set(FEATURE_CATALOG.map((f) => f.id));
const CATALOG_BY_ID = new Map(FEATURE_CATALOG.map((f) => [f.id, f]));

const COLLEGE_DISPLAY_NAMES = {
  [COLLEGE_ID_RVCE]: "RVCE",
  rvitm: "RVITM",
};

function appError(message, code, status = 400) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

function normalizeFeatureList(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const id = String(item || "")
      .trim()
      .toLowerCase();
    if (!id || !FEATURE_IDS.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function featuresEqual(a = [], b = []) {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((id, i) => id === sb[i]);
}

function enrichFeatures(selectedFeatures = []) {
  return selectedFeatures
    .map((id) => CATALOG_BY_ID.get(id))
    .filter(Boolean)
    .map((f) => ({ id: f.id, title: f.title, text: f.text }));
}

function toPublicConfig(doc) {
  const collegeId = normalizeCollegeId(doc?.collegeId || COLLEGE_ID_RVCE);
  const selectedFeatures = Array.isArray(doc?.selectedFeatures) ? doc.selectedFeatures : [];
  return {
    collegeId,
    collegeName:
      String(doc?.collegeName || "").trim() || COLLEGE_DISPLAY_NAMES[collegeId] || collegeId,
    selectedFeatures,
    featuresUpdatedAt: doc?.featuresUpdatedAt || doc?.updatedAt || null,
    features: enrichFeatures(selectedFeatures),
    catalog: FEATURE_CATALOG,
  };
}

/**
 * @param {string} collegeId
 */
export async function getCollegeFeatureConfig(collegeId) {
  const id = normalizeCollegeId(collegeId);
  const doc = await CollegeFeatureConfig.findOne({ collegeId: id }).lean();
  if (!doc) {
    return toPublicConfig({
      collegeId: id,
      collegeName: COLLEGE_DISPLAY_NAMES[id] || id,
      selectedFeatures: [],
      featuresUpdatedAt: null,
    });
  }
  return toPublicConfig(doc);
}

/**
 * @param {string} collegeId
 * @param {{ selectedFeatures?: string[], collegeName?: string }} input
 */
export async function upsertCollegeFeatureConfig(collegeId, input = {}) {
  const id = normalizeCollegeId(collegeId);
  const selectedFeatures = normalizeFeatureList(input.selectedFeatures);
  if (Array.isArray(input.selectedFeatures) && selectedFeatures.length === 0 && input.selectedFeatures.length > 0) {
    throw appError("No valid feature IDs in the selection", "INVALID_FEATURES");
  }

  const collegeName = String(input.collegeName || COLLEGE_DISPLAY_NAMES[id] || id)
    .trim()
    .slice(0, 160);

  let doc = await CollegeFeatureConfig.findOne({ collegeId: id });
  if (!doc) {
    doc = new CollegeFeatureConfig({
      collegeId: id,
      collegeName,
      selectedFeatures,
      featuresUpdatedAt: new Date(),
    });
  } else {
    const changed = !featuresEqual(doc.selectedFeatures || [], selectedFeatures);
    doc.collegeName = collegeName || doc.collegeName;
    doc.selectedFeatures = selectedFeatures;
    if (changed) doc.featuresUpdatedAt = new Date();
  }

  await doc.save();
  return toPublicConfig(doc.toObject());
}

/**
 * Student-facing: resolve college from JWT user.
 * @param {{ collegeId?: unknown, email?: unknown }|null|undefined} user
 */
export async function getCollegeFeaturesForUser(user) {
  return getCollegeFeatureConfig(collegeIdFromUser(user));
}
