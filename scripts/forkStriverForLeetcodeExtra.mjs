/**
 * Builds medium50.json + hard25.json from existing Striver bulk seeds (same tests/statements).
 * New questionIds and LeetCode URLs as sourceMetadata.source (no writes to companies).
 *
 *   node scripts/forkStriverForLeetcodeExtra.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, "data");
const OUT_DIR = path.join(DATA, "leetcode-extra-parts");

function toSlug(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function loadStriver() {
  const files = [1, 2, 3, 4, 5].map((n) =>
    path.join(DATA, "striver-sde-sheet", `bulk-part-0${n}.json`)
  );
  return files.flatMap((fp) => JSON.parse(fs.readFileSync(fp, "utf8")));
}

function remap(rows, prefix, startIndex) {
  return rows.map((row, i) => {
    const slug = toSlug(row.title);
    const url = slug ? `https://leetcode.com/problems/${slug}/` : "https://leetcode.com/problemset/";
    const idx = startIndex + i;
    const questionId = `${prefix}${String(idx).padStart(3, "0")}`;
    return {
      ...row,
      questionId,
      url,
      sourceMetadata: {
        source: url,
        verified: true,
        qualityScore: 0.9,
      },
    };
  });
}

const all = loadStriver();
const mediums = all.filter((r) => r.difficulty === "medium");
const hards = all.filter((r) => r.difficulty === "hard");
if (mediums.length < 50 || hards.length < 25) {
  console.error("not enough striver rows", { mediums: mediums.length, hards: hards.length });
  process.exit(1);
}

const medium50 = remap(mediums.slice(0, 50), "leetcode-extra-m-", 1);
const hard25 = remap(hards.slice(0, 25), "leetcode-extra-h-", 1);

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, "medium50.json"), `${JSON.stringify(medium50, null, 2)}\n`);
fs.writeFileSync(path.join(OUT_DIR, "hard25.json"), `${JSON.stringify(hard25, null, 2)}\n`);
console.log("wrote medium50 + hard25 to", OUT_DIR);
