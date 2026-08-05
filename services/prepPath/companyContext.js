import mongoose from "mongoose";
import CompanyStatic from "../../models/CompanyStatic.js";
import CompanyVisit from "../../models/CompanyVisit.js";
import { filterRolesForCollege, normalizeCollegeId } from "../../utils/collegeScope.js";
import { listRolePointSections } from "../../utils/normalizeAdminRole.js";

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

/** Role keys that are not useful as prep signals (meta / eligibility / pay already skipped upstream). */
const ROLE_PREP_SKIP_KEYS = new Set([
  "collegeid",
  "college",
  "branch",
  "cluster",
  "year",
  "eligibility",
  "mincgpa",
  "cgpa",
  "location",
  "openfor",
  "package",
  "bond",
  "bonds",
  "deadline",
  "lastdate",
  "drive",
  "drivedate",
]);

function roleFieldLabel(key) {
  const nk = String(key || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  if (nk === "skills" || nk === "skill") return "skills";
  if (nk === "workdescription" || nk === "work") return "work description";
  if (
    nk === "jobdescription" ||
    nk === "jobdesc" ||
    nk === "jd" ||
    nk === "job"
  ) {
    return "job description";
  }
  if (
    nk === "about" ||
    nk === "aboutrole" ||
    nk === "abouttherole" ||
    nk === "roleabout"
  ) {
    return "about the role";
  }
  return (
    String(key || "")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " ")
      .trim()
      .toLowerCase() || "detail"
  );
}

/**
 * Extract skills / JD / work description / about-the-role style fields from a role object.
 * Field names vary by company; listRolePointSections keeps stored keys as-is.
 */
function extractRolePrepFields(role) {
  return listRolePointSections(role)
    .filter((section) => {
      const nk = String(section.key || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "");
      return nk && !ROLE_PREP_SKIP_KEYS.has(nk);
    })
    .map((section) => ({
      key: section.key,
      label: roleFieldLabel(section.key),
      points: section.points.slice(0, 3).map((p) => clip(p, 140)),
    }))
    .filter((section) => section.points.length > 0);
}

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
  const roles = [];
  const roleDetails = [];

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

    const visitRoles = collegeId
      ? filterRolesForCollege(v.roles || [], collegeId)
      : v.roles || [];
    for (const r of visitRoles) {
      if (typeof r === "string" && r.trim()) {
        roles.push(r.trim());
        continue;
      }
      if (!r || typeof r !== "object") continue;
      const label =
        String(r.roleName || r.role || r.title || r.name || "").trim() || "Role";
      if (label && label !== "Role") roles.push(label);

      const fields = extractRolePrepFields(r);
      if (!fields.length) continue;

      roleDetails.push({
        roleName: label,
        year,
        cluster,
        fields,
      });

      for (const field of fields.slice(0, 3)) {
        for (const point of field.points.slice(0, 2)) {
          pushEvidence(evidenceBank, {
            sourceType: "platform_role",
            text: `Role "${label}" · ${field.label}: ${point}`,
            year,
            cluster,
            branch,
          });
        }
      }
    }
  }

  const evidenceCapped = evidenceBank.slice(0, 60);

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
  const platformRoleSignals = [
    ...new Set(
      evidenceCapped.filter((e) => e.sourceType === "platform_role").map((e) => e.text)
    ),
  ].slice(0, 40);
  const signal = countSignal([
    mustDoUnique,
    onlineQuestions,
    interviewQuestions,
    interviewProcess,
  ]);
  /**
   * Web (Tavily) fallback:
   * - Use when there are no interview experiences for this company, AND
   * - Skip when must-do topics alone are rich (> 10), even with no experiences.
   */
  const needsWebEnrichment =
    interviewProcess.length === 0 && mustDoUnique.length <= 10;
  // Role JD/skills count as usable campus signal for the LLM even when Tavily still runs.
  const limitedData =
    needsWebEnrichment && platformRoleSignals.length === 0;

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
    about: String(staticRow.about || "").trim().slice(0, 400),
    track,
    trackLabel: prepPathTrackLabel(track),
    trackMatched,
    roles: [...new Set(roles)].slice(0, 12),
    roleDetails: roleDetails.slice(0, 8),
    mustDoTopics: mustDoUnique,
    onlineQuestions,
    interviewQuestions,
    interviewProcess,
    platformRoleSignals,
    internshipExperience: interviewProcess.slice(0, 15),
    prevCodingQuestions: onlineQuestions.slice(0, 15),
    visitYears: visits.map((v) => v.year).filter(Boolean),
    evidenceBank: evidenceCapped,
    limitedData,
    needsWebEnrichment,
    signalCount: signal,
    sources,
    flags: {
      usedMustDo: mustDoUnique.length > 0,
      usedOA: onlineQuestions.length > 0,
      usedInterview: interviewQuestions.length > 0,
      usedExperiences: interviewProcess.length > 0,
      usedPlatformRoles: platformRoleSignals.length > 0,
      trackMatched,
    },
  };
}

