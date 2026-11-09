import {
  applyGstOnInr,
  getBillingPlan,
  inrToPaise,
} from "../../config/billingPlans.js";

/**
 * Catalog list price + 18% GST. No upgrade credits — every purchase is charged
 * at the published base (199 / 399 / 599) plus GST.
 * @param {string} planId
 * @param {Array<{ planId: string, categoryId?: string }>} [_activeEntitlements]
 * @param {{ categoryId?: string }} [opts]
 */
export function quotePlanPurchase(planId, _activeEntitlements = [], opts = {}) {
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

  const listPriceInr = plan.priceInr;
  const tax = applyGstOnInr(listPriceInr);

  return {
    planId: plan.id,
    categoryId: plan.requiresCategory ? String(opts.categoryId || "").trim() : "",
    listPriceInr,
    creditInr: 0,
    /** Catalog base before GST (same as listPriceInr). */
    baseInr: tax.baseInr,
    gstInr: tax.gstInr,
    gstRate: tax.gstRate,
    /** Total charged (base + GST). Kept as payableInr for existing clients. */
    payableInr: tax.totalInr,
    listPricePaise: inrToPaise(listPriceInr),
    creditPaise: 0,
    basePaise: tax.basePaise,
    gstPaise: tax.gstPaise,
    amountPaise: tax.totalPaise,
    credited: [],
  };
}
