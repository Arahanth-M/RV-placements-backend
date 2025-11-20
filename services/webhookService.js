const WELCOME_WEBHOOK_URL = "https://dkn123.app.n8n.cloud/webhook/welcome-user";

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

