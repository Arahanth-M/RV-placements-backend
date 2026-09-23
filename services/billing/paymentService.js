import crypto from "crypto";
import PaymentOrder from "../../models/PaymentOrder.js";
import Entitlement from "../../models/Entitlement.js";
import { parseGeneralCompanyCategoryParam } from "../../utils/generalCompanyCategory.js";
import { getBillingPlan, isCatalogBillingPlan } from "../../config/billingPlans.js";
import {
  getRazorpayInstance,
  getRazorpayKeyId,
  getRazorpayWebhookSecret,
  isRazorpayConfigured,
} from "./razorpayClient.js";
import { quotePlanPurchase } from "./upgradeQuote.js";
import {
  grantEntitlementFromPlan,
  listActiveEntitlements,
} from "./entitlementService.js";
import { alreadyOwnsPlan, getGeneralAccessSnapshot } from "./accessService.js";

function timingSafeEqualHex(a, b) {
  const left = Buffer.from(String(a || ""), "utf8");
  const right = Buffer.from(String(b || ""), "utf8");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function verifyCheckoutSignature({ orderId, paymentId, signature }) {
  const secret = String(process.env.RAZORPAY_KEY_SECRET || "");
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  return timingSafeEqualHex(expected, signature);
}

export function verifyWebhookSignature(rawBody, signature) {
  const secret = getRazorpayWebhookSecret();
  if (!secret) return false;
  const body =
    Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ""), "utf8");
  const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return timingSafeEqualHex(expected, signature);
}

async function grantIfNeeded(order, paymentId) {
  if (!order) return null;
  if (order.status === "paid") {
    const existing = await Entitlement.findOne({
      userId: order.userId,
      razorpayPaymentId: paymentId,
      planId: order.planId,
      categoryId: order.categoryId || "",
    }).lean();
    return existing;
  }

  const updated = await PaymentOrder.findOneAndUpdate(
    { _id: order._id, status: { $ne: "paid" } },
    {
      $set: {
        status: "paid",
        razorpayPaymentId: String(paymentId || ""),
      },
    },
    { new: true }
  );

  if (!updated) {
    return Entitlement.findOne({
      userId: order.userId,
      razorpayPaymentId: paymentId,
      planId: order.planId,
    }).lean();
  }

  return grantEntitlementFromPlan({
    userId: updated.userId,
    planId: updated.planId,
    categoryId: updated.categoryId,
    paymentOrderId: updated._id,
    razorpayPaymentId: paymentId,
    source: "razorpay",
  });
}

function assertPurchasablePlan(plan) {
  if (!plan) {
    const err = new Error("Unknown plan");
    err.code = "UNKNOWN_PLAN";
    err.status = 400;
    throw err;
  }
  if (!isCatalogBillingPlan(plan.id)) {
    const err = new Error("This plan is no longer available.");
    err.code = "PLAN_RETIRED";
    err.status = 400;
    throw err;
  }
  return plan;
}

