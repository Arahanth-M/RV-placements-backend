import mongoose from "mongoose";
import Submission from "../models/Submission.js";
import User1 from "../models/User1.js";
import { withKeyedAsyncMutex } from "../utils/keyedAsyncMutex.js";
import { resolveSubmissionApproveVisit } from "./companyService.js";
import { applySubmissionToCompanyVisit } from "./applySubmissionToCompanyVisit.js";
import { invalidateAdminDashboardStatsCache } from "./adminDashboardStatsCache.js";
import {
  invalidateMySubmissionsCacheByEmail,
  submitterEmailFromSubmission,
} from "./mySubmissionsCache.js";
import { invalidateSpcMyRecordsCacheByEmail } from "./spcMyRecordsCache.js";
import { invalidateLeaderboardCache } from "../routes/leaderboardRoutes.js";

const POINTS_QUESTION = 5;
const POINTS_INTERVIEW_EXPERIENCE = 10;

async function invalidateSubmitterListCaches(submission) {
  const email = submitterEmailFromSubmission(submission);
  await Promise.all([
    invalidateMySubmissionsCacheByEmail(email),
    invalidateSpcMyRecordsCacheByEmail(email),
  ]);
}

function buildApproveLockKey(visitId) {
  return `submission-approve:visit:${String(visitId)}`;
}

export const MAX_SUBMISSION_APPROVE_BATCH_SIZE = 5000;
const BATCH_VISIT_GROUP_CONCURRENCY = 8;

function normalizeBatchSubmissionIds(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const id of raw) {
    const safe = String(id || "").trim();
    if (mongoose.Types.ObjectId.isValid(safe)) {
      out.push(safe);
    }
  }
  return [...new Set(out)].slice(0, MAX_SUBMISSION_APPROVE_BATCH_SIZE);
}

async function runTasksWithConcurrency(taskFns, limit) {
  if (!taskFns.length) return [];
  const results = new Array(taskFns.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < taskFns.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await taskFns[index]();
    }
  }

  const workers = Math.min(limit, taskFns.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

/**
 * Merge submission content into company visit, then mark submission approved and award points.
 * @param {import("../models/Submission.js").default} submission — mongoose document
 * @param {string} mergeSource
 * @param {{ role: string, name: string, email: string }} reviewer
 * @param {{ deferCacheInvalidation?: boolean }} [options]
 */
export async function approveSubmissionAndUpdateCompany(
  submission,
  mergeSource,
  reviewer,
  options = {}
) {
  const { deferCacheInvalidation = false } = options;
  if (!submission) {
    throw new Error("Submission not found.");
  }
  if (submission.status !== "pending") {
    throw new Error("Only pending submissions can be approved.");
  }

  const target = await resolveSubmissionApproveVisit(submission);
  if (!target?.visitId || !target?.companyId) {
    throw new Error("Company not found");
  }

  const lockKey = buildApproveLockKey(target.visitId);

  await withKeyedAsyncMutex(lockKey, async () => {
    await applySubmissionToCompanyVisit(
      target.visitId,
      target.companyId,
      submission,
      mergeSource
    );
  });

  submission.status = "approved";
  submission.approvedAt = new Date();
  submission.reviewedBy = reviewer;
  await submission.save();
  await invalidateSubmitterListCaches(submission);

  const pointsToAdd =
    submission.type === "interviewProcess" ? POINTS_INTERVIEW_EXPERIENCE : POINTS_QUESTION;

  const contributor =
    (await User1.findOne({ email: submission.submittedBy?.email }).select("points")) || null;
  if (contributor) {
    contributor.points = (contributor.points || 0) + pointsToAdd;
    await contributor.save();
    if (!deferCacheInvalidation) {
      try {
        await invalidateLeaderboardCache();
      } catch (cacheErr) {
        console.warn(
          "⚠️ Failed to invalidate leaderboard cache after approval:",
          cacheErr?.message || cacheErr
        );
      }
    }
  }

  if (!deferCacheInvalidation) {
    await invalidateAdminDashboardStatsCache();
  }

  return {
    submission,
    companyId: target.companyId,
    visitId: target.visitId,
  };
}

/**
 * Approve many pending submissions in one request.
 * Groups by company visit (sequential within visit) and runs visit groups in parallel.
 * @param {string[]} submissionIds
 * @param {{ role: string, name: string, email: string }} reviewer
 */
export async function approveSubmissionsBatch(submissionIds, reviewer) {
  const ids = normalizeBatchSubmissionIds(submissionIds);
  if (ids.length === 0) {
    return {
      successCount: 0,
      failCount: 0,
      total: 0,
      results: [],
    };
  }

  const objectIds = ids.map((id) => new mongoose.Types.ObjectId(id));
  const pendingDocs = await Submission.find({
    _id: { $in: objectIds },
    status: "pending",
  });
  const docById = new Map(pendingDocs.map((doc) => [String(doc._id), doc]));

  /** @type {{ submissionId: string, ok: boolean, error?: string }[]} */
  const results = [];

  /** @type {Map<string, { id: string, sub: import("../models/Submission.js").default, mergeSource: string }[]>} */
  const groupsByVisit = new Map();

  for (const id of ids) {
    const sub = docById.get(id);
    if (!sub) {
      results.push({
        submissionId: id,
        ok: false,
        error: "Submission not found or not pending.",
      });
      continue;
    }

    let visitKey;
    try {
      const target = await resolveSubmissionApproveVisit(sub);
      if (!target?.visitId) {
        throw new Error("Company not found");
      }
      visitKey = buildApproveLockKey(target.visitId);
    } catch (err) {
      results.push({
        submissionId: id,
        ok: false,
        error: String(err?.message || err || "Could not resolve company visit."),
      });
      continue;
    }

    if (!groupsByVisit.has(visitKey)) {
      groupsByVisit.set(visitKey, []);
    }
    groupsByVisit.get(visitKey).push({
      id,
      sub,
      mergeSource: sub.content,
    });
  }

  const groupProcessors = [...groupsByVisit.values()].map((groupItems) => async () => {
    const groupResults = [];
    for (const item of groupItems) {
      try {
        await approveSubmissionAndUpdateCompany(item.sub, item.mergeSource, reviewer, {
          deferCacheInvalidation: true,
        });
        groupResults.push({ submissionId: item.id, ok: true });
      } catch (err) {
        groupResults.push({
          submissionId: item.id,
          ok: false,
          error: String(err?.message || err || "Approval failed."),
        });
      }
    }
    return groupResults;
  });

  const groupedResultLists = await runTasksWithConcurrency(
    groupProcessors,
    BATCH_VISIT_GROUP_CONCURRENCY
  );
  for (const groupResults of groupedResultLists) {
    results.push(...groupResults);
  }

  const successCount = results.filter((r) => r.ok).length;
  const failCount = results.length - successCount;

  if (successCount > 0) {
    await invalidateAdminDashboardStatsCache();
    try {
      await invalidateLeaderboardCache();
    } catch (cacheErr) {
      console.warn(
        "⚠️ Failed to invalidate leaderboard cache after batch approval:",
        cacheErr?.message || cacheErr
      );
    }
  }

  return {
    successCount,
    failCount,
    total: results.length,
    results,
  };
}
