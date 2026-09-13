import Entitlement from "../../models/Entitlement.js";
import { BILLING_DURATION_MONTHS, getBillingPlan } from "../../config/billingPlans.js";

export function addMonths(date, months) {
  const d = new Date(date);
  const month = d.getMonth() + Number(months);
  d.setMonth(month);
  return d;
}

export async function listActiveEntitlements(userId, now = new Date()) {
  const id = String(userId || "").trim();
  if (!id) return [];
  return Entitlement.find({
    userId: id,
    expiresAt: { $gt: now },
  })
    .sort({ expiresAt: -1 })
    .lean();
}

export function summarizeEntitlements(rows, now = new Date()) {
  const list = Array.isArray(rows) ? rows : [];
  let allCardsUntil = null;
  let mocksUntil = null;
  let prepPathUntil = null;
  const categories = {};

  const later = (current, next) => {
    if (!next) return current;
    if (!current) return next;
    return next > current ? next : current;
  };

  for (const row of list) {
    if (!(row.expiresAt instanceof Date) && row.expiresAt) {
      row.expiresAt = new Date(row.expiresAt);
    }
    if (!row.expiresAt || row.expiresAt <= now) continue;
    if (row.grants?.allCards) allCardsUntil = later(allCardsUntil, row.expiresAt);
    if (row.grants?.mocks) mocksUntil = later(mocksUntil, row.expiresAt);
    if (row.grants?.prepPath) prepPathUntil = later(prepPathUntil, row.expiresAt);
    const categoryId = String(row.categoryId || "").trim();
    if (categoryId) {
      categories[categoryId] = later(categories[categoryId] || null, row.expiresAt);
    }
  }

  return {
    allCards: Boolean(allCardsUntil),
    allCardsUntil,
    mocks: Boolean(mocksUntil),
    mocksUntil,
    prepPath: Boolean(prepPathUntil),
    prepPathUntil,
    categories,
  };
}

export async function grantEntitlementFromPlan({
  userId,
  planId,
  categoryId = "",
  paymentOrderId = null,
  razorpayPaymentId = "",
  now = new Date(),
  source = "razorpay",
}) {
  const plan = getBillingPlan(planId);
  if (!plan) {
    const err = new Error("Unknown plan");
    err.code = "UNKNOWN_PLAN";
    throw err;
  }

  const cat = plan.requiresCategory ? String(categoryId || "").trim() : "";
  if (plan.requiresCategory && !cat) {
    const err = new Error("Category is required");
    err.code = "CATEGORY_REQUIRED";
    throw err;
  }

  const startsAt = now;
  const expiresAt = addMonths(now, plan.durationMonths || BILLING_DURATION_MONTHS);

  return Entitlement.create({
    userId: String(userId),
    planId: plan.id,
    categoryId: cat,
    grants: {
      allCards: Boolean(plan.grants.allCards),
      mocks: Boolean(plan.grants.mocks),
      prepPath: Boolean(plan.grants.prepPath),
    },
    startsAt,
    expiresAt,
    paymentOrderId,
    razorpayPaymentId: String(razorpayPaymentId || ""),
    source,
  });
}
