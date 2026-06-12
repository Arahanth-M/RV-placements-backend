import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import { spawn } from "child_process";
import {
  buildCppLeetcodeBridgeIfNeeded,
  generateCppMainSource,
  parseFlexibleInterviewSignature,
  parseDesignClassNameFromSignature,
} from "./cppHarnessGenerator.js";
import { generateJavaMainSource } from "./javaHarnessGenerator.js";
import {
  EXECUTION_COMPILATION_ERROR,
  EXECUTION_ERROR,
  EXECUTION_RUNTIME_ERROR,
  EXECUTION_TIMEOUT,
} from "./executionTypes.js";
import {
  normalizeExecutionResult,
  sanitizeInput,
  USER_DEBUG_OUTPUT_MAX_BYTES,
} from "./executionUtils.js";
import { dedupeTestCases } from "../../utils/dedupeTestCases.js";

const toSafeString = (value, fallback = "") =>
  typeof value === "string" && value.trim() ? value.trim() : fallback;

const DEFAULT_EXECUTION_TIMEOUT_MS = 60000;
const EXECUTION_TIMEOUT_MS = (() => {
  const parsed = Number(process.env.EXECUTION_TIMEOUT_MS);
  if (Number.isFinite(parsed) && parsed >= 1000) return parsed;
  return DEFAULT_EXECUTION_TIMEOUT_MS;
})();
const DEFAULT_IMAGE_PULL_TIMEOUT_MS = 5 * 60 * 1000;
const IMAGE_PULL_TIMEOUT_MS = (() => {
  const parsed = Number(process.env.EXECUTION_IMAGE_PULL_TIMEOUT_MS);
  if (Number.isFinite(parsed) && parsed >= 5000) return parsed;
  return DEFAULT_IMAGE_PULL_TIMEOUT_MS;
})();
/** Docker `--memory` (Python / default). C++ compile (cc1plus) often OOMs at 256m on prod. */
const DOCKER_MEMORY_LIMIT =
  (typeof process.env.EXECUTION_DOCKER_MEMORY === "string" && process.env.EXECUTION_DOCKER_MEMORY.trim()) ||
  "512m";
const DOCKER_MEMORY_LIMIT_CPP =
  (typeof process.env.EXECUTION_DOCKER_MEMORY_CPP === "string" &&
    process.env.EXECUTION_DOCKER_MEMORY_CPP.trim()) ||
  "1024m";
/** Docker `--cpus` (fractional CPUs allowed). */
const DOCKER_CPU_LIMIT =
  (typeof process.env.EXECUTION_DOCKER_CPUS === "string" && process.env.EXECUTION_DOCKER_CPUS.trim()) || "1";
const DOCKER_CPU_LIMIT_CPP =
  (typeof process.env.EXECUTION_DOCKER_CPUS_CPP === "string" && process.env.EXECUTION_DOCKER_CPUS_CPP.trim()) ||
  DOCKER_CPU_LIMIT;
const DOCKER_PIDS_LIMIT = "64";
export const DOCKER_IMAGE_PYTHON = process.env.EXECUTION_PYTHON_IMAGE || "python:3.11";
const DOCKER_IMAGE_CPP = process.env.EXECUTION_CPP_IMAGE || "gcc:13-bookworm";
const DOCKER_IMAGE_JAVA = process.env.EXECUTION_JAVA_IMAGE || "eclipse-temurin:17-jdk";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Cached presence of runtime images after successful inspect or pull. */
const dockerImageReady = new Map();
/** Singleflight: concurrent callers await the same pull/inspect promise per image. */
const dockerImagePullInflight = new Map();

export const normalizeExecutionLanguage = (language) => {
  const raw = language == null ? "" : String(language).trim();
  if (!raw) return "python";
  const safe = raw.toLowerCase();
  if (safe === "py" || safe === "python") return "python";
  if (safe === "cpp" || safe === "c++" || safe === "cxx" || safe === "cplusplus") return "cpp";
  if (safe === "java") return "java";
  return "python";
};

const normalizeTestCases = (testCases, { skipDedupe = false } = {}) => {
  if (!Array.isArray(testCases)) return [];
  const rows = skipDedupe ? testCases : dedupeTestCases(testCases);
  return rows
    .filter((testcase) => testcase && typeof testcase === "object")
    .map((testcase) => ({
      input: sanitizeInput(testcase?.input ?? null),
      expectedOutput: sanitizeInput(testcase?.expectedOutput ?? null),
      isHidden: Boolean(testcase?.isHidden),
      weight: Number(testcase?.weight) || 1,
    }));
};

/** Count how many editor test cases actually reach the Docker runner. */
export const getTestCaseRunCounts = (testCases, { skipDedupe = false } = {}) => {
  if (!Array.isArray(testCases)) {
    return { submitted: 0, invalid: 0, dedupedDropped: 0, runnable: 0 };
  }
  const submitted = testCases.length;
  const invalid = testCases.filter((tc) => !tc || typeof tc !== "object").length;
  const afterInvalid = testCases.filter((tc) => tc && typeof tc === "object");
  const afterDedupe = skipDedupe ? afterInvalid : dedupeTestCases(afterInvalid);
  const dedupedDropped = skipDedupe ? 0 : Math.max(0, afterInvalid.length - afterDedupe.length);
  const runnable = normalizeTestCases(testCases, { skipDedupe }).length;
  return { submitted, invalid, dedupedDropped, runnable };
};

