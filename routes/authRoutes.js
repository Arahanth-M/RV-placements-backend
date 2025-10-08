import express from "express";
import passport from "passport";
import { config, urls, messages } from "../config/constants.js";

const router = express.Router();


router.get("/google", passport.authenticate("google", {
  scope: ["profile", "email"],
}));

// Signup route - forces account selection
router.get("/google/signup", (req, res, next) => {
  req.session.signupFlow = true; // Set flag to indicate this is a signup
  next();
}, passport.authenticate("google", {
  scope: ["profile", "email"],
  prompt: "select_account", // This forces Google to show account selection
}));


router.get(
  "/google/callback",
  passport.authenticate("google", {
    failureRedirect: `${urls.CLIENT_URL}?login=failed`,
  }),
  (req, res) => {
    // Check if this was a signup or login
    const isSignup = req.session.signupFlow || false;
    req.session.signupFlow = false; // Reset the flag
    
    if (isSignup) {
      res.redirect(`${urls.CLIENT_URL}?signup=success`);
    } else {
      res.redirect(`${urls.CLIENT_URL}?login=success`);
    }
  }
);


router.get("/current_user", (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: messages.ERROR.NOT_AUTHENTICATED });
  }
  res.json(req.user);
});

// Get available accounts (for account switching)
router.get("/accounts", async (req, res) => {
  try {
    // This is a placeholder - in a real implementation, you might want to
    // store multiple accounts per user or use Google's account discovery
    if (req.user) {
      res.json({
        accounts: [{
          id: req.user.userId,
          email: req.user.email,
          name: req.user.username,
          picture: req.user.picture,
          isCurrent: true
        }],
        canAddMore: true
      });
    } else {
      res.json({
        accounts: [],
        canAddMore: true
      });
    }
  } catch (error) {
    console.error('Error fetching accounts:', error);
    res.status(500).json({ error: 'Failed to fetch accounts' });
  }
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
