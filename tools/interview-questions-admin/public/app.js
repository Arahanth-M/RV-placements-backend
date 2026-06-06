const state = {
  questions: [],
  selectedId: null,
  selectedDoc: null,
  isNew: false,
};

const $ = (sel) => document.querySelector(sel);
const jsonEditor = $("#json-editor");
const solutionEditor = $("#solution-editor");
const questionList = $("#question-list");
const statusEl = $("#status");
const testResults = $("#test-results");
const testcaseList = $("#testcase-list");
const tcSummary = $("#tc-summary");
const questionMeta = $("#question-meta");

const EMPTY_TEMPLATE = {
  questionId: "new-question-id",
  title: "New Question",
  question: "Describe the problem here.",
  url: "",
  companyTags: [],
  roundType: "DSA",
  difficulty: "medium",
  topics: [],
  subtopics: [],
  evaluationStrategy: "code_execution",
  dsaMetadata: {
    supportedLanguages: ["python", "cpp", "java"],
    starterCode: null,
    functionSignature: "",
  },
  testCases: [
    { input: {}, expectedOutput: null, isHidden: false, weight: 1 },
    { input: {}, expectedOutput: null, isHidden: false, weight: 1 },
    { input: {}, expectedOutput: null, isHidden: true, weight: 1 },
    { input: {}, expectedOutput: null, isHidden: true, weight: 1 },
  ],
  rubric: [],
  complexity: { time: "", space: "" },
  sqlMetadata: {
    databaseSchema: "",
    seedData: null,
    expectedResult: null,
    validationRules: [],
  },
  systemDesignMetadata: { requiredConcepts: [] },
  hrMetadata: { behavioralSignals: [] },
  analytics: {
    timesUsed: 0,
    successRate: 0,
    averageScore: 0,
    averageCompletionTime: 0,
  },
  sourceMetadata: { source: "curated", verified: false, qualityScore: 0.5 },
};

function setStatus(msg, type = "") {
  statusEl.textContent = msg;
  statusEl.className = `status ${type}`;
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
  return data;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseJsonField(raw, fieldName) {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`${fieldName}: invalid JSON — ${e.message}`);
  }
}

function stringifyField(value) {
  if (value === undefined || value === null) return "";
  return JSON.stringify(value, null, 2);
}

function parseEditorJson() {
  try {
    return JSON.parse(jsonEditor.value);
  } catch (e) {
    throw new Error(`Invalid JSON: ${e.message}`);
  }
}

function getTestCasesFromEditor() {
  const doc = parseEditorJson();
  return Array.isArray(doc.testCases) ? doc.testCases : [];
}

function writeTestCasesToEditor(testCases) {
  const doc = parseEditorJson();
  doc.testCases = testCases;
  jsonEditor.value = JSON.stringify(doc, null, 2);
  state.selectedDoc = doc;
  renderTestCasesUI(testCases);
  renderQuestionMeta(doc);
}

function testCaseStats(testCases) {
  const all = Array.isArray(testCases) ? testCases : [];
  return {
    total: all.length,
    visible: all.filter((t) => t?.isHidden !== true).length,
    hidden: all.filter((t) => t?.isHidden === true).length,
  };
}

function formatTestCaseSummary(stats) {
  return `${stats.total} test cases · ${stats.visible} visible · ${stats.hidden} hidden`;
}

function renderQuestionMeta(doc) {
  if (!doc) {
    questionMeta.classList.add("hidden");
    return;
  }
  questionMeta.classList.remove("hidden");
  const stats = testCaseStats(doc.testCases || []);
  questionMeta.innerHTML = `
    <div class="meta-chip"><strong>${escapeHtml(doc.questionId)}</strong></div>
    <div class="meta-chip">${escapeHtml(doc.title)}</div>
    <div class="meta-chip">${escapeHtml(doc.roundType)} · ${escapeHtml(doc.difficulty)}</div>
    <div class="meta-chip">${formatTestCaseSummary(stats)}</div>
  `;
}

