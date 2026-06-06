/**
 * Temporary isolated admin tool — safe to delete entire folder when done.
 * Run from RV-placements-backend/: node tools/interview-questions-admin/server.js
 */
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ENV_PATH = path.resolve(__dirname, "../../.env");

// Load .env exactly like the main backend (override so shell env cannot block MONGO_URI)
const dotenvResult = require("dotenv").config({ path: ENV_PATH, override: true });
if (dotenvResult.error) {
  console.warn("[iq-admin] dotenv warning:", dotenvResult.error.message);
} else {
  const keyCount = Object.keys(dotenvResult.parsed || {}).length;
  console.log(`[iq-admin] Loaded .env (${keyCount} keys) from ${ENV_PATH}`);
}

const PORT = Number(process.env.IQ_ADMIN_PORT || 7777);
const DEFAULT_COLLECTION = "interviewquestions";
const PUBLIC_DIR = path.join(__dirname, "public");

console.log("[iq-admin] Starting Interview Questions Admin…");
console.log(`[iq-admin] Port: ${PORT}`);

let db = null;
let dbReady = false;
let dbError = null;
let mongoClient = null;
let ObjectId = null;
let activeCollection = DEFAULT_COLLECTION;
let dbName = "";
let mongoUriUsed = "";

const getMongoUri = () => {
  const uri = process.env.MONGO_URI?.trim() || process.env.MONGODB_URI?.trim();
  if (!uri) {
    throw new Error(
      `MONGO_URI not found after loading ${ENV_PATH}. Add MONGO_URI to RV-placements-backend/.env`
    );
  }
  return uri;
};

const maskUri = (uri) => uri.replace(/\/\/([^:@/]+):([^@/]+)@/, "//***:***@");

const coll = () => db.collection(activeCollection);

const serializeDoc = (doc) => {
  if (!doc) return doc;
  const out = { ...doc };
  if (out._id?.toString) out._id = out._id.toString();
  return out;
};

const serializeDocs = (docs) => (Array.isArray(docs) ? docs.map(serializeDoc) : []);

const json = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve(null);
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });

const serveStatic = (res, filePath, contentType) => {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      json(res, 404, { success: false, message: "Not found" });
      return;
    }
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
};

const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };

const requireDb = (res) => {
  if (dbReady) return true;
  json(res, 503, {
    success: false,
    message: dbError || "Database still connecting — wait a few seconds and refresh",
  });
  return false;
};

const parseQuery = (url) => {
  const q = {};
  for (const [k, v] of url.searchParams) q[k] = v;
  return q;
};

