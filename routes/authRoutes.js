import express from "express";
import passport from "passport";

const router = express.Router();


const CLIENT_URL = process.env.NODE_ENV === "production"
  ? "https://lastminuteplacementprep.in"
  : "http://localhost:5173";


router.get("/google", passport.authenticate("google", {
  scope: ["profile", "email"],
}));


router.get(
  "/google/callback",
  passport.authenticate("google", {
    failureRedirect: `${CLIENT_URL}?login=failed`,
  }),
  (req, res) => {
    res.redirect(`${CLIENT_URL}?login=success`);
  }
);


router.get("/current_user", (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  res.json(req.user);
});

router.get("/logout", (req, res) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({ error: "Logout failed" });
    }
    res.clearCookie("connect.sid"); 
    res.redirect(`${CLIENT_URL}?logout=success`); 
  });
});

export default router;
