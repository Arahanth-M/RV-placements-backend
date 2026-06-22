import { createClient } from "redis";
import redis, { connectRedis, redisUrl } from "../../src/utils/redisClient.js";

/** One Redis channel so API workers can push SSE events created in other processes (e.g. BullMQ). */
const NOTIFICATION_SSE_CHANNEL = "notification:sse:v1";

const clients = new Map(); // userId (string) -> Set(res)

export function subscribe(userId, res) {
  const key = String(userId);
  if (!clients.has(key)) {
    clients.set(key, new Set());
  }

  clients.get(key).add(res);

  try {
    res.write(": connected\n\n");
  } catch {
    // Client already gone
  }

  const heartbeat = setInterval(() => {
    try {
      res.write(": heartbeat\n\n");
    } catch {
      clearInterval(heartbeat);
    }
  }, 25_000);

  const onClose = () => {
    clearInterval(heartbeat);
    const set = clients.get(key);
    if (!set) return;
    set.delete(res);
    if (set.size === 0) {
      clients.delete(key);
    }
  };

  res.on("close", onClose);
}

export function emitToUser(userId, data) {
  const userClients = clients.get(String(userId));
  if (!userClients) return;

  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of userClients) {
    try {
      res.write(payload);
    } catch {
      // Client disconnected mid-write
    }
  }
}

/**
 * Publish a notification event to Redis; API process subscriber calls emitToUser.
 * Falls back to in-process emitToUser when Redis is unavailable (same-process creates only).
 */
export async function publishNotificationSse(userId, data) {
  const uid = String(userId);
  const envelope = JSON.stringify({ userId: uid, data });

  try {
    await connectRedis().catch(() => {});
    const open = typeof redis.isOpen === "boolean" ? redis.isOpen : true;
    if (redisUrl && open) {
      await redis.publish(NOTIFICATION_SSE_CHANNEL, envelope);
      return;
    }
  } catch (e) {
    console.error("[notifications] SSE Redis publish failed:", e?.message || e);
  }

  emitToUser(uid, data);
}

let subscriberPromise = null;

/** Must run on the HTTP API process (where SSE clients are registered). */
export function startNotificationSseSubscriber() {
  if (!redisUrl) {
    console.warn(
      "[notifications] REDIS_URL unset; real-time notification push requires Redis when using a separate worker process."
    );
    return Promise.resolve();
  }
  if (subscriberPromise) return subscriberPromise;

  subscriberPromise = (async () => {
    const sub = createClient({
      url: redisUrl,
      socket: { connectTimeout: 10_000 },
    });
    sub.on("error", (err) => {
      console.error("[notifications] SSE subscriber Redis error:", err.message);
    });
    await sub.connect();
    await sub.subscribe(NOTIFICATION_SSE_CHANNEL, (message) => {
      try {
        const { userId, data } = JSON.parse(message);
        emitToUser(userId, data);
      } catch (e) {
        console.error("[notifications] SSE subscriber parse error:", e);
      }
    });
    console.log("[notifications] SSE Redis subscriber ready");
  })().catch((e) => {
    console.error("[notifications] SSE subscriber failed:", e?.message || e);
    subscriberPromise = null;
  });

  return subscriberPromise;
}
