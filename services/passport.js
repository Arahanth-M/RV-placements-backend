import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import keys from "../config/keys.js";
import mongoose from "mongoose";
import User from "../models/User.js";
import { urls, BETA_ACCESS_COLLECTION } from "../config/constants.js";
import { sendWelcomeEmailWebhook } from "./webhookService.js";

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Google may expose the avatar on photos[], _json.picture, or legacy profile.picture */
function pictureFromGoogleProfile(profile) {
  if (!profile) return "";
  const fromPhotos = profile.photos?.[0]?.value?.trim();
  if (fromPhotos) return fromPhotos;
  const fromJson = profile._json?.picture;
  if (typeof fromJson === "string" && fromJson.trim()) return fromJson.trim();
  const legacy = typeof profile.picture === "string" ? profile.picture.trim() : "";
  return legacy || "";
}

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

        // 1. Basic Email Validation
        if (!normalizedEmail) {
          return done(null, false, { reason: "not_allowed" });
        }

        const isRvce = normalizedEmail.endsWith("@rvce.edu.in");

        if (!isRvce) {
          return done(null, false, { reason: "domain" });
        }

        // 2. Strict Student/Admin Check
        const db = mongoose.connection.db;
        const studentCollection = db.collection(BETA_ACCESS_COLLECTION);
        const escapedEmail = escapeRegex(normalizedEmail);

        // Find by fixed roster email field (case-insensitive, trim-tolerant).
        const studentRecord = await studentCollection.findOne({
          Email: { $regex: new RegExp(`^\\s*${escapedEmail}\\s*$`, "i") },
        });
        const isBetaListed = Boolean(studentRecord);

        // 3. Authenticate or Create User
        const existingUser = await User.findOne({ userId: profile.id });

        if (existingUser) {
          existingUser.email = normalizedEmail;
          existingUser.isBetaListed = isBetaListed;
          existingUser.lastActiveAt = new Date();
          const pic = pictureFromGoogleProfile(profile);
          if (pic) existingUser.picture = pic;
          if (profile.displayName?.trim()) {
            existingUser.username = profile.displayName.trim();
          }
          await existingUser.save();
          return done(null, existingUser);
        }

        // New authorized user - create local account
        const user = await new User({
          userId: profile.id,
          username: profile.displayName,
          email: normalizedEmail,
          picture: pictureFromGoogleProfile(profile),
          fillForm: false,
          isBetaListed,
          lastActiveAt: new Date(),
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
