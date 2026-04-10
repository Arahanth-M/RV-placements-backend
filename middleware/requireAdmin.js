export default (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: "You must log in!" });
  }
  
  if (req.user?.isAdminSession !== true) {
    return res.status(403).json({ error: "Access denied. Admin only." });
  }
  
  next();
};

