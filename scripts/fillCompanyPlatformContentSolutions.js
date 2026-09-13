/**
 * Fill solutions.java, solutions.python, and intuition on company_platform_content
 * OA/interview questions. Never writes solutions.cpp. Never touches visits.
 *
 * Usage:
 *   node scripts/fillCompanyPlatformContentSolutions.js
 *   node scripts/fillCompanyPlatformContentSolutions.js --dry-run --limit=2
 *   node scripts/fillCompanyPlatformContentSolutions.js --coding-only
 *   node scripts/fillCompanyPlatformContentSolutions.js --non-coding-only
 */
import { createHash } from "crypto";
import dotenv from "dotenv";
import fs from "fs";
import fsPromises from "fs/promises";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";
import { GROQ_KEY_SLOTS } from "../config/groqApiKey.js";
import { GROQ_QUALITY_MODEL } from "../config/groqModels.js";
import { callLLM } from "../services/llmClient.js";
import { parseJSONResponse } from "../utils/parseJSONResponse.js";
import {
  buildCodingPrompt,
  buildIntuitionPrompt,
  buildRepairPrompt,
  isPlaceholderQuestion,
  parseTaggedPayload,
  sleep,
  validateCodingFill,
  validateIntuitionOnly,
  wantsCodeSolutions,
} from "./lib/platformSolutionFill.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });

function say(message) {
  fs.writeSync(process.stdout.fd, `${message}\n`);
}

const PLATFORM_COLLECTION = "company_platform_content";
const VISITS_COLLECTION = "company_visits_with_rvitm";
const ARRAY_FIELDS = ["onlineQuestions", "interviewQuestions"];
const MAX_ATTEMPTS = 3;
const CALL_GAP_MS = 800;
const RATE_LIMIT_WAIT_MS = 20000;
const LLM_TIMEOUT_MS = 120000;

say("boot");

const argv = new Set(process.argv.slice(2));
const DRY_RUN = argv.has("--dry-run");
const CODING_ONLY = argv.has("--coding-only");
const NON_CODING_ONLY = argv.has("--non-coding-only");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : 0;
const concurrencyArg = process.argv.find((a) => a.startsWith("--concurrency="));
const CONCURRENCY = Math.max(1, Number(concurrencyArg?.split("=")[1] || 2));

function createDocLock() {
  const tails = new Map();
  return async function withLock(docId, fn) {
    const key = String(docId);
    const prev = tails.get(key) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => {
      release = resolve;
    });
    tails.set(
      key,
      prev.then(() => current).catch(() => current)
    );
    await prev.catch(() => {});
    try {
      return await fn();
    } finally {
      release();
    }
  };
}

async function runPool(work, worker, concurrency) {
  let cursor = 0;
  const n = Math.min(concurrency, work.length);
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (true) {
        const i = cursor;
        cursor += 1;
        if (i >= work.length) return;
        await worker(work[i], i);
      }
    })
  );
}

function clusterHostFromUri(uri) {
  try {
    const withScheme = String(uri || "").replace(/^mongodb\+srv:\/\//, "https://");
    return new URL(withScheme).hostname;
  } catch {
    return "(unparsed)";
  }
}

async function visitFingerprint(col) {
  const total = await col.countDocuments({});
  const sample = await col
    .find({}, { projection: { updatedAt: 1 } })
    .sort({ _id: 1 })
    .limit(5)
    .toArray();
  return {
    total,
    sample: sample.map((d) => `${d._id}:${d.updatedAt ? new Date(d.updatedAt).toISOString() : ""}`),
  };
}

function cacheKey(item) {
  const raw = [
    wantsCodeSolutions(item) ? "code" : "text",
    String(item.question || ""),
    String(item.solutions?.cpp || ""),
    String(item.answer || ""),
  ].join("\n---\n");
  return createHash("sha256").update(raw).digest("hex");
}

function itemNeeds(item) {
  if (isPlaceholderQuestion(item?.question)) return { any: false };
  const coding = wantsCodeSolutions(item);
  if (NON_CODING_ONLY && coding) return { any: false };
  if (CODING_ONLY && !coding) return { any: false };
  const java = String(item?.solutions?.java || "").trim();
  const python = String(item?.solutions?.python || "").trim();
  const intuition = String(item?.intuition || "").trim();
  const needJava = coding && !java;
  const needPython = coding && !python;
  const needIntuition = !intuition;
  return {
    coding,
    needJava,
    needPython,
    needIntuition,
    any: needJava || needPython || needIntuition,
  };
}

function collectWork(docs) {
  const work = [];
  for (const doc of docs) {
    for (const field of ARRAY_FIELDS) {
      const arr = Array.isArray(doc[field]) ? doc[field] : [];
      arr.forEach((item, index) => {
        const needs = itemNeeds(item);
        if (!needs.any) return;
        work.push({
          docId: doc._id,
          companyId: doc.companyId,
          field,
          index,
          item,
          needs,
          cppBefore: String(item?.solutions?.cpp || ""),
        });
      });
    }
  }
  return work;
}

async function callWithRetry(messages, maxTokens, attemptIndex) {
  const model = GROQ_QUALITY_MODEL;
  const timeoutMs = LLM_TIMEOUT_MS;
  let lastError;
  for (let networkTry = 1; networkTry <= 3; networkTry += 1) {
    try {
      say(`llm-call model=${model} attempt=${attemptIndex} net=${networkTry} max_tokens=${maxTokens}`);
      let timer;
      const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`LLM timed out after ${timeoutMs}ms`)), timeoutMs);
      });
      const text = await Promise.race([
        callLLM(messages, {
          apiKeySlot: GROQ_KEY_SLOTS.ADMIN,
          model,
          temperature: 0.1,
          max_tokens: maxTokens,
          allowFallback: false,
        }).finally(() => clearTimeout(timer)),
        timeoutPromise,
      ]);
      say(`llm-ok model=${model} chars=${String(text || "").length}`);
      return text;
    } catch (error) {
      lastError = error;
      const msg = String(error?.message || error);
      const lower = msg.toLowerCase();
      const rateLimited = lower.includes("rate") || lower.includes("429") || lower.includes("tpm");
      const again = msg.match(/try again in ([\d.]+)\s*s/i);
      const wait = again
        ? Math.ceil(Number(again[1]) * 1000) + 750
        : rateLimited
          ? RATE_LIMIT_WAIT_MS * networkTry
          : 1200 * networkTry;
      say(`LLM failed: ${error.message || error}; wait ${wait}ms`);
      await sleep(wait);
    }
  }
  throw lastError;
}

