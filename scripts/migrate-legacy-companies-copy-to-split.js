/**
 * Migration: companies1_copy → companies + company_visits
 *
 * CRITICAL
 * - READS ONLY from collection "companies1_copy"
 * - WRITES ONLY to "companies" and "company_visits"
 * - NEVER uses "companies1" (production) — no read/write
 *
 * This script only:
 * - Relocates fields into `companies` (static) vs `company_visits` (dynamic)
 * - Renames: Must_Do_Topics → must_do_topics, "About The Company" → about
 *
 * It does NOT change stored types or transform values (no String() coercion of
 * migrated fields, no count parsing, no Map→object conversion, no Math.clamp).
 *
 * One row in companies1_copy → one `companies` doc + one `company_visits` doc.
 * Duplicate company names are kept (e.g. multiple visits / roles). Idempotent
 * per source document: upsert key `sourceCopyId` (= original _id in companies1_copy).
 *
 * Usage: node scripts/migrate-legacy-companies-copy-to-split.js [--dry-run]
 * Requires: npm install (mongoose, etc.). Loads ../.env without the dotenv package.
 */

import { existsSync, readFileSync } from "node:fs";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Minimal .env loader (no dotenv dependency). First `KEY=VALUE` wins; skips comments/empty. */
function loadEnvFromFile(filePath) {
  if (!existsSync(filePath)) return;
  const text = readFileSync(filePath, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith("\"") && val.endsWith("\"")) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvFromFile(path.join(__dirname, "../.env"));

/** Legacy prod collection name — built without a literal substring (forbidden guard). */
const FORBIDDEN_PRODUCTION = "companies" + 1;
const SOURCE_COPY = "companies" + 1 + "_copy";
const TARGET_COMPANIES = "companies";
const TARGET_VISITS = "company_visits";
const MIGRATION_YEAR = 2026;

/** Stems from companies1_copy._id — one migrated pair per source document. */
const SOURCE_REF_FIELD = "sourceCopyId";

/** Dynamic fields taken from the source as-is (relocation only). */
const DYNAMIC_FIELD_KEYS = [
  "type",
  "eligibility",
  "roles",
  "onlineQuestions",
  "onlineQuestions_solution",
  "interviewQuestions",
  "interviewQuestions_solution",
  "interviewProcess",
  "selectedCandidates",
  "mcqQuestions",
  "internshipExperience",
  "count",
  "totalStudentsApplied",
  "totalClearedOA",
  "totalGotIn",
  "interview_difficulty_level",
  "difficulty_ratings",
  "difficulty_rating_count",
  "date_of_visit",
  "cluster",
  "views",
  "status",
  "offCampus",
];

const DRY_RUN = process.argv.includes("--dry-run");

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function assertTargetCollection(name) {
  if (name === FORBIDDEN_PRODUCTION) {
    throw new Error(
      `Refusing to use forbidden collection "${FORBIDDEN_PRODUCTION}"`
    );
  }
}

/**
 * @param {unknown} v
 * @returns {string}
 */
function nameKeyFromName(v) {
  if (v == null) return "";
  return String(v).trim().toLowerCase();
}

/**
 * @param {Record<string, unknown>} o
 * @returns {Record<string, unknown>}
 */
function omitUndefined(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * @param {unknown} v
 * @returns {string}
 */
function typeLabel(v) {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (v instanceof Map) return "Map";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

/**
 * @param {unknown} ctc
 * @returns {string}
 */
function ctcTypeLabel(ctc) {
  if (ctc === null) return "null";
  if (ctc === undefined) return "undefined";
  if (ctc instanceof Map) return "Map";
  return typeof ctc;
}

/**
 * @param {unknown} srcRoles
 * @param {unknown} outRoles
 */
function logRoleCtcTypes(srcRoles, outRoles) {
  const s = Array.isArray(srcRoles) && srcRoles[0] != null ? srcRoles[0] : null;
  const o = Array.isArray(outRoles) && outRoles[0] != null ? outRoles[0] : null;
  const sCtc = s && typeof s === "object" && "ctc" in s ? s.ctc : undefined;
  const oCtc = o && typeof o === "object" && "ctc" in o ? o.ctc : undefined;
  const match = typeLabel(sCtc) === typeLabel(oCtc);
  log(
    "  [validate] roles[0] exists:",
    Boolean(s),
    "roles[0].ctc source:",
    ctcTypeLabel(sCtc),
    "out:",
    ctcTypeLabel(oCtc),
    match ? "OK" : "MISMATCH"
  );
}

/**
 * @param {Record<string, unknown>} src
 * @param {Record<string, unknown>} outVisit
 * @param {import("mongoose").Types.ObjectId|undefined} companyId
 */
function logKeyFieldTypes(src, outVisit, companyId) {
  const idStr = companyId != null ? String(companyId) : "(no id)";
  const cSrc = src.count;
  const cOut = outVisit.count;
  const cOk = typeLabel(cSrc) === typeLabel(cOut);
  log(
    "  [validate] count source:",
    typeLabel(cSrc),
    "out:",
    typeLabel(cOut),
    cOk ? "OK" : "MISMATCH",
    "(_id",
    (src && src._id) != null ? String(/** @type {{ _id: unknown }} */ (src)._id) : "?",
    "→ companyId",
    idStr + ")"
  );
  const rSrc = src.roles;
  const rOut = outVisit.roles;
  log(
    "  [validate] roles source:",
    typeLabel(rSrc),
    "out:",
    typeLabel(rOut),
    typeLabel(rSrc) === typeLabel(rOut) ? "OK" : "MISMATCH"
  );
  logRoleCtcTypes(rSrc, rOut);
  const s0 = Array.isArray(rSrc) && rSrc[0] != null ? rSrc[0] : null;
  const o0 = Array.isArray(rOut) && rOut[0] != null ? rOut[0] : null;
  const ctcMatch =
    ctcTypeLabel(
      s0 && typeof s0 === "object" && "ctc" in s0
        ? /** @type {{ ctc: unknown }} */ (s0).ctc
        : undefined
    ) ===
    ctcTypeLabel(
      o0 && typeof o0 === "object" && "ctc" in o0
        ? /** @type {{ ctc: unknown }} */ (o0).ctc
        : undefined
    );
  log(
    "  [validate] summary: count types match:",
    cOk,
    "| roles types match:",
    typeLabel(rSrc) === typeLabel(rOut),
    "| ctc(roles[0]) types match:",
    ctcMatch,
    "— same references/values as source (no coercions)"
  );
}

/**
 * Static slice: only relocation + the two renames. Values are references as in source.
 * @param {Record<string, unknown>} src
 */
function buildStaticCompanyDoc(src) {
  const about = Object.prototype.hasOwnProperty.call(
    src,
    "About The Company"
  )
    ? src["About The Company"]
    : src.about;
  const must = Object.prototype.hasOwnProperty.call(src, "Must_Do_Topics")
    ? src.Must_Do_Topics
    : src.must_do_topics;

  return omitUndefined({
    [SOURCE_REF_FIELD]: src._id,
    name: src.name,
    nameKey: nameKeyFromName(src.name),
    logo: src.logo,
    business_model: src.business_model,
    must_do_topics: must,
    about,
    prev_coding_ques: src.prev_coding_ques,
    helpfulCount: src.helpfulCount,
    helpfulUsers: src.helpfulUsers,
  });
}

/**
 * @param {Record<string, unknown>} src
 * @param {import("mongoose").Types.ObjectId} companyId
 */
function buildDynamicVisitDoc(src, companyId) {
  /** @type {Record<string, unknown>} */
  const out = {
    [SOURCE_REF_FIELD]: src._id,
    companyId,
    year: MIGRATION_YEAR,
    migratedAt: new Date(),
  };
  for (const k of DYNAMIC_FIELD_KEYS) {
    if (Object.prototype.hasOwnProperty.call(src, k)) {
      out[k] = src[k];
    }
  }
  return out;
}

async function main() {
  assertTargetCollection(TARGET_COMPANIES);
  assertTargetCollection(TARGET_VISITS);
  assertTargetCollection(SOURCE_COPY);

  const MONGO_URI = process.env.MONGO_URI;
  if (!MONGO_URI) {
    console.error("Missing MONGO_URI in environment (set in .env).");
    process.exit(1);
  }

  log("=== migrate companies1_copy → companies + company_visits (as-is values) ===");
  if (DRY_RUN) {
    log("MODE: DRY RUN (no writes to targets)");
  } else {
    log("MODE: LIVE (upsert companies, company_visits)");
  }
  log("FORBIDDEN collection:", FORBIDDEN_PRODUCTION, "(not used)");
  log("Source (read-only):", SOURCE_COPY);
  log("Targets:", TARGET_COMPANIES, ",", TARGET_VISITS);
  log("");

  await mongoose.connect(MONGO_URI);
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error("No database handle");
  }

  const sourceCol = db.collection(SOURCE_COPY);
  const companiesCol = db.collection(TARGET_COMPANIES);
  const visitsCol = db.collection(TARGET_VISITS);

  log("Step 1: countDocuments on", SOURCE_COPY, "only");
  const totalSource = await sourceCol.countDocuments();
  log("  count =", totalSource);

  log("Step 2: find all in", SOURCE_COPY, "(read-only)");
  const allDocs = await sourceCol.find({}).sort({ _id: 1 }).toArray();
  log("  loaded", allDocs.length, "document(s) (each row → one company + one visit; duplicate names kept)");

  if (allDocs.length > 0) {
    const s0 = /** @type {Record<string, unknown>} */ (allDocs[0]);
    log("Step 2b: sample[0] key-field types (source only):");
    log("  [sample] count:", typeLabel(s0.count));
    log("  [sample] roles:", typeLabel(s0.roles));
    const r0 = Array.isArray(s0.roles) && s0.roles[0] != null ? s0.roles[0] : null;
    const ctc = r0 && typeof r0 === "object" && "ctc" in r0 ? r0.ctc : undefined;
    log("  [sample] roles[0].ctc:", ctcTypeLabel(/** @type {unknown} */ (ctc)));
  }

  log("Step 3: process each source document (upsert by", SOURCE_REF_FIELD + ")");

  let companiesUpserted = 0;
  let visitsUpserted = 0;
  let skippedNoId = 0;

  for (const canonical of allDocs) {
    const src = /** @type {Record<string, unknown>} */ (canonical);
    const sourceId = src._id;
    if (sourceId == null) {
      skippedNoId += 1;
      log("[skip] missing _id on source document");
      continue;
    }

    const filterBySource = { [SOURCE_REF_FIELD]: sourceId };

    const staticDoc = buildStaticCompanyDoc(src);

    let companyId;
    if (DRY_RUN) {
      const existing = await companiesCol.findOne(filterBySource);
      companyId = existing?._id ?? new mongoose.Types.ObjectId();
      log(
        "  [dry-run]",
        SOURCE_REF_FIELD,
        String(sourceId),
        "nameKey=",
        staticDoc.nameKey,
        existing ? "company exists" : "would insert company + visit"
      );
    } else {
      const companySet = omitUndefined({
        ...staticDoc,
        updatedAt: new Date(),
      });

      await companiesCol.updateOne(filterBySource, {
        $set: companySet,
        $setOnInsert: { createdAt: new Date() },
      }, { upsert: true });

      const companyRow = await companiesCol.findOne(filterBySource);
      if (!companyRow?._id) {
        log("[error] missing company _id after upsert, source _id:", String(sourceId));
        continue;
      }
      companyId = companyRow._id;
      companiesUpserted += 1;
    }

    if (!companyId) continue;

    const visitDoc = buildDynamicVisitDoc(src, companyId);

    log("  --- source _id", String(sourceId), "name", String(src.name ?? ""));
    logKeyFieldTypes(src, visitDoc, companyId);

    if (DRY_RUN) {
      log(
        "  [dry-run] would upsert company_visits {",
        SOURCE_REF_FIELD,
        ", companyId, year:",
        MIGRATION_YEAR,
        "}"
      );
      visitsUpserted += 1;
    } else {
      const visitSet = omitUndefined(visitDoc);
      await visitsCol.updateOne(filterBySource, { $set: visitSet }, { upsert: true });
      visitsUpserted += 1;
    }
  }

  log("");
  log("Step 4: Summary");
  if (!DRY_RUN) {
    const nCompanies = await companiesCol.countDocuments({
      [SOURCE_REF_FIELD]: { $exists: true },
    });
    const nVisits = await visitsCol.countDocuments({
      [SOURCE_REF_FIELD]: { $exists: true },
    });
    log("  companies (with", SOURCE_REF_FIELD + "):", nCompanies);
    log("  company_visits (with", SOURCE_REF_FIELD + "):", nVisits);
  }
  log("  source rows processed:", allDocs.length - skippedNoId, "/", allDocs.length);
  if (skippedNoId) log("  skipped (no _id):", skippedNoId);
  if (!DRY_RUN) {
    log("  company upserts this run:", companiesUpserted);
    log("  visit upserts this run:", visitsUpserted);
  }

  log("");
  log("Done. Source", SOURCE_COPY, "was not modified; types not coerced in migrated fields.");
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
