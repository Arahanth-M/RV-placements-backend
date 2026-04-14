import express from "express";
import User from "../models/User.js";
import Submission from "../models/Submission.js";
import authJWT from "../middleware/authJWT.js";
import { redisUrl } from "../src/utils/redisClient.js";
import { getJSON, setJSON } from "../src/utils/redisHelpers.js";

const leaderboardRouter = express.Router();
const LEADERBOARD_CACHE_KEY = "rv:leaderboard:top_contributors";
const LEADERBOARD_TTL_SECONDS = 3 * 60 * 60; // 3 hours
const WEEKLY_TOP_CACHE_KEY_PREFIX = "rv:leaderboard:weekly_top";

function getCurrentWeekRangeUTC() {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun ... 6=Sat
  const diffToMonday = (day + 6) % 7; // Mon -> 0, Sun -> 6

  const weekStart = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - diffToMonday,
    0,
    0,
    0,
    0
  ));
  const nextWeekStart = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
  return { weekStart, nextWeekStart };
}

function buildWeeklyTopCacheKey(weekStart) {
  return `${WEEKLY_TOP_CACHE_KEY_PREFIX}:${weekStart.toISOString().slice(0, 10)}`;
}

// GET /api/leaderboard/weekly-top - current week's highest contributor
leaderboardRouter.get("/weekly-top", authJWT, async (req, res) => {
  try {
    const { weekStart, nextWeekStart } = getCurrentWeekRangeUTC();
    const cacheKey = buildWeeklyTopCacheKey(weekStart);

    if (redisUrl) {
      const cachedWeeklyTop = await getJSON(cacheKey);
      if (cachedWeeklyTop) {
        return res.json(cachedWeeklyTop);
      }
    }

    const [top] = await Submission.aggregate([
      {
        $match: {
          submittedAt: { $gte: weekStart, $lt: nextWeekStart },
        },
      },
      {
        $group: {
          _id: "$submittedBy.email",
          totalSubmissions: { $sum: 1 },
          questionsAdded: {
            $sum: {
              $cond: [{ $eq: ["$type", "internshipExperience"] }, 0, 1],
            },
          },
          experiencesAdded: {
            $sum: {
              $cond: [{ $eq: ["$type", "internshipExperience"] }, 1, 0],
            },
          },
          weeklyPoints: {
            $sum: {
              $cond: [{ $eq: ["$type", "internshipExperience"] }, 10, 5],
            },
          },
        },
      },
      { $sort: { weeklyPoints: -1, totalSubmissions: -1, _id: 1 } },
      { $limit: 1 },
    ]);

    let payload = null;
    if (top?._id) {
      const user = await User.findOne({ email: top._id })
        .select("userId username picture email")
        .lean();

      payload = {
        weekStart: weekStart.toISOString(),
        weekEndExclusive: nextWeekStart.toISOString(),
        userId: user?.userId || null,
        username: user?.username || top._id || "Anonymous",
        picture: user?.picture || null,
        email: top._id,
        weeklyPoints: top.weeklyPoints ?? 0,
        questionsAdded: top.questionsAdded ?? 0,
        experiencesAdded: top.experiencesAdded ?? 0,
        totalSubmissions: top.totalSubmissions ?? 0,
      };
    }

    const ttlSeconds = Math.max(
      60,
      Math.floor((nextWeekStart.getTime() - Date.now()) / 1000)
    );
    if (redisUrl) {
      await setJSON(cacheKey, payload, ttlSeconds);
    }

    return res.json(payload);
  } catch (error) {
    console.error("❌ Error fetching weekly top contributor:", error.message);
    return res.status(500).json({ error: "Server error" });
  }
});

// GET /api/leaderboard - top contributors by points (optional auth for visibility)
leaderboardRouter.get("/", authJWT, async (req, res) => {
  try {
    if (redisUrl) {
      const cachedLeaderboard = await getJSON(LEADERBOARD_CACHE_KEY);
      if (Array.isArray(cachedLeaderboard)) {
        return res.json(cachedLeaderboard);
      }
    }

    const users = await User.find({})
      .select("userId username picture points")
      .sort({ points: -1 })
      .limit(100)
      .lean();

    const leaderboard = users.map((u, index) => ({
      rank: index + 1,
      userId: u.userId,
      username: u.username || "Anonymous",
      picture: u.picture || null,
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
