/**
 * Internal DPDP account-deletion checklist for the general platform.
 *
 * Product rules (agreed):
 * - After delete, returning with the same Google account starts fresh (no premium).
 * - Revoke entitlements; keep anonymised billing stubs for tax/disputes.
 * - Wipe personal product data; do not refund unused premium time.
 *
 * Intended for ops / platform-admin fulfillment of email delete requests.
 */
import User1 from "../models/User1.js";
import User from "../models/User.js";
import Entitlement from "../models/Entitlement.js";
import PaymentOrder from "../models/PaymentOrder.js";
import InterviewSession from "../models/InterviewSession.js";
import PrepPathPlan from "../models/PrepPathPlan.js";
import PrepPathUsage from "../models/PrepPathUsage.js";
import BehavioralCoachAttempt from "../models/BehavioralCoachAttempt.js";
import ResumeDraft from "../models/ResumeDraft.js";
import BillingTrialUsage from "../models/BillingTrialUsage.js";
import Notification from "../models/Notification.js";
import PeerSession from "../models/PeerSession.js";
import InterviewSlotBooking from "../models/InterviewSlotBooking.js";
import PracticeChallengeAttempt from "../models/PracticeChallengeAttempt.js";
import UserPracticeStats from "../models/UserPracticeStats.js";
import DriveCalendarEntry from "../models/DriveCalendarEntry.js";
import InterviewLimitRequest from "../models/InterviewLimitRequest.js";
import Submission from "../models/Submission.js";
import BlockedLoginAttempt from "../models/BlockedLoginAttempt.js";
import DauDayUser from "../models/DauDayUser.js";

export const ACCOUNT_DELETE_CHECKLIST = Object.freeze([
  "Verify request email matches the account Google email",
  "Confirm no refund for unused premium (per refund policy)",
  "Revoke all billing entitlements (fresh start on return)",
  "Anonymise payment orders (keep stubs; clear email)",
  "Delete interviews, PrepPath, behavioural coach, resume drafts, trials",
  "Delete notifications, peer/slots/challenges, DAU rows, blocked-login rows",
  "Anonymise or remove submissions owned by the user",
  "Delete User1 (+ legacy User if present)",
  "Reply to the user confirming completion",
]);

function normEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normUserId(userId) {
  return String(userId || "").trim();
}

async function safeDeleteMany(model, filter, counts, key) {
  const result = await model.deleteMany(filter);
  counts[key] = (counts[key] || 0) + (result?.deletedCount || 0);
}

/**
 * Delete / anonymise a general-platform user account.
 *
 * @param {{ email?: string, userId?: string, dryRun?: boolean }} options
 */
