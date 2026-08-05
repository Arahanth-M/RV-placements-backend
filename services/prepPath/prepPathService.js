import PrepPathPlan from "../../models/PrepPathPlan.js";
import { extractResumeText, buildResumeDigest } from "./resumeTextExtract.js";
import {
  loadCompanyPrepContext,
  formatCompanyContextForPrompt,
  normalizePrepPathTrack,
  PREP_PATH_TRACKS,
} from "./companyContext.js";
import { fetchPrepWebSnippets } from "./webEnrichment.js";
import { generatePrepPathRoadmapWithLLM } from "./generateRoadmap.js";
import { attachCampusEvidenceToRoadmap } from "./campusEvidence.js";
import { getCompanyPrepPathPeerDemand } from "./peerDemand.js";
import {
  consumePrepPathQuota,
  getPrepPathQuota,
  refundPrepPathQuota,
} from "./quota.js";

export const PREP_PATH_HISTORY_LIMIT = 10;

/**
 * List recent plans for a user (newest first). Never deletes older docs.
 */
export async function listRecentPrepPathPlans(userId, limit = PREP_PATH_HISTORY_LIMIT) {
  const uid = String(userId || "").trim();
  if (!uid) return [];
  const n = Math.min(20, Math.max(1, Number(limit) || PREP_PATH_HISTORY_LIMIT));
  return PrepPathPlan.find({ userId: uid })
    .sort({ createdAt: -1 })
    .limit(n)
    .select(
      "companyId companyName role track days hoursPerDay contextFlags peerDemand roadmap.summary roadmap.totalHours roadmap.dataQualityNote sources createdAt updatedAt"
    )
    .lean();
}

export async function getPrepPathPlanForUser(userId, planId) {
  const uid = String(userId || "").trim();
  const id = String(planId || "").trim();
  if (!uid || !id) return null;
  return PrepPathPlan.findOne({ _id: id, userId: uid }).lean();
}

/**
 * Generate + persist a PrepPath plan.
 * Writes ONLY to prep_path_plans and prep_path_usage.
 * Reads company collections; never updates/deletes them. Resume file is not stored.
 */
export async function generateAndSavePrepPathPlan({
  userId,
  companyId,
  role,
  track,
  days,
  hoursPerDay,
  resumeBuffer,
  resumeMime,
  resumeOriginalName,
  collegeId,
}) {
  const uid = String(userId || "").trim();
  if (!uid) {
    const err = new Error("Unauthorized");
    err.code = "UNAUTHORIZED";
    throw err;
  }

  const roleClean = String(role || "").trim().slice(0, 120);
  if (roleClean.length < 2) {
    const err = new Error("Enter a target role (e.g. SDE Intern, Backend Engineer).");
    err.code = "INVALID_ROLE";
    throw err;
  }

  const trackNorm = normalizePrepPathTrack(track);
  if (!trackNorm) {
    const err = new Error("Choose Full-time or Summer internship.");
    err.code = "INVALID_TRACK";
    throw err;
  }

  const dayCount = Math.round(Number(days));
  if (!Number.isFinite(dayCount) || dayCount < 1 || dayCount > 5) {
    const err = new Error("Days must be between 1 and 5.");
    err.code = "INVALID_DAYS";
    throw err;
  }

  const hpd = Number(hoursPerDay);
  if (!Number.isFinite(hpd) || hpd < 0.5 || hpd > 16) {
    const err = new Error("Hours per day must be between 0.5 and 16.");
    err.code = "INVALID_HOURS";
    throw err;
  }

  const resumeText = await extractResumeText({
    buffer: resumeBuffer,
    mime: resumeMime,
    originalName: resumeOriginalName,
  });
  const resumeDigest = buildResumeDigest(resumeText, 1500);
  const companyCtx = await loadCompanyPrepContext(companyId, {
    track: trackNorm,
    collegeId,
  });

  const quota = await consumePrepPathQuota(uid);

  try {
    let web = { snippets: [], sources: [], webAugmented: false };
    if (companyCtx.needsWebEnrichment) {
      web = await fetchPrepWebSnippets({
        companyName: companyCtx.companyName,
        role: roleClean,
        track: trackNorm,
      });
    }

    let roadmap = await generatePrepPathRoadmapWithLLM({
      role: roleClean,
      track: trackNorm,
      days: dayCount,
      hoursPerDay: hpd,
      resumeDigest,
      companyPromptBlock: formatCompanyContextForPrompt(companyCtx, {
        targetRole: roleClean,
      }),
      webSnippets: web.snippets,
      limitedData: companyCtx.limitedData,
      contextFlags: companyCtx.flags || {},
    });

    roadmap = attachCampusEvidenceToRoadmap(roadmap, companyCtx.evidenceBank || []);

    if (companyCtx.limitedData && !roadmap.dataQualityNote) {
      roadmap.dataQualityNote =
        "Campus data for this company was limited. Plan uses careful general guidance" +
        (web.webAugmented ? " plus allowlisted web snippets." : ".");
    }

    const sources = [...(companyCtx.sources || []), ...(web.sources || [])];

    const plan = await PrepPathPlan.create({
      userId: uid,
      companyId: companyCtx.companyId,
      companyName: companyCtx.companyName,
      role: roleClean,
      track: trackNorm || PREP_PATH_TRACKS.FULL_TIME,
      days: dayCount,
      hoursPerDay: hpd,
      resumeMeta: {
        fileName: String(resumeOriginalName || "").slice(0, 200),
        mime: String(resumeMime || "").slice(0, 120),
        textChars: resumeText.length,
      },
      resumeDigest,
      contextFlags: {
        ...companyCtx.flags,
        webAugmented: Boolean(web.webAugmented),
        limitedData: Boolean(companyCtx.limitedData),
      },
      roadmap,
      sources,
    });

    const peerDemand = await getCompanyPrepPathPeerDemand(companyCtx.companyId, {
      windowDays: 7,
    });
    await PrepPathPlan.updateOne({ _id: plan._id }, { $set: { peerDemand } }).catch(
      () => {}
    );

    const out = plan.toObject();
    out.peerDemand = peerDemand;
    return { plan: out, quota, peerDemand };
  } catch (err) {
    await refundPrepPathQuota(uid).catch(() => {});
    throw err;
  }
}

export { getPrepPathQuota, getCompanyPrepPathPeerDemand };
