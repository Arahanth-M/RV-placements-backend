// import express from "express";
// import passport from "passport";

// const router = express.Router();


// router.get('/google', passport.authenticate('google', {
//   scope: ['profile', 'email']
// }));

// router.get('/google/callback', 
//   passport.authenticate('google'),
//   (req, res) => {
    
//     res.redirect('http://lastMinutePlacementPrep.in?login=success');//http://localhost:5173
//   }
// );


// router.get('/current_user', (req, res) => {
//   res.json(req.user);
// });


// router.get('/logout', (req, res) => {
//   req.logout((err) => {
//     if (err) {
//       return res.status(500).json({ error: "Logout failed" });
//     }
//     res.json({ message: "Logged out successfully" });
//   });
// });

// export default router;

// import express from "express";
// import passport from "passport";

// const router = express.Router();

// // Choose redirect based on environment
// const CLIENT_URL =
//   process.env.NODE_ENV === "production"
//     ? "http://lastminuteplacementprep.in"
//     : "http://localhost:5173";

// // Start Google OAuth
// router.get("/google", passport.authenticate("google", {
//   scope: ["profile", "email"],
// }));

// // Handle callback
// router.get(
//   "/google/callback",
//   passport.authenticate("google", {
//     failureRedirect: `${CLIENT_URL}?login=failed`, 
//   }),
//   (req, res) => {
//     res.redirect(`${CLIENT_URL}?login=success`); 
//   }
// );


// router.get("/current_user", (req, res) => {
//   if (!req.user) {
//     return res.status(401).json({ error: "Not authenticated" });
//   }
//   res.json(req.user);
// });

// // Logout
// router.get("/logout", (req, res) => {
//   req.logout((err) => {
//     if (err) {
//       return res.status(500).json({ error: "Logout failed" });
//     }
//     res.clearCookie("connect.sid"); // ✅ clear session cookie explicitly
//     res.redirect(`${CLIENT_URL}?logout=success`); // ✅ redirect instead of raw JSON
//   });
// });

// export default router;

import express from "express";
import passport from "passport";

const router = express.Router();

// ✅ Fixed client URL determination - consistent with frontend constants
const CLIENT_URL = process.env.NODE_ENV === "production"
  ? "http://lastminuteplacementprep.in"
  : "http://localhost:5173";

// Start Google OAuth - this creates route /api/auth/google
router.get("/google", passport.authenticate("google", {
  scope: ["profile", "email"],
}));

// Handle callback - this creates route /api/auth/google/callback
router.get(
  "/google/callback",
  passport.authenticate("google", {
    failureRedirect: `${CLIENT_URL}?login=failed`,
  }),
  (req, res) => {
    res.redirect(`${CLIENT_URL}?login=success`);
  }
);

// Get current user - this creates route /api/auth/current_user
router.get("/current_user", (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  res.json(req.user);
});

// Logout - this creates route /api/auth/logout
router.get("/logout", (req, res) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({ error: "Logout failed" });
    }
    res.clearCookie("connect.sid"); // ✅ clear session cookie explicitly
    res.redirect(`${CLIENT_URL}?logout=success`); // ✅ redirect instead of raw JSON
  });
});

export default router;
