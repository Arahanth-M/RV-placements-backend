import express from "express";
import { createYearStatsModel } from "../models/YearStats.js";

const yearStatsRouter = express.Router();

// Get stats for a specific year
// Require authentication for 2024 and 2025, but allow public access for other years
yearStatsRouter.get("/:year", async (req, res) => {
  try {
    const { year } = req.params;
    
    // Validate year
    const yearNum = parseInt(year);
    if (isNaN(yearNum) || yearNum < 2020 || yearNum > 2030) {
      return res.status(400).json({ error: "Invalid year. Must be between 2020 and 2030." });
    }

    // Require authentication for 2024 and 2025
    if (yearNum === 2024 || yearNum === 2025) {
      if (!req.user) {
        return res.status(401).json({ error: "You must be logged in to view this year's statistics." });
      }
    }

    // Create model for the specific year
    const YearStatsModel = createYearStatsModel(yearNum);
    
    // Fetch all documents from the collection
    const stats = await YearStatsModel.find({}).lean();
    
    res.json(stats);
  } catch (error) {
    console.error("❌ Error fetching year stats:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

export default yearStatsRouter;

