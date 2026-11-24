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
  applyPrepPathStudySchedule,
  parseResumeForPrepPath,
  PREP_PATH_HISTORY_LIMIT,
  PREP_PATH_RESUME_DIGEST_MAX,
} from "../services/prepPath/prepPathService.js";
import {
  createUserPrepResumeDigest,
  deleteUserPrepResumeDigest,
  listUserPrepResumeDigests,
  serializeUserPrepResumeDigest,
  serializeUserPrepResumeDigestList,
} from "../services/prepPath/userResumeDigestService.js";
import { recordDauActivitySafe } from "../services/dau/recordDauActivity.js";
import {
  evaluatePrepPathAccess,
  getGeneralAccessSnapshot,
  isBillingAdmin,
  markFreePrepConsumed,
  paywallPayload,
} from "../services/billing/accessService.js";
import {
  FREE_TIER_PREP_PATH_LIMIT,
  MONTHLY_QUOTA_CODE,
  PAID_PREP_PATH_MONTHLY_LIMIT,
  PAYWALL_CODE,
  TEST_EMAIL_PREP_PATH_LIMIT,
} from "../config/billingPlans.js";
import { FEATURE_CONSENT_IDS } from "../config/featureConsents.js";
import { hasFeatureConsent } from "../services/featureConsentService.js";

function platformPrepQuotaFromSnapshot(snapshot, { isAdmin = false } = {}) {
  // Platform / campus admins bypass free + paid PrepPath caps.
  if (isAdmin) {
    return {
      unlimited: true,
      monthly: false,
      limit: null,
      used: Math.max(0, Number(snapshot?.prepPlans) || 0),
      remaining: null,
      lifetimeFree: false,
      freePrepRemaining: null,
      adminBypass: true,
    };
  }
  const paid = Boolean(snapshot?.unlimitedPrepPath);
  if (paid) {
    const limit = Number(snapshot?.paidPrepMonthlyLimit) || PAID_PREP_PATH_MONTHLY_LIMIT;
    const used = Number(snapshot?.paidPrepMonthlyUsed) || 0;
    const remaining = Number.isFinite(Number(snapshot?.paidPrepMonthlyRemaining))
      ? Number(snapshot.paidPrepMonthlyRemaining)
      : Math.max(0, limit - used);
    return {
      unlimited: false,
      monthly: true,
      windowDays: Number(snapshot?.paidQuotaWindowDays) || 30,
      windowStart: snapshot?.paidPrepQuotaWindowStart || null,
      windowEnd: snapshot?.paidPrepQuotaWindowEnd || null,
      limit,
      used,
      remaining,
      lifetimeFree: false,
      freePrepRemaining: 0,
      adminBypass: false,
    };
  }
  const limit = snapshot?.isTestEmail
    ? TEST_EMAIL_PREP_PATH_LIMIT
    : FREE_TIER_PREP_PATH_LIMIT;
  const remaining = Number(snapshot?.freePrepRemaining) || 0;
  const used = Math.min(limit, Math.max(0, limit - remaining));
  return {
    unlimited: false,
    monthly: false,
    limit,
    used,
    remaining,
    lifetimeFree: true,
    freePrepRemaining: remaining,
    adminBypass: false,
  };
}

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
      const isJd = String(file?.fieldname || "") === "jd";
      const err = new Error(
        isJd ? "Upload a PDF or DOCX job description." : "Upload a PDF or DOCX resume."
      );
      err.code = isJd ? "JD_TYPE" : "RESUME_TYPE";
      return cb(err);
    }
    return cb(null, true);
  },
});

router.use(authJWT, checkBetaAccess, authorize(["student", "admin", "spc"]));

const getAuthenticatedUserId = (req) => String(req.user?.userId || "").trim();

function isPlatformPrepScope(req) {
  const fromQuery = String(req.query?.scope || "").trim().toLowerCase();
  const fromBody = String(req.body?.scope || "").trim().toLowerCase();
  return fromQuery === "platform" || fromBody === "platform";
}

