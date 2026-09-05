/**
 * Heuristic mapping of extracted resume text → structured draft payload.
 * Used so uploaded PDF/DOCX can reuse {@link analyzeResume}. Not LLM-based.
 * Does not persist anything.
 */

const SECTION_MATCHERS = [
  { id: "summary", re: /^(professional\s+summary|career\s+summary|summary|objective|profile|about(\s+me)?)$/i },
  { id: "education", re: /^(education|academic(\s+background)?|academics|qualifications)$/i },
  { id: "experience", re: /^(experience|work\s+experience|employment|internship(s)?|professional\s+experience|work\s+history)$/i },
  { id: "projects", re: /^(projects|personal\s+projects|academic\s+projects|key\s+projects)$/i },
  { id: "skills", re: /^(skills|technical\s+skills|tech\s+skills|core\s+competencies|technologies|technical\s+proficiencies)$/i },
  { id: "certifications", re: /^(certifications?|certificates|licenses)$/i },
  { id: "achievements", re: /^(achievements|awards|honou?rs|accomplishments)$/i },
];

const COMMON_SKILLS = [
  "javascript",
  "typescript",
  "python",
  "java",
  "c++",
  "c#",
  "go",
  "rust",
  "kotlin",
  "swift",
  "react",
  "node.js",
  "nodejs",
  "express",
  "mongodb",
  "sql",
  "mysql",
  "postgresql",
  "docker",
  "kubernetes",
  "aws",
  "azure",
  "gcp",
  "git",
  "linux",
  "html",
  "css",
  "tailwind",
  "next.js",
  "django",
  "flask",
  "spring",
  "tensorflow",
  "pytorch",
  "pandas",
  "numpy",
  "figma",
  "redis",
  "graphql",
  "rest",
];

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const LINKEDIN_RE = /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9_-]+\/?/i;
const GITHUB_RE = /(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9_-]+\/?/i;
const PHONE_RE = /(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{3,5}\)?[\s-]?)?\d{3,5}[\s-]?\d{4,6}/;
const YEAR_RANGE_RE = /\b((?:19|20)\d{2})\s*[-–—/]\s*((?:19|20)\d{2}|present|now|current)\b/i;
const CGPA_RE = /\b(?:cgpa|gpa|spi)\s*[:\-]?\s*(\d(?:\.\d{1,2})?)\b/i;
const URL_RE = /https?:\/\/[^\s)]+/i;

function normalizeLines(text) {
  return String(text || "")
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line) => line.length > 0);
}

function matchSectionId(line) {
  const cleaned = String(line || "")
    .replace(/[:|•\-–—]+$/g, "")
    .trim();
  if (!cleaned || cleaned.length > 48) return null;
  for (const { id, re } of SECTION_MATCHERS) {
    if (re.test(cleaned)) return id;
  }
  return null;
}

function splitSections(lines) {
  /** @type {Record<string, string[]>} */
  const sections = { header: [] };
  let current = "header";
  for (const line of lines) {
    const id = matchSectionId(line);
    if (id) {
      current = id;
      if (!sections[current]) sections[current] = [];
      continue;
    }
    if (!sections[current]) sections[current] = [];
    sections[current].push(line);
  }
  return sections;
}

function firstMatch(text, re) {
  const m = String(text || "").match(re);
  return m ? m[0] : "";
}

function withHttps(url) {
  const v = String(url || "").trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  return `https://${v}`;
}

