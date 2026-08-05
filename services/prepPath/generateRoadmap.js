import { callLLM } from "../llmClient.js";
import { parseJSONResponse } from "../../utils/parseJSONResponse.js";

const PREP_PATH_MODEL =
  process.env.GROQ_PREP_PATH_MODEL ||
  process.env.GROQ_ORCHESTRATOR_MODEL ||
  process.env.GROQ_MODEL ||
  "llama-3.3-70b-versatile";

const MOTIVATION_SLOGANS = [
  "One focused hour today beats a week of worry — start small, stay consistent.",
  "A rejection is data, not destiny. Use it to sharpen your next attempt.",
  "Freshers grow fast: clear fundamentals + deliberate practice compound quickly.",
];

/** Curated links — attached in code so the LLM never invents URLs. */
const LINK_CATALOG = [
  {
    keys: ["dsa", "array", "tree", "graph", "dp", "dynamic", "leetcode", "coding", "algorithm", "oa"],
    title: "Take U Forward — DSA sheet",
    url: "https://takeuforward.org/strivers-a2z-dsa-course/strivers-a2z-dsa-course-sheet-2/",
    why: "Structured DSA path for campus placements",
  },
  {
    keys: ["os", "operating", "process", "thread", "memory", "deadlock"],
    title: "GeeksforGeeks — Operating Systems",
    url: "https://www.geeksforgeeks.org/operating-systems/",
    why: "Core OS topics for interviews",
  },
  {
    keys: ["dbms", "sql", "database", "normalization", "index", "transaction"],
    title: "GeeksforGeeks — DBMS",
    url: "https://www.geeksforgeeks.org/dbms/",
    why: "DBMS + SQL interview fundamentals",
  },
  {
    keys: ["network", "cn", "tcp", "http", "osi"],
    title: "GeeksforGeeks — Computer Networks",
    url: "https://www.geeksforgeeks.org/computer-network-tutorials/",
    why: "Networking basics for fresher interviews",
  },
  {
    keys: ["oop", "oops", "object", "class", "polymorphism", "inheritance"],
    title: "GeeksforGeeks — OOPs",
    url: "https://www.geeksforgeeks.org/object-oriented-programming-oops-concept-in-java/",
    why: "OOPs concepts asked in campus interviews",
  },
  {
    keys: ["system", "design", "lld", "hld", "architecture"],
    title: "InterviewBit — System Design",
    url: "https://www.interviewbit.com/system-design-interview-questions/",
    why: "Light system-design practice for freshers",
  },
  {
    keys: ["react", "frontend", "javascript", "js", "html", "css", "ui"],
    title: "MDN — JavaScript",
    url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide",
    why: "Solid JS fundamentals for frontend roles",
  },
  {
    keys: ["java", "spring", "jvm"],
    title: "GeeksforGeeks — Java",
    url: "https://www.geeksforgeeks.org/java/",
    why: "Java basics for backend / SDE roles",
  },
  {
    keys: ["python", "django", "flask", "ml"],
    title: "Python docs — Tutorial",
    url: "https://docs.python.org/3/tutorial/",
    why: "Official Python tutorial",
  },
  {
    keys: ["behavioral", "hr", "resume", "project", "soft", "communication"],
    title: "GeeksforGeeks — HR interview",
    url: "https://www.geeksforgeeks.org/hr-interview-questions/",
    why: "Common HR / behavioral prep",
  },
  {
    keys: ["aptitude", "puzzle", "quant"],
    title: "IndiaBIX — Aptitude",
    url: "https://www.indiabix.com/aptitude/questions-and-answers/",
    why: "Aptitude practice for OA rounds",
  },
];

const DEFAULT_LINK = {
  title: "LeetCode — Practice problems",
  url: "https://leetcode.com/problemset/",
  why: "Timed coding practice for OA / interviews",
};

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

