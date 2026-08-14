import express from "express";
import {
  getGeneralStatsByYear,
  listGeneralStatsMeta,
} from "../services/placementGeneralStatsCache.js";
import { parseGeneralStatsYear } from "../utils/generalStatsYears.js";
import optionalAuthJWT from "../middleware/optionalAuthJWT.js";
import { collegeIdFromUser, DEFAULT_COLLEGE_ID } from "../utils/collegeScope.js";

const placementGeneralStatsRouter = express.Router();

placementGeneralStatsRouter.get("/years", optionalAuthJWT, async (req, res) => {
  try {
    const collegeId = req.user ? collegeIdFromUser(req.user) : DEFAULT_COLLEGE_ID;
    const meta = await listGeneralStatsMeta(collegeId);
    return res.json(meta);
  } catch (error) {
    console.error("❌ Error listing general stats years:", error?.message || error);
    return res.status(500).json({ error: "Server error" });
  }
});

placementGeneralStatsRouter.get("/:year", optionalAuthJWT, async (req, res) => {
  try {
    const year = parseGeneralStatsYear(req.params.year);
    if (year == null) {
      return res.status(400).json({ error: "Invalid year. Must be 2024–2028." });
    }

    const collegeId = req.user ? collegeIdFromUser(req.user) : DEFAULT_COLLEGE_ID;
    const stats = await getGeneralStatsByYear(year, collegeId);
    if (!stats) {
      return res.status(404).json({
        error: "Stats 