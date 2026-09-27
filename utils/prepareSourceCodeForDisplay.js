function repairSplitForLoopHeaders(code) {
  const lines = String(code ?? "").split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (/^for\s*\(/.test(trimmed) && !/\)\s*(\{|;|$)/.test(trimmed)) {
      let merged = trimmed;
      let j = i + 1;
      while (j < lines.length && !/\)\s*(\{|;|$)/.test(merged)) {
        merged += ` ${lines[j].trim()}`;
        j += 1;
      }
      out.push(merged.replace(/\s+/g, " "));
      i = j - 1;
    } else {
      out.push(line);
    }
  }
  return out.join("\n");
}

function unescapeLiterals(str) {
  return String(str)
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\r/g, "\r");
}

function looksLikeJsonWrapper(str) {
  if (str.length < 2) return false;
  const start = str[0];
  const end = str[str.length - 1];
  return (
    (start === "[" && end === "]") ||
    (start === "{" && end === "}") ||
    (start === '"' && end === '"')
  );
}

function codeNeedsReflow(raw) {
  const text = String(raw ?? "");
  if (!text.trim()) return false;
  const lines = text.split("\n").filter((line) => line.trim());
  if (lines.length <= 1) {
    return text.replace(/\s+/g, " ").trim().length > 60;
  }
  const avg = text.length / lines.length;
  return lines.length <= 4 && avg > 120;
}

function hasHealthyMultilineCode(raw) {
  const lines = String(raw ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return false;
  const reasonable = lines.filter((line) => line.length <= 140).length / lines.length;
  return lines.length >= 2 && reasonable >= 0.55;
}

const CPP_BREAK_BEFORE =
  /\s+(?=#include\b|#define\b|using\s+namespace\b|namespace\s+\w|struct\s+\w|class\s+\w|(?:public|private|protected):|(?:virtual\s+)?(?:void|int|bool|auto|double|float|char|string|vector|map|queue|stack|TreeNode|ListNode|Node)\b|if\s*\(|while\s*\(|return\b|else\b|switch\s*\()/g;

function newlineAfterStatementSemicolons(text) {
  let depth = 0;
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") depth = Math.max(0, depth - 1);
    if (ch === ";" && depth === 0) {
      out += ";\n";
    } else {
      out += ch;
    }
  }
  return out;
}

export function reflowSpacedSourceCode(code, language) {
  const raw = String(code ?? "");
  if (!raw.trim()) return raw;
  if (hasHealthyMultilineCode(raw)) return raw;
  if (!codeNeedsReflow(raw) && raw.includes("\n")) return raw;

  const lang = String(language || "").toLowerCase();
  let out = raw.replace(/\s+/g, " ").trim();

  if (lang === "cpp" || lang === "c" || (lang === "" && /#include\s*[<"]/.test(out))) {
    out = out.replace(/\s*(#include\s+[<"][^>"]+[>"])/g, "\n$1");
    out = out.replace(/\s*(using\s+namespace\s+[\w:]+\s*;)/g, "\n$1");
    out = out.replace(CPP_BREAK_BEFORE, "\n");
    out = newlineAfterStatementSemicolons(out);
    out = out.replace(/\{\s*/g, "{\n");
    out = out.replace(/\s*\}/g, "\n}\n");
    return out.replace(/\n{3,}/g, "\n\n").trim();
  }

  if (lang === "java" || (lang === "" && /\bpublic\s+class\b/.test(out))) {
    out = out.replace(/\s*(package\s+[\w.]+\s*;)/g, "\n$1");
    out = out.replace(/\s*(import\s+[\w.*]+\s*;)/g, "\n$1");
    out = out.replace(/\s*(public\s+class\s+\w+)/g, "\n$1");
    out = out.replace(CPP_BREAK_BEFORE, "\n");
    out = newlineAfterStatementSemicolons(out);
    out = out.replace(/\{\s*/g, "{\n");
    out = out.replace(/\s*\}/g, "\n}\n");
    return out.replace(/\n{3,}/g, "\n\n").trim();
  }

  if (lang === "python" || (lang === "" && /\bdef\s+\w+/.test(out))) {
    out = out.replace(/:\s*(?=return\b|pass\b|break\b|continue\b|[A-Za-z_])/g, ":\n");
    out = out.replace(
      /\s+(?=def |class |import |from |if |for |while |elif |else:|return |try:|except |with |#)/g,
      "\n"
    );
    out = out.replace(/\breturn\s+(?=[a-zA-Z_]\w*\s*=)/g, "return\n");
    return out.trim();
  }

  return raw;
}

export function applyBasicIndent(code, language = "") {
  const lang = String(language || "").toLowerCase();
  const lines = String(code ?? "").split("\n");
  let depth = 0;
  const out = [];
  const unit = lang === "python" ? "    " : "  ";

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      out.push("");
      continue;
    }
    if (lang === "cpp" && trimmed.startsWith("#")) {
      out.push(trimmed);
      continue;
    }
    if (lang === "python" && /^(elif|else|except|finally)\b/.test(trimmed)) {
      depth = Math.max(0, depth - 1);
    }
    if (/^[}\])]/.test(trimmed)) {
      depth = Math.max(0, depth - 1);
    }
    out.push(`${unit.repeat(depth)}${trimmed}`);
    if (lang === "python") {
      if (/:\s*$/.test(trimmed)) depth += 1;
      else if (/^(return|pass|break|continue)\b/.test(trimmed)) {
        depth = Math.max(0, depth - 1);
      }
    } else if (/\{\s*$/.test(trimmed)) {
      depth += 1;
    }
  }
  return out.join("\n");
}

function needsIndentRestore(code, language = "") {
  const lang = String(language || "").toLowerCase();
  const rawLines = String(code ?? "").split("\n");
  const lines = rawLines.map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return false;
  if (lang === "python") {
    const hasLeading = rawLines.some((line) => line.trim() && /^(\s{4}|\t)/.test(line));
    if (!hasLeading) return true;
  }
  const indented = rawLines.filter((line) => line.trim() && /^(\s{2,}|\t)/.test(line)).length;
  return indented / lines.length < 0.15;
}

export function prepareSourceCodeForDisplay(raw, language) {
  const lang = String(language || "").toLowerCase();
  let str = String(raw ?? "").trim();
  if (!str) return "";

  if (looksLikeJsonWrapper(str)) {
    try {
      const parsed = JSON.parse(str);
      if (typeof parsed === "string") str = parsed;
    } catch {
      // keep str
    }
  }

  let text = unescapeLiterals(str);
  text = reflowSpacedSourceCode(text, lang);
  if (lang === "cpp" || lang === "c" || lang === "java") {
    text = repairSplitForLoopHeaders(text);
  }
  if (needsIndentRestore(text, lang)) {
    text = applyBasicIndent(text, lang);
  }
  return text;
}
