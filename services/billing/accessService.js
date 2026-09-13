import CompanyStatic from "../../models/CompanyStatic.js";
import InterviewSession from "../../models/InterviewSession.js";
import PrepPathPlan from "../../models/PrepPathPlan.js";
import BillingTrialUsage from "../../models/BillingTrialUsage.js";
import { classifyGeneralCompanyCategory } from "../../utils/generalCompanyCategory.js";
import {
  PAYWALL_CODE,
  PAYWALL_FEATURES,
  PLAN_IDS,
} from "../../config/billingPlans.js";
import { listActiveEntitlements, summarizeEntitlements } from "./entitlementService.js";
import { isTeaserCompanyId } from "./teaserCompanies.js";

export function isBillingAdmin(user) {
  if (!user) return false;
  if (user.isAdminSession === true) return true;
  return String(user.role || "").trim().toLowerCase() === "admin";
}

export function createPaywallError({
  feature,
  message,
  suggestedPlans = [],
  categoryId = "",
} = {}) {
  const err = new Error(message || "This feature requires a paid plan.");
  err.code = PAYWALL_CODE;
  err.feature = feature;
  err.suggestedPlans = suggestedPlans;
  err.categoryId = categoryId;
  err.status = 402;
  return err;
}

export async function countPlatformMockStarts(userId) {
  const id = String(userId || "").trim();
  if (!id) return 0;
  return InterviewSession.countDocuments({
    userId: id,
    contentScope: "platform",
  });
}

export async function countPrepPathPlans(userId) {
  const id = String(userId || "").trim();
  if (!id) return 0;
  return PrepPathPlan.countDocuments({ userId: id });
}

export async function loadCompanyCategoryMeta(companyId) {
  const id = String(companyId || "").trim();
  if (!id) return null;
  const row = await CompanyStatic.findById(id)
    .select({ _id: 1, name: 1, logo: 1, business_model: 1 })
    .lean();
  if (!row) return null;
  const categoryId = classifyGeneralCompanyCategory(row.business_model);
  return {
    _id: String(row._id),
    name: String(row.name || "").trim(),
    logo: row.logo || "",
    business_model: row.business_model || "",
    categoryId,
  };
}

export function hasCategoryAccess(summary, categoryId) {
  if (summary?.allCards) return true;
  const cat = String(categoryId || "").trim();
  if (!cat) return false;
  return Boolean(summary?.categories?.[cat]);
}

export async function markFreeMockConsumed(userId) {
  const id = String(userId || "").trim();
  if (!id) return;
  await BillingTrialUsage.findOneAndUpdate(
    { userId: id },
    { $set: { freeMockConsumed: true, freeMockConsumedAt: new Date() } },
    { upsert: true }
  );
}

export async function markFreePrepConsumed(userId) {
  const id = String(userId || "").trim();
  if (!id) return;
  await BillingTrialUsage.findOneAndUpdate(
    { userId: id },
    { $set: { freePrepConsumed: true, freePrepConsumedAt: new Date() } },
    { upsert: true }
  );
}

export async function getGeneralAccessSnapshot(userId, now = new Date()) {
  const [entitlements, mockStarts, prepPlans, trial] = await Promise.all([
    listActiveEntitlements(userId, now),
    countPlatformMockStarts(userId),
    countPrepPathPlans(userId),
    BillingTrialUsage.findOne({ userId: String(userId || "").trim() }).lean(),
  ]);
  const summary = summarizeEntitlements(entitlements, now);
  const mockUsed = Boolean(trial?.freeMockConsumed) || mockStarts > 0;
  const prepUsed = Boolean(trial?.freePrepConsumed) || prepPlans > 0;
  const freeMockRemaining = summary.mocks ? 0 : mockUsed ? 0 : 1;
  const freePrepRemaining = summary.prepPath ? 0 : prepUsed ? 0 : 1;
  return {
    entitlements,
    summary,
    mockStarts,
    prepPlans,
    freeMockRemaining,
    freePrepRemaining,
    unlimitedMocks: summary.mocks,
    unlimitedPrepPath: summary.prepPath,
  };
}

