// routes/authRoutes.js
import express from "express";
import { OAuth2Client } from "google-auth-library";
import bcrypt from "bcrypt";
import crypto from "crypto";
import User from "../models/User.js";

const router = express.Router();
const client = new OAuth2Client("319138363144-ubi4r2p9lkta6g3839bkoshdbdft1plu.apps.googleusercontent.com");

// POST /api/auth/google
router.post("/auth/google", async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ message: "Missing idToken" });

    // Verify token with Google
    const ticket = await client.verifyIdToken({
      idToken,
      audience: "319138363144-ubi4r2p9lkta6g3839bkoshdbdft1plu.apps.googleusercontent.com",
    });
    const payload = ticket.getPayload();
    const { email, email_verified, given_name, family_name, picture } = payload;

    if (!email_verified) {
      return res.status(401).json({ message: "Email not verified by Google" });
    }

    // Find existing user
    let user = await User.findOne({ emailId: email });

    if (!user) {
      // Generate a strong random password to satisfy schema
      const randomPwd = `Gg!${crypto.randomUUID()}9aA!`;
      const hash = await bcrypt.hash(randomPwd, 10);

      user = await User.create({
        firstName: given_name || "User",
        lastName: family_name || "",
        emailId: email,
        password: hash,
        photoUrl: picture || undefined,
        about: "Signed up with Google",
      });
    }

    // Create JWT using your model method
    const token = await user.getJWT();

    // Set cookie (httpOnly)
    res.cookie("token", token, {
      httpOnly: true,
      sameSite: "lax",              // for localhost during dev
      secure: false,                // true in prod with https
      maxAge: 7 * 24 * 3600 * 1000 // 7 days
    });

    // Return minimal user object
    return res.json({
      _id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      emailId: user.emailId,
      photoUrl: user.photoUrl,
    });
  } catch (err) {
    console.error("Google auth error:", err);
    return res.status(401).json({ message: "Invalid Google ID token" });
  }
});

export default router;
