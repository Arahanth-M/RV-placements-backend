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
      console.time("auth:total");
      try {
        const primaryEmail = profile?.emails?.[0]?.value || "";
        const normalizedEmail = primaryEmail.trim().toLowerCase();
        const picture = pictureFromGoogleProfile(profile);
        const displayName = profile.displayName?.trim() || "";

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
        const betaLookupPromise = (async () => {
          console.time("auth:beta_lookup");
          try {
            // Exact-match on Email lets MongoDB use the existing { Email: 1 } index.
            let betaRecord = await studentCollection.findOne(
              { Email: normalizedEmail },
              { projection: { _id: 1 } }
            );

            // Keep regex as a temporary safety fallback for any legacy rows with casing/whitespace issues.
            if (!betaRecord) {
              betaRecord = await studentCollection.findOne(
                {
                  Email: { $regex: new RegExp(`^\\s*${escapedEmail}\\s*$`, "i") },
                },
                { projection: { _id: 1 } }
              );
            }

            return betaRecord;
          } finally {
            console.timeEnd("auth:beta_lookup");
          }
        })();

        console.time("auth:db_parallel");
        const [studentRecord, existingUser] = await Promise.all([
          betaLookupPromise,
          User.findOne({ userId: profile.id }),
        ]);
        console.timeEnd("auth:db_parallel");
        const isBetaListed = Boolean(studentRecord);

        // 3. Authenticate or Create User
        if (existingUser) {
          const now = new Date();
          let shouldUpdate = false;

          if (existingUser.email !== normalizedEmail) {
            existingUser.email = normalizedEmail;
            shouldUpdate = true;
          }

          if (existingUser.isBetaListed !== isBetaListed) {
            existingUser.isBetaListed = isBetaListed;
            shouldUpdate = true;
          }

          if (picture && existingUser.picture !== picture) {
            existingUser.picture = picture;
            shouldUpdate = true;
          }

          if (displayName && existingUser.username !== displayName) {
            existingUser.username = displayName;
            shouldUpdate = true;
          }

          const lastActiveAtMs = existingUser.lastActiveAt
            ? new Date(existingUser.lastActiveAt).getTime()
            : 0;
          if (!lastActiveAtMs || now.getTime() - lastActiveAtMs >= 5 * 60 * 1000) {
            existingUser.lastActiveAt = now;
            shouldUpdate = true;
          }

          if (shouldUpdate) {
            console.time("auth:user_update_save");
            try {
              await existingUser.save();
            } finally {
              console.timeEnd("auth:user_update_save");
            }
          }

          return done(null, existingUser);
        }

        // New authorized user - create local account
        console.time("auth:user_create");
        let user;
        try {
          user = await new User({
            userId: profile.id,
            username: profile.displayName,
            email: normalizedEmail,
            picture,
            fillForm: false,
            isBetaListed,
            lastActiveAt: new Date(),
          }).save();
        } finally {
          console.timeEnd("auth:user_create");
        }

        console.log(`👤 New User Created: ${profile.displayName} (${normalizedEmail})`);

        // Send welcome email (non-blocking)
        sendWelcomeEmailWebhook(primaryEmail, profile.displayName).catch((err) => {
          console.error("Webhook error:", err);
        });

        done(null, user);
      } catch (err) {
        console.error("Passport strategy error:", err);
        done(err, null);
      } finally {
        console.timeEnd("auth:total");
      }
    }
  )
);
