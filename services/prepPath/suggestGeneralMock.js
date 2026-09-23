import {
  INTERVIEW_DIFFICULTIES,
  PLATFORM_FRESHER_ROLES,
  isPlatformFresherRole,
  isPlatformInterviewRoundType,
} from "../../config/interviewCatalog.js";

const MAX_MOCK_ROUNDS = 4;

/**
 * Map free-text PrepPath role onto the /general fresher mock catalog.
 * Deterministic — never invents a role the interviews hub cannot start.
 */
export function matchPlatformFresherRole(rawRole) {
  const s = String(rawRole || "").trim();
  if (!s) return "Software Engineer (SDE)";
  const exact = PLATFORM_FRESHER_ROLES.find(
    (role) => role.toLowerCase() === s.toLowerCase()
  );
  if (exact) return exact;

  const n = s.toLowerCase();
  if (/\bvlsi\b|hardware|rtl|verilog|vhdl|asic/.test(n)) {
    return "VLSI/Hardware Engineer";
  }
  if (/\bembedded\b|firmware|\bmcu\b|\biot\b/.test(n)) {
    return "Embedded Systems Engineer";
  }
  if (/\bconsultant\b|consulting/.test(n)) return "Consultant";
  if (/\bproduct\b|business analyst|\bba\b/.test(n)) {
    return "Business/Product Analyst";
  }
  if (/\bqa\b|sdet|test engineer|quality/.test(n)) return "QA/SDET";
  if (/\bdevops\b|\bsre\b|cloud engineer|platform engineer/.test(n)) {
    return "DevOps/Cloud Engineer";
  }
  if (/data analyst/.test(n)) return "Data Analyst";
  if (/data scientist/.test(n)) return "Data Scientist";
  if (/data engineer/.test(n)) return "Data Engineer";
  if (/\bai\b|\bml\b|machine learning|deep learning/.test(n)) {
    return "AI/ML Engineer";
  }
  if (/front-?end|react|ui engineer/.test(n)) return "Frontend Engineer";
  if (/back-?end|server/.test(n)) return "Backend Engineer";
  if (/full.?stack/.test(n)) return "Full Stack Engineer";
  if (/\bget\b|graduate engineer|trainee/.test(n)) {
    return "Graduate Engineer Trainee (GET)";
  }
  if (/\bsde\b|software|\bswe\b|developer/.test(n)) {
    return "Software Engineer (SDE)";
  }
  return "Software Engineer (SDE)";
}

function isInternTrack(track) {
  return String(track || "").trim() === "summer_internship";
}

function baseRoundsForRole(role, intern) {
  switch (role) {
    case "AI/ML Engineer":
      return intern
        ? ["ML/AI Technical", "DSA", "HR"]
        : ["ML/AI Technical", "DSA", "CS Fundamentals", "HR"];
    case "Data Scientist":
      return ["ML/AI Technical", "SQL", "HR"];
    case "Data Analyst":
      return intern
        ? ["SQL", "Aptitude", "HR"]
        : ["SQL", "Aptitude", "Case Interview", "HR"];
    case "Data Engineer":
      return ["SQL", "DSA", "HR"];
    case "QA/SDET":
      return intern ? ["DSA", "Aptitude", "HR"] : ["DSA", "CS Fundamentals", "HR"];
    case "DevOps/Cloud Engineer":
      return ["CS Fundamentals", "DSA", "HR"];
    case "Business/Product Analyst":
      return ["Case Interview", "Aptitude", "HR"];
    case "Consultant":
      return intern
        ? ["Case Interview", "HR"]
        : ["Case Interview", "Project/Resume Deep Dive", "HR"];
    case "Embedded Systems Engineer":
      return ["Embedded Systems", "Core Technical", "HR"];
    case "VLSI/Hardware Engineer":
      return ["Circuit Design", "Core Technical", "HR"];
    case "Graduate Engineer Trainee (GET)":
      return intern
        ? ["DSA", "Aptitude", "HR"]
        : ["DSA", "CS Fundamentals", "Aptitude", "HR"];
    case "Frontend Engineer":
      return intern ? ["DSA", "Aptitude", "HR"] : ["DSA", "Web Dev", "HR"];
    case "Backend Engineer":
    case "Full Stack Engineer":
    case "Software Engineer (SDE)":
    default:
      return intern ? ["DSA", "Aptitude", "HR"] : ["DSA", "CS Fundamentals", "HR"];
  }
}

