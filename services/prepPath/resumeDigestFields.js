/** Shared PrepPath resume field keys for parse → review → digest. */

export const RESUME_FIELD_DEFS = Object.freeze([
  { key: "name", label: "Name / headline", rows: 2 },
  { key: "education", label: "Education", rows: 3 },
  { key: "experience", label: "Experience", rows: 5 },
  { key: "projects", label: "Projects", rows: 5 },
  { key: "skills", label: "Skills / languages", rows: 3 },
  { key: "technologies", label: "Technologies", rows: 3 },
  { key: "concepts", label: "Concepts", rows: 2 },
  { key: "certifications", label: "Certifications", rows: 2 },
  { key: "other", label: "Additional notes", rows: 3 },
]);

const HEADER_PATTERNS = [
  { key: "education", re: /^(education|academic(\s+background)?)\s*:?\s*$/i },
  { key: "experience", re: /^(experience|work\s+experience|internship|employment|work\s+history)\s*:?\s*$/i },
  { key: "projects", re: /^(projects?|personal\s+projects?|academic\s+projects?)\s*:?\s*$/i },
  { key: "skills", re: /^(skills?|technical\s+skills?|skill\s+set|languages?|skills?\s*\/\s*languages?)\s*:?\s*$/i },
  { key: "technologies", re: /^(technologies|tech\s+stack|tools?|frameworks?)\s*:?\s*$/i },
  { key: "concepts", re: /^(concepts?|coursework|relevant\s+coursework)\s*:?\s*$/i },
  { key: "certifications", re: /^(certifications?|certificates?|licenses?)\s*:?\s*$/i },
  { key: "name", re: /^(name\s*\/\s*headline|summary|profile|objective|about(\s+me)?)\s*:?\s*$/i },
  { key: "other", re: /^(additional\s+notes|other)\s*:?\s*$/i },
];

const INLINE_LABEL_RE =
  /\b(Skills?\s*Languages?|Languages?|Technologies|Tech\s*Stack|Tools|Frameworks|Concepts|Certifications?|Education|Experience|Projects?)\s*:\s*/gi;

function emptyFields() {
  const out = {};
  for (const def of RESUME_FIELD_DEFS) out[def.key] = "";
  return out;
}

function matchHeaderKey(line) {
  const t = String(line || "").trim();
  if (!t || t.length > 80) return null;
  const lower = t.toLowerCase().replace(/:$/, "");
  for (const def of RESUME_FIELD_DEFS) {
    if (lower === def.label.toLowerCase()) return def.key;
  }
  for (const row of HEADER_PATTERNS) {
    if (row.re.test(t)) return row.key;
  }
  return null;
}

function mapInlineLabelToKey(label) {
  const l = String(label || "").toLowerCase();
  if (l.includes("certif")) return "certifications";
  if (l.includes("concept")) return "concepts";
  if (l.includes("technolog") || l.includes("tech stack") || l.includes("tool") || l.includes("framework")) {
    return "technologies";
  }
  if (l.includes("skill") || l.includes("language")) return "skills";
  if (l.includes("educat")) return "education";
  if (l.includes("experience")) return "experience";
  if (l.includes("project")) return "projects";
  return "other";
}

export function normalizeSectionBody(value) {
  const lines = String(value || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .map((line) => {
      if (/^([•\u2022\-*]|\d+[.)])\s+/.test(line)) {
        return `• ${line.replace(/^([•\u2022\-*]|\d+[.)])\s+/, "")}`;
      }
      return line;
    });
  return lines.join("\n");
}

/**
 * Split EXPERIENCE / PROJECTS into neat entry blocks:
 * title (+ optional meta) then bullets, with a blank line between entries.
 */
export function formatEntryBlocks(value) {
  const lines = normalizeSectionBody(value)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length <= 1) return lines.join("\n");

  const blocks = [];
  let current = [];

  const flush = () => {
    if (current.length) {
      blocks.push(current);
      current = [];
    }
  };

  for (const line of lines) {
    const isBullet = line.startsWith("• ");
    if (!isBullet && current.some((l) => l.startsWith("• "))) {
      // Non-bullet after bullets → next role/project.
      flush();
      current.push(line);
      continue;
    }
    current.push(line);
  }
  flush();

  return blocks.map((block) => block.join("\n")).join("\n\n");
}