const parseFunctionName = (functionSignature) => {
  const safe = toSafeString(functionSignature);
  if (!safe) return "";
  // Design-class APIs (multiple methods): resolved via designClassName + command sequence runner.
  if (parseDesignClassNameFromSignature(safe)) return "";
  const { name } = parseFlexibleInterviewSignature(safe);
  if (name) return name;
  const match = safe.match(/([A-Za-z_]\w*)\s*\(/);
  return match?.[1] || "";
};

const buildRunnerScript = () => `
import importlib.util
import json
import os
import sys
import time
import traceback
import builtins
import io
import contextlib

EXECUTION_SUCCESS = "EXECUTION_SUCCESS"
EXECUTION_RUNTIME_ERROR = "EXECUTION_RUNTIME_ERROR"
EXECUTION_COMPILATION_ERROR = "EXECUTION_COMPILATION_ERROR"
EXECUTION_ERROR = "EXECUTION_ERROR"

def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def main():
    config = load_json("testcases.json")
    testcases = config.get("testCases", [])
    function_name = (config.get("functionName") or "").strip()
    start_total = time.perf_counter()

    # Prevent interactive / stdin-driven solutions from hanging at import time.
    # Candidates should submit function-only code for deterministic testcase execution.
    def _blocked_input(*args, **kwargs):
        raise RuntimeError("Interactive input() is not supported in preview. Please define only the required function.")
    builtins.input = _blocked_input
    sys.stdin = io.StringIO("")

    USER_DEBUG_MAX = ${USER_DEBUG_OUTPUT_MAX_BYTES}
    _user_dbg_parts = []
    _user_dbg_bytes = [0]

    def _user_dbg_add(text):
        if not text:
            return
        raw = text.encode("utf-8", errors="replace")
        if _user_dbg_bytes[0] >= USER_DEBUG_MAX:
            return
        room = USER_DEBUG_MAX - _user_dbg_bytes[0]
        chunk = raw[:room].decode("utf-8", errors="replace")
        _user_dbg_parts.append(chunk)
        _user_dbg_bytes[0] += len(chunk.encode("utf-8", errors="replace"))

    def _user_dbg_take():
        return "".join(_user_dbg_parts)

    def safe_print(payload):
        print(json.dumps(payload, ensure_ascii=False), flush=True)

    def _emit(payload):
        if isinstance(payload, dict):
            payload = {**payload, "userDebugOutput": _user_dbg_take()}
        safe_print(payload)

    _any_hidden_in_job = any(bool(tc.get("isHidden")) for tc in testcases)

    def _rows_for_global_error(err_msg):
        rows = []
        for tc in testcases:
            rows.append({
                "passed": False,
                "isHidden": bool(tc.get("isHidden", False)),
                "weight": tc.get("weight", 1),
                "input": tc.get("input"),
                "expectedOutput": tc.get("expectedOutput"),
                "actualOutput": None,
                "error": err_msg,
                "executionTime": 0,
            })
        return rows

    try:
        spec = importlib.util.spec_from_file_location("solution", os.path.join(os.getcwd(), "solution.py"))
        module = importlib.util.module_from_spec(spec)
        _imp_buf = io.StringIO()
        with contextlib.redirect_stdout(_imp_buf):
            spec.loader.exec_module(module)
        if not _any_hidden_in_job:
            _imp_spool = _imp_buf.getvalue()
            if _imp_spool:
                _user_dbg_add("\\n--- (module import) ---\\n" + _imp_spool)
    except SyntaxError as e:
        err = f"SyntaxError: {str(e)}"
        rows = _rows_for_global_error(err)
        _emit({
            "status": EXECUTION_COMPILATION_ERROR,
            "passedCount": 0,
            "failedCount": len(rows),
            "totalCount": len(rows),
            "executionTime": int((time.perf_counter() - start_total) * 1000),
            "memoryUsed": 0,
            "results": rows,
            "error": err,
        })
        return
    except Exception as e:
        err = f"ImportError: {str(e)}"
        rows = _rows_for_global_error(err)
        _emit({
            "status": EXECUTION_COMPILATION_ERROR,
            "passedCount": 0,
            "failedCount": len(rows),
            "totalCount": len(rows),
            "executionTime": int((time.perf_counter() - start_total) * 1000),
            "memoryUsed": 0,
            "results": rows,
            "error": err,
        })
        return

    design_class_name = (config.get("designClassName") or "").strip()

    def _normalize_design_streams(inp):
        # Returns (commands, arguments, skip_ctor_sentinel) or None. When skip_ctor_sentinel is True,
        # the first step constructs the design class but we do not append None (Mongo format often omits
        # ctor null when using capacity + operations rows).
        if isinstance(inp, list) and len(inp) == 2:
            c, a = inp[0], inp[1]
            if isinstance(c, list) and isinstance(a, list) and len(c) == len(a):
                return (c, a, False)
        if not isinstance(inp, dict):
            return None
        for wrap in ("data", "payload", "case", "body", "input"):
            w = inp.get(wrap)
            if isinstance(w, dict):
                nested = _normalize_design_streams(w)
                if nested is not None:
                    return nested
            if isinstance(w, list) and len(w) == 2:
                nested = _normalize_design_streams(w)
                if nested is not None:
                    return nested
        # Matrix ops: {"capacity":2,"operations":[["put",1,1],["get",1], ...]} → ctor + parallel args
        for row_key in ("operations", "actions", "methods", "ops"):
            matrix = inp.get(row_key)
            if not isinstance(matrix, list) or not matrix:
                continue
            if not all(isinstance(r, list) and len(r) >= 1 for r in matrix):
                continue
            cmds = [r[0] for r in matrix]
            args = [list(r[1:]) for r in matrix]
            ctor = (design_class_name or "").strip()
            if ctor and cmds and (
                str(cmds[0]) == ctor or str(cmds[0]).lower() == ctor.lower()
            ):
                return (cmds, args, False)
            cap = inp.get("capacity")
            if ctor and cap is not None:
                return ([ctor] + cmds, [[cap]] + args, True)
            if cmds:
                return (cmds, args, False)
        pairs = (
            ("commands", "arguments"),
            ("commands", "parameters"),
            ("commands", "inputs"),
            ("operations", "operands"),
            ("operations", "parameters"),
            ("operators", "operands"),
            ("actions", "params"),
            ("methods", "arguments"),
            ("functions", "params"),
            ("queries", "parameters"),
        )
        for ck, ak in pairs:
            c = inp.get(ck)
            a = inp.get(ak)
            if isinstance(c, list) and isinstance(a, list) and len(c) == len(a):
                return (c, a, False)
        for key in ("sequence", "testcase", "steps", "calls"):
            seq = inp.get(key)
            if not isinstance(seq, list) or not seq:
                continue
            cmds = []
            args = []
            for row in seq:
                if isinstance(row, list) and len(row) >= 1:
                    cmds.append(row[0])
                    args.append(row[1:])
                elif isinstance(row, dict):
                    m = row.get("method") or row.get("cmd") or row.get("op") or row.get("name")
                    if m is None:
                        return None
                    arg = row.get("args")
                    if arg is None:
                        arg = row.get("arguments") or row.get("params") or row.get("parameters")
                    if isinstance(arg, list):
                        args.append(arg)
                    elif arg is None:
                        args.append([])
                    else:
                        args.append([arg])
                    cmds.append(m)
                else:
                    return None
            if cmds:
                return (cmds, args, False)
        return None

    def _run_design_command_sequence(
        Cls, class_name, commands, arguments, skip_ctor_sentinel=False
    ):
        obj = None
        out = []
        name_str = str(class_name)
        for i, cmd in enumerate(commands):
            row_args = arguments[i] if i < len(arguments) else []
            if not isinstance(row_args, (list, tuple)):
                row_args = [row_args]
            cmd_s = str(cmd)
            if cmd_s == name_str or cmd_s.lower() == name_str.lower():
                obj = Cls(*row_args)
                omit_null = skip_ctor_sentinel and i == 0
                if not omit_null:
                    out.append(None)
                continue
            if obj is None:
                raise RuntimeError(
                    f"First operation must construct {class_name}; got {cmd_s!r}."
                )
            if not hasattr(obj, cmd_s):
                raise RuntimeError(f"No method {cmd_s!r} on {class_name}")
            fn = getattr(obj, cmd_s)
            res = fn(*row_args)
            out.append(res)
        return out

    if design_class_name:
        Cls_design = getattr(module, design_class_name, None)
        if not isinstance(Cls_design, type):
            err = "Expected a class " + design_class_name + " in your submission."
            rows = []
            for tc in testcases:
                rows.append({
                    "passed": False,
                    "isHidden": bool(tc.get("isHidden", False)),
                    "weight": tc.get("weight", 1),
                    "input": tc.get("input"),
                    "expectedOutput": tc.get("expectedOutput"),
                    "actualOutput": None,
                    "error": err,
                    "executionTime": 0,
                })
            _emit({
                "status": EXECUTION_ERROR,
                "passedCount": 0,
                "failedCount": len(rows),
                "totalCount": len(rows),
                "executionTime": int((time.perf_counter() - start_total) * 1000),
                "memoryUsed": 0,
                "results": rows,
                "error": err,
            })
            return
        norms = [_normalize_design_streams(tc.get("input")) for tc in testcases]
        if testcases and all(n is None for n in norms):
            err = (
                'Design-class testcase input shape not recognized. Expected formats such as '
                '{"capacity":2,"operations":[["put",1,1],["get",1],...]}, parallel lists '
                '("commands"/"arguments" or "operations"/"parameters"), or '
                'a "sequence"/"steps"/"calls" list.'
            )
            rows = []
            for tc in testcases:
                rows.append({
                    "passed": False,
                    "isHidden": bool(tc.get("isHidden", False)),
                    "weight": tc.get("weight", 1),
                    "input": tc.get("input"),
                    "expectedOutput": tc.get("expectedOutput"),
                    "actualOutput": None,
                    "error": err,
                    "executionTime": 0,
                })
            _emit({
                "status": EXECUTION_ERROR,
                "passedCount": 0,
                "failedCount": len(rows),
                "totalCount": len(rows),
                "executionTime": int((time.perf_counter() - start_total) * 1000),
                "memoryUsed": 0,
                "results": rows,
                "error": err,
            })
            return
        if testcases and any(n is None for n in norms):
            err = "Mixed testcase shapes are not supported for design-class problems."
            rows = []
            for tc in testcases:
                rows.append({
                    "passed": False,
                    "isHidden": bool(tc.get("isHidden", False)),
                    "weight": tc.get("weight", 1),
                    "input": tc.get("input"),
                    "expectedOutput": tc.get("expectedOutput"),
                    "actualOutput": None,
                    "error": err,
                    "executionTime": 0,
                })
            _emit({
                "status": EXECUTION_ERROR,
                "passedCount": 0,
                "failedCount": len(rows),
                "totalCount": len(rows),
                "executionTime": int((time.perf_counter() - start_total) * 1000),
                "memoryUsed": 0,
                "results": rows,
                "error": err,
            })
            return

        results = []
        passed = 0
        for _case_idx, tc in enumerate(testcases):
            case_start = time.perf_counter()
            inp = tc.get("input")
            expected = tc.get("expectedOutput")
            is_hidden = bool(tc.get("isHidden", False))
            weight = tc.get("weight", 1)
            norm = _normalize_design_streams(inp)
            commands, arguments, skip_ctor_sentinel = norm
            try:
                _cap = io.StringIO()
                with contextlib.redirect_stdout(_cap):
                    actual = _run_design_command_sequence(
                        Cls_design,
                        design_class_name,
                        commands,
                        arguments,
                        skip_ctor_sentinel,
                    )
                if not is_hidden:
                    _sp = _cap.getvalue()
                    if _sp:
                        _user_dbg_add("\\n--- visible case " + str(_case_idx + 1) + " ---\\n" + _sp)
                ok = actual == expected
                if ok:
                    passed += 1
                results.append({
                    "passed": ok,
                    "isHidden": is_hidden,
                    "weight": weight,
                    "input": inp,
                    "expectedOutput": expected,
                    "actualOutput": actual,
                    "error": "",
                    "executionTime": int((time.perf_counter() - case_start) * 1000),
                })
            except Exception as e:
                if not is_hidden:
                    try:
                        _sp = _cap.getvalue()
                    except Exception:
                        _sp = ""
                    if _sp:
                        _user_dbg_add("\\n--- visible case " + str(_case_idx + 1) + " ---\\n" + _sp)
                results.append({
                    "passed": False,
                    "isHidden": is_hidden,
                    "weight": weight,
                    "input": inp,
                    "expectedOutput": expected,
                    "actualOutput": None,
                    "error": "".join(traceback.format_exception_only(type(e), e)).strip(),
                    "executionTime": int((time.perf_counter() - case_start) * 1000),
                })

        total = len(results)
        failed = max(0, total - passed)
        status = EXECUTION_SUCCESS if failed == 0 else EXECUTION_RUNTIME_ERROR
        _emit({
            "status": status,
            "passedCount": passed,
            "failedCount": failed,
            "totalCount": total,
            "executionTime": int((time.perf_counter() - start_total) * 1000),
            "memoryUsed": 0,
            "results": results,
        })
        return

    def _is_runnable_callable(obj):
        # Exclude classes: LeetCode "class Solution" is callable but must not be invoked as target(**inp).
        return callable(obj) and not isinstance(obj, type)

    def _to_leet_camel(snake_or_py_name):
        raw = str(snake_or_py_name or "").strip()
        if not raw:
            return ""
        if "_" not in raw:
            return raw
        parts = [p for p in raw.split("_") if p]
        if not parts:
            return ""
        head = parts[0].lower()
        tail = "".join((p[0].upper() + p[1:].lower()) if len(p) else "" for p in parts[1:])
        return head + tail

    # Extra names LeetCode uses vs our Python def_* signatures (e.g. merge_intervals -> merge).
    _EXTRA_LEETCODE_METHOD_ALIASES = {
        "merge_intervals": ("merge", "mergeIntervals"),
    }

    def _solution_method_candidates(function_name):
        fn = str(function_name or "").strip()
        if not fn:
            return []
        seen = set()
        out = []
        def push(x):
            if x and x not in seen:
                seen.add(x)
                out.append(x)
        push(fn)
        push(_to_leet_camel(fn))
        for alias in _EXTRA_LEETCODE_METHOD_ALIASES.get(fn, ()):
            push(alias)
        return out

    def _bind_solution_method(Sol, function_name):
        if not isinstance(Sol, type):
            return None
        inst = Sol()
        for name in _solution_method_candidates(function_name):
            if not name or not hasattr(inst, name):
                continue
            meth = getattr(inst, name, None)
            if _is_runnable_callable(meth):
                return meth
        return None

    target = None
    if function_name and hasattr(module, function_name):
        cand = getattr(module, function_name)
        if _is_runnable_callable(cand):
            target = cand

    # LeetCode-style: class Solution (try exact name, camelCase, and known aliases like merge).
    if target is None and function_name and hasattr(module, "Solution"):
        Sol = getattr(module, "Solution")
        target = _bind_solution_method(Sol, function_name)

    if target is None and hasattr(module, "solve"):
        sol_fn = getattr(module, "solve")
        if _is_runnable_callable(sol_fn):
            target = sol_fn

    if target is None:
        callable_names = [
            n
            for n in dir(module)
            if not n.startswith("_")
            and _is_runnable_callable(getattr(module, n, None))
        ]
        if callable_names:
            target = getattr(module, callable_names[0])

    if target is None:
        hint = (
            "No callable matched the required entrypoint. "
            "Define a top-level function with the same name as the prompt signature, "
            "or use class Solution with that method name (or common LeetCode camelCase / aliases, e.g. merge_intervals -> merge)."
        )
        rows = _rows_for_global_error(hint)
        _emit({
            "status": EXECUTION_ERROR,
            "passedCount": 0,
            "failedCount": len(rows),
            "totalCount": len(rows),
            "executionTime": int((time.perf_counter() - start_total) * 1000),
            "memoryUsed": 0,
            "results": rows,
            "error": hint,
        })
        return

    results = []
    passed = 0

    for _case_idx, tc in enumerate(testcases):
        case_start = time.perf_counter()
        inp = tc.get("input")
        expected = tc.get("expectedOutput")
        is_hidden = bool(tc.get("isHidden", False))
        weight = tc.get("weight", 1)
        try:
            _cap = io.StringIO()
            with contextlib.redirect_stdout(_cap):
                if isinstance(inp, dict):
                    actual = target(**inp)
                elif isinstance(inp, list):
                    actual = target(*inp)
                elif inp is None:
                    actual = target()
                else:
                    actual = target(inp)
            if not is_hidden:
                _sp = _cap.getvalue()
                if _sp:
                    _user_dbg_add("\\n--- visible case " + str(_case_idx + 1) + " ---\\n" + _sp)
            ok = actual == expected
            if ok:
                passed += 1
            results.append({
                "passed": ok,
                "isHidden": is_hidden,
                "weight": weight,
                "input": inp,
                "expectedOutput": expected,
                "actualOutput": actual,
                "error": "",
                "executionTime": int((time.perf_counter() - case_start) * 1000),
            })
        except Exception as e:
            if not is_hidden:
                try:
                    _sp = _cap.getvalue()
                except Exception:
                    _sp = ""
                if _sp:
                    _user_dbg_add("\\n--- visible case " + str(_case_idx + 1) + " ---\\n" + _sp)
            results.append({
                "passed": False,
                "isHidden": is_hidden,
                "weight": weight,
                "input": inp,
                "expectedOutput": expected,
                "actualOutput": None,
                "error": "".join(traceback.format_exception_only(type(e), e)).strip(),
                "executionTime": int((time.perf_counter() - case_start) * 1000),
            })

    total = len(results)
    failed = max(0, total - passed)
    status = EXECUTION_SUCCESS if failed == 0 else EXECUTION_RUNTIME_ERROR
    _emit({
        "status": status,
        "passedCount": passed,
        "failedCount": failed,
        "totalCount": total,
        "executionTime": int((time.perf_counter() - start_total) * 1000),
        "memoryUsed": 0,
        "results": results,
    })

if __name__ == "__main__":
    main()
`;

const parseRunnerOutput = (stdout) => {
  const safe = toSafeString(stdout);
  if (!safe) return null;

  const lines = safe
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const parsed = JSON.parse(lines[i]);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // continue scanning upward
    }
  }
  try {
    const trimmed = safe.trim();
    const whole = JSON.parse(trimmed);
    if (whole && typeof whole === "object") return whole;
  } catch {
    /* ignore */
  }
  return null;
};