router.get("/quota", async (req, res) => {
  try {
    const userId = getAuthenticatedUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (isPlatformPrepScope(req)) {
      const admin = isBillingAdmin(req.user);
      const snapshot = admin
        ? null
        : await getGeneralAccessSnapshot(userId, new Date(), req.user);
      return res.json({
        success: true,
        quota: platformPrepQuotaFromSnapshot(snapshot, { isAdmin: admin }),
      });
    }
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

/** DPDP: list stored PrepPath resume digests (JD is never stored). */
router.get("/resume-digest", async (req, res) => {
  try {
    const userId = getAuthenticatedUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const rows = await listUserPrepResumeDigests(userId, { hydrateFromPlans: true });
    const resumes = serializeUserPrepResumeDigestList(rows);
    return res.json({
      success: true,
      resumes,
      // Compat: single latest digest for older clients.
      resume: resumes[0] || serializeUserPrepResumeDigest(null),
    });
  } catch (err) {
    console.error("[prepPath] get resume-digest failed", err?.message || err);
    return res.status(500).json({ error: "Failed to load saved resume digests" });
  }
});

/** DPDP: erase one stored PrepPath resume digest. */
router.delete("/resume-digest/:digestId", async (req, res) => {
  try {
    const userId = getAuthenticatedUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const digestId = String(req.params?.digestId || "").trim();
    if (!digestId) {
      return res.status(400).json({ error: "digestId is required", code: "INVALID_ID" });
    }
    const result = await deleteUserPrepResumeDigest(userId, digestId);
    const rows = await listUserPrepResumeDigests(userId);
    const resumes = serializeUserPrepResumeDigestList(rows);
    return res.json({
      success: true,
      deleted: result.deleted,
      deletedCount: result.deletedCount,
      resumes,
      resume: resumes[0] || serializeUserPrepResumeDigest(null),
    });
  } catch (err) {
    console.error("[prepPath] delete resume-digest by id failed", err?.message || err);
    return res.status(500).json({ error: "Failed to delete saved resume digest" });
  }
});

/** DPDP: erase all stored PrepPath resume digests. */
router.delete("/resume-digest", async (req, res) => {
  try {
    const userId = getAuthenticatedUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const result = await deleteUserPrepResumeDigest(userId);
    return res.json({
      success: true,
      deleted: result.deleted,
      deletedCount: result.deletedCount,
      resumes: [],
      resume: serializeUserPrepResumeDigest(null),
    });
  } catch (err) {
    console.error("[prepPath] delete resume-digest failed", err?.message || err);
    return res.status(500).json({ error: "Failed to delete saved resume digests" });
  }
});

/** Save a new resume digest (appends; does not overwrite other saved digests). */
router.put("/resume-digest", async (req, res) => {
  try {
    const userId = getAuthenticatedUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const digest = String(req.body?.digest || "").trim().slice(0, PREP_PATH_RESUME_DIGEST_MAX);
    if (digest.length < 40) {
      return res.status(400).json({
        error: "Resume digest is too short. Edit the parsed text or upload another resume.",
        code: "RESUME_DIGEST_INVALID",
      });
    }
    const meta = req.body?.resumeMeta || {};
    const row = await createUserPrepResumeDigest({
      userId,
      digest,
      resumeMeta: {
        fileName: meta.fileName,
        mime: meta.mime,
        textChars: meta.textChars || digest.length,
      },
      source: "prep_path",
    });
    const rows = await listUserPrepResumeDigests(userId);
    const resumes = serializeUserPrepResumeDigestList(rows);
    return res.json({
      success: true,
      resume: serializeUserPrepResumeDigest(row),
      resumes,
    });
  } catch (err) {
    console.error("[prepPath] put resume-digest failed", err?.message || err);
    return res.status(500).json({ error: "Failed to save resume digest" });
  }
});

/** Parse resume for review/edit before PrepPath generation. Does not generate a plan. */
router.post("/parse-resume", (req, res) => {
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
    try {
      const userId = getAuthenticatedUserId(req);
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      const resumeUpload = req.file;
      if (!resumeUpload?.buffer) {
        return res.status(400).json({
          error: "Attach a resume (PDF or DOCX).",
          code: "RESUME_REQUIRED",
        });
      }

      const platformScope = isPlatformPrepScope(req);
      if (platformScope) {
        const consented = await hasFeatureConsent(
          req.user?._id,
          FEATURE_CONSENT_IDS.PREP_PATH
        );
        if (!consented) {
          return res.status(403).json({
            error:
              "Consent is required to process your resume for PrepPath. Accept the PrepPath consent and try again.",
            code: "FEATURE_CONSENT_REQUIRED",
            feature: FEATURE_CONSENT_IDS.PREP_PATH,
          });
        }
      }

      const parsed = await parseResumeForPrepPath({
        resumeBuffer: resumeUpload.buffer,
        resumeMime: resumeUpload.mimetype,
        resumeOriginalName: resumeUpload.originalname,
      });
      return res.json({
        success: true,
        resume: {
          hasDigest: true,
          digest: parsed.digest,
          fields: parsed.fields,
          resumeMeta: parsed.resumeMeta,
          updatedAt: null,
          createdAt: null,
        },
      });
    } catch (err) {
      const code = err?.code || "";
      const message = err?.message || "Failed to parse resume";
      if (
        ["RESUME_EMPTY", "RESUME_TYPE", "RESUME_PARSE", "DOCUMENT_EMPTY"].includes(code)
      ) {
        return res.status(400).json({ error: message, code });
      }
      console.error("[prepPath] parse-resume failed", { code, message });
      return res.status(500).json({ error: "Failed to parse resume" });
    }
  });
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

router.post("/plans/:id/schedule", async (req, res) => {
  try {
    const userId = getAuthenticatedUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const plan = await applyPrepPathStudySchedule({
      userId,
      planId: req.params.id,
      style: req.body?.style,
      slotMinutes: req.body?.slotMinutes,
      slotsPerDay: req.body?.slotsPerDay,
    });
    if (!plan) return res.status(404).json({ error: "Plan not found" });
    return res.json({ success: true, plan });
  } catch (err) {
    const code = err?.code || "";
    if (code === "INVALID_SCHEDULE") {
      return res.status(400).json({ error: err.message, code });
    }
    console.error("[prepPath] schedule failed", err?.message || err);
    return res.status(500).json({ error: "Failed to save study schedule" });
  }
});

router.post("/generate", (req, res) => {
  upload.fields([
    { name: "resume", maxCount: 1 },
    { name: "jd", maxCount: 1 },
  ])(req, res, async (uploadErr) => {
    if (uploadErr) {
      const code = uploadErr.code || "";
      if (code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: "Each upload must be 5MB or smaller." });
      }
      return res.status(400).json({
        error: uploadErr.message || "Invalid file upload.",
        code: uploadErr.code || "UPLOAD_ERROR",
      });
    }

    const startedAt = Date.now();
    try {
      const userId = getAuthenticatedUserId(req);
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const resumeUpload = req.files?.resume?.[0];
      const jdUpload = req.files?.jd?.[0];
      const reuseResumeDigest =
        String(req.body?.reuseResumeDigest || "").trim().toLowerCase() === "true" ||
        req.body?.reuseResumeDigest === true ||
        req.body?.reuseResumeDigest === "1";
      const resumeDigestId = String(req.body?.resumeDigestId || "").trim();
      const providedResumeDigest = String(req.body?.resumeDigest || "").trim();
      let providedResumeMeta = null;
      if (req.body?.resumeMeta) {
        try {
          providedResumeMeta =
            typeof req.body.resumeMeta === "string"
              ? JSON.parse(req.body.resumeMeta)
              : req.body.resumeMeta;
        } catch {
          providedResumeMeta = null;
        }
      }

      if (!providedResumeDigest && !reuseResumeDigest && !resumeUpload?.buffer) {
        return res.status(400).json({
          error: "Attach a resume (PDF or DOCX) or reuse a saved one.",
          code: "RESUME_REQUIRED",
        });
      }
      if (!jdUpload?.buffer) {
        return res.status(400).json({
          error: "Attach a job description (PDF or DOCX).",
          code: "JD_REQUIRED",
        });
      }

      const platformScope = isPlatformPrepScope(req);
      if (platformScope) {
        const consented = await hasFeatureConsent(
          req.user?._id,
          FEATURE_CONSENT_IDS.PREP_PATH
        );
        if (!consented) {
          return res.status(403).json({
            error:
              "Consent is required to process your resume and JD for PrepPath. Accept the PrepPath consent and try again.",
            code: "FEATURE_CONSENT_REQUIRED",
            feature: FEATURE_CONSENT_IDS.PREP_PATH,
          });
        }
        const access = await evaluatePrepPathAccess({
          userId,
          companyId: req.body?.companyId,
          user: req.user,
        });
        if (!access.prepAllowed) {
          if (access.error?.code === MONTHLY_QUOTA_CODE) {
            return res.status(429).json({
              code: MONTHLY_QUOTA_CODE,
              error: access.error.message,
              feature: access.error.feature,
            });
          }
          const body = paywallPayload(access.error);
          return res.status(402).json({
            code: PAYWALL_CODE,
            ...body,
          });
        }
      }

      let { plan, quota, peerDemand } = await generateAndSavePrepPathPlan({
        userId,
        companyId: req.body?.companyId,
        role: req.body?.role,
        track: req.body?.track,
        days: req.body?.days,
        hoursPerDay: req.body?.hoursPerDay,
        resumeBuffer: resumeUpload?.buffer,
        resumeMime: resumeUpload?.mimetype,
        resumeOriginalName: resumeUpload?.originalname,
        reuseResumeDigest: Boolean(reuseResumeDigest) && !providedResumeDigest,
        resumeDigestId,
        providedResumeDigest,
        providedResumeMeta,
        jdBuffer: jdUpload.buffer,
        jdMime: jdUpload.mimetype,
        jdOriginalName: jdUpload.originalname,
        collegeId: platformScope ? undefined : collegeIdFromUser(req.user),
        scope: platformScope ? "platform" : undefined,
        skipDailyQuota: platformScope,
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

      if (platformScope) {
        const admin = isBillingAdmin(req.user);
        if (admin) {
          quota = platformPrepQuotaFromSnapshot(null, { isAdmin: true });
        } else {
          const snapshot = await getGeneralAccessSnapshot(userId, new Date(), req.user);
          if (!snapshot.unlimitedPrepPath && snapshot.freePrepRemaining <= 0) {
            await markFreePrepConsumed(userId).catch(() => {});
          }
          quota = platformPrepQuotaFromSnapshot(snapshot, { isAdmin: false });
        }
      }

      return res.status(201).json({ success: true, plan, quota, peerDemand });
    } catch (err) {
      const code = err?.code || "";
      const message = err?.message || "Failed to generate PrepPath plan";
      console.error("[prepPath] generate failed", { code, message });

      if (code === "QUOTA_EXCEEDED") {
        return res.status(429).json({ error: message, code });
      }
      if (code === PAYWALL_CODE) {
        return res.status(402).json(paywallPayload(err));
      }
      if (
        [
          "INVALID_ROLE",
          "INVALID_TRACK",
          "INVALID_DAYS",
          "INVALID_HOURS",
          "INVALID_COMPANY",
          "COMPANY_NOT_FOUND",
          "RESUME_REQUIRED",
          "RESUME_DIGEST_MISSING",
          "RESUME_EMPTY",
          "RESUME_TYPE",
          "RESUME_PARSE",
          "JD_REQUIRED",
          "JD_EMPTY",
          "JD_TYPE",
          "JD_PARSE",
        ].includes(code)
      ) {
        return res.status(400).json({ error: message, code });
      }
      if (
        String(message).includes("Groq LLM") ||
        String(message).includes("LLM request failed")
      ) {
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
