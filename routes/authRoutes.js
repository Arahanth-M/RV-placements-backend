import express from "express";
import jwt from "jsonwebtoken";
import passport from "passport";
import { config, urls, messages, isAdminEmail } from "../config/constants.js";
import authJWT from "../middleware/authJWT.js";
import { buildJwtPayloadFromUser } from "../utils/jwtUserClaims.js";

const router = express.Router();

const OAUTH_COOKIE_MAX_AGE_MS = 10 * 60 * 1000;

const oauthCookieOptions = () => ({
  httpOnly: true,
  maxAge: OAUTH_COOKIE_MAX_AGE_MS,
  sameSite: "lax",
  path: "/",
  secure: config.NODE_ENV === "production",
});

const getClientBaseUrl = (req) => {
  const cookieOrigin = req.cookies?.oauth_client_origin;
  if (cookieOrigin && config.CORS_ORIGINS.includes(cookieOrigin)) {
    return cookieOrigin;
  }

  const host = req.get("x-forwarded-host") || req.get("host");
  const proto = req.get("x-forwarded-proto") || req.protocol;

  if (!host) {
    return urls.CLIENT_URL;
  }

  // Local dev: OAuth callback hits the API host (legacy :7779 or split :7778/:7777); send the browser to Vite.
  if (
    host.includes("localhost:7779") ||
    host.includes("127.0.0.1:7779") ||
    host.includes("localhost:7778") ||
    host.includes("127.0.0.1:7778") ||
    host.includes("localhost:7777") ||
    host.includes("127.0.0.1:7777")
  ) {
    return config.FRONTEND_URL;
  }

  return `${proto}://${host}`;
};

const redirectToAuthCallback = (req, res, query) => {
  const clientUrl = getClientBaseUrl(req);
  res.clearCookie("oauth_client_origin", { path: "/" });
  res.clearCookie("oauth_flow", { path: "/" });
  return res.redirect(`${clientUrl}/auth/callback?${query}`);
};

const JWT_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const setTokenCookie = (res, user, options = {}) => {
  if (!config.JWT_SECRET) {
    console.warn("JWT_SECRET is not set; skipping token cookie");
    return;
  }
  const payload = buildJwtPayloadFromUser(user, options);
  const token = jwt.sign(payload, config.JWT_SECRET, { expiresIn: "7d" });
  res.cookie("token", token, {
    httpOnly: true,
    secure: config.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: JWT_COOKIE_MAX_AGE_MS,
    path: "/",
  });
  console.log("JWT issued for user");
};

const captureOAuthClientOrigin = (req, res, next) => {
  const referer = req.get("referer");
  if (referer) {
    try {
      const origin = new URL(referer).origin;
      if (config.CORS_ORIGINS.includes(origin)) {
        res.cookie("oauth_client_origin", origin, oauthCookieOptions());
      }
    } catch {
      // Ignore invalid referer values.
    }
  }
  next();
};

const setOAuthFlowCookie = (flow) => (req, res, next) => {
  res.cookie("oauth_flow", flow, oauthCookieOptions());
  next();
};

const clearOAuthFlow = (req, res, next) => {
  res.clearCookie("oauth_flow", { path: "/" });
  next();
};


router.get(
  "/google",
  captureOAuthClientOrigin,
  clearOAuthFlow,
  passport.authenticate("google", {
    session: false,
    scope: ["profile", "email"],
  })
);

router.get(
  "/google/admin",
  captureOAuthClientOrigin,
  setOAuthFlowCookie("admin"),
  passport.authenticate("google", {
    session: false,
    scope: ["profile", "email"],
  })
);

router.get(
  "/google/signup",
  captureOAuthClientOrigin,
  setOAuthFlowCookie("signup"),
  passport.authenticate("google", {
    session: false,
    scope: ["profile", "email"],
    prompt: "select_account",
  })
);


router.get(
  "/google/callback",
  (req, res, next) => {
    passport.authenticate("google", { session: false }, (err, user, info) => {
      if (err) {
        return redirectToAuthCallback(req, res, "login=failed");
      }
      if (!user) {
        if (info && info.reason === "domain") {
          return redirectToAuthCallback(req, res, "login=failed&reason=domain");
        }
        if (info && info.reason === "not_allowed") {
          return redirectToAuthCallback(req, res, "login=failed&reason=not_allowed");
        }
        if (info && info.reason === "not_found") {
          return redirectToAuthCallback(req, res, "login=failed&reason=not_found");
        }
        return redirectToAuthCallback(req, res, "login=failed");
      }

      const flow = req.cookies?.oauth_flow || "";
      const isAdminLogin = flow === "admin";
      const isSignup = flow === "signup";

      if (isAdminLogin) {
        if (!isAdminEmail(user.email)) {
          return redirectToAuthCallback(req, res, "login=failed&reason=not_admin");
        }
      }

      setTokenCookie(res, user, { isAdminSession: isAdminLogin });

      if (isAdminLogin) {
        return redirectToAuthCallback(req, res, "login=success&admin=true");
      }
      if (isSignup) {
        return redirectToAuthCallback(req, res, "signup=success");
      }
      return redirectToAuthCallback(req, res, "login=success");
    })(req, res, next);
  }
);


router.get("/current_user", authJWT, async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: messages.ERROR.NOT_AUTHENTICATED });
  }

  const { iat, exp, ...claims } = req.user;
  const createdAt = claims.createdAt ? new Date(claims.createdAt) : null;
  const isNewUser =
    createdAt &&
    Date.now() - createdAt.getTime() < 60 * 60 * 1000;

  res.json({
    ...claims,
    createdAt: createdAt || claims.createdAt,
    isNewUser: isNewUser || false,
  });
});

router.get("/is_admin", authJWT, (req, res) => {
  try {
    const isAdmin = req.user?.isAdminSession === true;
    res.json({ isAdmin });
  } catch (error) {
    console.error("❌ Error checking admin status:", error);
    res.status(500).json({ error: "Server error", isAdmin: false });
  }
});

router.get("/accounts", authJWT, async (req, res) => {
  try {
    if (req.user) {
      res.json({
        accounts: [{
          id: req.user.userId,
          email: req.user.email,
          name: req.user.username,
          picture: req.user.picture,
          isCurrent: true
        }],
        canAddMore: true
      });
    } else {
      res.json({
        accounts: [],
        canAddMore: true
      });
    }
  } catch (error) {
    console.error('Error fetching accounts:', error);
    res.status(500).json({ error: 'Failed to fetch accounts' });
  }
});

router.get("/logout", (req, res) => {
  res.clearCookie("token", { path: "/" });
  res.redirect(`${getClientBaseUrl(req)}?logout=success`);
});

export default router;
