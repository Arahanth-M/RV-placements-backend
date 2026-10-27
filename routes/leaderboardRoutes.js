import express from "express";
import User1 from "../models/User1.js";
import Student from "../models/Student.js";
import Submission from "../models/Submission.js";
import authJWT from "../middleware/authJWT.js";
import { redisUrl } from "../src/utils/redisClient.js";
import { deleteKeysByPrefix, getJSON, setJSON } from "../src/utils/redisHelpers.js";
import {
  collegeIdFromUser,
  mongoMatchCampusVisitSubmissions,
  normalizeCollegeId,
  withInstitutionalCollegeEmailScope,
} from "../utils/collegeScope.js";

/** Campus leaderboard day windows: institutional emails + visit-scoped submissions only. */
function withCampusLeaderboardSubmissionScope(baseMatch, collegeIdRaw) {
  const campusOnly = mongoMatchCampusVisitSubmissions();
  const base =
    baseMatch && typeof baseMatch === "object" && Object.keys(baseMatch).length > 0
      ? { $and: [baseMatch, campusOnly] }
      : campusOnly;
  return withInstitutionalCollegeEmailScope(base, collegeIdRaw, "submittedBy.email");
}

const leaderboardRouter = express.Router();
/** Per-college cache: `…:v11:{collegeId}` — bump version when payload shape changes. */
const LEADERBOARD_CACHE_KEY_PREFIX = "rv:leaderboard:top_contributors:v11:";
const LEADERBOARD_TTL_SECONDS = 3 * 60 * 60; // 3 hours
const PREVIOUS_DAY_TOP_CACHE_KEY_PREFIX = "rv:leaderboard:previous_day_top";
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const LEADERBOARD_LOCK_MESSAGE = "Access to the leaderboard is restricted by the organization. Please contact the admin team for access.";

function leaderboardCacheKey(collegeIdRaw) {
  return `${LEADERBOARD_CACHE_KEY_PREFIX}${normalizeCollegeId(collegeIdRaw)}`;
}

function previousDayTopCacheKey(collegeIdRaw, previousDayKey) {
  return `${PREVIOUS_DAY_TOP_CACHE_KEY_PREFIX}:${normalizeCollegeId(collegeIdRaw)}:${previousDayKey}`;
}

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

/** Invalidate all campus leaderboard caches (all colleges). */
export async function invalidateLeaderboardCache() {
  if (!redisUrl) return;
  await deleteKeysByPrefix(LEADERBOARD_CACHE_KEY_PREFIX);
}

// GET /api/leaderboard/previous-day-top - previous IST day's top approved campus contributor
leaderboardRouter.get("/previous-day-top", authJWT, async (req, res) => {
  try {
    if (!(await ensureLeaderboardAccess(req, res))) {
      return;
    }

    const collegeId = collegeIdFromUser(req.user);
    const {
      now,
      previousDayStart,
      currentDayStart,
      nextDayStart,
      previousDayKey,
    } = getPreviousDayRangeIST();
    const cacheKey = previousDayTopCacheKey(collegeId, previousDayKey);

    if (redisUrl) {
      const cachedPreviousDayTop = await getJSON(cacheKey);
      if (cachedPreviousDayTop) {
        return res.json(cachedPreviousDayTop);
      }
    }

    // Campus only: institutional submitters + visit-scoped submissions (exclude /general).
    const dayMatch = withCampusLeaderboardSubmissionScope(
      {
        status: "approved",
        approvedAt: { $gte: previousDayStart, $lt: currentDayStart },
      },
      collegeId
    );

    const [top] = await Submission.aggregate([
      { $match: dayMatch },
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

// GET /api/leaderboard - top campus contributors by points (college-scoped)
leaderboardRouter.get("/", authJWT, async (req, res) => {
  try {
    if (!(await ensureLeaderboardAccess(req, res))) {
      return;
    }

    const collegeId = collegeIdFromUser(req.user);
    const cacheKey = leaderboardCacheKey(collegeId);

    if (redisUrl) {
      const cachedLeaderboard = await getJSON(cacheKey);
      if (Array.isArray(cachedLeaderboard)) {
        return res.json(cachedLeaderboard);
      }
    }

    // Institutional campus emails only — never /general (Gmail / non-college) users.
    const users = await User1.find(
      withInstitutionalCollegeEmailScope({}, collegeId, "email")
    )
      .select("googleId username profilePicture points")
      .sort({ points: -1 })
      .limit(10)
      .lean();

    const leaderboard = users.map((u, index) => ({
      rank: index + 1,
      userId: u.googleId,
      username: u.username || "Anonymous",
      picture: u.profilePicture || null,
      points: u.points ?? 0,
    }));

    if (redisUrl) {
      await setJSON(cacheKey, leaderboard, LEADERBOARD_TTL_SECONDS);
    }

    res.json(leaderboard);
  } catch (error) {
    console.error("❌ Error fetching leaderboard:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

export default leaderboardRouter;
