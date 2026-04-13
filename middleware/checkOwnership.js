/**
 * Ownership: current user must match resource owner (by param or async lookup).
 * Admins bypass (JWT role "admin" or isAdminSession).
 *
 * @param {{
 *   paramKey?: string,
 *   resolveOwnerId?: (req: import("express").Request) => unknown | Promise<unknown>,
 * }} options
 *
 * Provide at least one of:
 * - `paramKey`: compare `String(req.params[paramKey])` to `String(req.user._id)`
 * - `resolveOwnerId(req)`: return resource owner's user id (same id space as JWT `_id`)
 *
 * If both are set: uses param when present and non-empty; otherwise calls `resolveOwnerId`.
 */
function isAdminBypass(req) {
  if (!req.user) return false;
  if (req.user.isAdminSession === true) return true;
  return req.user.role === "admin";
}

function normalizeId(value) {
  if (value == null) return "";
  if (typeof value === "object" && value !== null && typeof value.toString === "function") {
    return String(value.toString()).trim();
  }
  return String(value).trim();
}

export function checkOwnership(options = {}) {
  const { paramKey, resolveOwnerId } = options;
  const hasParam = typeof paramKey === "string" && paramKey.length > 0;
  const hasResolver = typeof resolveOwnerId === "function";

  if (!hasParam && !hasResolver) {
    throw new TypeError("checkOwnership: provide paramKey and/or resolveOwnerId");
  }

  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    if (isAdminBypass(req)) {
      return next();
    }

    let ownerId;

    if (hasParam) {
      const raw = req.params?.[paramKey];
      if (raw != null && String(raw).trim() !== "") {
        ownerId = raw;
      }
    }

    if (ownerId == null && hasResolver) {
      try {
        ownerId = await Promise.resolve(resolveOwnerId(req));
      } catch {
        return res.status(500).json({
          success: false,
          message: "Ownership check failed",
        });
      }
    }

    const selfId = normalizeId(req.user._id);
    const ownerNorm = normalizeId(ownerId);

    if (!ownerNorm || selfId !== ownerNorm) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    next();
  };
}

export default checkOwnership;
