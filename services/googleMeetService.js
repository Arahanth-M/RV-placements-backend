/**
 * Create Google Meet links without calendar invite emails.
 *
 * Preferred: Meet REST API spaces.create (no calendar event → no invite mail).
 * Fallback: Calendar API conferenceData (sendUpdates=none, no attendees).
 *
 * Auth (first match wins):
 * 1) OAuth refresh token:
 *    GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_MEET_REFRESH_TOKEN
 *    Scopes: meetings.space.created (+ calendar optional for fallback)
 * 2) Service account + Workspace DWD:
 *    GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
 *    GOOGLE_MEET_IMPERSONATE_USER
 *
 * One-time refresh token helper:
 *   node scripts/getGoogleMeetRefreshToken.js
 */
import crypto from "crypto";
import { google } from "googleapis";
import { IST_OFFSET_MS, istDateParts } from "../utils/istSlotTime.js";

const pad2 = (n) => String(n).padStart(2, "0");

const MEET_SCOPE = "https://www.googleapis.com/auth/meetings.space.created";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";

/** RFC3339 wall time in Asia/Kolkata (+05:30) for a UTC Date. */
export function toIstRfc3339(date) {
  const d = date instanceof Date ? date : new Date(date);
  const p = istDateParts(d);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}T${pad2(p.hour)}:${pad2(p.minute)}:00+05:30`;
}

function env(name) {
  const v = process.env[name];
  return typeof v === "string" && v.trim() ? v.trim() : "";
}

function appError(message, code, status = 503) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

export function isGoogleMeetConfigured() {
  const hasOauth =
    Boolean(env("GOOGLE_CLIENT_ID")) &&
    Boolean(env("GOOGLE_CLIENT_SECRET")) &&
    Boolean(env("GOOGLE_MEET_REFRESH_TOKEN"));
  const hasSa =
    Boolean(env("GOOGLE_SERVICE_ACCOUNT_EMAIL")) &&
    Boolean(env("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY")) &&
    Boolean(env("GOOGLE_MEET_IMPERSONATE_USER"));
  return hasOauth || hasSa;
}

function buildAuthClient(scopes = [MEET_SCOPE, CALENDAR_SCOPE]) {
  const clientId = env("GOOGLE_CLIENT_ID");
  const clientSecret = env("GOOGLE_CLIENT_SECRET");
  const refreshToken = env("GOOGLE_MEET_REFRESH_TOKEN");

  if (clientId && clientSecret && refreshToken) {
    const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
    oauth2.setCredentials({ refresh_token: refreshToken });
    return oauth2;
  }

  const saEmail = env("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const saKey = env("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY")?.replace(/\\n/g, "\n");
  const impersonate = env("GOOGLE_MEET_IMPERSONATE_USER");
  if (saEmail && saKey && impersonate) {
    return new google.auth.JWT({
      email: saEmail,
      key: saKey,
      scopes,
      subject: impersonate,
    });
  }

  throw appError(
    "Google Meet is not configured. Set GOOGLE_MEET_REFRESH_TOKEN (with GOOGLE_CLIENT_ID/SECRET) or a Workspace service account.",
    "MEET_NOT_CONFIGURED",
    503
  );
}

async function getAccessToken(auth) {
  if (typeof auth.getAccessToken === "function") {
    const token = await auth.getAccessToken();
    const access =
      typeof token === "string" ? token : token?.token || token?.access_token || "";
    if (access) return access;
  }
  if (typeof auth.authorize === "function") {
    const creds = await auth.authorize();
    if (creds?.access_token) return creds.access_token;
  }
  throw appError("Could not refresh Google access token", "MEET_AUTH_FAILED", 503);
}

function extractMeetLink(event) {
  const hangout = event?.hangoutLink;
  if (typeof hangout === "string" && hangout.includes("meet.google.com")) {
    return hangout.trim();
  }
  const entries = event?.conferenceData?.entryPoints;
  if (Array.isArray(entries)) {
    const video = entries.find(
      (e) => e?.entryPointType === "video" && typeof e.uri === "string"
    );
    if (video?.uri?.includes("meet.google.com")) return video.uri.trim();
  }
  return "";
}

/**
 * Create a Meet space via Meet REST API — no calendar event, no invite emails.
 * @returns {Promise<{ meetLink: string, eventId: string, htmlLink: string }|null>}
 */
async function createMeetSpaceViaApi(auth) {
  const accessToken = await getAccessToken(auth);
  const res = await fetch("https://meet.googleapis.com/v2/spaces", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    // OPEN = anyone with the link can join (shared in-app after host accepts).
    body: JSON.stringify({
      config: {
        accessType: "OPEN",
        entryPointAccess: "ALL",
      },
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      body?.error?.message ||
      body?.message ||
      `Meet API ${res.status}`;
    console.warn("[googleMeet] spaces.create failed (will try Calendar fallback):", msg);
    return null;
  }

  const meetLink = String(body?.meetingUri || "").trim();
  if (!meetLink.includes("meet.google.com")) {
    console.warn("[googleMeet] spaces.create returned no meetingUri:", body);
    return null;
  }

  return {
    meetLink,
    eventId: String(body?.name || body?.meetingCode || ""),
    htmlLink: meetLink,
  };
}

/**
 * Calendar fallback — never invites guests / never sendUpdates.
 * May still notify the connected Google account if its Calendar
 * "new events" email setting is on (unavoidable for Calendar path).
 */
async function createMeetViaCalendar(auth, input) {
  const summary = String(input.summary || "Peer session").trim() || "Peer session";
  const description = String(input.description || "").trim();
  const slotStart = input.slotStart instanceof Date ? input.slotStart : new Date(input.slotStart);
  const slotEnd = input.slotEnd instanceof Date ? input.slotEnd : new Date(input.slotEnd);
  if (Number.isNaN(slotStart.getTime()) || Number.isNaN(slotEnd.getTime())) {
    throw appError("Invalid session time for Google Meet", "INVALID_SLOT", 400);
  }

  const calendar = google.calendar({ version: "v3", auth });
  const requestId = crypto.randomBytes(12).toString("hex");
  const calendarId = env("GOOGLE_MEET_CALENDAR_ID") || "primary";

  const resource = {
    summary,
    description:
      description ||
      "Peer session on Last Minute Placement Prep. Join with the Google Meet link.",
    start: {
      dateTime: toIstRfc3339(slotStart),
      timeZone: "Asia/Kolkata",
    },
    end: {
      dateTime: toIstRfc3339(slotEnd),
      timeZone: "Asia/Kolkata",
    },
    // Never attach guests — Calendar invite emails go to attendees.
    guestsCanInviteOthers: false,
    guestsCanModify: false,
    guestsCanSeeOtherGuests: false,
    reminders: { useDefault: false, overrides: [] },
    conferenceData: {
      createRequest: {
        requestId,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    },
  };

  const response = await calendar.events.insert({
    calendarId,
    conferenceDataVersion: 1,
    sendUpdates: "none",
    requestBody: resource,
  });

  const event = response?.data || {};
  let meetLink = extractMeetLink(event);

  if (!meetLink && event.id) {
    try {
      const fetched = await calendar.events.get({
        calendarId,
        eventId: event.id,
      });
      meetLink = extractMeetLink(fetched?.data);
    } catch (err) {
      console.warn("[googleMeet] events.get follow-up failed:", err?.message || err);
    }
  }

  if (!meetLink) {
    throw appError(
      "Google Calendar created the event but did not return a Meet link. Enable Meet in Calendar settings for the connected account.",
      "MEET_LINK_MISSING",
      503
    );
  }

  return {
    meetLink,
    eventId: String(event.id || ""),
    htmlLink: String(event.htmlLink || ""),
  };
}

/**
 * Create a Google Meet link (no invite emails to session hosts/joiners).
 * @param {{ summary: string, description?: string, slotStart: Date, slotEnd: Date }} input
 * @returns {Promise<{ meetLink: string, eventId: string, htmlLink: string }>}
 */
export async function createGoogleMeetForSession(input = {}) {
  const auth = buildAuthClient();

  // 1) Meet Spaces API — preferred (no calendar event ⇒ no invite mail).
  try {
    const space = await createMeetSpaceViaApi(auth);
    if (space?.meetLink) {
      console.log("[googleMeet] created Meet space via Meet API (no calendar invite)");
      return space;
    }
  } catch (err) {
    console.warn(
      "[googleMeet] Meet API path error (falling back to Calendar):",
      err?.message || err
    );
  }

  // 2) Calendar fallback (existing refresh tokens that only have calendar scope).
  try {
    const created = await createMeetViaCalendar(auth, input);
    console.warn(
      "[googleMeet] used Calendar fallback — re-run node scripts/getGoogleMeetRefreshToken.js after enabling Meet API to stop calendar-owner emails"
    );
    return created;
  } catch (err) {
    const msg = err?.message || String(err);
    console.error("[googleMeet] calendar.events.insert failed:", msg);
    if (err?.code === "MEET_LINK_MISSING" || err?.code === "INVALID_SLOT") throw err;
    throw appError(
      "Could not create Google Meet link. Enable Google Meet API, re-run getGoogleMeetRefreshToken.js, and restart the backend.",
      "MEET_CREATE_FAILED",
      503
    );
  }
}

/** Unused import guard helper for tests / debugging. */
export function _istOffsetMs() {
  return IST_OFFSET_MS;
}
