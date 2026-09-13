import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const CPP_MARKERS =
  /#include\b|using\s+namespace\s+std|std::|\bcout\s*<<|\bcin\s*>>|vector\s*<|unordered_map\s*<|int\s+main\s*\(/;

const PLACEHOLDER_RE =
  /^(to be updated|n\/?a|nil|none|null|-|same as above|tbd|\.|\s)*$/i;

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function stripCodeFences(raw) {
  let text = String(raw || "").trim();
  const fenced = text.match(/^```(?:java|python|cpp|c\+\+|text)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) text = fenced[1].trim();
  return text.replace(/\r\n/g, "\n").trim();
}

export function isPlaceholderQuestion(text) {
  return PLACEHOLDER_RE.test(String(text || "").trim());
}

export function wantsCodeSolutions(item) {
  const cpp = String(item?.solutions?.cpp || "").trim();
  if (cpp.length >= 20) return true;
  const q = String(item?.question || "").trim();
  if (/^(explain|what is|what's|difference between|define|discuss|tell me|why )\b/i.test(q)) {
    return false;
  }
  return (
    item?.kind === "coding" &&
    /\b(write a (program|function|code)|implement |given (an? )?(array|tree|list|string|matrix|graph)|return the|leetcode|hackerrank)\b/i.test(
      q
    )
  );
}

function extractTaggedBlock(source, name) {
  const start = new RegExp(`<<<${name}\\b`, "i");
  const match = start.exec(source);
  if (!match) return "";
  const after = source.slice(match.index + match[0].length);
  const end = new RegExp(`<<<(?:JAVA|PYTHON|INTUITION)\\b`, "i");
  const endMatch = end.exec(after);
  let body = endMatch ? after.slice(0, endMatch.index) : after;
  body = body.replace(new RegExp(`(?:${name}\\s*)?>>>\\s*$`, "i"), "");
  body = body.replace(new RegExp(`(?:\\n|^)\\s*${name}\\s*$`, "i"), "");
  return stripCodeFences(body);
}

export function parseTaggedPayload(text) {
  const source = String(text || "");
  const fromFence = (lang) => {
    const re = new RegExp("```" + lang + "\\s*([\\s\\S]*?)```", "i");
    const match = source.match(re);
    return match ? stripCodeFences(match[1]) : "";
  };
  const java = extractTaggedBlock(source, "JAVA") || fromFence("java");
  const python = extractTaggedBlock(source, "PYTHON") || fromFence("python");
  let intuition = extractTaggedBlock(source, "INTUITION");
  if (!intuition) {
    const heading = source.match(/(?:^|\n)\s*(?:intuition|approach)\s*:\s*([\s\S]+)$/i);
    if (heading) intuition = heading[1].trim();
  }
  return { java, python, intuition };
}

export function looksLikeCpp(code) {
  return CPP_MARKERS.test(String(code || ""));
}

export function pythonCompiles(code) {
  const src = String(code || "").trim();
  if (!src) return { ok: false, error: "empty python" };
  const result = spawnSync(
    "python3",
    ["-c", "import sys; compile(sys.stdin.read(), '<sol>', 'exec')"],
    { input: src, encoding: "utf8", timeout: 12000 }
  );
  if (result.status === 0) return { ok: true };
  const error = String(result.stderr || result.stdout || "python compile failed").trim();
  return { ok: false, error: error.slice(0, 400) };
}

function javaHomeEnv() {
  const home =
    process.env.JAVA_HOME ||
    "/Library/Java/JavaVirtualMachines/jdk-21.jdk/Contents/Home";
  return { ...process.env, JAVA_HOME: home };
}

const JAVA_STUBS = `
class TreeNode {
  int val;
  TreeNode left, right;
  TreeNode() {}
  TreeNode(int val) { this.val = val; }
  TreeNode(int val, TreeNode left, TreeNode right) {
    this.val = val; this.left = left; this.right = right;
  }
}
class ListNode {
  int val;
  ListNode next;
  ListNode() {}
  ListNode(int val) { this.val = val; }
  ListNode(int val, ListNode next) { this.val = val; this.next = next; }
}
class Node {
  public int val;
  public Node left, right, next;
  public java.util.List<Node> children;
  public Node() {}
  public Node(int val) { this.val = val; }
}
`.trim();

export function javaCompiles(code) {
  const original = String(code || "").trim();
  if (!original) return { ok: false, error: "empty java" };

  let src = original.replace(/\bpublic\s+class\s+/, "class ");
  if (!/\bclass\s+\w+/.test(src)) {
    src = `class Solution {\n${src}\n}\n`;
  }
  const needsStub =
    /\b(TreeNode|ListNode|Node)\b/.test(src) &&
    !/\bclass\s+(TreeNode|ListNode|Node)\b/.test(src);
  if (needsStub) src = `${JAVA_STUBS}\n${src}`;

  const classMatch = [...src.matchAll(/\bclass\s+(\w+)/g)];
  const mainClass =
    classMatch.map((m) => m[1]).find((n) => !["TreeNode", "ListNode", "Node"].includes(n)) ||
    classMatch[0]?.[1] ||
    "Solution";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rvp-java-"));
  const filePath = path.join(dir, `${mainClass}.java`);
  try {
    fs.writeFileSync(filePath, src, "utf8");
    const result = spawnSync("javac", [filePath], {
      encoding: "utf8",
      timeout: 20000,
      env: javaHomeEnv(),
    });
    if (result.status === 0) return { ok: true };
    const error = String(result.stderr || result.stdout || "javac failed").trim();
    return { ok: false, error: error.slice(0, 500) };
  } catch (error) {
    return { ok: false, error: String(error?.message || error).slice(0, 400) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function validateCodingFill({ java, python, intuition, cpp }) {
  const reasons = [];
  const javaSrc = stripCodeFences(java);
  const pythonSrc = stripCodeFences(python);
  const intuitionSrc = String(intuition || "").trim();
  const cppSrc = String(cpp || "").trim();

  if (javaSrc.length < 40) reasons.push("java too short");
  if (pythonSrc.length < 40) reasons.push("python too short");
  if (intuitionSrc.length < 80) reasons.push("intuition too short");
  if (looksLikeCpp(javaSrc)) reasons.push("java still looks like C++");
  if (looksLikeCpp(pythonSrc)) reasons.push("python still looks like C++");
  if (cppSrc && javaSrc === cppSrc) reasons.push("java identical to C++");
  if (cppSrc && pythonSrc === cppSrc) reasons.push("python identical to C++");
  if (/#include\b|int\s+main\s*\(/.test(intuitionSrc)) {
    reasons.push("intuition looks like code");
  }

  if (!/\b(class|interface|enum)\s+\w+/.test(javaSrc) && !/\bimport\s+java\b/.test(javaSrc)) {
    if (!/\b(public|private|static)\b/.test(javaSrc)) {
      reasons.push("java missing class or method structure");
    }
  }
  if (!/\bdef\s+\w+\s*\(|\bclass\s+\w+/.test(pythonSrc)) {
    reasons.push("python missing def/class");
  }

  const py = pythonCompiles(pythonSrc);
  if (!py.ok) reasons.push(`python compile: ${py.error}`);

  const jv = javaCompiles(javaSrc);
  if (!jv.ok) reasons.push(`java compile: ${jv.error}`);

  return {
    ok: reasons.length === 0,
    reasons,
    java: javaSrc,
    python: pythonSrc,
    intuition: intuitionSrc,
  };
}

export function validateIntuitionOnly(intuition) {
  const text = String(intuition || "").trim();
  const reasons = [];
  if (text.length < 40) reasons.push("intuition too short");
  if (looksLikeCpp(text) || /```/.test(text)) reasons.push("intuition looks like code");
  return { ok: reasons.length === 0, reasons, intuition: text };
}

