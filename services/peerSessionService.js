/**
 * Peer sessions: mock interviews, study groups, and doubt clarification.
 * - Join = request → host accepts (meeting link only after accept)
 * - Meeting link only during the scheduled window
 * - Leaving frees a seat so others can request/join
 * - No college filter
 */
import crypto from "crypto";
import PeerSession from "../models/PeerSession.js";
import { collegeIdFromUser } from "../utils/collegeScope.js";
import {
  createGoogleMeetForSession,
  isGoogleMeetConfigured,
} from "./googleMeetService.js";

export const SESSION_TYPES = {
  mock_interview: {
    id: "mock_interview",
    label: "Mock interview",
    defaultMax: 2,
    maxCap: 2,
  },
  study_group: {
    id: "study_group",
    label: "Study group",
    defaultMax: 4,
    maxCap: 8,
  },
  doubt_clarification: {
    id: "doubt_clarification",
    label: "Doubt clarification",
    defaultMax: 2,
    maxCap: 4,
  },
};

const SESSION_DURATION_MS = 30 * 60 * 1000;
const MIN_DURATION_MS = 15 * 60 * 1000;
const MAX_DURATION_MS = 3 * 60 * 60 * 1000;
/** Show meet link from 5 min before start until slot end. */
const MEET_EARLY_MS = 5 * 60 * 1000;
const MAX_OPEN_HOSTED = 5;
const MAX_UPCOMING_INVOLVED = 8;

function toSafeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function appError(message, code, status = 400) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

function normalizeSessionType(raw) {
  const id = toSafeString(raw, "").toLowerCase();
  if (!SESSION_TYPES[id]) {
    throw appError("Invalid session type", "INVALID_TYPE");
  }
  return id;
}

function resolveMaxParticipants(sessionType, requested) {
  const meta = SESSION_TYPES[sessionType];
  const n = Number(requested);
  if (Number.isFinite(n) && n >= 2) {
    return Math.min(meta.maxCap, Math.max(2, Math.floor(n)));
  }
  return meta.defaultMax;
}

function parseSlotStart(raw) {
  const d = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw appError("Invalid slot start time", "INVALID_SLOT");
  }
  const minStart = Date.now() - 60 * 1000; // allow "now" with 1 min clock skew
  if (d.getTime() < minStart) {
    throw appError("Start time can’t be in the past", "SLOT_TOO_SOON");
  }
  if (d.getTime() > Date.now() + 14 * 24 * 60 * 60 * 1000) {
    throw appError("Slots can only be booked up to 14 days ahead", "SLOT_TOO_FAR");
  }
  return d;
}

function parseSlotEnd(raw, slotStart) {
  if (raw == null || raw === "") {
    return new Date(slotStart.getTime() + SESSION_DURATION_MS);
  }
  const d = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw appError("Invalid slot end time", "INVALID_SLOT_END");
  }
  const durationMs = d.getTime() - slotStart.getTime();
  if (durationMs < MIN_DURATION_MS) {
    throw appError("Session must be at least 15 minutes", "DURATION_TOO_SHORT");
  }
  if (durationMs > MAX_DURATION_MS) {
    throw appError("Session can’t be longer than 3 hours", "DURATION_TOO_LONG");
  }
  return d;
}

/**
 * Normalize and accept Google Meet URLs only (optional override / legacy).
 */
export function normalizeGoogleMeetLink(raw) {
  let url = toSafeString(raw);
  if (!url) {
    throw appError("Paste a Google Meet link for this session", "MEET_LINK_REQUIRED");
  }
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw appError("Invalid Google Meet link", "INVALID_MEET_LINK");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw appError("Google Meet link must be an https URL", "INVALID_MEET_LINK");
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== "meet.google.com") {
    throw appError("Only Google Meet links (meet.google.com) are allowed", "INVALID_MEET_LINK");
  }
  const path = parsed.pathname.replace(/\/+$/, "") || "/";
  if (path === "/" || path === "/new" || path === "/landing") {
    throw appError(
      "Create a meeting in Google Meet, then paste the share link (e.g. meet.google.com/abc-defg-hij)",
      "INVALID_MEET_LINK"
    );
  }
  if (!/^\/([a-z0-9]{3}-[a-z0-9]{4}-[a-z0-9]{3}|lookup\/[a-zA-Z0-9_-]+|[a-z0-9-]{5,})$/i.test(path)) {
    throw appError(
      "That doesn’t look like a Google Meet share link. Use the link shown after you start/create a Meet.",
      "INVALID_MEET_LINK"
    );
  }
  return `https://meet.google.com${path}`;
}

