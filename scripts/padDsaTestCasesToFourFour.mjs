/**
 * One-off / maintenance: pad code_execution interview seed rows to 4 visible + 4 hidden
 * by repeating existing visible/hidden patterns (same inputs/outputs, new rows).
 * Preserves correctness for passing solutions; run after editing seed JSON shape.
 *
 *   node scripts/padDsaTestCasesToFourFour.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, "data");

function cloneJson(v) {
  return JSON.parse(JSON.stringify(v));
}

function padFourFour(testCases) {
  if (!Array.isArray(testCases) || testCases.length === 0) {
    throw new Error("testCases must be a non-empty array");
  }
  const visible = testCases.filter((t) => t && t.isHidden !== true);
  const hidden = testCases.filter((t) => t && t.isHidden === true);
  if (visible.length === 0 || hidden.length === 0) {
    throw new Error("need at least one visible and one hidden testcase to pad from");
  }
  const take = (arr, n) => {
    const out = [];
    for (let i = 0; i < n; i += 1) {
      const base = arr[i % arr.length];
      out.push({
        input: cloneJson(base.input),
        expectedOutput: cloneJson(base.expectedOutput),
        isHidden: base.isHidden,
        weight: base.weight ?? 1,
      });
    }
    return out;
  };
  const v4 = take(visible, 4).map((t) => ({ ...t, isHidden: false }));
  const h4 = take(hidden, 4).map((t) => ({ ...t, isHidden: true }));
  return [...v4, ...h4];
}

const files = [
  path.join(DATA, "dsa-interview-seeds.json"),
  ...[1, 2, 3, 4, 5].map((n) => path.join(DATA, "striver-sde-sheet", `bulk-part-0${n}.json`)),
];

for (const filePath of files) {
  const raw = fs.readFileSync(filePath, "utf8");
  const arr = JSON.parse(raw);
  if (!Array.isArray(arr)) throw new Error(`Expected array: ${filePath}`);
  for (const q of arr) {
    if (q?.evaluationStrategy === "code_execution" && Array.isArray(q.testCases)) {
      q.testCases = padFourFour(q.testCases);
    }
  }
  fs.writeFileSync(filePath, `${JSON.stringify(arr, null, 2)}\n`);
  console.log("padded", path.relative(DATA, filePath));
}
console.log("done");
