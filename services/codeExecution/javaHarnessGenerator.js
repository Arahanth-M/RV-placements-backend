/**
 * Generates Main.java + compiles with candidate Solution.java.
 * JSON testcase contract matches cppHarnessGenerator / Python runner (executeCode.js).
 */

import { USER_DEBUG_OUTPUT_MAX_BYTES } from "./executionUtils.js";
import { parseFlexibleInterviewSignature, toLeetCodeMethodName } from "./cppHarnessGenerator.js";

const toSafeString = (value, fallback = "") =>
  typeof value === "string" && value.trim() ? value.trim() : fallback;

/**
 * @param {unknown} value
 * @param {number} depth
 * @returns {string} Java type for Gson-backed testcase materialization
 */
export const inferJavaTypeFromJson = (value, depth = 0) => {
  if (depth > 14) {
    throw new Error("Java harness: nesting depth too deep for testcase JSON.");
  }
  if (value === null || value === undefined) {
    return "com.google.gson.JsonElement";
  }
  if (typeof value === "boolean") {
    return "boolean";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "double";
    if (Number.isInteger(value) && Math.abs(value) <= 2147483647) return "int";
    if (Number.isInteger(value)) return "long";
    return "double";
  }
  if (typeof value === "string") {
    return "String";
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "int[]";
    }
    const inner = inferJavaTypeFromJson(value[0], depth + 1);
    return `${inner}[]`;
  }
  if (typeof value === "object") {
    throw new Error("Java harness: nested object values inside testcase input are not supported.");
  }
  return "com.google.gson.JsonElement";
};

/**
 * @returns {{ parsed: { name: string, params: string[] }, paramTypes: Record<string,string>, params: string[], inputKind: string, methodName: string }}
 */
export const describeInterviewJavaSignature = (functionSignature, testCases) => {
  const parsed = parseFlexibleInterviewSignature(functionSignature);
  if (!parsed.name) {
    throw new Error(
      "Java harness: could not parse functionSignature (expected Python `def name(...):` or TypeScript-like `name(...):`)."
    );
  }
  if (!/^[A-Za-z_]\w*$/.test(parsed.name)) {
    throw new Error("Java harness: invalid function name after parse.");
  }

  const cases = Array.isArray(testCases) ? testCases : [];
  if (cases.length === 0) {
    throw new Error("Java harness: no testcases.");
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
          `Java harness: first testcase input object is missing key "${name}" required by signature.`
        );
      }
      paramTypes[name] = inferJavaTypeFromJson(sample[name]);
    }
  } else if (Array.isArray(sample)) {
    inputKind = "array";
    if (params.length !== 1) {
      throw new Error(
        "Java harness: array-shaped testcase input requires exactly one function parameter in the signature."
      );
    }
    paramTypes[params[0]] = inferJavaTypeFromJson(sample);
  } else {
    inputKind = "scalar";
    if (params.length !== 1) {
      throw new Error(
        "Java harness: scalar testcase input requires exactly one function parameter in the signature."
      );
    }
    paramTypes[params[0]] = inferJavaTypeFromJson(sample);
  }

  const methodName = toLeetCodeMethodName(parsed.name);
  if (!methodName) {
    throw new Error("Java harness: could not derive LeetCode-style method name.");
  }
  return { parsed, paramTypes, params, inputKind, methodName };
};

const gsonMaterializeExpr = (javaType, jsonAccess) => {
  if (javaType === "int") return `${jsonAccess}.getAsInt()`;
  if (javaType === "long") return `${jsonAccess}.getAsLong()`;
  if (javaType === "double") return `${jsonAccess}.getAsDouble()`;
  if (javaType === "boolean") return `${jsonAccess}.getAsBoolean()`;
  if (javaType === "String") return `${jsonAccess}.getAsString()`;
  if (javaType === "com.google.gson.JsonElement") return jsonAccess;
  if (javaType.endsWith("[]")) {
    return `gson.fromJson(${jsonAccess}, ${javaType}.class)`;
  }
  return `gson.fromJson(${jsonAccess}, ${javaType}.class)`;
};

const buildParamReadsObject = (params, paramTypes) => {
  const lines = [];
  for (const p of params) {
    const t = paramTypes[p];
    const access = `inp.get(${JSON.stringify(p)})`;
    lines.push(`${t} ${p} = ${gsonMaterializeExpr(t, access)};`);
  }
  return lines.join("\n        ");
};

/**
 * @param {{ functionSignature: string, testCases: Array<{ input?: unknown }> }} args
 * @returns {string} Main.java source
 */
