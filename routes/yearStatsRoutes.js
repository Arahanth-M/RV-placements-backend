import express from "express";
import authJWT from "../middleware/authJWT.js";
import { createYearStatsModel } from "../models/YearStats.js";
import { redisUrl } from "../src/utils/redisClient.js";
import { getJSON, setJSON } from "../src/utils/redisHelpers.js";
import { sortYearStatsRows } from "../utils/yearStatsSort.js";

const yearStatsRouter = express.Router();
const YEAR_STATS_CACHE_TTL_SECONDS = 365 * 24 * 60 * 60; // 1 year (static data)

function yearStatsCacheKey(yearNum) {
  return `rv:year-stats:${yearNum}`;
}

const requireAuthForRestrictedYears = (req, res, next) => {
  const yearNum = parseInt(req.params.year, 10);
  if (yearNum === 2024 || yearNum === 2025) {
    return authJWT(req, res, next);
  }
  next();
};

// Get stats for a specific year
// Require authentication for 2024 and 2025, but allow public access for other years
yearStatsRouter.get("/:year", requireAuthForRestrictedYears, async (req, res) => {
  try {
    const { year } = req.params;
    
    // Validate year
    const yearNum = parseInt(year);
    if (isNaN(yearNum) || yearNum < 2020 || yearNum > 2030) {
      return res.status(400).json({ error: "Invalid year. Must be between 2020 and 2030." });
    }

    const cacheKey = yearStatsCacheKey(yearNum);
    if (redisUrl) {
      const cached = await getJSON(cacheKey);
      if (Array.isArray(cached)) {
        return res.json(sortYearStatsRows(cached));
      }
    }

    // Create model for the specific year
    const YearStatsModel = createYearStatsModel(yearNum);
    
    // Fetch all documents from the collection
    const stats = sortYearStatsRows(await YearStatsModel.find({}).lean());

    if (redisUrl) {
      await setJSON(cacheKey, stats, YEAR_STATS_CACHE_TTL_SECONDS);
    }
    
    res.json(stats);
  } catch (error) {
    console.error("❌ Error fetching year stats:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

export default yearStatsRouter;

