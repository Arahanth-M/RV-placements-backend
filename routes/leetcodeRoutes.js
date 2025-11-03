import express from "express";
import Leetcode from "../models/Leetcode.js";

const leetcodeRouter = express.Router();

// GET all LeetCode questions
leetcodeRouter.get("/", async (req, res) => {
  try {
    const { company, likelihood, search, category } = req.query;
    
    // Build query
    let query = {};
    
    if (company) {
      query.company = { $regex: company, $options: "i" };
    }
    
    if (likelihood) {
      query.likelihood = { $regex: likelihood, $options: "i" };
    }
    
    if (category) {
      query.category = category.toUpperCase();
    }
    
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: "i" } },
        { company: { $regex: search, $options: "i" } },
      ];
    }
    
    console.log("📋 Query:", JSON.stringify(query, null, 2));
    const questions = await Leetcode.find(query).sort({ createdAt: -1 });
    console.log(`✅ Found ${questions.length} questions`);
    console.log("📝 Sample question:", questions.length > 0 ? questions[0] : "No questions found");
    
    return res.json(questions);
  } catch (error) {
    console.error("❌ Error fetching LeetCode questions:", error.message);
    console.error("❌ Full error:", error);
    return res.status(500).json({ error: "Server error", details: error.message });
  }
});

// GET a single LeetCode question by ID
leetcodeRouter.get("/:id", async (req, res) => {
  try {
    const question = await Leetcode.findById(req.params.id);
    
    if (!question) {
      return res.status(404).json({ error: "Question not found" });
    }
    
    return res.json(question);
  } catch (error) {
    console.error("❌ Error fetching LeetCode question:", error.message);
    return res.status(500).json({ error: "Server error" });
  }
});

export default leetcodeRouter;

