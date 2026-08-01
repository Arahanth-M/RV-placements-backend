import { callLLM } from "../llmClient.js";
import { parseJSONResponse } from "../../utils/parseJSONResponse.js";

const PREP_PATH_MODEL =
  process.env.GROQ_PREP_PATH_MODEL ||
  process.env.GROQ_ORCHESTRATOR_MODEL ||
  process.env.GROQ_MODEL ||
  "llama-3.3-70b-versatile";

const ALLOWED_STUDY_HOSTS = [
  "leetcode.com",
  "geeksforgeeks.org",
  "gfg.org",
  "interviewbit.com",
  "takeuforward.org",
  "neetcode.io",
  "hackerrank.com",
  "codeforces.com",
  "atcoder.jp",
  "cp-algorithms.com",
  "freecodecamp.org",
  "w3schools.com",
  "javatpoint.com",
  "github.com",
  "youtube.com",
  "youtu.be",
  "docs.oracle.com",
  "developer.mozilla.org",
  "react.dev",
  "nodejs.org",
  "python.org",
  "coursera.org",
  "edx.org",
];

const FALLBACK_STUDY_LINKS = [
  {
    title: "Take U Forward — DSA sheet",
    url: "https://takeuforward.org/strivers-a2z-dsa-course/strivers-a2z-dsa-course-sheet-2/",
    why: "Structured DSA path for campus placements",
  },
  {
    title: "GeeksforGeeks — Placement prep",
    url: "https://www.geeksforgeeks.org/placement-preparation-ml/",
    why: "Company-style articles and practice problems",
  },
  {
    title: "LeetCode — Practice problems",
    url: "https://leetcode.com/problemset/",
    why: "Timed coding practice for OA / interviews",
  },
  {
    title: "InterviewBit — Coding interview",
    url: "https://www.interviewbit.com/coding-interview-questions/",
    why: "Topic-wise interview practice",
  },
];

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function str(v, max = 2000) {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function strArr(v, maxItems = 12, maxLen = 400) {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => str(typeof x === "string" ? x : x?.title || x?.text || "", maxLen))
    .filter(Boolean)
    .slice(0, maxItems);
}

function hostAllowed(url) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return ALLOWED_STUDY_HOSTS.some(
      (frag) => host === frag || host.endsWith(`.${frag}`)
    );
  } catch {
    return false;
  }
}

function normalizeStudyLinks(raw) {
  return (Array.isArray(raw) ? raw : [])
    .map((row) => ({
      title: str(row?.title || row?.name || "", 160),
      url: str(row?.url || "", 400),
      why: str(row?.why || row?.note || "", 240),
    }))
    .filter((row) => row.title && row.url && hostAllowed(row.url))
    .slice(0, 12);
}

function extractSubtopicLink(s) {
  const nested = s?.link || s?.resource || s?.studyLink;
  const title = str(
    nested?.title || s?.linkTitle || s?.resourceTitle || "",
    160
  );
  const url = str(
    nested?.url || s?.linkUrl || s?.resourceUrl || s?.url || "",
    400
  );
  const why = str(nested?.why || s?.linkWhy || s?.resourceWhy || "", 240);
  if (!url || !hostAllowed(url)) return null;
  return {
    linkTitle: title || "Resource",
    linkUrl: url,
    linkWhy: why,
  };
}

function normalizeSubtopics(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 12)
    .map((s) => {
      const link = extractSubtopicLink(s);
      return {
        title: str(s?.title || s?.name || "Subtopic", 160) || "Subtopic",
        hours: Math.max(0, Math.round(num(s?.hours, 0.5) * 10) / 10),
        notes: str(s?.notes || s?.detail || "", 300),
        linkTitle: link?.linkTitle || "",
        linkUrl: link?.linkUrl || "",
        linkWhy: link?.linkWhy || "",
      };
    })
    .filter((s) => s.title);
}

/**
 * Ensure most subtopics have an allowlisted learning link.
 * Uses leftover top-level studyLinks first, then curated fallbacks.
 */
