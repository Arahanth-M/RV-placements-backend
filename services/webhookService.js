const WELCOME_WEBHOOK_URL = "https://dkn123.app.n8n.cloud/webhook/welcome-user";
const KNOW_MORE_WEBHOOK_URL = "https://dkn123.app.n8n.cloud/webhook-test/10c801c1-dc27-4fb4-b3f4-7b1ce4f81c7b";

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
 * Fetches company information from n8n webhook when user clicks "Know More"
 * @param {string} companyName - Company name
 * @returns {Promise<Object>} - JSON response from webhook
 */
export const sendKnowMoreWebhook = async (companyName) => {
  try {
    // Convert to lowercase and replace spaces with hyphens
    const formattedCompanyName = companyName.toLowerCase().replace(/\s+/g, '-');
    
    const payload = {
      companyName: formattedCompanyName,
    };

    console.log("📤 Sending Know More webhook request:", {
      url: KNOW_MORE_WEBHOOK_URL,
      payload,
    });

    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 150000); // 150 second timeout

    const response = await fetch(KNOW_MORE_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      // Try to get error details from response
      let errorMessage = `HTTP error! status: ${response.status}`;
      try {
        const errorData = await response.text();
        if (errorData) {
          try {
            const parsedError = JSON.parse(errorData);
            errorMessage = parsedError.error || parsedError.message || errorMessage;
          } catch {
            // If not JSON, use the text as error message
            errorMessage = errorData.length > 200 ? errorData.substring(0, 200) + '...' : errorData;
          }
        }
      } catch (parseError) {
        // If we can't parse the error, use the status code message
        if (response.status === 404) {
          errorMessage = "Webhook endpoint not found. Please check the webhook URL.";
        } else if (response.status === 500) {
          errorMessage = "Webhook server error. Please try again later.";
        }
      }
      throw new Error(errorMessage);
    }

    const data = await response.json();

    console.log("✅ Know More webhook fetched successfully:", {
      companyName,
      status: response.status,
    });

    return data;
  } catch (error) {
    // Log error and throw - we want to handle this in the route
    if (error.name === "AbortError") {
      console.error("❌ Know More webhook timeout:", {
        companyName,
        error: "Request timed out after 15 seconds",
      });
      throw new Error("Request timed out. Please try again.");
    } else {
      console.error("❌ Failed to fetch Know More webhook:", {
        companyName,
        error: error.message,
      });
      throw error;
    }
  }
};

