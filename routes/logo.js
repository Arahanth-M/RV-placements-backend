import express from "express";

const logoRouter = express.Router();
const logoCache = new Map();
const ONE_DAY_SECONDS = 60 * 60 * 24;
const LOGO_DEV_PUBLIC_TOKEN =
  process.env.LOGO_DEV_PUBLIC_TOKEN || "pk_B8XNckD9R3eqItbtBQtP3g";

function normalizeDomain(rawDomain) {
  if (!rawDomain || typeof rawDomain !== "string") return "";

  const trimmed = rawDomain.trim().toLowerCase();
  if (!trimmed) return "";

  try {
    const withProtocol = trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;
    const url = new URL(withProtocol);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

logoRouter.get("/", async (req, res) => {
  const domain = normalizeDomain(req.query?.domain);

  if (!domain) {
    return res.status(400).json({ error: "Domain is required" });
  }

  const rawSize = req.query?.size;
  let size = 128;
  if (rawSize != null && rawSize !== "") {
    const n = Number.parseInt(String(rawSize), 10);
    if (Number.isFinite(n)) {
      size = Math.min(800, Math.max(32, Math.trunc(n)));
    }
  }
  const cacheKey = `${domain}:${size}`;

  if (logoCache.has(cacheKey)) {
    const cachedLogo = logoCache.get(cacheKey);
    console.log(`[logo] cache hit: ${cacheKey}`);
    res.type(cachedLogo.contentType);
    res.set("Cache-Control", `public, max-age=${ONE_DAY_SECONDS}`);
    return res.send(cachedLogo.body);
  }

  try {
    // Route all logo.dev access through the backend so the frontend never calls it directly.
    const logoUrl = `https://img.logo.dev/${domain}?token=${encodeURIComponent(
      LOGO_DEV_PUBLIC_TOKEN
    )}&size=${encodeURIComponent(String(size))}`;
    const response = await fetch(logoUrl, {
      headers: {
        Accept: "image/*",
      },
    });

    if (!response.ok) {
      throw new Error(`logo.dev responded with ${response.status}`);
    }

    const contentType = response.headers.get("content-type") || "image/png";
    const body = Buffer.from(await response.arrayBuffer());
    logoCache.set(cacheKey, { body, contentType });

    // Cache the image bytes in memory so repeated company-card/logo-grid renders avoid external fetches.
    res.type(contentType);
    res.set("Cache-Control", `public, max-age=${ONE_DAY_SECONDS}`);
    console.log(`[logo] cache miss: ${cacheKey}`);
    return res.send(body);
  } catch (error) {
    console.error("[logo] failed to resolve logo:", error);
    return res.status(500).json({ error: "Failed to fetch logo" });
  }
});

export default logoRouter;
