/**
 * Generates a single translation unit (main.cpp) that compiles with solution.cpp
 * and runs JSON testcases with the same output shape as services/codeExecution/executeCode.js (Python runner).
 */

import { USER_DEBUG_OUTPUT_MAX_BYTES } from "./executionUtils.js";

const toSafeString = (value, fallback = "") =>
  typeof value === "string" && value.trim() ? value.trim() : fallback;

/**
 * @param {string} functionSignature e.g. "def two_sum(nums, target):"
 * @returns {{ name: string, params: string[] }}
 */
export const parsePythonFunctionSignature = (functionSignature) => {
  const safe = toSafeString(functionSignature);
  const match = safe.match(/def\s+([A-Za-z_]\w*)\s*\(\s*([^)]*)\s*\)/);
  if (!match) {
    return { name: "", params: [] };
  }
  const rawParams = match[2].trim();
  if (!rawParams) {
    return { name: match[1], params: [] };
  }
  const params = rawParams
    .split(",")
    .map((segment) => {
      const part = segment.trim();
      if (!part) return "";
      const beforeType = part.split(":")[0]?.trim() || "";
      const beforeDefault = beforeType.split("=")[0]?.trim() || "";
      return beforeDefault;
    })
    .filter(Boolean);
  return { name: match[1], params };
};

/**
 * TypeScript / LeetCode style, e.g. `lengthOfLongestSubstring(s: string) => number`
 * or `twoSum(nums: number[], target: number) => number[]`.
 * @returns {{ name: string, params: string[] }}
 */
export const parseTypescriptLikeSignature = (functionSignature) => {
  const safe = toSafeString(functionSignature);
  let m = safe.match(/^\s*function\s+([A-Za-z_]\w*)\s*\(\s*([^)]*)\s*\)/);
  if (!m) {
    m = safe.match(/^\s*([A-Za-z_]\w*)\s*\(\s*([^)]*)\s*\)\s*=>/);
  }
  if (!m) {
    m = safe.match(/^\s*([A-Za-z_]\w*)\s*\(\s*([^)]*)\s*\)\s*:/);
  }
  if (!m) {
    m = safe.match(/^\s*([A-Za-z_]\w*)\s*\(\s*([^)]*)\s*\)\s*$/);
  }
  if (!m) {
    return { name: "", params: [] };
  }
  const name = m[1];
  const rawParams = (m[2] || "").trim();
  if (!rawParams) {
    return { name, params: [] };
  }
  const params = rawParams
    .split(",")
    .map((segment) => {
      const part = String(segment || "").trim();
      if (!part) return "";
      const beforeType = part.split(":")[0]?.trim() || "";
      const beforeDefault = beforeType.split("=")[0]?.trim() || "";
      return beforeDefault;
    })
    .filter(Boolean);
  return { name, params };
};

/** @returns {{ name: string, params: string[] }} */
export const parseFlexibleInterviewSignature = (functionSignature) => {
  const py = parsePythonFunctionSignature(functionSignature);
  if (py.name) return py;
  return parseTypescriptLikeSignature(functionSignature);
};

/**
 * Pseudocode / TS interface style: `class LRUCache { get(key): number; ... }`
 * @returns {string} class name or ""
 */
export const parseDesignClassNameFromSignature = (functionSignature) => {
  const safe = toSafeString(functionSignature);
  const m = safe.match(/\bclass\s+([A-Za-z_]\w*)\s*\{/);
  return m?.[1] || "";
};

/** Parameter types as seen by the linker — must match candidate `solution.cpp` (prefer const-ref for heavy types). */
const paramDeclFragment = (cppType, name) => {
  if (cppType === "std::string" || cppType.startsWith("std::vector") || cppType === "nlohmann::json") {
    return `const ${cppType}& ${name}`;
  }
  return `${cppType} ${name}`;
};

const getExprForParam = (cppType, inputExpr, key) => {
  const path = `${inputExpr}.at(${JSON.stringify(key)})`;
  if (cppType.startsWith("std::vector") || cppType === "std::string") {
    return `${path}.get<${cppType}>()`;
  }
  return `${path}.get<${cppType}>()`;
};

/**
 * @param {unknown} value
 * @param {number} depth
 * @returns {string} C++ type using std::vector / std::string
 */
export const inferCppTypeFromJson = (value, depth = 0) => {
  if (depth > 14) {
    throw new Error("C++ harness: nesting depth too deep for testcase JSON.");
  }
  if (value === null || value === undefined) {
    return "nlohmann::json";
  }
  if (typeof value === "boolean") {
    return "bool";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "double";
    if (Number.isInteger(value) && Math.abs(value) <= 2147483647) return "int";
    return "long long";
  }
  if (typeof value === "string") {
    return "std::string";
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "std::vector<int>";
    }
    const inner = inferCppTypeFromJson(value[0], depth + 1);
    for (let i = 1; i < value.length; i += 1) {
      if (inferCppTypeFromJson(value[i], depth + 1) !== inner) {
        throw new Error("C++ harness: heterogeneous arrays are not supported yet.");
      }
    }
    return `std::vector<${inner}>`;
  }
  if (typeof value === "object") {
    throw new Error("C++ harness: nested object values inside testcase input are not supported.");
  }
  return "nlohmann::json";
};