const runDockerSetupCommand = ({ args, timeoutMs, label, dockerImage }) =>
  new Promise((resolve, reject) => {
    const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeoutHandle);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeoutHandle);
      if (timedOut) {
        return reject(
          new Error(`[${label}] timed out after ${timeoutMs}ms for image ${dockerImage}`)
        );
      }
      if (code !== 0) {
        return reject(
          new Error(
            `[${label}] failed for image ${dockerImage} (code=${code}, signal=${signal || "none"}) ${stderr || stdout}`
          )
        );
      }
      return resolve({ stdout, stderr });
    });
  });

export const ensureDockerImage = async (dockerImage) => {
  if (dockerImageReady.get(dockerImage)) return;

  let inflight = dockerImagePullInflight.get(dockerImage);
  if (inflight) {
    await inflight;
    return;
  }

  inflight = (async () => {
    try {
      await runDockerSetupCommand({
        args: ["image", "inspect", dockerImage],
        timeoutMs: 10000,
        label: "image-inspect",
        dockerImage,
      });
      console.log("[executeCode] runtime image present", { image: dockerImage });
    } catch {
      console.warn("[executeCode] runtime image missing; pulling", {
        image: dockerImage,
        pullTimeoutMs: IMAGE_PULL_TIMEOUT_MS,
      });
      await runDockerSetupCommand({
        args: ["pull", dockerImage],
        timeoutMs: IMAGE_PULL_TIMEOUT_MS,
        label: "image-pull",
        dockerImage,
      });
      console.log("[executeCode] runtime image pull complete", { image: dockerImage });
    }
    dockerImageReady.set(dockerImage, true);
  })();

  dockerImagePullInflight.set(dockerImage, inflight);
  try {
    await inflight;
  } finally {
    dockerImagePullInflight.delete(dockerImage);
  }
};

