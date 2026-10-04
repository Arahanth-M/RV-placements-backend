import express from "express";
import authJWT from "../middleware/authJWT.js";
import requireAdmin from "../middleware/requireAdmin.js";
import requirePlatformAdmin from "../middleware/requirePlatformAdmin.js";
import authorize from "../middleware/authorize.js";
import {
  DEFAULT_MAX_SOURCES,
  MAX_SOURCES_CAP,
} from "../services/companyResearch/researchInterviewQuestions.js";
import { isValidOaResearchRole } from "../utils/oaPrepRoles.js";
import {
  getResearchJob,
  isResearchCompanyId,
  listCompanyResearchJobs,
  startResearchJob,
  updateResearchJobItem,
} from "../services/companyResearch/researchJobService.js";
import { suggestFresherRoles } from "../services/companyResearch/suggestFresherRoles.js";

const router = express.Router();
router.use(authJWT);
router.use(authorize(["admin"]));
router.use(requireAdmin);
router.use(requirePlatformAdmin);

const SUPPORTED_FIELDS = new Set([
  "interviewQuestions",
  "onlineQuestions",
  "interviewExperiences",
]);

function text(value) {
  return String(value ?? "").trim();
}

/**
 * @param {unknown} body
 * @returns {{ ok: true, value: object } | { ok: false, message: string }}
 */
export function validateResearchRequest(body) {
  const payload = body && typeof body === "object" ? body : {};

  if (typeof payload.companyId !== "string" || !text(payload.companyId)) {
    return { ok: false, message: "companyId is required." };
  }
  if (typeof payload.companyName !== "string" || !text(payload.companyName)) {
    return { ok: false, message: "companyName is required." };
  }
  if (!SUPPORTED_FIELDS.has(payload.field)) {
    return {
      ok: false,
      message: "field must be interviewQuestions, onlineQuestions, or interviewExperiences.",
    };
  }
  if (payload.role != null && payload.role !== "" && typeof payload.role !== "string") {
    return { ok: false, message: "role must be a string." };
  }
  if (payload.field === "onlineQuestions") {
    if (!text(payload.role)) {
      return { ok: false, message: "role is required for OA questions (SDE, Analyst, or Data Scientist)." };
    }
    if (!isValidOaResearchRole(payload.role)) {
      return {
        ok: false,
        message: "role must be SDE, Analyst, or Data Scientist for OA questions.",
      };
    }
  }
  if (payload.country != null && payload.country !== "" && typeof payload.country !== "string") {
    return { ok: false, message: "country must be a string." };
  }

  let maxSources;
  if (payload.maxSources != null && payload.maxSources !== "") {
    const n = payload.maxSources;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > MAX_SOURCES_CAP) {
      return {
        ok: false,
        message: `maxSources must be an integer from 1 to ${MAX_SOURCES_CAP}.`,
      };
    }
    maxSources = n;
  }

  let searchDepth = "basic";
  if (payload.searchDepth != null && payload.searchDepth !== "") {
    if (payload.searchDepth !== "basic" && payload.searchDepth !== "advanced") {
      return { ok: false, message: "searchDepth must be basic or advanced." };
    }
    searchDepth = payload.searchDepth;
  }

  return {
    ok: true,
    value: {
      companyId: text(payload.companyId),
      companyName: text(payload.companyName),
      field: payload.field,
      role: text(payload.role),
      country: text(payload.country),
      maxSources: maxSources ?? DEFAULT_MAX_SOURCES,
      searchDepth,
    },
  };
}

router.post("/company-research", async (req, res) => {
  const parsed = validateResearchRequest(req.body);
  if (!parsed.ok) {
    return res.status(400).json({ error: parsed.message });
  }

  try {
    const job = await startResearchJob(parsed.value);
    return res.status(200).json(job);
  } catch (error) {
    console.error("[company-research] start failed", { code: error?.code || "job_store_failed" });
    return res.status(500).json({
      error: {
        code: "job_store_failed",
        message: "Research could not be started.",
      },
    });
  }
});

