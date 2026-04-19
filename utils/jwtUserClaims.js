/**
 * Claims embedded in the access JWT at login. authJWT verifies the signature only
 * (no DB) and attaches this object to req.user.
 */
export function buildJwtPayloadFromUser(user, options = {}) {
  const doc = user.toObject ? user.toObject() : user;
  const isAdminSession = options?.isAdminSession === true;
  return {
    userId: doc.userId,
    email: doc.email,
    _id: String(doc._id),
    username: doc.username,
    picture: doc.picture,
    fillForm: doc.fillForm ?? false,
    points: doc.points ?? 0,
    isPremium: doc.isPremium ?? false,
    isBetaListed: doc.isBetaListed === true,
    hasSubmittedMissingCompanyRequest:
      doc.hasSubmittedMissingCompanyRequest === true,
    membershipType: doc.membershipType,
    companyId: doc.companyId,
    isAdminSession,
    role: isAdminSession ? "admin" : (doc.role || "student"),
    createdAt: doc.createdAt
      ? new Date(doc.createdAt).toISOString()
      : new Date().toISOString(),
  };
}
