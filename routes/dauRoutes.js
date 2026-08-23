import express from "express";
import authJWT from "../middleware/authJWT.js";
import { recordHeartbeat } from "../services/dau/dauActiveTime.js";

const router = express.Router();

function parseHeartbeatBody(req, _res, next) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return next();
  }
  if (typeof req.body === "string" && req.body.trim()) {
    try {
      req.body = JSON.parse(req.body);
    } catch {
      req.body = {};
    }
  }
  next();
}

/**
 * Logged-in presence ping. Always 204 so unload/sendBeacon never depends on a body.
 * Redis-buffered; Mongo $inc activeMs only on flush. Never writes users1.
 */
router.post(
  "/heartbeat",
  express.text({
    type: (req) => String(req.headers["content-type"] || "").toLowerCase().startsWith("text/plain"),
    limit: "2kb",
  }),
  parseHeartbeatBody,
  authJWT,
  async (req, res) => {
    try {
      await recordHeartbeat(req.user, {
        deltaMs: req.body?.deltaMs,
        flush: req.body?.flush === true,
      });
    } catch (err) {
      console.warn("[dau] heartbeat route failed", err?.message || err);
    }
    return res.status(204).end();
  }
);

export default router;
