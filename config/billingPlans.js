/** One-time /general SKUs. Amounts are INR base prices (GST exclusive). Validity is 6 months. */

export const BILLING_DURATION_MONTHS = 6;
/** GST charged on top of the base payable amount at checkout. */
export const GST_RATE = 0.18;

/** Lifetime free-tier allowances on /general (no paid PrepPath / mocks entitlement). */
export const FREE_TIER_MOCK_LIMIT = 1;
export const FREE_TIER_PREP_PATH_LIMIT = 1;
export const FREE_TIER_BEHAVIORAL_LIMIT = 1;
/** Paid behavioural coach: max question generations per rolling clock-hour window. */
export const BEHAVIORAL_COACH_HOURLY_LIMIT = 3;
/**
 * Paid mocks / PrepPath: soft caps per rolling window from entitlement purchase
 * (`startsAt` + N days, then the next N days, …) for the life of the subscription.
 */
export const PAID_QUOTA_WINDOW_DAYS = 30;
export const PAID_MOCKS_MONTHLY_LIMIT = 10;
export const PAID_PREP_PATH_MONTHLY_LIMIT = 10;
export const MONTHLY_QUOTA_CODE = "MONTHLY_QUOTA";
/** Test-email grants keep a single PrepPath for the grant window. */
export const TEST_EMAIL_PREP_PATH_LIMIT = 1;

export const PLAN_IDS = Object.freeze({
  ALL_CARDS: "all_cards",
  CATEGORY: "category",
  MOCKS: "mocks",
  PREP_PATH: "prep_path",
  MOCKS_PREP: "mocks_prep",
  ALL_PREMIUM: "all_premium",
});

export const BILLING_PLANS = Object.freeze({
  [PLAN_IDS.CATEGORY]: {
    id: PLAN_IDS.CATEGORY,
    name: "Unlock one category",
    description:
      "Company-card details for every company in one category, plus unlimited behavioural coach (up to 3 questions per hour). No AI mocks, PrepPath, or peer sessions.",
    priceInr: 199,
    durationMonths: BILLING_DURATION_MONTHS,
    requiresCategory: true,
    catalog: true,
    grants: {
      allCards: false,
      mocks: false,
      prepPath: false,
      category: true,
      behavioralCoach: true,
      peerSessions: false,
    },
  },
  [PLAN_IDS.PREP_PATH]: {
    id: PLAN_IDS.PREP_PATH,
    name: "PrepPath (10 / 30 days)",
    description:
      "Up to 10 PrepPath plans every 30 days from purchase (previous months' unused PrepPaths won't be added to the next month), plus all company cards and unlimited behavioural coach for 6 months.",
    priceInr: 399,
    durationMonths: BILLING_DURATION_MONTHS,
    requiresCategory: false,
    catalog: true,
    grants: {
      allCards: true,
      mocks: false,
      prepPath: true,
      behavioralCoach: true,
      peerSessions: false,
    },
  },
  [PLAN_IDS.MOCKS]: {
    id: PLAN_IDS.MOCKS,
    name: "AI mock interviews (10 / 30 days)",
    description:
      "Up to 10 AI mock interviews every 30 days from purchase (previous months' unused mock interviews won't be added to the next month), plus all company cards and unlimited behavioural coach for 6 months.",
    priceInr: 399,
    durationMonths: BILLING_DURATION_MONTHS,
    requiresCategory: false,
    catalog: true,
    grants: {
      allCards: true,
      mocks: true,
      prepPath: false,
      behavioralCoach: true,
      peerSessions: false,
    },
  },
  [PLAN_IDS.ALL_PREMIUM]: {
    id: PLAN_IDS.ALL_PREMIUM,
    name: "All premium features",
    description:
      "All company cards, up to 10 AI mocks every 30 days, up to 10 PrepPath plans every 30 days (previous months' unused mock interviews and PrepPaths won't be added to the next month), peer sessions, and unlimited behavioural coach.",
    priceInr: 599,
    durationMonths: BILLING_DURATION_MONTHS,
    requiresCategory: false,
    catalog: true,
    grants: {
      allCards: true,
      mocks: true,
      prepPath: true,
      behavioralCoach: true,
      peerSessions: true,
    },
  },
  /** Retired — kept so existing entitlements and orders still resolve. */
  [PLAN_IDS.ALL_CARDS]: {
    id: PLAN_IDS.ALL_CARDS,
    name: "Unlock all company cards",
    description: "Full details for every company card on /general.",
    priceInr: 399,
    durationMonths: BILLING_DURATION_MONTHS,
    requiresCategory: false,
    catalog: false,
    grants: {
      allCards: true,
      mocks: false,
      prepPath: false,
      behavioralCoach: true,
      peerSessions: false,
    },
  },
  [PLAN_IDS.MOCKS_PREP]: {
    id: PLAN_IDS.MOCKS_PREP,
    name: "AI mocks + PrepPath",
    description:
      "Up to 10 AI mocks and 10 PrepPath plans every 30 days from purchase for 6 months (previous months' unused mock interviews and PrepPaths won't be added to the next month).",
    priceInr: 399,
    durationMonths: BILLING_DURATION_MONTHS,
    requiresCategory: false,
    catalog: false,
    grants: {
      allCards: false,
      mocks: true,
      prepPath: true,
      behavioralCoach: true,
      peerSessions: false,
    },
  },
});

