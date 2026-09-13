import { quotePlanPurchase } from "../../services/billing/upgradeQuote.js";
import { PLAN_IDS } from "../../config/billingPlans.js";

describe("quotePlanPurchase", () => {
  it("charges full list price with no overlapping entitlements", () => {
    const quote = quotePlanPurchase(PLAN_IDS.ALL_PREMIUM, []);
    expect(quote.listPriceInr).toBe(699);
    expect(quote.creditInr).toBe(0);
    expect(quote.payableInr).toBe(699);
    expect(quote.amountPaise).toBe(69900);
  });

  it("credits overlapping list prices without proration", () => {
    const quote = quotePlanPurchase(PLAN_IDS.ALL_PREMIUM, [
      { planId: PLAN_IDS.ALL_CARDS },
    ]);
    expect(quote.creditInr).toBe(499);
    expect(quote.payableInr).toBe(200);
  });

  it("credits mocks when buying the combo", () => {
    const quote = quotePlanPurchase(PLAN_IDS.MOCKS_PREP, [{ planId: PLAN_IDS.MOCKS }]);
    expect(quote.payableInr).toBe(100);
  });

  it("requires a category for the category SKU", () => {
    expect(() => quotePlanPurchase(PLAN_IDS.CATEGORY, [])).toThrow(/category/i);
  });

  it("floors payable at zero when overlapping credit exceeds the new plan", () => {
    const quote = quotePlanPurchase(PLAN_IDS.MOCKS_PREP, [
      { planId: PLAN_IDS.MOCKS },
      { planId: PLAN_IDS.PREP_PATH },
    ]);
    expect(quote.payableInr).toBe(0);
  });
});
