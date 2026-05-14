/**
 * Allows admin dashboard session (legacy) or SPC role to access submission moderation routes.
 */
export default function requireAdminOrSpc(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "You must log in!" });
  }
  if (req.user.isAdminSession === true) {
    return next();
  }
  if (req.user.role === "spc") {
    return next();
  }
  return res.status(403).json({ error: "Access denied. Admin or SPC only." });
}
