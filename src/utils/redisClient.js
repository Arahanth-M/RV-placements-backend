import { createClient } from "redis";

/**
 * Redis URL must come only from process.env.REDIS_URL (e.g. `.env` or docker-compose `environment`).
 * Docker Compose: set REDIS_URL to redis://<service-name>:6379 (e.g. hostname `redis` matches the service).
 */
const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
  console.warn(
    "[Redis] REDIS_URL is not set. Set REDIS_URL in your environment before connecting."
  );
}

const redis = createClient({
  url: redisUrl,
  socket: {
    // Fail fast instead of hanging startup (and blocking HTTP) when Redis is unreachable
    connectTimeout: 10_000,
  },
});

let lastRedisErrorLoggedAt = 0;
const REDIS_ERROR_LOG_INTERVAL_MS = 15_000;

redis.on("error", (error) => {
  const now = Date.now();
  if (now - lastRedisErrorLoggedAt < REDIS_ERROR_LOG_INTERVAL_MS) {
    return;
  }
  lastRedisErrorLoggedAt = now;
  console.error("[Redis] Connection error:", error.message);
  if (String(error.message).includes("ECONNREFUSED")) {
    console.error(
      "[Redis] Nothing listening at REDIS_URL. Start Redis (e.g. `brew services start redis` or `docker run -p 6379:6379 redis`) or point REDIS_URL at a running instance."
    );
  }
});

let isConnected = false;
let connectingPromise = null;

export async function connectRedis() {
  if (isConnected) {
    return;
  }
  if (!connectingPromise) {
    connectingPromise = redis
      .connect()
      .then(() => {
        isConnected = true;
        console.log("Redis connected");
      })
      .catch((error) => {
        console.error("[Redis] Failed to connect:", error.message);
      })
      .finally(() => {
        connectingPromise = null;
      });
  }
  return connectingPromise;
}

export { redisUrl };
export default redis;
