import {
  BILLING_PLANS,
  PLAN_UPGRADE_OVERLAP,
  applyGstOnInr,
  getBillingPlan,
  inrToPaise,
} from "../../config/billingPlans.js";

/**
 * List-price difference only, then 18% GST on the remaining base.
 * Credits every still-active overlapping SKU (at base list price, before GST).
 * @param {string} planId
 * @param {Array<{ planId: string, categoryId?: string }>} activeEntitlements
 * @param {{ categoryId?: string }} [opts]
 */
export function quotePlanPurchase(planId, activeEntitlements = [], opts = {}) {
  const plan = getBillingPlan(planId);
  if (!plan) {
    const err = new Error("Unknown plan");
    err.code = "UNKNOWN_PLAN";
    throw err;
  }
  if (plan.requiresCategory) {
    const categoryId = String(opts.categoryId || "").trim();
    if (!categoryId) {
      const err = new Error("Choose a company category to unlock.");
      err.code = "CATEGORY_REQUIRED";
      throw err;
    }
  }

  const overlap = PLAN_UPGRADE_OVERLAP[plan.id] || [];
  const rows = Array.isArray(activeEntitlements) ? activeEntitlements : [];
  let creditInr = 0;
  const credited = [];

  for (const row of rows) {
    const id = String(row?.planId || "").trim();
    if (!overlap.includes(id)) continue;
    const overlapPlan = BILLING_PLANS[id];
    if (!overlapPlan) continue;
    creditInr += overlapPlan.priceInr;
    credited.push({
      planId: id,
      categoryId: String(row?.categoryId || "").trim(),
      creditInr: overlapPlan.priceInr,
    });
  }

  const listPriceInr = plan.priceInr;
  const basePayableInr = Math.max(0, listPriceInr - creditInr);
  const tax = applyGstOnInr(basePayableInr);

  return {
    planId: plan.id,
    categoryId: plan.requiresCategory ? String(opts.categoryId || "").trim() : "",
    listPriceInr,
    creditInr,
    /** Base amount after upgrade credit, before GST. */
    baseInr: tax.baseInr,
    gstInr: tax.gstInr,
    gstRate: tax.gstRate,
    /** Total charged (base + GST). Kept as payableInr for existing clients. */
    payableInr: tax.totalInr,
    listPricePaise: inrToPaise(listPriceInr),
    creditPaise: inrToPaise(creditInr),
    basePaise: tax.basePaise,
    gstPaise: tax.gstPaise,
    amountPaise: tax.totalPaise,
    credited,
  };
}