export const generateJavaMainSource = ({ functionSignature, testCases }) => {
  const { paramTypes, params, inputKind, methodName } = describeInterviewJavaSignature(
    functionSignature,
    testCases
  );

  let paramBlock;
  let invokeArgs;
  if (inputKind === "object") {
    paramBlock = `JsonObject inp = testCase.get("input").getAsJsonObject();\n        ${buildParamReadsObject(params, paramTypes)}`;
    invokeArgs = params.join(", ");
  } else {
    const p0 = params[0];
    const t0 = paramTypes[p0];
    const access = `testCase.get("input")`;
    paramBlock = `${t0} ${p0} = ${gsonMaterializeExpr(t0, access)};`;
    invokeArgs = p0;
  }

  return `import com.google.gson.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

public class Main {
  private static final String EXECUTION_SUCCESS = "EXECUTION_SUCCESS";
  private static final String EXECUTION_RUNTIME_ERROR = "EXECUTION_RUNTIME_ERROR";
  private static final String EXECUTION_ERROR = "EXECUTION_ERROR";
  private static final int USER_DEBUG_CAP = ${USER_DEBUG_OUTPUT_MAX_BYTES};
  private static final ByteArrayOutputStream USER_DBG_BYTES = new ByteArrayOutputStream();

  private static void appendUserDbg(String s) {
    if (s == null || s.isEmpty()) return;
    byte[] b = s.getBytes(StandardCharsets.UTF_8);
    int room = USER_DEBUG_CAP - USER_DBG_BYTES.size();
    if (room <= 0) return;
    int take = Math.min(room, b.length);
    USER_DBG_BYTES.write(b, 0, take);
  }

  private static String userDbgString() {
    return USER_DBG_BYTES.toString(StandardCharsets.UTF_8);
  }

  private static long nowMs() {
    return System.nanoTime() / 1_000_000L;
  }

  public static void main(String[] args) throws Exception {
    Gson gson = new Gson();
    long startTotal = nowMs();
    try {
      String raw = Files.readString(Path.of("testcases.json"));
      JsonObject root = JsonParser.parseString(raw).getAsJsonObject();
      JsonArray tests = root.getAsJsonArray("testCases");
      JsonArray results = new JsonArray();
      int passed = 0;

      int caseIndex = 0;
      for (JsonElement tcEl : tests) {
        caseIndex += 1;
        JsonObject testCase = tcEl.getAsJsonObject();
        JsonElement expected = testCase.get("expectedOutput");
        boolean isHidden = testCase.has("isHidden") && testCase.get("isHidden").getAsBoolean();
        int weight = testCase.has("weight") ? testCase.get("weight").getAsInt() : 1;
        long caseStart = nowMs();

        JsonObject row = new JsonObject();
        row.add("isHidden", new JsonPrimitive(isHidden));
        row.add("weight", new JsonPrimitive(weight));
        row.add("input", testCase.get("input"));
        row.add("expectedOutput", expected);

        ByteArrayOutputStream captureBytes = new ByteArrayOutputStream();
        PrintStream savedOut = System.out;
        try {
          if (isHidden) {
            System.setOut(new PrintStream(OutputStream.nullOutputStream(), false, StandardCharsets.UTF_8));
          } else {
            System.setOut(new PrintStream(captureBytes, true, StandardCharsets.UTF_8));
          }
          Solution sol = new Solution();
          ${paramBlock}
          var actual = sol.${methodName}(${invokeArgs});
          JsonElement actualJson = gson.toJsonTree(actual);
          boolean ok = actualJson.equals(expected);
          if (ok) passed += 1;
          row.add("passed", new JsonPrimitive(ok));
          row.add("actualOutput", actualJson);
          row.add("error", new JsonPrimitive(""));
          row.add("executionTime", new JsonPrimitive((int) (nowMs() - caseStart)));
        } catch (Exception ex) {
          row.add("passed", new JsonPrimitive(false));
          row.add("actualOutput", JsonNull.INSTANCE);
          row.add("error", new JsonPrimitive(String.valueOf(ex.getMessage() != null ? ex.getMessage() : ex.getClass().getName())));
          row.add("executionTime", new JsonPrimitive((int) (nowMs() - caseStart)));
        } finally {
          System.setOut(savedOut);
        }
        if (!isHidden) {
          String sp = captureBytes.toString(StandardCharsets.UTF_8);
          if (!sp.isEmpty()) {
            appendUserDbg("\\n--- visible case " + caseIndex + " ---\\n");
            appendUserDbg(sp);
          }
        }
        results.add(row);
      }

      int total = results.size();
      int failed = total - passed;
      JsonObject out = new JsonObject();
      out.add("status", new JsonPrimitive(failed == 0 ? EXECUTION_SUCCESS : EXECUTION_RUNTIME_ERROR));
      out.add("passedCount", new JsonPrimitive(passed));
      out.add("failedCount", new JsonPrimitive(failed));
      out.add("totalCount", new JsonPrimitive(total));
      out.add("executionTime", new JsonPrimitive((int) (nowMs() - startTotal)));
      out.add("memoryUsed", new JsonPrimitive(0));
      out.add("results", results);
      out.add("userDebugOutput", new JsonPrimitive(userDbgString()));
      System.out.println(gson.toJson(out));
    } catch (Exception ex) {
      JsonObject err = new JsonObject();
      err.add("status", new JsonPrimitive(EXECUTION_ERROR));
      err.add("passedCount", new JsonPrimitive(0));
      err.add("failedCount", new JsonPrimitive(0));
      err.add("totalCount", new JsonPrimitive(0));
      err.add("executionTime", new JsonPrimitive(0));
      err.add("memoryUsed", new JsonPrimitive(0));
      err.add("results", new JsonArray());
      err.add("userDebugOutput", new JsonPrimitive(userDbgString()));
      err.add("error", new JsonPrimitive(String.valueOf(ex.getMessage() != null ? ex.getMessage() : ex.getClass().getName())));
      System.out.println(gson.toJson(err));
    }
  }
}
`;
};

export default {
  inferJavaTypeFromJson,
  describeInterviewJavaSignature,
  generateJavaMainSource,
};