export async function evaluateCompanyCardAccess({ userId, companyId, user, now = new Date() }) {
  if (isBillingAdmin(user)) {
    return { allowed: true, isTeaser: false, bypass: true, company: null, snapshot: null };
  }
  const company = await loadCompanyCategoryMeta(companyId);
  if (!company) {
    const err = new Error("Company not found");
    err.code = "COMPANY_NOT_FOUND";
    err.status = 404;
    throw err;
  }
  const isTeaser = await isTeaserCompanyId(company._id);
  const snapshot = await getGeneralAccessSnapshot(userId, now);
  if (isTeaser || hasCategoryAccess(snapshot.summary, company.categoryId)) {
    return { allowed: true, isTeaser, bypass: false, company, snapshot };
  }
  return {
    allowed: false,
    isTeaser: false,
    bypass: false,
    company,
    snapshot,
    error: createPaywallError({
      feature: PAYWALL_FEATURES.COMPANY_DETAIL,
      message:
        "Unlock this company card to view full details. The first card in each category stays free.",
      suggestedPlans: [PLAN_IDS.CATEGORY, PLAN_IDS.ALL_CARDS, PLAN_IDS.ALL_PREMIUM],
      categoryId: company.categoryId,
    }),
  };
}

export async function evaluateMockAccess({ userId, companyId, user, now = new Date() }) {
  const card = await evaluateCompanyCardAccess({ userId, companyId, user, now });
  if (!card.allowed) return { ...card, mockAllowed: false };
  if (card.bypass || card.snapshot?.unlimitedMocks || card.snapshot?.freeMockRemaining > 0) {
    return { ...card, mockAllowed: true };
  }
  return {
    ...card,
    mockAllowed: false,
    error: createPaywallError({
      feature: PAYWALL_FEATURES.MOCKS,
      message:
        "Your free AI mock interview has been used. Unlock unlimited mocks to continue.",
      suggestedPlans: [PLAN_IDS.MOCKS, PLAN_IDS.MOCKS_PREP, PLAN_IDS.ALL_PREMIUM],
      categoryId: card.company?.categoryId || "",
    }),
  };
}

export async function evaluatePrepPathAccess({ userId, companyId, user, now = new Date() }) {
  const card = await evaluateCompanyCardAccess({ userId, companyId, user, now });
  if (!card.allowed) return { ...card, prepAllowed: false };
  if (card.bypass || card.snapshot?.unlimitedPrepPath || card.snapshot?.freePrepRemaining > 0) {
    return { ...card, prepAllowed: true };
  }
  return {
    ...card,
    prepAllowed: false,
    error: createPaywallError({
      feature: PAYWALL_FEATURES.PREP_PATH,
      message: "Your free PrepPath plan has been used. Unlock PrepPath to generate more.",
      suggestedPlans: [PLAN_IDS.PREP_PATH, PLAN_IDS.MOCKS_PREP, PLAN_IDS.ALL_PREMIUM],
      categoryId: card.company?.categoryId || "",
    }),
  };
}

export function alreadyOwnsPlan(summary, planId, categoryId = "") {
  const id = String(planId || "").trim();
  if (id === PLAN_IDS.ALL_PREMIUM) {
    return Boolean(summary.allCards && summary.mocks && summary.prepPath);
  }
  if (id === PLAN_IDS.ALL_CARDS) return Boolean(summary.allCards);
  if (id === PLAN_IDS.MOCKS) return Boolean(summary.mocks);
  if (id === PLAN_IDS.PREP_PATH) return Boolean(summary.prepPath);
  if (id === PLAN_IDS.MOCKS_PREP) return Boolean(summary.mocks && summary.prepPath);
  if (id === PLAN_IDS.CATEGORY) {
    return hasCategoryAccess(summary, categoryId);
  }
  return false;
}

export function paywallPayload(error) {
  return {
    error: error?.message || "This feature requires a paid plan.",
    code: PAYWALL_CODE,
    feature: error?.feature || PAYWALL_FEATURES.COMPANY_DETAIL,
    suggestedPlans: Array.isArray(error?.suggestedPlans) ? error.suggestedPlans : [],
    categoryId: error?.categoryId || "",
  };
}
