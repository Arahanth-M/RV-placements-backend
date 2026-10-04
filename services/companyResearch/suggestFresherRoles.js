import { callLLM } from "../llmClient.js";
import { parseJSONResponse } from "../../utils/parseJSONResponse.js";
import { GROQ_KEY_SLOTS } from "../../config/groqApiKey.js";
import { getJSON, setJSON } from "../../src/utils/redisHelpers.js";
import { searchWeb } from "./tavilySearch.js";

const CACHE_PREFIX = "company-research:fresher-roles:";
const CACHE_TTL_SECONDS = 6 * 60 * 60;
const MAX_ROLES = 8;
const MAX_SNIPPETS = 8;

const GENERIC_TITLES = new Set([
  "tbd",
  "tba",
  "tbc",
  "n/a",
  "na",
  "none",
  "null",
  "intern",
  "internship",
  "fresher",
  "freshers",
  "campus",
  "placement",
  "job",
  "jobs",
  "hiring",
  "full time",
  "full-time",
  "new grad",
  "new graduate",
  "graduate",
  "employee",
  "candidate",
  "student",
  "role",
  "roles",
]);

const SYSTEM = [
  "You list fresher, campus, and new-graduate roles that a company recruits for.",
  "Use only the web snippets. Do not use outside knowledge and do not invent roles.",
  "Keep a role only when a snippet says this company hires freshers, new graduates, or campus candidates for it.",
  "Copy the role title from the snippet. Clean spacing only. Do not expand an acronym into a different title.",
  "Skip senior, staff, and principal roles, locations, years, skills, and eligibility lines.",
  'Return only JSON: {"roles":[{"role":"SDE","source":0}]}',
  "source is the snippet index. Return at most 8 roles. Return an empty list when the snippets do not name fresher roles.",
].join(" ");

function compact(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function cacheKey(companyId, companyName) {
  const name = compact(companyName).toLowerCase().slice(0, 80);
  return `${CACHE_PREFIX}${companyId}:${name}`;
}

/**
 * @param {string} companyName
 */
export function buildFresherRoleQueries(companyName) {
  const company = compact(companyName).replace(/"/g, "").slice(0, 120);
  return [
    `"${company}" fresher roles campus placement hiring`,
    `"${company}" new graduate jobs roles`,
  ];
}

function cleanRole(value) {
  const role = compact(value).replace(/^["']+|["']+$/g, "").replace(/[.,;:]+$/g, "");
  if (!role || role.length < 2 || role.length > 80) return "";
  if (!/[a-z]/i.test(role)) return "";
  if (role.split(/\s+/).length > 6) return "";
  if (GENERIC_TITLES.has(role.toLowerCase())) return "";
  return role;
}

function matchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function evidenceSupportsRole(role, evidence) {
  const needle = matchText(role);
  const hay = matchText(evidence);
  if (!needle || !hay) return false;
  if (hay.includes(needle) || hay.includes(`${needle}s`)) return true;
  const acronyms = [...String(role).matchAll(/\(([A-Za-z][A-Za-z0-9]{1,9})\)/g)].map((match) =>
    match[1].toLowerCase()
  );
  return acronyms.some((acronym) => hay.includes(acronym));
}

/**
 * Keep titles the snippets actually contain. Drops anything the model adds on its own.
 * @param {Array<{ role?: unknown, source?: unknown }>} candidates
 * @param {Array<{ title?: string, snippet?: string }>} snippets
 */
export function selectGroundedFresherRoles(candidates, snippets) {
  const evidence = (Array.isArray(snippets) ? snippets : []).map(
    (row) => `${row?.title || ""} ${row?.snippet || ""}`
  );
  const seen = new Set();
  const roles = [];
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const role = cleanRole(candidate?.role);
    if (!role) continue;
    const key = role.toLowerCase();
    if (seen.has(key)) continue;
    const source = Number(candidate?.source);
    const pool =
      Number.isInteger(source) && source >= 0 && evidence[source] != null
        ? [evidence[source]]
        : evidence;
    if (!pool.some((text) => evidenceSupportsRole(role, text))) continue;
    seen.add(key);
    roles.push(role);
    if (roles.length >= MAX_ROLES) break;
  }
  return roles;
}

function dedupeSnippets(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const url = compact(row?.url);
    const snippet = compact(row?.snippet);
    if (!snippet) continue;
    const key = url || snippet;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      title: compact(row?.title).slice(0, 180),
      url,
      snippet: snippet.slice(0, 500),
    });
    if (out.length >= MAX_SNIPPETS) break;
  }
  return out;
}

function prompt(companyName, snippets) {
  const lines = [`Company: ${compact(companyName).slice(0, 120)}`, "Snippets:"];
  snippets.forEach((row, index) => {
    lines.push(`${index}. ${row.title ? `${row.title} — ` : ""}${row.snippet}`);
  });
  return lines.join("\n");
}

/**
 * Public fresher roles for one company. Does not read stored visit or placement roles.
 * @param {{ companyId: string, companyName: string }} input
 * @returns {Promise<string[]>}
 */
export async function suggestFresherRoles({ companyId, companyName }) {
  const id = compact(companyId);
  const name = compact(companyName);
  if (!id || !name) return [];

  const key = cacheKey(id, name);
  const cached = await getJSON(key);
  if (cached && Array.isArray(cached.roles)) {
    return cached.roles.filter((role) => typeof role === "string" && role.trim());
  }

  const queries = buildFresherRoleQueries(name);
  const settled = await Promise.allSettled(
    queries.map((query) => searchWeb(query, { maxResults: 5, searchDepth: "basic" }))
  );
  if (!settled.some((row) => row.status === "fulfilled")) return [];

  const snippets = dedupeSnippets(
    settled.flatMap((row) => (row.status === "fulfilled" && Array.isArray(row.value) ? row.value : []))
  );
  if (snippets.length === 0) {
    await setJSON(key, { roles: [] }, CACHE_TTL_SECONDS);
    return [];
  }

  let roles = [];
  try {
    const response = await callLLM(
      [
        { role: "system", content: SYSTEM },
        { role: "user", content: prompt(name, snippets) },
      ],
      { apiKeySlot: GROQ_KEY_SLOTS.ADMIN, temperature: 0 }
    );
    const parsed = parseJSONResponse(String(response || ""));
    roles = selectGroundedFresherRoles(parsed?.roles, snippets);
  } catch (error) {
    console.error("[company-research] fresher role extraction failed", error?.message || "llm_failed");
    return [];
  }

  await setJSON(key, { roles }, CACHE_TTL_SECONDS);
  return roles;
}
