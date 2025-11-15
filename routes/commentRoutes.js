import express from "express";
import Comment from "../models/Comment.js";
import Company from "../models/Company.js";
import requireAuth from "../middleware/requireAuth.js";

const ADMIN_EMAIL = "arahanthm.cs22@rvce.edu.in";

const commentRouter = express.Router();

// Get all comments for a company
commentRouter.get("/companies/:companyId/comments", async (req, res) => {
  try {
    const { companyId } = req.params;

    // Verify company exists
    const company = await Company.findById(companyId);
    if (!company) {
      return res.status(404).json({ error: "Company not found" });
    }

    // Get all comments for this company, sorted by newest first
    const comments = await Comment.find({ company: companyId })
      .populate("user", "username email picture")
      .sort({ createdAt: -1 })
      .select("-__v")
      .lean();

    res.json(comments);
  } catch (error) {
    console.error("❌ Error fetching comments:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

// Create a new comment (requires authentication)
commentRouter.post("/companies/:companyId/comments", requireAuth, async (req, res) => {
  try {
    const { companyId } = req.params;
    const { comment } = req.body;

    // Validate input
    if (!comment || !comment.trim()) {
      return res.status(400).json({ error: "Comment text is required" });
    }

    if (comment.trim().length > 2000) {
      return res.status(400).json({ error: "Comment cannot exceed 2000 characters" });
    }

    // Verify company exists
    const company = await Company.findById(companyId);
    if (!company) {
      return res.status(404).json({ error: "Company not found" });
    }

    // Create comment
    const newComment = new Comment({
      company: companyId,
      user: req.user._id,
      username: req.user.username || req.user.email || "Anonymous",
      comment: comment.trim(),
    });

    await newComment.save();

    // Populate and return the comment
    const populatedComment = await Comment.findById(newComment._id)
      .populate("user", "username email picture")
      .select("-__v")
      .lean();

    res.status(201).json(populatedComment);
  } catch (error) {
    console.error("❌ Error creating comment:", error.message);
    
    if (error.name === "ValidationError") {
      const errors = {};
      Object.keys(error.errors || {}).forEach(key => {
        errors[key] = error.errors[key].message;
      });
      return res.status(400).json({
        error: "Validation failed",
        details: errors
      });
    }

    res.status(500).json({ error: "Server error" });
  }
});

// Delete a comment (by the user who created it, or by admin)
commentRouter.delete("/comments/:commentId", requireAuth, async (req, res) => {
  try {
    const { commentId } = req.params;

    const comment = await Comment.findById(commentId);

    if (!comment) {
      return res.status(404).json({ error: "Comment not found" });
    }

    // Check if user is admin
    const isAdmin = req.user.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();
    
    // Check if user owns the comment or is admin
    const isOwner = comment.user.toString() === req.user._id.toString();
    
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: "You can only delete your own comments" });
    }

    await Comment.findByIdAndDelete(commentId);

    res.json({ message: "Comment deleted successfully" });
  } catch (error) {
    console.error("❌ Error deleting comment:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

export default commentRouter;

