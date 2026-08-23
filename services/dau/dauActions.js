/** Coarse DAU activity keys. Additive only — never required on existing rows. */

export const DAU_ACTION_LOGIN = "login";
export const DAU_ACTION_OPENED_COMPANY = "opened_company";
export const DAU_ACTION_SUBMITTED_CONTENT = "submitted_content";
export const DAU_ACTION_HELPFUL = "helpful";
export const DAU_ACTION_AI_INTERVIEW = "ai_interview";
export const DAU_ACTION_PREP_PATH = "prep_path";

export const DAU_ACTION_ORDER = [
  DAU_ACTION_LOGIN,
  DAU_ACTION_OPENED_COMPANY,
  DAU_ACTION_SUBMITTED_CONTENT,
  DAU_ACTION_HELPFUL,
  DAU_ACTION_AI_INTERVIEW,
  DAU_ACTION_PREP_PATH,
];

export const DAU_ACTION_LABELS = {
  [DAU_ACTION_LOGIN]: "Logged in",
  [DAU_ACTION_OPENED_COMPANY]: "Opened a company",
  [DAU_ACTION_SUBMITTED_CONTENT]: "Submitted content",
  [DAU_ACTION_HELPFUL]: "Helpful vote",
  [DAU_ACTION_AI_INTERVIEW]: "AI interview",
  [DAU_ACTION_PREP_PATH]: "PrepPath",
};

const ALLOWED = new Set(DAU_ACTION_ORDER);

export function normalizeDauAction(raw) {
  const key = String(raw || "")
    .trim()
    .toLowerCase();
  return ALLOWED.has(key) ? key : "";
}

export function normalizeDauActions(raw) {
  const list = Array.isArray(raw) ? raw : raw == null || raw === "" ? [] : [raw];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const key = normalizeDauAction(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return DAU_ACTION_ORDER.filter((key) => seen.has(key));
}

export function normalizeOpenedCompanyName(raw) {
  const name = String(raw || "").replace(/\s+/g, " ").trim();
  if (!name) return "";
  return name.length > 80 ? name.slice(0, 80) : name;
}

export function normalizeOpenedCompanyNames(raw) {
  const list = Array.isArray(raw) ? raw : raw == null || raw === "" ? [] : [raw];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const name = normalizeOpenedCompanyName(item);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

export function formatDauActionLabels(
  raw,
  openedCompanies = [],
  prepPathCompanies = []
) {
  const keys = normalizeDauActions(raw);
  const names = normalizeOpenedCompanyNames(openedCompanies);
  const prepNames = normalizeOpenedCompanyNames(prepPathCompanies);
  const labels = [];
  for (const key of keys) {
    if (key === DAU_ACTION_OPENED_COMPANY) {
      if (names.length > 0) {
        for (const name of names) labels.push(`Opened ${name}`);
      } else {
        labels.push(DAU_ACTION_LABELS[key]);
      }
      continue;
    }
    if (key === DAU_ACTION_PREP_PATH) {
      if (prepNames.length > 0) {
        for (const name of prepNames) labels.push(`PrepPath · ${name}`);
      } else {
        labels.push(DAU_ACTION_LABELS[key]);
      }
      continue;
    }
    labels.push(DAU_ACTION_LABELS[key]);
  }
  if (names.length > 0 && !keys.includes(DAU_ACTION_OPENED_COMPANY)) {
    for (const name of names) labels.push(`Opened ${name}`);
  }
  if (prepNames.length > 0 && !keys.includes(DAU_ACTION_PREP_PATH)) {
    for (const name of prepNames) labels.push(`PrepPath · ${name}`);
  }
  return labels;
}