const runDockerCommand = ({ args, timeoutMs = 30000, killSignal = "SIGKILL" }) =>
  new Promise((resolve, reject) => {
    const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill(killSignal);
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeoutHandle);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeoutHandle);
      resolve({ code, signal, stdout, stderr, timedOut });
    });
  });

/**
 * @param {{ tempDir: string, dockerImage: string, containerCommand: string[], filesToCopy: string[], dirsToCopy?: string[], envPairs?: string[] }} opts
 */
export const runDockerExecution = async ({
  tempDir,
  dockerImage,
  containerCommand,
  filesToCopy,
  dirsToCopy = [],
  envPairs = [],
  memoryLimit = DOCKER_MEMORY_LIMIT,
  cpuLimit = DOCKER_CPU_LIMIT,
  timeoutMs = EXECUTION_TIMEOUT_MS,
}) => {
  const createArgs = [
    "create",
    "--network",
    "none",
    "--memory",
    memoryLimit,
    "--cpus",
    cpuLimit,
    "--pids-limit",
    DOCKER_PIDS_LIMIT,
    ...envPairs.flatMap((pair) => ["-e", pair]),
    "-w",
    "/workspace",
    dockerImage,
    ...containerCommand,
  ];

  console.log("[executeCode] container start", {
    image: dockerImage,
    timeoutMs,
    memory: memoryLimit,
    cpus: cpuLimit,
    pidsLimit: DOCKER_PIDS_LIMIT,
  });

  const created = await runDockerCommand({ args: createArgs, timeoutMs: 20000 });
  const containerId = toSafeString(created.stdout).split("\n").pop()?.trim();
  if (!containerId || created.code !== 0) {
    return {
      code: created.code,
      signal: created.signal,
      stdout: created.stdout,
      stderr: created.stderr || "Failed to create execution container",
      timedOut: created.timedOut,
    };
  }

  try {
    for (const fileName of filesToCopy) {
      const cp = await runDockerCommand({
        args: ["cp", path.join(tempDir, fileName), `${containerId}:/workspace/${fileName}`],
        timeoutMs: 30000,
      });
      if (cp.code !== 0) {
        return {
          code: cp.code,
          signal: cp.signal,
          stdout: cp.stdout,
          stderr: cp.stderr || `Failed to copy ${fileName} to execution container`,
          timedOut: cp.timedOut,
        };
      }
    }
    for (const dirName of dirsToCopy) {
      const cp = await runDockerCommand({
        args: ["cp", path.join(tempDir, dirName), `${containerId}:/workspace/${dirName}`],
        timeoutMs: 30000,
      });
      if (cp.code !== 0) {
        return {
          code: cp.code,
          signal: cp.signal,
          stdout: cp.stdout,
          stderr: cp.stderr || `Failed to copy directory ${dirName} to execution container`,
          timedOut: cp.timedOut,
        };
      }
    }

    const started = await runDockerCommand({
      args: ["start", "-a", containerId],
      timeoutMs,
    });
    if (started.timedOut) {
      console.error("[executeCode] timeout", { timeoutMs });
      if (started.stderr.trim()) {
        console.error("[executeCode] timeout stderr snapshot", {
          stderr: started.stderr.slice(-2000),
        });
      }
      if (started.stdout.trim()) {
        console.error("[executeCode] timeout stdout snapshot", {
          stdout: started.stdout.slice(-2000),
        });
      }
      console.error("[executeCode] container force cleanup", {
        reason: "timeout-triggered hard kill",
      });
    }
    console.log("[executeCode] container finish", {
      code: started.code,
      signal: started.signal,
      timedOut: started.timedOut,
    });
    return started;
  } finally {
    await runDockerCommand({
      args: ["rm", "-f", containerId],
      timeoutMs: 15000,
    }).catch(() => {});
  }
};

