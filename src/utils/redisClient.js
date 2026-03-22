import Redis from "ioredis";

const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
  console.warn("[Redis] REDIS_URL is not set. Falling back to default Redis config.");
}

const redis = new Redis(redisUrl);

redis.on("connect", () => {
  console.log("[Redis] Connected successfully.");
});

redis.on("error", (error) => {
  console.error("[Redis] Connection error:", error.message);
});

export default redis;
