import CollegeOnboardingRequest from "../models/CollegeOnboardingRequest.js";

const FEATURE_IDS = new Set([
  "company_insights",
  "ai_interviews",
  "prep_path",
  "resources_must_do",
  "coding_experiences",
  "practice_challenges",
  "peer_mocks",
  "behavioral_coach",
  "career_explorer",
  "resume_builder",
  "drive_calendar",
  "document_vault",
  "hear_from_seniors",
  "performance_overview",
]);

const DATA_EXTENT_IDS = new Set([
  "historical_placements",
  "company_visits",
  "interview_experiences",
  "coding_questions",
  "eligibility_cutoffs",
  "ongoing_drive_updates",
]);

function normalizeText(raw, max) {
  return String(raw || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, max);
}

function normalizeEmail(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase();
}

function normalizeStringList(raw, allowed) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const id = String(item || "")
      .trim()
      .toLowerCase();
    if (!id || !allowed.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * @param {unknown} input
 */
export async function createCollegeOnboardingRequest(input = {}) {
  const path = String(input.path || "")
    .trim()
    .toLowerCase();
  if (path !== "demo" && path !== "self_onboard") {
    const err = new Error("Choose demo or full onboarding");
    err.code = "INVALID_PATH";
    throw err;
  }

  const collegeName = normalizeText(input.collegeName, 160);
  const pocName = normalizeText(input.pocName ?? input.contactName, 120);
  const pocEmail = normalizeEmail(input.pocEmail ?? input.email);
  const pocPhone = normalizeText(input.pocPhone, 40);

  if (collegeName.length < 2) {
    const err = new Error("College name is required");
    err.code = "INVALID_COLLEGE";
    throw err;
  }
  if (pocName.length < 2) {
    const err = new Error("POC name is required");
    err.code = "INVALID_POC";
    throw err;
  }
  if (!pocEmail || !pocEmail.includes("@") || pocEmail.length > 320) {
    const err = new Error("A valid POC email is required");
    err.code = "INVALID_EMAIL";
    throw err;
  }

  if (path === "demo") {
    const doc = await CollegeOnboardingRequest.create({
      path: "demo",
      collegeName,
      pocName,
      pocEmail,
      pocPhone,
      status: "demo_requested",
    });
    return {
      ok: true,
      id: String(doc._id),
      path: doc.path,
      status: doc.status,
      collegeName: doc.collegeName,
    };
  }

  const willProvideData = Boolean(input.willProvideData);
  const dataExtent = willProvideData
    ? normalizeStringList(input.dataExtent, DATA_EXTENT_IDS)
    : [];
  if (willProvideData && dataExtent.length < 1) {
    const err = new Error("Select at least one data extent");
    err.code = "INVALID_DATA_EXTENT";
    throw err;
  }

  const selectedFeatures = normalizeStringList(input.selectedFeatures, FEATURE_IDS);
  if (selectedFeatures.length < 1) {
    const err = new Error("Select at least one feature");
    err.code = "INVALID_FEATURES";
    throw err;
  }

  const approxPriceInr = Number(input.approxPriceInr);
  const price =
    Number.isFinite(approxPriceInr) && approxPriceInr >= 0
      ? Math.round(approxPriceInr)
      : undefined;

  const doc = await CollegeOnboardingRequest.create({
    path: "self_onboard",
    collegeName,
    pocName,
    pocEmail,
    pocPhone,
    willProvideData,
    dataExtent,
    selectedFeatures,
    approxPriceInr: price,
    status: "quotation_requested",
  });

  return {
    ok: true,
    id: String(doc._id),
    path: doc.path,
    status: doc.status,
    collegeName: doc.collegeName,
    approxPriceInr: doc.approxPriceInr,
  };
}

const ONBOARDING_STATUSES = new Set([
  "demo_requested",
  "quotation_requested",
  "quotation_sent",
  "mou_pending",
  "payment_pending",
  "onboarded",
]);

export async function listCollegeOnboardingRequests({ status, page = 1, limit = 25 } = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 25));
  const query = {};
  const statusFilter = String(status || "").trim().toLowerCase();
  if (statusFilter && ONBOARDING_STATUSES.has(statusFilter)) {
    query.status = statusFilter;
  }

  const [total, items] = await Promise.all([
    CollegeOnboardingRequest.countDocuments(query),
    CollegeOnboardingRequest.find(query)
      .sort({ createdAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .lean(),
  ]);

  return {
    items,
    total,
    page: safePage,
    limit: safeLimit,
    totalPages: Math.max(1, Math.ceil(total / safeLimit)),
  };
}

export async function updateCollegeOnboardingRequest(id, input = {}) {
  const doc = await CollegeOnboardingRequest.findById(id);
  if (!doc) {
    const err = new Error("Onboarding request not found");
    err.code = "NOT_FOUND";
    throw err;
  }

  const status = String(input.status || "").trim().toLowerCase();
  if (status) {
    if (!ONBOARDING_STATUSES.has(status)) {
      const err = new Error("Invalid onboarding status");
      err.code = "INVALID_STATUS";
      throw err;
    }
    doc.status = status;
  }

  if (input.notes != null) {
    doc.notes = normalizeText(input.notes, 2000);
  }

  await doc.save();
  return doc.toObject();
}
