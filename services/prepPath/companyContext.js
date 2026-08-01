import mongoose from "mongoose";
import CompanyStatic from "../../models/CompanyStatic.js";
import CompanyVisit from "../../models/CompanyVisit.js";
import { filterRolesForCollege, normalizeCollegeId } from "../../utils/collegeScope.js";

export const PREP_PATH_TRACKS = Object.freeze({
  FULL_TIME: "full_time",
  SUMMER_INTERNSHIP: "summer_internship",
});

export function normalizePrepPathTrack(raw) {
  const t = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (
    t === PREP_PATH_TRACKS.SUMMER_INTERNSHIP ||
    t === "summer" ||
    t === "internship" ||
    t === "intern"
  ) {
    return PREP_PATH_TRACKS.SUMMER_INTERNSHIP;
  }
  if (t === PREP_PATH_TRACKS.FULL_TIME || t === "fte" || t === "fulltime" || t === "placement") {
    return PREP_PATH_TRACKS.FULL_TIME;
  }
  return null;
}

export function prepPathTrackLabel(track) {
  return track === PREP_PATH_TRACKS.SUMMER_INTERNSHIP
    ? "Summer internship"
    : "Full-time";
}

const clip = (s, max = 220) => {
  const t = String(s || "").trim();
  if (!t) return "";
  return t.length > max ? `${t.slice(0, max)}…` : t;
};

const asTextList = (arr, maxItems, maxItemLen = 220) =>
  (Array.isArray(arr) ? arr : [])
    .map((x) =>
      typeof x === "string"
        ? x.trim()
        : String(x?.text || x?.question || x?.title || "").trim()
    )
    .filter(Boolean)
    .slice(0, maxItems)
    .map((s) => clip(s, maxItemLen));

const countSignal = (lists) =>
  lists.reduce((n, list) => n + (Array.isArray(list) ? list.filter(Boolean).length : 0), 0);

function pushEvidence(bank, { sourceType, text, year, cluster, branch }) {
  const t = clip(text, 220);
  if (!t) return;
  bank.push({
    id: `e${bank.length + 1}`,
    sourceType,
    text: t,
    year: year || null,
    cluster: String(cluster || "").trim(),
    branch: String(branch || "").trim(),
  });
}

function normalizeVisitType(type) {
  return String(type || "")
    .trim()
    .replace(/\s+/g, "")
    .toLowerCase();
}

/**
 * Lightweight track classifier for PrepPath (no hub-settings / Redis imports).
 * Summer-leaning: PPO / internship / summer type markers without an FTE package track.
 */
function isSummerLeanVisit(visit) {
  if (!visit || typeof visit !== "object") return false;
  if (visit.offCampus === true) return false;
  const type = normalizeVisitType(visit.type);
  const cluster = normalizeVisitType(visit.cluster);
  const blob = `${type} ${cluster}`;
  if (blob.includes("fte") && !blob.includes("intern")) return false;
  if (type.includes("fte") && type.includes("intern")) return false; // Internship+FTE → FTE-leaning
  return blob.includes("ppo") || blob.includes("intern") || blob.includes("summer");
}

/**
 * Prefer track-matching visits; fall back to all visits if none match.
 */
function selectVisitsForTrack(allVisits, track) {
  const list = Array.isArray(allVisits) ? allVisits : [];
  if (!list.length) return [];

  const summer = list.filter((v) => isSummerLeanVisit(v));
  const fte = list.filter((v) => !isSummerLeanVisit(v));

  if (track === PREP_PATH_TRACKS.SUMMER_INTERNSHIP) {
    const preferred = summer.length ? summer : list;
    return preferred.slice(0, 8);
  }

  const preferred = fte.length ? fte : list;
  return preferred.slice(0, 8);
}

/**
 * Load company prep context from existing read-only company collections.
 * Never writes to CompanyStatic / CompanyVisit.
 * @param {string} companyId
 * @param {{ track?: string, collegeId?: string }} [options]
 */
