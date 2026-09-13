/** One-time /general SKUs. Amounts are INR, GST-inclusive. Validity is 6 months. */

export const BILLING_DURATION_MONTHS = 6;

export const PLAN_IDS = Object.freeze({
  ALL_CARDS: "all_cards",
  CATEGORY: "category",
  MOCKS: "mocks",
  PREP_PATH: "prep_path",
  MOCKS_PREP: "mocks_prep",
  ALL_PREMIUM: "all_premium",
});

export const BILLING_PLANS = Object.freeze({
  [PLAN_IDS.ALL_CARDS]: {
    id: PLAN_IDS.ALL_CARDS,
    name: "Unlock all company cards",
    description: "Full details for every company card on /general.",
    priceInr: 499,
    durationMonths: BILLING_DURATION_MONTHS,
    requiresCategory: false,
    grants: { allCards: true, mocks: false, prepPath: false },
  },
  [PLAN_IDS.CATEGORY]: {
    id: PLAN_IDS.CATEGORY,
    name: "Unlock one category",
    description: "Full details for every company in one category.",
    priceInr: 299,
    durationMonths: BILLING_DURATION_MONTHS,
    requiresCategory: true,
    grants: { allCards: false, mocks: false, prepPath: false, category: true },
  },
  [PLAN_IDS.MOCKS]: {
    id: PLAN_IDS.MOCKS,
    name: "Unlimited AI mock interviews",
    description: "Unlimited AI mocks on companies you can already open.",
    priceInr: 399,
    durationMonths: BILLING_DURATION_MONTHS,
    requiresCategory: false,
    grants: { allCards: false, mocks: true, prepPath: false },
  },
  [PLAN_IDS.PREP_PATH]: {
    id: PLAN_IDS.PREP_PATH,
    name: "Unlock PrepPath",
    description: "Unlimited PrepPath plans on companies you can already open.",
    priceInr: 299,
    durationMonths: BILLING_DURATION_MONTHS,
    requiresCategory: false,
    grants: { allCards: false, mocks: false, prepPath: true },
  },
  [PLAN_IDS.MOCKS_PREP]: {
    id: PLAN_IDS.MOCKS_PREP,
    name: "AI mocks + PrepPath",
    description: "Unlimited AI mocks and PrepPath for 6 months.",
    priceInr: 499,
    durationMonths: BILLING_DURATION_MONTHS,
    requiresCategory: false,
    grants: { allCards: false, mocks: true, prepPath: true },
  },
  [PLAN_IDS.ALL_PREMIUM]: {
    id: PLAN_IDS.ALL_PREMIUM,
    name: "All premium features",
    description: "All company cards, unlimited AI mocks, and PrepPath.",
    priceInr: 699,
    durationMonths: BILLING_DURATION_MONTHS,
    requiresCategory: false,
    grants: { allCards: true, mocks: true, prepPath: true },
  },
});

/** Active SKUs whose list price is credited when buying the key plan. */
export const PLAN_UPGRADE_OVERLAP = Object.freeze({
  [PLAN_IDS.ALL_PREMIUM]: [
    PLAN_IDS.ALL_CARDS,
    PLAN_IDS.CATEGORY,
    PLAN_IDS.MOCKS,
    PLAN_IDS.PREP_PATH,
    PLAN_IDS.MOCKS_PREP,
  ],
  [PLAN_IDS.ALL_CARDS]: [PLAN_IDS.CATEGORY],
  [PLAN_IDS.MOCKS_PREP]: [PLAN_IDS.MOCKS, PLAN_IDS.PREP_PATH],
  [PLAN_IDS.MOCKS]: [],
  [PLAN_IDS.PREP_PATH]: [],
  [PLAN_IDS.CATEGORY]: [],
});

export const PAYWALL_CODE = "PAYWALL";
export const PAYWALL_FEATURES = Object.freeze({
  COMPANY_DETAIL: "company_detail",
  MOCKS: "mocks",
  PREP_PATH: "prep_path",
});

export function getBillingPlan(planId) {
  const id = String(planId || "").trim();
  return BILLING_PLANS[id] || null;
}

export function listBillingPlans() {
  return Object.values(BILLING_PLANS).map((plan) => ({
    id: plan.id,
    name: plan.name,
    description: plan.description,
    priceInr: plan.priceInr,
    durationMonths: plan.durationMonths,
    requiresCategory: plan.requiresCategory === true,
    grants: { ...plan.grants },
  }));
}

export function inrToPaise(inr) {
  return Math.round(Number(inr) * 100);
}
