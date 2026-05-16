/**
 * Read-through cache for GET /api/admin/students/placement-stats (and export).
 * Keyed by requested year query (or "default" when omitted).
 * Invalidate on any PlacementData write; TTL 1h if invalidation is missed.
 */
import mongoose from "mongoose";
import PlacementData from "../models/PlacementData.js";
import Student from "../models/Student.js";
import User1 from "../models/User1.js";
import { redisUrl } from "../src/utils/redisClient.js";
import { getJSON, setJSON, deleteKeysByPrefix } from "../src/utils/redisHelpers.js";

const KEY_PREFIX = "rv:admin:placement-stats:v1:";
/** 1 hour safety TTL when invalidation is not triggered */
const TTL_SECONDS = 3600;

function cacheKeyForYearRaw(yearRaw) {
  if (yearRaw == null || yearRaw === "") {
    return `${KEY_PREFIX}default`;
  }
  const y = Number.parseInt(String(yearRaw), 10);
  if (!Number.isFinite(y)) {
    return `${KEY_PREFIX}default`;
  }
  return `${KEY_PREFIX}y:${y}`;
}

function isValidStatsPayload(value) {
  if (!value || typeof value !== "object") return false;
  if (!Array.isArray(value.years) || !Array.isArray(value.branches)) return false;
  if (
    value.selectedYear != null &&
    typeof value.selectedYear !== "number" &&
    !Number.isFinite(Number(value.selectedYear))
  ) {
    return false;
  }
  return true;
}

/**
 * @param {unknown} yearRaw
 * @returns {Promise<{ years: number[], selectedYear: number | null, branches: object[] }>}
 */