export async function loadCompanyPrepContext(companyId, options = {}) {
  const id = String(companyId || "").trim();
  if (!mongoose.Types.ObjectId.isValid(id)) {
    const err = new Error("Invalid company.");
    err.code = "INVALID_COMPANY";
    throw err;
  }

  const track =
    normalizePrepPathTrack(options.track) || PREP_PATH_TRACKS.FULL_TIME;
  const collegeId =
    options.collegeId != null && String(options.collegeId).trim() !== ""
      ? normalizeCollegeId(options.collegeId)
      : null;

  const staticRow = await CompanyStatic.findById(id).lean();
  if (!staticRow) {
    const err = new Error("Company not found.");
    err.code = "COMPANY_NOT_FOUND";
    throw err;
  }

  const allVisits = await CompanyVisit.find({ companyId: staticRow._id })
    .sort({ year: -1 })
    .limit(24)
    .lean();

  const visits = selectVisitsForTrack(allVisits, track);
  const trackMatched =
    track === PREP_PATH_TRACKS.SUMMER_INTERNSHIP
      ? visits.some((v) => isSummerLeanVisit(v))
      : visits.some((v) => !isSummerLeanVisit(v));

  const evidenceBank = [];

  for (const topic of asTextList(staticRow.must_do_topics, 30)) {
    pushEvidence(evidenceBank, {
      sourceType: "must_do",
      text: topic,
      year: null,
      cluster: "",
      branch: "",
    });
  }

  for (const q of asTextList(
    (staticRow.prev_coding_ques || []).map((row) =>
      typeof row === "string" ? row : row?.title || row?.question || ""
    ),
    12
  )) {
    pushEvidence(evidenceBank, {
      sourceType: "oa",
      text: q,
      year: null,
      cluster: "",
      branch: "",
    });
  }

  for (const v of visits) {
    const year = v.year || null;
    const cluster = v.cluster || "";
    const branch = v.branch || "";
    for (const topic of asTextList(v.must_do_topics, 18)) {
      pushEvidence(evidenceBank, { sourceType: "must_do", text: topic, year, cluster, branch });
    }
    for (const q of asTextList(v.onlineQuestions, 12)) {
      pushEvidence(evidenceBank, { sourceType: "oa", text: q, year, cluster, branch });
    }
    for (const q of asTextList(v.interviewQuestions, 14)) {
      pushEvidence(evidenceBank, {
        sourceType: "interview_question",
        text: q,
        year,
        cluster,
        branch,
      });
    }
    for (const q of asTextList(v.interviewProcess, 10)) {
      pushEvidence(evidenceBank, {
        sourceType: "interview_experience",
        text: q,
        year,
        cluster,
        branch,
      });
    }
    if (track === PREP_PATH_TRACKS.SUMMER_INTERNSHIP) {
      for (const q of asTextList(v.internshipExperience, 10)) {
        pushEvidence(evidenceBank, {
          sourceType: "interview_experience",
          text: q,
          year,
          cluster,
          branch,
        });
      }
    } else {
      for (const q of asTextList(v.internshipExperience, 3)) {
        pushEvidence(evidenceBank, {
          sourceType: "interview_experience",
          text: q,
          year,
          cluster,
          branch,
        });
      }
    }
  }

  const evidenceCapped = evidenceBank.slice(0, 80);

  const mustDoUnique = [
    ...new Set(evidenceCapped.filter((e) => e.sourceType === "must_do").map((e) => e.text)),
  ].slice(0, 50);
  const onlineQuestions = [
    ...new Set(evidenceCapped.filter((e) => e.sourceType === "oa").map((e) => e.text)),
  ].slice(0, 25);
  const interviewQuestions = [
    ...new Set(
      evidenceCapped.filter((e) => e.sourceType === "interview_question").map((e) => e.text)
    ),
  ].slice(0, 30);
  const interviewProcess = [
    ...new Set(
      evidenceCapped
        .filter((e) => e.sourceType === "interview_experience")
        .map((e) => e.text)
    ),
  ].slice(0, 25);

  const roles = [];
  for (const v of visits) {
    const visitRoles = collegeId
      ? filterRolesForCollege(v.roles || [], collegeId)
      : v.roles || [];
    for (const r of visitRoles) {
      if (typeof r === "string" && r.trim()) roles.push(r.trim());
      else if (r && typeof r === "object") {
        const label = String(r.roleName || r.role || r.title || r.name || "").trim();
        if (label) roles.push(label);
      }
    }
  }

  const signal = countSignal([
    mustDoUnique,
    onlineQuestions,
    interviewQuestions,
    interviewProcess,
  ]);
  const limitedData = signal < 6;

  const sources = [
    {
      title: `${staticRow.name || "Company"} — campus prep data (${prepPathTrackLabel(track)})`,
      url: "",
      kind: "platform",
    },
  ];

  return {
    companyId: String(staticRow._id),
    companyName: String(staticRow.name || "").trim() || "Company",
    about: String(staticRow.about || "").trim().slice(0, 1200),
    track,
    trackLabel: prepPathTrackLabel(track),
    trackMatched,
    roles: [...new Set(roles)].slice(0, 20),
    mustDoTopics: mustDoUnique,
    onlineQuestions,
    interviewQuestions,
    interviewProcess,
    internshipExperience: interviewProcess.slice(0, 15),
    prevCodingQuestions: onlineQuestions.slice(0, 15),
    visitYears: visits.map((v) => v.year).filter(Boolean),
    evidenceBank: evidenceCapped,
    limitedData,
    signalCount: signal,
    sources,
    flags: {
      usedMustDo: mustDoUnique.length > 0,
      usedOA: onlineQuestions.length > 0,
      usedInterview: interviewQuestions.length > 0,
      usedExperiences: interviewProcess.length > 0,
      trackMatched,
    },
  };
}

export function formatCompanyContextForPrompt(ctx) {
  const evidenceLines = (Array.isArray(ctx.evidenceBank) ? ctx.evidenceBank : [])
    .slice(0, 40)
    .map((e) => {
      const meta = [
        e.sourceType,
        e.year ? `year=${e.year}` : null,
        e.cluster ? `cluster=${e.cluster}` : null,
      ]
        .filter(Boolean)
        .join(", ");
      return `- [${meta}] ${e.text}`;
    });

  const lines = [
    `Company: ${ctx.companyName}`,
    `Prep track: ${ctx.trackLabel || prepPathTrackLabel(ctx.track)}`,
    ctx.trackMatched === false
      ? "Note: No track-specific visit rows found; using best available campus data."
      : "",
    ctx.about ? `About: ${ctx.about}` : "",
    ctx.roles.length ? `Known roles on platform: ${ctx.roles.join("; ")}` : "",
    ctx.visitYears?.length ? `Visit years present: ${ctx.visitYears.join(", ")}` : "",
    "",
    "=== Campus evidence (cite only these; include year/cluster when present) ===",
    evidenceLines.length ? evidenceLines.join("\n") : "(none)",
  ];
  return lines.filter((l) => l !== null && l !== undefined && l !== "").join("\n");
}
