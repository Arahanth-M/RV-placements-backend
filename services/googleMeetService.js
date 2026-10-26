/**
 * Create Google Meet links without calendar invite emails (sendUpdates=none).
 *
 * Peer sessions (with attendeeEmails):
 *   Calendar event + silent attendees so organizers/joiners can enter as guests.
 *   Then best-effort: resolve Meet space, set RESTRICTED, add members/COHOST
 *   so a shared link does not let strangers walk in.
 *
 * Legacy / no attendees:
 *   Meet Spaces API RESTRICTED, then Calendar fallback.
 *
 * Auth (first match wins):
 * 1) OAuth refresh token:
 *    GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_MEET_REFRESH_TOKEN
 *    Scopes: meetings.space.created + calendar
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function googleErrorText(err) {
  const data = err?.response?.data;
  return [
    data?.error,
    data?.error_description,
    data?.error?.status,
    data?.error?.message,
    err?.message,
  ]
    .filter(Boolean)
    .join(" ");
}

/** Refresh tokens die when the Google account revokes the app or the token is rotated. */
function revokedMeetTokenMessage(err) {
  const raw = googleErrorText(err).toLowerCase();
  if (!raw.includes("invalid_grant") && !raw.includes("expired or revoked")) return "";
  return "Google Meet refresh token is expired or revoked. From RV-placements-backend run: node scripts/getGoogleMeetRefreshToken.js — sign in with the Meet account, paste the new GOOGLE_MEET_REFRESH_TOKEN into .env, and restart the backend.";
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
  try {
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
  } catch (err) {
    const revoked = revokedMeetTokenMessage(err);
    if (revoked) throw appError(revoked, "MEET_AUTH_FAILED", 503);
    throw err;
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

function normalizeSpaceName(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (s.startsWith("spaces/")) return s;
  return `spaces/${s}`;
}

/** Normalize email list (lowercase, unique, non-empty). */
export function normalizeEmailList(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const email = String(item || "")
      .trim()
      .toLowerCase();
    if (!email || !email.includes("@") || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

/** e.g. https://meet.google.com/abc-defg-hij → abc-defg-hij */
export function extractMeetingCodeFromLink(meetLink) {
  try {
    const u = new URL(String(meetLink || "").trim());
    if (!u.hostname.toLowerCase().includes("meet.google.com")) return "";
    const path = u.pathname.replace(/\/+$/, "").replace(/^\//, "");
    if (!path || path.includes("/")) return "";
    return path.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Create a Meet space via Meet REST API — no calendar event, no invite emails.
 * RESTRICTED: only registered space members join without knocking.
 */
async function createMeetSpaceViaApi(auth) {
  const accessToken = await getAccessToken(auth);
  const res = await fetch("https://meet.googleapis.com/v2/spaces", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      config: {
        accessType: "RESTRICTED",
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

  const spaceName = normalizeSpaceName(body?.name);
  return {
    meetLink,
    eventId: spaceName || String(body?.meetingCode || ""),
    spaceName,
    htmlLink: meetLink,
    accessType: String(body?.config?.accessType || "").toUpperCase() || "RESTRICTED",
  };
}

/**
 * Register a Google account as a space member (no Calendar invite email).
 *
 * @param {{ spaceName: string, email: string, role?: "COHOST"|"MEMBER" }} input
 */
export async function addMeetSpaceMember(input = {}) {
  const spaceName = normalizeSpaceName(input.spaceName);
  const email = String(input.email || "")
    .trim()
    .toLowerCase();
  const roleRaw = String(input.role || "")
    .trim()
    .toUpperCase();
  const roleAttempts =
    roleRaw === "COHOST" ? ["COHOST", ""] : roleRaw === "MEMBER" ? [""] : [""];
  if (!spaceName) {
    return { ok: false, skipped: true, error: "missing_space" };
  }
  if (!email || !email.includes("@")) {
    return { ok: false, skipped: true, error: "missing_email" };
  }

  let lastError = "";
  for (const role of roleAttempts) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0) await sleep(400 * attempt);
      try {
        const auth = buildAuthClient([MEET_SCOPE]);
        const accessToken = await getAccessToken(auth);
        const memberBody = role ? { email, role } : { email };
        const res = await fetch(`https://meet.googleapis.com/v2/${spaceName}/members`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(memberBody),
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok) {
          return { ok: true, role: role || "MEMBER" };
        }
        const status = res.status;
        const msg =
          body?.error?.message || body?.message || `Meet members.create ${status}`;
        if (status === 409 || /already exists|already a member/i.test(String(msg))) {
          return { ok: true, role: role || "MEMBER" };
        }
        lastError = msg;
        console.warn(
          `[googleMeet] members.create attempt ${attempt + 1} failed for ${email}${
            role ? ` (${role})` : ""
          }:`,
          msg
        );
      } catch (err) {
        lastError = err?.message || String(err);
        console.warn(
          `[googleMeet] members.create attempt ${attempt + 1} error for ${email}:`,
          lastError
        );
      }
    }
  }
  return { ok: false, error: lastError || "members_create_failed" };
}

/**
 * Patch space access type (OPEN | TRUSTED | RESTRICTED).
 */
export async function setMeetSpaceAccessType(spaceName, accessType = "RESTRICTED") {
  const space = normalizeSpaceName(spaceName);
  const type = String(accessType || "")
    .trim()
    .toUpperCase();
  if (!space) {
    return { ok: false, skipped: true, error: "missing_space" };
  }
  if (!["OPEN", "TRUSTED", "RESTRICTED"].includes(type)) {
    return { ok: false, skipped: true, error: "invalid_access_type" };
  }
  try {
    const auth = buildAuthClient([MEET_SCOPE]);
    const accessToken = await getAccessToken(auth);
    const res = await fetch(
      `https://meet.googleapis.com/v2/${space}?updateMask=config.accessType`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ config: { accessType: type } }),
      }
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg =
        body?.error?.message || body?.message || `Meet spaces.patch ${res.status}`;
      console.warn(`[googleMeet] set accessType ${type} failed:`, msg);
      return { ok: false, error: msg };
    }
    return { ok: true };
  } catch (err) {
    const msg = err?.message || String(err);
    console.warn(`[googleMeet] set accessType ${type} error:`, msg);
    return { ok: false, error: msg };
  }
}

/** Resolve spaces/{id} from a meet.google.com link (best-effort). */
export async function resolveSpaceNameFromMeetLink(meetLink) {
  const code = extractMeetingCodeFromLink(meetLink);
  if (!code) return "";
  try {
    const auth = buildAuthClient([MEET_SCOPE]);
    const accessToken = await getAccessToken(auth);
    const res = await fetch(
      `https://meet.googleapis.com/v2/spaces/${encodeURIComponent(code)}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.warn(
        "[googleMeet] spaces.get by meeting code failed:",
        body?.error?.message || body?.message || res.status
      );
      return "";
    }
    return normalizeSpaceName(body?.name);
  } catch (err) {
    console.warn("[googleMeet] spaces.get error:", err?.message || err);
    return "";
  }
}

/**
 * After Calendar Meet create: lock to RESTRICTED + register members when Meet API allows.
 */
async function hardenCalendarMeetAccess(meetLink, attendeeEmails = []) {
  const emails = normalizeEmailList(attendeeEmails);
  const spaceName = await resolveSpaceNameFromMeetLink(meetLink);
  if (!spaceName) return "";

  await setMeetSpaceAccessType(spaceName, "RESTRICTED");
  for (let i = 0; i < emails.length; i += 1) {
    await addMeetSpaceMember({
      spaceName,
      email: emails[i],
      role: i === 0 ? "COHOST" : "MEMBER",
    });
  }
  return spaceName;
}

/**
 * Calendar Meet — attendees join as guests; sendUpdates=none avoids invite emails.
 */
async function createMeetViaCalendar(auth, input) {
  const summary = String(input.summary || "Peer session").trim() || "Peer session";
  const description = String(input.description || "").trim();
  const slotStart = input.slotStart instanceof Date ? input.slotStart : new Date(input.slotStart);
  const slotEnd = input.slotEnd instanceof Date ? input.slotEnd : new Date(input.slotEnd);
  if (Number.isNaN(slotStart.getTime()) || Number.isNaN(slotEnd.getTime())) {
    throw appError("Invalid session time for Google Meet", "INVALID_SLOT", 400);
  }

  const attendeeEmails = normalizeEmailList(input.attendeeEmails);
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
  if (attendeeEmails.length) {
    // Silent guests — they can join Meet; we do not email calendar invites.
    resource.attendees = attendeeEmails.map((email) => ({ email }));
  }

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
    spaceName: "",
    htmlLink: String(event.htmlLink || ""),
  };
}

/**
 * Add guests to an existing Calendar Meet event (no invite emails).
 * @param {string} eventId
 * @param {string[]} emails
 */
export async function addCalendarEventAttendees(eventId, emails = []) {
  const id = String(eventId || "").trim();
  const toAdd = normalizeEmailList(emails);
  if (!id) return { ok: false, skipped: true, error: "missing_event" };
  if (!toAdd.length) return { ok: false, skipped: true, error: "missing_email" };

  try {
    const auth = buildAuthClient([CALENDAR_SCOPE]);
    const calendar = google.calendar({ version: "v3", auth });
    const calendarId = env("GOOGLE_MEET_CALENDAR_ID") || "primary";
    const existing = await calendar.events.get({ calendarId, eventId: id });
    const current = Array.isArray(existing?.data?.attendees) ? existing.data.attendees : [];
    const seen = new Set(
      current.map((a) => String(a?.email || "").trim().toLowerCase()).filter(Boolean)
    );
    const next = current.slice();
    let changed = false;
    for (const email of toAdd) {
      if (seen.has(email)) continue;
      next.push({ email });
      seen.add(email);
      changed = true;
    }
    if (!changed) return { ok: true, skipped: true };

    await calendar.events.patch({
      calendarId,
      eventId: id,
      conferenceDataVersion: 1,
      sendUpdates: "none",
      requestBody: { attendees: next },
    });
    return { ok: true };
  } catch (err) {
    const msg = err?.message || String(err);
    console.warn("[googleMeet] addCalendarEventAttendees failed:", msg);
    return { ok: false, error: msg };
  }
}

/**
 * Create a Google Meet for a peer session.
 * @param {{ summary: string, description?: string, slotStart: Date, slotEnd: Date, attendeeEmails?: string[] }} input
 */
export async function createGoogleMeetForSession(input = {}) {
  const auth = buildAuthClient();
  const attendeeEmails = normalizeEmailList(input.attendeeEmails);

  // Peer sessions: Calendar + silent attendees so the organizer can join (not only the token account).
  if (attendeeEmails.length > 0) {
    try {
      const created = await createMeetViaCalendar(auth, { ...input, attendeeEmails });
      try {
        const spaceName = await hardenCalendarMeetAccess(created.meetLink, attendeeEmails);
        if (spaceName) created.spaceName = spaceName;
      } catch (err) {
        console.warn(
          "[googleMeet] harden RESTRICTED/members after Calendar create failed:",
          err?.message || err
        );
      }
      console.log(
        `[googleMeet] Calendar Meet with ${attendeeEmails.length} silent attendee(s) (sendUpdates=none)`
      );
      return created;
    } catch (err) {
      if (err?.code === "MEET_AUTH_FAILED") throw err;
      const revoked = revokedMeetTokenMessage(err);
      if (revoked) throw appError(revoked, "MEET_AUTH_FAILED", 503);
      console.warn(
        "[googleMeet] Calendar+attendees path failed, trying Spaces API:",
        err?.message || err
      );
    }
  }

  // Spaces API (no calendar guests) — organizer must be added via members.create afterward.
  try {
    const space = await createMeetSpaceViaApi(auth);
    if (space?.meetLink) {
      if (space.spaceName && space.accessType && space.accessType !== "RESTRICTED") {
        const patched = await setMeetSpaceAccessType(space.spaceName, "RESTRICTED");
        if (patched.ok) space.accessType = "RESTRICTED";
      }
      console.log("[googleMeet] created RESTRICTED Meet space via Meet API");
      return space;
    }
  } catch (err) {
    if (err?.code === "MEET_AUTH_FAILED") throw err;
    const revoked = revokedMeetTokenMessage(err);
    if (revoked) throw appError(revoked, "MEET_AUTH_FAILED", 503);
    console.warn(
      "[googleMeet] Meet API path error (falling back to Calendar):",
      err?.message || err
    );
  }

  try {
    const created = await createMeetViaCalendar(auth, input);
    console.warn("[googleMeet] used bare Calendar fallback (no attendees on event)");
    return created;
  } catch (err) {
    const msg = err?.message || String(err);
    console.error("[googleMeet] calendar.events.insert failed:", msg);
    if (
      err?.code === "MEET_LINK_MISSING" ||
      err?.code === "INVALID_SLOT" ||
      err?.code === "MEET_AUTH_FAILED"
    ) {
      throw err;
    }
    const revoked = revokedMeetTokenMessage(err);
    if (revoked) throw appError(revoked, "MEET_AUTH_FAILED", 503);
    throw appError(
      "Could not create Google Meet link. Enable Google Meet API + Calendar API, re-run getGoogleMeetRefreshToken.js, and restart the backend.",
      "MEET_CREATE_FAILED",
      503
    );
  }
}

/** Unused import guard helper for tests / debugging. */
export function _istOffsetMs() {
  return IST_OFFSET_MS;
}
