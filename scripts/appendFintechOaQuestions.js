/**
 * Append fintech OA coding questions and MCQs onto company_platform_content.
 * Does not delete or rewrite existing question rows or prepRoles.
 *
 * Usage:
 *   node scripts/appendFintechOaQuestions.js
 *   node scripts/appendFintechOaQuestions.js --write
 */
import dotenv from "dotenv";
import fs from "fs";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { classifyGeneralCompanyCategory } from "../utils/generalCompanyCategory.js";
import { normalizeQuestionKey } from "./lib/companyPlatformContentFromVisits.js";
import { assertMcqBank, buildMcqs } from "./data/fintech-oa/mcqs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });

const GROUP_FILES = ["groupA.js", "groupB.js", "groupC.js", "groupD.js"];
const WRITE = process.argv.includes("--write");

function approved(extra) {
  return {
    ...extra,
    status: "approved",
    isAnonymous: false,
    approvedAt: new Date(),
  };
}

function toCoding(row) {
  return approved({
    prepRoleKey: row.role,
    kind: "coding",
    question: String(row.question || "").trim(),
    answer: "",
    intuition: String(row.intuition || "").trim(),
    solutions: {
      cpp: String(row.cpp || "").trim(),
      java: String(row.java || "").trim(),
      python: String(row.python || "").trim(),
    },
  });
}

function toMcq(row) {
  return approved({
    prepRoleKey: row.prepRoleKey,
    question: String(row.question || "").trim(),
    optionA: String(row.optionA || "").trim(),
    optionB: String(row.optionB || "").trim(),
    optionC: String(row.optionC || "").trim(),
    optionD: String(row.optionD || "").trim(),
    answer: String(row.answer || "").trim(),
    intuition: String(row.intuition || "").trim(),
    mcqMetadata: row.mcqMetadata,
  });
}

async function loadGroups() {
  const dir = path.join(__dirname, "data/fintech-oa");
  const missing = GROUP_FILES.filter((name) => !fs.existsSync(path.join(dir, name)));
  if (missing.length) {
    throw new Error(`Missing DSA group files: ${missing.join(", ")}`);
  }
  const items = [];
  for (const name of GROUP_FILES) {
    const mod = await import(pathToFileURL(path.join(dir, name)).href);
    if (!Array.isArray(mod.GROUP)) throw new Error(`${name} does not export GROUP`);
    items.push(...mod.GROUP);
  }
  return items;
}

function roleCounts(rows) {
  return rows.reduce(
    (acc, row) => {
      acc[row.role] = (acc[row.role] || 0) + 1;
      return acc;
    },
    {}
  );
}