function renderTestCasesUI(testCases) {
  const cases = Array.isArray(testCases) ? testCases : [];
  const stats = testCaseStats(cases);
  tcSummary.textContent = formatTestCaseSummary(stats);

  testcaseList.innerHTML = "";

  if (cases.length === 0) {
    testcaseList.innerHTML = '<div class="empty-state">No test cases yet — add one below</div>';
    return;
  }

  cases.forEach((tc, i) => {
    const card = document.createElement("div");
    card.className = "testcase-card";
    card.dataset.index = String(i);

    const header = document.createElement("div");
    header.className = "tc-card-header";
    header.innerHTML = `
      <span class="tc-index">#${i + 1}</span>
      <span class="tc-badge ${tc.isHidden ? "hidden-badge" : "visible-badge"}">${tc.isHidden ? "Hidden" : "Visible"}</span>
    `;

    const actions = document.createElement("div");
    actions.className = "tc-card-actions";

    const toggleLabel = document.createElement("label");
    toggleLabel.className = "toggle-row compact";
    toggleLabel.innerHTML = `<span>Hidden</span>`;
    const switchLabel = document.createElement("label");
    switchLabel.className = "switch";
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.className = "tc-hidden-toggle";
    toggle.dataset.index = String(i);
    toggle.checked = Boolean(tc.isHidden);
    const sliderSpan = document.createElement("span");
    sliderSpan.className = "slider";
    switchLabel.append(toggle, sliderSpan);
    toggleLabel.append(switchLabel);

    const weightLabel = document.createElement("label");
    weightLabel.className = "weight-row compact";
    weightLabel.append("W ");
    const weightInput = document.createElement("input");
    weightInput.type = "number";
    weightInput.className = "tc-weight";
    weightInput.dataset.index = String(i);
    weightInput.min = "0";
    weightInput.step = "1";
    weightInput.value = String(Number(tc.weight ?? 1));
    weightLabel.append(weightInput);

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "danger-btn tc-delete";
    delBtn.dataset.index = String(i);
    delBtn.textContent = "Delete";

    actions.append(toggleLabel, weightLabel, delBtn);
    header.append(actions);

    const body = document.createElement("div");
    body.className = "tc-card-body";

    const inputLabel = document.createElement("label");
    inputLabel.innerHTML = "<span>Input</span>";
    const inputTa = document.createElement("textarea");
    inputTa.className = "tc-input";
    inputTa.dataset.index = String(i);
    inputTa.spellcheck = false;
    inputTa.value = stringifyField(tc.input);
    inputLabel.append(inputTa);

    const outputLabel = document.createElement("label");
    outputLabel.innerHTML = "<span>Expected output</span>";
    const outputTa = document.createElement("textarea");
    outputTa.className = "tc-output";
    outputTa.dataset.index = String(i);
    outputTa.spellcheck = false;
    outputTa.value = stringifyField(tc.expectedOutput);
    outputLabel.append(outputTa);

    body.append(inputLabel, outputLabel);
    card.append(header, body);
    testcaseList.append(card);

    toggle.addEventListener("change", () => updateTestCase(i, { isHidden: toggle.checked }));
    weightInput.addEventListener("change", () => updateTestCase(i, { weight: Number(weightInput.value) || 1 }));
    inputTa.addEventListener("blur", () => {
      try {
        updateTestCase(i, { input: parseJsonField(inputTa.value, "Input") });
      } catch (e) {
        setStatus(e.message, "error");
      }
    });
    outputTa.addEventListener("blur", () => {
      try {
        updateTestCase(i, { expectedOutput: parseJsonField(outputTa.value, "Expected output") });
      } catch (e) {
        setStatus(e.message, "error");
      }
    });
    delBtn.addEventListener("click", () => deleteTestCase(i));
  });
}

function updateTestCase(index, patch) {
  try {
    const cases = getTestCasesFromEditor();
    if (!cases[index]) return;
    cases[index] = { ...cases[index], ...patch };
    writeTestCasesToEditor(cases);
    setStatus(`Updated test case #${index + 1}`, "success");
  } catch (e) {
    setStatus(e.message, "error");
  }
}