function guessName(headerLines, email) {
  for (const line of headerLines) {
    if (EMAIL_RE.test(line) || LINKEDIN_RE.test(line) || GITHUB_RE.test(line)) continue;
    if (PHONE_RE.test(line) && line.replace(/\D/g, "").length >= 10) continue;
    if (URL_RE.test(line)) continue;
    const words = line.split(/\s+/).filter(Boolean);
    if (words.length >= 2 && words.length <= 6 && line.length <= 80 && !/\d/.test(line)) {
      return line;
    }
  }
  const local = String(email || "").split("@")[0] || "";
  return local
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function parseSkills(lines, fullText) {
  const fromSection = [];
  for (const line of lines) {
    const parts = line
      .split(/[,|/•●;]+/)
      .map((p) => p.replace(/^[-–—*]\s*/, "").trim())
      .filter((p) => p.length >= 2 && p.length <= 40);
    fromSection.push(...parts);
  }
  const unique = [];
  const seen = new Set();
  for (const skill of fromSection) {
    const key = skill.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(skill);
    if (unique.length >= 28) return unique;
  }
  if (unique.length >= 3) return unique;

  const lower = String(fullText || "").toLowerCase();
  for (const skill of COMMON_SKILLS) {
    const re = new RegExp(`\\b${skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(lower) && !seen.has(skill.toLowerCase())) {
      seen.add(skill.toLowerCase());
      unique.push(skill.replace(/\bjs\b/i, "JS").replace(/\bnode\.js\b/i, "Node.js"));
    }
    if (unique.length >= 18) break;
  }
  return unique;
}

function isBulletLine(line) {
  return /^[-–—*•●◦]\s+/.test(line) || /^\d+[.)]\s+/.test(line);
}

function stripBullet(line) {
  return String(line || "")
    .replace(/^[-–—*•●◦]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .trim();
}

function extractDateRange(text) {
  const m = String(text || "").match(YEAR_RANGE_RE);
  if (!m) return { startDate: "", endDate: "" };
  return { startDate: m[1], endDate: /present|now|current/i.test(m[2]) ? "Present" : m[2] };
}

function groupHeaderAndBullets(lines) {
  const groups = [];
  let current = { header: [], bullets: [] };
  for (const line of lines) {
    if (isBulletLine(line) || (current.header.length > 0 && line.length > 70)) {
      const text = stripBullet(line);
      if (!text) continue;
      if (current.header.length === 0) current.header.push(text);
      else current.bullets.push(text);
      continue;
    }
    if (current.bullets.length > 0) {
      groups.push(current);
      current = { header: [line], bullets: [] };
    } else {
      current.header.push(line);
    }
  }
  if (current.header.length > 0 || current.bullets.length > 0) groups.push(current);
  return groups;
}

function parseExperienceLike(lines, kind) {
  const groups = groupHeaderAndBullets(lines);
  const out = [];
  for (const group of groups) {
    const header = group.header[0] || "";
    if (!header) continue;
    const joined = [...group.header, ...group.bullets].join(" ");
    const { startDate, endDate } = extractDateRange(joined);
    const link = withHttps(firstMatch(joined, URL_RE));
    const bullets = group.bullets
      .map((text) => ({ text: text.slice(0, 250) }))
      .filter((b) => b.text)
      .slice(0, 8);
    const meta = group.header.slice(1).join(" ");
    if (kind === "experience") {
      const bits = header.split(/[|,–—]/).map((s) => s.trim()).filter(Boolean);
      out.push({
        company: bits[0] || header.slice(0, 140),
        role: bits[1] || "",
        techStack: /python|react|java|node|sql/i.test(meta) ? meta.slice(0, 180) : "",
        location: "",
        startDate,
        endDate,
        bullets,
      });
    } else {
      const techLine = group.header.find((l, i) => i > 0 && /python|react|java|node|sql|firebase|docker/i.test(l)) || "";
      out.push({
        name: header.slice(0, 140),
        techStack: techLine.slice(0, 180),
        link,
        startDate,
        endDate,
        bullets,
      });
    }
    if (out.length >= (kind === "experience" ? 10 : 12)) break;
  }
  return out.filter((item) =>
    kind === "experience"
      ? String(item.company || "").trim()
      : String(item.name || "").trim()
  );
}

function parseEducation(lines) {
  const groups = groupHeaderAndBullets(lines);
  const out = [];
  for (const group of groups) {
    const joined = group.header.join(" ");
    if (!joined.trim()) continue;
    const { startDate, endDate } = extractDateRange(joined);
    const cgpa = joined.match(CGPA_RE);
    const header = group.header[0] || "";
    out.push({
      institution: header.slice(0, 140),
      degree: group.header.find((l) => /\b(b\.?e\.?|b\.?tech|m\.?tech|bachelor|master|b\.?s\.?|m\.?s\.?)\b/i.test(l)) || "",
      field: group.header.find((l) => /\b(computer|information|electronics|mechanical|civil|data)\b/i.test(l)) || "",
      startDate,
      endDate,
      score: cgpa ? cgpa[0] : "",
      location: "",
    });
    if (out.length >= 8) break;
  }
  return out.filter((item) => String(item.institution || "").trim());
}

function parseTitled(lines, asCert) {
  const out = [];
  for (const line of lines) {
    const text = stripBullet(line);
    if (!text) continue;
    if (asCert) {
      out.push({ title: text.slice(0, 160), link: withHttps(firstMatch(text, URL_RE)) });
    } else {
      out.push({ title: text.slice(0, 160), detail: "" });
    }
    if (out.length >= 15) break;
  }
  return out;
}

/**
 * @param {string} rawText
 * @returns {Record<string, unknown>}
 */
export function mapResumeTextToPayload(rawText) {
  const text = String(rawText || "").trim();
  const lines = normalizeLines(text);
  const sections = splitSections(lines);
  const header = sections.header || [];
  const blob = text;

  const email = firstMatch(blob, EMAIL_RE);
  const linkedin = withHttps(firstMatch(blob, LINKEDIN_RE));
  const github = withHttps(firstMatch(blob, GITHUB_RE));
  const phoneMatch = blob.match(PHONE_RE);
  const phone = phoneMatch && phoneMatch[0].replace(/\D/g, "").length >= 10 ? phoneMatch[0].trim() : "";

  const summaryLines = sections.summary || [];
  const summary =
    summaryLines.join(" ").slice(0, 500) ||
    header.filter((l) => l.length > 40 && !EMAIL_RE.test(l)).slice(0, 2).join(" ").slice(0, 500);

  return {
    templateId: "standard_ats",
    personal: {
      fullName: guessName(header, email),
      email,
      phone,
      location: header.find((l) => /\b(bengaluru|bangalore|mumbai|delhi|hyderabad|chennai|pune|india)\b/i.test(l)) || "",
      linkedin,
      github,
      summary,
    },
    education: parseEducation(sections.education || []),
    skills: parseSkills(sections.skills || [], blob),
    projects: parseExperienceLike(sections.projects || [], "project"),
    experience: parseExperienceLike(sections.experience || [], "experience"),
    certifications: parseTitled(sections.certifications || [], true),
    achievements: parseTitled(sections.achievements || [], false),
  };
}
