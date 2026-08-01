import jwt from "jsonwebtoken";
import { config } from "../config/constants.js";

const getBearerToken = (req) => {
  const auth = req.headers.authorization;
  if (!auth || typeof auth !== "string") {
    return null;
  }
  const [scheme, value] = auth.split(/\s+/, 2);
  if (!scheme || !value || scheme.toLowerCase() !== "bearer") {
    return null;
  }
  return value.trim() || null;
};

/**
 * Attach req.user when a valid JWT is present; otherwise continue without blocking.
 * Used by public-ish company list so college-scoped fields can still be filtered for logged-in users.
 */
export default function optionalAuthJWT(req, _res, next) {
  let token = req.cookies?.token;
  if (!token) {
    token = getBearerToken(req);
  }
  if (!token) {
    return next();
  }
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET);
    if (decoded?.userId && decoded?._id) {
      req.user = decoded;
    }
  } catch {
    // ignore invalid token — treat as anonymous
  }
  return next();
}