function reviewerFromRequest(req) {
  const reviewerName =
    String(req.user?.username || "").trim() ||
    String(req.user?.email || "")
      .split("@")[0]
      .trim() ||
    "Reviewer";
  return {
    name: reviewerName,
    email: String(req.user?.email || "").trim(),
  };
}

router.post("/company-research/:jobId/generate-links-summary", async (req, res) => {
  try {
    const { generateResearchLinksSummary } = await import(
      "../services/companyResearch/generateResearchLinksSummary.js"
    );
    const result = await generateResearchLinksSummary({ jobId: req.params.jobId });
    return res.status(200).json(result);
  } catch (error) {
    const code = error?.code || "summary_generation_failed";
    const status = Number.isInteger(error?.status) ? error.status : 500;
    if (error?.name === "PublishResearchError" || status !== 500) {
      return res.status(status).json({
        error: {
          code,
          message: error?.message || "Links summary could not be generated.",
        },
      });
    }
    console.error("[company-research] generate-links-summary failed", { code });
    return res.status(500).json({
      error: {
        code: "summary_generation_failed",
        message: "Links summary could not be generated.",
      },
    });
  }
});

router.put("/company-research/:jobId/links-summary-draft", async (req, res) => {
  try {
    const { saveResearchLinksSummaryDraft } = await import(
      "../services/companyResearch/generateResearchLinksSummary.js"
    );
    const result = await saveResearchLinksSummaryDraft({
      jobId: req.params.jobId,
      summary: req.body?.summary,
    });
    return res.status(200).json(result);
  } catch (error) {
    const code = error?.code || "summary_save_failed";
    const status = Number.isInteger(error?.status) ? error.status : 500;
    if (error?.name === "PublishResearchError" || status !== 500) {
      return res.status(status).json({
        error: {
          code,
          message: error?.message || "Links summary could not be saved.",
        },
      });
    }
    console.error("[company-research] links-summary-draft failed", { code });
    return res.status(500).json({
      error: {
        code: "summary_save_failed",
        message: "Links summary could not be saved.",
      },
    });
  }
});

router.post("/company-research/:jobId/publish-sources", async (req, res) => {
  try {
    const { publishResearchSources } = await import(
      "../services/companyResearch/publishResearchSources.js"
    );
    const result = await publishResearchSources({ jobId: req.params.jobId });
    return res.status(200).json(result);
  } catch (error) {
    const code = error?.code || "publish_failed";
    const status = Number.isInteger(error?.status) ? error.status : 500;
    if (error?.name === "PublishResearchError" || status !== 500) {
      return res.status(status).json({
        error: {
          code,
          message: error?.message || "Research sources could not be published.",
        },
      });
    }
    console.error("[company-research] publish-sources failed", {
      code,
      message: error?.message,
    });
    return res.status(500).json({
      error: {
        code: "publish_failed",
        message: "Research sources could not be published.",
      },
    });
  }
});

router.put("/company-research/:jobId/items/:index", async (req, res) => {
  const index = Number(req.params.index);
  try {
    const result = await updateResearchJobItem({
      jobId: req.params.jobId,
      index,
      patch: req.body,
    });
    return res.status(200).json(result);
  } catch (error) {
    const code = error?.code || "item_update_failed";
    const status = Number.isInteger(error?.status) ? error.status : 500;
    if (error?.name === "ResearchItemUpdateError" || status !== 500) {
      return res.status(status).json({
        error: {
          code,
          message: error?.message || "This item could not be saved.",
        },
      });
    }
    console.error("[company-research] item update failed", { code });
    return res.status(500).json({
      error: {
        code: "item_update_failed",
        message: "This item could not be saved.",
      },
    });
  }
});

