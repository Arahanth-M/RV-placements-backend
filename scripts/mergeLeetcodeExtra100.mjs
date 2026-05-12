/**
 * Merges scripts/data/leetcode-extra-parts/easy25.json + medium50.json + hard25.json
 * into scripts/data/dsa-interview-seeds-leetcode-extra-100.json (100 rows).
 *
 *   node scripts/mergeLeetcodeExtra100.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PARTS_DIR = path.join(__dirname, "data", "leetcode-extra-parts");
const OUT = path.join(__dirname, "data", "dsa-interview-seeds-leetcode-extra-100.json");

const ORDER = ["easy25.json", "medium50.json", "hard25.json"];

const all = [];
const seen = new Set();
for (const name of ORDER) {
  const fp = path.join(PARTS_DIR, name);
  if (!fs.existsSync(fp)) {
    console.error("missing part file:", fp);
    process.exit(1);
  }
  const chunk = JSON.parse(fs.readFileSync(fp, "utf8"));
  if (!Array.isArray(chunk)) throw new Error(`${name} must be a JSON array`);
  for (const row of chunk) {
    const id = row?.questionId;
    if (!id || seen.has(id)) throw new Error(`duplicate or bad questionId in ${name}: ${id}`);
    seen.add(id);
    all.push(row);
  }
}
if (all.length !== 100) {
  console.error(`expected 100 rows, got ${all.length}`);
  process.exit(1);
}
fs.writeFileSync(OUT, `${JSON.stringify(all, null, 2)}\n`);
console.log("wrote", path.relative(path.join(__dirname, ".."), OUT));
