import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import keys from "../config/keys.js";
import Student from "../models/Student.js";
import User from "../models/User.js";
import User1 from "../models/User1.js";
import { urls } from "../config/constants.js";
import { sendWelcomeEmailWebhook } from "./webhookService.js";

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
      passReqToCallback: true,
    },
    async (req, accessToken, refreshToken, profile, done) => {
      console.time("auth:total");
      try {
        const primaryEmail = profile?.emails?.[0]?.value || "";
        const normalizedEmail = primaryEmail.trim().toLowerCase();
        const picture = pictureFromGoogleProfile(profile);
        const displayName = profile.displayName?.trim() || "";
        const flow = req?.cookies?.oauth_flow || "";
        const isAdminLogin = flow === "admin";

        // 1. Basic Email Validation
        if (!normalizedEmail) {
          return done(null, false, { reason: "not_allowed" });
        }

        const isRvce = normalizedEmail.endsWith("@rvce.edu.in");

        if (!isRvce) {
          return done(null, false, { reason: "domain" });
        }

        if (isAdminLogin) {
          const [existingAdminByGoogleId, existingAdminByEmail] = await Promise.all([
            User.findOne({ userId: profile.id }),
            User.findOne({ email: normalizedEmail }),
          ]);
          const adminUser = existingAdminByGoogleId || existingAdminByEmail;

          if (adminUser) {
            adminUser.userId = profile.id;
            adminUser.email = normalizedEmail;
            if (displayName) adminUser.username = displayName;
            if (picture) adminUser.picture = picture;
            adminUser.lastActiveAt = new Date();
            await adminUser.save();
            return done(null, adminUser);
          }

          const createdAdminUser = await new User({
            userId: profile.id,
            username: displayName,
            email: normalizedEmail,
            picture,
            fillForm: false,
            isBetaListed: true,
            lastActiveAt: new Date(),
          }).save();

          return done(null, createdAdminUser);
        }

        console.time("auth:db_parallel");
        const [existingUserByGoogleId, existingUserByEmail, studentRecord] = await Promise.all([
          User1.findOne({ googleId: profile.id }),
          User1.findOne({ email: normalizedEmail }),
          Student.findOne({ email: normalizedEmail }).select("_id name email").lean(),
        ]);
        console.timeEnd("auth:db_parallel");

        const existingUser = existingUserByGoogleId || existingUserByEmail;

        if (existingUser) {
          existingUser.googleId = profile.id;
          existingUser.email = normalizedEmail;
          if (displayName) {
            existingUser.username = displayName;
          } else if (!existingUser.username) {
            existingUser.username = studentRecord?.name || "";
          }
          if (picture) {
            existingUser.profilePicture = picture;
          }
          existingUser.lastLoginAt = new Date();
          if (!existingUser.role) {
            existingUser.role = "student";
          }

          console.time("auth:user_update_save");
          try {
            await existingUser.save();
          } finally {
            console.timeEnd("auth:user_update_save");
          }

          return done(null, existingUser);
        }

        if (!studentRecord) {
          console.time("auth:user_create_no_profile");
          let userWithoutProfile;
          try {
            userWithoutProfile = await new User1({
              googleId: profile.id,
              username:
                displayName ||
                (normalizedEmail.includes("@")
                  ? normalizedEmail.split("@")[0]
                  : "Student"),
              email: normalizedEmail,
              profilePicture: picture,
              role: "student",
              lastLoginAt: new Date(),
            }).save();
          } finally {
            console.timeEnd("auth:user_create_no_profile");
          }

          return done(null, userWithoutProfile);
        }

        console.time("auth:user_create");
        let user;
        try {
          user = await new User1({
            googleId: profile.id,
            username: displayName || studentRecord?.name || "",
            email: normalizedEmail,
            profilePicture: picture,
            role: "student",
            lastLoginAt: new Date(),
          }).save();
        } finally {
          console.timeEnd("auth:user_create");
        }

        console.log(
          `👤 New User1 Created: ${displayName || studentRecord?.name || "User"} (${normalizedEmail})`
        );

        sendWelcomeEmailWebhook(
          primaryEmail,
          displayName || studentRecord?.name || "Student"
        ).catch((err) => {
          console.error("Webhook error:", err);
        });

        return done(null, user);
      } catch (err) {
        console.error("Passport strategy error:", err);
        done(err, null);
      } finally {
        console.timeEnd("auth:total");
      }
    }
  )
);
