import { getAssignedSpcCluster, isSpcActor } from "../utils/spcCluster.js";

/**
 * Attaches `req.spcCluster` for SPC users from User1 (so admin cluster changes apply without re-login).
 * Admin sessions are left unscoped (`req.spcCluster = null`).
 */
export default async function attachSpcCluster(req, res, next) {
  try {
    if (!isSpcActor(req.user)) {
      req.spcCluster = null;
      return next();
    }
    req.spcCluster = await getAssignedSpcCluster(req.user);
    return next();
  } catch (error) {
    console.error("attachSpcCluster:", error?.message || error);
    return res.status(500).json({ error: "Server error" });
  }
}
