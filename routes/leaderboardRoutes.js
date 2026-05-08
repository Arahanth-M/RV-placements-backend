import express from "express";
import User1 from "../models/User1.js";
import Student from "../models/Student.js";
import Submission from "../models/Submission.js";
import authJWT from "../middleware/authJWT.js";
import { redisUrl } from "../src/utils/redisClient.js";
import { deleteKey, getJSON, setJSON } from "../src/utils/redisHelpers.js";

const leaderboardRouter = express.Router();
const LEADERBOARD_CACHE_KEY = "rv:leaderboard:top_contributors";
const LEADERBOARD_TTL_SECONDS = 3 * 60 * 60; // 3 hours
const PREVIOUS_DAY_TOP_CACHE_KEY_PREFIX = "rv:leaderboard:previous_day_top";
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const LEADERBOARD_LOCK_MESSAGE = "LeaderBoard is warming up. Will be live soon";

async function ensureLeaderboardAccess(req, res) {
  const isAdminSession = req.user?.isAdminSession === true || req.user?.role === "admin";
  if (isAdminSession) {
    return true;
  }

  const loginEmail = String(req.user?.email || "").trim().toLowerCase();
  if (!loginEmail) {
    res.status(403).json({ error: LEADERBOARD_LOCK_MESSAGE });
    return false;
  }

  const studentRecord = await Student.findOne({ email: loginEmail }).select("_id").lean();
  if (!studentRecord) {
    res.status(403).json({ error: LEADERBOARD_LOCK_MESSAGE });
    return false;
  }

  return true;
}

function formatIstDateKey(date) {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getPreviousDayRangeIST() {
  const now = new Date();
  const shiftedNow = new Date(now.getTime() + IST_OFFSET_MS);
  const currentDayStartMs =
    Date.UTC(
      shiftedNow.getUTCFullYear(),
      shiftedNow.getUTCMonth(),
      shiftedNow.getUTCDate(),
      0,
      0,
      0,
      0
    ) - IST_OFFSET_MS;
  const nextDayStartMs = currentDayStartMs + 24 * 60 * 60 * 1000;
  const previousDayStartMs = currentDayStartMs - 24 * 60 * 60 * 1000;

  return {
    now,
    previousDayStart: new Date(previousDayStartMs),
    currentDayStart: new Date(currentDayStartMs),
    nextDayStart: new Date(nextDayStartMs),
    previousDayKey: formatIstDateKey(new Date(previousDayStartMs)),
  };
}

export async function invalidateLeaderboardCache() {
  if (!redisUrl) return;
  await deleteKey(LEADERBOARD_CACHE_KEY);
}

// GET /api/leaderboard/previous-day-top - previous IST day's top approved contributor
leaderboardRouter.get("/previous-day-top", authJWT, async (req, res) => {
  try {
    if (!(await ensureLeaderboardAccess(req, res))) {
      return;
    }

    const {
      now,
      previousDayStart,
      currentDayStart,
      nextDayStart,
      previousDayKey,
    } = getPreviousDayRangeIST();
    const cacheKey = `${PREVIOUS_DAY_TOP_CACHE_KEY_PREFIX}:${previousDayKey}`;

    if (redisUrl) {
      const cachedPreviousDayTop = await getJSON(cacheKey);
      if (cachedPreviousDayTop) {
        return res.json(cachedPreviousDayTop);
      }
    }

    const [top] = await Submission.aggregate([
      {
        $match: {
          status: "approved",
          approvedAt: { $gte: previousDayStart, $lt: currentDayStart },
        },
      },
      {
        $group: {
          _id: "$submittedBy.email",
          approvedSubmissionCount: { $sum: 1 },
          submittedByName: { $first: "$submittedBy.name" },
        },
      },
      { $sort: { approvedSubmissionCount: -1, _id: 1 } },
      { $limit: 1 },
    ]);

    let payload = null;
    if (top?._id) {
      const user = await User1.findOne({ email: top._id })
        .select("googleId username profilePicture email")
        .lean();

      payload = {
        day: previousDayKey,
        windowStart: previousDayStart.toISOString(),
        windowEndExclusive: currentDayStart.toISOString(),
        refreshAt: nextDayStart.toISOString(),
        userId: user?.googleId || null,
        username: user?.username || top.submittedByName || top._id || "Anonymous",
        picture: user?.profilePicture || null,
        email: top._id,
        approvedSubmissionCount: top.approvedSubmissionCount ?? 0,
      };
    } else {
      payload = {
        day: previousDayKey,
        windowStart: previousDayStart.toISOString(),
        windowEndExclusive: currentDayStart.toISOString(),
        refreshAt: nextDayStart.toISOString(),
        userId: null,
        username: null,
        picture: null,
        email: null,
        approvedSubmissionCount: 0,
      };
    }

    const ttlSeconds = Math.max(
      60,
      Math.floor((nextDayStart.getTime() - now.getTime()) / 1000)
    );
    if (redisUrl) {
      await setJSON(cacheKey, payload, ttlSeconds);
    }

    return res.json(payload);
  } catch (error) {
    console.error("❌ Error fetching previous day top contributor:", error.message);
    return res.status(500).json({ error: "Server error" });
  }
});

// GET /api/leaderboard - top contributors by points (optional auth for visibility)
leaderboardRouter.get("/", authJWT, async (req, res) => {
  try {
    if (!(await ensureLeaderboardAccess(req, res))) {
      return;
    }

    if (redisUrl) {
      const cachedLeaderboard = await getJSON(LEADERBOARD_CACHE_KEY);
      if (Array.isArray(cachedLeaderboard)) {
        return res.json(cachedLeaderboard);
      }
    }

    const users = await User1.find({})
      .select("googleId username profilePicture points")
      .sort({ points: -1 })
      .limit(100)
      .lean();

    const leaderboard = users.map((u, index) => ({
      rank: index + 1,
      userId: u.googleId,
      username: u.username || "Anonymous",
      picture: u.profilePicture || null,
      points: u.points ?? 0,
    }));

    if (redisUrl) {
      await setJSON(LEADERBOARD_CACHE_KEY, leaderboard, LEADERBOARD_TTL_SECONDS);
    }

    res.json(leaderboard);
  } catch (error) {
    console.error("❌ Error fetching leaderboard:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

export default leaderboardRouter;
