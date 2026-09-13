import Razorpay from "razorpay";

let cached = null;

export function isRazorpayConfigured() {
  return Boolean(
    String(process.env.RAZORPAY_KEY_ID || "").trim() &&
      String(process.env.RAZORPAY_KEY_SECRET || "").trim()
  );
}

export function getRazorpayKeyId() {
  return String(process.env.RAZORPAY_KEY_ID || "").trim();
}

export function getRazorpayWebhookSecret() {
  return String(process.env.RAZORPAY_WEBHOOK_SECRET || "").trim();
}

export function getRazorpayInstance() {
  if (!isRazorpayConfigured()) return null;
  if (cached) return cached;
  cached = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
  return cached;
}

/** @internal test helper */
export function _resetRazorpayInstanceForTests() {
  cached = null;
}
