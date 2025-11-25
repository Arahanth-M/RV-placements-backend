import express from "express";
import Notification from "../models/Notification.js";
import requireAuth from "../middleware/requireAuth.js";

const notificationRouter = express.Router();

// All notification routes require authentication
notificationRouter.use(requireAuth);

// Get all notifications for the current user
notificationRouter.get("/", async (req, res) => {
  try {
    if (!req.user || !req.user.userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    const notifications = await Notification.find({ userId: req.user.userId })
      .sort({ createdAt: -1 })
      .limit(50); // Limit to last 50 notifications

    res.json(notifications);
  } catch (error) {
    console.error("❌ Error fetching notifications:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Get unread notification count
notificationRouter.get("/unread/count", async (req, res) => {
  try {
    if (!req.user || !req.user.userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    const count = await Notification.countDocuments({
      userId: req.user.userId,
      isSeen: false,
    });

    res.json({ count });
  } catch (error) {
    console.error("❌ Error fetching unread count:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Mark notification as seen
notificationRouter.put("/:id/seen", async (req, res) => {
  try {
    if (!req.user || !req.user.userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    const notification = await Notification.findOne({
      _id: req.params.id,
      userId: req.user.userId,
    });

    if (!notification) {
      return res.status(404).json({ error: "Notification not found" });
    }

    notification.isSeen = true;
    await notification.save();

    res.json({ message: "Notification marked as seen", notification });
  } catch (error) {
    console.error("❌ Error marking notification as seen:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Mark all notifications as seen
notificationRouter.put("/mark-all-seen", async (req, res) => {
  try {
    if (!req.user || !req.user.userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    await Notification.updateMany(
      { userId: req.user.userId, isSeen: false },
      { isSeen: true }
    );

    res.json({ message: "All notifications marked as seen" });
  } catch (error) {
    console.error("❌ Error marking all notifications as seen:", error);
    res.status(500).json({ error: "Server error" });
  }
});

export default notificationRouter;