async function connectMongo() {
  console.log("[iq-admin] Loading mongodb driver…");
  try {
    if (!process.env.MONGO_URI?.trim()) {
      throw new Error(`MONGO_URI missing in ${ENV_PATH}`);
    }

    mongoUriUsed = getMongoUri();
    console.log("[iq-admin] Mongo URI:", maskUri(mongoUriUsed));
    if (/127\.0\.0\.1|localhost/.test(mongoUriUsed)) {
      console.warn("[iq-admin] WARNING: using local MongoDB URI — if questions are on Atlas, check .env MONGO_URI");
    }

    const mongodb = await import("mongodb");
    ObjectId = mongodb.ObjectId;
    mongoClient = new mongodb.MongoClient(mongoUriUsed, {
      serverSelectionTimeoutMS: 15_000,
      connectTimeoutMS: 15_000,
    });
    console.log("[iq-admin] Connecting to MongoDB…");
    await mongoClient.connect();
    db = mongoClient.db();
    dbName = db.databaseName;

    activeCollection = DEFAULT_COLLECTION;
    let count = await coll().countDocuments();

    if (count === 0) {
      const names = (await db.listCollections().toArray()).map((c) => c.name);
      for (const name of names) {
        if (!/interviewquestion/i.test(name)) continue;
        const n = await db.collection(name).countDocuments();
        console.log(`[iq-admin]   found collection "${name}": ${n} docs`);
        if (n > 0) {
          activeCollection = name;
          count = n;
          break;
        }
      }
    }

    dbReady = true;
    console.log(`[iq-admin] MongoDB connected ✓ db=${dbName} collection=${activeCollection} docs=${count}`);
    if (count === 0) {
      console.warn(
        "[iq-admin] WARNING: 0 interview questions found. Check MONGO_URI in .env matches your main backend."
      );
    }
  } catch (err) {
    dbError = err.message || String(err);
    console.error("[iq-admin] MongoDB failed:", dbError);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  try {
    if (req.method === "GET" && !pathname.startsWith("/api/")) {
      const rel = pathname === "/" ? "/index.html" : pathname;
      const filePath = path.join(PUBLIC_DIR, rel);
      if (!filePath.startsWith(PUBLIC_DIR)) {
        json(res, 403, { success: false, message: "Forbidden" });
        return;
      }
      serveStatic(res, filePath, MIME[path.extname(filePath)] || "text/html");
      return;
    }

    if (pathname === "/api/health" && req.method === "GET") {
      let docCount = null;
      if (dbReady) {
        try {
          docCount = await coll().countDocuments();
        } catch {
          docCount = null;
        }
      }
      json(res, 200, {
        success: true,
        dbConnected: dbReady,
        dbError,
        port: PORT,
        dbName,
        collection: activeCollection,
        docCount,
        mongoUri: mongoUriUsed ? maskUri(mongoUriUsed) : null,
      });
      return;
    }

    if (pathname === "/api/meta/enums" && req.method === "GET") {
      json(res, 200, {
        roundTypes: ["DSA", "SQL", "System Design", "HR", "CS Fundamentals"],
        difficulties: ["easy", "medium", "hard"],
        evaluationStrategies: ["code_execution", "sql_execution", "rubric_llm", "behavioral_llm"],
        languages: ["python", "cpp", "java"],
      });
      return;
    }

    if (pathname === "/api/questions" && req.method === "GET") {
      if (!requireDb(res)) return;
      const q = parseQuery(url);
      const filter = {};
      if (q.roundType) filter.roundType = q.roundType;
      if (q.evaluationStrategy) filter.evaluationStrategy = q.evaluationStrategy;
      if (q.search) {
        const re = new RegExp(q.search, "i");
        filter.$or = [{ title: re }, { questionId: re }, { question: re }];
      }
      const questions = await coll().find(filter).sort({ roundType: 1, questionId: 1 }).toArray();
      json(res, 200, { success: true, count: questions.length, questions: serializeDocs(questions) });
      return;
    }

    if (pathname === "/api/questions" && req.method === "POST") {
      if (!requireDb(res)) return;
      const body = await readBody(req);
      const now = new Date();
      const doc = { ...body, createdAt: now, updatedAt: now };
      delete doc._id;
      const result = await coll().insertOne(doc);
      const question = await coll().findOne({ _id: result.insertedId });
      json(res, 201, { success: true, question: serializeDoc(question) });
      return;
    }

    const questionMatch = pathname.match(/^\/api\/questions\/([a-f0-9]{24})$/i);
    if (questionMatch) {
      const id = questionMatch[1];

      if (req.method === "GET") {
        if (!requireDb(res)) return;
        const question = await coll().findOne({ _id: new ObjectId(id) });
        if (!question) return json(res, 404, { success: false, message: "Not found" });
        json(res, 200, { success: true, question: serializeDoc(question) });
        return;
      }

      if (req.method === "PUT") {
        if (!requireDb(res)) return;
        const body = await readBody(req);
        const { _id, __v, createdAt, ...payload } = body || {};
        payload.updatedAt = new Date();
        const result = await coll().findOneAndUpdate(
          { _id: new ObjectId(id) },
          { $set: payload },
          { returnDocument: "after" }
        );
        if (!result) return json(res, 404, { success: false, message: "Not found" });
        json(res, 200, { success: true, question: serializeDoc(result) });
        return;
      }

      if (req.method === "DELETE") {
        if (!requireDb(res)) return;
        const result = await coll().deleteOne({ _id: new ObjectId(id) });
        if (result.deletedCount === 0) return json(res, 404, { success: false, message: "Not found" });
        json(res, 200, { success: true, deletedId: id });
        return;
      }
    }

    const runTestsMatch = pathname.match(/^\/api\/questions\/([a-f0-9]{24})\/run-tests$/i);
    if (runTestsMatch && req.method === "POST") {
      if (!requireDb(res)) return;
      const id = runTestsMatch[1];
      const doc = await coll().findOne({ _id: new ObjectId(id) });
      if (!doc) return json(res, 404, { success: false, message: "Not found" });

      const body = await readBody(req);
      const { code, language, testCases: bodyTestCases, functionSignature } = body || {};
      if (!code?.trim()) return json(res, 400, { success: false, message: "code is required" });

      console.log("[iq-admin] Loading executeCode…");
      const { executeCode, normalizeExecutionLanguage, getTestCaseRunCounts } = await import(
        "../../services/codeExecution/executeCode.js"
      );

      const lang = normalizeExecutionLanguage(
        language || doc.dsaMetadata?.supportedLanguages?.[0] || "python"
      );
      let testCases = Array.isArray(bodyTestCases) ? bodyTestCases : Array.isArray(doc.testCases) ? doc.testCases : [];
      const testCaseCounts = getTestCaseRunCounts(testCases, { skipDedupe: true });
      const adminTimeoutMs =
        Number(process.env.IQ_ADMIN_EXECUTION_TIMEOUT_MS) > 0
          ? Number(process.env.IQ_ADMIN_EXECUTION_TIMEOUT_MS)
          : 180000;

      if (testCaseCounts.submitted === 0) {
        return json(res, 400, { success: false, message: "No test cases — add some in the Test Cases tab" });
      }

      const sig =
        typeof functionSignature === "string"
          ? functionSignature
          : doc.dsaMetadata?.functionSignature || "";

      console.log("[iq-admin] run-tests counts", {
        ...testCaseCounts,
        adminTimeoutMs,
      });

      let result = await executeCode({
        language: lang,
        code,
        testCases,
        functionSignature: sig,
        jobId: `iq-admin-${doc.questionId}-${Date.now()}`,
        skipTestCaseDedupe: true,
        executionTimeoutMs: adminTimeoutMs,
      });

      if (
        result?.status === "EXECUTION_ERROR" &&
        !result.error &&
        (!Array.isArray(result.results) || result.results.length === 0)
      ) {
        result = {
          ...result,
          error:
            "Execution failed before any test ran. Common causes: Docker is not running, wrong language selected, or missing dsaMetadata.functionSignature. Start Docker Desktop and try again.",
        };
      }

      json(res, 200, {
        success: true,
        language: lang,
        testCaseCountExecuted: testCaseCounts.submitted,
        testCaseCounts,
        resultCount: Array.isArray(result.results) ? result.results.length : 0,
        runnerTotalCount: result.totalCount ?? null,
        executionTimeoutMs: adminTimeoutMs,
        functionSignature: sig,
        result,
      });
      return;
    }

    json(res, 404, { success: false, message: "Not found" });
  } catch (err) {
    console.error("[iq-admin] request error:", err.message);
    json(res, 500, { success: false, message: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`[iq-admin] Ready → http://localhost:${PORT}`);
  connectMongo();
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[iq-admin] Port ${PORT} is already in use.`);
    console.error("[iq-admin] Kill the old process (Ctrl+C in that terminal) or run:");
    console.error(`  IQ_ADMIN_PORT=7788 node tools/interview-questions-admin/server.js`);
    process.exit(1);
  }
  throw err;
});

process.on("SIGINT", async () => {
  if (mongoClient) await mongoClient.close().catch(() => {});
  process.exit(0);
});