function deleteTestCase(index) {
  try {
    const cases = getTestCasesFromEditor();
    if (!confirm(`Delete test case #${index + 1}?`)) return;
    cases.splice(index, 1);
    writeTestCasesToEditor(cases);
    setStatus("Test case deleted", "success");
  } catch (e) {
    setStatus(e.message, "error");
  }
}

function addTestCase({ input, expectedOutput, isHidden, weight }) {
  try {
    const cases = getTestCasesFromEditor();
    cases.push({
      input: parseJsonField(input, "Input") ?? {},
      expectedOutput: parseJsonField(expectedOutput, "Expected output"),
      isHidden: Boolean(isHidden),
      weight: Number(weight) || 1,
    });
    writeTestCasesToEditor(cases);
    setStatus("Test case added", "success");
  } catch (e) {
    setStatus(e.message, "error");
    throw e;
  }
}

function clearAddForm() {
  $("#new-tc-input").value = "";
  $("#new-tc-output").value = "";
  $("#new-tc-hidden").checked = false;
  $("#new-tc-weight").value = "1";
}

function handleAddFromForm() {
  addTestCase({
    input: $("#new-tc-input").value,
    expectedOutput: $("#new-tc-output").value,
    isHidden: $("#new-tc-hidden").checked,
    weight: $("#new-tc-weight").value,
  });
  clearAddForm();
}

function addBlankTestCase() {
  try {
    const cases = getTestCasesFromEditor();
    cases.push({ input: {}, expectedOutput: null, isHidden: false, weight: 1 });
    writeTestCasesToEditor(cases);
    setStatus("Blank test case added", "success");
    testcaseList.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (e) {
    setStatus(e.message, "error");
  }
}

function normalizeBulkTestCase(raw, index) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Item #${index + 1} must be an object with input & expectedOutput`);
  }
  if (raw.input === undefined) {
    throw new Error(`Item #${index + 1} is missing "input"`);
  }
  if (raw.expectedOutput === undefined) {
    throw new Error(`Item #${index + 1} is missing "expectedOutput"`);
  }
  return {
    input: raw.input,
    expectedOutput: raw.expectedOutput,
    isHidden: true,
    weight: Number.isFinite(Number(raw.weight)) ? Number(raw.weight) : 1,
  };
}

