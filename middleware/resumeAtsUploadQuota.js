import crypto from "crypto";
import redisClient, { redisUrl } from "../src/utils/redisClient.js";
import { IST_OFFSET_MS, istDateParts } from "../utils/istSlotTime.js";

export const ATS_UPLOAD_DAILY_LIMIT = 3;
const KEY_PREFIX = "rv:resume:ats_upload:day";

function sha256(input) {
  return crypto.createHash("sha256").update(String(input ?? "")).digest("hex");
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

export function istDayKey(now = new Date()) {
  const p = istDateParts(now);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

export function secondsUntilNextIstMidnight(now = new Date()) {
  const p = istDateParts(now);
  const nextMidnightUtcMs =
    Date.UTC(p.year, p.month - 1, p.day + 1, 0, 0, 0, 0) - IST_OFFSET_MS;
  return Math.max(1, Math.ceil((nextMidnightUtcMs - now.getTime()) / 1000));
}

function userKeyFromReq(req) {
  const email = req?.user?.email;
  if (typeof email === "string" && email.trim()) return `email:${email.trim().toLowerCase()}`;
  if (req?.user?.userId) return `userId:${String(req.user.userId)}`;
  if (req?.user?._id) return `_id:${String(req.user._id)}`;
  return `ip:${req?.ip || ""}`;
}

export function createInMemoryAtsUploadStore() {
  /** @type {Map<string, { dayKey: string, count: number }>} */
  const store = new Map();
  return {
    peek(userHash, dayKey) {
      const entry = store.get(userHash);
      if (!entry || entry.dayKey !== dayKey) return 0;
      return entry.count;
    },
    increment(userHash, dayKey) {
      const entry = store.get(userHash);
      if (!entry || entry.dayKey !== dayKey) {
        store.set(userHash, { dayKey, count: 1 });
        return 1;
      }
      entry.count += 1;
      return entry.count;
    },
    decrement(userHash, dayKey) {
      const entry = store.get(userHash);
      if (!entry || entry.dayKey !== dayKey) return 0;
      entry.count = Math.max(0, entry.count - 1);
      return entry.count;
    },
  };
}

const defaultMemory = createInMemoryAtsUploadStore();

/**
 * 3 successful resume-upload ATS analyses per IST calendar day.
 * Redis-backed with in-memory fallback. Does not store the file.
 *
 * @param {{
 *   dailyLimit?: number,
 *   redisClient?: import("redis").RedisClientType,
 *   redisUrl?: string,
 *   now?: () => Date,
 *   memory?: ReturnType<typeof createInMemoryAtsUploadStore>
 * }} [options]
 */
export function createAtsUploadQuota(options = {}) {
  const dailyLimit = Number.isFinite(options.dailyLimit)
    ? options.dailyLimit
    : ATS_UPLOAD_DAILY_LIMIT;
  const client = options.redisClient || redisClient;
  const url = options.redisUrl !== undefined ? options.redisUrl : redisUrl;
  const nowFn = options.now || (() => new Date());
  const memory = options.memory || defaultMemory;

  async function peekRedis(userHash, dayKey) {
    if (!url) return null;
    const key = `${KEY_PREFIX}:${userHash}:${dayKey}`;
    const raw = await client.get(key);
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  async function incrRedis(userHash, dayKey, ttlSeconds) {
    if (!url) return null;
    const key = `${KEY_PREFIX}:${userHash}:${dayKey}`;
    const count = await client.incr(key);
    if (Number(count) === 1 && ttlSeconds > 0) {
      client.expire(key, ttlSeconds).catch(() => {});
    }
    return Number(count);
  }

  async function decrRedis(userHash, dayKey) {
    if (!url) return;
    const key = `${KEY_PREFIX}:${userHash}:${dayKey}`;
    try {
      const next = await client.decr(key);
      if (Number(next) < 0) await client.set(key, "0");
    } catch {
      // ignore
    }
  }

  return {
    dailyLimit,
    async getQuota(req) {
      const now = nowFn();
      const dayKey = istDayKey(now);
      const userHash = sha256(userKeyFromReq(req));
      let used = 0;
      try {
        const redisUsed = await peekRedis(userHash, dayKey);
        if (redisUsed != null) used = redisUsed;
        else used = memory.peek(userHash, dayKey);
      } catch {
        used = memory.peek(userHash, dayKey);
      }
      const remaining = Math.max(0, dailyLimit - used);
      return { used, limit: dailyLimit, remaining };
    },
    /**
     * Reserve one slot. Returns quota or `{ exceeded: true, retryAfterSeconds }`.
     */
    async consume(req) {
      const now = nowFn();
      const dayKey = istDayKey(now);
      const ttl = secondsUntilNextIstMidnight(now);
      const userHash = sha256(userKeyFromReq(req));

      let used;
      let usedRedis = false;
      try {
        const redisCount = await incrRedis(userHash, dayKey, ttl);
        if (redisCount != null) {
          used = redisCount;
          usedRedis = true;
        } else {
          used = memory.increment(userHash, dayKey);
        }
      } catch {
        used = memory.increment(userHash, dayKey);
      }

      const refund = async () => {
        if (usedRedis) {
          try {
            await decrRedis(userHash, dayKey);
          } catch {
            // ignore
          }
          return;
        }
        memory.decrement(userHash, dayKey);
      };

      if (used > dailyLimit) {
        await refund();
        return {
          exceeded: true,
          used: dailyLimit,
          limit: dailyLimit,
          remaining: 0,
          retryAfterSeconds: ttl,
        };
      }

      return {
        exceeded: false,
        used,
        limit: dailyLimit,
        remaining: Math.max(0, dailyLimit - used),
        retryAfterSeconds: ttl,
        refund,
      };
    },
  };
}

export const atsUploadQuota = createAtsUploadQuota();
