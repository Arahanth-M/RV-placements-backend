import {
  INTERVIEW_DIFFICULTIES,
  PLATFORM_FRESHER_ROLES,
  isPlatformInterviewRoundType,
} from "../../config/interviewCatalog.js";

const MAX_MOCK_ROUNDS = 4;

export function matchPlatformFresherRole(role) {
  const raw = String(role || "").trim();
  if (PLATFORM_FRESHER_ROLES.includes(raw)) return raw;
  const n = raw.toLowerCase();
  if (/frontend|front-end|react|ui engineer/.test(n)) return "Frontend Engineer";
  if (/backend|back-end|server/.test(n)) return "Backend Engineer";
  if (/full.?stack/.test(n)) return "Full Stack Engineer";
  if (/\bml\b|machine learning|ai\/ml|ai engineer/.test(n)) return "AI/ML Engineer";
  if (/data scientist/.test(n)) return "Data Scientist";
  if (/data analyst|business analyst|product analyst/.test(n)) {
    if (/product/.test(n)) return "Business/Product Analyst";
    return "Data Analyst";
  }
  if (/data engineer/.test(n)) return "Data Engineer";
  if (/\bqa\b|sdet|test engineer/.test(n)) return "QA/SDET";
  if (/devops|sre|cloud engineer/.test(n)) return "DevOps/Cloud Engineer";
  if (/consultant|consulting/.test(n)) return "Consultant";
  if (/\bget\b|graduate engineer|trainee/.test(n)) {
    return "Graduate Engineer Trainee (GET)";
  }
  if (/embedded/.test(n)) return "Embedded Systems Engineer";
  if (/vlsi|hardware|asic|fpga/.test(n)) return "VLSI/Hardware Engineer";
  if (/sde|software/.test(n)) {
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
        ? ["ML/AI Technical", "DSA"]
        : ["ML/AI Technical", "DSA", "CS Fundamentals"];
    case "Data Scientist":
      return ["ML/AI Technical", "SQL"];
    case "Data Analyst":
      return intern
        ? ["SQL", "Aptitude"]
        : ["SQL", "Aptitude", "Case Interview"];
    case "Data Engineer":
      return ["SQL", "DSA"];
    case "QA/SDET":
      return intern ? ["DSA", "Aptitude"] : ["DSA", "CS Fundamentals"];
    case "DevOps/Cloud Engineer":
      return ["CS Fundamentals", "DSA"];
    case "Business/Product Analyst":
      return ["Case Interview", "Aptitude"];
    case "Consultant":
      return intern
        ? ["Case Interview", "Aptitude"]
        : ["Case Interview", "Project/Resume Deep Dive"];
    case "Embedded Systems Engineer":
      return ["Embedded Systems", "Core Technical"];
    case "VLSI/Hardware Engineer":
      return ["Circuit Design", "Core Technical"];
    case "Graduate Engineer Trainee (GET)":
      return intern
        ? ["DSA", "Aptitude"]
        : ["DSA", "CS Fundamentals", "Aptitude"];
    case "Frontend Engineer":
      return intern ? ["DSA", "Aptitude"] : ["DSA", "Web Dev"];
    case "Backend Engineer":
    case "Full Stack Engineer":
    case "Software Engineer (SDE)":
    default:
      return intern ? ["DSA", "Aptitude"] : ["DSA", "CS Fundamentals"];
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
  if (out.length === 0) return ["DSA"];
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
  if (flags.usedInterview || flags.usedExperiences) {
    rounds.push("Project/Resume Deep Dive");
  }
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
  return suggestion;
}
