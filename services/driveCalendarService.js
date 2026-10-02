/**
 * Student-owned drive calendar entries.
 * Reminder preference is stored only; notifications are sent manually later.
 */
import DriveCalendarEntry, {
  newChecklistItemId,
  REMINDER_KINDS,
  REMINDER_CHANNELS,
} from "../models/DriveCalendarEntry.js";

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CHECKLIST = 20;

function toSafeString(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function appError(message, code, status = 400) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

function actorFromUser(user = {}) {
  const userId = toSafeString(user.userId);
  if (!userId) throw appError("Unauthorized", "UNAUTHORIZED", 401);
  return {
    userId,
    userObjectId: toSafeString(user._id) || userId,
    name: toSafeString(user.name) || toSafeString(user.displayName) || "Student",
  };
}

function normalizeType(raw) {
  const t = toSafeString(raw, "visit").toLowerCase();
  if (!["visit", "deadline", "note"].includes(t)) {
    throw appError("type must be visit, deadline, or note", "INVALID_TYPE");
  }
  return t;
}

function normalizeDateKey(raw) {
  const key = toSafeString(raw);
  if (!DATE_KEY_RE.test(key)) {
    throw appError("dateKey must be YYYY-MM-DD (IST)", "INVALID_DATE");
  }
  return key;
}

function normalizeChecklist(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw appError("checklist must be an array", "INVALID_CHECKLIST");
  if (raw.length > MAX_CHECKLIST) {
    throw appError(`At most ${MAX_CHECKLIST} checklist items`, "CHECKLIST_LIMIT");
  }
  return raw
    .map((item) => {
      const text = toSafeString(item?.text).slice(0, 200);
      if (!text) return null;
      return {
        id: toSafeString(item?.id) || newChecklistItemId(),
        text,
        done: Boolean(item?.done),
      };
    })
    .filter(Boolean);
}

function normalizePhone(raw) {
  const digits = String(raw || "").replace(/[^\d+]/g, "").trim();
  return digits.slice(0, 20);
}

function isPhoneChannel(channel) {
  return channel === "whatsapp" || channel === "sms";
}

function normalizeReminder(raw) {
  if (raw == null) {
    return { kind: "none", channel: "in_app", phone: "", note: "", status: "none" };
  }
  // Allow legacy clients that still send reminders: []
  if (Array.isArray(raw)) {
    return { kind: "none", channel: "in_app", phone: "", note: "", status: "none" };
  }
  const kind = toSafeString(raw.kind || raw.reminderKind, "none").toLowerCase();
  if (!REMINDER_KINDS.includes(kind)) {
    throw appError(
      "reminder.kind must be none, day_of, day_before, week_before, or custom",
      "INVALID_REMINDER_KIND"
    );
  }
  const channel = toSafeString(raw.channel || raw.reminderChannel, "in_app").toLowerCase();
  if (!REMINDER_CHANNELS.includes(channel)) {
    throw appError(
      "reminder.channel must be in_app, email, both, whatsapp, or sms",
      "INVALID_REMINDER_CHANNEL"
    );
  }
  const note = toSafeString(raw.note || raw.reminderNote).slice(0, 400);
  if (kind === "custom" && note.length < 3) {
    throw appError("Add a short note for a custom reminder", "REMINDER_NOTE_REQUIRED");
  }
  const phone = normalizePhone(raw.phone || raw.reminderPhone);
  if (kind !== "none" && isPhoneChannel(channel)) {
    const digitCount = phone.replace(/\D/g, "").length;
    if (digitCount < 10) {
      throw appError(
        "Enter a valid phone number (at least 10 digits) for WhatsApp / message reminders",
        "PHONE_REQUIRED"
      );
    }
  }
  return {
    kind,
    channel: kind === "none" ? "in_app" : channel,
    phone: kind === "none" || !isPhoneChannel(channel) ? "" : phone,
    note,
    status: kind === "none" ? "none" : "requested",
  };
}

function publicEntry(doc) {
  const raw = doc?.toObject ? doc.toObject() : doc;
  const reminder = raw.reminder || {
    kind: "none",
    channel: "in_app",
    phone: "",
    note: "",
    status: "none",
  };
  return {
    id: String(raw._id),
    type: raw.type,
    title: raw.title,
    companyName: raw.companyName || "",
    notes: raw.notes || "",
    dateKey: raw.dateKey,
    timeLabel: raw.timeLabel || "",
    checklist: (raw.checklist || []).map((c) => ({
      id: c.id,
      text: c.text,
      done: Boolean(c.done),
    })),
    reminder: {
      kind: reminder.kind || "none",
      channel: reminder.channel || "in_app",
      phone: reminder.phone || "",
      note: reminder.note || "",
      status: reminder.status || "none",
    },
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

export async function listDriveEntries(input = {}) {
  const actor = actorFromUser(input.user);
  const from = toSafeString(input.from);
  const to = toSafeString(input.to);
  const filter = { userId: actor.userId };
  if (from || to) {
    filter.dateKey = {};
    if (from && DATE_KEY_RE.test(from)) filter.dateKey.$gte = from;
    if (to && DATE_KEY_RE.test(to)) filter.dateKey.$lte = to;
    if (!Object.keys(filter.dateKey).length) delete filter.dateKey;
  }
  const rows = await DriveCalendarEntry.find(filter).sort({ dateKey: 1, createdAt: 1 }).lean();
  return rows.map(publicEntry);
}

export async function createDriveEntry(input = {}) {
  const actor = actorFromUser(input.user);
  const type = normalizeType(input.type);
  const title = toSafeString(input.title);
  if (title.length < 2) throw appError("Title is required (at least 2 characters)", "TITLE_REQUIRED");
  const dateKey = normalizeDateKey(input.dateKey);
  const checklist = normalizeChecklist(input.checklist);
  const reminder = normalizeReminder(input.reminder ?? input.reminders);

  const entry = await DriveCalendarEntry.create({
    userId: actor.userId,
    userObjectId: actor.userObjectId,
    type,
    title: title.slice(0, 160),
    companyName: toSafeString(input.companyName).slice(0, 160),
    notes: toSafeString(input.notes).slice(0, 2000),
    dateKey,
    timeLabel: toSafeString(input.timeLabel).slice(0, 64),
    checklist,
    reminder,
  });

  return { entry: publicEntry(entry) };
}

export async function updateDriveEntry(input = {}) {
  const actor = actorFromUser(input.user);
  const id = toSafeString(input.entryId);
  if (!id) throw appError("entryId is required", "INVALID_ID");

  const entry = await DriveCalendarEntry.findById(id);
  if (!entry || entry.userId !== actor.userId) {
    throw appError("Entry not found", "NOT_FOUND", 404);
  }

  if (input.type != null) entry.type = normalizeType(input.type);
  if (input.title != null) {
    const title = toSafeString(input.title);
    if (title.length < 2) throw appError("Title is required", "TITLE_REQUIRED");
    entry.title = title.slice(0, 160);
  }
  if (input.companyName != null) entry.companyName = toSafeString(input.companyName).slice(0, 160);
  if (input.notes != null) entry.notes = toSafeString(input.notes).slice(0, 2000);
  if (input.dateKey != null) entry.dateKey = normalizeDateKey(input.dateKey);
  if (input.timeLabel != null) entry.timeLabel = toSafeString(input.timeLabel).slice(0, 64);
  if (input.checklist != null) entry.checklist = normalizeChecklist(input.checklist);
  if (input.reminder !== undefined || input.reminders !== undefined) {
    entry.reminder = normalizeReminder(input.reminder ?? input.reminders);
  }

  if (!entry.userObjectId) entry.userObjectId = actor.userObjectId;

  await entry.save();
  return { entry: publicEntry(entry) };
}

export async function deleteDriveEntry(input = {}) {
  const actor = actorFromUser(input.user);
  const id = toSafeString(input.entryId);
  if (!id) throw appError("entryId is required", "INVALID_ID");

  const entry = await DriveCalendarEntry.findById(id);
  if (!entry || entry.userId !== actor.userId) {
    throw appError("Entry not found", "NOT_FOUND", 404);
  }

  await entry.deleteOne();
  return { success: true, id };
}

export async function toggleChecklistItem(input = {}) {
  const actor = actorFromUser(input.user);
  const id = toSafeString(input.entryId);
  const itemId = toSafeString(input.itemId);
  if (!id || !itemId) throw appError("entryId and itemId are required", "INVALID_ID");

  const entry = await DriveCalendarEntry.findById(id);
  if (!entry || entry.userId !== actor.userId) {
    throw appError("Entry not found", "NOT_FOUND", 404);
  }

  const item = (entry.checklist || []).find((c) => c.id === itemId);
  if (!item) throw appError("Checklist item not found", "ITEM_NOT_FOUND", 404);

  if (typeof input.done === "boolean") item.done = input.done;
  else item.done = !item.done;

  await entry.save();
  return { entry: publicEntry(entry) };
}

/** Kept for a future manual-send admin flow. */
export async function markDriveReminderSent({ entryId } = {}) {
  const eid = toSafeString(entryId);
  if (!eid) return false;
  const entry = await DriveCalendarEntry.findById(eid);
  if (!entry?.reminder || entry.reminder.kind === "none") return false;
  entry.reminder.status = "sent";
  await entry.save();
  return true;
}
