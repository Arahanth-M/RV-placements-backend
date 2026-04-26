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

function buildPdfBufferFromResume(payload = {}) {
  const lines = [];
  const personal = payload.personal || {};
  lines.push(sanitizeText(personal.fullName || "Resume"));
  lines.push(sanitizeText(personal.email || ""));
  lines.push(sanitizeText(personal.phone || ""));
  lines.push("");
  lines.push("Skills");
  (payload.skills || []).forEach((skill) => lines.push(`- ${sanitizeText(skill)}`));
  lines.push("");
  lines.push("Education");
  (payload.education || []).forEach((entry) => {
    const institution = sanitizeText(entry.institution);
    const degree = sanitizeText(entry.degree);
    lines.push(`- ${institution}${degree ? ` | ${degree}` : ""}`);
  });

  const content = lines.join("\n").slice(0, 2000).replace(/[()\\]/g, "\\$&");
  const pdfText = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length ${content.length + 45} >> stream
BT /F1 12 Tf 40 760 Td (${content}) Tj ET
endstream endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
xref
0 6
0000000000 65535 f 
0000000010 00000 n 
0000000062 00000 n 
0000000119 00000 n 
0000000247 00000 n 
0000000365 00000 n 
trailer << /Root 1 0 R /Size 6 >>
startxref
438
%%EOF`;
  return Buffer.from(pdfText, "utf8");
}

router.use(authJWT, checkBetaAccess, authorize(["student", "admin"]));

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
    const pdfBuffer = buildPdfBufferFromResume(payload);

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
