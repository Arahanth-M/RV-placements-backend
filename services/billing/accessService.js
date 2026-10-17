import CompanyStatic from "../../models/CompanyStatic.js";
import InterviewSession from "../../models/InterviewSession.js";
import PrepPathPlan from "../../models/PrepPathPlan.js";
import BillingTrialUsage from "../../models/BillingTrialUsage.js";
import PracticeChallengeAttempt from "../../models/PracticeChallengeAttempt.js";
import BehavioralCoachAttempt from "../../models/BehavioralCoachAttempt.js";
import { classifyGeneralCompanyCategory } from "../../utils/generalCompanyCategory.js";
import {
  PAYWALL_CODE,
  PAYWALL_FEATURES,
  PLAN_IDS,
} from "../../config/billingPlans.js";
import { listActiveEntitlements, summarizeEntitlements } from "./entitlementService.js";
import { isTeaserCompanyId } from "./teaserCompanies.js";
import {
  TEST_EMAIL_LIMIT_CODE,
  getActiveTestEmail,
  usageAnchorFromGrant,
} from "../testEmailService.js";

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

export async function markFreeBehavioralConsumed(userId) {
  const id = String(userId || "").trim();
  if (!id) return;
  await BillingTrialUsage.findOneAndUpdate(
    { userId: id },
    { $set: { freeBehavioralConsumed: true, freeBehavioralConsumedAt: new Date() } },
    { upsert: true }
  );
}

function summaryWithoutPaidGrants() {
  return {
    allCards: false,
    allCardsUntil: null,
    mocks: false,
    mocksUntil: null,
    prepPath: false,
    prepPathUntil: null,
    categories: {},
  };
}

function testEmailAccessPayload(grant, snapshot) {
  if (!grant || !snapshot?.isTestEmail) return null;
  return {
    active: true,
    expiresAt: grant.expiresAt,
    durationHours: Number(grant.durationHours) || null,
    mockRemaining: snapshot.freeMockRemaining,
    prepRemaining: snapshot.freePrepRemaining,
    challengeRemaining: snapshot.freeChallengeRemaining,
    behavioralRemaining: snapshot.freeBehavioralRemaining,
  };
}

export async function loadTestEmailAccess(user, now = new Date()) {
  if (isBillingAdmin(user) || !user?.email) return null;
  const grant = await getActiveTestEmail(user.email, now);
  if (!grant) return null;
  const userId = String(user.userId || user._id || "").trim();
  const snapshot = await getGeneralAccessSnapshot(userId, now, user);
  return testEmailAccessPayload(grant, snapshot);
}

export async function getGeneralAccessSnapshot(userId, now = new Date(), user = null) {
  const id = String(userId || "").trim();
  const grant =
    user?.email && !isBillingAdmin(user) ? await getActiveTestEmail(user.email, now) : null;
  const anchor = grant ? usageAnchorFromGrant(grant) : null;
  const sinceGrant = anchor ? { $gte: anchor } : null;

  const [entitlements, mockStarts, prepPlans, trial, challengeStarts, behavioralStarts] =
    await Promise.all([
      listActiveEntitlements(id, now),
      grant
        ? InterviewSession.countDocuments({
            userId: id,
            contentScope: "platform",
            createdAt: sinceGrant,
          })
        : countPlatformMockStarts(id),
      grant
        ? PrepPathPlan.countDocuments({ userId: id, createdAt: sinceGrant })
        : countPrepPathPlans(id),
      BillingTrialUsage.findOne({ userId: id }).lean(),
      grant
        ? PracticeChallengeAttempt.countDocuments({
            userId: id,
            status: "submitted",
            createdAt: sinceGrant,
          })
        : Promise.resolve(0),
      grant
        ? BehavioralCoachAttempt.countDocuments({ userId: id, createdAt: sinceGrant })
        : Promise.resolve(0),
    ]);

  const summary = grant ? summaryWithoutPaidGrants() : summarizeEntitlements(entitlements, now);
  const behavioralMarked =
    Boolean(grant) &&
    trial?.freeBehavioralConsumedAt &&
    new Date(trial.freeBehavioralConsumedAt) >= anchor;
  const mockUsed = grant ? mockStarts > 0 : Boolean(trial?.freeMockConsumed) || mockStarts > 0;
  const prepUsed = grant ? prepPlans > 0 : Boolean(trial?.freePrepConsumed) || prepPlans > 0;
  const freeMockRemaining = summary.mocks ? 0 : mockUsed ? 0 : 1;
  const freePrepRemaining = summary.prepPath ? 0 : prepUsed ? 0 : 1;
  const challengeUsed = grant ? challengeStarts > 0 : false;
  const behavioralUsed = grant ? behavioralStarts > 0 || behavioralMarked : false;
  return {
    entitlements: grant ? [] : entitlements,
    summary,
    mockStarts,
    prepPlans,
    freeMockRemaining,
    freePrepRemaining,
    unlimitedMocks: summary.mocks,
    unlimitedPrepPath: summary.prepPath,
    isTestEmail: Boolean(grant),
    testEmailExpiresAt: grant?.expiresAt || null,
    testEmailDurationHours: grant ? Number(grant.durationHours) || null : null,
    freeChallengeRemaining: grant ? (challengeUsed ? 0 : 1) : null,
    freeBehavioralRemaining: grant ? (behavioralUsed ? 0 : 1) : null,
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
  const snapshot = await getGeneralAccessSnapshot(userId, now, user);
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
        "Unlock this category, or a plan that includes all company cards. The first card in each category stays free.",
      suggestedPlans: [
        PLAN_IDS.CATEGORY,
        PLAN_IDS.PREP_PATH,
        PLAN_IDS.MOCKS,
        PLAN_IDS.ALL_PREMIUM,
      ],
      categoryId: company.categoryId,
    }),
  };
}