export async function executeCode({
  language,
  code,
  testCases,
  functionSignature,
  jobId,
  skipTestCaseDedupe = false,
  executionTimeoutMs,
}) {
  const runTimeoutMs =
    Number.isFinite(Number(executionTimeoutMs)) && Number(executionTimeoutMs) > 0
      ? Number(executionTimeoutMs)
      : EXECUTION_TIMEOUT_MS;
  const canonicalLang = normalizeExecutionLanguage(language);
  console.log("[executeCode] execution started", {
    language: canonicalLang,
    testcaseCount: Array.isArray(testCases) ? testCases.length : 0,
    skipTestCaseDedupe,
  });

  const safeCode = toSafeString(code);
  const safeFunctionSignature = toSafeString(functionSignature);
  const normalizedCases = normalizeTestCases(testCases, { skipDedupe: skipTestCaseDedupe });
  const executionJobId = toSafeString(jobId) || randomUUID();

  if (!safeCode || normalizedCases.length === 0) {
    return normalizeExecutionResult({
      status: EXECUTION_ERROR,
      results: [],
      executionTime: 0,
      memoryUsed: 0,
    });
  }

  if (canonicalLang === "cpp" && parseDesignClassNameFromSignature(safeFunctionSignature)) {
    return normalizeExecutionResult({
      status: EXECUTION_ERROR,
      results: [],
      executionTime: 0,
      memoryUsed: 0,
      error:
        'This question uses a multi-method class API (signature like class Name { … }). C++ preview is not wired for that format yet — use Python, or normalize the stored signature to a single free function / method for C++.',
    });
  }

  if (canonicalLang === "java" && parseDesignClassNameFromSignature(safeFunctionSignature)) {
    return normalizeExecutionResult({
      status: EXECUTION_ERROR,
      results: [],
      executionTime: 0,
      memoryUsed: 0,
      error:
        "This question uses a multi-method class API (signature like class Name { … }). Java execution is not wired for that format yet — use Python for design-style problems, or a single-method DSA signature.",
    });
  }

  if (
    canonicalLang === "cpp" &&
    /\bdef\s+\w+\s*\(/.test(safeCode) &&
    !/^\s*#\s*include\b/m.test(safeCode)
  ) {
    return normalizeExecutionResult({
      status: EXECUTION_COMPILATION_ERROR,
      results: [],
      executionTime: 0,
      memoryUsed: 0,
      error:
        "Language is C++ but the submission looks like Python (e.g. `def ...`). Switch the language to Python, or replace the editor with a C++ implementation whose function name and parameters match the question.",
    });
  }

  if (
    canonicalLang === "python" &&
    (/^\s*#\s*include\b/m.test(safeCode) ||
      /\bstd::/.test(safeCode) ||
      /\bvector\s*</.test(safeCode) ||
      /\bpublic\s+class\s+Solution\b/.test(safeCode))
  ) {
    return normalizeExecutionResult({
      status: EXECUTION_COMPILATION_ERROR,
      results: [],
      executionTime: 0,
      memoryUsed: 0,
      error:
        "Language is Python but the submission looks like C++ or Java (e.g. `#include`, `std::`, or `public class Solution`). Switch the language, or paste a Python solution using the `def ...` signature from the prompt.",
    });
  }

  if (
    canonicalLang === "java" &&
    /\bdef\s+\w+\s*\(/.test(safeCode) &&
    !/\bpublic\s+class\b/.test(safeCode)
  ) {
    return normalizeExecutionResult({
      status: EXECUTION_COMPILATION_ERROR,
      results: [],
      executionTime: 0,
      memoryUsed: 0,
      error:
        "Language is Java but the submission looks like Python (e.g. `def ...`). Switch the language to Python, or submit a `public class Solution` whose method matches the Grader contract.",
    });
  }

  if (
    canonicalLang === "java" &&
    (/^\s*#\s*include\b/m.test(safeCode) || /\bstd::/.test(safeCode) || /\bvector\s*</.test(safeCode))
  ) {
    return normalizeExecutionResult({
      status: EXECUTION_COMPILATION_ERROR,
      results: [],
      executionTime: 0,
      memoryUsed: 0,
      error:
        "Language is Java but the submission looks like C++. Switch the language to C++, or replace the editor with Java that matches the Grader contract.",
    });
  }

  if (canonicalLang !== "python" && canonicalLang !== "cpp" && canonicalLang !== "java") {
    return normalizeExecutionResult({
      status: EXECUTION_ERROR,
      results: [],
      executionTime: 0,
      memoryUsed: 0,
      error: "Unsupported language. Use python, cpp, or java.",
    });
  }

  const tempDir = path.join(process.cwd(), "tmp", "execution", executionJobId);

  try {
    await fs.mkdir(tempDir, { recursive: true });
    await fs.writeFile(
      path.join(tempDir, "testcases.json"),
      JSON.stringify(
        {
          functionName: parseFunctionName(safeFunctionSignature),
          designClassName: parseDesignClassNameFromSignature(safeFunctionSignature),
          testCases: normalizedCases,
        },
        null,
        2
      ),
      "utf8"
    );

    let dockerResult;
    if (canonicalLang === "python") {
      await ensureDockerImage(DOCKER_IMAGE_PYTHON);
      await fs.writeFile(path.join(tempDir, "solution.py"), `${safeCode}\n`, "utf8");
      await fs.writeFile(path.join(tempDir, "runner.py"), buildRunnerScript(), "utf8");
      dockerResult = await runDockerExecution({
        tempDir,
        dockerImage: DOCKER_IMAGE_PYTHON,
        containerCommand: ["python", "runner.py"],
        filesToCopy: ["solution.py", "runner.py", "testcases.json"],
        envPairs: ["PYTHONDONTWRITEBYTECODE=1", "PYTHONUNBUFFERED=1"],
        timeoutMs: runTimeoutMs,
      });
    } else if (canonicalLang === "cpp") {
      await ensureDockerImage(DOCKER_IMAGE_CPP);
      const vendorPath = path.join(__dirname, "vendor", "nlohmann", "json.hpp");
      await fs.access(vendorPath).catch(() => {
        throw new Error("Missing services/codeExecution/vendor/nlohmann/json.hpp for C++ execution.");
      });
      await fs.cp(path.join(__dirname, "vendor"), path.join(tempDir, "vendor"), { recursive: true });
      const leetBridge = buildCppLeetcodeBridgeIfNeeded(safeCode, safeFunctionSignature, normalizedCases);
      await fs.writeFile(path.join(tempDir, "solution.cpp"), `${safeCode}\n${leetBridge}`, "utf8");
      const mainCpp = generateCppMainSource({
        functionSignature: safeFunctionSignature,
        testCases: normalizedCases,
      });
      await fs.writeFile(path.join(tempDir, "main.cpp"), mainCpp, "utf8");
      const shellScript =
        "g++ -std=c++17 -O2 -pipe -I/workspace/vendor -o /workspace/a.out /workspace/main.cpp && exec /workspace/a.out";
      dockerResult = await runDockerExecution({
        tempDir,
        dockerImage: DOCKER_IMAGE_CPP,
        containerCommand: ["/bin/sh", "-c", shellScript],
        filesToCopy: ["solution.cpp", "main.cpp", "testcases.json"],
        dirsToCopy: ["vendor"],
        memoryLimit: DOCKER_MEMORY_LIMIT_CPP,
        cpuLimit: DOCKER_CPU_LIMIT_CPP,
        timeoutMs: runTimeoutMs,
      });
    } else {
      await ensureDockerImage(DOCKER_IMAGE_JAVA);
      const gsonJarPath = path.join(__dirname, "vendor", "gson", "gson-2.10.1.jar");
      await fs.access(gsonJarPath).catch(() => {
        throw new Error("Missing services/codeExecution/vendor/gson/gson-2.10.1.jar for Java execution.");
      });
      await fs.copyFile(gsonJarPath, path.join(tempDir, "gson.jar"));
      const mainJava = generateJavaMainSource({
        functionSignature: safeFunctionSignature,
        testCases: normalizedCases,
      });
      await fs.writeFile(path.join(tempDir, "Main.java"), mainJava, "utf8");
      await fs.writeFile(path.join(tempDir, "Solution.java"), `${safeCode}\n`, "utf8");
      const shellScript =
        "javac -encoding UTF-8 -cp /workspace/gson.jar:. Main.java Solution.java && java -cp /workspace/gson.jar:. Main";
      dockerResult = await runDockerExecution({
        tempDir,
        dockerImage: DOCKER_IMAGE_JAVA,
        containerCommand: ["/bin/sh", "-c", shellScript],
        filesToCopy: ["Main.java", "Solution.java", "testcases.json", "gson.jar"],
        memoryLimit: DOCKER_MEMORY_LIMIT_CPP,
        cpuLimit: DOCKER_CPU_LIMIT_CPP,
        timeoutMs: runTimeoutMs,
      });
    }

    if (dockerResult.timedOut) {
      return normalizeExecutionResult({
        status: EXECUTION_TIMEOUT,
        results: [],
        executionTime: runTimeoutMs,
        memoryUsed: 0,
        error: `Execution timed out after ${runTimeoutMs}ms before all test cases finished.`,
      });
    }

    const parsed = parseRunnerOutput(dockerResult.stdout);
    if (!parsed) {
      const merged = `${toSafeString(dockerResult.stderr)}\n${toSafeString(dockerResult.stdout)}`.trim();
      // C++ job is `g++ ... && ./a.out`; non-zero almost always means compile/link failed with no JSON on stdout.
      if (canonicalLang === "cpp" && !dockerResult.timedOut && dockerResult.code !== 0) {
        if (merged) {
          console.error("[executeCode] cpp no JSON output (build/link or early crash)", {
            exitCode: dockerResult.code,
            signal: dockerResult.signal,
            tail: merged.slice(-2500),
          });
        }
        const oomLikely =
          /Killed signal|cc1plus|fatal error:.*[Kk]illed/i.test(merged) &&
          (/cc1plus|g\+\+/i.test(merged) || /compilation terminated/i.test(merged));
        const baseErr = merged.slice(0, 4000) || "C++ compilation or linking failed before the runner printed JSON.";
        const oomHint = oomLikely
          ? " (Likely out-of-memory during compile: raise EXECUTION_DOCKER_MEMORY_CPP on the API host, e.g. 1536m or 2g.)"
          : "";
        return normalizeExecutionResult({
          status: EXECUTION_COMPILATION_ERROR,
          results: [],
          executionTime: 0,
          memoryUsed: 0,
          error: `${baseErr}${oomHint}`,
        });
      }
      if (canonicalLang === "java" && !dockerResult.timedOut && dockerResult.code !== 0) {
        if (merged) {
          console.error("[executeCode] java no JSON output (javac or early crash)", {
            exitCode: dockerResult.code,
            signal: dockerResult.signal,
            tail: merged.slice(-2500),
          });
        }
        const baseErr =
          merged.slice(0, 4000) || "Java compilation or startup failed before the runner printed JSON.";
        return normalizeExecutionResult({
          status: EXECUTION_COMPILATION_ERROR,
          results: [],
          executionTime: 0,
          memoryUsed: 0,
          error: baseErr,
        });
      }
      console.error("[executeCode] runtime error", {
        reason: "Malformed runner output",
        stderr: dockerResult.stderr,
        exitCode: dockerResult.code,
      });
      return normalizeExecutionResult({
        status: EXECUTION_ERROR,
        results: [],
        executionTime: 0,
        memoryUsed: 0,
      });
    }

    const normalized = normalizeExecutionResult(parsed);
    if (normalized.status === EXECUTION_COMPILATION_ERROR) {
      console.error("[executeCode] compilation/import failure", {
        type: EXECUTION_COMPILATION_ERROR,
        language: canonicalLang,
        detail: toSafeString(normalized.error).slice(0, 2000),
      });
    } else if (normalized.status === EXECUTION_RUNTIME_ERROR) {
      console.error("[executeCode] runtime error", { type: EXECUTION_RUNTIME_ERROR });
    } else if (normalized.status === EXECUTION_ERROR) {
      console.error("[executeCode] runtime error", { type: EXECUTION_ERROR });
    }

    console.log("[executeCode] execution completed", {
      language: canonicalLang,
      functionSignature: safeFunctionSignature,
      passedCount: normalized.passedCount,
      failedCount: normalized.failedCount,
      visiblePassedCount: normalized.visiblePassedCount,
      hiddenPassedCount: normalized.hiddenPassedCount,
      weightedPassRate: normalized.weightedPassRate,
    });
    console.log("[executeCode] visible test results", {
      totalVisible: (normalized.results || []).filter((item) => item?.isHidden !== true).length,
      passedVisible: normalized.visiblePassedCount,
    });
    console.log("[executeCode] hidden testcase summary", {
      totalHidden: (normalized.results || []).filter((item) => item?.isHidden === true).length,
      passedHidden: normalized.hiddenPassedCount,
    });
    console.log("[executeCode] weighted pass rate", {
      weightedPassRate: normalized.weightedPassRate,
    });
    return normalized;
  } catch (error) {
    const message = toSafeString(error?.message);
    const mappedStatus =
      /timed out|timeout/i.test(message)
        ? EXECUTION_TIMEOUT
        : /syntaxerror|compilation failed|heterogeneous|C\+\+ harness/i.test(message)
        ? EXECUTION_COMPILATION_ERROR
        : EXECUTION_ERROR;
    console.error("[executeCode] runtime error", {
      status: mappedStatus,
      error: message || error,
    });
    return normalizeExecutionResult({
      status: mappedStatus,
      results: [],
      executionTime: 0,
      memoryUsed: 0,
      error: message || undefined,
    });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
    console.log("[executeCode] cleanup complete", { tempDir });
  }
}

export default executeCode;