function pickLinkForText(...parts) {
  const blob = parts
    .map((p) => String(p || "").toLowerCase())
    .join(" ");
  for (const row of LINK_CATALOG) {
    if (row.keys.some((k) => blob.includes(k))) {
      return { title: row.title, url: row.url, why: row.why };
    }
  }
  return { ...DEFAULT_LINK };
}

function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}

/** Split totalHours across topics, then across each topic's subtopics. */
function allocateTopicHours(topicSections, totalHours) {
  const topics = Array.isArray(topicSections) ? topicSections : [];
  if (!topics.length) return [];
  const budget = Math.max(0.5, Number(totalHours) || 1);
  const weights = topics.map((t) =>
    Math.max(1, Array.isArray(t.subtopics) && t.subtopics.length ? t.subtopics.length : 1)
  );
  const weightSum = weights.reduce((a, b) => a + b, 0) || topics.length;

  let assigned = 0;
  return topics.map((t, i) => {
    const isLast = i === topics.length - 1;
    let hours = isLast
      ? round1(Math.max(0.5, budget - assigned))
      : round1(Math.max(0.5, (budget * weights[i]) / weightSum));
    if (!isLast) assigned = round1(assigned + hours);

    const subs = Array.isArray(t.subtopics) ? t.subtopics : [];
    if (!subs.length) {
      return { ...t, hours, subtopics: [] };
    }
    const per = round1(hours / subs.length);
    let subAssigned = 0;
    const subtopics = subs.map((s, si) => {
      const sh =
        si === subs.length - 1
          ? round1(Math.max(0.1, hours - subAssigned))
          : Math.max(0.1, per);
      if (si < subs.length - 1) subAssigned = round1(subAssigned + sh);
      return { ...s, hours: sh };
    });
    return { ...t, hours, subtopics };
  });
}

function attachCatalogLinks(topicSections) {
  return (Array.isArray(topicSections) ? topicSections : []).map((t) => {
    const topicLink = pickLinkForText(t.title, t.why);
    const subtopics = (Array.isArray(t.subtopics) ? t.subtopics : []).map((s) => {
      const link = pickLinkForText(t.title, s.title, s.notes);
      return {
        ...s,
        linkTitle: link.title,
        linkUrl: link.url,
        linkWhy: link.why,
      };
    });
    // Ensure at least one link surface if no subtopics
    if (!subtopics.length) {
      return {
        ...t,
        subtopics: [
          {
            title: "Core practice",
            hours: t.hours || 1,
            notes: "",
            linkTitle: topicLink.title,
            linkUrl: topicLink.url,
            linkWhy: topicLink.why,
          },
        ],
      };
    }
    return { ...t, subtopics };
  });
}

function allocateDayTaskMinutes(dayRows, hoursPerDay) {
  const hpd = Math.max(0.5, Number(hoursPerDay) || 2);
  const dayMinutes = Math.round(hpd * 60);
  return (Array.isArray(dayRows) ? dayRows : []).map((d) => {
    const tasks = Array.isArray(d.tasks) && d.tasks.length
      ? d.tasks
      : [{ title: "Focused practice on today's topics", notes: "" }];
    const per = Math.max(15, Math.round(dayMinutes / tasks.length));
    let used = 0;
    const withMins = tasks.map((task, i) => {
      const minutes =
        i === tasks.length - 1
          ? Math.max(15, dayMinutes - used)
          : per;
      if (i < tasks.length - 1) used += minutes;
      return {
        title: task.title,
        minutes,
        resourceHint: task.resourceHint || "",
        notes: task.notes || "",
      };
    });
    return {
      ...d,
      hours: hpd,
      tasks: withMins,
    };
  });
}

/**
 * Normalize LLM JSON into the PrepPath roadmap shape.
 * Hours, links, and slogans are filled in code (not trusted from the model).
 */
