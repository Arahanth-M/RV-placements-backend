/**
 * One-off: upsert InterviewQuestion dsa_my_problem_v2 (LCS +1 insertion counting).
 * Only writes collection `interviewquestions`.
 *
 * Usage: cd RV-placements-backend && node scripts/insertDsaMyProblemV2.js
 */
import dotenv from "dotenv";
import mongoose from "mongoose";

import { connectDB } from "../config/db.js";
import { config } from "../config/constants.js";
import InterviewQuestion from "../models/InterviewQuestion.js";

dotenv.config();

const DOC = {
  questionId: "dsa_my_problem_v2",
  title: "LCSR: count single-rune insertions that increase LCS by 1",
  question: `In a faraway land, there exists a magical library that contains two ancient scrolls — Scroll A and Scroll B. These scrolls are written in mystical runes, and their true power can only be unlocked when the Longest Common **Subsequence** of Runes (LCSR) between the two scrolls reaches its maximum potential.

The wise librarian, Elarion, has discovered that by carefully inserting **exactly one** rune anywhere into Scroll A (before the first rune, between two runes, or after the last rune), the LCSR between the modified Scroll A and Scroll B can be increased by **exactly 1** compared to the LCSR of the original A and B.

Count **all ordered pairs** (insertion position, rune letter) with position in \\{0, 1, …, |A|\\} (meaning before A[0], between A[0] and A[1], …, after A[|A|-1]) and rune in \\{a, …, z\\}, such that after inserting that rune at that position, the LCSR of the new A with B equals LCSR(A, B) + 1.

**Input:** two lines — string A, then string B (lowercase English letters).

**Output:** the number of valid (position, letter) insertions (as a single integer).

**Constraints:** 1 ≤ |A|, |B| ≤ 1000.

Implement: \`count_lcsr_insertion_ways(a, b)\` where \`a\` and \`b\` are the two strings.`,
  url: "",
  companyTags: ["PhonePe"],
  roundType: "DSA",
  difficulty: "medium",
  topics: ["Dynamic programming", "Strings", "Longest common subsequence"],
  subtopics: ["Prefix–suffix DP", "Case analysis"],
  evaluationStrategy: "code_execution",
  dsaMetadata: {
    supportedLanguages: ["javascript", "python", "java", "cpp"],
    functionSignature: "def count_lcsr_insertion_ways(a, b):",
    starterCode: {
      python: "def count_lcsr_insertion_ways(a, b):\n    pass\n",
      javascript:
        "function count_lcsr_insertion_ways(a, b) {\n}\nmodule.exports = count_lcsr_insertion_ways;",
      java: `class Solution {
    public long countLcsrInsertionWays(String a, String b) {
        return 0L;
    }
}
`,
      cpp: `#include <string>

long long count_lcsr_insertion_ways(const std::string& a, const std::string& b) {
    return 0;
}
`,
    },
  },
  testCases: [
    { input: { a: "a", b: "b" }, expectedOutput: 2, isHidden: false, weight: 1 },
    { input: { a: "a", b: "aa" }, expectedOutput: 2, isHidden: false, weight: 1 },
    { input: { a: "ab", b: "ba" }, expectedOutput: 2, isHidden: false, weight: 1 },
    { input: { a: "abc", b: "abc" }, expectedOutput: 0, isHidden: false, weight: 1 },
    { input: { a: "axy", b: "xay" }, expectedOutput: 2, isHidden: true, weight: 1 },
    { input: { a: "abcd", b: "abxd" }, expectedOutput: 2, isHidden: true, weight: 1 },
    { input: { a: "z", b: "zzz" }, expectedOutput: 2, isHidden: true, weight: 1 },
    { input: { a: "abac", b: "cac" }, expectedOutput: 3, isHidden: true, weight: 1 },
  ],
  rubric: [
    {
      text: "Computes LCS length of A and B with classic O(|A||B|) DP.",
      category: "algorithmChoice",
      importance: "mustHave",
      expectedAnswerMode: "code",
    },
    {
      text: "Uses suffix (or reverse) LCS DP so an inserted match can be split as prefix + 1 + suffix.",
      category: "algorithmChoice",
      importance: "mustHave",
      expectedAnswerMode: "code",
    },
    {
      text: "For each insertion index and letter, checks whether the best alignment through a matching position in B yields LCS+1 exactly (not more).",
      category: "correctness",
      importance: "mustHave",
      expectedAnswerMode: "code",
    },
    {
      text: "Keeps complexity reasonable (e.g. O(26 · |A| · |B|) or better with pruning).",
      category: "complexityAwareness",
      importance: "goodToHave",
      expectedAnswerMode: "code",
    },
  ],
  complexity: { time: "O(|A| · |B|) for LCS tables plus O(26 · (|A|+1) · |B|) for counting", space: "O(|A| · |B|)" },
  sqlMetadata: {},
  systemDesignMetadata: { requiredConcepts: [] },
  hrMetadata: { behavioralSignals: [] },
  analytics: { timesUsed: 0, successRate: 0, averageScore: 0, averageCompletionTime: 0 },
  sourceMetadata: { source: "curated", verified: false, qualityScore: 0.78 },
};

async function main() {
  await connectDB(config.MONGO_URI);
  const qid = DOC.questionId;
  const existing = await InterviewQuestion.findOne({ questionId: qid }).lean();
  if (existing) {
    await InterviewQuestion.replaceOne({ questionId: qid }, DOC, { runValidators: true });
    console.log(`Replaced interview question ${qid}`);
  } else {
    await InterviewQuestion.create(DOC);
    console.log(`Inserted interview question ${qid}`);
  }
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
