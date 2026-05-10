import dotenv from "dotenv";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { config } from "../config/constants.js";
import InterviewQuestion from "../models/InterviewQuestion.js";

dotenv.config();

const curatedQuestions = [
  // -----------------------------
  // DSA (5)
  // -----------------------------
  {
    questionId: "dsa_two_sum_hashmap_v1",
    title: "Two Sum",
    question:
      "Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target. Assume exactly one valid answer exists and you may not use the same element twice.",
    companyTags: ["Amazon", "Google"],
    roundType: "DSA",
    difficulty: "easy",
    topics: ["Arrays", "Hashing"],
    subtopics: ["HashMap lookup", "Index tracking"],
    evaluationStrategy: "code_execution",
    dsaMetadata: {
      supportedLanguages: ["javascript", "python", "java", "cpp"],
      starterCode: {
        javascript:
          "function twoSum(nums, target) {\n  // TODO: return [i, j]\n}\nmodule.exports = twoSum;",
      },
      functionSignature: "twoSum(nums: number[], target: number) => number[]",
    },
    testCases: [
      { input: { nums: [2, 7, 11, 15], target: 9 }, expectedOutput: [0, 1], isHidden: false, weight: 1 },
      { input: { nums: [3, 2, 4], target: 6 }, expectedOutput: [1, 2], isHidden: false, weight: 1 },
      { input: { nums: [3, 3], target: 6 }, expectedOutput: [0, 1], isHidden: true, weight: 2 },
    ],
    rubric: [
      { text: "Uses hash map for O(n) lookup", category: "algorithmChoice", importance: "mustHave", expectedAnswerMode: "code" },
      { text: "Avoids using same element twice", category: "correctness", importance: "mustHave", expectedAnswerMode: "code" },
      { text: "Explains time and space complexity", category: "complexityAwareness", importance: "goodToHave", expectedAnswerMode: "code" },
    ],
    complexity: { time: "O(n)", space: "O(n)" },
    systemDesignMetadata: { requiredConcepts: [] },
    hrMetadata: { behavioralSignals: [] },
    analytics: { timesUsed: 0, successRate: 0, averageScore: 0, averageCompletionTime: 0 },
    sourceMetadata: { source: "curated", verified: true, qualityScore: 0.92 },
  },
  {
    questionId: "dsa_longest_substring_no_repeat_v1",
    title: "Longest Substring Without Repeating Characters",
    question:
      "Given a string s, find the length of the longest substring without repeating characters.",
    companyTags: ["Amazon", "Microsoft"],
    roundType: "DSA",
    difficulty: "medium",
    topics: ["Strings", "Sliding Window"],
    subtopics: ["Two pointers", "Frequency map"],
    evaluationStrategy: "code_execution",
    dsaMetadata: {
      supportedLanguages: ["javascript", "python", "java", "cpp"],
      starterCode:
        "function lengthOfLongestSubstring(s) {\n  // TODO\n}\nmodule.exports = lengthOfLongestSubstring;",
      functionSignature: "lengthOfLongestSubstring(s: string) => number",
    },
    testCases: [
      { input: { s: "abcabcbb" }, expectedOutput: 3, isHidden: false, weight: 1 },
      { input: { s: "bbbbb" }, expectedOutput: 1, isHidden: false, weight: 1 },
      { input: { s: "pwwkew" }, expectedOutput: 3, isHidden: true, weight: 2 },
    ],
    rubric: [
      { text: "Maintains valid sliding window with unique chars", category: "algorithmChoice", importance: "mustHave", expectedAnswerMode: "code" },
      { text: "Updates window efficiently on duplicates", category: "implementationQuality", importance: "mustHave", expectedAnswerMode: "code" },
      { text: "Mentions O(n) traversal", category: "complexityAwareness", importance: "goodToHave", expectedAnswerMode: "code" },
    ],
    complexity: { time: "O(n)", space: "O(min(n, charset))" },
    sourceMetadata: { source: "curated", verified: true, qualityScore: 0.9 },
  },
  {
    questionId: "dsa_merge_intervals_v1",
    title: "Merge Intervals",
    question:
      "Given an array of intervals where intervals[i] = [start, end], merge all overlapping intervals and return a list of non-overlapping intervals covering all intervals.",
    companyTags: ["Google", "Microsoft"],
    roundType: "DSA",
    difficulty: "medium",
    topics: ["Intervals", "Sorting"],
    subtopics: ["Greedy merge", "Boundary handling"],
    evaluationStrategy: "code_execution",
    dsaMetadata: {
      supportedLanguages: ["javascript", "python", "java", "cpp"],
      starterCode:
        "function merge(intervals) {\n  // TODO\n}\nmodule.exports = merge;",
      functionSignature: "merge(intervals: number[][]) => number[][]",
    },
    testCases: [
      { input: { intervals: [[1, 3], [2, 6], [8, 10], [15, 18]] }, expectedOutput: [[1, 6], [8, 10], [15, 18]], isHidden: false, weight: 1 },
      { input: { intervals: [[1, 4], [4, 5]] }, expectedOutput: [[1, 5]], isHidden: false, weight: 1 },
      { input: { intervals: [[1, 4], [0, 2], [3, 5]] }, expectedOutput: [[0, 5]], isHidden: true, weight: 2 },
    ],
    rubric: [
      { text: "Sorts intervals before merging", category: "algorithmChoice", importance: "mustHave", expectedAnswerMode: "code" },
      { text: "Correctly merges touching overlaps", category: "edgeCases", importance: "mustHave", expectedAnswerMode: "code" },
      { text: "Avoids unnecessary extra passes", category: "implementationQuality", importance: "goodToHave", expectedAnswerMode: "code" },
    ],
    complexity: { time: "O(n log n)", space: "O(n)" },
    sourceMetadata: { source: "curated", verified: true, qualityScore: 0.89 },
  },
  {
    questionId: "dsa_lru_cache_v1",
    title: "LRU Cache",
    question:
      "Design a data structure that follows LRU (Least Recently Used) cache policy with O(1) get and put operations.",
    companyTags: ["Amazon", "Google", "Microsoft"],
    roundType: "DSA",
    difficulty: "hard",
    topics: ["Design", "Hashing", "Linked List"],
    subtopics: ["Doubly linked list", "Eviction policy"],
    evaluationStrategy: "code_execution",
    dsaMetadata: {
      supportedLanguages: ["javascript", "python", "java", "cpp"],
      starterCode:
        "class LRUCache {\n  constructor(capacity) {}\n  get(key) {}\n  put(key, value) {}\n}\nmodule.exports = LRUCache;",
      functionSignature: "class LRUCache { get(key): number; put(key, value): void }",
    },
    testCases: [
      {
        input: {
          capacity: 2,
          operations: [["put", 1, 1], ["put", 2, 2], ["get", 1], ["put", 3, 3], ["get", 2], ["put", 4, 4], ["get", 1], ["get", 3], ["get", 4]],
        },
        expectedOutput: [null, null, 1, null, -1, null, -1, 3, 4],
        isHidden: false,
        weight: 1,
      },
      {
        input: {
          capacity: 1,
          operations: [["put", 2, 1], ["get", 2], ["put", 3, 2], ["get", 2], ["get", 3]],
        },
        expectedOutput: [null, 1, null, -1, 2],
        isHidden: true,
        weight: 2,
      },
    ],
    rubric: [
      { text: "Combines hash map with doubly linked list", category: "architectureCoverage", importance: "mustHave", expectedAnswerMode: "code" },
      { text: "Maintains O(1) get and put", category: "complexityAwareness", importance: "mustHave", expectedAnswerMode: "code" },
      { text: "Correctly updates recency on reads and writes", category: "correctness", importance: "mustHave", expectedAnswerMode: "code" },
    ],
    complexity: { time: "O(1) per operation", space: "O(capacity)" },
    sourceMetadata: { source: "curated", verified: true, qualityScore: 0.95 },
  },
  {
    questionId: "dsa_kth_largest_quickselect_v1",
    title: "Kth Largest Element in an Array",
    question:
      "Given an integer array nums and an integer k, return the kth largest element in the array. Solve this without fully sorting the array.",
    companyTags: ["Goldman Sachs", "Amazon"],
    roundType: "DSA",
    difficulty: "medium",
    topics: ["Arrays", "Heap", "Quickselect"],
    subtopics: ["Partitioning", "Selection algorithms"],
    evaluationStrategy: "code_execution",
    dsaMetadata: {
      supportedLanguages: ["javascript", "python", "java", "cpp"],
      starterCode:
        "function findKthLargest(nums, k) {\n  // TODO\n}\nmodule.exports = findKthLargest;",
      functionSignature: "findKthLargest(nums: number[], k: number) => number",
    },
    testCases: [
      { input: { nums: [3, 2, 1, 5, 6, 4], k: 2 }, expectedOutput: 5, isHidden: false, weight: 1 },
      { input: { nums: [3, 2, 3, 1, 2, 4, 5, 5, 6], k: 4 }, expectedOutput: 4, isHidden: false, weight: 1 },
      { input: { nums: [1], k: 1 }, expectedOutput: 1, isHidden: true, weight: 2 },
    ],
    rubric: [
      { text: "Avoids full sort as primary approach", category: "algorithmChoice", importance: "mustHave", expectedAnswerMode: "code" },
      { text: "Correctly handles duplicates", category: "edgeCases", importance: "mustHave", expectedAnswerMode: "code" },
      { text: "Explains average complexity trade-offs", category: "complexityAwareness", importance: "goodToHave", expectedAnswerMode: "code" },
    ],
    complexity: { time: "O(n) average", space: "O(1) extra (iterative quickselect)" },
    sourceMetadata: { source: "curated", verified: true, qualityScore: 0.88 },
  },

  // -----------------------------
  // SQL (3)
  // -----------------------------
  {
    questionId: "sql_top_customers_spend_v1",
    title: "Top Customers by Spend",
    question:
      "Given tables customers(customer_id, name) and orders(order_id, customer_id, amount, order_date), return top 3 customers by total spend in 2025.",
    companyTags: ["Amazon", "Goldman Sachs"],
    roundType: "SQL",
    difficulty: "medium",
    topics: ["Aggregation", "GROUP BY", "Sorting"],
    subtopics: ["SUM", "Date filtering", "LIMIT"],
    evaluationStrategy: "rubric_llm",
    testCases: [
      {
        input: "Return customer_id, name, total_spend for top 3 customers in 2025.",
        expectedOutput: "Exactly 3 rows sorted by total_spend DESC.",
        isHidden: false,
        weight: 1,
      },
      {
        input: "Handle ties deterministically by customer_id ASC after spend DESC.",
        expectedOutput: "Stable deterministic ordering.",
        isHidden: true,
        weight: 2,
      },
    ],
    rubric: [
      { text: "Filters by target year correctly", category: "correctness", importance: "mustHave", expectedAnswerMode: "conceptual" },
      { text: "Uses aggregation by customer", category: "queryDesign", importance: "mustHave", expectedAnswerMode: "conceptual" },
      { text: "Describes sorted top N result shape", category: "implementationQuality", importance: "mustHave", expectedAnswerMode: "conceptual" },
    ],
    complexity: { time: "Depends on indexing and table size", space: "Query engine dependent" },
    sqlMetadata: {
      databaseSchema:
        'CREATE TABLE IF NOT EXISTS "customers" (customer_id INTEGER PRIMARY KEY, name TEXT);\nCREATE TABLE IF NOT EXISTS "orders" (order_id INTEGER PRIMARY KEY, customer_id INTEGER, amount REAL, order_date TEXT);',
      seedData: {
        customers: [
          { customer_id: 1, name: "Alice" },
          { customer_id: 2, name: "Bob" },
          { customer_id: 3, name: "Cara" },
        ],
        orders: [
          { order_id: 101, customer_id: 1, amount: 3000, order_date: "2025-01-02" },
          { order_id: 102, customer_id: 2, amount: 4200, order_date: "2025-03-12" },
          { order_id: 103, customer_id: 3, amount: 3900, order_date: "2025-04-20" },
        ],
      },
      expectedResult: [
        { customer_id: 2, name: "Bob", total_spend: 4200 },
        { customer_id: 3, name: "Cara", total_spend: 3900 },
        { customer_id: 1, name: "Alice", total_spend: 3000 },
      ],
      validationRules: ["Must use SUM(amount)", "Must group by customer", "Must limit to 3 rows"],
    },
    sourceMetadata: { source: "curated", verified: true, qualityScore: 0.9 },
  },
  {
    questionId: "sql_second_highest_salary_v1",
    title: "Second Highest Salary",
    question:
      "Given employees(id, name, salary), write a query to return the second highest distinct salary. Return null if not present.",
    companyTags: ["Google", "Microsoft"],
    roundType: "SQL",
    difficulty: "easy",
    topics: ["Ranking", "Subqueries"],
    subtopics: ["DISTINCT", "ORDER BY", "LIMIT/OFFSET"],
    evaluationStrategy: "rubric_llm",
    testCases: [
      {
        input: "Should return one value named second_highest_salary.",
        expectedOutput: "Single row with second highest distinct salary.",
        isHidden: false,
        weight: 1,
      },
      {
        input: "Single unique salary should return null.",
        expectedOutput: "Null output when no second salary.",
        isHidden: true,
        weight: 2,
      },
    ],
    rubric: [
      { text: "Handles distinct salary values", category: "correctness", importance: "mustHave", expectedAnswerMode: "conceptual" },
      { text: "Handles no-second-salary case", category: "edgeCases", importance: "mustHave", expectedAnswerMode: "conceptual" },
      { text: "Explains SQL approach clearly", category: "implementationQuality", importance: "goodToHave", expectedAnswerMode: "conceptual" },
    ],
    sqlMetadata: {
      databaseSchema:
        'CREATE TABLE IF NOT EXISTS "employees" (id INTEGER PRIMARY KEY, name TEXT, salary INTEGER);',
      seedData: [
        { id: 1, name: "A", salary: 100 },
        { id: 2, name: "B", salary: 200 },
        { id: 3, name: "C", salary: 200 },
      ],
      expectedResult: [{ second_highest_salary: 100 }],
      validationRules: ["Distinct salary required", "Null-safe output when unavailable"],
    },
    sourceMetadata: { source: "curated", verified: true, qualityScore: 0.87 },
  },
  {
    questionId: "sql_monthly_retention_v1",
    title: "Monthly User Retention",
    question:
      "Given events(user_id, event_date), compute month-over-month retention rate from Jan to Jun 2025 where retained users are active in consecutive months.",
    companyTags: ["Google", "Amazon"],
    roundType: "SQL",
    difficulty: "hard",
    topics: ["CTE", "Date functions", "Retention analytics"],
    subtopics: ["Windowing", "Month bucketing", "Joins"],
    evaluationStrategy: "rubric_llm",
    testCases: [
      {
        input: "Output month, retained_users, previous_month_active_users, retention_rate.",
        expectedOutput: "One row per month from Feb onward with valid rates.",
        isHidden: false,
        weight: 1,
      },
      {
        input: "Avoid division by zero for empty prior month.",
        expectedOutput: "Safe handling of zero denominators.",
        isHidden: true,
        weight: 2,
      },
    ],
    rubric: [
      { text: "Buckets activity by month correctly", category: "queryDesign", importance: "mustHave", expectedAnswerMode: "conceptual" },
      { text: "Explains consecutive-month retention logic", category: "correctness", importance: "mustHave", expectedAnswerMode: "conceptual" },
      { text: "Addresses safe rate calculation", category: "edgeCases", importance: "mustHave", expectedAnswerMode: "conceptual" },
    ],
    sqlMetadata: {
      databaseSchema:
        'CREATE TABLE IF NOT EXISTS "events" (user_id INTEGER, event_date TEXT);',
      seedData: [
        { user_id: 10, event_date: "2025-01-10" },
        { user_id: 10, event_date: "2025-02-12" },
        { user_id: 11, event_date: "2025-02-18" },
      ],
      expectedResult: [
        { month: "2025-02", retained_users: 1, previous_month_active_users: 1, retention_rate: 1.0 },
      ],
      validationRules: ["Use month-level grouping", "Consecutive month self-join or equivalent required"],
    },
    sourceMetadata: { source: "curated", verified: true, qualityScore: 0.91 },
  },

  // -----------------------------
  // System Design (2)
  // -----------------------------
  {
    questionId: "sd_design_rate_limiter_v1",
    title: "Design a Distributed Rate Limiter",
    question:
      "Design a distributed rate limiter for a public API that handles millions of requests per minute with low latency and high availability.",
    companyTags: ["Amazon", "Google"],
    roundType: "System Design",
    difficulty: "hard",
    topics: ["Distributed Systems", "Scalability"],
    subtopics: ["Token bucket", "Consistency", "Sharding"],
    evaluationStrategy: "rubric_llm",
    rubric: [
      { text: "Explains algorithm choice (token bucket/leaky bucket/sliding window)", category: "architectureCoverage", importance: "mustHave", expectedAnswerMode: "design" },
      { text: "Addresses distributed consistency and synchronization trade-offs", category: "tradeoffs", importance: "mustHave", expectedAnswerMode: "design" },
      { text: "Discusses failure handling and graceful degradation", category: "failureHandling", importance: "mustHave", expectedAnswerMode: "design" },
      { text: "Mentions scale strategy (partitioning/caching)", category: "scalability", importance: "goodToHave", expectedAnswerMode: "design" },
    ],
    systemDesignMetadata: {
      requiredConcepts: ["Rate limiting algorithms", "Distributed cache", "Sharding", "Fault tolerance"],
    },
    sourceMetadata: { source: "curated", verified: true, qualityScore: 0.93 },
  },
  {
    questionId: "sd_design_notification_service_v1",
    title: "Design a Notification Service",
    question:
      "Design a notification platform that sends email, SMS, and push notifications with retry policies and user preferences.",
    companyTags: ["Microsoft", "Amazon"],
    roundType: "System Design",
    difficulty: "medium",
    topics: ["System Design", "Messaging"],
    subtopics: ["Queueing", "Retry strategy", "Preference management"],
    evaluationStrategy: "rubric_llm",
    rubric: [
      { text: "Defines core components and data flow clearly", category: "architectureCoverage", importance: "mustHave", expectedAnswerMode: "design" },
      { text: "Covers retries, idempotency, and delivery guarantees", category: "failureHandling", importance: "mustHave", expectedAnswerMode: "design" },
      { text: "Handles user preferences and channel selection", category: "correctness", importance: "mustHave", expectedAnswerMode: "design" },
      { text: "Discusses scaling and observability", category: "scalability", importance: "goodToHave", expectedAnswerMode: "design" },
    ],
    systemDesignMetadata: {
      requiredConcepts: ["Queue", "Worker", "Retry backoff", "Idempotency keys", "Observability"],
    },
    sourceMetadata: { source: "curated", verified: true, qualityScore: 0.9 },
  },

  // -----------------------------
  // HR (2)
  // -----------------------------
  {
    questionId: "hr_conflict_resolution_v1",
    title: "Conflict Resolution in Team",
    question:
      "Tell me about a time you had a conflict with a teammate. How did you resolve it, and what was the outcome?",
    companyTags: ["Google", "Microsoft"],
    roundType: "HR",
    difficulty: "medium",
    topics: ["Behavioral", "Teamwork"],
    subtopics: ["Conflict resolution", "Communication"],
    evaluationStrategy: "behavioral_llm",
    rubric: [
      { text: "Clearly describes context and conflict", category: "situationClarity", importance: "mustHave", expectedAnswerMode: "story" },
      { text: "Demonstrates personal ownership in actions", category: "actionOwnership", importance: "mustHave", expectedAnswerMode: "story" },
      { text: "Provides measurable or concrete outcome", category: "resultSpecificity", importance: "mustHave", expectedAnswerMode: "story" },
      { text: "Reflects on learning and improvement", category: "reflection", importance: "goodToHave", expectedAnswerMode: "story" },
    ],
    hrMetadata: {
      behavioralSignals: ["Ownership", "Collaboration", "Empathy", "Constructive communication"],
    },
    sourceMetadata: { source: "curated", verified: true, qualityScore: 0.89 },
  },
  {
    questionId: "hr_failure_learning_v1",
    title: "Failure and Learning",
    question:
      "Describe a significant failure or setback in your project work. What did you learn and how did you apply that learning later?",
    companyTags: ["Amazon", "Goldman Sachs"],
    roundType: "HR",
    difficulty: "medium",
    topics: ["Behavioral", "Growth mindset"],
    subtopics: ["Failure analysis", "Learning agility"],
    evaluationStrategy: "behavioral_llm",
    rubric: [
      { text: "Presents a genuine high-stakes scenario", category: "situationClarity", importance: "mustHave", expectedAnswerMode: "story" },
      { text: "Takes accountability without deflecting blame", category: "actionOwnership", importance: "mustHave", expectedAnswerMode: "story" },
      { text: "Explains concrete corrective actions", category: "correctness", importance: "mustHave", expectedAnswerMode: "story" },
      { text: "Shows growth with an applied follow-up example", category: "reflection", importance: "goodToHave", expectedAnswerMode: "story" },
    ],
    hrMetadata: {
      behavioralSignals: ["Accountability", "Resilience", "Learning from mistakes"],
    },
    sourceMetadata: { source: "curated", verified: true, qualityScore: 0.91 },
  },
];