export function buildCodingPrompt({ question, cpp, needJava, needPython, needIntuition }) {
  const parts = [];
  if (needJava) parts.push("JAVA");
  if (needPython) parts.push("PYTHON");
  if (needIntuition) parts.push("INTUITION");

  return [
    {
      role: "system",
      content: `You translate placement coding solutions. Return ONLY tagged blocks, no markdown fences around the whole reply.

Rules:
- Produce a correct solution to the stated problem.
- If C++ is provided, keep the same algorithm, complexity, and I/O shape (stdin/stdout vs class/function).
- If C++ is clearly wrong or incomplete for the problem, implement a correct solution with the same I/O shape.
- Java must be valid Java 17: include needed imports and a compilable class. Use Scanner/BufferedReader for stdin programs. Do not use C++ syntax.
- Python must be valid Python 3 and compile. Use input()/sys.stdin for stdin programs. Do not use C++ syntax.
- Intuition must be language-agnostic numbered steps (3-8 steps). No code.
- Never output C++.
- Escape nothing; put raw code between the tags.

Format exactly:
<<<JAVA
...java source...
JAVA>>>
<<<PYTHON
...python source...
PYTHON>>>
<<<INTUITION
1. ...
INTUITION>>>

Only include blocks that were requested: ${parts.join(", ")}.`,
    },
    {
      role: "user",
      content: `Question:\n${String(question || "").slice(0, 5000)}\n\nExisting C++ (do not repeat; translate/fix into the other languages):\n${
        cpp ? String(cpp).slice(0, 9000) : "(none — write a correct Java/Python solution from the question)"
      }\n\nRequested: ${parts.join(", ")}`,
    },
  ];
}

export function buildIntuitionPrompt({ question, answer }) {
  return [
    {
      role: "system",
      content: `You write a short interview/OA intuition for a non-coding question.
Return ONLY:
<<<INTUITION
...
INTUITION>>>
3-6 numbered steps or bullets. No code. No Java. No Python. No C++. If an answer is given, explain why it is right.`,
    },
    {
      role: "user",
      content: `Question:\n${String(question || "").slice(0, 4000)}\n\nAnswer (may be empty):\n${String(answer || "").slice(0, 3000)}`,
    },
  ];
}

export function buildRepairPrompt(previousMessages, reasons) {
  return [
    ...previousMessages,
    {
      role: "user",
      content: `Your previous output failed checks:\n- ${reasons.join("\n- ")}\n\nReturn the tagged blocks again. Fix every listed problem. Java and Python must compile. Do not include C++.`,
    },
  ];
}
