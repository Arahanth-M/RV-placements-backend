import { callLLM } from "../llmClient.js";
import { parseJSONResponse } from "../../utils/parseJSONResponse.js";
import { GROQ_KEY_SLOTS } from "../../config/groqApiKey.js";
import { normalizePrepRoleKey } from "../../utils/prepRole.js";
import {
  canManageResearchLinks,
  getResearchJob,
  setResearchJobLinksSummaryDraft,
} from "./researchJobService.js";
import { PublishResearchError } from "./publishResearchInterviewQuestions.js";
import { normalizeMultilineText } from "../../utils/normalizeMultilineText.js";

function compact(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function assertReviewJob(job) {
  if (!job) throw new PublishResearchError("job_not_found");
  if (!canManageResearchLinks(job)) throw new PublishResearchError("not_reviewable");
}

const SYSTEM = [
  "You summarize what a company typically tests in technical interviews for a given role.",
  "Use only the provided research link titles and snippets; do not invent specific internal processes.",
  "Return only JSON: {\"summary\":\"...\"}.",
  "Write 5–6 complete sentences in plain English for placement prep students.",
  "Mention common topics (DSA, CS fundamentals, system design level appropriate to role) when supported by snippets.",
].join(" ");

function sourceBullets(sources) {
  const rows = Array.isArray(sources) ? sources : [];
  const lines = [];
  for (const row of rows.slice(0, 12)) {
    const title = compact(row?.title) || compact(row?.url);
    const snippet = compact(row?.tavilySnippet ?? row?.snippet);
    if (!title && !snippet) continue;
    lines.push(`- ${title}${snippet ? `: ${snippet}` : ""}`);
  }
  return lines.join("\n");
}

/**
 * @param {{ jobId?: string }} input
 */
export async function generateResearchLinksSummary(input = {}) {
  const jobId = String(input.jobId || "").trim();
  const job = await getResearchJob(jobId);
  assertReviewJob(job);

  const companyName = compact(job.companyName) || "the company";
  const { key: prepRoleKey, label: roleLabel } = normalizePrepRoleKey(job.role);
  const sources = job.result.sources;
  const bullets = sourceBullets(sources);
  if (!bullets) {
    throw new PublishResearchError("not_reviewable");
  }

  const userContent = [
    `Company: ${companyName}`,
    `Role: ${roleLabel}`,
    "Research sources:",
    bullets,
    "Summarize what this company tends to test for this role.",
  ].join("\n\n");

  const response = await callLLM(
    [
      { role: "system", content: SYSTEM },
      { role: "user", content: userContent },
    ],
    { apiKeySlot: GROQ_KEY_SLOTS.ADMIN }
  );

  const parsed = parseJSONResponse(response);
  const summary = normalizeMultilineText(parsed?.summary);
  if (!summary) {
    const error = new Error("Summary generation returned invalid JSON.");
    error.code = "summary_generation_failed";
    throw error;
  }

  await setResearchJobLinksSummaryDraft(jobId, { prepRoleKey, summary });

  return { jobId, prepRoleKey, summary };
}

/**
 * @param {{ jobId?: string, summary?: string }} input
 */
export async function saveResearchLinksSummaryDraft(input = {}) {
  const jobId = String(input.jobId || "").trim();
  const job = await getResearchJob(jobId);
  assertReviewJob(job);
  const summary = compact(input.summary);
  if (!summary) throw new PublishResearchError("invalid_selection");
  const { key: prepRoleKey } = normalizePrepRoleKey(job.role);
  await setResearchJobLinksSummaryDraft(jobId, { prepRoleKey, summary });
  return { jobId, prepRoleKey, summary };
}
