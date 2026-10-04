import { quotePlanPurchase } from "../../services/billing/upgradeQuote.js";
import { listBillingPlans, PLAN_IDS } from "../../config/billingPlans.js";

describe("quotePlanPurchase", () => {
  it("charges full list price with no overlapping entitlements", () => {
    const quote = quotePlanPurchase(PLAN_IDS.ALL_PREMIUM, []);
    expect(quote.listPriceInr).toBe(7);
    expect(quote.creditInr).toBe(0);
    expect(quote.payableInr).toBe(7);
    expect(quote.amountPaise).toBe(700);
  });

  it("credits a prior category unlock when buying PrepPath", () => {
    const quote = quotePlanPurchase(PLAN_IDS.PREP_PATH, [{ planId: PLAN_IDS.CATEGORY }]);
    expect(quote.listPriceInr).toBe(7);
    expect(quote.creditInr).toBe(7);
    expect(quote.payableInr).toBe(0);
  });

  it("credits overlapping list prices without proration", () => {
    const quote = quotePlanPurchase(PLAN_IDS.ALL_PREMIUM, [
      { planId: PLAN_IDS.ALL_CARDS },
    ]);
    expect(quote.creditInr).toBe(7);
    expect(quote.payableInr).toBe(0);
  });

  it("requires a category for the category SKU", () => {
    expect(() => quotePlanPurchase(PLAN_IDS.CATEGORY, [])).toThrow(/category/i);
  });

  it("floors payable at zero when overlapping credit exceeds the new plan", () => {
    const quote = quotePlanPurchase(PLAN_IDS.ALL_PREMIUM, [
      { planId: PLAN_IDS.MOCKS },
      { planId: PLAN_IDS.PREP_PATH },
    ]);
    expect(quote.payableInr).toBe(0);
  });
});

describe("listBillingPlans", () => {
  it("only lists the four current catalog SKUs", () => {
    expect(listBillingPlans().map((plan) => plan.id).sort()).toEqual(
      ["all_premium", "category", "mocks", "prep_path"].sort()
    );
  });
});
