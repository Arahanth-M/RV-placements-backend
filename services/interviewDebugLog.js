/**
 * Grep Docker/backend logs: interview-dsa-llm-debug
 * Traces DSA vs LLM paths for per-question grading and per-round feedback.
 *
 * Notable events:
 * - code_execution_deterministic_feedback — testcase counts + score (code path)
 * - evaluate_answer_rubric_path_despite_testcases — tests present but strategy is rubric_llm
 * - coding_style_round_using_non_code_evaluator — round treated as coding/DSA but not code_execution
 * - rubric_eval_coding_shape_llm_may_run — rubric path on code-shaped answer (LLM may run)
 */

const TAG = "[interview-dsa-llm-debug]";

const tailId = (id) => {
  const s = id == null ? "" : String(id);
  return s.length <= 10 ? s : s.slice(-10);
};

export function logInterviewDsaLlmDebug(event, details = {}) {
  try {
    const payload = {
      event,
      ts: new Date().toISOString(),
      ...details,
    };
    console.info(TAG, JSON.stringify(payload));
  } catch {
    // ignore logging failures
  }
}

export { tailId };
