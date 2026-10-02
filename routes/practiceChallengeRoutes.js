import express from "express";
import authJWT from "../middleware/authJWT.js";
import validateRequest from "../middleware/validateRequest.js";
import {
  getTodayChallenge,
  getWeekChallenge,
  getChallengeById,
  runChallengePreview,
  submitChallengeSolution,
  getPracticeLeaderboard,
  getMyPracticeRank,
  ensureChallengesNow,
} from "../services/practiceChallengeService.js";
import {
  practiceChallengeRunSchema,
  practiceChallengeSubmitSchema,
} from "../validations/practiceChallenge.validation.js";
import { recordDauActivitySafe } from "../services/dau/recordDauActivity.js";

const router = express.Router();

function mapError(res, error) {
  const code = error?.code;
  const status = error?.status || 400;
  if (!code) return null;
  return res.status(status).json({ error: error.message, code });
}

router.use(authJWT);

router.get("/today", async (req, res) => {
  try {
    const challenge = await getTodayChallenge({ user: req.user });
    return res.json({ success: true, challenge });
  } catch (error) {
    if (mapError(res, error)) return undefined;
    console.error("[practice-challenges] today failed:", error?.message || error);
    return res.status(500).json({ error: "Failed to load today's challenge" });
  }
});

router.get("/week", async (req, res) => {
  try {
    const challenge = await getWeekChallenge({ user: req.user });
    return res.json({ success: true, challenge });
  } catch (error) {
    if (mapError(res, error)) return undefined;
    console.error("[practice-challenges] week failed:", error?.message || error);
    return res.status(500).json({ error: "Failed to load weekly challenge" });
  }
});

router.get("/leaderboard", async (req, res) => {
  try {
    const board = await getPracticeLeaderboard({
      user: req.user,
      period: req.query?.period,
    });
    return res.json(board);
  } catch (error) {
    if (mapError(res, error)) return undefined;
    console.error("[practice-challenges] leaderboard failed:", error?.message || error);
    return res.status(500).json({ error: "Failed to load practice leaderboard" });
  }
});

router.get("/leaderboard/me", async (req, res) => {
  try {
    const me = await getMyPracticeRank({
      user: req.user,
      period: req.query?.period,
    });
    return res.json(me);
  } catch (error) {
    if (mapError(res, error)) return undefined;
    console.error("[practice-challenges] leaderboard/me failed:", error?.message || error);
    return res.status(500).json({ error: "Failed to load your practice rank" });
  }
});

router.post("/ensure", async (req, res) => {
  try {
    const isAdmin =
      req.user?.isAdminSession === true ||
      req.user?.role === "admin" ||
      req.user?.role === "superadmin";
    if (!isAdmin) {
      return res.status(403).json({ error: "Admin only", code: "FORBIDDEN" });
    }
    const result = await ensureChallengesNow();
    return res.json({ success: true, ...result });
  } catch (error) {
    if (mapError(res, error)) return undefined;
    console.error("[practice-challenges] ensure failed:", error?.message || error);
    return res.status(500).json({ error: "Failed to ensure challenges" });
  }
});

router.get("/:challengeId", async (req, res) => {
  try {
    const challenge = await getChallengeById({
      user: req.user,
      challengeId: req.params.challengeId,
    });
    return res.json({ success: true, challenge });
  } catch (error) {
    if (mapError(res, error)) return undefined;
    console.error("[practice-challenges] get failed:", error?.message || error);
    return res.status(500).json({ error: "Failed to load challenge" });
  }
});

router.post(
  "/:challengeId/problems/:questionId/run-preview",
  validateRequest(practiceChallengeRunSchema),
  async (req, res) => {
    try {
      const result = await runChallengePreview({
        user: req.user,
        challengeId: req.params.challengeId,
        questionId: req.params.questionId,
        code: req.body.code,
        language: req.body.language,
      });
      return res.json(result);
    } catch (error) {
      if (mapError(res, error)) return undefined;
      console.error("[practice-challenges] run-preview failed:", error?.message || error);
      return res.status(500).json({ error: "Failed to run preview" });
    }
  }
);

router.post(
  "/:challengeId/problems/:questionId/submit",
  validateRequest(practiceChallengeSubmitSchema),
  async (req, res) => {
    try {
      const result = await submitChallengeSolution({
        user: req.user,
        challengeId: req.params.challengeId,
        questionId: req.params.questionId,
        code: req.body.code,
        language: req.body.language,
      });
      recordDauActivitySafe(req.user, { action: "practice_challenge_submit" });
      return res.json(result);
    } catch (error) {
      if (mapError(res, error)) return undefined;
      console.error("[practice-challenges] submit failed:", error?.message || error);
      return res.status(500).json({ error: "Failed to submit solution" });
    }
  }
);

export default router;
