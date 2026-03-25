import jwt from "jsonwebtoken";
import { config, messages } from "../config/constants.js";

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
 * Per-request: set DEBUG_JWT_AUTH=0 or false to silence auth debug lines (e.g. production).
 * Default: log token received / verified / userId (for E2E validation).
 */
function shouldLogJwtAuthSteps() {
  const v = process.env.DEBUG_JWT_AUTH;
  return v !== "0" && v !== "false";
}

export default function authJWT(req, res, next) {
  let token = req.cookies?.token;
  if (!token) {
    token = getBearerToken(req);
  }

  if (!token) {
    console.log("JWT failed");
    return res.status(401).json({ error: messages.ERROR.NOT_AUTHENTICATED });
  }

  if (shouldLogJwtAuthSteps()) {
    console.log("token received");
  }

  try {
    const decoded = jwt.verify(token, config.JWT_SECRET);

    if (shouldLogJwtAuthSteps()) {
      console.log("token verified");
    }

    if (!decoded.userId || !decoded._id) {
      console.log("JWT failed");
      return res.status(401).json({ error: messages.ERROR.NOT_AUTHENTICATED });
    }

    if (shouldLogJwtAuthSteps()) {
      console.log("userId extracted:", decoded.userId);
    }

    req.user = decoded;
    next();
  } catch {
    console.log("JWT failed");
    return res.status(401).json({ error: messages.ERROR.NOT_AUTHENTICATED });
  }
}
