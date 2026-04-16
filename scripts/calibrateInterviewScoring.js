import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { evaluateAnswer } from "../services/mcp/evaluateAnswer.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const cliArgs = process.argv.slice(2);
const liveMode = cliArgs.includes("--live");
const benchmarkArg = cliArgs.find((arg) => !arg.startsWith("--"));
const benchmarkPath =
  benchmarkArg || path.join(__dirname, "interviewScoringBenchmark.sample.json");

const toSafeString = (value, fallback = "") =>
  typeof value === "string" && value.trim() ? value.trim() : fallback;

const normalizeExpectedPoints = (points, expectedAnswerMode = "conceptual") =>
  (Array.isArray(points) ? points : [])
    .map((point) => {
      if (typeof point === "string") {
        return {
          text: point.trim(),
          category: "coverage",
          importance: "mustHave",
          expectedAnswerMode,
          embedding: [],
        };
      }
      return {
        text: toSafeString(point?.text),
        category: toSafeString(point?.category, "coverage"),
        importance: toSafeString(point?.importance, "mustHave"),
        expectedAnswerMode: toSafeString(point?.expectedAnswerMode, expectedAnswerMode),
        embedding: Array.isArray(point?.embedding) ? point.embedding : [],
      };
    })
    .filter((point) => point.text);

const loadBenchmark = async (targetPath) => {
  const raw = await fs.readFile(targetPath, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("Benchmark file must be a JSON array.");
  }
  return parsed;
};

const summarize = (rows) => {
  const byType = {};
  for (const row of rows) {
    const type = row.type || "general";
    byType[type] = byType[type] || {
      count: 0,
      absoluteErrorSum: 0,
      confidenceSum: 0,
    };
    byType[type].count += 1;
    byType[type].absoluteErrorSum += row.absoluteError;
    byType[type].confidenceSum += row.confidence;
  }

  return Object.fromEntries(
    Object.entries(byType).map(([type, metrics]) => [
      type,
      {
        samples: metrics.count,
        meanAbsoluteError: Number(
          (metrics.absoluteErrorSum / Math.max(1, metrics.count)).toFixed(2)
        ),
        meanConfidence: Number(
          (metrics.confidenceSum / Math.max(1, metrics.count)).toFixed(2)
        ),
      },
    ])
  );
};

async function main() {
  const benchmark = await loadBenchmark(benchmarkPath);
  if (!liveMode) {
    const benchmarkSummary = benchmark.map((sample) => ({
      id: sample.id || null,
      expectedAnswerMode: sample.expectedAnswerMode || null,
      targetScore: sample.targetScore ?? null,
      rubricPoints: Array.isArray(sample.expectedPoints) ? sample.expectedPoints.length : 0,
    }));

    console.log(
      JSON.stringify(
        {
          mode: "validate-only",
          benchmarkPath,
          samples: benchmark.length,
          summary: benchmarkSummary,
          nextStep:
            "Re-run with --live to execute the evaluator against this benchmark using your configured embedding and LLM providers.",
        },
        null,
        2
      )
    );
    return;
  }

  const results = [];

  for (const sample of benchmark) {
    const evaluation = await evaluateAnswer({
      answer: sample.answer,
      question: sample.question,
      companyContext: sample.companyContext || {},
      llmReasoning: "",
      expectedPoints: normalizeExpectedPoints(
        sample.expectedPoints,
        sample.expectedAnswerMode
      ),
    });

    const targetScore = Number(sample.targetScore);
    const absoluteError = Number.isFinite(targetScore)
      ? Math.abs(evaluation.score - targetScore)
      : null;

    results.push({
      id: sample.id || sample.question?.slice(0, 32) || `sample-${results.length + 1}`,
      type: evaluation.type,
      predictedScore: evaluation.score,
      targetScore,
      absoluteError,
      confidence: Number(evaluation.evaluationTrace?.confidence || 0),
      missingRubricPoints: evaluation.evaluationTrace?.missingRubricPoints || [],
    });
  }

  const usable = results.filter((row) => Number.isFinite(row.absoluteError));
  const overallMae = usable.length
    ? usable.reduce((sum, row) => sum + row.absoluteError, 0) / usable.length
    : null;

  console.log(
    JSON.stringify(
      {
        benchmarkPath,
        samples: results.length,
        overallMeanAbsoluteError:
          overallMae == null ? null : Number(overallMae.toFixed(2)),
        byType: summarize(usable),
        results,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("[calibrateInterviewScoring] failed:", error?.message || error);
  process.exitCode = 1;
});