function attachLinksToSubtopics(topicSections, leftoverStudyLinks = []) {
  const topics = Array.isArray(topicSections) ? topicSections : [];
  const pool = [
    ...normalizeStudyLinks(leftoverStudyLinks),
    ...FALLBACK_STUDY_LINKS,
  ];
  let poolIdx = 0;
  const nextLink = () => {
    if (!pool.length) return null;
    const link = pool[poolIdx % pool.length];
    poolIdx += 1;
    return link;
  };

  return topics.map((t) => ({
    ...t,
    subtopics: (Array.isArray(t.subtopics) ? t.subtopics : []).map((s) => {
      if (s.linkUrl) return s;
      const link = nextLink();
      if (!link) return s;
      return {
        ...s,
        linkTitle: link.title,
        linkUrl: link.url,
        linkWhy: link.why || "",
      };
    }),
  }));
}

/**
 * Normalize LLM JSON into the PrepPath roadmap shape.
 */
export function normalizeRoadmap(raw, { days, hoursPerDay, limitedData = false }) {
  const src = raw && typeof raw === "object" ? raw : {};
  const dayCount = Math.min(5, Math.max(1, Math.round(num(days, 5))));
  const hpd = Math.min(16, Math.max(0.5, num(hoursPerDay, 2)));
  const expectedTotal = Math.round(dayCount * hpd * 10) / 10;

  let topicSections = (Array.isArray(src.topicSections) ? src.topicSections : [])
    .slice(0, 20)
    .map((t) => {
      const subtopics = normalizeSubtopics(t?.subtopics);
      const hoursFromSubs = subtopics.reduce((sum, s) => sum + (s.hours || 0), 0);
      const hours = Math.max(
        0,
        Math.round(num(t?.hours, hoursFromSubs || 0) * 10) / 10
      );
      return {
        title: str(t?.title || "Topic", 120) || "Topic",
        hours,
        why: str(t?.why || "", 600),
        practiceHints: strArr(t?.practiceHints, 8, 240),
        subtopics,
      };
    })
    .filter((t) => t.title);

  topicSections = attachLinksToSubtopics(
    topicSections,
    src.studyLinks || src.resources
  );

  let dayRows = (Array.isArray(src.days) ? src.days : [])
    .slice(0, dayCount)
    .map((d, i) => {
      const tasks = (Array.isArray(d?.tasks) ? d.tasks : [])
        .slice(0, 10)
        .map((task) => ({
          title: str(task?.title || "Task", 160) || "Task",
          minutes: Math.max(0, Math.round(num(task?.minutes, 30))),
          resourceHint: str(task?.resourceHint || "", 200),
          notes: str(task?.notes || "", 300),
        }))
        .filter((t) => t.title);
      return {
        day: Math.max(1, Math.round(num(d?.day, i + 1))),
        hours: Math.max(0, Math.round(num(d?.hours, hpd) * 10) / 10),
        focus: str(d?.focus || "", 200),
        tasks,
      };
    });

  while (dayRows.length < dayCount) {
    const n = dayRows.length + 1;
    dayRows.push({
      day: n,
      hours: hpd,
      focus: "Continue targeted practice from earlier gaps",
      tasks: [
        {
          title: "Review weak topics + timed practice set",
          minutes: Math.round(hpd * 60),
          resourceHint: "Platform must-do topics + OA/interview snippets",
          notes: "",
        },
      ],
    });
  }

  dayRows = dayRows.slice(0, dayCount).map((d, i) => ({ ...d, day: i + 1 }));

  const totalFromDays = dayRows.reduce((s, d) => s + (d.hours || 0), 0);
  const totalHours =
    Math.round(num(src.totalHours, totalFromDays || expectedTotal) * 10) / 10;

  // Only keep company signals when campus data is not thin.
  const companySignals = limitedData
    ? []
    : (Array.isArray(src.companySignals) ? src.companySignals : [])
        .slice(0, 4)
        .map((row) => ({
          point: str(
            typeof row === "string" ? row : row?.point || row?.text || "",
            320
          ),
          sourceType: str(
            typeof row === "object" ? row?.sourceType || "" : "",
            40
          )
            .toLowerCase()
            .replace(/\s+/g, "_"),
        }))
        .map((row) => {
          const allowed = new Set([
            "must_do",
            "oa",
            "interview_question",
            "interview_experience",
          ]);
          return {
            point: row.point,
            sourceType: allowed.has(row.sourceType)
              ? row.sourceType
              : "must_do",
          };
        })
        .filter((row) => row.point);

  const motivationSlogans = strArr(
    src.motivationSlogans || src.motivations,
    3,
    220
  );

  return {
    summary: str(src.summary || "", 1200),
    totalHours,
    assumptions: strArr(src.assumptions, 8, 240),
    resumeStrengths: strArr(src.resumeStrengths, 10, 280),
    resumeMissing: strArr(src.resumeMissing, 10, 280),
    companyExpectations: strArr(src.companyExpectations, 10, 280),
    skillGaps: strArr(src.skillGaps, 12, 240),
    companySignals,
    topicSections,
    days: dayRows,
    /** Links live on subtopics; kept empty for schema compatibility. */
    studyLinks: [],
    motivationSlogans:
      motivationSlogans.length > 0
        ? motivationSlogans
        : [
            "One focused hour today beats a week of worry — start small, stay consistent.",
            "A rejection is data, not destiny. Use it to sharpen your next attempt.",
            "Freshers grow fast: clear fundamentals + deliberate practice compound quickly.",
          ].slice(0, 3),
    dataQualityNote: str(src.dataQualityNote || "", 800),
  };
}