/** Resolve Meet link: prefer Calendar API auto-create; optional pasted override. */
async function resolveMeetLinkForCreate({ meetLinkRaw, topic, sessionType, slotStart, slotEnd }) {
  const pasted = toSafeString(meetLinkRaw);
  if (pasted) {
    return {
      meetLink: normalizeGoogleMeetLink(pasted),
      googleEventId: "",
    };
  }
  if (!isGoogleMeetConfigured()) {
    throw appError(
      "Google Meet auto-create is not configured. Set GOOGLE_MEET_REFRESH_TOKEN (run: node scripts/getGoogleMeetRefreshToken.js).",
      "MEET_NOT_CONFIGURED",
      503
    );
  }
  const typeLabel = SESSION_TYPES[sessionType]?.label || "Peer session";
  const created = await createGoogleMeetForSession({
    summary: `${typeLabel}: ${topic}`.slice(0, 200),
    description: `Peer session on Last Minute Placement Prep.\nType: ${typeLabel}\nTopic: ${topic}`,
    slotStart,
    slotEnd,
    // No attendees — Meet link is shared in-app; avoids Google Calendar invite emails.
  });
  return {
    meetLink: created.meetLink,
    googleEventId: created.eventId || "",
  };
}

function actorFromReqUser(user = {}) {
  const userId = toSafeString(user.userId);
  if (!userId) {
    throw appError("Unauthorized", "UNAUTHORIZED", 401);
  }
  return {
    userId,
    name: toSafeString(user.username || user.name, "Student"),
    email: toSafeString(user.email).toLowerCase(),
    collegeId: toSafeString(collegeIdFromUser(user)),
  };
}

function participantCount(doc) {
  return Array.isArray(doc?.participants) ? doc.participants.length : 0;
}

function isParticipant(doc, userId) {
  return (doc?.participants || []).some((p) => p.userId === userId);
}

function isPendingRequester(doc, userId) {
  return (doc?.joinRequests || []).some((p) => p.userId === userId);
}

function seatsLeft(doc) {
  return Math.max(0, (doc.maxParticipants || 0) - participantCount(doc));
}

const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomInviteCode(length = 6) {
  let out = "";
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i += 1) {
    out += INVITE_ALPHABET[bytes[i] % INVITE_ALPHABET.length];
  }
  return out;
}

async function allocateInviteCode() {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const code = randomInviteCode(6);
    const exists = await PeerSession.exists({ inviteCode: code });
    if (!exists) return code;
  }
  throw appError("Could not allocate invite code", "INVITE_CODE_FAILED", 500);
}

