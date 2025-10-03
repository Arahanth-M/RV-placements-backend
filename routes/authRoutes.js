import express from "express";
import passport from "passport";
import { config, urls, messages } from "../config/constants.js";

const router = express.Router();


router.get("/google", passport.authenticate("google", {
  scope: ["profile", "email"],
}));


router.get(
  "/google/callback",
  passport.authenticate("google", {
    failureRedirect: `${urls.CLIENT_URL}?login=failed`,
  }),
  (req, res) => {
    res.redirect(`${urls.CLIENT_URL}?login=success`);
  }
);


router.get("/current_user", (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: messages.ERROR.NOT_AUTHENTICATED });
  }
  res.json(req.user);
});

router.get("/logout", (req, res) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({ error: messages.ERROR.LOGOUT_FAILED });
    }
    res.clearCookie("connect.sid"); 
    res.redirect(`${urls.CLIENT_URL}?logout=success`); 
  });
});

export default router;