function scoreRoleNameMatch(roleName, targetRole) {
  const a = String(roleName || "")
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  const b = new Set(
    String(targetRole || "")
      .toLowerCase()
      .replace(/[^a-z0-9+#.\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 2)
  );
  if (!a.length || !b.size) return 0;
  let hit = 0;
  for (const t of a) if (b.has(t)) hit += 1;
  return hit;
}

/**
 * Compact company block for the LLM prompt (token-lean).
 * @param {object} ctx
 * @param {{ targetRole?: string }} [options]
 */
export function formatCompanyContextForPrompt(ctx, options = {}) {
  const targetRole = String(options.targetRole || "").trim();

  // Prefer roles matching the user-entered target; fall back to first roles.
  const allDetails = Array.isArray(ctx.roleDetails) ? [...ctx.roleDetails] : [];
  if (targetRole) {
    allDetails.sort(
      (x, y) =>
        scoreRoleNameMatch(y.roleName, targetRole) -
        scoreRoleNameMatch(x.roleName, targetRole)
    );
  }
  const details = allDetails.slice(0, 2);

  const roleDetailLines = [];
  for (const role of details) {
    roleDetailLines.push(`Role: ${role.roleName || "Role"}`);
    for (const field of (role.fields || []).slice(0, 3)) {
      const joined = (field.points || []).slice(0, 2).join("; ");
      if (!joined) continue;
      roleDetailLines.push(`  - ${field.label}: ${joined}`);
    }
  }

  // Skip platform_role rows in evidence — already covered in role details above.
  const evidenceLines = (Array.isArray(ctx.evidenceBank) ? ctx.evidenceBank : [])
    .filter((e) => e?.sourceType && e.sourceType !== "platform_role")
    .slice(0, 18)
    .map((e) => {
      const meta = [
        e.sourceType,
        e.year ? `y${e.year}` : null,
      ]
        .filter(Boolean)
        .join(",");
      return `- [${meta}] ${e.text}`;
    });

  const about = clip(ctx.about || "", 360);
  const lines = [
    `Company: ${ctx.companyName}`,
    `Track: ${ctx.trackLabel || prepPathTrackLabel(ctx.track)}`,
    about ? `About: ${about}` : "",
    ctx.roles?.length
      ? `Roles: ${ctx.roles.slice(0, 8).join("; ")}`
      : "",
    "",
    "=== Platform roles (HIGH PRIORITY; cite as \"mentioned in the platform roles\") ===",
    roleDetailLines.length ? roleDetailLines.join("\n") : "(none)",
    "",
    "=== Campus evidence (cite only these) ===",
    evidenceLines.length ? evidenceLines.join("\n") : "(none)",
  ];
  return lines.filter((l) => l !== null && l !== undefined && l !== "").join("\n");
}