async function main() {
  const mcqCount = assertMcqBank();
  const dsa = await loadGroups();
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not set");

  const dbName = String(process.env.MONGODB_DB_NAME || "").trim() || undefined;
  await mongoose.connect(process.env.MONGO_URI, {
    ...(dbName ? { dbName } : {}),
    serverSelectionTimeoutMS: 30000,
  });
  const db = mongoose.connection.db;
  const companies = await db
    .collection("companies")
    .find({}, { projection: { name: 1, business_model: 1 } })
    .toArray();
  const fintech = companies
    .filter((row) => classifyGeneralCompanyCategory(row.business_model) === "fintech")
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));

  const byName = new Map();
  for (const row of dsa) {
    const name = String(row.company || "").trim();
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(row);
  }

  const expectedNames = fintech.map((row) => row.name);
  const problems = [];
  for (const name of expectedNames) {
    const rows = byName.get(name) || [];
    const counts = roleCounts(rows);
    if (rows.length !== 5 || counts.sde !== 3 || counts.analyst !== 2) {
      throw new Error(`${name}: expected 3 sde and 2 analyst, got ${JSON.stringify(counts)} (${rows.length})`);
    }
    for (const row of rows) {
      const item = toCoding(row);
      if (!item.question || !item.intuition || !item.solutions.cpp || !item.solutions.java || !item.solutions.python) {
        throw new Error(`${name}: a ${row.role} question is missing text or a solution`);
      }
      problems.push({ name, item });
    }
  }
  const extra = [...byName.keys()].filter((name) => !expectedNames.includes(name));
  if (extra.length) throw new Error(`Unknown company names in DSA bank: ${extra.join(", ")}`);

  const platforms = await db
    .collection("company_platform_content")
    .find({}, { projection: { companyId: 1, onlineQuestions: 1, mcqQuestions: 1 } })
    .toArray();
  const globalKeys = new Set();
  const keysByCompany = new Map();
  for (const doc of platforms) {
    const id = String(doc.companyId);
    const local = new Set();
    for (const row of [...(doc.onlineQuestions || []), ...(doc.mcqQuestions || [])]) {
      const key = normalizeQuestionKey(row?.question);
      if (!key) continue;
      globalKeys.add(key);
      local.add(key);
    }
    keysByCompany.set(id, local);
  }

  const plannedKeys = new Set();
  const collisions = [];
  const plan = [];
  fintech.forEach((company, index) => {
    const id = String(company._id);
    const local = keysByCompany.get(id) || new Set();
    const coding = [];
    for (const row of byName.get(company.name)) {
      const item = toCoding(row);
      const key = normalizeQuestionKey(item.question);
      if (plannedKeys.has(key)) {
        collisions.push(`duplicate in new bank: ${company.name}`);
        continue;
      }
      if (local.has(key)) continue;
      if (globalKeys.has(key)) {
        collisions.push(`already used in another company: ${company.name}: ${item.question.slice(0, 80)}`);
        continue;
      }
      plannedKeys.add(key);
      coding.push(item);
    }
    const mcqs = [];
    for (const row of buildMcqs(index)) {
      const item = toMcq(row);
      const key = normalizeQuestionKey(item.question);
      if (plannedKeys.has(key)) {
        collisions.push(`duplicate mcq in new bank: ${company.name}`);
        continue;
      }
      if (local.has(key)) continue;
      if (globalKeys.has(key)) {
        collisions.push(`mcq already used: ${company.name}: ${item.question.slice(0, 80)}`);
        continue;
      }
      plannedKeys.add(key);
      mcqs.push(item);
    }
    plan.push({ company, coding, mcqs });
  });

  if (collisions.length) {
    console.error(collisions.slice(0, 20).join("\n"));
    throw new Error(`${collisions.length} uniqueness collisions. Nothing was written.`);
  }

  const summary = {
    fintech: fintech.length,
    mcqBank: mcqCount,
    dsaInBank: problems.length,
    companiesToTouch: plan.filter((row) => row.coding.length || row.mcqs.length).length,
    codingToAppend: plan.reduce((sum, row) => sum + row.coding.length, 0),
    mcqToAppend: plan.reduce((sum, row) => sum + row.mcqs.length, 0),
    write: WRITE,
  };
  console.log(JSON.stringify(summary, null, 2));

  if (!WRITE) {
    console.log("Dry run only. Re-run with --write to append.");
    await mongoose.disconnect();
    return;
  }

  const col = db.collection("company_platform_content");
  let modified = 0;
  let upserted = 0;
  for (const row of plan) {
    if (!row.coding.length && !row.mcqs.length) continue;
    const push = {};
    if (row.coding.length) push.onlineQuestions = { $each: row.coding };
    if (row.mcqs.length) push.mcqQuestions = { $each: row.mcqs };
    const setOnInsert = {
      companyId: row.company._id,
      interviewQuestions: [],
      interviewExperiences: [],
      internshipExperiences: [],
      mustDoTopics: [],
      codingQuestions: [],
      researchSources: [],
      prepRoles: [],
      researchLinksSummaries: [],
      createdAt: new Date(),
    };
    const result = await col.updateOne(
      { companyId: row.company._id },
      {
        $push: push,
        $set: { updatedAt: new Date() },
        $setOnInsert: setOnInsert,
      },
      { upsert: true }
    );
    modified += result.modifiedCount || 0;
    upserted += result.upsertedCount || 0;
    console.log(
      `${row.company.name}: +${row.coding.length} coding, +${row.mcqs.length} mcq, upserted=${result.upsertedCount}`
    );
  }
  console.log(JSON.stringify({ modified, upserted }, null, 2));
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore
  }
  process.exit(1);
});
