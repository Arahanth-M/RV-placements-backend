import { messages } from "../config/constants.js";

export default function checkBetaAccess(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: messages.ERROR.NOT_AUTHENTICATED });
  }

  if (req.user.isAdminSession === true) {
    return next();
  }

  if (req.user.isBetaListed !== true) {
    return res.status(403).json({
      success: false,
      message: "Access restricted to beta users",
    });
  }

  next();
}
