import express from "express";
import { askQuestion } from "../services/ai.js";

const router = express.Router();

// POST /api/chat
// Input: { question: string }
// Output: { answer: string }
router.post("/", async (req, res) => {
  try {
    const { question } = req.body || {};
    if (!question || typeof question !== "string") {
      return res.status(400).json({ error: "Invalid input. Provide 'question' string." });
    }

    const answer = await askQuestion(question);
    return res.json({ answer });
  } catch (err) {
    console.error("/api/chat error:", err);
    return res.status(500).json({ error: "Failed to generate answer" });
  }
});

export default router;