function parseBulkTestCasesPaste(rawText) {
  const text = String(rawText ?? "").trim();
  if (!text) throw new Error("Paste a testCases JSON array first");

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid JSON: ${e.message}`);
  }

  if (Array.isArray(parsed)) {
    if (parsed.length === 0) throw new Error("Array is empty — nothing to insert");
    return parsed.map(normalizeBulkTestCase);
  }

  if (parsed && typeof parsed === "object" && Array.isArray(parsed.testCases)) {
    if (parsed.testCases.length === 0) throw new Error("testCases array is empty");
    return parsed.testCases.map(normalizeBulkTestCase);
  }

  throw new Error('Expected a testCases array, e.g. [{ "input": {}, "expectedOutput": ... }, ...]');
}

function insertAllBulkTestCases() {
  try {
    if (!jsonEditor.value.trim()) {
      setStatus("Select or create a question first", "error");
      return;
    }

    const incoming = parseBulkTestCasesPaste($("#bulk-tc-paste").value);
    const existing = getTestCasesFromEditor();
    const merged = [...existing, ...incoming];
    writeTestCasesToEditor(merged);
    $("#bulk-tc-paste").value = "";
    setStatus(`Inserted ${incoming.length} hidden test case(s) — ${merged.length} total`, "success");
    testcaseList.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (e) {
    setStatus(e.message, "error");
  }
}

function renderList() {
  questionList.innerHTML = "";
  if (state.questions.length === 0) {
    questionList.innerHTML = '<div class="empty-state">No questions match filters</div>';
    return;
  }

  for (const q of state.questions) {
    const id = String(q._id);
    const el = document.createElement("div");
    el.className = `question-item${id === String(state.selectedId) ? " active" : ""}`;
    el.innerHTML = `
      <div class="qid">${escapeHtml(q.questionId)}</div>
      <div class="title">${escapeHtml(q.title)}</div>
      <div class="meta">${escapeHtml(q.roundType)} · ${escapeHtml(q.difficulty)} · ${q.testCases?.length || 0} tests</div>
    `;
    el.addEventListener("click", () => selectQuestion(id));
    questionList.appendChild(el);
  }
}

function showDoc(doc, isNew = false) {
  state.selectedDoc = doc;
  state.isNew = isNew;
  state.selectedId = isNew ? null : doc._id;
  jsonEditor.value = JSON.stringify(doc, null, 2);
  renderQuestionMeta(doc);
  renderTestCasesUI(doc.testCases || []);
  renderList();
  setStatus(isNew ? "New document (unsaved)" : `Loaded ${doc.questionId}`);
  testResults.textContent = "Results appear here";
}

async function loadQuestions(retry = 0) {
  const params = new URLSearchParams();
  const roundType = $("#filter-roundType").value;
  const search = $("#filter-search").value.trim();
  if (roundType) params.set("roundType", roundType);
  if (search) params.set("search", search);

  setStatus("Loading…");
  try {
    const health = await api("/api/health");
    if (!health.dbConnected) {
      if (retry < 15) {
        setStatus(`DB connecting… retry ${retry + 1}/15`);
        questionList.innerHTML = '<div class="empty-state">MongoDB connecting — retrying…</div>';
        setTimeout(() => loadQuestions(retry + 1), 2000);
        return;
      }
      setStatus(`DB not connected: ${health.dbError || "check MONGO_URI"}`, "error");
      questionList.innerHTML = '<div class="empty-state">MongoDB not connected. Check terminal / .env</div>';
      state.questions = [];
      return;
    }

    const data = await api(`/api/questions?${params}`);
    state.questions = data.questions;
    renderList();

    if (data.count === 0 && !roundType && !search) {
      setStatus(
        `0 questions in ${health.dbName || "db"}.${health.collection || "interviewquestions"} — check MONGO_URI`,
        "error"
      );
      questionList.innerHTML = `<div class="empty-state">No questions in database.<br><br>Connected to: <strong>${escapeHtml(health.dbName || "?")}</strong> / <strong>${escapeHtml(health.collection || "?")}</strong><br>URI: ${escapeHtml(health.mongoUri || "?")}<br><br>If this is wrong, fix <code>MONGO_URI</code> in <code>RV-placements-backend/.env</code> and restart the server.</div>`;
    } else if (data.count === 0) {
      setStatus("No questions match filters — try All round types", "error");
    } else {
      setStatus(`${data.count} questions`, "success");
    }
  } catch (e) {
    setStatus(e.message, "error");
    questionList.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
  }
}

async function selectQuestion(id) {
  if (state.isNew && !confirm("Discard unsaved new document?")) return;
  const data = await api(`/api/questions/${id}`);
  showDoc(data.question);
}

function createNew() {
  showDoc(structuredClone(EMPTY_TEMPLATE), true);
}

async function saveDocument() {
  try {
    const payload = parseEditorJson();
    delete payload._id;
    delete payload.__v;
    delete payload.createdAt;
    delete payload.updatedAt;

    if (state.isNew) {
      const data = await api("/api/questions", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      await loadQuestions();
      showDoc(data.question);
      setStatus("Created successfully", "success");
    } else {
      const data = await api(`/api/questions/${state.selectedId}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      await loadQuestions();
      showDoc(data.question);
      setStatus("Saved successfully", "success");
    }
  } catch (e) {
    setStatus(e.message, "error");
  }
}

async function deleteDocument() {
  if (state.isNew) {
    state.isNew = false;
    state.selectedId = null;
    jsonEditor.value = "";
    testcaseList.innerHTML = "";
    questionMeta.classList.add("hidden");
    setStatus("Discarded new document");
    return;
  }
  if (!state.selectedId) return;
  if (!confirm(`Delete ${state.selectedDoc?.questionId}? This cannot be undone.`)) return;

  try {
    await api(`/api/questions/${state.selectedId}`, { method: "DELETE" });
    state.selectedId = null;
    state.selectedDoc = null;
    jsonEditor.value = "";
    testcaseList.innerHTML = "";
    questionMeta.classList.add("hidden");
    await loadQuestions();
    setStatus("Deleted", "success");
  } catch (e) {
    setStatus(e.message, "error");
  }
}