export async function evaluateMockAccess({ userId, companyId, user, now = new Date() }) {
  const card = await evaluateCompanyCardAccess({ userId, companyId, user, now });
  // A test email's one mock can be for any company, not only the free card in each category.
  if (card.snapshot?.isTestEmail) {
    if (card.snapshot.freeMockRemaining > 0) {
      return { ...card, mockAllowed: true, error: null };
    }
    return {
      ...card,
      mockAllowed: false,
      error: createPaywallError({
        feature: PAYWALL_FEATURES.MOCKS,
        message:
          "This test email includes one AI mock interview, and that interview has already been used.",
        suggestedPlans: [],
        categoryId: card.company?.categoryId || "",
      }),
    };
  }
  if (!card.allowed) return { ...card, mockAllowed: false };
  if (card.bypass || card.snapshot?.unlimitedMocks || card.snapshot?.freeMockRemaining > 0) {
    return { ...card, mockAllowed: true };
  }
  return {
    ...card,
    mockAllowed: false,
    error: createPaywallError({
      feature: PAYWALL_FEATURES.MOCKS,
      message: card.snapshot?.isTestEmail
        ? "This test email includes one AI mock interview, and that interview has already been used."
        : "Your free AI mock interview has been used. Unlock unlimited mocks to continue.",
      suggestedPlans: card.snapshot?.isTestEmail ? [] : [PLAN_IDS.MOCKS, PLAN_IDS.ALL_PREMIUM],
      categoryId: card.company?.categoryId || "",
    }),
  };
}

export async function evaluatePrepPathAccess({ userId, companyId, user, now = new Date() }) {
  const card = await evaluateCompanyCardAccess({ userId, companyId, user, now });
  if (!card.allowed) {
    const prepOwned = Boolean(card.snapshot?.unlimitedPrepPath);
    return {
      ...card,
      prepAllowed: false,
      error: createPaywallError({
        feature: PAYWALL_FEATURES.COMPANY_DETAIL,
        message: prepOwned
          ? "Your PrepPath subscription is active. Unlock this company (or its category) to generate a plan for it. The first card in each category stays free."
          : "Unlock this category, or Unlimited PrepPath (that plan includes all company cards). The first card in each category stays free.",
        suggestedPlans: [PLAN_IDS.CATEGORY, PLAN_IDS.PREP_PATH, PLAN_IDS.ALL_PREMIUM],
        categoryId: card.company?.categoryId || card.error?.categoryId || "",
      }),
    };
  }
  if (card.bypass || card.snapshot?.unlimitedPrepPath || card.snapshot?.freePrepRemaining > 0) {
    return { ...card, prepAllowed: true };
  }
  return {
    ...card,
    prepAllowed: false,
    error: createPaywallError({
      feature: PAYWALL_FEATURES.PREP_PATH,
      message: card.snapshot?.isTestEmail
        ? "This test email includes one PrepPath, and that plan has already been generated."
        : "Your free PrepPath plan has been used. Unlock PrepPath to generate more.",
      suggestedPlans: card.snapshot?.isTestEmail ? [] : [PLAN_IDS.PREP_PATH, PLAN_IDS.ALL_PREMIUM],
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

export async function evaluateTestEmailOnceFeature({ userId, user, feature, now = new Date() }) {
  if (isBillingAdmin(user)) return { limited: false, allowed: true, snapshot: null };
  const grant = await getActiveTestEmail(user?.email, now);
  if (!grant) return { limited: false, allowed: true, snapshot: null };
  const snapshot = await getGeneralAccessSnapshot(userId, now, user);
  if (!snapshot.isTestEmail) return { limited: false, allowed: true, snapshot };
  const remaining =
    feature === "challenge" ? snapshot.freeChallengeRemaining : snapshot.freeBehavioralRemaining;
  if (remaining > 0) return { limited: true, allowed: true, snapshot };
  const message =
    feature === "challenge"
      ? "This test email includes one practice challenge, and that challenge has already been submitted."
      : "This test email includes one behavioural coach session, and that session has already been used.";
  const error = createPaywallError({
    feature,
    message,
    suggestedPlans: [],
  });
  error.code = TEST_EMAIL_LIMIT_CODE;
  return { limited: true, allowed: false, snapshot, error };
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
