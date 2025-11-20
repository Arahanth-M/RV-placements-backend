import express from "express";
import passport from "passport";
import { config, urls, messages, ADMIN_EMAIL } from "../config/constants.js";
import requireAuth from "../middleware/requireAuth.js";

const router = express.Router();


router.get("/google", passport.authenticate("google", {
  scope: ["profile", "email"],
}));

// Admin login route - same as regular login but will check email in callback
router.get("/google/admin", (req, res, next) => {
  req.session.isAdminLogin = true; // Set flag to indicate this is admin login
  next();
}, passport.authenticate("google", {
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
  (req, res, next) => {
    passport.authenticate("google", (err, user, info) => {
      if (err) {
        return res.redirect(`${urls.CLIENT_URL}/auth/callback?login=failed`);
      }
      if (!user) {
        // If domain is invalid, surface a specific code so UI can show a message
        if (info && info.reason === "domain") {
          return res.redirect(`${urls.CLIENT_URL}/auth/callback?login=failed&reason=domain`);
        }
        return res.redirect(`${urls.CLIENT_URL}/auth/callback?login=failed`);
      }

      const isAdminLogin = req.session.isAdminLogin || false;
      req.session.isAdminLogin = false;

      // Check if admin login and verify admin email
      if (isAdminLogin) {
        if (user.email?.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
          req.logout(() => {
            return res.redirect(`${urls.CLIENT_URL}/auth/callback?login=failed&reason=not_admin`);
          });
          return;
        }
      }

      req.logIn(user, (loginErr) => {
        if (loginErr) {
          return res.redirect(`${urls.CLIENT_URL}/auth/callback?login=failed`);
        }

        const isSignup = req.session.signupFlow || false;
        req.session.signupFlow = false;

        if (isAdminLogin) {
          return res.redirect(`${urls.CLIENT_URL}/auth/callback?login=success&admin=true`);
        }
        if (isSignup) {
          return res.redirect(`${urls.CLIENT_URL}/auth/callback?signup=success`);
        }
        return res.redirect(`${urls.CLIENT_URL}/auth/callback?login=success`);
      });
    })(req, res, next);
  }
);


router.get("/current_user", (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: messages.ERROR.NOT_AUTHENTICATED });
  }
  res.json(req.user);
});

// Check if current user is admin
router.get("/is_admin", requireAuth, (req, res) => {
  try {
    const isAdmin = req.user.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();
    res.json({ isAdmin });
  } catch (error) {
    console.error("❌ Error checking admin status:", error);
    res.status(500).json({ error: "Server error", isAdmin: false });
  }
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
