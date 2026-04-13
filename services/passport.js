import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import keys from "../config/keys.js";
import mongoose from "mongoose";
import User from "../models/User.js";
import { urls, ADMIN_EMAIL } from "../config/constants.js";
import { sendWelcomeEmailWebhook } from "./webhookService.js";

passport.use(
  new GoogleStrategy(
    {
      clientID: keys.googleClientID,
      clientSecret: keys.googleClientSecret,
      // Use relative callback URL so it works for localhost, root domain, and www domain.
      callbackURL: urls.GOOGLE_CALLBACK_PATH,
      proxy: true,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const primaryEmail = profile?.emails?.[0]?.value || "";
        const normalizedEmail = primaryEmail.trim().toLowerCase();
        const adminEmail = String(ADMIN_EMAIL || "").trim().toLowerCase();
        
        // 1. Basic Email Validation
        if (!normalizedEmail) {
          return done(null, false, { reason: "not_allowed" });
        }

        const isRvce = normalizedEmail.endsWith("@rvce.edu.in");
        const isCS22 = /^[a-zA-Z0-9._%+-]+\.cs22@rvce\.edu\.in$/.test(
          normalizedEmail
        );

        if (!isRvce) {
          return done(null, false, { reason: "domain" });
        }

        const betaAccess = isCS22;

        // 2. Strict Student/Admin Check
        const db = mongoose.connection.db;
        const studentCollection = db.collection("users_2026");
        
        // Find record by emailId (case-insensitive)
        const studentRecord = await studentCollection.findOne({ 
          emailId: { $regex: new RegExp(`^${normalizedEmail}$`, "i") } 
        });
        
        if (!studentRecord && normalizedEmail !== adminEmail) {
          console.warn(`🛑 Login Rejected for email: ${normalizedEmail} (No student record found in users_2026)`);
          return done(null, false, { reason: "not_found" });
        }

        // 3. Authenticate or Create User
        const existingUser = await User.findOne({ userId: profile.id });

        if (existingUser) {
          // Update the email just in case (ensure normalization)
          existingUser.email = normalizedEmail;
          existingUser.betaAccess = betaAccess;
          await existingUser.save();
          return done(null, existingUser);
        }

        // New authorized user - create local account
        const user = await new User({
          userId: profile.id,
          username: profile.displayName,
          email: normalizedEmail,
          picture: profile.photos?.[0]?.value || "",
          fillForm: false,
          betaAccess,
        }).save();

        console.log(`👤 New User Created: ${profile.displayName} (${normalizedEmail})`);

        // Send welcome email (non-blocking)
        sendWelcomeEmailWebhook(primaryEmail, profile.displayName).catch((err) => {
          console.error("Webhook error:", err);
        });

        done(null, user);
      } catch (err) {
        console.error("Passport strategy error:", err);
        done(err, null);
      }
    }
  )
);
