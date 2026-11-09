import { quotePlanPurchase } from "../../services/billing/upgradeQuote.js";
import {
  applyGstOnInr,
  formatGstCheckoutDescription,
  listBillingPlans,
  PLAN_IDS,
} from "../../config/billingPlans.js";

describe("quotePlanPurchase", () => {
  it("charges category list price plus 18% GST", () => {
    const quote = quotePlanPurchase(PLAN_IDS.CATEGORY, [], { categoryId: "fintech" });
    const tax = applyGstOnInr(199);
    expect(quote.listPriceInr).toBe(199);
    expect(quote.creditInr).toBe(0);
    expect(quote.baseInr).toBe(tax.baseInr);
    expect(quote.gstInr).toBe(tax.gstInr);
    expect(quote.payableInr).toBe(tax.totalInr);
    expect(quote.amountPaise).toBe(tax.totalPaise);
  });

  it("charges PrepPath / mocks at 399 + GST even with a prior category unlock", () => {
    const quote = quotePlanPurchase(PLAN_IDS.PREP_PATH, [{ planId: PLAN_IDS.CATEGORY }]);
    const tax = applyGstOnInr(399);
    expect(quote.listPriceInr).toBe(399);
    expect(quote.creditInr).toBe(0);
    expect(quote.baseInr).toBe(tax.baseInr);
    expect(quote.gstInr).toBe(tax.gstInr);
    expect(quote.payableInr).toBe(tax.totalInr);
    expect(quote.credited).toEqual([]);
  });

  it("charges all premium at 599 + GST with no upgrade credit", () => {
    const quote = quotePlanPurchase(PLAN_IDS.ALL_PREMIUM, [
      { planId: PLAN_IDS.ALL_CARDS },
      { planId: PLAN_IDS.MOCKS },
    ]);
    const tax = applyGstOnInr(599);
    expect(quote.listPriceInr).toBe(599);
    expect(quote.creditInr).toBe(0);
    expect(quote.baseInr).toBe(tax.baseInr);
    expect(quote.payableInr).toBe(tax.totalInr);
  });

  it("requires a category for the category SKU", () => {
    expect(() => quotePlanPurchase(PLAN_IDS.CATEGORY, [])).toThrow(/category/i);
  });
});

describe("applyGstOnInr", () => {
  it("adds 18% GST and rounds the payable total to the nearest rupee", () => {
    const tax = applyGstOnInr(299);
    expect(tax.basePaise).toBe(29900);
    // 299 * 1.18 = 352.82 → rounds to ₹353
    expect(tax.totalInr).toBe(353);
    expect(tax.totalPaise).toBe(35300);
    expect(tax.gstInr).toBe(54);
    expect(tax.gstPaise).toBe(5400);
    expect(tax.baseInr + tax.gstInr).toBe(tax.totalInr);
  });

  it("rounds catalog plan totals to whole rupees", () => {
    expect(applyGstOnInr(199).totalInr).toBe(235);
    expect(applyGstOnInr(399).totalInr).toBe(471);
    expect(applyGstOnInr(599).totalInr).toBe(707);
  });
});

describe("formatGstCheckoutDescription", () => {
  it("builds a Razorpay description with base and GST split", () => {
    expect(
      formatGstCheckoutDescription({
        planName: "Unlock one category",
        baseInr: 199,
        gstInr: 36,
        totalInr: 235,
      })
    ).toBe("Unlock one category: Base ₹199 + GST 18% ₹36 = ₹235");
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
