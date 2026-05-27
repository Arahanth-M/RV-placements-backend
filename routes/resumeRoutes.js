import express from "express";
import authJWT from "../middleware/authJWT.js";
import checkBetaAccess from "../middleware/checkBetaAccess.js";
import authorize from "../middleware/authorize.js";
import validateRequest from "../middleware/validateRequest.js";
import ResumeDraft from "../models/ResumeDraft.js";
import {
  resumeDraftSaveSchema,
  resumeExportSchema,
  resumeAnalyzeSchema,
} from "../validations/resume.validation.js";
import { buildPdfBufferFromResume } from "../services/resumePdfExport.js";
import { buildDocxBufferFromResume } from "../services/resumeDocxExport.js";
import { sanitizeResumePayload } from "../services/resume/sanitizeResumePayload.js";
import { analyzeResume } from "../services/resume/analyze/index.js";
import {
  createAtsAnalysisCacheKey,
  getCachedAtsAnalysis,
  setCachedAtsAnalysis,
} from "../services/resume/analyze/cache.js";
import resumeAnalyzeLimiter from "../middleware/resumeAnalyzeLimiter.js";

const router = express.Router();

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
    certifications: [],
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
      certifications: doc.certifications || [],
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

router.post("/export/docx", validateRequest(resumeExportSchema), async (req, res) => {
  const startedAt = Date.now();
  try {
    const ownerEmail = String(req.user?.email || "").trim().toLowerCase();
    if (!ownerEmail) return res.status(401).json({ error: "Unauthorized" });

    const payload = sanitizeResumePayload(req.body.payload || {});
    const docxBuffer = await buildDocxBufferFromResume(payload);

    console.info("[resume] exportDocx", {
      ownerEmail,
      status: 200,
      latencyMs: Date.now() - startedAt,
      bytes: docxBuffer.length,
    });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", 'attachment; filename="resume.docx"');
    return res.send(docxBuffer);
  } catch (error) {
    console.error("[resume] exportDocx failed", error?.message || error);
    return res.status(500).json({ error: "Failed to export resume as Word document" });
  }
});

router.post(
  "/analyze",
  resumeAnalyzeLimiter,
  validateRequest(resumeAnalyzeSchema),
  async (req, res) => {
  const startedAt = Date.now();
  try {
    const ownerEmail = String(req.user?.email || "").trim().toLowerCase();
    if (!ownerEmail) return res.status(401).json({ error: "Unauthorized" });

    const payload = sanitizeResumePayload(req.body.payload || {});
    const cacheKey = createAtsAnalysisCacheKey({
      sanitizedResumePayload: payload,
    });

    const cacheKeyHash = String(cacheKey || "").split(":").pop()?.slice(0, 12) || "";

    let cachedAnalysis = null;
    try {
      cachedAnalysis = await getCachedAtsAnalysis(cacheKey);
    } catch {
      cachedAnalysis = null;
    }

    if (cachedAnalysis) {
      console.info("[resume] analyzeCache", {
        cache: "hit",
        latencyMs: Date.now() - startedAt,
        cacheKeyHash,
      });
      return res.json({ success: true, analysis: cachedAnalysis });
    }

    const analysis = analyzeResume(payload);

    try {
      await setCachedAtsAnalysis(cacheKey, analysis);
    } catch {
      // ignore: cache must never fail the request
    }

    console.info("[resume] analyzeCache", {
      cache: "miss",
      latencyMs: Date.now() - startedAt,
      cacheKeyHash,
    });

    return res.json({ success: true, analysis });
  } catch (error) {
    console.error("[resume] analyze failed", error?.message || error);
    return res.status(500).json({ error: "Failed to analyze resume" });
  }
  }
);

export default router;
