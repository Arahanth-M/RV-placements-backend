import express from "express";
import multer from "multer";
import authJWT from "../middleware/authJWT.js";
import checkBetaAccess from "../middleware/checkBetaAccess.js";
import authorize from "../middleware/authorize.js";
import { collegeIdFromUser } from "../utils/collegeScope.js";
import {
  generateAndSavePrepPathPlan,
  getPrepPathPlanForUser,
  getPrepPathQuota,
  getCompanyPrepPathPeerDemand,
  listRecentPrepPathPlans,
  PREP_PATH_HISTORY_LIMIT,
} from "../services/prepPath/prepPathService.js";
import { recordDauActivitySafe } from "../services/dau/recordDauActivity.js";

const router = express.Router();

const upload = multer({
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

router.use(authJWT, checkBetaAccess, authorize(["student", "admin", "spc"]));

const getAuthenticatedUserId = (req) => String(req.user?.userId || "").trim();

router.get("/quota", async (req, res) => {
  try {
    const userId = getAuthenticatedUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const quota = await getPrepPathQuota(userId);
    return res.json({ success: true, quota });
  } catch (err) {
    console.error("[prepPath] quota failed", err?.message || err);
    return res.status(500).json({ error: "Failed to load PrepPath quota" });
  }
});

router.get("/peer-demand", async (req, res) => {
  try {
    const userId = getAuthenticatedUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const companyId = String(req.query?.companyId || "").trim();
    if (!companyId) {
      return res.status(400).json({ error: "companyId is required", code: "INVALID_COMPANY" });
    }
    const peerDemand = await getCompanyPrepPathPeerDemand(companyId, { windowDays: 7 });
    return res.json({ success: true, peerDemand });
  } catch (err) {
    console.error("[prepPath] peer-demand failed", err?.message || err);
    return res.status(500).json({ error: "Failed to load peer demand" });
  }
});

router.get("/plans", async (req, res) => {
  try {
    const userId = getAuthenticatedUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const plans = await listRecentPrepPathPlans(userId, PREP_PATH_HISTORY_LIMIT);
    return res.json({ success: true, plans });
  } catch (err) {
    console.error("[prepPath] list plans failed", err?.message || err);
    return res.status(500).json({ error: "Failed to load PrepPath history" });
  }
});

router.get("/plans/:id", async (req, res) => {
  try {
    const userId = getAuthenticatedUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const plan = await getPrepPathPlanForUser(userId, req.params.id);
    if (!plan) return res.status(404).json({ error: "Plan not found" });
    return res.json({ success: true, plan });
  } catch (err) {
    console.error("[prepPath] get plan failed", err?.message || err);
    return res.status(500).json({ error: "Failed to load PrepPath plan" });
  }
});

router.post("/generate", (req, res) => {
  upload.single("resume")(req, res, async (uploadErr) => {
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
      const userId = getAuthenticatedUserId(req);
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      if (!req.file?.buffer) {
        return res.status(400).json({
          error: "Attach a resume (PDF or DOCX).",
          code: "RESUME_REQUIRED",
        });
      }

      const { plan, quota, peerDemand } = await generateAndSavePrepPathPlan({
        userId,
        companyId: req.body?.companyId,
        role: req.body?.role,
        track: req.body?.track,
        days: req.body?.days,
        hoursPerDay: req.body?.hoursPerDay,
        resumeBuffer: req.file.buffer,
        resumeMime: req.file.mimetype,
        resumeOriginalName: req.file.originalname,
        collegeId: collegeIdFromUser(req.user),
      });

      console.info("[prepPath] generate ok", {
        userId,
        planId: plan?._id,
        latencyMs: Date.now() - startedAt,
      });

      recordDauActivitySafe(req.user, {
        action: "prep_path",
        prepPathCompany: plan?.companyName,
      });

      return res.status(201).json({ success: true, plan, quota, peerDemand });
    } catch (err) {
      const code = err?.code || "";
      const message = err?.message || "Failed to generate PrepPath plan";
      console.error("[prepPath] generate failed", { code, message });

      if (code === "QUOTA_EXCEEDED") {
        return res.status(429).json({ error: message, code });
      }
      if (
        [
          "INVALID_ROLE",
          "INVALID_TRACK",
          "INVALID_DAYS",
          "INVALID_HOURS",
          "INVALID_COMPANY",
          "COMPANY_NOT_FOUND",
          "RESUME_EMPTY",
          "RESUME_TYPE",
          "RESUME_PARSE",
        ].includes(code)
      ) {
        return res.status(400).json({ error: message, code });
      }
      if (String(message).includes("Groq LLM")) {
        const lower = String(message).toLowerCase();
        const overloaded =
          lower.includes("rate_limit") ||
          lower.includes("rate limit") ||
          lower.includes("tokens per minute") ||
          lower.includes("tpm") ||
          lower.includes("too large");
        return res.status(502).json({
          error: overloaded
            ? "AI is busy or the prep request was too large. Please try again in a minute."
            : "AI service is temporarily unavailable. Please try again shortly.",
          code: "LLM_ERROR",
        });
      }
      return res.status(500).json({ error: "Failed to generate PrepPath plan" });
    }
  });
});

export default router;
