import { callLLM } from "../llmClient.js";
import { researchLlmOptions } from "../platformLlmBudgets.js";
import { parseJSONResponse } from "../../utils/parseJSONResponse.js";
import { normalizeQuestionKey } from "./researchInterviewQuestions.js";

const OA_FORMS = new Set(["coding", "sql", "mcq"]);

const CONSOLIDATE_SYSTEM = [
  "You consolidate reported online assessment questions for one company and role.",
  "Use only the supplied extracted items and their evidence. Do not invent new questions.",
  "Merge duplicates that describe the same question. Keep the clearest wording.",
  "Every output item must use form coding, sql, or mcq.",
  "Convert an item into the closest allowed form when the source supports it (e.g. aptitude MCQ → mcq, query task → sql, programming → coding).",
  "For mcq, include mcqMetadata with at least two options when the evidence supports options; otherwise omit mcqMetadata.",
  "Keep a short evidence quote per item from the supplied evidence fields.",
  'Return only JSON: {"items":[{"form":"","question":"","evidence":"","mcqMetadata":null}]}.',
].join(" ");

function compact(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeMcqMetadata(raw) {
  if (!raw || typeof raw !== "object") return undefined;
  const options = [];
  if (Array.isArray(raw.options)) {
    for (const opt of raw.options) {
      if (!opt || typeof opt !== "object") continue;
      const id = compact(opt.id).toUpperCase();
      const text = compact(opt.text);
      if (!id || !text) continue;
      if (!["A", "B", "C", "D", "E", "F"].includes(id)) continue;
      options.push({ id, text });
    }
  }
  if (options.length < 2) return undefined;
  const correctOptionId = compact(raw.correctOptionId).toUpperCase();
  const meta = { options, shuffleOptions: true, allowMultiple: false };
  if (correctOptionId && options.some((o) => o.id === correctOptionId)) {
    meta.correctOptionId = correctOptionId;
  }
  return meta;
}

function sanitizeItem(raw) {
  if (!raw || typeof raw !== "object") return null;
  const form = compact(raw.form).toLowerCase();
  if (!OA_FORMS.has(form)) return null;
  const question = compact(raw.question);
  const evidence = compact(raw.evidence);
  if (!question || !evidence) return null;
  const item = { form, question, evidence, answer: "", intuition: "" };
  if (form === "mcq") {
    const mcqMetadata = normalizeMcqMetadata(raw.mcqMetadata);
    if (mcqMetadata) item.mcqMetadata = mcqMetadata;
  }
  return item;
}

function dedupeItems(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = normalizeQuestionKey(item.question);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/**
 * @param {unknown[]} extracted
 * @param {{ companyName?: string, role?: string }} context
 */
export async function consolidateOaItems(extracted, context = {}) {
  const rows = Array.isArray(extracted) ? extracted : [];
  if (rows.length === 0) return [];

  if (rows.length === 1) {
    const one = sanitizeItem({
      form: rows[0].form || rows[0].kind,
      question: rows[0].question,
      evidence: rows[0].evidence,
      mcqMetadata: rows[0].mcqMetadata,
    });
    return one ? [one] : [];
  }

  const companyName = compact(context.companyName);
  const role = compact(context.role);
  const payload = rows.map((row) => ({
    form: row.form || row.kind,
    question: row.question,
    evidence: row.evidence,
    mcqMetadata: row.mcqMetadata,
  }));

  const raw = await callLLM(
    [
      { role: "system", content: CONSOLIDATE_SYSTEM },
      {
        role: "user",
        content: [
          `Company: ${companyName || "(unknown)"}`,
          `Role: ${role || "(unknown)"}`,
          "<<<EXTRACTED_OA_ITEMS>>>",
          JSON.stringify(payload, null, 2),
          "<<<END_EXTRACTED_OA_ITEMS>>>",
        ].join("\n"),
      },
    ],
    await researchLlmOptions({ temperature: 0.15 })
  );

  let parsed;
  try {
    parsed = parseJSONResponse(raw);
  } catch {
    return dedupeItems(
      rows
        .map((row) =>
          sanitizeItem({
            form: row.form || row.kind,
            question: row.question,
            evidence: row.evidence,
            mcqMetadata: row.mcqMetadata,
          })
        )
        .filter(Boolean)
    );
  }

  const items = [];
  if (parsed && Array.isArray(parsed.items)) {
    for (const rawItem of parsed.items) {
      const clean = sanitizeItem(rawItem);
      if (clean) items.push(clean);
    }
  }

  if (items.length === 0) {
    return dedupeItems(
      rows
        .map((row) =>
          sanitizeItem({
            form: row.form || row.kind,
            question: row.question,
            evidence: row.evidence,
            mcqMetadata: row.mcqMetadata,
          })
        )
        .filter(Boolean)
    );
  }

  return dedupeItems(items);
}
