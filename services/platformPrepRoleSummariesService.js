import mongoose from "mongoose";
import CompanyStatic from "../models/CompanyStatic.js";
import CompanyPlatformContent from "../models/CompanyPlatformContent.js";
import { callLLM } from "./llmClient.js";
import { parseJSONResponse } from "../utils/parseJSONResponse.js";
import { GROQ_KEY_SLOTS } from "../config/groqApiKey.js";
import { getLlmBudget } from "./platformLlmBudgets.js";
import { normalizeMultilineText } from "../utils/normalizeMultilineText.js";
import { upsertResearchLinksSummary } from "../utils/researchLinksSummaries.js";
import { invalidateCompanyDetailCache } from "./companyDetailCache.js";
import { normalizeQuickLinkRoles } from "./platformPrepQuickLinksService.js";

function compact(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function asObjectId(value) {
  try {
    return new mongoose.Types.ObjectId(String(value));
  } catch {
    return null;
  }
}

function jsonSchema() {
  return {
    type: "json_schema",
    json_schema: {
      name: "prep_role_links_summary",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: { summary: { type: "string" } },
        required: ["summary"],
      },
    },
  };
}

function sourceBullets(sources) {
  const lines = [];
  for (const row of (Array.isArray(sources) ? sources : []).slice(0, 12)) {
    const title = compact(row?.title) || compact(row?.url);
    const snippet = compact(row?.tavilySnippet ?? row?.snippet);
    if (!title && !snippet) continue;
    lines.push(`- ${title}${snippet ? `: ${snippet}` : ""}`);
  }
  return lines.join("\n");
}

async function summarizeRole({ companyName, roleLabel, sources }) {
  const bullets = sourceBullets(sources);
  if (!bullets) {
    const err = new Error("No quick-link sources available for this role yet.");
    err.status = 400;
    throw err;
  }

  const response = await callLLM(
    [
      {
        role: "system",
        content: [
          "You summarize what a company typically tests in technical interviews for a given role.",
          "Use only the provided research link titles and snippets; do not invent specific internal processes.",
          'Return only JSON: {"summary":"..."}',
          "Write 5–6 complete sentences in plain English for placement prep students.",
          "Mention common topics when supported by snippets.",
        ].join(" "),
      },
      {
        role: "user",
        content: [
          `Company: ${companyName}`,
          `Role: ${roleLabel}`,
          "Research sources:",
          bullets,
          "Summarize what this company tends to test for this role.",
        ].join("\n\n"),
      },
    ],
    {
      apiKeySlot: GROQ_KEY_SLOTS.ADMIN,
      temperature: 0.3,
      reasoning_effort: "low",
      include_reasoning: false,
      max_completion_tokens: await getLlmBudget("answers-text"),
      response_format: jsonSchema(),
    }
  );

  const parsed = parseJSONResponse(response);
  const summary = normalizeMultilineText(parsed?.summary);
  if (!summary) {
    const err = new Error("Summary generation returned empty text.");
    err.status = 500;
    err.code = "summary_generation_failed";
    throw err;
  }
  return summary;
}

/**
 * Generate and persist researchLinksSummaries for CSV / quick-link roles.
 * Uses existing researchSources on the company platform doc (fetch quick links first).
 *
 * @param {{
 *   companyId?: string,
 *   roles?: unknown[],
 * }} input
 */
export async function generatePrepRoleLinksSummaries(input = {}) {
  const oid = asObjectId(input.companyId);
  if (!oid) {
    const err = new Error("Invalid company id");
    err.status = 400;
    throw err;
  }

  const company = await CompanyStatic.findById(oid).select({ name: 1 }).lean();
  if (!company) {
    const err = new Error("Company not found");
    err.status = 404;
    throw err;
  }

  let roles = normalizeQuickLinkRoles(input.roles);
  const doc = await CompanyPlatformContent.findOne({ companyId: oid });
  if (!doc) {
    const err = new Error("No platform content found. Finalize CSV and fetch quick links first.");
    err.status = 404;
    throw err;
  }

  if (!roles.length) {
    const fromCatalog = Array.isArray(doc.prepRoles) ? doc.prepRoles : [];
    roles = normalizeQuickLinkRoles(fromCatalog);
  }
  if (!roles.length) {
    const err = new Error("No roles provided for summary generation.");
    err.status = 400;
    throw err;
  }

  const sources = Array.isArray(doc.researchSources) ? doc.researchSources : [];
  let summaries = Array.isArray(doc.researchLinksSummaries)
    ? doc.researchLinksSummaries.map((row) => ({ ...row }))
    : [];

  const perRole = [];
  let generated = 0;
  let failed = 0;

  for (const role of roles) {
    const key = String(role.key || "");
    const label = role.label || key || "General";
    const roleSources = sources.filter((row) => String(row?.prepRoleKey ?? "") === key);
    try {
      const summary = await summarizeRole({
        companyName: String(company.name || "").trim() || "the company",
        roleLabel: label,
        sources: roleSources.length ? roleSources : sources.slice(0, 8),
      });
      summaries = upsertResearchLinksSummary(summaries, {
        prepRoleKey: key,
        summary,
      });
      generated += 1;
      perRole.push({ key, label, status: "ok", summary });
    } catch (error) {
      failed += 1;
      perRole.push({
        key,
        label,
        status: "error",
        error: error?.message || "Summary failed",
      });
    }
  }

  doc.researchLinksSummaries = summaries;
  doc.markModified("researchLinksSummaries");
  await doc.save();
  await invalidateCompanyDetailCache(String(oid));

  return {
    companyId: String(oid),
    companyName: String(company.name || "").trim(),
    rolesRequested: roles.length,
    generated,
    failed,
    perRole,
  };
}
