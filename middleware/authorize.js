/**
 * RBAC: allow route access only when JWT user role is in allowedRoles.
 * @param {string|string[]} allowedRoles
 */
export function authorize(allowedRoles) {
  const allowed = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const role =
      req.user.role || (req.user.isAdminSession ? "admin" : "student");

    // Backward-compatible admin check: allow admin session tokens even if legacy role claim is stale.
    if (allowed.includes("admin") && req.user.isAdminSession === true) {
      return next();
    }

    if (!allowed.includes(role)) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    next();
  };
}

export default authorize;