function parseFill(raw) {
  const tagged = parseTaggedPayload(raw);
  if (tagged.java || tagged.python || tagged.intuition) return tagged;
  try {
    const json = parseJSONResponse(raw);
    if (!json || typeof json !== "object") return tagged;
    return {
      java: String(json.java || json.Java || ""),
      python: String(json.python || json.Python || ""),
      intuition: String(json.intuition || json.Intuition || ""),
    };
  } catch {
    return tagged;
  }
}

async function generateForItem(item, needs) {
  if (!needs.coding) {
    const messages = buildIntuitionPrompt({
      question: item.question,
      answer: item.answer,
    });
    let lastReasons = [];
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const prompt = attempt === 1 ? messages : buildRepairPrompt(messages, lastReasons);
      const raw = await callWithRetry(prompt, 1200, attempt);
      const parsed = parseFill(raw);
      const checked = validateIntuitionOnly(parsed.intuition);
      if (checked.ok) {
        return { intuition: checked.intuition };
      }
      lastReasons = checked.reasons;
      say(`validate-fail intuition attempt=${attempt} ${lastReasons.join(" | ")}`);
    }
    throw new Error(`intuition invalid: ${lastReasons.join("; ")}`);
  }

  const messages = buildCodingPrompt({
    question: item.question,
    cpp: item.solutions?.cpp,
    needJava: needs.needJava,
    needPython: needs.needPython,
    needIntuition: needs.needIntuition,
  });
  let lastReasons = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const prompt = attempt === 1 ? messages : buildRepairPrompt(messages, lastReasons);
    const raw = await callWithRetry(prompt, 12000, attempt);
    const parsed = parseFill(raw);
    const checked = validateCodingFill({
      java: needs.needJava ? parsed.java : item.solutions?.java,
      python: needs.needPython ? parsed.python : item.solutions?.python,
      intuition: needs.needIntuition ? parsed.intuition : item.intuition,
      cpp: item.solutions?.cpp,
    });
    if (checked.ok) {
      const out = {};
      if (needs.needJava) out.java = checked.java;
      if (needs.needPython) out.python = checked.python;
      if (needs.needIntuition) out.intuition = checked.intuition;
      return out;
    }
      lastReasons = checked.reasons;
      say(`validate-fail coding attempt=${attempt} ${lastReasons.join(" | ")}`);
      say(`raw-head ${String(raw || "").replace(/\s+/g, " ").slice(0, 280)}`);
  }
  throw new Error(`coding fill invalid: ${lastReasons.join("; ")}`);
}

function buildSetPayload(field, index, fill, needs) {
  const prefix = `${field}.${index}`;
  const set = {};
  if (needs.needJava && fill.java) set[`${prefix}.solutions.java`] = fill.java;
  if (needs.needPython && fill.python) set[`${prefix}.solutions.python`] = fill.python;
  if (needs.needIntuition && fill.intuition) set[`${prefix}.intuition`] = fill.intuition;
  const forbidden = Object.keys(set).filter((k) => k.endsWith(".cpp") || k.includes("solutions.cpp"));
  if (forbidden.length) {
    throw new Error(`refusing to write C++ fields: ${forbidden.join(", ")}`);
  }
  return set;
}

