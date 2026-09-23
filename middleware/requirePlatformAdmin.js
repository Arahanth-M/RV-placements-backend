import { isPlatformAdminUser } from "../utils/adminScope.js";

export default (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: "You must log in!" });
  }

  if (!isPlatformAdminUser(req.user)) {
    return res.status(403).json({ error: "Access denied. Platform admin only." });
  }

  next();
};
