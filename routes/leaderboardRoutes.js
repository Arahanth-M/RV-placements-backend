import express from "express";
import User from "../models/User.js";
import authJWT from "../middleware/authJWT.js";

const leaderboardRouter = express.Router();

// GET /api/leaderboard - top contributors by points (optional auth for visibility)
leaderboardRouter.get("/", authJWT, async (req, res) => {
  try {
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

    res.json(leaderboard);
  } catch (error) {
    console.error("❌ Error fetching leaderboard:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

export default leaderboardRouter;
