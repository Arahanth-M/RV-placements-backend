import express from "express";
import authJWT from "../middleware/authJWT.js";
import checkBetaAccess from "../middleware/checkBetaAccess.js";
import authorize from "../middleware/authorize.js";
import validateRequest from "../middleware/validateRequest.js";
import ResumeDraft from "../models/ResumeDraft.js";
import {
  resumeDraftSaveSchema,
  resumeExportSchema,
} from "../validations/resume.validation.js";
import { buildPdfBufferFromResume } from "../services/resumePdfExport.js";

const router = express.Router();

function sanitizeText(raw) {
  if (raw == null) return "";
  return String(raw).replace(/<[^>]*>/g, "").trim();
}

function sanitizeBulletList(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => ({ text: sanitizeText(item?.text) }))
    .filter((item) => item.text.length > 0);
}

function sanitizeResumePayload(payload = {}) {
  const cleaned = {
    templateId: payload.templateId || "standard_ats",
    personal: {
      fullName: sanitizeText(payload.personal?.fullName),
      email: sanitizeText(payload.personal?.email),
      phone: sanitizeText(payload.personal?.phone),
      location: sanitizeText(payload.personal?.location),
      linkedin: sanitizeText(payload.personal?.linkedin),
      github: sanitizeText(payload.personal?.github),
      summary: sanitizeText(payload.personal?.summary),
    },
    education: (Array.isArray(payload.education) ? payload.education : []).map((item) => ({
      institution: sanitizeText(item?.institution),
      degree: sanitizeText(item?.degree),
      field: sanitizeText(item?.field),
      startDate: sanitizeText(item?.startDate),
      endDate: sanitizeText(item?.endDate),
      score: sanitizeText(item?.score),
      location: sanitizeText(item?.location),
    })),
    skills: (Array.isArray(payload.skills) ? payload.skills : [])
      .map((item) => sanitizeText(item))
      .filter(Boolean),
    projects: (Array.isArray(payload.projects) ? payload.projects : []).map((item) => ({
      name: sanitizeText(item?.name),
      techStack: sanitizeText(item?.techStack),
      link: sanitizeText(item?.link),
      startDate: sanitizeText(item?.startDate),
      endDate: sanitizeText(item?.endDate),
      bullets: sanitizeBulletList(item?.bullets),
    })),
    experience: (Array.isArray(payload.experience) ? payload.experience : []).map((item) => ({
      company: sanitizeText(item?.company),
      role: sanitizeText(item?.role),
      location: sanitizeText(item?.location),
      startDate: sanitizeText(item?.startDate),
      endDate: sanitizeText(item?.endDate),
      bullets: sanitizeBulletList(item?.bullets),
    })),
    achievements: (Array.isArray(payload.achievements) ? payload.achievements : []).map((item) => ({
      title: sanitizeText(item?.title),
      detail: sanitizeText(item?.detail),
    })),
  };

  return cleaned;
}

function buildEmptyDraft() {
  return {
    templateId: "standard_ats",
    personal: {
      fullName: "",
      email: "",
      phone: "",
      location: "",
      linkedin: "",
      github: "",
      summary: "",
    },
    education: [],
    skills: [],
    projects: [],
    experience: [],
    achievements: [],
    version: 0,
  };
}

router.use(authJWT, checkBetaAccess, authorize(["student", "admin", "spc"]));

router.get("/draft", async (req, res) => {
  const startedAt = Date.now();
  try {
    const ownerEmail = String(req.user?.email || "").trim().toLowerCase();
    if (!ownerEmail) return res.status(401).json({ error: "Unauthorized" });

    const doc = await ResumeDraft.findOne({ ownerEmail }).lean();
    if (!doc) {
      console.info("[resume] getDraft", { ownerEmail, status: 200, latencyMs: Date.now() - startedAt, hit: false });
      return res.json(buildEmptyDraft());
    }

    console.info("[resume] getDraft", { ownerEmail, status: 200, latencyMs: Date.now() - startedAt, hit: true });
    return res.json({
      templateId: doc.templateId,
      personal: doc.personal,
      education: doc.education,
      skills: doc.skills,
      projects: doc.projects,
      experience: doc.experience,
      achievements: doc.achievements,
      version: doc.version || 1,
      updatedAt: doc.updatedAt,
    });
  } catch (error) {
    console.error("[resume] getDraft failed", error?.message || error);
    return res.status(500).json({ error: "Failed to fetch resume draft" });
  }
});

router.put("/draft", validateRequest(resumeDraftSaveSchema), async (req, res) => {
  const startedAt = Date.now();
  try {
    const ownerEmail = String(req.user?.email || "").trim().toLowerCase();
    if (!ownerEmail) return res.status(401).json({ error: "Unauthorized" });

    const incomingVersion = Number(req.body.version || 0);
    const payload = sanitizeResumePayload(req.body.payload || {});
    const existing = await ResumeDraft.findOne({ ownerEmail });

    if (existing && incomingVersion !== Number(existing.version || 0)) {
      console.warn("[resume] save conflict", {
        ownerEmail,
        expected: existing.version,
        incoming: incomingVersion,
      });
      return res.status(409).json({
        error: "Version conflict",
        latestVersion: Number(existing.version || 0),
      });
    }

    const nextVersion = existing ? Number(existing.version || 0) + 1 : 1;
    const updated = await ResumeDraft.findOneAndUpdate(
      { ownerEmail },
      {
        $set: {
          ownerEmail,
          ...payload,
          version: nextVersion,
          expireAt: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    console.info("[resume] saveDraft", {
      ownerEmail,
      status: 200,
      latencyMs: Date.now() - startedAt,
      version: nextVersion,
    });

    return res.json({
      message: "Draft saved",
      version: Number(updated.version || nextVersion),
      updatedAt: updated.updatedAt,
    });
  } catch (error) {
    console.error("[resume] saveDraft failed", error?.message || error);
    return res.status(500).json({ error: "Failed to save resume draft" });
  }
});

router.post("/export", validateRequest(resumeExportSchema), async (req, res) => {
  const startedAt = Date.now();
  try {
    const ownerEmail = String(req.user?.email || "").trim().toLowerCase();
    if (!ownerEmail) return res.status(401).json({ error: "Unauthorized" });

    const payload = sanitizeResumePayload(req.body.payload || {});
    const pdfBuffer = await buildPdfBufferFromResume(payload);

    console.info("[resume] exportPdf", {
      ownerEmail,
      status: 200,
      latencyMs: Date.now() - startedAt,
      bytes: pdfBuffer.length,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="resume.pdf"');
    return res.send(pdfBuffer);
  } catch (error) {
    console.error("[resume] exportPdf failed", error?.message || error);
    return res.status(500).json({ error: "Failed to export resume" });
  }
});

export default router;
