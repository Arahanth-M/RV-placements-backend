import mongoose from "mongoose";
import redis, { redisUrl } from "../src/utils/redisClient.js";

const startedAtMs = Date.now();

function redisConnectionOk() {
  if (!redisUrl) return false;
  try {
    return typeof redis.isOpen === "boolean" ? redis.isOpen : false;
  } catch {
    return false;
  }
}

/**
 * @param {string} serviceName — e.g. "backend-main", "backend-interview"
 */
export function createHealthHandler(serviceName) {
  return (_req, res) => {
    const mongoReadyState = mongoose.connection.readyState;
    const mongoConnected = mongoReadyState === 1;

    res.json({
      service: serviceName,
      uptimeSeconds: Math.floor((Date.now() - startedAtMs) / 1000),
      mongo: {
        connected: mongoConnected,
        readyState: mongoReadyState,
      },
      redis: {
        connected: redisConnectionOk(),
        configured: Boolean(redisUrl),
      },
      timestamp: new Date().toISOString(),
    });
  };
}