async function seedInterviewQuestions() {
  console.log("[seedInterviewQuestions] Starting seed...");
  console.log("[seedInterviewQuestions] Safety: only InterviewQuestion collection will be touched.");

  await connectDB(config.MONGO_URI);

  let inserted = 0;
  let skipped = 0;

  try {
    for (const payload of curatedQuestions) {
      const existing = await InterviewQuestion.findOne({ questionId: payload.questionId })
        .select("_id questionId")
        .lean();

      if (existing) {
        skipped += 1;
        console.log(`[seedInterviewQuestions] SKIPPED existing questionId=${payload.questionId}`);
        continue;
      }

      await InterviewQuestion.create(payload);
      inserted += 1;
      console.log(`[seedInterviewQuestions] INSERTED questionId=${payload.questionId}`);
    }

    console.log("[seedInterviewQuestions] Completed.");
    console.log(`[seedInterviewQuestions] Summary: inserted=${inserted}, skipped=${skipped}, total=${curatedQuestions.length}`);
  } catch (error) {
    console.error("[seedInterviewQuestions] Failed:", error?.message || error);
    process.exitCode = 1;
  } finally {
    await mongoose.connection.close();
    console.log("[seedInterviewQuestions] Mongo connection closed.");
  }
}

seedInterviewQuestions();
