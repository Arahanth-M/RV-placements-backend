import express from "express";
import User from "../models/User.js";
import authJWT from "../middleware/authJWT.js";
import { redisUrl } from "../src/utils/redisClient.js";
import { getJSON, setJSON } from "../src/utils/redisHelpers.js";

const leaderboardRouter = express.Router();
const LEADERBOARD_CACHE_KEY = "rv:leaderboard:top_contributors";
const LEADERBOARD_TTL_SECONDS = 3 * 60 * 60; // 3 hours

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