function extrasFromText(blob) {
  const n = String(blob || "").toLowerCase();
  const extras = [];
  if (/\bsql\b|database|joins/.test(n)) extras.push("SQL");
  if (/\baptitude\b|quant|logical reasoning/.test(n)) extras.push("Aptitude");
  if (/\bos\b|dbms|oops|operating system|computer network/.test(n)) {
    extras.push("CS Fundamentals");
  }
  if (/\bml\b|machine learning|neural|deep learning/.test(n)) {
    extras.push("ML/AI Technical");
  }
  if (/\bresume\b|project deep/.test(n)) extras.push("Project/Resume Deep Dive");
  return extras;
}

function finalizeRounds(list) {
  const out = [];
  for (const raw of list || []) {
    const type = String(raw || "").trim();
    if (!isPlatformInterviewRoundType(type)) continue;
    if (out.includes(type) || out.length >= MAX_MOCK_ROUNDS) continue;
    out.push(type);
  }
  if (out.length === 0) return ["DSA", "HR"];
  if (out.length === 1) {
    if (out[0] !== "HR") out.push("HR");
    else out.unshift("DSA");
  }
  return out.slice(0, MAX_MOCK_ROUNDS);
}

function pickDifficulty({ limitedData, days }) {
  const dayCount = Number(days);
  if (limitedData || (Number.isFinite(dayCount) && dayCount <= 2)) {
    return "easy";
  }
  return "medium";
}

function softwareIsh(role) {
  return [
    "Software Engineer (SDE)",
    "Frontend Engineer",
    "Backend Engineer",
    "Full Stack Engineer",
    "QA/SDET",
    "Graduate Engineer Trainee (GET)",
    "Data Engineer",
  ].includes(role);
}

function buildWhy({ role, difficulty, rounds, flags, intern }) {
  const bits = [];
  if (flags?.usedOA) bits.push("OA");
  if (flags?.usedCoding) bits.push("coding questions");
  if (flags?.usedMustDo) bits.push("must-do");
  if (flags?.usedInterview) bits.push("interview questions");
  const coverage = bits.length
    ? `Mapped from your ${role} plan and this company's ${bits.join(" / ")} coverage.`
    : `Mapped from your ${role} PrepPath onto the /general mock catalog.`;
  return `${coverage} Suggested ${difficulty} mock${
    intern ? " for intern track" : ""
  }: ${rounds.join(", ")}.`;
}

/**
 * /general-only mock suggestion. Catalog mapping — not LLM-invented rounds.
 */
export function suggestGeneralMockInterview({
  role,
  track,
  days,
  flags = {},
  limitedData = false,
  skillGaps = [],
  topicTitles = [],
} = {}) {
  const mappedRole = matchPlatformFresherRole(role);
  const intern = isInternTrack(track);
  const difficulty = pickDifficulty({ limitedData, days });
  const blob = [...(topicTitles || []), ...(skillGaps || [])].join(" ");
  let rounds = [
    ...baseRoundsForRole(mappedRole, intern),
    ...extrasFromText(blob),
  ];
  if ((flags.usedOA || flags.usedCoding) && softwareIsh(mappedRole)) rounds.unshift("DSA");
  if ((flags.usedOA || flags.usedCoding) && mappedRole === "Data Analyst") rounds.unshift("SQL");
  if (flags.usedInterview || flags.usedExperiences) rounds.push("HR");
  rounds = finalizeRounds(rounds);

  const suggestion = {
    role: mappedRole,
    difficulty: INTERVIEW_DIFFICULTIES.includes(difficulty) ? difficulty : "medium",
    rounds,
    why: buildWhy({
      role: mappedRole,
      difficulty,
      rounds,
      flags,
      intern,
    }),
  };
  if (!isPlatformFresherRole(suggestion.role)) {
    suggestion.role = "Software Engineer (SDE)";
  }
  return suggestion;
}
