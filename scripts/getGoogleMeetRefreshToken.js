/**
 * One-time helper: obtain a Google OAuth refresh token for Meet link creation
 * WITHOUT calendar invite emails (Meet Spaces API).
 *
 * Prerequisites:
 * 1) Google Cloud Console → enable:
 *      - Google Meet API
 *      - Google Calendar API (fallback only)
 * 2) OAuth client (Web) — Authorized redirect URIs must include EXACTLY:
 *      http://localhost:7780/oauth2/google-meet/callback
 *    (or whatever you set in GOOGLE_MEET_OAUTH_REDIRECT)
 * 3) GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET in .env (same Web client)
 * 4) If OAuth app is in Testing mode, add this Google account as a test user
 *
 * Run:
 *   node scripts/getGoogleMeetRefreshToken.js
 *
 * Copy GOOGLE_MEET_REFRESH_TOKEN into .env and restart the interview backend.
 */
import "dotenv/config";
import http from "http";
import { google } from "googleapis";

const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
const redirect =
  process.env.GOOGLE_MEET_OAUTH_REDIRECT?.trim() ||
  "http://localhost:7780/oauth2/google-meet/callback";

if (!clientId || !clientSecret) {
  console.error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first.");
  process.exit(1);
}

const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirect);
// Meet Spaces API first (no invite emails). Calendar kept as fallback.
const scopes = [
  "https://www.googleapis.com/auth/meetings.space.created",
  "https://www.googleapis.com/auth/calendar",
];
const authUrl = oauth2.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: scopes,
});

console.log("\n=== Google Meet token (no invite emails) ===");
console.log("1) Enable Google Meet API (+ Calendar API) in Cloud Console.");
console.log("2) Under Credentials → your OAuth 2.0 Web client, add redirect URI EXACTLY:\n");
console.log("  ", redirect);
console.log("\n3) Open this URL and sign in with the platform Meet account:\n  ", authUrl);
console.log("\nWaiting for callback on", redirect, "…\n");

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, redirect);
    if (url.pathname !== new URL(redirect).pathname) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const code = url.searchParams.get("code");
    if (!code) {
      res.writeHead(400);
      res.end("Missing code");
      return;
    }
    const { tokens } = await oauth2.getToken(code);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      `<h2>Success</h2><p>Copy this into backend <code>.env</code>:</p><pre>GOOGLE_MEET_REFRESH_TOKEN=${tokens.refresh_token || "(none — revoke app access and retry with prompt=consent)"}</pre><p>Then restart the interview/backend server.</p>`
    );
    console.log("\nAdd to .env:\nGOOGLE_MEET_REFRESH_TOKEN=" + (tokens.refresh_token || ""));
    if (!tokens.refresh_token) {
      console.warn(
        "No refresh_token returned. In Google Account → Security → Third-party access, remove this app and run again."
      );
    }
    setTimeout(() => process.exit(0), 500);
  } catch (err) {
    console.error(err);
    res.writeHead(500);
    res.end(String(err?.message || err));
    process.exit(1);
  }
});

server.listen(new URL(redirect).port || 7780);
