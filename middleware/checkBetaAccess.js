import { messages } from "../config/constants.js";

export default function checkBetaAccess(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: messages.ERROR.NOT_AUTHENTICATED });
  }
  next();
}
