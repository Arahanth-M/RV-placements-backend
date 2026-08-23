import { collegeIdFromEmail } from "./collegeScope.js";

/**
 * Claims embedded in the access JWT at login. authJWT verifies the signature only
 * (no DB) and attaches this object to req.user.
 */
export function buildJwtPayloadFromUser(user, options = {}) {
  const doc = user.toObject ? user.toObject() : user;
  const isAdminSession = options?.isAdminSession === true;
  const email = doc.email || doc.emailId || "";
  const userId = doc.userId || doc.googleId || "";
  const username =
    doc.username ||
    doc.userName ||
    (email.includes("@") ? email.split("@")[0] : email) ||
    "Student";
  const picture = doc.picture || doc.profilePicture || "";
  const role =
    isAdminSession ? "admin" : String(doc.role || "student").trim().toLowerCase();
  const payload = {
    userId,
    email,
    collegeId: collegeIdFromEmail(email),
    _id: String(doc._id),
    username,
    picture,
    fillForm: false,
    points: doc.points ?? 0,
    isPremium: doc.isPremium ?? false,
    isBetaListed: true,
    hasSubmittedMissingCompanyRequest:
      doc.hasSubmittedMissingCompanyRequest === true,
    membershipType: doc.membershipType,
    companyId: doc.companyId,
    isAdminSession,
    role,
    createdAt: doc.createdAt
      ? new Date(doc.createdAt).toISOString()
      : new Date().toISOString(),
  };

  // Session-only claim (not stored on the user document). Used for the login digest.
  if (!isAdminSession && options.previousLastLoginAt) {
    const previous = new Date(options.previousLastLoginAt);
    if (!Number.isNaN(previous.getTime())) {
      payload.previousLastLoginAt = previous.toISOString();
    }
  }

  return payload;
}
