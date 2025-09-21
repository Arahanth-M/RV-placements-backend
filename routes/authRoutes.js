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

import express from "express";
import passport from "passport";

const router = express.Router();

// Choose redirect based on environment
const CLIENT_URL =
  process.env.NODE_ENV === "production"
    ? "http://lastminuteplacementprep.in"
    : "http://localhost:5173";

// Start Google OAuth
router.get("/google", passport.authenticate("google", {
  scope: ["profile", "email"],
}));

// Handle callback
router.get(
  "/google/callback",
  passport.authenticate("google", {
    failureRedirect: `${CLIENT_URL}?login=failed`, // ✅ handle failure
  }),
  (req, res) => {
    res.redirect(`${CLIENT_URL}?login=success`); // ✅ flexible redirect
  }
);

// Get current logged-in user
router.get("/current_user", (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  res.json(req.user);
});

// Logout
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
