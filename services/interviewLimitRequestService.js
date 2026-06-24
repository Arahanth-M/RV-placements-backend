import mongoose from "mongoose";
import InterviewLimitRequest from "../models/InterviewLimitRequest.js";
import Student from "../models/Student.js";
import {
  DEFAULT_ELEVATED_WEEKLY_MAX,
  getInterviewWeeklyLimitMaxForUser,
  isInterviewWeeklyLimitElevatedUser,
} from "../config/interviewLimits.js";
import { getInterviewStartEligibility } from "./interviewSessionService.js";

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function toObjectId(id) {
  if (id == null) return null;
  if (id instanceof mongoose.Types.ObjectId) return id;
  try {
    return new mongoose.Types.ObjectId(String(id));
  } catch {
    return null;
  }
}

async function findStudentForUser({ userId, email }) {
  const normalizedEmail = normalizeEmail(email);
  const oid = toObjectId(userId);
  if (!oid && !normalizedEmail) return null;

  const query =
    oid && normalizedEmail
      ? { $or: [{ _id: oid }, { email: normalizedEmail }] }
      : oid
        ? { _id: oid }
        : { email: normalizedEmail };

  return Student.findOne(query).select("name usn email interviewWeeklyLimitMax").lean();
}

/**
 * @param {{ userId?: string, email?: string }} params
 * @returns {Promise<number>}
 */
export async function resolveInterviewWeeklyLimitMax({ userId, email } = {}) {
  if (isInterviewWeeklyLimitElevatedUser({ userId, email })) {
    return getInterviewWeeklyLimitMaxForUser({ userId, email });
  }

  const student = await findStudentForUser({ userId, email });
  const max = Number(student?.interviewWeeklyLimitMax);
  if (Number.isFinite(max) && max > 1) return Math.floor(max);
  return 1;
}

/**
 * @param {string} userId
 */
export async function getInterviewLimitRequestStatus(userId) {
  const id = String(userId || "").trim();
  if (!id) return { status: "none" };

  const pending = await InterviewLimitRequest.findOne({
    userId: id,
    status: "pending",
  })
    .sort({ createdAt: -1 })
    .select("status createdAt nextAvailableAt")
    .lean();

  if (pending) {
    return {
      status: "pending",
      requestedAt: pending.createdAt,
      nextAvailableAt: pending.nextAvailableAt,
    };
  }

  const latest = await InterviewLimitRequest.findOne({ userId: id })
    .sort({ createdAt: -1 })
    .select("status createdAt reviewedAt")
    .lean();

  if (!latest) return { status: "none" };
  if (latest.status === "approved") {
    return { status: "approved", reviewedAt: latest.reviewedAt };
  }
  if (latest.status === "dismissed") {
    return { status: "dismissed", reviewedAt: latest.reviewedAt };
  }
  return { status: "none" };
}

/**
 * @param {string} userId
 * @param {{ email?: string, username?: string }} user
 */
export async function submitInterviewLimitRequest(userId, user) {
  const id = String(userId || "").trim();
  const email = normalizeEmail(user?.email);
  if (!id || !email) {
    return { ok: false, reason: "invalid_input" };
  }

  const eligibility = await getInterviewStartEligibility(id, {
    weeklyMax: await resolveInterviewWeeklyLimitMax({ userId: id, email }),
  });
  if (eligibility.canStart) {
    return { ok: false, reason: "not_limited", message: "You can start an interview now." };
  }

  const existing = await InterviewLimitRequest.findOne({
    userId: id,
    status: "pending",
  })
    .select("_id")
    .lean();
  if (existing) {
    return { ok: false, reason: "already_requested", status: "pending" };
  }

  await InterviewLimitRequest.create({
    userId: id,
    email,
    status: "pending",
    nextAvailableAt: eligibility.nextAvailableAt
      ? new Date(eligibility.nextAvailableAt)
      : undefined,
    lastCompletedAt: eligibility.lastCompletedAt
      ? new Date(eligibility.lastCompletedAt)
      : undefined,
  });

  return { ok: true, status: "pending" };
}

export async function listPendingInterviewLimitRequestsForAdmin() {
  const rows = await InterviewLimitRequest.find({ status: "pending" })
    .sort({ createdAt: -1 })
    .lean();

  if (!rows.length) return [];

  const emails = [...new Set(rows.map((row) => normalizeEmail(row.email)).filter(Boolean))];
  const students = emails.length
    ? await Student.find({ email: { $in: emails } })
        .select("name usn email")
        .lean()
    : [];
  const studentByEmail = new Map(
    students.map((student) => [normalizeEmail(student.email), student])
  );

  return rows.map((row) => {
    const student = studentByEmail.get(normalizeEmail(row.email));
    return {
      requestId: String(row._id),
      userId: row.userId,
      email: normalizeEmail(row.email),
      name: student?.name || null,
      usn: student?.usn || null,
      requestedAt: row.createdAt,
      nextAvailableAt: row.nextAvailableAt,
      lastCompletedAt: row.lastCompletedAt,
    };
  });
}

/**
 * @param {string} requestId
 * @param {{ email?: string }} reviewer
 */
export async function approveInterviewLimitRequest(requestId, reviewer) {
  const oid = toObjectId(requestId);
  if (!oid) return { ok: false, reason: "invalid_input" };

  const row = await InterviewLimitRequest.findOne({
    _id: oid,
    status: "pending",
  }).lean();
  if (!row) return { ok: false, reason: "not_found" };

  const student = await findStudentForUser({
    userId: row.userId,
    email: row.email,
  });

  if (student?._id) {
    await Student.updateOne(
      { _id: student._id },
      { $set: { interviewWeeklyLimitMax: DEFAULT_ELEVATED_WEEKLY_MAX } }
    );
  }

  await InterviewLimitRequest.updateOne(
    { _id: oid },
    {
      $set: {
        status: "approved",
        reviewedAt: new Date(),
        reviewedByEmail: normalizeEmail(reviewer?.email) || undefined,
      },
    }
  );

  return { ok: true };
}

/**
 * @param {string} requestId
 * @param {{ email?: string }} reviewer
 */
export async function dismissInterviewLimitRequest(requestId, reviewer) {
  const oid = toObjectId(requestId);
  if (!oid) return { ok: false, reason: "invalid_input" };

  const res = await InterviewLimitRequest.updateOne(
    { _id: oid, status: "pending" },
    {
      $set: {
        status: "dismissed",
        reviewedAt: new Date(),
        reviewedByEmail: normalizeEmail(reviewer?.email) || undefined,
      },
    }
  );

  if (res.modifiedCount === 0) return { ok: false, reason: "not_found" };
  return { ok: true };
}
