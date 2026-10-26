import crypto from "crypto";
import mongoose from "mongoose";
import CompanyPlatformContent from "../models/CompanyPlatformContent.js";
import CompanyVisit from "../models/CompanyVisit.js";
import InterviewExperienceLike from "../models/InterviewExperienceLike.js";

function text(value) {
  return String(value ?? "").trim();
}

function asId(value) {
  try {
    return new mongoose.Types.ObjectId(String(value));
  } catch {
    return null;
  }
}

/** Visible write-up used as the stable key for visit-stored experiences. */
export function experienceContent(entry) {
  if (entry && typeof entry === "object" && !Array.isArray(entry)) {
    return text(entry.content || entry.experience);
  }
  const trimmed = text(entry);
  if (!trimmed) return "";
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const content = text(parsed.content || parsed.experience);
      if (content) return content;
    }
  } catch {
    // Legacy plain string.
  }
  return trimmed;
}

export function platformExperienceKey(id) {
  return `p:${String(id || "").trim()}`;
}

export function contentExperienceKey(content) {
  const normalized = text(content).replace(/\s+/g, " ").toLowerCase();
  const hash = crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 24);
  return `c:${hash}`;
}

export function experienceLikeKey(entry) {
  const id =
    entry && typeof entry === "object" && !Array.isArray(entry)
      ? text(entry.id || entry._id)
      : "";
  if (id && mongoose.Types.ObjectId.isValid(id)) return platformExperienceKey(id);
  const content = experienceContent(entry);
  if (!content) return "";
  return contentExperienceKey(content);
}

function approvedExperience(item) {
  if (!item) return false;
  if (item.status && item.status !== "approved") return false;
  return Boolean(text(item.content));
}

async function platformExperienceIsLive(companyId, experienceKey) {
  const id = experienceKey.slice(2);
  if (!mongoose.Types.ObjectId.isValid(id)) return false;
  const doc = await CompanyPlatformContent.findOne({ companyId })
    .select("interviewExperiences._id interviewExperiences.status interviewExperiences.content")
    .lean();
  return (doc?.interviewExperiences || []).some(
    (item) => String(item?._id || "") === id && approvedExperience(item)
  );
}

async function visitExperienceIsLive(companyId, experienceKey) {
  const visits = await CompanyVisit.find({ companyId }).select("interviewProcess").lean();
  for (const visit of visits) {
    const list = Array.isArray(visit?.interviewProcess) ? visit.interviewProcess : [];
    for (const entry of list) {
      if (experienceLikeKey(entry) === experienceKey) return true;
    }
  }
  return false;
}

export async function experienceKeyIsLive(companyId, experienceKey) {
  const oid = asId(companyId);
  const key = text(experienceKey);
  if (!oid || !key) return false;
  if (key.startsWith("p:")) return platformExperienceIsLive(oid, key);
  if (key.startsWith("c:")) return visitExperienceIsLive(oid, key);
  return false;
}

async function likeSummary(companyId, experienceKey, userEmail) {
  const [likeCount, mine] = await Promise.all([
    InterviewExperienceLike.countDocuments({ companyId, experienceKey }),
    userEmail
      ? InterviewExperienceLike.exists({ companyId, experienceKey, userEmail })
      : Promise.resolve(null),
  ]);
  return {
    experienceKey,
    likeCount,
    likedByMe: Boolean(mine),
  };
}

/**
 * Toggle the signed-in user's like on one interview experience.
 * @param {string} companyId
 * @param {string} experienceKey
 * @param {string} userEmail
 */
export async function toggleInterviewExperienceLike(companyId, experienceKey, userEmail) {
  const oid = asId(companyId);
  const email = text(userEmail).toLowerCase();
  const key = text(experienceKey);
  if (!oid) {
    const err = new Error("Invalid company id");
    err.status = 400;
    throw err;
  }
  if (!email) {
    const err = new Error("You must be logged in to like an interview experience");
    err.status = 401;
    throw err;
  }
  if (!key) {
    const err = new Error("Experience not found");
    err.status = 404;
    throw err;
  }
  const live = await experienceKeyIsLive(oid, key);
  if (!live) {
    const err = new Error("Experience not found");
    err.status = 404;
    throw err;
  }

  const removed = await InterviewExperienceLike.findOneAndDelete({
    companyId: oid,
    experienceKey: key,
    userEmail: email,
  });
  if (!removed) {
    try {
      await InterviewExperienceLike.create({
        companyId: oid,
        experienceKey: key,
        userEmail: email,
      });
    } catch (error) {
      if (error?.code !== 11000) throw error;
    }
  }
  return likeSummary(oid, key, email);
}

/**
 * Attach like counts for the viewer. Does not expose who liked an experience.
 * @param {object|null|undefined} payload
 * @param {string} viewerEmail
 */
export async function attachInterviewExperienceLikes(payload, viewerEmail) {
  if (!payload || typeof payload !== "object") return payload;
  const list = Array.isArray(payload.interviewProcess) ? payload.interviewProcess : null;
  if (!list) return payload;

  const email = text(viewerEmail).toLowerCase();
  const keys = list.map((entry) => experienceLikeKey(entry));
  const liveKeys = [...new Set(keys.filter(Boolean))];
  /** @type {Map<string, { count: number, mine: boolean }>} */
  const byKey = new Map();

  if (payload._id && liveKeys.length > 0) {
    const rows = await InterviewExperienceLike.find({
      companyId: payload._id,
      experienceKey: { $in: liveKeys },
    })
      .select("experienceKey userEmail")
      .lean();
    for (const row of rows) {
      const bucket = byKey.get(row.experienceKey) || { count: 0, mine: false };
      bucket.count += 1;
      if (email && row.userEmail === email) bucket.mine = true;
      byKey.set(row.experienceKey, bucket);
    }
  }

  return {
    ...payload,
    interviewProcess: list.map((entry, index) => {
      const experienceKey = keys[index];
      const stats = byKey.get(experienceKey) || { count: 0, mine: false };
      return experienceEntryForClient(entry, experienceKey, stats);
    }),
  };
}

function experienceEntryForClient(entry, experienceKey, stats) {
  const likes = {
    experienceKey,
    likeCount: stats.count,
    likedByMe: stats.mine,
  };
  if (entry && typeof entry === "object" && !Array.isArray(entry)) {
    return { ...entry, ...likes };
  }
  const trimmed = text(entry);
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return {
          ...parsed,
          content: experienceContent(entry),
          ...likes,
        };
      }
    } catch {
      // Legacy plain string.
    }
  }
  return { content: experienceContent(entry), ...likes };
}

export async function deleteInterviewExperienceLikes(companyId, experienceKey) {
  const oid = asId(companyId);
  const key = text(experienceKey);
  if (!oid || !key) return;
  await InterviewExperienceLike.deleteMany({ companyId: oid, experienceKey: key });
}

export async function rekeyInterviewExperienceLike(companyId, fromKey, toKey) {
  const oid = asId(companyId);
  const from = text(fromKey);
  const to = text(toKey);
  if (!oid || !from || !to || from === to) return;
  const rows = await InterviewExperienceLike.find({ companyId: oid, experienceKey: from }).lean();
  if (rows.length === 0) return;
  for (const row of rows) {
    try {
      await InterviewExperienceLike.updateOne(
        { _id: row._id },
        { $set: { experienceKey: to } }
      );
    } catch (error) {
      if (error?.code === 11000) {
        await InterviewExperienceLike.deleteOne({ _id: row._id });
      } else {
        throw error;
      }
    }
  }
}
