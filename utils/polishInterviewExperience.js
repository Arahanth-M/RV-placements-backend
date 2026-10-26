import { splitExperienceNarrative } from "../../RV-placements-frontend/src/utils/splitExperienceNarrative.js";

const TYPE_FROM_TITLE = [
  [/\bHR\b/i, "HR"],
  [/online assessment|\bOA\b/i, "OA"],
  [/system design/i, "System Design"],
  [/aptitude/i, "Aptitude"],
  [/group discussion|\bGD\b/i, "GD"],
  [/managerial|hiring manager/i, "Managerial"],
  [/behaviou?ral/i, "Behavioral"],
  [/technical|fundamentals/i, "Technical"],
  [/\bDSA\b|\bcoding\b|data structures/i, "Coding"],
];

const TYPE_PHRASE = {
  OA: "an online assessment",
  Technical: "a technical round",
  HR: "an HR round",
  Coding: "a coding round",
  "System Design": "a system design round",
  Aptitude: "an aptitude round",
  Managerial: "a managerial round",
  GD: "a group discussion",
  Behavioral: "a behavioral round",
  Interview: "an interview discussion",
  Other: "a general round",
};

const TYPE_TITLE = {
  OA: "Online assessment",
  Technical: "Technical round",
  HR: "HR round",
  Coding: "Coding round",
  "System Design": "System design round",
  Aptitude: "Aptitude round",
  Managerial: "Managerial round",
  GD: "Group discussion",
  Behavioral: "Behavioral round",
  Interview: "Interview",
};

