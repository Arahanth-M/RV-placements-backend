import express from "express";
import authJWT from "../middleware/authJWT.js";
import authorize from "../middleware/authorize.js";
import { listBillingPlans } from "../config/billingPlans.js";
import { GENERAL_COMPANY_CATEGORIES } from "../utils/generalCompanyCategory.js";
import { getRazorpayKeyId, isRazorpayConfigured } from "../services/billing/razorpayClient.js";
import {
  getGeneralAccessSnapshot,
  evaluateCompanyCardAccess,
  evaluateMockAccess,
  evaluatePrepPathAccess,
  paywallPayload,
} from "../services/billing/accessService.js";
import { getTeaserCompanyIndex } from "../services/billing/teaserCompanies.js";
import {
  confirmCheckoutPayment,
  createBillingOrder,
  handleRazorpayWebhook,
  quoteForUser,
} from "../services/billing/paymentService.js";

const router = express.Router();

const getUserId = (req) => String(req.user?.userId || "").trim();

function sendBillingError(res, err) {
  const status = Number(err?.status) || 500;
  const code = err?.code || "BILLING_ERROR";
  if (status >= 500) {
    console.error("[billing]", err?.message || err);
  }
  return res.status(status).json({
    error: err?.message || "Billing error",
    code,
  });
}

router.post("/webhook", async (req, res) => {
  try {
    const signature = String(req.headers["x-razorpay-signature"] || "");
    const raw = req.body;
    await handleRazorpayWebhook(raw, signature);
    return res.json({ ok: true });
  } catch (err) {
    return sendBillingError(res, err);
  }
});

router.get("/config", authJWT, authorize(["student", "admin", "spc"]), async (_req, res) => {
  return res.json({
    configured: isRazorpayConfigured(),
    keyId: isRazorpayConfigured() ? getRazorpayKeyId() : "",
    plans: listBillingPlans(),
    categories: GENERAL_COMPANY_CATEGORIES.map((row) => ({
      id: row.id,
      label: row.label,
    })),
  });
});

router.get("/access", authJWT, authorize(["student", "admin", "spc"]), async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const snapshot = await getGeneralAccessSnapshot(userId);
    const teasers = await getTeaserCompanyIndex();
    const teaserCompanyIds = {};
    const teaserCompanies = [];
    for (const [categoryId, row] of Object.entries(teasers.byCategory || {})) {
      teaserCompanyIds[categoryId] = row?._id || null;
      if (row?._id) {
        const categoryMeta = GENERAL_COMPANY_CATEGORIES.find((item) => item.id === categoryId);
        teaserCompanies.push({
          _id: row._id,
          name: row.name,
          categoryId,
          categoryLabel: categoryMeta?.label || categoryId,
        });
      }
    }
    teaserCompanies.sort((a, b) =>
      String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" })
    );
    const companyId = String(req.query?.companyId || "").trim();
    let company = null;
    if (companyId) {
      try {
        const card = await evaluateCompanyCardAccess({
          userId,
          companyId,
          user: req.user,
        });
        const mocks = card.allowed
          ? await evaluateMockAccess({ userId, companyId, user: req.user })
          : { mockAllowed: false };
        const prep = card.allowed
          ? await evaluatePrepPathAccess({ userId, companyId, user: req.user })
          : { prepAllowed: false };
        company = {
          id: companyId,
          canView: card.allowed,
          isTeaser: card.isTeaser === true,
          canMock: mocks.mockAllowed === true,
          canPrepPath: prep.prepAllowed === true,
          categoryId: card.company?.categoryId || "",
          paywall: card.allowed
            ? mocks.mockAllowed && prep.prepAllowed
              ? null
              : paywallPayload(mocks.error || prep.error)
            : paywallPayload(card.error),
        };
      } catch (accessErr) {
        if (accessErr?.code !== "COMPANY_NOT_FOUND") throw accessErr;
      }
    }
    return res.json({
      success: true,
      entitlements: (snapshot.entitlements || []).map((row) => ({
        id: String(row._id),
        planId: row.planId,
        categoryId: row.categoryId || "",
        grants: row.grants,
        startsAt: row.startsAt,
        expiresAt: row.expiresAt,
      })),
      summary: {
        allCards: snapshot.summary.allCards,
        allCardsUntil: snapshot.summary.allCardsUntil,
        mocks: snapshot.summary.mocks,
        mocksUntil: snapshot.summary.mocksUntil,
        prepPath: snapshot.summary.prepPath,
        prepPathUntil: snapshot.summary.prepPathUntil,
        categories: snapshot.summary.categories,
      },
      freeMockRemaining: snapshot.freeMockRemaining,
      freePrepRemaining: snapshot.freePrepRemaining,
      teaserCompanyIds,
      teaserCompanies,
      company,
    });
  } catch (err) {
    return sendBillingError(res, err);
  }
});

router.post("/quote", authJWT, authorize(["student", "admin", "spc"]), async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const result = await quoteForUser({
      userId,
      planId: req.body?.planId,
      categoryId: req.body?.categoryId,
    });
    return res.json({ success: true, ...result });
  } catch (err) {
    return sendBillingError(res, err);
  }
});

router.post("/orders", authJWT, authorize(["student", "admin", "spc"]), async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const result = await createBillingOrder({
      userId,
      email: req.user?.email,
      planId: req.body?.planId,
      categoryId: req.body?.categoryId,
    });
    return res.status(201).json({ success: true, ...result });
  } catch (err) {
    return sendBillingError(res, err);
  }
});

router.post("/confirm", authJWT, authorize(["student", "admin", "spc"]), async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const result = await confirmCheckoutPayment({
      userId,
      razorpayOrderId: req.body?.razorpay_order_id,
      razorpayPaymentId: req.body?.razorpay_payment_id,
      razorpaySignature: req.body?.razorpay_signature,
    });
    return res.json({ success: true, ...result });
  } catch (err) {
    return sendBillingError(res, err);
  }
});

export default router;