async function runTests() {
  if (state.isNew || !state.selectedId) {
    setStatus("Save the document before running tests", "error");
    return;
  }

  const code = solutionEditor.value.trim();
  if (!code) {
    setStatus("Enter solution code first", "error");
    switchTab("runner");
    return;
  }

  let doc;
  try {
    doc = parseEditorJson();
  } catch (e) {
    setStatus(`Fix JSON before running tests: ${e.message}`, "error");
    return;
  }

  const testCases = Array.isArray(doc.testCases) ? doc.testCases : [];
  if (testCases.length === 0) {
    setStatus("No test cases — add some in the Test Cases tab", "error");
    switchTab("testcases");
    return;
  }

  testResults.textContent = "Running…";
  setStatus(`Running ${testCases.length} test case(s)…`);

  try {
    const data = await api(`/api/questions/${state.selectedId}/run-tests`, {
      method: "POST",
      body: JSON.stringify({
        code,
        language: $("#test-language").value,
        testCases,
        functionSignature: doc.dsaMetadata?.functionSignature || "",
      }),
    });

    renderTestResults(data.result, data, testCases);
    setStatus("Test run complete", data.result?.status === "EXECUTION_SUCCESS" ? "success" : "error");
    switchTab("runner");
  } catch (e) {
    testResults.textContent = e.message;
    setStatus(e.message, "error");
  }
}

function renderTestResults(r, meta = {}, sourceTestCases = []) {
  const expected = sourceTestCases.length || meta.testCaseCountExecuted || r.results?.length || 0;
  const returned = Array.isArray(r.results) ? r.results.length : 0;
  const counts = meta.testCaseCounts || {};
  const runnable = counts.runnable ?? meta.runnerTotalCount ?? returned;

  const lines = [
    `Status: ${r.status}`,
    `Passed: ${r.passedCount ?? 0} / Failed: ${r.failedCount ?? 0} / Total: ${expected}`,
    `Editor: ${expected} case(s) · Sent to runner: ${runnable} · Results returned: ${returned}`,
  ];

  if (meta.language) lines.push(`Language: ${meta.language}`);
  if (meta.functionSignature) lines.push(`Signature: ${meta.functionSignature || "(empty — may cause errors for C++/Java)"}`);

  if (returned < expected) {
    lines.push("", "── Why fewer results than editor cases? ──");
    if (counts.invalid > 0) {
      lines.push(
        `${counts.invalid} slot(s) in testCases are null or not objects — they are dropped before Docker runs.`
      );
    }
    if (counts.dedupedDropped > 0) {
      lines.push(
        `${counts.dedupedDropped} duplicate case(s) removed (same input + expectedOutput). Admin tool should not dedupe; restart the admin server if you still see this.`
      );
    }
    if (runnable < expected && counts.invalid === 0 && counts.dedupedDropped === 0) {
      lines.push(`Only ${runnable} of ${expected} editor cases were sent to the runner.`);
    }
    if (r.status === "EXECUTION_TIMEOUT") {
      lines.push(
        `Docker hit the ${meta.executionTimeoutMs ?? 60000}ms timeout and killed the run before every case finished.`
      );
    } else if (returned < runnable) {
      lines.push(
        `Runner reported ${returned} result(s) but ${runnable} case(s) were sent — often caused by solution code printing JSON to stdout (avoid print(json.dumps(...))).`
      );
    } else if (returned === runnable && runnable < expected) {
      lines.push(`Cases #${runnable + 1}–#${expected} were never sent to Docker (see reasons above).`);
    }
  }

  if (r.error) {
    lines.push("", "── Error ──", r.error);
  }

  if (r.userDebugOutput) {
    lines.push("", "── Debug output ──", r.userDebugOutput);
  }

  lines.push("", "── Per test case (same # as Test Cases tab) ──");
  for (let i = 0; i < expected; i++) {
    const tc = r.results?.[i];
    const src = sourceTestCases[i];
    const hidden = src?.isHidden ? " (hidden)" : "";
    if (!tc) {
      const reason =
        i >= runnable
          ? "not sent to runner"
          : i >= returned
            ? "no result in runner output"
            : "no result returned";
      lines.push(`[????] Case #${i + 1}${hidden} — ${reason}`);
      lines.push("");
      continue;
    }
    const ok = tc.passed === true;
    lines.push(`[${ok ? "PASS" : "FAIL"}] Case #${i + 1}${hidden}`);
    if (tc.error) lines.push(`  error: ${tc.error}`);
    if (tc.actualOutput !== undefined) lines.push(`  actual: ${JSON.stringify(tc.actualOutput)}`);
    else if (src?.expectedOutput !== undefined) lines.push(`  actual: (none)`);
    const expectedOut = tc.expectedOutput !== undefined ? tc.expectedOutput : src?.expectedOutput;
    if (expectedOut !== undefined) lines.push(`  expected: ${JSON.stringify(expectedOut)}`);
    lines.push("");
  }

  if (expected === 0 && !r.error && r.status === "EXECUTION_ERROR") {
    lines.push(
      "",
      "── Hint ──",
      "No per-test results returned. Is Docker running?",
      "Code execution needs Docker (images: python:3.11, gcc:13-bookworm, eclipse-temurin:17-jdk).",
      "Also check: language matches your solution, and dsaMetadata.functionSignature is set."
    );
  }

  testResults.innerHTML = lines
    .map((line) => {
      if (line.startsWith("[PASS]")) return `<span class="pass">${escapeHtml(line)}</span>`;
      if (line.startsWith("[FAIL]")) return `<span class="fail">${escapeHtml(line)}</span>`;
      if (line.startsWith("[????]")) return `<span class="warn">${escapeHtml(line)}</span>`;
      if (line.startsWith("── Error ──") || line.startsWith("── Hint ──") || line.startsWith("── Why fewer")) {
        return `<span class="fail">${escapeHtml(line)}</span>`;
      }
      return escapeHtml(line);
    })
    .join("\n");
}

