import express from "express";

const logoRouter = express.Router();
const logoCache = new Map();
const logoInflight = new Map();
const ONE_DAY_SECONDS = 60 * 60 * 24;
const LOGO_FETCH_TIMEOUT_MS = 5000;
const LOGO_BATCH_LIMIT = 48;
const LOGO_FETCH_CONCURRENCY = 12;
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

function clampSize(rawSize) {
  let size = 128;
  if (rawSize != null && rawSize !== "") {
    const n = Number.parseInt(String(rawSize), 10);
    if (Number.isFinite(n)) {
      size = Math.min(800, Math.max(32, Math.trunc(n)));
    }
  }
  return size;
}

function parseDomainList(raw) {
  const parts = Array.isArray(raw) ? raw : String(raw || "").split(",");
  const unique = [];
  const seen = new Set();
  for (const part of parts) {
    const domain = normalizeDomain(String(part || ""));
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    unique.push(domain);
    if (unique.length >= LOGO_BATCH_LIMIT) break;
  }
  return unique;
}

async function fetchLogo(domain, size) {
  const logoUrl = `https://img.logo.dev/${domain}?token=${encodeURIComponent(
    LOGO_DEV_PUBLIC_TOKEN
  )}&size=${encodeURIComponent(String(size))}&format=jpg`;
  const response = await fetch(logoUrl, {
    headers: { Accept: "image/*" },
    signal: AbortSignal.timeout(LOGO_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`logo.dev responded with ${response.status}`);
  }
  const contentType = response.headers.get("content-type") || "image/jpeg";
  const body = Buffer.from(await response.arrayBuffer());
  return { body, contentType };
}

function resolveLogo(domain, size) {
  const cacheKey = `${domain}:${size}`;
  if (logoCache.has(cacheKey)) return Promise.resolve(logoCache.get(cacheKey));
  if (logoInflight.has(cacheKey)) return logoInflight.get(cacheKey);

  const pending = fetchLogo(domain, size)
    .then((logo) => {
      logoCache.set(cacheKey, logo);
      return logo;
    })
    .catch((error) => {
      console.error(`[logo] failed to resolve ${cacheKey}:`, error?.message || error);
      return null;
    })
    .finally(() => {
      logoInflight.delete(cacheKey);
    });

  logoInflight.set(cacheKey, pending);
  return pending;
}

async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function sendCachedLogo(res, logo) {
  res.type(logo.contentType);
  res.set("Cache-Control", `public, max-age=${ONE_DAY_SECONDS}, immutable`);
  return res.send(logo.body);
}

logoRouter.get("/batch", async (req, res) => {
  const size = clampSize(req.query?.size);
  const domains = parseDomainList(req.query?.domains);
  if (!domains.length) {
    return res.status(400).json({ error: "Domains are required" });
  }

  const resolved = await mapPool(domains, LOGO_FETCH_CONCURRENCY, async (domain) => {
    const logo = await resolveLogo(domain, size);
    if (!logo?.body) return null;
    return [
      domain,
      `data:${logo.contentType};base64,${logo.body.toString("base64")}`,
    ];
  });

  const logos = {};
  for (const entry of resolved) {
    if (!entry) continue;
    logos[entry[0]] = entry[1];
  }

  res.set("Cache-Control", `public, max-age=${ONE_DAY_SECONDS}`);
  return res.json({ logos });
});

logoRouter.get("/", async (req, res) => {
  const domain = normalizeDomain(req.query?.domain);

  if (!domain) {
    return res.status(400).json({ error: "Domain is required" });
  }

  const size = clampSize(req.query?.size);
  const logo = await resolveLogo(domain, size);
  if (!logo?.body) {
    return res.status(404).json({ error: "Failed to fetch logo" });
  }
  return sendCachedLogo(res, logo);
});

export default logoRouter;