export async function generatePrepPathRoadmapWithLLM({
  role,
  track = "full_time",
  days,
  hoursPerDay,
  resumeDigest,
  companyPromptBlock,
  webSnippets,
  limitedData,
  contextFlags = {},
}) {
  const dayCount = Math.min(5, Math.max(1, Math.round(Number(days) || 5)));
  const hpd = Math.min(16, Math.max(0.5, Number(hoursPerDay) || 2));
  const totalHours = Math.round(dayCount * hpd * 10) / 10;
  const isSummer = String(track) === "summer_internship";
  const trackLabel = isSummer ? "Summer internship" : "Full-time (FTE) placement";

  const webBlock =
    Array.isArray(webSnippets) && webSnippets.length
      ? webSnippets.map((s, i) => `${i + 1}. ${s}`).join("\n")
      : "(none — rely on platform data + careful general knowledge; do not invent specific past papers)";

  const hasCampusSignals =
    !limitedData &&
    (contextFlags.usedMustDo ||
      contextFlags.usedOA ||
      contextFlags.usedInterview ||
      contextFlags.usedExperiences);

  const trackRules = isSummer
    ? `- This plan is for SUMMER INTERNSHIP hiring (not full-time conversion yet).
- Emphasize: faster OA loops, lighter interview depth, strong projects, learning mindset, mentorship fit, and what interns do in 8–12 weeks.
- Avoid senior FTE system-design depth and long multi-round FTE stamina plans unless campus data clearly requires it.
- Prefer internship / PPO visit signals when present.`
    : `- This plan is for FULL-TIME (FTE) campus placement hiring.
- Emphasize: stronger OA bar, multi-round interviews, deeper DSA + CS fundamentals, role fit, and placement-process stamina.
- Deprioritize pure internship-only lore unless it also informs FTE rounds.
- Prefer FTE / dream / open-dream visit signals when present.`;

  const system = `You are PrepPath, an expert campus placement coach for Indian engineering FRESHERS.
Return STRICT JSON only (no markdown).

Critical fresher context:
- ALL resumes are fresher resumes (campus / early-career). Do NOT expect deep domain expertise, years of industry ownership, or senior-level system design mastery.
- Judge strengths/gaps relative to a strong fresher: projects, DSA fundamentals, internships, coursework, basics of CS subjects.
- Keep prep realistic for freshers: fundamentals first, then targeted company practice.

Prep track (mandatory — shape the ENTIRE roadmap around this):
- Target track: ${trackLabel}
${trackRules}

Rules:
- Prefer platform must-do topics, OA snippets, interview Qs, and experiences when present (soft signals, not hard guarantees).
- Always fill resumeStrengths, resumeMissing, companyExpectations, skillGaps for THIS company/role/track (fresher lens).
- topicSections must be DETAILED: each topic has total hours AND subtopics[]; every subtopic must include its own hours so the student knows exact time split.
- Each subtopic MUST include one learning link: link { title, url, why } using only legitimate domains (LeetCode, GeeksforGeeks, TakeUForward, InterviewBit, MDN, freeCodeCamp, NeetCode, official docs). Never invent fake domains. Do NOT return a separate top-level studyLinks array.
- Subtopic hours within a topic should roughly sum to that topic's hours. Topic hours should roughly sum near ${totalHours}.
- ${
    hasCampusSignals
      ? "Campus data is available: include companySignals with 3–4 concrete bullets grounded in must-do / OA / interview questions / interview experiences. Each signal needs sourceType one of: must_do, oa, interview_question, interview_experience. Do not invent fake leaked papers."
      : "Campus data is limited/thin: set companySignals to [] (empty). Do not invent company-specific interview lore."
  }
- Always include motivationSlogans: 2–3 short supportive lines about consistent prep, handling placement stress, and bouncing back from rejections.
- If data is thin, say so in dataQualityNote.
- Include day-by-day plan with tasks (minutes). Schedule must fit ~${totalHours} total hours.
- Keep tasks concrete and actionable for freshers.`;

  const user = `Create a PrepPath plan for a FRESHER.

Target track: ${trackLabel}
Target role (user-entered): ${role}
Prep window: ${dayCount} days × ${hpd} hours/day ≈ ${totalHours} total hours
Limited campus data: ${limitedData ? "YES" : "NO"}
Campus signal flags: mustDo=${Boolean(contextFlags.usedMustDo)}, OA=${Boolean(
    contextFlags.usedOA
  )}, interviewQs=${Boolean(contextFlags.usedInterview)}, experiences=${Boolean(
    contextFlags.usedExperiences
  )}

=== Resume digest (parsed text; file discarded; fresher resume) ===
${resumeDigest || "(empty)"}

=== Company context from platform ===
${companyPromptBlock}

=== Optional web snippets (allowlisted sources only) ===
${webBlock}

Return JSON with this exact shape:
{
  "summary": "string",
  "totalHours": number,
  "assumptions": ["string"],
  "resumeStrengths": ["string"],
  "resumeMissing": ["string"],
  "companyExpectations": ["string"],
  "skillGaps": ["string"],
  "companySignals": [
    { "point": "string grounded in campus data", "sourceType": "must_do|oa|interview_question|interview_experience" }
  ],
  "dataQualityNote": "string",
  "topicSections": [
    {
      "title": "string",
      "hours": number,
      "why": "string",
      "practiceHints": ["string"],
      "subtopics": [
        {
          "title": "string",
          "hours": number,
          "notes": "string",
          "link": { "title": "string", "url": "https://...", "why": "string" }
        }
      ]
    }
  ],
  "days": [
    {
      "day": 1,
      "hours": number,
      "focus": "string",
      "tasks": [
        { "title": "string", "minutes": number, "resourceHint": "string", "notes": "string" }
      ]
    }
  ],
  "motivationSlogans": ["string", "string"]
}

Include exactly ${dayCount} days.
Make topicSections detailed with subtopic hour splits.
Every subtopic must include a legitimate link object (title, url, why). Do not return a separate studyLinks array.
${hasCampusSignals ? "Fill 3–4 companySignals." : "companySignals must be []."}
Fill 2–3 motivationSlogans.
Summary and companyExpectations must clearly reflect the ${trackLabel} track.`;

  const content = await callLLM(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    {
      model: PREP_PATH_MODEL,
      temperature: 0.35,
      // Keep well under Groq on_demand TPM (12k for 70b). Input + max_tokens counts toward TPM.
      max_tokens: 4500,
    }
  );

  const parsed = parseJSONResponse(content);
  return normalizeRoadmap(parsed, {
    days: dayCount,
    hoursPerDay: hpd,
    limitedData: Boolean(limitedData),
  });
}
