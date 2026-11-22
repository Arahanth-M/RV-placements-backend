import crypto from "crypto";
import { isPlatformOwnerEmail } from "../config/constants.js";

/** Successful Google sign-ins allowed per email in a rolling 24h window. */
export const LOGIN_QUOTA_LIMIT = 3;
export const LOGIN_QUOTA_WINDOW_SEC = 24 * 60 * 60;
export const LOGIN_QUOTA_EXCEEDED_REASON = "login_limit";

const KEY_PREFIX = "rv:auth:login:email";

function sha256(input) {
  return crypto.createHash("sha256").update(String(input ?? "")).digest("hex");
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function createInMemoryLoginQuotaStore() {
  /** @type {Map<string, { count: number, resetAt: number }>} */
  const store = new Map();
  return {
    peek(emailHash, nowMs) {
      const entry = store.get(emailHash);
      if (!entry) return 0;
      if (entry.resetAt <= nowMs) {
        store.delete(emailHash);
        return 0;
      }
      return entry.count;
    },
    increment(emailHash, nowMs, windowMs) {
      const entry = store.get(emailHash);
      if (!entry || entry.resetAt <= nowMs) {
        store.set(emailHash, { count: 1, resetAt: nowMs + windowMs });
        return { count: 1, resetAt: nowMs + windowMs };
      }
      entry.count += 1;
      return { count: entry.count, resetAt: entry.resetAt };
    },
    decrement(emailHash, nowMs) {
      const entry = store.get(emailHash);
      if (!entry || entry.resetAt <= nowMs) return 0;
      entry.count = Math.max(0, entry.count - 1);
      return entry.count;
    },
  };
}

const defaultMemory = createInMemoryLoginQuotaStore();

/**
 * Lazy Redis load — importing redisClient at module top can hang when Redis is down.
 * @returns {Promise<{ client: import("redis").RedisClientType, url: string }|null>}
 */
async function loadRedis() {
  const url = String(process.env.REDIS_URL || "").trim();
  if (!url) return null;
  try {
    const mod = await Promise.race([
      import("../src/utils/redisClient.js"),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("redis import timeout")), 2000);
      }),
    ]);
    return { client: mod.default, url: mod.redisUrl || url };
  } catch {
    return null;
  }
}

/**
 * Rolling 24h successful-login cap per email.
 * Platform owner emails are never limited.
 *
 * @param {{
 *   limit?: number,
 *   windowSec?: number,
 *   redisClient?: import("redis").RedisClientType,
 *   redisUrl?: string,
 *   now?: () => Date,
 *   memory?: ReturnType<typeof createInMemoryLoginQuotaStore>
 * }} [options]
 */
export function createLoginQuota(options = {}) {
  const limit = Number.isFinite(options.limit) ? options.limit : LOGIN_QUOTA_LIMIT;
  const windowSec = Number.isFinite(options.windowSec)
    ? options.windowSec
    : LOGIN_QUOTA_WINDOW_SEC;
  const windowMs = Math.max(1, windowSec) * 1000;
  const injectedClient = options.redisClient || null;
  const injectedUrl =
    options.redisUrl !== undefined ? options.redisUrl : undefined;
  const nowFn = options.now || (() => new Date());
  const memory = options.memory || defaultMemory;

  async function resolveRedis() {
    if (injectedUrl === "") return null;
    if (injectedClient && injectedUrl) {
      return { client: injectedClient, url: injectedUrl };
    }
    if (injectedClient && injectedUrl === undefined) {
      return { client: injectedClient, url: "injected" };
    }
    return loadRedis();
  }

  async function incrRedis(emailHash, ttlSeconds) {
    const redis = await resolveRedis();
    if (!redis?.url || !redis.client) return null;
    const key = `${KEY_PREFIX}:${emailHash}`;
    const count = await redis.client.incr(key);
    if (Number(count) === 1 && ttlSeconds > 0) {
      redis.client.expire(key, ttlSeconds).catch(() => {});
    }
    let ttl = ttlSeconds;
    try {
      const remaining = await redis.client.ttl(key);
      if (Number.isFinite(remaining) && remaining > 0) ttl = remaining;
    } catch {
      // keep default ttlSeconds
    }
    return { count: Number(count), ttlSeconds: ttl };
  }

  async function decrRedis(emailHash) {
    const redis = await resolveRedis();
    if (!redis?.url || !redis.client) return;
    const key = `${KEY_PREFIX}:${emailHash}`;
    try {
      const next = await redis.client.decr(key);
      if (Number(next) < 0) await redis.client.set(key, "0");
    } catch {
      // ignore
    }
  }

  return {
    limit,
    windowSec,
    /**
     * Reserve one successful login for this email.
     * Platform owners always pass without consuming quota.
     */
    async consume(email) {
      const normalized = normalizeEmail(email);
      if (!normalized) {
        return {
          exceeded: true,
          reason: LOGIN_QUOTA_EXCEEDED_REASON,
          used: 0,
          limit,
          remaining: 0,
          retryAfterSeconds: windowSec,
          skipped: false,
        };
      }

      if (isPlatformOwnerEmail(normalized)) {
        return {
          exceeded: false,
          used: 0,
          limit: null,
          remaining: null,
          retryAfterSeconds: 0,
          skipped: true,
        };
      }

      const now = nowFn();
      const nowMs = now.getTime();
      const emailHash = sha256(normalized);

      let used;
      let retryAfterSeconds = windowSec;
      let usedRedis = false;

      try {
        const redisResult = await incrRedis(emailHash, windowSec);
        if (redisResult != null) {
          used = redisResult.count;
          retryAfterSeconds = Math.max(1, Number(redisResult.ttlSeconds) || windowSec);
          usedRedis = true;
        } else {
          const mem = memory.increment(emailHash, nowMs, windowMs);
          used = mem.count;
          retryAfterSeconds = Math.max(1, Math.ceil((mem.resetAt - nowMs) / 1000));
        }
      } catch {
        const mem = memory.increment(emailHash, nowMs, windowMs);
        used = mem.count;
        retryAfterSeconds = Math.max(1, Math.ceil((mem.resetAt - nowMs) / 1000));
      }

      const refund = async () => {
        if (usedRedis) {
          try {
            await decrRedis(emailHash);
          } catch {
            // ignore
          }
          return;
        }
        memory.decrement(emailHash, nowMs);
      };

      if (used > limit) {
        await refund();
        return {
          exceeded: true,
          reason: LOGIN_QUOTA_EXCEEDED_REASON,
          used: limit,
          limit,
          remaining: 0,
          retryAfterSeconds,
          skipped: false,
        };
      }

      return {
        exceeded: false,
        used,
        limit,
        remaining: Math.max(0, limit - used),
        retryAfterSeconds,
        skipped: false,
        refund,
      };
    },
  };
}

export const loginQuota = createLoginQuota();
