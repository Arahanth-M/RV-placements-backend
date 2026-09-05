import express from "express";
import multer from "multer";
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
import { mapResumeTextToPayload } from "../services/resume/analyze/mapResumeTextToPayload.js";
import { extractResumeText } from "../services/prepPath/resumeTextExtract.js";
import {
  createAtsAnalysisCacheKey,
  getCachedAtsAnalysis,
  setCachedAtsAnalysis,
} from "../services/resume/analyze/cache.js";
import resumeAnalyzeLimiter from "../middleware/resumeAnalyzeLimiter.js";
import { atsUploadQuota } from "../middleware/resumeAtsUploadQuota.js";

const router = express.Router();

const atsUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const name = String(file?.originalname || "").toLowerCase();
    const mime = String(file?.mimetype || "").toLowerCase();
    const ok =
      mime.includes("pdf") ||
      mime.includes("wordprocessingml") ||
      mime.includes("officedocument") ||
      name.endsWith(".pdf") ||
      name.endsWith(".docx");
    if (!ok) {
      const err = new Error("Upload a PDF or DOCX resume.");
      err.code = "RESUME_TYPE";
      return cb(err);
    }
    return cb(null, true);
  },
});

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

router.get("/analyze-upload/quota", async (req, res) => {
  try {
    const quota = await atsUploadQuota.getQuota(req);
    return res.json({ success: true, quota });
  } catch (error) {
    console.error("[resume] analyze-upload quota failed", error?.message || error);
    return res.status(500).json({ error: "Failed to load upload quota" });
  }
});

router.post("/analyze-upload", (req, res) => {
  atsUpload.single("resume")(req, res, async (uploadErr) => {
    if (uploadErr) {
      const code = uploadErr.code || "";
      if (code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: "Resume must be 5MB or smaller." });
      }
      return res.status(400).json({
        error: uploadErr.message || "Invalid resume upload.",
        code: uploadErr.code || "UPLOAD_ERROR",
      });
    }

    const startedAt = Date.now();
    try {
      const ownerEmail = String(req.user?.email || "").trim().toLowerCase();
      if (!ownerEmail) return res.status(401).json({ error: "Unauthorized" });

      if (!req.file?.buffer) {
        return res.status(400).json({
          error: "Attach a resume (PDF or DOCX).",
          code: "RESUME_REQUIRED",
        });
      }

      let resumeText;
      try {
        resumeText = await extractResumeText({
          buffer: req.file.buffer,
          mime: req.file.mimetype,
          originalName: req.file.originalname,
        });
      } catch (parseErr) {
        const code = parseErr?.code || "";
        const status =
          code === "RESUME_EMPTY" || code === "RESUME_TYPE" || code === "RESUME_PARSE"
            ? 400
            : 400;
        return res.status(status).json({
          error: parseErr?.message || "Could not read the resume.",
          code: code || "RESUME_PARSE",
        });
      }

      const slot = await atsUploadQuota.consume(req);
      if (slot.exceeded) {
        if (slot.retryAfterSeconds > 0) {
          res.setHeader("Retry-After", String(slot.retryAfterSeconds));
        }
        return res.status(429).json({
          error: "You can score 3 uploaded resumes per day. Try again tomorrow.",
          quota: {
            used: slot.used,
            limit: slot.limit,
            remaining: 0,
          },
        });
      }

      try {
        const mapped = mapResumeTextToPayload(resumeText);
        const payload = sanitizeResumePayload(mapped);
        const cacheKey = createAtsAnalysisCacheKey({
          sanitizedResumePayload: payload,
        });
        let analysis = null;
        try {
          analysis = await getCachedAtsAnalysis(cacheKey);
        } catch {
          analysis = null;
        }
        if (!analysis) {
          analysis = analyzeResume(payload);
          try {
            await setCachedAtsAnalysis(cacheKey, analysis);
          } catch {
            // ignore
          }
        }

        console.info("[resume] analyzeUpload", {
          ownerEmail,
          status: 200,
          latencyMs: Date.now() - startedAt,
          bytes: req.file.buffer.length,
        });

        return res.json({
          success: true,
          source: "upload",
          analysis,
          quota: {
            used: slot.used,
            limit: slot.limit,
            remaining: slot.remaining,
          },
        });
      } catch (innerErr) {
        if (typeof slot.refund === "function") {
          await slot.refund();
        }
        throw innerErr;
      }
    } catch (error) {
      console.error("[resume] analyze-upload failed", error?.message || error);
      return res.status(500).json({ error: "Failed to analyze uploaded resume" });
    } finally {
      if (req.file) {
        req.file.buffer = Buffer.alloc(0);
      }
    }
  });
});

export default router;
