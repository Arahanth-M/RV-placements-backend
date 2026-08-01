const WELCOME_WEBHOOK_URL = "https://dkn123.app.n8n.cloud/webhook/welcome-user";

/**
 * n8n webhook that sends update emails to opted-in subscribers.
 * Override with SUBSCRIBER_UPDATE_WEBHOOK_URL in env when ready.
 */
const SUBSCRIBER_UPDATE_WEBHOOK_URL =
  process.env.SUBSCRIBER_UPDATE_WEBHOOK_URL ||
  "https://dkn123.app.n8n.cloud/webhook/subscriber-update";

/**
 * Sends a welcome email webhook notification to n8n when a new user logs in
 * @param {string} email - User's email address
 * @param {string} username - User's display name
 * @returns {Promise<void>}
 */
export const sendWelcomeEmailWebhook = async (email, username) => {
  try {
    const payload = {
      email: email,
      username: username,
    };

    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 100000); // 100 second timeout

    const response = await fetch(WELCOME_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    console.log("✅ Welcome email webhook sent successfully:", {
      email,
      username,
      status: response.status,
    });
  } catch (error) {
    // Log error but don't throw - we don't want to break the login flow if webhook fails
    if (error.name === "AbortError") {
      console.error("❌ Welcome email webhook timeout:", {
        email,
        username,
        error: "Request timed out after 100 seconds",
      });
    } else {
      console.error("❌ Failed to send welcome email webhook:", {
        email,
        username,
        error: error.message,
      });
    }
  }
};

/**
 * Notify an email subscriber about a company/event update via n8n.
 * Failures are logged only — never break the in-app notification path.
 *
 * @param {{
 *   email: string,
 *   username?: string,
 *   type: string,
 *   companyId?: string|import("mongoose").Types.ObjectId,
 *   companyName?: string,
 *   eventId?: string|import("mongoose").Types.ObjectId,
 *   eventTitle?: string,
 *   eventUrl?: string,
 *   body?: string,
 * }} params
 */
export async function sendSubscriberUpdateEmailWebhook({
  email,
  username = "",
  type,
  companyId,
  companyName = "",
  eventId,
  eventTitle = "",
  eventUrl = "",
  body = "",
}) {
  const to = String(email || "").trim().toLowerCase();
  if (!to) return;

  const subject =
    type === "EVENT_CREATED"
      ? `New event: ${eventTitle || "RVCE Placement announcement"}`
      : type === "COMPANY_APPROVED"
        ? `${companyName || "A company"} was approved on RVCE Placement`
        : `${companyName || "A company"} was updated on RVCE Placement`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(SUBSCRIBER_UPDATE_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: to,
        username: String(username || "").trim(),
        type: String(type || ""),
        companyId: companyId != null ? String(companyId) : "",
        companyName: String(companyName || "").trim(),
        eventId: eventId != null ? String(eventId) : "",
        eventTitle: String(eventTitle || "").trim(),
        eventUrl: String(eventUrl || "").trim(),
        body: String(body || "").trim(),
        subject,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    console.log("✅ Subscriber update email webhook sent:", {
      email: to,
      type,
      companyName,
      eventTitle,
      status: response.status,
    });
  } catch (error) {
    if (error.name === "AbortError") {
      console.error("❌ Subscriber update email webhook timeout:", { email: to, type });
    } else {
      console.error("❌ Failed to send subscriber update email webhook:", {
        email: to,
        type,
        error: error.message,
      });
    }
  }
}