function formatJson() {
  try {
    jsonEditor.value = JSON.stringify(parseEditorJson(), null, 2);
    setStatus("Formatted JSON", "success");
  } catch (e) {
    setStatus(e.message, "error");
  }
}

function reloadTestCasesFromJson() {
  try {
    const doc = parseEditorJson();
    renderTestCasesUI(doc.testCases || []);
    renderQuestionMeta(doc);
    setStatus("Test cases reloaded from JSON", "success");
  } catch (e) {
    setStatus(e.message, "error");
  }
}

function switchTab(name) {
  document.querySelectorAll(".tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.tab === name);
  });
  document.querySelectorAll(".tab-panel").forEach((p) => {
    p.classList.toggle("active", p.id === `panel-${name}`);
  });
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => switchTab(tab.dataset.tab));
});

$("#btn-refresh").addEventListener("click", loadQuestions);
$("#btn-new").addEventListener("click", createNew);
$("#btn-save").addEventListener("click", saveDocument);
$("#btn-delete").addEventListener("click", deleteDocument);
$("#btn-format").addEventListener("click", formatJson);
$("#btn-sync-from-json").addEventListener("click", reloadTestCasesFromJson);
$("#btn-run-tests").addEventListener("click", runTests);
$("#btn-add-testcase").addEventListener("click", handleAddFromForm);
$("#btn-add-empty-tc").addEventListener("click", addBlankTestCase);
$("#btn-insert-all-tc").addEventListener("click", insertAllBulkTestCases);
$("#filter-roundType").addEventListener("change", loadQuestions);

$("#new-tc-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    handleAddFromForm();
  }
});

$("#new-tc-output").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    handleAddFromForm();
  }
});

let searchTimer;
$("#filter-search").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadQuestions, 300);
});

loadQuestions();