const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Brace depth before `endIndex`, ignoring `{}` inside `//`, `/* *\/`, and `"` strings (good enough for interview C++).
 * Used so we do not treat `int lengthOfLongestSubstring(` inside `class Solution` as a top-level free function.
 */
const braceDepthBeforeIndex = (code, endIndex) => {
  const n = Math.min(code.length, endIndex);
  let depth = 0;
  let i = 0;
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  while (i < n) {
    const c = code[i];
    const next = code[i + 1];
    if (inLineComment) {
      if (c === "\n" || c === "\r") inLineComment = false;
      i += 1;
      continue;
    }
    if (inBlockComment) {
      if (c === "*" && next === "/") {
        inBlockComment = false;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (inString) {
      if (c === "\\" && i + 1 < n) {
        i += 2;
        continue;
      }
      if (c === '"') inString = false;
      i += 1;
      continue;
    }
    if (c === "/" && next === "/") {
      inLineComment = true;
      i += 2;
      continue;
    }
    if (c === "/" && next === "*") {
      inBlockComment = true;
      i += 2;
      continue;
    }
    if (c === '"') {
      inString = true;
      i += 1;
      continue;
    }
    if (c === "{") depth += 1;
    else if (c === "}") depth = Math.max(0, depth - 1);
    i += 1;
  }
  return depth;
};

/** True if user already defined a top-level (non-nested) `retType fnName(` — not a method inside a class. */
const hasTopLevelReturnNamedFunction = (code, fnName) => {
  const re = new RegExp(
    `\\b(?:auto|void|bool|int|long long|double|int64_t|std::string|std::vector(?:<[^>]+>)?)\\s+${escapeRegExp(fnName)}\\s*\\(`,
    "gm"
  );
  for (const m of code.matchAll(re)) {
    if (m.index !== undefined && braceDepthBeforeIndex(code, m.index) === 0) {
      return true;
    }
  }
  return false;
};

/** Python `two_sum` / `max_profit` → common LeetCode `twoSum` / `maxProfit`; camelCase names pass through. */
export const toLeetCodeMethodName = (snakeOrPyName) => {
  const raw = String(snakeOrPyName || "").trim();
  if (!raw) return "";
  if (!raw.includes("_")) return raw;
  const parts = raw.split("_").filter(Boolean);
  if (!parts.length) return "";
  return (
    parts[0].toLowerCase() +
    parts
      .slice(1)
      .map((p) => (p.length ? p[0].toUpperCase() + p.slice(1).toLowerCase() : ""))
      .join("")
  );
};

/**
 * Shared inference for harness + optional LeetCode `Solution` bridge.
 * @returns {{ parsed: { name: string, params: string[] }, paramTypes: Record<string,string>, returnType: string, paramDecls: string, params: string[], inputKind: string }}
 */
export const describeInterviewCppSignature = (functionSignature, testCases) => {
  const parsed = parseFlexibleInterviewSignature(functionSignature);
  if (!parsed.name) {
    throw new Error(
      "C++ harness: could not parse functionSignature (expected Python `def name(...):` or TypeScript `name(...): T => R`)."
    );
  }
  if (!/^[A-Za-z_]\w*$/.test(parsed.name)) {
    throw new Error("C++ harness: invalid function name after parse.");
  }

  const cases = Array.isArray(testCases) ? testCases : [];
  if (cases.length === 0) {
    throw new Error("C++ harness: no testcases.");
  }

  const sample = cases[0]?.input;
  const params = parsed.params;

  /** @type {Record<string, string>} */
  const paramTypes = {};
  let inputKind = "scalar";
  if (sample != null && typeof sample === "object" && !Array.isArray(sample)) {
    inputKind = "object";
    for (const name of params) {
      if (!Object.prototype.hasOwnProperty.call(sample, name)) {
        throw new Error(
          `C++ harness: first testcase input object is missing key "${name}" required by signature.`
        );
      }
      paramTypes[name] = inferCppTypeFromJson(sample[name]);
    }
  } else if (Array.isArray(sample)) {
    inputKind = "array";
    if (params.length !== 1) {
      throw new Error(
        "C++ harness: array-shaped testcase input requires exactly one function parameter in the signature."
      );
    }
    paramTypes[params[0]] = inferCppTypeFromJson(sample);
  } else {
    inputKind = "scalar";
    if (params.length !== 1) {
      throw new Error(
        "C++ harness: scalar testcase input requires exactly one function parameter in the signature."
      );
    }
    paramTypes[params[0]] = inferCppTypeFromJson(sample);
  }

  const expectedSample = cases[0]?.expectedOutput;
  const returnType = inferCppTypeFromJson(expectedSample);
  const paramDecls = params.map((p) => paramDeclFragment(paramTypes[p], p)).join(", ");
  return { parsed, paramTypes, returnType, paramDecls, params, inputKind };
};

/**
 * If the candidate submitted LeetCode `class Solution { ... twoSum(...) }` but the harness expects
 * a free function `two_sum(...)`, append a thin adapter (same linkage as the harness forward decl).
 * @returns {string} extra C++ source or ""
 */
export const buildCppLeetcodeBridgeIfNeeded = (userCode, functionSignature, testCases) => {
  const code = String(userCode || "");
  let shape;
  try {
    shape = describeInterviewCppSignature(functionSignature, testCases);
  } catch {
    return "";
  }
  const { parsed, paramTypes, returnType, paramDecls, params } = shape;
  const fnName = parsed.name;
  if (!/\bclass\s+Solution\b/.test(code)) return "";
  const method = toLeetCodeMethodName(fnName);
  if (!method) return "";
  if (!new RegExp(`\\b${escapeRegExp(method)}\\s*\\(`, "m").test(code)) return "";
  if (hasTopLevelReturnNamedFunction(code, fnName)) {
    return "";
  }

  const lines = ["Solution rv_sol;"];
  const args = [];
  for (const p of params) {
    const t = paramTypes[p];
    if (t.startsWith("std::vector") || t === "std::string") {
      lines.push(`${t} ${p}_rv = ${p};`);
      args.push(`${p}_rv`);
    } else {
      args.push(p);
    }
  }
  return `\n${returnType} ${fnName}(${paramDecls}) {\n  ${lines.join("\n  ")}\n  return rv_sol.${method}(${args.join(", ")});\n}\n`;
};

/**
 * @param {{ name: string, params: string[] }} parsed
 * @param {Array<{ input?: unknown }>} testCases
 * @returns {string}
 */
export const generateCppMainSource = ({ functionSignature, testCases }) => {
  const { parsed, paramTypes, returnType, paramDecls, params, inputKind } = describeInterviewCppSignature(
    functionSignature,
    testCases
  );
  const forwardDecl = `${returnType} ${parsed.name}(${paramDecls});`;

  let invokeInner;
  if (inputKind === "object") {
    const parts = params.map((p) => getExprForParam(paramTypes[p], "inp", p));
    invokeInner = `${parsed.name}(${parts.join(", ")})`;
  } else if (inputKind === "array") {
    const p0 = params[0];
    invokeInner = `${parsed.name}(inp.get<${paramTypes[p0]}>())`;
  } else {
    const p0 = params[0];
    invokeInner = `${parsed.name}(inp.get<${paramTypes[p0]}>())`;
  }

  const includes = [
    "#include <nlohmann/json.hpp>",
    "#include <fstream>",
    "#include <string>",
    "#include <vector>",
    "#include <cstdint>",
    "#include <chrono>",
    "#include <iostream>",
    "#include <exception>",
    "#include <stdexcept>",
    "#include <sstream>",
  ];
  return `${includes.join("\n")}

using json = nlohmann::json;

static const char* EXECUTION_SUCCESS = "EXECUTION_SUCCESS";
static const char* EXECUTION_RUNTIME_ERROR = "EXECUTION_RUNTIME_ERROR";
static const char* EXECUTION_ERROR = "EXECUTION_ERROR";

static const size_t USER_DEBUG_CAP = ${USER_DEBUG_OUTPUT_MAX_BYTES};
static std::string user_debug_glob;
static size_t user_debug_tot = 0;

static void append_user_dbg(const std::string& chunk) {
  for (unsigned char c : chunk) {
    if (user_debug_tot >= USER_DEBUG_CAP) return;
    user_debug_glob.push_back(static_cast<char>(c));
    user_debug_tot++;
  }
}

struct ScopedRdbuf {
  std::streambuf* prev;
  explicit ScopedRdbuf(std::streambuf* next) : prev(std::cout.rdbuf(next)) {}
  ~ScopedRdbuf() { std::cout.rdbuf(prev); }
};

${forwardDecl}

#include "solution.cpp"

static int64_t now_ms() {
  using namespace std::chrono;
  return duration_cast<milliseconds>(steady_clock::now().time_since_epoch()).count();
}

int main() {
  std::ifstream file("testcases.json");
  if (!file) {
    json err;
    err["status"] = EXECUTION_ERROR;
    err["passedCount"] = 0;
    err["failedCount"] = 0;
    err["totalCount"] = 0;
    err["executionTime"] = 0;
    err["memoryUsed"] = 0;
    err["results"] = json::array();
    err["error"] = "Failed to open testcases.json";
    err["userDebugOutput"] = "";
    std::cout << err.dump() << "\\n";
    return 0;
  }
  json config;
  file >> config;
  json tests = config.at("testCases");
  json results = json::array();
  int passed = 0;
  int64_t start_total = now_ms();
  static std::ofstream dev_null("/dev/null");

  int case_index = 0;
  for (const auto& tc : tests) {
    case_index += 1;
    json inp = tc.at("input");
    json expected = tc.at("expectedOutput");
    bool is_hidden = tc.value("isHidden", false);
    int weight = tc.value("weight", 1);
    int64_t case_start = now_ms();
    json row;
    row["isHidden"] = is_hidden;
    row["weight"] = weight;
    row["input"] = inp;
    row["expectedOutput"] = expected;
    std::ostringstream cap;
    try {
      {
        std::streambuf* alt = nullptr;
        if (is_hidden) {
          if (dev_null.is_open()) {
            alt = dev_null.rdbuf();
          } else {
            alt = cap.rdbuf();
          }
        } else {
          alt = cap.rdbuf();
        }
        ScopedRdbuf _cout_guard(alt);
        json actual_json = json(${invokeInner});
        bool ok = (actual_json == expected);
        if (ok) passed += 1;
        row["passed"] = ok;
        row["actualOutput"] = actual_json;
        row["error"] = "";
        row["executionTime"] = static_cast<int>(now_ms() - case_start);
      }
      if (!is_hidden) {
        std::string sp = cap.str();
        if (!sp.empty()) {
          append_user_dbg("\\n--- visible case ");
          append_user_dbg(std::to_string(case_index));
          append_user_dbg(" ---\\n");
          append_user_dbg(sp);
        }
      }
    } catch (const std::exception& ex) {
      row["passed"] = false;
      row["actualOutput"] = nullptr;
      row["error"] = std::string(ex.what());
      row["executionTime"] = static_cast<int>(now_ms() - case_start);
      if (!is_hidden) {
        std::string sp = cap.str();
        if (!sp.empty()) {
          append_user_dbg("\\n--- visible case ");
          append_user_dbg(std::to_string(case_index));
          append_user_dbg(" ---\\n");
          append_user_dbg(sp);
        }
      }
    }
    results.push_back(row);
  }

  int total = static_cast<int>(results.size());
  int failed = total - passed;
  json out;
  out["status"] = (failed == 0) ? EXECUTION_SUCCESS : EXECUTION_RUNTIME_ERROR;
  out["passedCount"] = passed;
  out["failedCount"] = failed;
  out["totalCount"] = total;
  out["executionTime"] = static_cast<int>(now_ms() - start_total);
  out["memoryUsed"] = 0;
  out["results"] = results;
  out["userDebugOutput"] = user_debug_glob;
  std::cout << out.dump() << "\\n";
  return 0;
}
`;
};

export default {
  parsePythonFunctionSignature,
  parseTypescriptLikeSignature,
  parseFlexibleInterviewSignature,
  parseDesignClassNameFromSignature,
  inferCppTypeFromJson,
  describeInterviewCppSignature,
  toLeetCodeMethodName,
  buildCppLeetcodeBridgeIfNeeded,
  generateCppMainSource,
};