/**
 * Legacy upgrade-credit map (unused — checkout always charges full catalog
 * list price + GST: 199 / 399 / 599). Kept so older notes/docs stay readable.
 */
export const PLAN_UPGRADE_OVERLAP = Object.freeze({
  [PLAN_IDS.ALL_PREMIUM]: [
    PLAN_IDS.ALL_CARDS,
    PLAN_IDS.CATEGORY,
    PLAN_IDS.MOCKS,
    PLAN_IDS.PREP_PATH,
    PLAN_IDS.MOCKS_PREP,
  ],
  [PLAN_IDS.MOCKS]: [PLAN_IDS.CATEGORY, PLAN_IDS.ALL_CARDS],
  [PLAN_IDS.PREP_PATH]: [PLAN_IDS.CATEGORY, PLAN_IDS.ALL_CARDS],
  [PLAN_IDS.ALL_CARDS]: [PLAN_IDS.CATEGORY],
  [PLAN_IDS.MOCKS_PREP]: [PLAN_IDS.MOCKS, PLAN_IDS.PREP_PATH],
  [PLAN_IDS.CATEGORY]: [],
});

export const PAYWALL_CODE = "PAYWALL";
export const BEHAVIORAL_HOURLY_LIMIT_CODE = "BEHAVIORAL_HOURLY_LIMIT";
export const PAYWALL_FEATURES = Object.freeze({
  COMPANY_DETAIL: "company_detail",
  MOCKS: "mocks",
  PREP_PATH: "prep_path",
  BEHAVIORAL_COACH: "behavioral_coach",
  PEER_SESSIONS: "peer_sessions",
});

export function getBillingPlan(planId) {
  const id = String(planId || "").trim();
  return BILLING_PLANS[id] || null;
}

export function isCatalogBillingPlan(planId) {
  return getBillingPlan(planId)?.catalog === true;
}

export function listBillingPlans() {
  return Object.values(BILLING_PLANS)
    .filter((plan) => plan.catalog === true)
    .map((plan) => {
      const tax = applyGstOnInr(plan.priceInr);
      return {
        id: plan.id,
        name: plan.name,
        description: plan.description,
        priceInr: plan.priceInr,
        gstRate: GST_RATE,
        gstInr: tax.gstInr,
        totalInr: tax.totalInr,
        durationMonths: plan.durationMonths,
        requiresCategory: plan.requiresCategory === true,
        grants: { ...plan.grants },
      };
    });
}

export function inrToPaise(inr) {
  return Math.round(Number(inr) * 100);
}

export function paiseToInr(paise) {
  return Math.round(Number(paise) || 0) / 100;
}

/**
 * GST on a base INR amount. Exact 18% is computed, then the payable total is
 * rounded to the nearest rupee; GST is adjusted so base + GST = total.
 * @param {number} baseInr
 */
export function applyGstOnInr(baseInr) {
  const basePaise = inrToPaise(Math.max(0, Number(baseInr) || 0));
  const exactTotalPaise = Math.round(basePaise * (1 + GST_RATE));
  // Round payable total to the nearest whole rupee (0 decimal places).
  const totalPaise = Math.round(exactTotalPaise / 100) * 100;
  const gstPaise = Math.max(0, totalPaise - basePaise);
  return {
    baseInr: paiseToInr(basePaise),
    gstInr: paiseToInr(gstPaise),
    totalInr: paiseToInr(totalPaise),
    basePaise,
    gstPaise,
    totalPaise,
    gstRate: GST_RATE,
  };
}

/** Short line for Razorpay Checkout description / order notes. */
export function formatGstCheckoutDescription({ planName, baseInr, gstInr, totalInr }) {
  const name = String(planName || "Plan").trim() || "Plan";
  const base = Number(baseInr) || 0;
  const gst = Number(gstInr) || 0;
  const total = Number(totalInr) || 0;
  return `${name}: Base ₹${base} + GST 18% ₹${gst} = ₹${total}`;
}