export function normalizeRoadmap(raw, { days, hoursPerDay, limitedData = false }) {
  const src = raw && typeof raw === "object" ? raw : {};
  const dayCount = Math.min(5, Math.max(1, Math.round(num(days, 5))));
  const hpd = Math.min(16, Math.max(0.5, num(hoursPerDay, 2)));
  const expectedTotal = round1(dayCount * hpd);

  let topicSections = (Array.isArray(src.topicSections) ? src.topicSections : [])
    .slice(0, 6)
    .map((t) => {
      const subtopics = (Array.isArray(t?.subtopics) ? t.subtopics : [])
        .slice(0, 3)
        .map((s) => ({
          title: str(
            typeof s === "string" ? s : s?.title || s?.name || "Subtopic",
            100
          ) || "Subtopic",
          hours: 0,
          notes: str(typeof s === "object" ? s?.notes || "" : "", 160),
          linkTitle: "",
          linkUrl: "",
          linkWhy: "",
        }))
        .filter((s) => s.title);
      return {
        title: str(t?.title || "Topic", 100) || "Topic",
        hours: 0,
        why: str(t?.why || "", 180),
        practiceHints: [],
        subtopics,
      };
    })
    .filter((t) => t.title);

  if (!topicSections.length) {
    topicSections = [
      {
        title: "DSA fundamentals",
        hours: 0,
        why: "Core OA / interview coding practice",
        practiceHints: [],
        subtopics: [
          { title: "Arrays & hashing", hours: 0, notes: "", linkTitle: "", linkUrl: "", linkWhy: "" },
          { title: "Trees & graphs basics", hours: 0, notes: "", linkTitle: "", linkUrl: "", linkWhy: "" },
        ],
      },
      {
        title: "CS fundamentals",
        hours: 0,
        why: "OS / DBMS / OOPs for interviews",
        practiceHints: [],
        subtopics: [
          { title: "OOPs + DBMS", hours: 0, notes: "", linkTitle: "", linkUrl: "", linkWhy: "" },
        ],
      },
    ];
  }

  topicSections = allocateTopicHours(topicSections, expectedTotal);
  topicSections = attachCatalogLinks(topicSections);

  let dayRows = (Array.isArray(src.days) ? src.days : [])
    .slice(0, dayCount)
    .map((d, i) => {
      const tasks = (Array.isArray(d?.tasks) ? d.tasks : [])
        .slice(0, 4)
        .map((task) => ({
          title:
            str(
              typeof task === "string" ? task : task?.title || "Task",
              120
            ) || "Task",
          minutes: 0,
          resourceHint: "",
          notes: str(typeof task === "object" ? task?.notes || "" : "", 160),
        }))
        .filter((t) => t.title);
      return {
        day: Math.max(1, Math.round(num(d?.day, i + 1))),
        hours: hpd,
        focus: str(d?.focus || "", 120),
        tasks,
      };
    });

  while (dayRows.length < dayCount) {
    const n = dayRows.length + 1;
    const topic = topicSections[(n - 1) % topicSections.length];
    dayRows.push({
      day: n,
      hours: hpd,
      focus: topic?.title || "Continue targeted practice",
      tasks: [
        {
          title: `Practice: ${topic?.title || "weak topics"}`,
          minutes: 0,
          resourceHint: "",
          notes: "",
        },
      ],
    });
  }

  dayRows = allocateDayTaskMinutes(
    dayRows.slice(0, dayCount).map((d, i) => ({ ...d, day: i + 1 })),
    hpd
  );

  const companySignals = limitedData
    ? []
    : (Array.isArray(src.companySignals) ? src.companySignals : [])
        .slice(0, 3)
        .map((row) => ({
          point: str(
            typeof row === "string" ? row : row?.point || row?.text || "",
            200
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
            "platform_role",
            "must_do",
            "oa",
            "interview_question",
            "interview_experience",
          ]);
          return {
            point: row.point,
            sourceType: allowed.has(row.sourceType) ? row.sourceType : "must_do",
          };
        })
        .filter((row) => row.point);

  return {
    summary: str(src.summary || "", 400),
    totalHours: expectedTotal,
    assumptions: strArr(src.assumptions, 3, 140),
    resumeStrengths: strArr(src.resumeStrengths, 4, 140),
    resumeMissing: strArr(src.resumeMissing, 4, 140),
    companyExpectations: strArr(src.companyExpectations, 4, 160),
    skillGaps: strArr(src.skillGaps, 5, 140),
    companySignals,
    topicSections,
    days: dayRows,
    studyLinks: [],
    motivationSlogans: MOTIVATION_SLOGANS.slice(0, 3),
    dataQualityNote: str(src.dataQualityNote || "", 240),
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
  const totalHours = round1(dayCount * hpd);
  const isSummer = String(track) === "summer_internship";
  const trackLabel = isSummer ? "Summer internship" : "Full-time (FTE) placement";

  const webBlock =
    Array.isArray(webSnippets) && webSnippets.length
      ? webSnippets.map((s, i) => `${i + 1}. ${s}`).join("\n")
      : "(none)";

  const hasCampusSignals =
    Boolean(contextFlags.usedPlatformRoles) ||
    (!limitedData &&
      (contextFlags.usedMustDo ||
        contextFlags.usedOA ||
        contextFlags.usedInterview ||
        contextFlags.usedExperiences));

  const system = `You are PrepPath, a campus placement coach for Indian engineering FRESHERS.
Return STRICT compact JSON only (no markdown, no URLs, no hour numbers).

Track: ${trackLabel}. Shape the whole plan for this track.
Prefer platform roles (skills/JD/work description), must-do, OA, interview Qs/experiences when present.
When using role fields, say "mentioned in the platform roles".
Fresher lens only — no senior system-design depth unless campus data requires it.
Keep every string short (≤20 words). No learning links (server adds them). No hour/minute numbers (server allocates).`;

  const user = `Create a lean PrepPath plan.

Role: ${role}
Window: ${dayCount} days × ${hpd} h/day ≈ ${totalHours} h total
Limited data: ${limitedData ? "YES" : "NO"}
Flags: mustDo=${Boolean(contextFlags.usedMustDo)} OA=${Boolean(
    contextFlags.usedOA
  )} interviewQs=${Boolean(contextFlags.usedInterview)} experiences=${Boolean(
    contextFlags.usedExperiences
  )} platformRoles=${Boolean(contextFlags.usedPlatformRoles)}

=== Resume ===
${resumeDigest || "(empty)"}

=== Company ===
${companyPromptBlock}

=== Web (optional) ===
${webBlock}

Return ONLY this JSON shape:
{
  "summary": "1-2 short sentences",
  "assumptions": ["string"],
  "resumeStrengths": ["string"],
  "resumeMissing": ["string"],
  "companyExpectations": ["string"],
  "skillGaps": ["string"],
  "companySignals": [{"point":"string","sourceType":"platform_role|must_do|oa|interview_question|interview_experience"}],
  "dataQualityNote": "",
  "topicSections": [{"title":"string","why":"short","subtopics":[{"title":"string"}]}],
  "days": [{"day":1,"focus":"string","tasks":[{"title":"string"}]}]
}

Limits: assumptions≤3, strengths/missing/expectations≤4 each, skillGaps≤5,
topics 4–6 with ≤3 subtopics each, exactly ${dayCount} days with ≤4 tasks each,
companySignals ${hasCampusSignals ? "2–3" : "must be []"}.
No urls, no hours, no motivationSlogans.`;

  const content = await callLLM(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    {
      model: PREP_PATH_MODEL,
      apiKeySlot: "prep_path",
      temperature: 0.35,
      max_tokens: 2500,
    }
  );

  const parsed = parseJSONResponse(content);
  return normalizeRoadmap(parsed, {
    days: dayCount,
    hoursPerDay: hpd,
    limitedData: Boolean(limitedData),
  });
}
