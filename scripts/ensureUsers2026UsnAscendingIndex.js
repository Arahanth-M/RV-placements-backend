/**
 * Ensures users_2026 reads in ascending USN order are indexed (use .sort({ USN: 1 }) in queries).
 *
 * MongoDB does not keep a physical “sorted row order” forever; USN order is defined by
 * sorting at read time. This index makes that fast. Does not change or delete documents.
 */
import path from "path";
import { fileURLToPath } from "url";

const log = (msg) => process.stderr.write(`${msg}\n`);

log("ensureUsers2026UsnAscendingIndex.js — boot");

const [{ MongoClient }, dotenv] = await Promise.all([import("mongodb"), import("dotenv")]);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.default.config({ path: path.join(__dirname, "..", ".env") });

function mongoHostHint(uri) {
  if (!uri || typeof uri !== "string") return "(missing)";
  try {
    const noQuery = uri.split("?")[0];
    const at = noQuery.indexOf("@");
    const hostPart = at >= 0 ? noQuery.slice(at + 1) : noQuery.replace(/^mongodb(\+srv)?:\/\//, "");
    return hostPart.split("/")[0] || "(unparsed)";
  } catch {
    return "(unparsed)";
  }
}

const MONGO_URI = process.env.MONGO_URI?.trim();
if (!MONGO_URI) {
  log(
    "ERROR: MONGO_URI not found. Expected RV-placements-backend/.env (parent of scripts/)."
  );
  process.exit(1);
}

log(`Connecting to: ${mongoHostHint(MONGO_URI)} (15s server selection timeout)...`);

const client = new MongoClient(MONGO_URI, {
  serverSelectionTimeoutMS: 15_000,
  connectTimeoutMS: 15_000,
  socketTimeoutMS: 45_000,
});

let exitCode = 0;
try {
  await client.connect();
  log("Connected.");

  const col = client.db().collection("users_2026");
  const total = await col.countDocuments({});
  log(`users_2026 document count: ${total}`);

  const indexName = await col.createIndex({ USN: 1 }, { name: "USN_asc_1" });
  log(`Index ensured: ${indexName}`);

  const sample = await col
    .find({ USN: { $exists: true, $nin: [null, ""] } })
    .sort({ USN: 1 })
    .limit(5)
    .project({ USN: 1, Name: 1 })
    .toArray();

  log("First 5 by ascending USN (read-only sample):");
  sample.forEach((d) => log(`  ${d.USN} — ${d.Name ?? ""}`));
  log("\nAlways query with .sort({ USN: 1 }) for full ascending USN order.");
} catch (e) {
  log(`Error: ${e.message || e}`);
  if (
    String(e.message || "").includes("timed out") ||
    e?.name === "MongoServerSelectionError"
  ) {
    log(
      "\nCould not reach MongoDB in 15s. Check: cluster is running, MONGO_URI in .env, network/VPN," +
        " Atlas → Network Access → IP allowlist (use 0.0.0.0/0 only if you accept that risk)."
    );
  }
  exitCode = 1;
} finally {
  await client.close().catch(() => {});
}

process.exit(exitCode);
