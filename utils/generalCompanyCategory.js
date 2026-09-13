export const GENERAL_COMPANY_CATEGORY_FINTECH = "fintech";
export const GENERAL_COMPANY_CATEGORY_ECOMMERCE = "ecommerce";
export const GENERAL_COMPANY_CATEGORY_AIML_CYBER = "aiml-cyber";
export const GENERAL_COMPANY_CATEGORY_SEMICONDUCTORS = "semiconductors";
export const GENERAL_COMPANY_CATEGORY_ENTERPRISE = "enterprise";
export const GENERAL_COMPANY_CATEGORY_PRODUCT = "product";
export const GENERAL_COMPANY_CATEGORY_SERVICE = "service";
export const GENERAL_COMPANY_CATEGORY_STARTUP = "startup";
export const GENERAL_COMPANY_CATEGORY_OTHERS = "others";

export const GENERAL_COMPANY_CATEGORIES = [
  {
    id: GENERAL_COMPANY_CATEGORY_FINTECH,
    label: "Fintech",
    subtitle: "Finance, payments, and banking companies",
  },
  {
    id: GENERAL_COMPANY_CATEGORY_ECOMMERCE,
    label: "E-commerce",
    subtitle: "Marketplaces, retail, and online commerce",
  },
  {
    id: GENERAL_COMPANY_CATEGORY_AIML_CYBER,
    label: "AI/ML and Cyber Security",
    subtitle: "Artificial intelligence, machine learning, and cybersecurity",
  },
  {
    id: GENERAL_COMPANY_CATEGORY_SEMICONDUCTORS,
    label: "Semiconductors",
    subtitle: "Chip design, VLSI, and semiconductor companies",
  },
  {
    id: GENERAL_COMPANY_CATEGORY_ENTERPRISE,
    label: "Enterprise Software",
    subtitle: "Enterprise, SaaS, ERP, and B2B software",
  },
  {
    id: GENERAL_COMPANY_CATEGORY_PRODUCT,
    label: "Product based companies",
    subtitle: "Product and PBC companies",
  },
  {
    id: GENERAL_COMPANY_CATEGORY_SERVICE,
    label: "Service based companies",
    subtitle: "IT services and consulting companies",
  },
  {
    id: GENERAL_COMPANY_CATEGORY_STARTUP,
    label: "Startup",
    subtitle: "Early-stage and startup companies",
  },
  {
    id: GENERAL_COMPANY_CATEGORY_OTHERS,
    label: "Others",
    subtitle: "Companies that don’t fit the groups above",
  },
];

const FINTECH_PATTERNS = [
  /\bfin\s*tech\b/,
  /\bfintech\b/,
  /\bfinancial technology\b/,
  /\bpayments?\b/,
  /\bbanking\b/,
  /\binsurtech\b/,
  /\bwealthtech\b/,
  /\blending\b/,
  /\bnbfc\b/,
  /\bneobank\b/,
  /\bdigital bank/,
];

const ECOMMERCE_PATTERNS = [
  /\be\s*commerce\b/,
  /\becommerce\b/,
  /\bmarketplaces?\b/,
  /\bonline retail\b/,
  /\bd2c\b/,
  /\bdirect to consumer\b/,
];

const AIML_CYBER_PATTERNS = [
  /\bai\b/,
  /\bml\b/,
  /\bai ml\b/,
  /\bartificial intelligence\b/,
  /\bmachine learning\b/,
  /\bdeep learning\b/,
  /\bgenerative ai\b/,
  /\bgenai\b/,
  /\bllm\b/,
  /\bcomputer vision\b/,
  /\bnlp\b/,
  /\bcyber\s*security\b/,
  /\bcybersecurity\b/,
  /\binfosec\b/,
  /\binformation security\b/,
  /\bnetwork security\b/,
];

const SEMICONDUCTOR_PATTERNS = [
  /\bsemiconductors?\b/,
  /\bvlsi\b/,
  /\bchip design\b/,
  /\bchipset\b/,
  /\bfoundry\b/,
  /\banalog ic\b/,
  /\bsoc design\b/,
];

const ENTERPRISE_PATTERNS = [
  /\benterprise software\b/,
  /\benterprise saas\b/,
  /\bb2b saas\b/,
  /\benterprise\b/,
  /\berp\b/,
  /\bsaas\b/,
];

const PRODUCT_PATTERNS = [
  /\bproduct based\b/,
  /\bproduct company\b/,
  /\bsoftware product\b/,
  /\bpbc\b/,
  /\bproduct\b/,
];

const SERVICE_PATTERNS = [
  /\bservice based\b/,
  /\bservices based\b/,
  /\bit services?\b/,
  /\bconsulting\b/,
  /\bbpo\b/,
  /\bservice company\b/,
  /\bservices company\b/,
  /\bservices?\b/,
];

const STARTUP_PATTERNS = [
  /\bstart\s*ups?\b/,
  /\bearly stage\b/,
];

function normalizeBusinessModel(raw) {
  return String(raw ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[-–—_/]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

/**
 * Map a company's existing `business_model` string onto a /general hub category.
 * Read-only: does not write or rewrite stored values.
 * @param {unknown} businessModel
 * @returns {string}
 */
export function classifyGeneralCompanyCategory(businessModel) {
  const text = normalizeBusinessModel(businessModel);
  if (!text) return GENERAL_COMPANY_CATEGORY_OTHERS;
  if (matchesAny(text, FINTECH_PATTERNS)) return GENERAL_COMPANY_CATEGORY_FINTECH;
  if (matchesAny(text, ECOMMERCE_PATTERNS)) return GENERAL_COMPANY_CATEGORY_ECOMMERCE;
  if (matchesAny(text, AIML_CYBER_PATTERNS)) return GENERAL_COMPANY_CATEGORY_AIML_CYBER;
  if (matchesAny(text, SEMICONDUCTOR_PATTERNS)) return GENERAL_COMPANY_CATEGORY_SEMICONDUCTORS;
  if (matchesAny(text, ENTERPRISE_PATTERNS)) return GENERAL_COMPANY_CATEGORY_ENTERPRISE;
  if (matchesAny(text, PRODUCT_PATTERNS)) return GENERAL_COMPANY_CATEGORY_PRODUCT;
  if (matchesAny(text, SERVICE_PATTERNS)) return GENERAL_COMPANY_CATEGORY_SERVICE;
  if (matchesAny(text, STARTUP_PATTERNS)) return GENERAL_COMPANY_CATEGORY_STARTUP;
  return GENERAL_COMPANY_CATEGORY_OTHERS;
}

/**
 * @param {unknown} raw
 * @returns {string|null}
 */
export function parseGeneralCompanyCategoryParam(raw) {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase();
  return GENERAL_COMPANY_CATEGORIES.some((category) => category.id === value)
    ? value
    : null;
}

/**
 * @param {Array<{ business_model?: unknown }>} companies
 * @returns {Record<string, typeof companies>}
 */
export function groupCompaniesByGeneralCategory(companies) {
  /** @type {Record<string, typeof companies>} */
  const grouped = Object.fromEntries(
    GENERAL_COMPANY_CATEGORIES.map((category) => [category.id, []])
  );
  for (const company of Array.isArray(companies) ? companies : []) {
    const id = classifyGeneralCompanyCategory(company?.business_model);
    grouped[id].push(company);
  }
  return grouped;
}
