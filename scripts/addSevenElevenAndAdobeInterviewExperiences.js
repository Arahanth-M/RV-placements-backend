/**
 * Append first-hand interview experiences for 7-Eleven and Adobe only.
 * Does not edit questions, prep roles, or any other company.
 *
 * Usage:
 *   node scripts/addSevenElevenAndAdobeInterviewExperiences.js
 *   node scripts/addSevenElevenAndAdobeInterviewExperiences.js --write
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });

const WRITE = process.argv.includes("--write");

function experience({ prepRoleKey, overview, rounds }) {
  const content = [
    overview,
    "",
    ...rounds.map(
      (round, index) =>
        `Round ${index + 1}: ${round.type}\n${round.title}\n\n${round.details}`
    ),
  ].join("\n");
  return {
    prepRoleKey,
    content,
    polishedContent: {
      overview,
      rounds: rounds.map((round, index) => ({
        order: index + 1,
        type: round.type,
        title: round.title,
        details: round.details,
      })),
    },
    status: "approved",
    isAnonymous: true,
    createdAt: new Date(),
    approvedAt: new Date(),
  };
}

const COMPANIES = [
  {
    name: "7-Eleven",
    experiences: [
      experience({
        prepRoleKey: "sde",
        overview:
          "I interviewed for Software Engineer after a little over two years as a fullstack engineer at a startup. A referral got me the loop. They said there would be four rounds. The first was an hour of coding and basics.",
        rounds: [
          {
            type: "Technical",
            title: "SQL, strings, and a rate limiter",
            details:
              "It was not brutal, but it picked up quickly. The first question was SQL: given item sales, return the product id with the most sales in the past 24 hours. Then I had to check whether two strings are anagrams. The follow-up was what changes when the strings are huge, on the order of ten million characters, and memory is tight. I talked through sorting in chunks and streaming them, and also a frequency map that throws away counts I no longer need. The harder question was a rate limiter per customer IP: allow X requests a minute and reset the window. They then asked how that works when more than one instance is serving traffic, and how I keep the counts right without adding much latency. I compared a single shared store with a distributed count and where each one drifts.",
          },
        ],
      }),
      experience({
        prepRoleKey: "associate-software-engineer",
        overview:
          "I interviewed for Associate Software Engineer. It was a normal technical loop: Java, data structures around medium difficulty, and databases. Nothing was exotic, but they wanted the basics to be solid.",
        rounds: [
          {
            type: "Technical",
            title: "Java, DSA, and databases",
            details:
              "OOP stayed on Java: classes, inheritance, and what I actually use versus what I only define. The coding was medium data structures, the kind of problem you finish if you keep the examples small and talk while you write. Databases were the usual fundamentals, including what normalization is for and when I would stop splitting tables. They also handed me a sample schema and asked for nested queries, so I had to read the tables before I wrote the SQL.",
          },
        ],
      }),
      experience({
        prepRoleKey: "analyst",
        overview:
          "I interviewed for an analyst role on the retail side. The round was SQL against orders and sales, not a slide deck.",
        rounds: [
          {
            type: "Technical",
            title: "Store and order SQL",
            details:
              "One query was the product with the highest sales in the last 24 hours. The other used separate order and customer tables. I had to return, for each year and month, the customer with the highest total order value. They wanted the join, the grouping, and a clear rule for ties. I talked through the grain of the order table before I wrote the query, because getting that wrong makes the totals meaningless.",
          },
        ],
      }),
      experience({
        prepRoleKey: "data-scientist",
        overview:
          "I interviewed for a data role. The conversation moved between Spark, file formats, and one SQL problem on customer orders.",
        rounds: [
          {
            type: "Technical",
            title: "Pipelines and Spark",
            details:
              "They asked how I keep a pipeline alive when the source schema keeps changing. I talked about adding fields without breaking old readers, versioning the schema, and not assuming yesterday's columns still exist. Then broadcast variables versus accumulators: a broadcast is a read-only copy of a lookup that every worker can see, and an accumulator is how I add up a value across tasks. I also had to say why I would store analytical data as Parquet rather than ORC, and where ORC would still be the better fit.",
          },
          {
            type: "Technical",
            title: "Order SQL",
            details:
              "The SQL question was the customer with the highest total order value for each year and month, with orders and customers in different tables. I wrote the join, grouped by customer and month, and then kept the top customer inside each month.",
          },
        ],
      }),
      experience({
        prepRoleKey: "database-dev-intern",
        overview:
          "I interviewed for a database internship. They put a sample schema in front of me and stayed on queries, keys, and how the tables should be shaped.",
        rounds: [
          {
            type: "Technical",
            title: "Queries and modeling",
            details:
              "I wrote nested queries on the sample database, including a couple that filtered on a result from another query instead of joining everything first. They asked what normalization is and which normal form a table was breaking. I also had to explain primary keys and why I would not store the same fact in two places. The last part was file formats for a warehouse table: Parquet versus ORC, and what I would do when the source adds a column halfway through a load.",
          },
        ],
      }),
      experience({
        prepRoleKey: "fuel-pricing-data-scientist-intern",
        overview:
          "I interviewed for a data internship on the retail side. They cared about sales data that is incomplete and about a pipeline that still runs when the source schema moves.",
        rounds: [
          {
            type: "Technical",
            title: "Sales data and the pipeline",
            details:
              "I had to find the product with the most sales in a recent window, and explain how I would treat missing or partial days instead of dropping the store. They then asked what happens when the incoming file gains or renames columns. I talked about keeping a version of the schema, letting new fields land without failing the whole job, and checking totals after the load so a quiet schema change does not corrupt the numbers I would forecast from.",
          },
        ],
      }),
      experience({
        prepRoleKey: "digital-delivery-intern",
        overview:
          "I interviewed for a digital delivery internship. One part was frontend JavaScript and React. Another was coding in the language of the app, which for me was Swift.",
        rounds: [
          {
            type: "Technical",
            title: "JavaScript and React",
            details:
              "They asked me to explain event bubbling: the event starts at the element I clicked and then moves up through the parents, which is why one listener on a parent can handle many children. Then I had to implement a timer in React with a timeout hook and make sure the timer is cleared when the component unmounts, so it does not call setState after the screen is gone.",
          },
          {
            type: "Coding",
            title: "Swift",
            details:
              "The coding was in a Swift editor, separate from the conversation. The questions followed the app I would be working on, so I was writing real Swift rather than pseudocode. They also asked how I would build the same feature in JavaScript if the surface was the web instead of iOS.",
          },
        ],
      }),
    ],
  },
  {
    name: "Adobe",
    experiences: [
      experience({
        prepRoleKey: "software-engineer",
        overview:
          "I interviewed on campus for a software engineer role. There was an online aptitude test, a separate coding test, and then three technical rounds. About fifteen of us reached the interviews.",
        rounds: [
          {
            type: "OA",
            title: "Two HackerRank tests",
            details:
              "Aptitude was 45 questions. Coding was three problems. One was a string of lowercase letters and question marks. A question mark can be any letter. The string is bad if more than three consonants sit together or more than five vowels sit together, and I had to say whether every replacement is good, every replacement is bad, or it can go either way. The second was about songs and volume: n songs, a max volume, a starting volume, and a change allowed for each song. I can raise or lower the volume by that amount, never below zero, and I need the loudest legal volume on the last song, or -1 if it is impossible. The third was an array of values from 1 to 4, and the minimum changes so no two neighbors match.",
          },
          {
            type: "Technical",
            title: "About 40 minutes",
            details:
              "He asked how the online test went and for a short introduction. There was a small physics warm-up on relative velocity, then whatever we had covered in class, mostly operating systems and databases. Coding was the number of ways to climb n stairs, and level-order traversal of a binary tree.",
          },
          {
            type: "Technical",
            title: "Projects, OS, and a sorted stream",
            details:
              "She went through a project: the idea and what was hard. Operating systems were CPU scheduling, multi-level queues, mutexes, and deadlock. Coding was the left, right, and top views of a binary tree, a binary search variant, and a structure that stores a stream of characters in sorted order and answers whether a character has already arrived. She also asked how I would allow only one instance of a desktop app to run, which I did with a mutex, and how I would stop callers from allocating an object on the heap. I made operator new private.",
          },
          {
            type: "Technical",
            title: "About 90 minutes",
            details:
              "This one stayed on my projects. She asked me to separate supervised and unsupervised learning because one project touched that, then my favorite subject and every project on the resume. The design part was an Android app and a web app: which pieces I would build, which technologies, and which data structures.",
          },
        ],
      }),
      experience({
        prepRoleKey: "machine-learning-engineer",
        overview:
          "I interviewed for Machine Learning Engineer after a few years in data and ML. There were four rounds: a design problem, Python plus models, a managerial conversation, and a system design. I got the offer.",
        rounds: [
          {
            type: "Technical",
            title: "Document pipeline",
            details:
              "The whole round was one design. I had image and text for a document-style input, and I had to propose the full pipeline that predicts the aspect ratio. I walked through how I would read both modalities, what I would train, and how I would know the prediction was usable.",
          },
          {
            type: "Coding",
            title: "Python, then models",
            details:
              "There was a Python coding question first. After that the conversation went into large language models, transformers, and how attention works. They wanted the mechanism, not a product name.",
          },
          {
            type: "Managerial",
            title: "Projects and how I work",
            details:
              "This round was not another coding problem. We talked through projects I had shipped, how I work with other people, and a few behavioral questions about disagreements and ownership.",
          },
          {
            type: "System Design",
            title: "Color suggestions",
            details:
              "I had to design a system that suggests colors. We also talked about the team and the kind of work the role actually does. I was offered the role after this round.",
          },
        ],
      }),
    ],
  },
];

function snapshotOthers(col, keepIds) {
  return col
    .find({ companyId: { $nin: keepIds } }, { projection: { companyId: 1, interviewExperiences: 1, updatedAt: 1 } })
    .toArray()
    .then((rows) =>
      rows.map((row) => ({
        id: String(row.companyId),
        experiences: (row.interviewExperiences || []).length,
        updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : "",
      }))
    );
}

function sameSnapshot(before, after) {
  if (before.length !== after.length) return false;
  const afterById = new Map(after.map((row) => [row.id, row]));
  return before.every((row) => {
    const other = afterById.get(row.id);
    return other && other.experiences === row.experiences && other.updatedAt === row.updatedAt;
  });
}

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not set");
  const banned = /geeksforgeeks|ambitionbox|glassdoor|medium\.com|linkedin|blind\b|write-up|rephrased|published/i;
  for (const company of COMPANIES) {
    for (const item of company.experiences) {
      if (banned.test(`${item.content}\n${JSON.stringify(item.polishedContent)}`)) {
        throw new Error(`Source language left in ${company.name} ${item.prepRoleKey}`);
      }
    }
  }

  await mongoose.connect(process.env.MONGO_URI, {
    dbName: process.env.MONGODB_DB_NAME,
    serverSelectionTimeoutMS: 20000,
  });
  const db = mongoose.connection.db;
  const col = db.collection("company_platform_content");
  const plans = [];

  for (const company of COMPANIES) {
    const rows = await db.collection("companies").find({ name: company.name }).project({ name: 1 }).toArray();
    if (rows.length !== 1) throw new Error(`Expected one ${company.name}, found ${rows.length}`);
    const doc = await col.findOne({ companyId: rows[0]._id });
    if (!doc) throw new Error(`${company.name} has no company_platform_content document`);
    const roleKeys = new Set((doc.prepRoles || []).map((role) => role.key));
    for (const item of company.experiences) {
      if (!roleKeys.has(item.prepRoleKey)) throw new Error(`${company.name} has no role ${item.prepRoleKey}`);
    }
    const existing = doc.interviewExperiences || [];
    const have = new Set(existing.map((item) => `${item.prepRoleKey}::${String(item.content || "").slice(0, 80)}`));
    const toInsert = company.experiences.filter(
      (item) => !have.has(`${item.prepRoleKey}::${item.content.slice(0, 80)}`)
    );
    plans.push({ name: company.name, id: rows[0]._id, docId: doc._id, before: existing.length, toInsert });
    console.log(`${company.name} existing=${existing.length} toInsert=${toInsert.length}`);
  }

  const keepIds = plans.map((plan) => plan.id);
  const before = await snapshotOthers(col, keepIds);
  if (!WRITE) {
    console.log("Dry run only. Re-run with --write.");
    await mongoose.disconnect();
    return;
  }

  for (const plan of plans) {
    if (plan.toInsert.length === 0) continue;
    const result = await col.updateOne(
      { _id: plan.docId, companyId: plan.id },
      { $push: { interviewExperiences: { $each: plan.toInsert } }, $currentDate: { updatedAt: true } }
    );
    if (result.matchedCount !== 1 || result.modifiedCount !== 1) {
      throw new Error(`Update failed for ${plan.name}`);
    }
  }

  const after = await snapshotOthers(col, keepIds);
  if (!sameSnapshot(before, after)) throw new Error("Another company document changed");
  for (const plan of plans) {
    const doc = await col.findOne({ _id: plan.docId, companyId: plan.id });
    const byRole = {};
    for (const item of doc.interviewExperiences || []) {
      const key = item.prepRoleKey || "(untagged)";
      byRole[key] = (byRole[key] || 0) + 1;
    }
    console.log(`${plan.name} total=${doc.interviewExperiences.length} ${JSON.stringify(byRole)}`);
  }
  console.log(`Other companies unchanged: ${before.length}`);
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