function normalizeInviteCode(raw) {
  return toSafeString(raw)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function meetWindow(doc, nowMs = Date.now()) {
  const start = new Date(doc.slotStart).getTime() - MEET_EARLY_MS;
  const end = new Date(doc.slotEnd).getTime();
  return {
    start,
    end,
    open: nowMs >= start && nowMs <= end,
    before: nowMs < start,
    after: nowMs > end,
  };
}

function syncOpenFullStatus(doc) {
  if (!doc || doc.status === "cancelled" || doc.status === "completed") return;
  if (seatsLeft(doc) <= 0) {
    doc.status = "full";
  } else if (doc.status === "full") {
    doc.status = "open";
  }
}

function publicSession(doc, viewerUserId = "") {
  const raw = doc?.toObject ? doc.toObject() : doc;
  const viewerIn = Boolean(viewerUserId && isParticipant(raw, viewerUserId));
  const isHost = viewerUserId === raw.hostUserId;
  const pending = Boolean(viewerUserId && isPendingRequester(raw, viewerUserId));
  const window = meetWindow(raw);
  const canSeeMeet = viewerIn && window.open && raw.status !== "cancelled";

  let meetLinkStatus = "hidden";
  let meetLinkMessage = "";
  if (!viewerIn) {
    meetLinkStatus = pending ? "pending_approval" : "not_accepted";
    meetLinkMessage = pending
      ? "Waiting for the host to accept your request. The meeting link appears after approval, at session time."
      : "Request to join. The host must accept before you can see the meeting link.";
  } else if (raw.status === "cancelled") {
    meetLinkStatus = "cancelled";
    meetLinkMessage = "This session was cancelled.";
  } else if (window.before) {
    meetLinkStatus = "too_early";
    meetLinkMessage = `Meeting link unlocks 5 minutes before start (${new Date(
      window.start
    ).toLocaleString()}).`;
  } else if (window.after) {
    meetLinkStatus = "expired";
    meetLinkMessage = "This session’s meeting window has ended.";
  } else if (canSeeMeet) {
    meetLinkStatus = "available";
    meetLinkMessage = "Session is live — join with the link below.";
  }

  const participants = (raw.participants || []).map((p) => ({
    userId: p.userId,
    name: p.name || "Student",
    email: viewerIn || isHost ? p.email || "" : "",
    at: p.at || p.joinedAt,
  }));

  const joinRequests =
    isHost
      ? (raw.joinRequests || []).map((p) => ({
          userId: p.userId,
          name: p.name || "Student",
          email: p.email || "",
          note: toSafeString(p.note),
          at: p.at,
        }))
      : [];

  return {
    id: String(raw._id),
    hostUserId: raw.hostUserId,
    inviteCode: toSafeString(raw.inviteCode).toUpperCase(),
    sessionType: raw.sessionType,
    sessionTypeLabel: SESSION_TYPES[raw.sessionType]?.label || raw.sessionType,
    topic: raw.topic,
    notes: raw.notes || "",
    meetLink: canSeeMeet ? raw.meetLink : "",
    meetLinkStatus,
    meetLinkMessage,
    meetAvailableAt: new Date(new Date(raw.slotStart).getTime() - MEET_EARLY_MS).toISOString(),
    slotStart: raw.slotStart,
    slotEnd: raw.slotEnd,
    maxParticipants: raw.maxParticipants,
    participantCount: participantCount(raw),
    seatsLeft: seatsLeft(raw),
    pendingRequestCount: Array.isArray(raw.joinRequests) ? raw.joinRequests.length : 0,
    participants,
    joinRequests,
    status: raw.status,
    isHost,
    isJoined: viewerIn,
    isPendingRequest: pending,
    createdAt: raw.createdAt,
  };
}

async function refreshStatusIfNeeded(doc) {
  if (!doc) return doc;
  if (doc.status === "cancelled" || doc.status === "completed") return doc;

  const now = Date.now();
  if (new Date(doc.slotEnd).getTime() < now - 30 * 60 * 1000) {
    doc.status = "completed";
    doc.joinRequests = [];
    await doc.save();
    return doc;
  }

  const before = doc.status;
  syncOpenFullStatus(doc);
  if (doc.status !== before) await doc.save();
  return doc;
}

async function assertNoTimeConflict(userId, slotStart, slotEnd, excludeId = null) {
  const filter = {
    status: { $in: ["open", "full"] },
    slotStart: { $lt: slotEnd },
    slotEnd: { $gt: slotStart },
    $or: [{ "participants.userId": userId }, { "joinRequests.userId": userId }],
  };
  if (excludeId) filter._id = { $ne: excludeId };
  const overlap = await PeerSession.findOne(filter).lean();
  if (overlap) {
    throw appError(
      "You already have another session at this time (hosted, joined, or requested). Cancel or leave that one first.",
      "TIME_CONFLICT"
    );
  }
}

/**
 * @param {{ user: object, sessionType: string, topic: string, notes?: string, slotStart: string|Date, slotEnd?: string|Date, maxParticipants?: number, meetLink: string }} input
 */
export async function createPeerSession(input = {}) {
  const actor = actorFromReqUser(input.user);
  const sessionType = normalizeSessionType(input.sessionType);
  const topic = toSafeString(input.topic);
  if (topic.length < 3) {
    throw appError("Add a short topic (at least 3 characters)", "TOPIC_REQUIRED");
  }
  const notes = toSafeString(input.notes).slice(0, 1000);
  const slotStart = parseSlotStart(input.slotStart);
  const slotEnd = parseSlotEnd(input.slotEnd, slotStart);
  const maxParticipants = resolveMaxParticipants(sessionType, input.maxParticipants);

  const openHosted = await PeerSession.countDocuments({
    hostUserId: actor.userId,
    status: { $in: ["open", "full"] },
    slotEnd: { $gt: new Date() },
  });
  if (openHosted >= MAX_OPEN_HOSTED) {
    throw appError(
      `You already have ${MAX_OPEN_HOSTED} upcoming hosted sessions. Cancel one first.`,
      "HOST_LIMIT"
    );
  }

  await assertNoTimeConflict(actor.userId, slotStart, slotEnd);

  const { meetLink, googleEventId } = await resolveMeetLinkForCreate({
    meetLinkRaw: input.meetLink,
    topic,
    sessionType,
    slotStart,
    slotEnd,
  });

  const inviteCode = await allocateInviteCode();

  const doc = await PeerSession.create({
    hostUserId: actor.userId,
    sessionType,
    topic: topic.slice(0, 160),
    notes,
    meetLink,
    googleEventId: googleEventId || "",
    inviteCode,
    slotStart,
    slotEnd,
    maxParticipants,
    participants: [
      {
        userId: actor.userId,
        name: actor.name,
        email: actor.email,
        at: new Date(),
      },
    ],
    joinRequests: [],
    status: "open",
    collegeId: actor.collegeId,
  });

  return publicSession(doc, actor.userId);
}

export async function listOpenPeerSessions(input = {}) {
  const actor = actorFromReqUser(input.user);
  const typeFilter = toSafeString(input.sessionType).toLowerCase();
  // Show sessions that have not ended yet (not only future starts).
  // Hosting "now" used to hide sessions because slotStart > now filtered them out.
  const filter = {
    status: "open",
    slotEnd: { $gt: new Date() },
    hostUserId: { $ne: actor.userId },
    "participants.userId": { $ne: actor.userId },
    "joinRequests.userId": { $ne: actor.userId },
  };
  if (typeFilter && SESSION_TYPES[typeFilter]) {
    filter.sessionType = typeFilter;
  }

  const rows = await PeerSession.find(filter).sort({ slotStart: 1 }).limit(60);
  const out = [];
  for (const row of rows) {
    await refreshStatusIfNeeded(row);
    if (row.status !== "open") continue;
    if (seatsLeft(row) <= 0) continue;
    out.push(publicSession(row, actor.userId));
  }
  return out;
}

export async function listMyPeerSessions(input = {}) {
  const actor = actorFromReqUser(input.user);
  const rows = await PeerSession.find({
    $or: [
      { "participants.userId": actor.userId },
      { "joinRequests.userId": actor.userId },
      { hostUserId: actor.userId },
    ],
    status: { $in: ["open", "full", "completed", "cancelled"] },
  })
    .sort({ slotStart: -1 })
    .limit(40);

  const out = [];
  for (const row of rows) {
    await refreshStatusIfNeeded(row);
    out.push(publicSession(row, actor.userId));
  }
  return out;
}

/** Request to join — host must accept before you become a participant. */
export async function requestJoinPeerSession(input = {}) {
  const actor = actorFromReqUser(input.user);
  const sessionId = toSafeString(input.sessionId);
  if (!sessionId) {
    throw appError("sessionId is required", "INVALID_SESSION");
  }
  const note = toSafeString(input.note).slice(0, 400);
  if (note.length < 8) {
    throw appError("Add a short note (at least 8 characters) for the host", "NOTE_REQUIRED");
  }

  const involved = await PeerSession.countDocuments({
    status: { $in: ["open", "full"] },
    slotEnd: { $gt: new Date() },
    $or: [
      { "participants.userId": actor.userId },
      { "joinRequests.userId": actor.userId },
    ],
  });
  if (involved >= MAX_UPCOMING_INVOLVED) {
    throw appError("You have too many upcoming sessions / requests", "JOIN_LIMIT");
  }

  const doc = await PeerSession.findById(sessionId);
  if (!doc) {
    throw appError("Session not found", "NOT_FOUND", 404);
  }
  await refreshStatusIfNeeded(doc);

  if (doc.status === "cancelled") {
    throw appError("This session was cancelled", "CANCELLED");
  }
  if (doc.status === "completed") {
    throw appError("This session has ended", "COMPLETED");
  }
  if (new Date(doc.slotEnd).getTime() <= Date.now()) {
    throw appError("This session has already ended", "TOO_LATE");
  }
  if (doc.hostUserId === actor.userId || isParticipant(doc, actor.userId)) {
    return publicSession(doc, actor.userId);
  }
  if (isPendingRequester(doc, actor.userId)) {
    return publicSession(doc, actor.userId);
  }
  if (doc.status === "full" || seatsLeft(doc) <= 0) {
    throw appError("This session is full", "FULL");
  }

  await assertNoTimeConflict(actor.userId, doc.slotStart, doc.slotEnd, doc._id);

  const updated = await PeerSession.findOneAndUpdate(
    {
      _id: doc._id,
      status: "open",
      "participants.userId": { $nin: [actor.userId] },
      "joinRequests.userId": { $nin: [actor.userId] },
      $expr: { $lt: [{ $size: "$participants" }, "$maxParticipants"] },
    },
    {
      $push: {
        joinRequests: {
          userId: actor.userId,
          name: actor.name,
          email: actor.email,
          note,
          at: new Date(),
        },
      },
    },
    { new: true }
  );

  if (!updated) {
    throw appError("Could not request join — session may be full", "FULL");
  }

  return publicSession(updated, actor.userId);
}

/** @deprecated alias — request join (host approval required). */
export async function joinPeerSession(input = {}) {
  return requestJoinPeerSession(input);
}

export async function acceptJoinRequest(input = {}) {
  const actor = actorFromReqUser(input.user);
  const sessionId = toSafeString(input.sessionId);
  const requesterUserId = toSafeString(input.requesterUserId);
  if (!requesterUserId) {
    throw appError("requesterUserId is required", "INVALID_REQUESTER");
  }

  const doc = await PeerSession.findById(sessionId);
  if (!doc) {
    throw appError("Session not found", "NOT_FOUND", 404);
  }
  if (doc.hostUserId !== actor.userId) {
    throw appError("Only the host can accept join requests", "FORBIDDEN", 403);
  }
  await refreshStatusIfNeeded(doc);

  if (doc.status === "cancelled" || doc.status === "completed") {
    throw appError("Session is no longer open", "CLOSED");
  }
  if (seatsLeft(doc) <= 0) {
    throw appError("This session is full", "FULL");
  }

  const reqIdx = (doc.joinRequests || []).findIndex((p) => p.userId === requesterUserId);
  if (reqIdx < 0) {
    throw appError("No pending request from this user", "NO_REQUEST");
  }
  if (isParticipant(doc, requesterUserId)) {
    doc.joinRequests = doc.joinRequests.filter((p) => p.userId !== requesterUserId);
    syncOpenFullStatus(doc);
    await doc.save();
    return publicSession(doc, actor.userId);
  }

  const req = doc.joinRequests[reqIdx];
  doc.joinRequests.splice(reqIdx, 1);
  doc.participants.push({
    userId: req.userId,
    name: req.name,
    email: req.email,
    at: new Date(),
  });
  syncOpenFullStatus(doc);
  await doc.save();
  return publicSession(doc, actor.userId);
}

export async function rejectJoinRequest(input = {}) {
  const actor = actorFromReqUser(input.user);
  const sessionId = toSafeString(input.sessionId);
  const requesterUserId = toSafeString(input.requesterUserId);
  if (!requesterUserId) {
    throw appError("requesterUserId is required", "INVALID_REQUESTER");
  }

  const doc = await PeerSession.findById(sessionId);
  if (!doc) {
    throw appError("Session not found", "NOT_FOUND", 404);
  }
  if (doc.hostUserId !== actor.userId) {
    throw appError("Only the host can reject join requests", "FORBIDDEN", 403);
  }

  const before = (doc.joinRequests || []).length;
  doc.joinRequests = (doc.joinRequests || []).filter((p) => p.userId !== requesterUserId);
  if (doc.joinRequests.length === before) {
    throw appError("No pending request from this user", "NO_REQUEST");
  }
  await doc.save();
  return publicSession(doc, actor.userId);
}

export async function cancelJoinRequest(input = {}) {
  const actor = actorFromReqUser(input.user);
  const sessionId = toSafeString(input.sessionId);
  const doc = await PeerSession.findById(sessionId);
  if (!doc) {
    throw appError("Session not found", "NOT_FOUND", 404);
  }
  if (!isPendingRequester(doc, actor.userId)) {
    throw appError("You do not have a pending request", "NO_REQUEST");
  }
  doc.joinRequests = (doc.joinRequests || []).filter((p) => p.userId !== actor.userId);
  await doc.save();
  return publicSession(doc, actor.userId);
}

export async function cancelPeerSession(input = {}) {
  const actor = actorFromReqUser(input.user);
  const sessionId = toSafeString(input.sessionId);
  const doc = await PeerSession.findById(sessionId);
  if (!doc) {
    throw appError("Session not found", "NOT_FOUND", 404);
  }
  if (doc.hostUserId !== actor.userId) {
    throw appError("Only the host can cancel the session", "FORBIDDEN", 403);
  }
  if (doc.status === "cancelled") {
    return publicSession(doc, actor.userId);
  }
  if (doc.status === "completed") {
    throw appError("Session already completed", "COMPLETED");
  }
  doc.status = "cancelled";
  doc.joinRequests = [];
  await doc.save();
  return publicSession(doc, actor.userId);
}

export async function leavePeerSession(input = {}) {
  const actor = actorFromReqUser(input.user);
  const sessionId = toSafeString(input.sessionId);
  const doc = await PeerSession.findById(sessionId);
  if (!doc) {
    throw appError("Session not found", "NOT_FOUND", 404);
  }
  if (doc.hostUserId === actor.userId) {
    throw appError("Host should cancel the session instead of leaving", "HOST_LEAVE");
  }
  if (doc.status === "cancelled" || doc.status === "completed") {
    return publicSession(doc, actor.userId);
  }

  // Cancel pending request without freeing a seat (requests never held seats).
  if (isPendingRequester(doc, actor.userId) && !isParticipant(doc, actor.userId)) {
    doc.joinRequests = (doc.joinRequests || []).filter((p) => p.userId !== actor.userId);
    await doc.save();
    return publicSession(doc, actor.userId);
  }

  if (!isParticipant(doc, actor.userId)) {
    throw appError("You are not in this session", "NOT_JOINED");
  }

  doc.participants = (doc.participants || []).filter((p) => p.userId !== actor.userId);
  syncOpenFullStatus(doc);
  await doc.save();
  return publicSession(doc, actor.userId);
}

export async function getPeerSession(input = {}) {
  const actor = actorFromReqUser(input.user);
  const sessionId = toSafeString(input.sessionId);
  const doc = await PeerSession.findById(sessionId);
  if (!doc) {
    throw appError("Session not found", "NOT_FOUND", 404);
  }
  await refreshStatusIfNeeded(doc);
  return publicSession(doc, actor.userId);
}

/** Look up a joinable session by invite code (e.g. PS7K2M). */
export async function findPeerSessionByInviteCode(input = {}) {
  const actor = actorFromReqUser(input.user);
  const code = normalizeInviteCode(input.inviteCode);
  if (code.length < 4) {
    throw appError("Enter a valid session code", "INVALID_CODE");
  }

  const doc = await PeerSession.findOne({ inviteCode: code });
  if (!doc) {
    throw appError("No session found for that code", "NOT_FOUND", 404);
  }
  await refreshStatusIfNeeded(doc);

  if (doc.status === "cancelled") {
    throw appError("This session was cancelled", "CANCELLED");
  }
  if (doc.status === "completed" || new Date(doc.slotEnd).getTime() <= Date.now()) {
    throw appError("This session has ended", "COMPLETED");
  }

  return publicSession(doc, actor.userId);
}