export async function createBillingOrder({ userId, email, planId, categoryId }) {
  if (!isRazorpayConfigured()) {
    const err = new Error("Payment gateway is not configured.");
    err.code = "RAZORPAY_NOT_CONFIGURED";
    err.status = 503;
    throw err;
  }
  const plan = assertPurchasablePlan(getBillingPlan(planId));
  const category = plan.requiresCategory
    ? parseGeneralCompanyCategoryParam(categoryId)
    : "";
  if (plan.requiresCategory && !category) {
    const err = new Error("Choose a valid company category.");
    err.code = "CATEGORY_REQUIRED";
    err.status = 400;
    throw err;
  }

  const snapshot = await getGeneralAccessSnapshot(userId);
  if (alreadyOwnsPlan(snapshot.summary, plan.id, category)) {
    const err = new Error("You already have this access.");
    err.code = "ALREADY_OWNED";
    err.status = 409;
    throw err;
  }

  const quote = quotePlanPurchase(plan.id, snapshot.entitlements, {
    categoryId: category,
  });
  if (quote.payableInr <= 0) {
    const err = new Error("You already have overlapping access that covers this plan.");
    err.code = "ALREADY_OWNED";
    err.status = 409;
    throw err;
  }

  const instance = getRazorpayInstance();
  const receipt = `lmpp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const razorpayOrder = await instance.orders.create({
    amount: quote.amountPaise,
    currency: "INR",
    receipt: receipt.slice(0, 40),
    notes: {
      userId: String(userId),
      planId: plan.id,
      categoryId: category || "",
    },
  });

  const doc = await PaymentOrder.create({
    userId: String(userId),
    email: String(email || ""),
    planId: plan.id,
    categoryId: category || "",
    listPricePaise: quote.listPricePaise,
    creditPaise: quote.creditPaise,
    amountPaise: quote.amountPaise,
    currency: "INR",
    razorpayOrderId: razorpayOrder.id,
    status: "created",
    notes: { receipt, credited: quote.credited },
  });

  return {
    order: {
      id: String(doc._id),
      razorpayOrderId: razorpayOrder.id,
      amountPaise: quote.amountPaise,
      currency: "INR",
      planId: plan.id,
      categoryId: category || "",
      listPriceInr: quote.listPriceInr,
      creditInr: quote.creditInr,
      payableInr: quote.payableInr,
    },
    keyId: getRazorpayKeyId(),
    plan: {
      id: plan.id,
      name: plan.name,
    },
  };
}

export async function confirmCheckoutPayment({
  userId,
  razorpayOrderId,
  razorpayPaymentId,
  razorpaySignature,
}) {
  const ok = verifyCheckoutSignature({
    orderId: razorpayOrderId,
    paymentId: razorpayPaymentId,
    signature: razorpaySignature,
  });
  if (!ok) {
    const err = new Error("Payment signature mismatch.");
    err.code = "BAD_SIGNATURE";
    err.status = 400;
    throw err;
  }
  const order = await PaymentOrder.findOne({
    razorpayOrderId: String(razorpayOrderId),
    userId: String(userId),
  });
  if (!order) {
    const err = new Error("Order not found.");
    err.code = "ORDER_NOT_FOUND";
    err.status = 404;
    throw err;
  }
  order.razorpaySignature = String(razorpaySignature || "");
  await order.save();
  const entitlement = await grantIfNeeded(order, razorpayPaymentId);
  const entitlements = await listActiveEntitlements(userId);
  return { ok: true, entitlement, entitlements };
}

export async function handleRazorpayWebhook(rawBody, signature) {
  if (!verifyWebhookSignature(rawBody, signature)) {
    const err = new Error("Invalid webhook signature");
    err.code = "BAD_SIGNATURE";
    err.status = 400;
    throw err;
  }
  const payload = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody));
  const event = String(payload?.event || "");
  const payment = payload?.payload?.payment?.entity;
  if (event === "payment.failed") {
    const orderId = String(payment?.order_id || "");
    if (orderId) {
      await PaymentOrder.updateOne(
        { razorpayOrderId: orderId, status: "created" },
        { $set: { status: "failed", razorpayPaymentId: String(payment?.id || "") } }
      );
    }
    return { ok: true, event };
  }
  if (event !== "payment.captured" && event !== "order.paid") {
    return { ok: true, event, ignored: true };
  }
  const orderId = String(payment?.order_id || payload?.payload?.order?.entity?.id || "");
  const paymentId = String(payment?.id || "");
  if (!orderId || !paymentId) return { ok: true, event, ignored: true };
  const order = await PaymentOrder.findOne({ razorpayOrderId: orderId });
  if (!order) return { ok: true, event, missingOrder: true };
  await grantIfNeeded(order, paymentId);
  return { ok: true, event };
}

export async function quoteForUser({ userId, planId, categoryId }) {
  const plan = assertPurchasablePlan(getBillingPlan(planId));
  const category = plan.requiresCategory
    ? parseGeneralCompanyCategoryParam(categoryId)
    : "";
  if (plan.requiresCategory && !category) {
    const err = new Error("Choose a valid company category.");
    err.code = "CATEGORY_REQUIRED";
    err.status = 400;
    throw err;
  }
  const snapshot = await getGeneralAccessSnapshot(userId);
  const owned = alreadyOwnsPlan(snapshot.summary, plan.id, category);
  const quote = quotePlanPurchase(plan.id, snapshot.entitlements, {
    categoryId: category,
  });
  return { owned, quote };
}
