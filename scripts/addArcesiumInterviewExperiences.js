/**
 * Rewrite the Arcesium interview experiences inserted by this script
 * so they read as first-hand platform entries.
 * Matches company name exactly. Does not edit questions, prep roles,
 * older untagged experiences, or any other company.
 *
 * Usage:
 *   node scripts/addArcesiumInterviewExperiences.js
 *   node scripts/addArcesiumInterviewExperiences.js --write
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });

const WRITE = process.argv.includes("--write");
const COMPANY_NAME = "Arcesium";
const PREVIOUS_MARKER = "Public write-up.";

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

const EXPERIENCES = [
  experience({
    prepRoleKey: "sde",
    overview:
      "I interviewed for Software Engineer in Hyderabad. I already had about a year at a product company and an internship before that. A recruiter mailed me the test link. There was an online test, two live coding rounds, and HR. I was selected.",
    rounds: [
      {
        type: "OA",
        title: "HackerRank, about 60 minutes",
        details:
          "Three coding problems, all moderate. One asked for the product of the maximum value inside every subarray of an array of distinct integers. Another was a minimum-time tunnel crossing: each person can walk alone or carry someone else, and both times are given. The third was a hard binary-tree problem and took most of the time I had left.",
      },
      {
        type: "Technical",
        title: "Coding, OOP, and a project walkthrough",
        details:
          "After a short intro he went straight to a matrix problem. I was given a source grid and a destination grid. The only edits allowed were adding or subtracting one from an entire row or an entire column. I explained a simpler approach, then a tighter one, and coded it in Python on the shared editor. The rest of the hour was Java OOP. He then asked me to sketch the architecture of a recent project and defend the choices.",
      },
      {
        type: "Technical",
        title: "DSA, schema design, and operating systems",
        details:
          "A senior engineer opened with the projects from my current job and we stayed on them for a while. I grouped anagrams with a straightforward map, which was enough, then did vertical order traversal of a binary tree and stated time and space. For databases I designed a school schema for teachers, students, and subjects, including the case where one student takes many subjects and one teacher teaches many subjects. Operating systems covered threads versus processes, deadlock and how to avoid it, daemon threads, thrashing, and scheduling.",
      },
      {
        type: "HR",
        title: "Motivation and compensation",
        details:
          "HR asked me to introduce myself, why I wanted to leave my current company, and a few questions from my resume. We then talked compensation against my current pay. I was selected.",
      },
    ],
  }),
  experience({
    prepRoleKey: "sde",
    overview:
      "This was our on-campus full-time process. The interviews were on HackerRank CodePair from the placement office because the team did not come to campus. Two of us reached HR, and both of us were offered on the same call.",
    rounds: [
      {
        type: "OA",
        title: "Three timed sections",
        details:
          "Thirty-two questions: fifteen logical-reasoning MCQs, fifteen technical MCQs that were mostly ‘what does this code print’, and two coding problems. One coding problem was the smallest positive integer that cannot be formed as a sum of a subset of the given numbers. I do not remember the second one. Each section had its own cutoff. Solving one coding problem and clearing the other two sections was enough for me to get the interview call.",
      },
      {
        type: "Technical",
        title: "BST check and runtime polymorphism",
        details:
          "He only skimmed my resume. I had to check whether a binary tree is a BST. I started with an inorder traversal stored in an array, and he asked me to drop the extra memory. A range check was fine. He then wanted the inorder version that only remembers the previous value. I coded that and made a small change he asked for. After that I explained the four OOP ideas and wrote a short example of runtime polymorphism.",
      },
      {
        type: "Technical",
        title: "Search design, pointers, SQL, and virtualization",
        details:
          "He asked what I know. I mentioned Django and had to explain it briefly. The design prompt was a library whose books are not kept in order. Search should take several keywords and rank a title higher when a keyword shows up more often, so a book with the word three times comes before books that have it once. Scanning every title with string matching was too slow. I moved to a trie, showed how the node would look, and he was not convinced, so he changed the question. Then void pointer versus int pointer, and what increment does to each. I got both wrong. SQL needed joins, group by, and limit. He also asked what virtualization means in an operating system.",
      },
      {
        type: "Technical",
        title: "Large bit masks and abstract classes",
        details:
          "I was given exponents in an array. The number is the sum of those powers of two, and I had to say which bit positions are set. Values can repeat and can be far larger than a machine word, so the same bit can collide and I had to carry. Then abstract classes: what they are for, and why I cannot create an object of one. I could not answer the second part. He asked about virtualization again and what page size I would use for each process.",
      },
      {
        type: "HR",
        title: "Offer call",
        details:
          "The two of us who were shortlisted joined one video call. HR explained the company and told us both that we were getting offers.",
      },
    ],
  }),
  experience({
    prepRoleKey: "software-engineer-intern",
    overview:
      "I sat for the Software Engineer internship. Students above a 7 GPA were called for the online test. The interviewers were easy to talk to, and the day ran long because they kept pushing core CS past definitions. I was the only one selected for the Hyderabad office.",
    rounds: [
      {
        type: "OA",
        title: "HackerRank, three sections, 25% negative marking",
        details:
          "Fifteen aptitude questions in twenty minutes, fifteen technical MCQs in fifteen minutes, and two coding problems in forty-five minutes. Aptitude was long, so skipping slow items mattered. Technical MCQs mixed operating systems, databases, OOP, C++, and Java. One coding problem modeled cities as an infinite binary string. Index 0 starts infected. Each later day, every later index becomes the XOR of itself and its left neighbor from the previous day. Given the day, return that binary value modulo 1000000007, with the original infected city as the least significant bit. The sample for day 6 was 51, and the day could be as large as one million. The other problem was solved with hashing. About 115 people sat the test and 11 continued.",
      },
      {
        type: "Coding",
        title: "Intervals and geometry",
        details:
          "This round was only coding. I merged overlapping intervals from a list that was not sorted. For the example [[1,2], [2,6], [3,9]] I returned [[1,2], [2,9]] after fixing the overlap. The second problem was whether two rectangles overlap.",
      },
      {
        type: "Technical",
        title: "Java OOP and schema design",
        details:
          "This round was Java and databases. I explained encapsulation versus abstraction, and aggregation versus inheritance, with code and a case where aggregation is the right model. He gave me relations and asked which normal form each one breaks. I then designed tables for students, the courses they take, and marks on each test, so I could name each student’s strongest course by average marks. He kept changing the setup, first tests missing in some months, then tests every day, and I had to change the tables and the queries. I closed with a hospital-management schema.",
      },
      {
        type: "Technical",
        title: "Majority element, OS, and projects",
        details:
          "I solved majority element, then internal versus external fragmentation, paging, how I would reduce page faults, thrashing, and mutexes versus semaphores. He gave me critical-section attempts and I had to say whether each one actually works. He also asked what 16-bit and 32-bit processors mean, what changes if RAM is about a terabyte, the kinds of addresses an OS uses, and how negative numbers are stored with ones’ and twos’ complement. Both of my projects were Android apps on a document database. We spent about fifteen minutes on why I picked that database and how I handled the edge cases. He seemed satisfied.",
      },
      {
        type: "HR",
        title: "About twenty minutes",
        details:
          "About twenty minutes. Two things I learned from my projects, what I do in college apart from studying, hobbies, what I wanted from the internship, and what I already knew about Arcesium.",
      },
    ],
  }),
  experience({
    prepRoleKey: "summer-intern-technology",
    overview:
      "Arcesium came to our NIT for a two-month summer internship. Eligibility was CPI above 7 for CSE and IT and above 8 for ECE, and they cut the list again before the test. There was one online round on day one and four interviews on day two. I was one of the two interns selected. Results came the same evening.",
    rounds: [
      {
        type: "OA",
        title: "About 80 minutes, 25% negative marking, separate section timers",
        details:
          "Fifteen quantitative questions in twenty minutes, on profit and loss, work and time, probability, and other arithmetic, with too little time for a full pass. Fifteen CS questions in fifteen minutes, heavy on Java snippets, threads, OOP, AVL trees, heaps, and operating systems. Two coding problems in forty-five minutes: the maximum sum you can take from K elements at the two ends of an array, and a string problem. Eleven people were interviewed.",
      },
      {
        type: "Technical",
        title: "CodePair with a tech lead, about 75 minutes",
        details:
          "The interviewer was a tech lead. He was friendly, then asked me to search a value in a sorted array whose end I do not know. Linear search, jumping by a fixed gap, a fixed window plus binary search, and binary search against a huge invented end all failed. One counterexample was a sequence that grows extremely fast. He nudged me toward a window that grows. I doubled the window each time I had not found the value, then binary searched inside it, and explained why doubling is better than tripling. I coded it. He said the explanation was clear. OOP output questions followed, including a diamond-style inheritance case I had not seen before. He kept changing the classes until I could reason it out. Six of us continued.",
      },
      {
        type: "Technical",
        title: "Projects, OOP, SQL, and operating systems",
        details:
          "Another tech lead went through my projects, the stack, and a teaching-assistant stint, then stayed on theory. OOP started at the four pillars and static members and went through constructors, binding, virtual functions, and abstract classes. She kept editing class snippets and asking what they print, until I could not answer. I expected a coding question and did not get one. Databases were why we normalize, when we would denormalize, how each ACID property is enforced, truncate versus delete versus drop, and keys drawn on a table. She asked five SQL questions. I wrote three and could explain one more. Locks, processes and one way they communicate, fragmentation, and system calls closed the hour. Five of us continued. A friend of mine had a theory-only round as well.",
      },
      {
        type: "Technical",
        title: "Associate director, about 45 minutes",
        details:
          "This interviewer was an associate director. She asked how the earlier rounds felt, what I had been taught through the fourth semester, and whether I know Linux. Operating systems again: why an OS exists, how a system call reaches the kernel, and why synchronization matters. She then said she already knew I could code and gave me an easy-to-medium problem. A sorted array has duplicates and I cannot use its length. I had to move the unique values to the front in place and return the index of the last unique value. For [1,1,2,2,2,3,3] the front becomes [1,2,3] and the rest can be anything. A hash map was accepted, then she asked for less memory and I used two pointers. A few array and linked-list questions followed, and then HR questions I did not expect: why Arcesium, and where I see myself in ten years. Two of us were sent to HR.",
      },
      {
        type: "HR",
        title: "Zoom, about 35 minutes",
        details:
          "This one was on Zoom and ran about thirty-five minutes. HR read my resume out loud, opened my game project, and asked how to play it and why I built it. He even tried it. Then he asked what I would do for growth if I were running a game studio. He also asked what stipends other companies had offered, and said he was checking whether their own number was right. After that he talked about day-to-day life at the office. I was selected.",
      },
    ],
  }),
  experience({
    prepRoleKey: "assistant-system-engineer",
    overview:
      "I interviewed for a systems role. The bar they stated was strong Linux and internals, plus Python, Java, Go, C, or shell. The online test had negative marking. Sixteen of us reached the technical rounds and three of us got offers. Know every line of your resume.",
    rounds: [
      {
        type: "OA",
        title: "Thirty MCQs and two coding problems",
        details:
          "The MCQs were aptitude, operating systems, and short C++ and Java snippets. One coding problem was about choosing how an army moves. The other was the same pattern as house robber: maximum sum with no two chosen values next to each other. Wrong MCQ answers cost marks.",
      },
      {
        type: "Technical",
        title: "Resume screen plus LRU",
        details:
          "I introduced myself and then implemented an LRU cache. He went through my resume in detail and started networking with DNS and DHCP. He also told me what the later rounds would look like. Eight of us continued.",
      },
      {
        type: "Technical",
        title: "Python OOP, networks, databases, OS, and computer organization",
        details:
          "Python access control: name mangling, private and protected attributes, and getters and setters. Networks continued with DNS, DHCP, routing, public versus private addresses, NAT and what sits in a NAT table, and classful address ranges. I wrote a few SQL queries and explained primary, candidate, and foreign keys, then why my project used MongoDB and how I set it up. Operating systems were the kernel, process versus thread, process states, both kinds of fragmentation, virtual memory, page replacement, and thrashing. Computer organization was the memory hierarchy, what a cache is for, registers and a few of them by name, and what the ALU does. Four of us continued.",
      },
      {
        type: "Technical",
        title: "Design, platforms, and Linux",
        details:
          "He asked about my internship project and the hard parts. I designed a traffic-light system and a movie recommender. We talked about message queues, platform services versus infrastructure, and how I would deploy. Linux was practical: long directory listings, nslookup, users and groups, and chmod. Three of us received offers.",
      },
    ],
  }),
  experience({
    prepRoleKey: "analyst",
    overview:
      "I interviewed for Analyst. Both rounds stayed on markets. They wanted clear explanations of the products, not a pricing spreadsheet.",
    rounds: [
      {
        type: "Technical",
        title: "Credit and rates",
        details:
          "I had to explain a credit default swap: what risk is being transferred, who pays the premium, and what the protection seller owes if the reference entity defaults. He then asked what a swaption is. I split payer and receiver swaptions and said why a borrower or a lender would buy the right to enter an interest-rate swap later instead of entering it today.",
      },
      {
        type: "Technical",
        title: "Options and bonds",
        details:
          "This round was equity swaps, how Black-Scholes is used in option pricing, and the main types of risk. He also asked how bond prices move when interest rates change. I said prices fall when yields rise. He was checking that relationship, not a full calculation.",
      },
    ],
  }),
  experience({
    prepRoleKey: "finance-intern",
    overview:
      "I applied on the company site for a finance role. There were two technical rounds, the questions were not very hard, and the process finished in under two weeks. I was not selected. They still expected me to speak clearly and to be comfortable with both markets and a bit of programming.",
    rounds: [
      {
        type: "Technical",
        title: "Fixed income",
        details:
          "He asked me to explain bond duration. I treated it as interest-rate sensitivity: the weighted average time until the cash flows arrive. A bond with a duration of about five years moves roughly five percent in price when yields move one percent. He wanted Macaulay, modified, and effective duration kept apart, not used as the same word.",
      },
      {
        type: "Technical",
        title: "Markets and one programming question",
        details:
          "We started from my introduction and why this role matched the job description. Then derivatives, standard deviation and weighted average, and the option Greeks, with delta and theta named. He asked how futures differ from forwards and which terms in those contracts are customized. The programming question was how I would binary-search a name inside a directory, and how I would speed that up.",
      },
    ],
  }),
  experience({
    prepRoleKey: "data-scientist",
    overview:
      "I interviewed for a data role. There were three rounds, the level was moderate, and it took between two and four weeks. I have not heard back.",
    rounds: [
      {
        type: "OA",
        title: "Python, SQL, and MCQs",
        details:
          "The test had one Python problem, one SQL problem, and MCQs on both. The SQL problem used a customers table and a transactions table. Amounts came in as strings. A value in parentheses was a debit and every other value was a credit. For each customer I had to return the credit count, the debit count, and the total amount on each side. That meant cleaning the strings, deciding the sign, and then aggregating.",
      },
      {
        type: "Technical",
        title: "Grouped queries",
        details:
          "I wrote queries that group rows, keep groups with HAVING, and count them. He changed the filter a couple of times and I had to adjust the same query rather than start over.",
      },
      {
        type: "Technical",
        title: "Window functions and a small Python task",
        details:
          "SQL this time used RANK, DENSE_RANK, and PARTITION BY. In Python he asked me to swap two numbers without calling a library helper. I did it with a temporary variable, and he also wanted the version that only uses addition and subtraction.",
      },
    ],
  }),
  experience({
    prepRoleKey: "product-management-intern",
    overview:
      "A consultant set up my product interview. The round itself was moderate, and I heard back on the scheduling inside two weeks. I have not been told the final result.",
    rounds: [
      {
        type: "Interview",
        title: "One-on-one",
        details:
          "He stayed on my resume for most of the conversation and asked me to walk through what I had actually done, not just the titles. Then he asked what I would change in a product I already knew. I talked about who the change is for, what I would ship first, and how I would know it worked. He kept interrupting with follow-ups on the tradeoffs.",
      },
      {
        type: "Technical",
        title: "What comes next",
        details:
          "After the one-on-one, the recruiter told me more rounds were still left. I was asked to be ready for a product case, questions about how I work with engineering and clients, and a strategy discussion. No case was shared in advance, so I prepared prioritization, success metrics, and a feature I could explain from start to finish.",
      },
    ],
  }),
];

async function snapshotOtherCompanies(col, arcesiumId) {
  const rows = await col
    .find({ companyId: { $ne: arcesiumId } }, { projection: { companyId: 1, interviewExperiences: 1, updatedAt: 1 } })
    .toArray();
  return rows.map((row) => ({
    id: String(row.companyId),
    experiences: (row.interviewExperiences || []).length,
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : "",
  }));
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
  await mongoose.connect(process.env.MONGO_URI, {
    dbName: process.env.MONGODB_DB_NAME,
    serverSelectionTimeoutMS: 30000,
  });
  const db = mongoose.connection.db;
  const companies = await db
    .collection("companies")
    .find({ name: COMPANY_NAME })
    .project({ name: 1 })
    .toArray();
  if (companies.length !== 1) {
    throw new Error(`Expected exactly one company named ${COMPANY_NAME}, found ${companies.length}`);
  }
  const companyId = companies[0]._id;
  const col = db.collection("company_platform_content");
  const doc = await col.findOne({ companyId });
  if (!doc) throw new Error("Arcesium has no company_platform_content document");

  const roleKeys = new Set((doc.prepRoles || []).map((role) => role.key));
  for (const item of EXPERIENCES) {
    if (!roleKeys.has(item.prepRoleKey)) {
      throw new Error(`Unknown prep role ${item.prepRoleKey}`);
    }
  }

  const banned = /geeksforgeeks|ambitionbox|glassdoor|ieee|naukri|blind\b|public write|write-up|rephrased from|published|prep role|original post/i;
  for (const item of EXPERIENCES) {
    const blob = `${item.content}\n${JSON.stringify(item.polishedContent)}`;
    if (banned.test(blob)) throw new Error(`Source language left in ${item.prepRoleKey}`);
  }

  const existing = doc.interviewExperiences || [];
  const markerIndexes = [];
  existing.forEach((item, index) => {
    if (String(item.content || "").startsWith(PREVIOUS_MARKER)) markerIndexes.push(index);
  });
  if (markerIndexes.length !== EXPERIENCES.length) {
    throw new Error(`Expected ${EXPERIENCES.length} experiences to rewrite, found ${markerIndexes.length}`);
  }
  markerIndexes.forEach((index, order) => {
    if (existing[index].prepRoleKey !== EXPERIENCES[order].prepRoleKey) {
      throw new Error(`Role mismatch at position ${order}`);
    }
  });

  const untouchedBefore = existing
    .filter((item) => !String(item.content || "").startsWith(PREVIOUS_MARKER))
    .map((item) => String(item.content || ""));

  console.log(`companyId=${companyId} rewriting=${markerIndexes.length} write=${WRITE}`);
  markerIndexes.forEach((index, order) => {
    console.log(`- ${EXPERIENCES[order].prepRoleKey} chars=${EXPERIENCES[order].content.length}`);
  });

  const before = await snapshotOtherCompanies(col, companyId);
  if (!WRITE) {
    console.log("Dry run only. Re-run with --write to update Arcesium.");
    await mongoose.disconnect();
    return;
  }

  const interviewExperiences = existing.map((item, index) => {
    const order = markerIndexes.indexOf(index);
    if (order === -1) return item;
    const next = EXPERIENCES[order];
    return {
      ...item,
      prepRoleKey: next.prepRoleKey,
      content: next.content,
      polishedContent: next.polishedContent,
    };
  });

  const result = await col.updateOne(
    { _id: doc._id, companyId },
    { $set: { interviewExperiences }, $currentDate: { updatedAt: true } }
  );
  if (result.matchedCount !== 1 || result.modifiedCount !== 1) {
    throw new Error(`Unexpected update result ${JSON.stringify(result)}`);
  }

  const afterDoc = await col.findOne({ _id: doc._id, companyId });
  const after = await snapshotOtherCompanies(col, companyId);
  if (!sameSnapshot(before, after)) {
    throw new Error("Other company platform documents changed");
  }
  const untouchedAfter = (afterDoc.interviewExperiences || [])
    .filter((item) => !String(item.content || "").startsWith("I ") && !String(item.content || "").startsWith("This ") && !String(item.content || "").startsWith("Arcesium ") && !String(item.content || "").startsWith("A consultant"))
    .map((item) => String(item.content || ""));
  if (untouchedAfter.join("\n---\n") !== untouchedBefore.join("\n---\n")) {
    throw new Error("An older Arcesium experience changed");
  }
  if ((afterDoc.interviewExperiences || []).length !== existing.length) {
    throw new Error("Experience count changed");
  }
  const leaked = (afterDoc.interviewExperiences || []).filter((item) =>
    banned.test(`${item.content}\n${JSON.stringify(item.polishedContent || {})}`)
  );
  if (leaked.length) throw new Error("Source language still stored");
  console.log(`Rewrote ${markerIndexes.length}. Total experiences=${afterDoc.interviewExperiences.length}`);
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
