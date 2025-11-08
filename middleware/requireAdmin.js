const ADMIN_EMAIL = "arahanthm.cs22@rvce.edu.in";

export default (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: "You must log in!" });
  }
  
  if (req.user.email?.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
    return res.status(403).json({ error: "Access denied. Admin only." });
  }
  
  next();
};

