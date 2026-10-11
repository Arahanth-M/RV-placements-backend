import express from "express";
import mongoose from "mongoose";
import {
  createNotification,
  getUserNotifications,
  getUnreadCount,
  markAsSeen,
  markAllAsSeen,
  deleteNotification,
  clearAllNotifications,
} from "../services/notificationService.js";
import authJWT from "../middleware/authJWT.js";
import { subscribe } from "../services/realtime/notificationEmitter.js";

const notificationRouter = express.Router();

notificationRouter.use(authJWT);

notificationRouter.get("/stream", (req, res) => {
  const userId = req.user?._id;
  if (!userId) return res.sendStatus(401);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }

  subscribe(String(userId), res);
});

function userIdFromRequest(req, res) {
  const raw = req.user?._id;
  if (raw == null || raw === "") {
    res.status(401).json({ error: "User not authenticated" });
    return null;
  }
  const s = String(raw);
  try {
    // eslint-disable-next-line no-new
    new mongoose.Types.ObjectId(s);
    return s;
  } catch {
    res.status(400).json({ error: "Invalid user id" });
    return null;
  }
}

function notificationIdFromParams(req, res) {
  const { id } = req.params;
  if (id == null || id === "") {
    res.status(400).json({ error: "Invalid notification id" });
    return null;
  }
  try {
    // eslint-disable-next-line no-new
    new mongoose.Types.ObjectId(String(id));
    return String(id);
  } catch {
    res.status(400).json({ error: "Invalid notification id" });
    return null;
  }
}

notificationRouter.get("/unread/count", async (req, res) => {
  try {
    const userId = userIdFromRequest(req, res);
    if (!userId) return;

    const count = await getUnreadCount(userId);
    res.status(200).json({ count });
  } catch (error) {
    console.error("❌ Error fetching unread count:", error);
    res.status(500).json({ error: "Server error" });
  }
});

notificationRouter.get("/", async (req, res) => {
  try {
    const userId = userIdFromRequest(req, res);
    if (!userId) return;

    const { notifications, pageInfo } = await getUserNotifications(userId, {
      cursor: req.query.cursor,
      limit: req.query.limit,
    });
    res.status(200).json({ notifications, pageInfo });
  } catch (error) {
    console.error("❌ Error fetching notifications:", error);
    res.status(500).json({ error: "Server error" });
  }
});

notificationRouter.put("/mark-all-seen", async (req, res) => {
  try {
    const userId = userIdFromRequest(req, res);
    if (!userId) return;

    const { modifiedCount } = await markAllAsSeen(userId);
    res.status(200).json({ modifiedCount });
  } catch (error) {
    console.error("❌ Error marking all notifications as seen:", error);
    res.status(500).json({ error: "Server error" });
  }
});

notificationRouter.put("/:id/seen", async (req, res) => {
  try {
    const userId = userIdFromRequest(req, res);
    if (!userId) return;

    const notificationId = notificationIdFromParams(req, res);
    if (!notificationId) return;

    const notification = await markAsSeen(notificationId, userId);
    if (!notification) {
      return res.status(404).json({ error: "Notification not found" });
    }
    res.status(200).json(notification);
  } catch (error) {
    console.error("❌ Error marking notification as seen:", error);
    res.status(500).json({ error: "Server error" });
  }
});

notificationRouter.delete("/:id", async (req, res) => {
  try {
    const userId = userIdFromRequest(req, res);
    if (!userId) return;

    const notificationId = notificationIdFromParams(req, res);
    if (!notificationId) return;

    const deleted = await deleteNotification(notificationId, userId);
    if (!deleted) {
      return res.status(404).json({ error: "Notification not found" });
    }
    res.status(200).json(deleted);
  } catch (error) {
    console.error("❌ Error deleting notification:", error);
    res.status(500).json({ error: "Server error" });
  }
});

notificationRouter.delete("/", async (req, res) => {
  try {
    const userId = userIdFromRequest(req, res);
    if (!userId) return;

    const { deletedCount } = await clearAllNotifications(userId);
    res.status(200).json({ deletedCount });
  } catch (error) {
    console.error("❌ Error clearing notifications:", error);
    res.status(500).json({ error: "Server error" });
  }
});

export default notificationRouter;
