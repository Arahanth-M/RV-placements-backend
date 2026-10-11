/**
 * Compile and run DSA solutions for one fintech OA group file.
 * Usage: node scripts/verifyFintechOaGroup.js scripts/data/fintech-oa/groupA.js
 */
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";

const JAVA_HOME = "/Library/Java/JavaVirtualMachines/jdk-21.jdk/Contents/Home";

function normalizeOut(value) {
  return String(value ?? "").replace(/\r\n/g, "\n").trimEnd();
}

function run(cmd, args, cwd, stdin) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      timeout: 15000,
      env: { ...process.env, JAVA_HOME, PATH: `${JAVA_HOME}/bin:${process.env.PATH || ""}` },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => resolve({ code: 1, stdout, stderr: `${stderr}\n${error.message}` }));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.stdin.write(String(stdin ?? ""));
    if (!String(stdin ?? "").endsWith("\n")) child.stdin.write("\n");
    child.stdin.end();
  });
}

async function checkItem(item, index) {
  const errors = [];
  const label = `${item.company || "?"} #${index} ${item.role || "?"} ${item.algo || ""}`;
  if (!item.question || !item.intuition || !item.python || !item.java || !item.cpp) {
    return [`${label}: missing question, intuition, or a solution`];
  }
  if (!["sde", "analyst"].includes(item.role)) errors.push(`${label}: role must be sde or analyst`);
  if (!Array.isArray(item.tests) || item.tests.length < 2) {
    return [...errors, `${label}: need at least 2 tests`];
  }
  const sampleIn = normalizeOut(item.tests[0].stdin);
  const sampleOut = normalizeOut(item.tests[0].stdout);
  if (!normalizeOut(item.question).includes(sampleIn) || !normalizeOut(item.question).includes(sampleOut)) {
    errors.push(`${label}: sample stdin/stdout must appear in the question text`);
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fintech-oa-"));
  fs.writeFileSync(path.join(dir, "main.py"), item.python);
  fs.writeFileSync(path.join(dir, "Main.java"), item.java);
  fs.writeFileSync(path.join(dir, "main.cpp"), item.cpp);

  const javac = await run(`${JAVA_HOME}/bin/javac`, ["Main.java"], dir, "");
  if (javac.code !== 0) errors.push(`${label}: javac failed\n${javac.stderr.slice(0, 800)}`);
  const cxx = await run("c++", ["-std=c++17", "-O2", "main.cpp", "-o", "main"], dir, "");
  if (cxx.code !== 0) errors.push(`${label}: c++ failed\n${cxx.stderr.slice(0, 800)}`);

  for (let t = 0; t < item.tests.length; t += 1) {
    const test = item.tests[t];
    const expected = normalizeOut(test.stdout);
    const py = await run("python3", ["main.py"], dir, test.stdin);
    if (py.code !== 0 || normalizeOut(py.stdout) !== expected) {
      errors.push(`${label}: python test ${t} expected ${JSON.stringify(expected)} got ${JSON.stringify(normalizeOut(py.stdout))} stderr ${py.stderr.slice(0, 300)}`);
    }
    if (javac.code === 0) {
      const java = await run(`${JAVA_HOME}/bin/java`, ["Main"], dir, test.stdin);
      if (java.code !== 0 || normalizeOut(java.stdout) !== expected) {
        errors.push(`${label}: java test ${t} expected ${JSON.stringify(expected)} got ${JSON.stringify(normalizeOut(java.stdout))} stderr ${java.stderr.slice(0, 300)}`);
      }
    }
    if (cxx.code === 0) {
      const cpp = await run(path.join(dir, "main"), [], dir, test.stdin);
      if (cpp.code !== 0 || normalizeOut(cpp.stdout) !== expected) {
        errors.push(`${label}: cpp test ${t} expected ${JSON.stringify(expected)} got ${JSON.stringify(normalizeOut(cpp.stdout))} stderr ${cpp.stderr.slice(0, 300)}`);
      }
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return errors;
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: node scripts/verifyFintechOaGroup.js <group.js>");
    process.exit(1);
  }
  const abs = path.resolve(file);
  const mod = await import(pathToFileURL(abs).href);
  const items = mod.GROUP;
  if (!Array.isArray(items) || items.length === 0) {
    console.error("GROUP export missing");
    process.exit(1);
  }
  const errors = [];
  for (let i = 0; i < items.length; i += 1) {
    const found = await checkItem(items[i], i);
    if (found.length) {
      errors.push(...found);
      console.error(found[0]);
    } else {
      console.log(`ok ${items[i].company} ${items[i].role} ${items[i].algo}`);
    }
  }
  if (errors.length) {
    console.error(`FAILED ${errors.length}`);
    process.exit(1);
  }
  console.log(`PASSED ${items.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