function tidyWhitespace(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function sentenceCase(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  const headed = /^[A-Z0-9("]/.test(text) ? text : text.charAt(0).toUpperCase() + text.slice(1);
  return /[.!?]$/.test(headed) ? headed : `${headed.replace(/[;:,]+$/g, "")}.`;
}

function bulletLines(value) {
  const lines = String(value || "")
    .split(/\n+/)
    .map((line) => line.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, "").trim())
    .filter(Boolean);
  const looksLikeList =
    lines.length >= 2 && lines.every((line) => line.length < 180 && !/[.!?].*[.!?]/.test(line));
  return looksLikeList ? lines : null;
}

function joinList(items) {
  const clean = items.map((item) => String(item).replace(/[.;:]+$/g, "").trim()).filter(Boolean);
  if (clean.length === 0) return "";
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join(", ")}, and ${clean[clean.length - 1]}`;
}

function formalDetails(body) {
  const raw = tidyWhitespace(body);
  if (!raw) return "";
  const bullets = bulletLines(raw);
  if (bullets) return sentenceCase(`This round covered ${joinList(bullets)}`);
  if (raw.length > 180 && /[.!?]/.test(raw)) return raw;
  return sentenceCase(raw.replace(/\n+/g, " "));
}

function refineType(type, title) {
  if (type && type !== "Interview") return type;
  for (const [pattern, next] of TYPE_FROM_TITLE) {
    if (pattern.test(title)) return next;
  }
  return type || "Other";
}

function splitTitle(rawTitle) {
  const title = tidyWhitespace(rawTitle).replace(/\s+/g, " ").replace(/[:]+$/g, "").trim();
  const dash = title.match(/^(.{3,80}?)\s+[-–—]\s+(.+)$/);
  if (!dash) return { title, extra: "" };
  return { title: dash[1].trim(), extra: dash[2].trim() };
}

function parseNumberedRounds(original) {
  const text = String(original || "").replace(/\r\n/g, "\n");
  const re = /(?:^|\n)\s*Round\s*[-–—.]?\s*(\d+)\b[ \t]*[:.)\-–—]?[ \t]*/gi;
  const matches = [...text.matchAll(re)];
  if (matches.length === 0) return null;

  const intro = text.slice(0, matches[0].index).trim();
  const rounds = matches.map((match, index) => {
    const start = match.index + match[0].length;
    const end = matches[index + 1] ? matches[index + 1].index : text.length;
    const chunk = text.slice(start, end).trim();
    const lines = chunk.split("\n");
    const first = (lines[0] || "").trim();
    let title = "";
    let body = chunk;
    const firstIsLabel =
      first.length > 0 &&
      first.length <= 140 &&
      (lines.length > 1 || !/[.!?]/.test(first) || first.length <= 80);
    if (firstIsLabel && lines.length > 1) {
      title = first;
      body = lines.slice(1).join("\n").trim();
    } else if (lines.length === 1 && first.length <= 100) {
      title = first;
      body = "";
    }
    const split = splitTitle(title);
    if (split.extra) {
      body = body ? `${split.extra}\n${body}` : split.extra;
      title = split.title;
    }
    return {
      order: Number(match[1]) || index + 1,
      title: title.replace(/[:]+$/g, "").trim(),
      body,
    };
  });
  return { intro, rounds };
}

function firstSentence(value) {
  const text = tidyWhitespace(value).replace(/\n+/g, " ").trim();
  if (!text) return "";
  const match = text.match(/^(.{12,320}?[.!?])(?:\s|$)/);
  return sentenceCase(match ? match[1] : text.slice(0, 320));
}

function overviewFromRounds(rounds) {
  const names = rounds.map((round) => round.title || TYPE_PHRASE[round.type] || TYPE_PHRASE.Other);
  return sentenceCase(`The interview process included ${joinList(names)}`);
}

function fromNarrative(original) {
  const narrative = splitExperienceNarrative(original);
  if (!narrative.rounds?.length) return null;
  return {
    intro: narrative.intro || "",
    rounds: narrative.rounds.map((round, index) => ({
      order: round.number || index + 1,
      title: tidyWhitespace(round.subtitle || "").replace(/\s+/g, " "),
      body: round.body || "",
      type: round.type,
    })),
  };
}

/**
 * Formal display copy derived only from the original experience text.
 * @param {unknown} content
 * @returns {{ overview: string, rounds: { order: number, type: string, title: string, details: string }[] } | null}
 */
export function polishInterviewExperience(content) {
  const original = String(content ?? "");
  if (!original.trim()) return null;

  const numbered = parseNumberedRounds(original);
  const narrative = numbered && numbered.rounds.length > 0 ? numbered : fromNarrative(original);

  if (!narrative || narrative.rounds.length === 0) {
    const details = formalDetails(original);
    return {
      overview: firstSentence(original),
      rounds: [{ order: 1, type: "Other", title: "", details }],
    };
  }

  const rounds = narrative.rounds.map((round, index) => {
    const type =
      refineType(round.type, `${round.title || ""}\n${String(round.body || "").slice(0, 240)}`) ||
      "Other";
    let title = String(round.title || "").trim();
    const typeTitle = TYPE_TITLE[type];
    const titleHasType =
      !typeTitle ||
      (type === "OA" && /online assessment|\boa\b/i.test(title)) ||
      (type !== "OA" && new RegExp(typeTitle.split(" ")[0], "i").test(title));
    if (typeTitle && !titleHasType) {
      title = title ? `${typeTitle}: ${title}` : typeTitle;
    }
    return {
      order: round.order || index + 1,
      type,
      title,
      details: formalDetails(round.body),
    };
  });

  const intro = tidyWhitespace(narrative.intro || "");
  let overview = intro
    ? formalDetails(intro).replace(/^This round covered /i, "")
    : rounds.length > 1
      ? overviewFromRounds(rounds)
      : firstSentence(rounds[0].details || rounds[0].title || original);

  const visible = `${overview}\n${rounds.map((round) => `${round.title}\n${round.details}`).join("\n")}`;
  if (/\binterview\s*:/i.test(original) && !/\binterview\b/i.test(visible)) {
    overview = sentenceCase(`Interview: ${overview.replace(/[.]$/, "")}`);
  }

  return { overview, rounds };
}
