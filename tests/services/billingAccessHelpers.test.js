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

  it("treats an active PrepPath or mocks entitlement as covering all company cards", () => {
    const now = new Date();
    const later = new Date(now.getTime() + 86400000);
    const summary = summarizeEntitlements(
      [
        {
          grants: { allCards: false, mocks: false, prepPath: true },
          expiresAt: later,
        },
      ],
      now
    );
    expect(summary.prepPath).toBe(true);
    expect(summary.allCards).toBe(true);
    expect(hasCategoryAccess(summary, "fintech")).toBe(true);
  });

  it("treats mocks or PrepPath catalog plans as already covering all cards", () => {
    expect(
      alreadyOwnsPlan(
        { allCards: true, mocks: true, prepPath: false, categories: {} },
        PLAN_IDS.CATEGORY,
        "fintech"
      )
    ).toBe(true);
    expect(
      alreadyOwnsPlan(
        { allCards: true, mocks: false, prepPath: true, categories: {} },
        PLAN_IDS.ALL_CARDS
      )
    ).toBe(true);
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
