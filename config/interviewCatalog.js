export const INTERVIEW_DIFFICULTIES = Object.freeze(["easy", "medium", "hard"]);

export const CAMPUS_INTERVIEW_ROUND_TYPES = Object.freeze([
  "DSA",
  "System Design",
  "SQL",
  "CS Fundamentals",
  "HR",
]);

/** Platform-only round types (excludes campus list + Web Dev). */
export const PLATFORM_EXCLUSIVE_INTERVIEW_ROUND_TYPES = Object.freeze([
  "Aptitude",
  "Core Technical",
  "Circuit Design",
  "Low-Level Design",
  "ML/AI Technical",
  "Embedded Systems",
  "Case Interview",
  "Project/Resume Deep Dive",
]);

export const PLATFORM_INTERVIEW_ROUND_TYPES = Object.freeze([
  "DSA",
  "System Design",
  "Web Dev",
  "SQL",
  "CS Fundamentals",
  "HR",
  ...PLATFORM_EXCLUSIVE_INTERVIEW_ROUND_TYPES,
]);

export const PLATFORM_FRESHER_ROLES = Object.freeze([
  "Software Engineer (SDE)",
  "Frontend Engineer",
  "Backend Engineer",
  "Full Stack Engineer",
  "AI/ML Engineer",
  "Data Scientist",
  "Data Analyst",
  "Data Engineer",
  "QA/SDET",
  "DevOps/Cloud Engineer",
  "Business/Product Analyst",
  "Consultant",
  "Graduate Engineer Trainee (GET)",
  "Embedded Systems Engineer",
  "VLSI/Hardware Engineer",
]);

export const isPlatformInterviewRoundType = (value) =>
  PLATFORM_INTERVIEW_ROUND_TYPES.includes(String(value || "").trim());

export const isCampusInterviewRoundType = (value) =>
  CAMPUS_INTERVIEW_ROUND_TYPES.includes(String(value || "").trim());

export const isPlatformFresherRole = (value) =>
  PLATFORM_FRESHER_ROLES.includes(String(value || "").trim());