router.post("/company-research/:jobId/enhance-questions", async (req, res) => {
  try {
    const { enhanceResearchQuestions } = await import(
      "../services/companyResearch/enhanceResearchQuestions.js"
    );
    const result = await enhanceResearchQuestions({
      jobId: req.params.jobId,
      selectedIndexes: req.body?.selectedIndexes,
    });
    return res.status(200).json(result);
  } catch (error) {
    const code = error?.code || "enhance_failed";
    const status = Number.isInteger(error?.status) ? error.status : 500;
    if (error?.name === "PublishResearchError" || status !== 500) {
      return res.status(status).json({
        error: {
          code,
          message: error?.message || "Questions could not be enhanced.",
        },
      });
    }
    console.error("[company-research] enhance-questions failed", { code });
    return res.status(500).json({
      error: {
        code: "enhance_failed",
        message: "Questions could not be enhanced.",
      },
    });
  }
});

router.post("/company-research/:jobId/generate-answers", async (req, res) => {
  try {
    const { generateResearchQuestionAnswers } = await import(
      "../services/companyResearch/generateResearchQuestionAnswers.js"
    );
    const result = await generateResearchQuestionAnswers({
      jobId: req.params.jobId,
      selectedIndexes: req.body?.selectedIndexes,
    });
    return res.status(200).json(result);
  } catch (error) {
    const code = error?.code || "answer_generation_failed";
    const status = Number.isInteger(error?.status) ? error.status : 500;
    if (error?.name === "PublishResearchError" || status !== 500) {
      return res.status(status).json({
        error: {
          code,
          message: error?.message || "Answers could not be generated.",
        },
      });
    }
    console.error("[company-research] generate-answers failed", { code });
    return res.status(500).json({
      error: {
        code: "answer_generation_failed",
        message: "Answers could not be generated.",
      },
    });
  }
});

router.post("/company-research/:jobId/publish", async (req, res) => {
  try {
    const { publishResearchInterviewQuestions } = await import(
      "../services/companyResearch/publishResearchInterviewQuestions.js"
    );
    const result = await publishResearchInterviewQuestions({
      jobId: req.params.jobId,
      selectedIndexes: req.body?.selectedIndexes,
      reviewer: reviewerFromRequest(req),
    });
    return res.status(200).json(result);
  } catch (error) {
    const code = error?.code || "publish_failed";
    const status = Number.isInteger(error?.status) ? error.status : 500;
    if (error?.name === "PublishResearchError" || status !== 500) {
      return res.status(status).json({
        error: {
          code,
          message: error?.message || "Research could not be published.",
        },
      });
    }
    console.error("[company-research] publish failed", { code });
    return res.status(500).json({
      error: {
        code: "publish_failed",
        message: "Research could not be published.",
      },
    });
  }
});

router.get("/companies/:companyId/fresher-roles", async (req, res) => {
  const companyId = text(req.params.companyId);
  const companyName = text(req.query.companyName);
  if (!isResearchCompanyId(companyId)) {
    return res.status(400).json({ error: "companyId is not valid." });
  }
  if (!companyName) {
    return res.status(400).json({ error: "companyName is required." });
  }
  try {
    const roles = await suggestFresherRoles({ companyId, companyName });
    return res.status(200).json({ roles });
  } catch (error) {
    console.error("[company-research] fresher roles failed", error?.message || "fresher_roles_failed");
    return res.status(200).json({ roles: [] });
  }
});

router.get("/companies/:companyId/company-research", async (req, res) => {
  const companyId = text(req.params.companyId);
  if (!isResearchCompanyId(companyId)) {
    return res.status(400).json({ error: "companyId is not valid." });
  }
  try {
    const jobs = await listCompanyResearchJobs(companyId);
    return res.status(200).json({ jobs });
  } catch (error) {
    console.error("[company-research] list failed", { code: error?.code || "job_read_failed" });
    return res.status(500).json({
      error: {
        code: "job_read_failed",
        message: "Research jobs could not be read.",
      },
    });
  }
});

router.get("/company-research/:jobId", async (req, res) => {
  try {
    const job = await getResearchJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: "Research job not found." });
    return res.status(200).json(job);
  } catch (error) {
    console.error("[company-research] status failed", { code: error?.code || "job_read_failed" });
    return res.status(500).json({
      error: {
        code: "job_read_failed",
        message: "Research job could not be read.",
      },
    });
  }
});

export default router;
