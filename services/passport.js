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
        
        if (!normalizedEmail || (!normalizedEmail.endsWith("@rvce.edu.in") && normalizedEmail !== adminEmail)) {
          return done(null, false, { reason: "not_allowed" });
        }

        const db = mongoose.connection.db;
        const studentCollection = db.collection("users_2026");
        const studentRecord = await studentCollection.findOne({ emailId: normalizedEmail });
        
        if (!studentRecord && normalizedEmail !== adminEmail) {
          return done(null, false, { reason: "not_found" });
        }

        const existingUser = await User.findOne({ userId: profile.id });

        if (existingUser) {
          // Existing user - no webhook needed
          return done(null, existingUser);
        }

        // New user - create account
        const user = await new User({
          userId: profile.id,
          username: profile.displayName,
          email: primaryEmail,
          picture: profile.photos[0].value,
          fillForm: false, // New users need to fill the placement form
        }).save();

        // Send welcome email webhook only for new users
        // Fire and forget - don't block login if webhook fails
        sendWelcomeEmailWebhook(primaryEmail, profile.displayName).catch((err) => {
          console.error("Webhook error (non-blocking):", err);
        });

        done(null, user);
      } catch (err) {
        done(err, null);
      }
    }
  )
);
