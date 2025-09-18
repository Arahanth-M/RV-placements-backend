import express from "express";
import passport from "passport";

const router = express.Router();


router.get('/google', passport.authenticate('google', {
  scope: ['profile', 'email']
}));

router.get('/google/callback', 
  passport.authenticate('google'),
  (req, res) => {
    
    res.redirect('http://localhost:5173?login=success');
  }
);


router.get('/current_user', (req, res) => {
  res.json(req.user);
});


router.get('/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({ error: "Logout failed" });
    }
    res.json({ message: "Logged out successfully" });
  });
});

export default router;