/**
 * Skills/tech lists: turn a single comma-separated line into formal bullets.
 * Leaves already-bulleted or multi-line content alone (aside from normalize).
 */
export function formatListSection(value) {
  const normalized = normalizeSectionBody(value);
  if (!normalized) return "";
  const lines = normalized.split("\n").filter(Boolean);
  if (lines.length === 1 && !lines[0].startsWith("• ")) {
    const parts = lines[0]
      .split(/[,;|]+/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length >= 3) {
      return parts.map((p) => `• ${p}`).join("\n");
    }
  }
  return normalized;
}

function formatFieldBody(key, value) {
  if (key === "experience" || key === "projects") {
    return formatEntryBlocks(value);
  }
  if (key === "skills" || key === "technologies") {
    return formatListSection(value);
  }
  return normalizeSectionBody(value);
}

/**
 * Split resume/digest text into labeled fields for the review UI.
 */
export function digestToFields(rawText) {
  const fields = emptyFields();
  let text = String(rawText || "").trim();
  if (!text) return fields;

  text = text.replace(/^#{1,3}\s+/gm, "");

  let preambleCarry = "";
  const matches = [];
  INLINE_LABEL_RE.lastIndex = 0;
  let match;
  while ((match = INLINE_LABEL_RE.exec(text)) !== null) {
    matches.push({ index: match.index, label: match[1], end: match.index + match[0].length });
  }
  if (matches.length >= 1) {
    if (matches[0].index > 0) {
      preambleCarry = text.slice(0, matches[0].index).trim();
    }
    for (let i = 0; i < matches.length; i += 1) {
      const start = matches[i].end;
      const stop = i + 1 < matches.length ? matches[i + 1].index : text.length;
      const value = text.slice(start, stop).trim();
      const key = mapInlineLabelToKey(matches[i].label);
      if (value) {
        fields[key] = fields[key] ? `${fields[key]}\n${value}` : value;
      }
    }
    text = preambleCarry;
  }

  const lines = text.split(/\n/);
  let currentKey = null;
  const buckets = emptyFields();
  const preamble = [];

  for (const line of lines) {
    const headerKey = matchHeaderKey(line);
    if (headerKey) {
      currentKey = headerKey;
      continue;
    }
    if (!currentKey) {
      preamble.push(line);
      continue;
    }
    buckets[currentKey] = buckets[currentKey]
      ? `${buckets[currentKey]}\n${line}`
      : line;
  }

  for (const def of RESUME_FIELD_DEFS) {
    const fromBucket = String(buckets[def.key] || "").trim();
    if (fromBucket) {
      fields[def.key] = fields[def.key]
        ? `${fields[def.key]}\n${fromBucket}`
        : fromBucket;
    }
  }

  const preambleText = preamble.join("\n").trim();
  if (preambleText) {
    const preLines = preambleText.split(/\n/).map((l) => l.trim()).filter(Boolean);
    if (!fields.name && preLines[0] && preLines[0].length <= 80) {
      fields.name = preLines[0];
      const rest = preLines.slice(1).join("\n").trim();
      if (rest) {
        fields.other = fields.other ? `${fields.other}\n${rest}` : rest;
      }
    } else if (!fields.name) {
      fields.name = preambleText.slice(0, 200);
    } else {
      fields.other = fields.other ? `${fields.other}\n${preambleText}` : preambleText;
    }
  }

  const filled = RESUME_FIELD_DEFS.filter((d) => String(fields[d.key] || "").trim()).length;
  if (filled <= 1 && !fields.other && text) {
    fields.other = text;
  }

  for (const def of RESUME_FIELD_DEFS) {
    fields[def.key] = normalizeSectionBody(fields[def.key]);
  }
  return fields;
}

/** Formal digest: UPPERCASE titles, blank line between sections, unified bullets. */
export function fieldsToDigest(fields, maxLen = 4000) {
  const parts = [];
  for (const def of RESUME_FIELD_DEFS) {
    const value = formatFieldBody(def.key, fields?.[def.key]);
    if (!value) continue;
    parts.push(`${def.label.toUpperCase()}\n${value}`);
  }
  return parts.join("\n\n").trim().slice(0, maxLen);
}

export function hasAnyResumeField(fields) {
  return RESUME_FIELD_DEFS.some((d) => String(fields?.[d.key] || "").trim());
}
