import { hasCategoryAccess, alreadyOwnsPlan } from "../../services/billing/accessService.js";
import { PLAN_IDS } from "../../config/billingPlans.js";
import { summarizeEntitlements } from "../../services/billing/entitlementService.js";

describe("billing access helpers", () => {
  it("treats all-cards as every category", () => {
    expect(hasCategoryAccess({ allCards: true, categories: {} }, "fintech")).toBe(true);
  });

  it("requires the matching category when all-cards is off", () => {
    const now = new Date();
    const later = new Date(now.getTime() + 86400000);
    const summary = summarizeEntitlements(
      [
        {
          grants: { allCards: false, mocks: false, prepPath: false },
          categoryId: "fintech",
          expiresAt: later,
        },
      ],
      now
    );
    expect(hasCategoryAccess(summary, "fintech")).toBe(true);
    expect(hasCategoryAccess(summary, "product")).toBe(false);
  });

  it("detects all-premium ownership only when every grant is active", () => {
    expect(
      alreadyOwnsPlan({ allCards: true, mocks: true, prepPath: false, categories: {} }, PLAN_IDS.ALL_PREMIUM)
    ).toBe(false);
    expect(
      alreadyOwnsPlan({ allCards: true, mocks: true, prepPath: true, categories: {} }, PLAN_IDS.ALL_PREMIUM)
    ).toBe(true);
  });
});
