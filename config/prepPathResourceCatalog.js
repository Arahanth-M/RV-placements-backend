/**
 * Approved PrepPath learning resources — aligned with /general mock interview
 * roles (PLATFORM_FRESHER_ROLES) and round types (PLATFORM_INTERVIEW_ROUND_TYPES).
 * LLM may only pick resourceId values from this list — URLs are never model-generated.
 */
export const PREP_PATH_RESOURCE_CATALOG = [
  // ── Languages & stacks ──────────────────────────────────────────────
  {
    id: "swift-docs",
    keys: ["swift", "ios", "xcode", "uikit", "swiftui"],
    title: "Swift.org — The Swift Programming Language",
    url: "https://docs.swift.org/swift-book/",
    why: "Official Swift language guide",
    summary: "Swift / iOS language fundamentals",
  },
  {
    id: "kotlin-docs",
    keys: ["kotlin", "android", "jetpack", "coroutine"],
    title: "Kotlin docs — Getting started",
    url: "https://kotlinlang.org/docs/getting-started.html",
    why: "Official Kotlin documentation",
    summary: "Kotlin / Android development",
  },
  {
    id: "golang-docs",
    keys: ["golang", "go lang"],
    title: "Go.dev — Documentation",
    url: "https://go.dev/doc/",
    why: "Official Go documentation",
    summary: "Go language fundamentals",
  },
  {
    id: "rust-book",
    keys: ["rust"],
    title: "Rust Book",
    url: "https://doc.rust-lang.org/book/",
    why: "Official Rust guide",
    summary: "Rust language fundamentals",
  },
  {
    id: "cpp-learncpp",
    keys: ["c++", "cpp"],
    title: "learncpp.com",
    url: "https://www.learncpp.com/",
    why: "C++ fundamentals for interviews",
    summary: "C++ for coding interviews",
  },
  {
    id: "java-gfg",
    keys: ["java", "spring", "jvm"],
    title: "GeeksforGeeks — Java",
    url: "https://www.geeksforgeeks.org/java/",
    why: "Java basics for backend / SDE roles",
    summary: "Java fundamentals (Backend / SDE)",
  },
  {
    id: "python-docs",
    keys: ["python", "django", "flask"],
    title: "Python docs — Tutorial",
    url: "https://docs.python.org/3/tutorial/",
    why: "Official Python tutorial",
    summary: "Python fundamentals (Data / ML / Backend)",
  },
  {
    id: "react-docs",
    keys: ["react", "jsx", "hooks", "redux", "next.js", "nextjs"],
    title: "React.dev — Learn React",
    url: "https://react.dev/learn",
    why: "Official React guide for frontend interviews",
    summary: "React / Frontend Engineer stack",
  },
  {
    id: "js-mdn",
    keys: ["javascript", "js", "html", "css", "frontend", "dom", "ui"],
    title: "MDN — JavaScript",
    url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide",
    why: "Solid JS fundamentals for frontend roles",
    summary: "JavaScript / HTML / CSS fundamentals",
  },
  {
    id: "nodejs-docs",
    keys: ["node", "nodejs", "express", "rest api", "backend api"],
    title: "Node.js — Getting started",
    url: "https://nodejs.org/en/learn/getting-started/introduction-to-nodejs",
    why: "Backend Node.js fundamentals for full-stack / backend roles",
    summary: "Node.js / Express backend",
  },

  // ── Mock round: DSA ─────────────────────────────────────────────────
  {
    id: "dsa-tuf",
    keys: [
      "dsa",
      "array",
      "tree",
      "graph",
      "dp",
      "dynamic programming",
      "leetcode",
      "coding",
      "algorithm",
      "oa",
      "two sum",
      "hash",
      "linked list",
      "bst",
      "string",
      "binary search",
      "stack",
      "queue",
      "heap",
    ],
    title: "Take U Forward — DSA sheet",
    url: "https://takeuforward.org/strivers-a2z-dsa-course/strivers-a2z-dsa-course-sheet-2/",
    why: "Structured DSA path for campus placements",
    summary: "DSA round / OA coding practice",
  },

  // ── Mock round: SQL ─────────────────────────────────────────────────
  {
    id: "sql-gfg",
    keys: [
      "sql",
      "joins",
      "query",
      "window function",
      "subquery",
      "group by",
      "having",
      "mysql",
      "postgresql",
    ],
    title: "GeeksforGeeks — SQL Tutorial",
    url: "https://www.geeksforgeeks.org/sql-tutorial/",
    why: "SQL queries for Data Analyst / Engineer / Scientist mocks",
    summary: "SQL round (Data Analyst / Engineer / Scientist)",
  },

  // ── Mock round: CS Fundamentals ─────────────────────────────────────
  {
    id: "cs-fundamentals-gfg",
    keys: ["cs fundamentals", "computer science", "core cs", "theory subjects"],
    title: "GeeksforGeeks — Interview Corner",
    url: "https://www.geeksforgeeks.org/interview-corner/",
    why: "CS Fundamentals round overview for SDE / GET / QA mocks",
    summary: "CS Fundamentals round overview",
  },
  {
    id: "os-gfg",
    keys: ["os", "operating system", "process", "thread", "memory", "deadlock", "scheduling"],
    title: "GeeksforGeeks — Operating Systems",
    url: "https://www.geeksforgeeks.org/operating-systems/",
    why: "Core OS topics for CS Fundamentals interviews",
    summary: "Operating systems (CS Fundamentals)",
  },
  {
    id: "dbms-gfg",
    keys: ["dbms", "database design", "normalization", "index", "transaction", "acid"],
    title: "GeeksforGeeks — DBMS",
    url: "https://www.geeksforgeeks.org/dbms/",
    why: "DBMS theory for CS Fundamentals interviews",
    summary: "DBMS theory (CS Fundamentals)",
  },
  {
    id: "cn-gfg",
    keys: ["network", "computer network", "tcp", "udp", "http", "osi", "dns"],
    title: "GeeksforGeeks — Computer Networks",
    url: "https://www.geeksforgeeks.org/computer-network-tutorials/",
    why: "Networking basics for CS Fundamentals interviews",
    summary: "Computer networks (CS Fundamentals)",
  },
  {
    id: "oop-gfg",
    keys: ["oop", "oops", "polymorphism", "inheritance", "encapsulation", "abstraction"],
    title: "GeeksforGeeks — OOPs",
    url: "https://www.geeksforgeeks.org/object-oriented-programming-oops-concept-in-java/",
    why: "OOP concepts asked in CS Fundamentals interviews",
    summary: "OOP concepts (CS Fundamentals)",
  },

  // ── Mock round: System Design / LLD ─────────────────────────────────
  {
    id: "lld-gfg",
    keys: ["lld", "low level design", "low-level design", "design pattern", "uml", "solid"],
    title: "GeeksforGeeks — Low Level Design",
    url: "https://www.geeksforgeeks.org/system-design/what-is-low-level-design-or-lld-learn-system-design/",
    why: "LLD round prep for SDE / backend roles",
    summary: "Low-Level Design round",
  },
  {
    id: "system-design-interviewbit",
    keys: ["system design", "hld", "high level design", "scalability", "microservices"],
    title: "GeeksforGeeks — System Design Tutorial",
    url: "https://www.geeksforgeeks.org/system-design-tutorial/",
    why: "System Design round for fresher interviews",
    summary: "System Design round (HLD basics)",
  },

  // ── Mock round: ML/AI Technical ─────────────────────────────────────
  {
    id: "ml-ai-gfg",
    keys: [
      "machine learning",
      "deep learning",
      "neural network",
      "ml",
      " ai ",
      "nlp",
      "computer vision",
      "tensorflow",
      "pytorch",
      "scikit",
    ],
    title: "GeeksforGeeks — Machine Learning",
    url: "https://www.geeksforgeeks.org/machine-learning/",
    why: "ML/AI Technical round for AI/ML Engineer / Data Scientist mocks",
    summary: "ML/AI Technical round",
  },
  {
    id: "statistics-gfg",
    keys: ["statistics", "probability", "hypothesis", "regression", "variance", "distribution"],
    title: "GeeksforGeeks — Statistics",
    url: "https://www.geeksforgeeks.org/statistics/",
    why: "Statistics for Data Analyst / Data Scientist interviews",
    summary: "Statistics & probability (Data roles)",
  },

  // ── Mock round: DevOps/Cloud ────────────────────────────────────────
  {
    id: "devops-gfg",
    keys: ["devops", "docker", "kubernetes", "k8s", "aws", "cloud", "ci/cd", "terraform", "sre"],
    title: "GeeksforGeeks — DevOps Tutorial",
    url: "https://www.geeksforgeeks.org/devops-tutorial/",
    why: "DevOps/Cloud Engineer mock and role prep",
    summary: "DevOps / Cloud Engineer role",
  },

  // ── Mock round: Embedded Systems ────────────────────────────────────
  {
    id: "embedded-gfg",
    keys: ["embedded", "microcontroller", "rtos", "firmware", "arm", "mcu", "iot hardware"],
    title: "GeeksforGeeks — Embedded Systems",
    url: "https://www.geeksforgeeks.org/computer-organization-architecture/introduction-of-embedded-systems-set-1/",
    why: "Embedded Systems round for Embedded Systems Engineer mocks",
    summary: "Embedded Systems round / role",
  },

  // ── Mock round: Circuit Design / VLSI ───────────────────────────────
  {
    id: "vlsi-gfg",
    keys: ["vlsi", "verilog", "vhdl", "rtl", "asic", "fpga", "digital design", "cmos"],
    title: "GeeksforGeeks — Digital Logic Design",
    url: "https://www.geeksforgeeks.org/digital-electronics-logic-design-tutorials/",
    why: "Circuit Design / VLSI round for hardware engineer mocks",
    summary: "Circuit Design / VLSI / Hardware Engineer",
  },

  // ── Mock round: Case Interview ──────────────────────────────────────
  {
    id: "case-interview-gfg",
    keys: [
      "case interview",
      "case study",
      "product sense",
      "consulting",
      "business analyst",
      "product analyst",
      "guesstimate",
    ],
    title: "GeeksforGeeks — Business Analyst Interview",
    url: "https://www.geeksforgeeks.org/business-analyst-interview-questions/",
    why: "Case Interview round for Business/Product Analyst & Consultant mocks",
    summary: "Case Interview (Analyst / Consultant)",
  },

  // ── Mock round: Project/Resume Deep Dive ────────────────────────────
  {
    id: "resume-projects-gfg",
    keys: [
      "resume deep dive",
      "project deep dive",
      "star method",
      "portfolio",
      "project explanation",
      "tell me about your project",
    ],
    title: "GeeksforGeeks — Resume for Freshers",
    url: "https://www.geeksforgeeks.org/blogs/how-to-write-a-perfect-resume-as-a-fresher-in-3-steps-mini-beginners-guide/",
    why: "Project/Resume Deep Dive round prep",
    summary: "Project / Resume Deep Dive round",
  },

  // ── Mock round: QA/SDET ─────────────────────────────────────────────
  {
    id: "testing-gfg",
    keys: ["testing", "sdet", "selenium", "automation", "test case", "qa", "quality assurance"],
    title: "GeeksforGeeks — Software Testing",
    url: "https://www.geeksforgeeks.org/software-testing-tutorial/",
    why: "QA/SDET role and testing-focused interview prep",
    summary: "QA / SDET testing fundamentals",
  },

  // ── Mock round: Core Technical (generic) ────────────────────────────
  {
    id: "core-technical-gfg",
    keys: ["core technical", "technical fundamentals", "engineering basics"],
    title: "GeeksforGeeks — Technical Interview Questions",
    url: "https://www.geeksforgeeks.org/technical-interview-questions/",
    why: "Core Technical round for Embedded / VLSI / GET roles",
    summary: "Core Technical round (generic engineering)",
  },

  // ── Mock round: HR ──────────────────────────────────────────────────
  {
    id: "hr-gfg",
    keys: ["behavioral", "hr interview", "soft skills", "communication", "tell me about yourself"],
    title: "GeeksforGeeks — HR interview",
    url: "https://www.geeksforgeeks.org/hr-interview-questions/",
    why: "HR round — common across all mock roles",
    summary: "HR / behavioral round",
  },

  // ── Mock round: Aptitude ──────────────────────────────────────────────
  {
    id: "aptitude-indiabix",
    keys: ["aptitude", "logical reasoning", "quant", "puzzle", "di", "data interpretation"],
    title: "IndiaBIX — Aptitude",
    url: "https://www.indiabix.com/aptitude/questions-and-answers/",
    why: "Aptitude round for GET / SDE intern / Data Analyst mocks",
    summary: "Aptitude round",
  },
];
