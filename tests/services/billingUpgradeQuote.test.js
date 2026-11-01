import { quotePlanPurchase } from "../../services/billing/upgradeQuote.js";
import {
  applyGstOnInr,
  formatGstCheckoutDescription,
  listBillingPlans,
  PLAN_IDS,
} from "../../config/billingPlans.js";

describe("quotePlanPurchase", () => {
  it("charges full list price plus 18% GST with no overlapping entitlements", () => {
    const quote = quotePlanPurchase(PLAN_IDS.ALL_PREMIUM, []);
    const tax = applyGstOnInr(599);
    expect(quote.listPriceInr).toBe(599);
    expect(quote.creditInr).toBe(0);
    expect(quote.baseInr).toBe(tax.baseInr);
    expect(quote.gstInr).toBe(tax.gstInr);
    expect(quote.payableInr).toBe(tax.totalInr);
    expect(quote.amountPaise).toBe(tax.totalPaise);
    expect(quote.gstPaise).toBe(tax.gstPaise);
  });

  it("credits a prior category unlock when buying PrepPath, then applies GST", () => {
    const quote = quotePlanPurchase(PLAN_IDS.PREP_PATH, [{ planId: PLAN_IDS.CATEGORY }]);
    const tax = applyGstOnInr(200);
    expect(quote.listPriceInr).toBe(399);
    expect(quote.creditInr).toBe(199);
    expect(quote.baseInr).toBe(200);
    expect(quote.gstInr).toBe(tax.gstInr);
    expect(quote.payableInr).toBe(tax.totalInr);
  });

  it("credits overlapping list prices without proration, then applies GST", () => {
    const quote = quotePlanPurchase(PLAN_IDS.ALL_PREMIUM, [
      { planId: PLAN_IDS.ALL_CARDS },
    ]);
    const tax = applyGstOnInr(200);
    expect(quote.creditInr).toBe(399);
    expect(quote.baseInr).toBe(200);
    expect(quote.payableInr).toBe(tax.totalInr);
  });

  it("requires a category for the category SKU", () => {
    expect(() => quotePlanPurchase(PLAN_IDS.CATEGORY, [])).toThrow(/category/i);
  });

  it("floors payable at zero when overlapping credit exceeds the new plan", () => {
    const quote = quotePlanPurchase(PLAN_IDS.ALL_PREMIUM, [
      { planId: PLAN_IDS.MOCKS },
      { planId: PLAN_IDS.PREP_PATH },
    ]);
    expect(quote.baseInr).toBe(0);
    expect(quote.gstInr).toBe(0);
    expect(quote.payableInr).toBe(0);
  });
});

describe("applyGstOnInr", () => {
  it("adds 18% GST in paise-accurate totals", () => {
    const tax = applyGstOnInr(299);
    expect(tax.basePaise).toBe(29900);
    expect(tax.gstPaise).toBe(5382);
    expect(tax.totalPaise).toBe(35282);
    expect(tax.gstInr).toBe(53.82);
    expect(tax.totalInr).toBe(352.82);
  });
});

describe("formatGstCheckoutDescription", () => {
  it("builds a Razorpay description with base and GST split", () => {
    expect(
      formatGstCheckoutDescription({
        planName: "Unlock one category",
        baseInr: 299,
        gstInr: 53.82,
        totalInr: 352.82,
      })
    ).toBe("Unlock one category: Base ₹299 + GST 18% ₹53.82 = ₹352.82");
  });
});

describe("listBillingPlans", () => {
  it("only lists the four current catalog SKUs with GST totals", () => {
    const plans = listBillingPlans();
    expect(plans.map((plan) => plan.id).sort()).toEqual(
      ["all_premium", "category", "mocks", "prep_path"].sort()
    );
    for (const plan of plans) {
      expect(plan.gstRate).toBe(0.18);
      expect(plan.totalInr).toBe(applyGstOnInr(plan.priceInr).totalInr);
    }
  });
});