async function patchItem(col, job, fill) {
  const set = buildSetPayload(job.field, job.index, fill, job.needs);
  if (Object.keys(set).length === 0) return { modifiedCount: 0 };

  const filter = {
    _id: job.docId,
    [`${job.field}.${job.index}.question`]: job.item.question,
  };
  if (job.cppBefore) {
    filter[`${job.field}.${job.index}.solutions.cpp`] = job.cppBefore;
  }

  const result = await col.updateOne(filter, { $set: set });
  if (result.matchedCount !== 1) {
    throw new Error(`update matched ${result.matchedCount} docs; expected 1 (index or C++ mismatch)`);
  }

  const fresh = await col.findOne(
    { _id: job.docId },
    { projection: { [job.field]: 1 } }
  );
  const cppAfter = String(fresh?.[job.field]?.[job.index]?.solutions?.cpp || "");
  if (cppAfter !== job.cppBefore) {
    throw new Error(`C++ changed for ${job.docId} ${job.field}[${job.index}]; aborting`);
  }
  return result;
}

async function appendFailure(row) {
  const file = path.join(__dirname, "reports/platform-content-fill-failures.jsonl");
  await fsPromises.mkdir(path.dirname(file), { recursive: true });
  await fsPromises.appendFile(file, `${JSON.stringify(row)}\n`, "utf8");
}

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not set");

  say(
    JSON.stringify(
      {
        host: clusterHostFromUri(process.env.MONGO_URI),
        dbName: process.env.MONGODB_DB_NAME || "(from URI)",
        dryRun: DRY_RUN,
        codingOnly: CODING_ONLY,
        nonCodingOnly: NON_CODING_ONLY,
        concurrency: CONCURRENCY,
        limit: LIMIT || null,
      },
      null,
      2
    )
  );

  await mongoose.connect(process.env.MONGO_URI, {
    dbName: process.env.MONGODB_DB_NAME || undefined,
    serverSelectionTimeoutMS: 30000,
  });

  const db = mongoose.connection.db;
  const platformCol = db.collection(PLATFORM_COLLECTION);
  const visitsCol = db.collection(VISITS_COLLECTION);
  const fingerprintBefore = await visitFingerprint(visitsCol);
  say("visitsFingerprintBefore=" + JSON.stringify(fingerprintBefore));

  const docs = await platformCol
    .find(
      {},
      {
        projection: {
          companyId: 1,
          onlineQuestions: 1,
          interviewQuestions: 1,
        },
      }
    )
    .toArray();

  let work = collectWork(docs);
  if (LIMIT > 0) work = work.slice(0, LIMIT);
  say(`workItems=${work.length}`);

  const cache = new Map();
  let filled = 0;
  let skippedCache = 0;
  let failed = 0;
  const withDocLock = createDocLock();

  await runPool(
    work,
    async (job, i) => {
      const label = `${i + 1}/${work.length} ${job.field}[${job.index}] ${String(job.item.question || "").slice(0, 70)}`;
      const key = cacheKey(job.item);
      try {
        let fill = cache.get(key);
        if (fill) {
          skippedCache += 1;
        } else {
          fill = await generateForItem(job.item, job.needs);
          cache.set(key, fill);
          await sleep(CALL_GAP_MS);
        }
        if (!DRY_RUN) {
          await withDocLock(job.docId, () => patchItem(platformCol, job, fill));
        }
        filled += 1;
        say(`ok ${label}`);
      } catch (error) {
        failed += 1;
        const message = String(error?.message || error);
        say(`fail ${label} :: ${message.slice(0, 300)}`);
        await appendFailure({
          at: new Date().toISOString(),
          docId: String(job.docId),
          field: job.field,
          index: job.index,
          question: String(job.item.question || "").slice(0, 200),
          error: message.slice(0, 800),
        });
      }
    },
    CONCURRENCY
  );

  const fingerprintAfter = await visitFingerprint(visitsCol);
  say("visitsFingerprintAfter=" + JSON.stringify(fingerprintAfter));
  if (JSON.stringify(fingerprintBefore) !== JSON.stringify(fingerprintAfter)) {
    throw new Error("Visit collection fingerprint changed; visits must stay untouched.");
  }

  say(
    JSON.stringify(
      {
        filled,
        failed,
        reusedCache: skippedCache,
        dryRun: DRY_RUN,
        remainingHint: "re-run to resume; already-filled items are skipped",
      },
      null,
      2
    )
  );

  await mongoose.disconnect();
  if (failed > 0 && filled === 0) process.exit(1);
}

main().catch(async (error) => {
  say(String(error?.stack || error));
  try {
    await mongoose.disconnect();
  } catch {
    // ignore
  }
  process.exit(1);
});