export async function deleteGeneralUserAccount(options = {}) {
  const email = normEmail(options.email);
  const explicitUserId = normUserId(options.userId);
  const dryRun = options.dryRun === true;

  if (!email && !explicitUserId) {
    return {
      ok: false,
      reason: "missing_identity",
      error: "Provide email and/or userId (Google id).",
      checklist: ACCOUNT_DELETE_CHECKLIST,
    };
  }

  let userDoc = null;
  if (email) {
    userDoc = await User1.findOne({ email }).lean();
  }
  if (!userDoc && explicitUserId) {
    userDoc = await User1.findOne({
      $or: [{ googleId: explicitUserId }, { email: explicitUserId }],
    }).lean();
  }

  const userId = explicitUserId || normUserId(userDoc?.googleId);
  const resolvedEmail = email || normEmail(userDoc?.email);

  if (!userDoc && !userId && !resolvedEmail) {
    return {
      ok: false,
      reason: "not_found",
      error: "No matching user found.",
      checklist: ACCOUNT_DELETE_CHECKLIST,
    };
  }

  const counts = {};
  const plan = {
    userMongoId: userDoc?._id ? String(userDoc._id) : null,
    userId: userId || null,
    email: resolvedEmail || null,
    dryRun,
  };

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      plan,
      checklist: ACCOUNT_DELETE_CHECKLIST,
      note: "No writes performed. Re-run without dryRun to execute.",
    };
  }

  // 1) Revoke premium access (fresh start on return)
  if (userId) {
    await safeDeleteMany(Entitlement, { userId }, counts, "entitlements");
  }

  // 2) Keep billing stubs; strip personal email
  if (userId || resolvedEmail) {
    const payFilter = {
      $or: [
        ...(userId ? [{ userId }] : []),
        ...(resolvedEmail ? [{ email: resolvedEmail }] : []),
      ],
    };
    const payResult = await PaymentOrder.updateMany(payFilter, {
      $set: { email: "" },
    });
    counts.paymentOrdersAnonymised = payResult?.modifiedCount || 0;
  }

  // 3) Product PII / activity
  if (userId) {
    await safeDeleteMany(InterviewSession, { userId }, counts, "interviewSessions");
    await safeDeleteMany(PrepPathPlan, { userId }, counts, "prepPathPlans");
    await safeDeleteMany(PrepPathUsage, { userId }, counts, "prepPathUsage");
    await safeDeleteMany(
      BehavioralCoachAttempt,
      { userId },
      counts,
      "behavioralCoachAttempts"
    );
    await safeDeleteMany(BillingTrialUsage, { userId }, counts, "billingTrialUsage");
    await safeDeleteMany(Notification, { userId }, counts, "notifications");
    await safeDeleteMany(InterviewSlotBooking, { userId }, counts, "interviewSlotBookings");
    await safeDeleteMany(
      PracticeChallengeAttempt,
      { userId },
      counts,
      "practiceChallengeAttempts"
    );
    await safeDeleteMany(UserPracticeStats, { userId }, counts, "userPracticeStats");
    await safeDeleteMany(DriveCalendarEntry, { userId }, counts, "driveCalendarEntries");
    await safeDeleteMany(InterviewLimitRequest, { userId }, counts, "interviewLimitRequests");
    await safeDeleteMany(DauDayUser, { userId }, counts, "dauDayUsers");
    await safeDeleteMany(
      PeerSession,
      { hostUserId: userId },
      counts,
      "peerSessionsHosted"
    );
    const peerPull = await PeerSession.updateMany(
      {
        $or: [
          { "participants.userId": userId },
          { "joinRequests.userId": userId },
        ],
      },
      {
        $pull: {
          participants: { userId },
          joinRequests: { userId },
        },
      }
    );
    counts.peerSessionMembershipsCleared = peerPull?.modifiedCount || 0;
  }

  if (resolvedEmail) {
    await safeDeleteMany(ResumeDraft, { ownerEmail: resolvedEmail }, counts, "resumeDrafts");
    await safeDeleteMany(
      BlockedLoginAttempt,
      { email: resolvedEmail },
      counts,
      "blockedLoginAttempts"
    );

    // Pending submissions: delete. Approved: anonymise submitter.
    const pending = await Submission.deleteMany({
      "submittedBy.email": resolvedEmail,
      status: { $ne: "approved" },
    });
    counts.submissionsDeleted = pending?.deletedCount || 0;
    const anon = await Submission.updateMany(
      { "submittedBy.email": resolvedEmail },
      {
        $set: {
          "submittedBy.name": "Deleted user",
          "submittedBy.email": "deleted@redacted.local",
        },
      }
    );
    counts.submissionsAnonymised = anon?.modifiedCount || 0;
  }

  // 4) Account records
  if (userDoc?._id) {
    await User1.deleteOne({ _id: userDoc._id });
    counts.user1 = 1;
  } else if (resolvedEmail) {
    const r = await User1.deleteMany({ email: resolvedEmail });
    counts.user1 = r?.deletedCount || 0;
  }

  if (userId) {
    const legacy = await User.deleteMany({ userId });
    counts.legacyUser = legacy?.deletedCount || 0;
  }

  return {
    ok: true,
    dryRun: false,
    plan,
    deleted: counts,
    checklist: ACCOUNT_DELETE_CHECKLIST,
    note:
      "Entitlements revoked. Billing stubs kept with email cleared. Returning users start fresh without premium.",
  };
}
