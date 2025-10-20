import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import keys from "../config/keys.js";
import User from "../models/User.js";
import { urls } from "../config/constants.js";

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

passport.use(
  new GoogleStrategy(
    {
      clientID: keys.googleClientID,
      clientSecret: keys.googleClientSecret,
      callbackURL: urls.GOOGLE_CALLBACK_URL,
      proxy: true,
    },  
    async (accessToken, refreshToken, profile, done) => {
      try {
        const primaryEmail = profile?.emails?.[0]?.value || "";
        // Enforce rvce.edu.in email domain
        const allowedDomain = "rvce.edu.in";
        const emailDomain = primaryEmail.split("@")[1] || "";
        if (emailDomain.toLowerCase() !== allowedDomain) {
          // Send a specific reason so the client can show a friendly message
          return done(null, false, { reason: "domain" });
        }

        const existingUser = await User.findOne({ userId: profile.id });

        if (existingUser) {
          return done(null, existingUser);
        }

        const user = await new User({
          userId: profile.id,
          username: profile.displayName,
          email: primaryEmail,
          picture: profile.photos[0].value,
        }).save();

        done(null, user);
      } catch (err) {
        done(err, null);
      }
    }
  )
);
