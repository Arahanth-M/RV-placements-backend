import { describe, expect, it } from "@jest/globals";
import User1 from "../../models/User1.js";
import Entitlement from "../../models/Entitlement.js";
import PaymentOrder from "../../models/PaymentOrder.js";
import PrepPathPlan from "../../models/PrepPathPlan.js";
import { PLAN_IDS } from "../../config/billingPlans.js";
import { deleteGeneralUserAccount } from "../../services/accountDeletionService.js";

describe("accountDeletionService", () => {
  it("revokes entitlements, anonymises payments, deletes user (fresh start)", async () => {
    const user = await User1.create({
      email: "delete-me@example.com",
      username: "delete-me",
      googleId: "g-delete-1",
    });

    await Entitlement.create({
      userId: "g-delete-1",
      planId: PLAN_IDS.ALL_PREMIUM || Object.values(PLAN_IDS)[0],
      startsAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000 * 30),
      grants: { allCards: true, mocks: true, prepPath: true },
    });

    await PaymentOrder.create({
      userId: "g-delete-1",
      email: "delete-me@example.com",
      planId: PLAN_IDS.ALL_PREMIUM || Object.values(PLAN_IDS)[0],
      listPricePaise: 59900,
      creditPaise: 0,
      basePaise: 59900,
      gstPaise: 10782,
      amountPaise: 70682,
      razorpayOrderId: `order_delete_${Date.now()}`,
      status: "paid",
    });

    const companyId = "507f1f77bcf86cd799439011";
    await PrepPathPlan.create({
      userId: "g-delete-1",
      companyId,
      role: "SDE",
      track: "full_time",
      days: 3,
      hoursPerDay: 2,
      resumeDigest: "secret resume text",
    });

    const result = await deleteGeneralUserAccount({
      email: "delete-me@example.com",
    });
    expect(result.ok).toBe(true);
    expect(await User1.findById(user._id)).toBeNull();
    expect(await Entitlement.countDocuments({ userId: "g-delete-1" })).toBe(0);
    expect(await PrepPathPlan.countDocuments({ userId: "g-delete-1" })).toBe(0);

    const pay = await PaymentOrder.findOne({ userId: "g-delete-1" }).lean();
    expect(pay).toBeTruthy();
    expect(pay.email).toBe("");
  });
});