export async function buildStudentPlacementStatsFromDb(yearRaw) {
  const requestedYear =
    yearRaw == null || yearRaw === ""
      ? null
      : Number.parseInt(String(yearRaw), 10);
  if (yearRaw != null && yearRaw !== "" && !Number.isFinite(requestedYear)) {
    const err = new Error("INVALID_YEAR");
    throw err;
  }

  const yearValues = (await PlacementData.distinct("placementYear", {
    placementYear: { $ne: null },
  }))
    .map((v) => Number.parseInt(String(v), 10))
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => b - a);

  const selectedYear =
    requestedYear != null
      ? requestedYear
      : yearValues.length > 0
        ? yearValues[0]
        : null;

  if (selectedYear == null) {
    return {
      years: yearValues,
      selectedYear: null,
      branches: [],
    };
  }

  const rows = await PlacementData.aggregate([
    { $match: { placementYear: selectedYear } },
    {
      $lookup: {
        from: Student.collection.name,
        localField: "studentId",
        foreignField: "_id",
        as: "student",
      },
    },
    {
      $unwind: {
        path: "$student",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        _id: 0,
        name: { $ifNull: ["$student.name", ""] },
        usn: { $ifNull: ["$student.usn", ""] },
        email: { $ifNull: ["$student.email", ""] },
        companyPlaced: { $ifNull: ["$companyPlaced", ""] },
        typeOfOffer: { $ifNull: ["$typeOfOffer", ""] },
        stipend: { $ifNull: ["$stipend", ""] },
        sixMonthsInternshipStipend: { $ifNull: ["$6-months-internship-stipend", ""] },
        ctc: { $ifNull: ["$ctc", ""] },
        role: { $ifNull: ["$role", ""] },
        ppoConversionType: { $ifNull: ["$ppoConversionType", ""] },
        createdBy: { $ifNull: ["$createdBy", ""] },
        branchCode: { $ifNull: ["$branchCode", "unknown"] },
        createdAt: { $ifNull: ["$createdAt", null] },
      },
    },
    {
      $sort: {
        branchCode: 1,
        usn: 1,
        name: 1,
        createdAt: -1,
      },
    },
  ]);

  const createdByKeys = Array.from(
    new Set(
      rows
        .map((row) => String(row?.createdBy || "").trim())
        .filter(Boolean)
    )
  );
  const createdByObjectIds = createdByKeys
    .filter((value) => mongoose.Types.ObjectId.isValid(value))
    .map((value) => new mongoose.Types.ObjectId(value));
  const createdByEmails = createdByKeys
    .filter((value) => value.includes("@"))
    .map((value) => value.toLowerCase());

  const [usersById, usersByEmail] = await Promise.all([
    createdByObjectIds.length > 0
      ? User1.find({ _id: { $in: createdByObjectIds } })
          .select("_id email username")
          .lean()
      : Promise.resolve([]),
    createdByEmails.length > 0
      ? User1.find({ email: { $in: createdByEmails } })
          .select("_id email username")
          .lean()
      : Promise.resolve([]),
  ]);

  const creatorBaseByKey = new Map();
  for (const user of [...usersById, ...usersByEmail]) {
    const idKey = String(user?._id || "").trim();
    const emailKey = String(user?.email || "").trim().toLowerCase();
    const payload = {
      name: String(user?.username || "").trim(),
      email: String(user?.email || "").trim().toLowerCase(),
    };
    if (idKey) creatorBaseByKey.set(idKey, payload);
    if (emailKey) creatorBaseByKey.set(emailKey, payload);
  }

  const creatorEmailsToResolve = Array.from(
    new Set(
      [
        ...createdByEmails,
        ...Array.from(creatorBaseByKey.values())
          .map((entry) => String(entry?.email || "").trim().toLowerCase())
          .filter(Boolean),
      ].filter(Boolean)
    )
  );
  const creatorStudentRows =
    creatorEmailsToResolve.length > 0
      ? await Student.find({ email: { $in: creatorEmailsToResolve } })
          .select("name usn email")
          .lean()
      : [];
  const creatorStudentByEmail = new Map(
    creatorStudentRows.map((student) => [
      String(student?.email || "").trim().toLowerCase(),
      {
        name: String(student?.name || "").trim(),
        usn: String(student?.usn || "").trim(),
      },
    ])
  );

  const branchMap = new Map();
  for (const row of rows) {
    const branchCode =
      String(row.branchCode || "unknown").trim().toLowerCase() || "unknown";
    if (!branchMap.has(branchCode)) {
      branchMap.set(branchCode, []);
    }
    const createdByKey = String(row.createdBy || "").trim();
    const createdByEmailKey = createdByKey.toLowerCase();
    const creatorBase =
      creatorBaseByKey.get(createdByKey) ||
      creatorBaseByKey.get(createdByEmailKey) || { name: "", email: "" };
    const creatorEmail = String(creatorBase.email || "").trim().toLowerCase();
    const creatorStudent = creatorEmail ? creatorStudentByEmail.get(creatorEmail) : null;

    branchMap.get(branchCode).push({
      name: row.name || "",
      usn: row.usn || "",
      email: row.email || "",
      companyPlaced: row.companyPlaced || "",
      typeOfOffer: row.typeOfOffer || "",
      stipend: row.stipend || "",
      sixMonthsInternshipStipend: row.sixMonthsInternshipStipend || "",
      ctc: row.ctc || "",
      role: row.role || "",
      ppoConversionType: row.ppoConversionType || "",
      createdBy: row.createdBy || "",
      addedByName: creatorStudent?.name || creatorBase.name || "",
      addedByUsn: creatorStudent?.usn || "",
      addedByEmail: creatorEmail || createdByEmailKey || "",
    });
  }

  const branches = Array.from(branchMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([branchCode, students]) => ({
      branchCode,
      count: students.length,
      students,
    }));

  return {
    years: yearValues,
    selectedYear,
    branches,
  };
}

/**
 * Cached stats for admin UI + export (same payload as before caching).
 * @param {unknown} yearRaw req.query.year
 */
export async function getStudentPlacementStats(yearRaw) {
  if (!redisUrl) {
    return buildStudentPlacementStatsFromDb(yearRaw);
  }

  const key = cacheKeyForYearRaw(yearRaw);
  const cached = await getJSON(key);
  if (isValidStatsPayload(cached)) {
    return cached;
  }

  const fresh = await buildStudentPlacementStatsFromDb(yearRaw);
  await setJSON(key, fresh, TTL_SECONDS);
  return fresh;
}

/** Drop all placement-stats cache entries after PlacementData changes. */
export async function invalidateStudentPlacementStatsCache() {
  if (!redisUrl) {
    return { deleted: 0, skippedNoRedis: true };
  }
  const deleted = await deleteKeysByPrefix(KEY_PREFIX);
  return { deleted };
}
