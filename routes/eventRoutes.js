import express from "express";
import mongoose from "mongoose";
import requireAdmin from "../middleware/requireAdmin.js";
import authJWT from "../middleware/authJWT.js";
import validateRequest from "../middleware/validateRequest.js";
import { eventCreateSchema, eventUpdateSchema } from "../validations/event.validation.js";
import Event from "../models/Event.js";
import Student from "../models/Student.js";
import {
  getCachedEventRegistrations,
  setCachedEventRegistrations,
} from "../services/eventRegistrationCache.js";
import {
  getCachedEventCatalog,
  setCachedEventCatalog,
  loadEventsCatalogFromDb,
  invalidateEventCatalogCache,
} from "../services/eventCatalogCache.js";

const eventRouter = express.Router();

// Public route - Get all events (for students)
eventRouter.get("/", async (req, res) => {
  try {
    const cached = await getCachedEventCatalog();
    if (cached) {
      return res.json(cached);
    }

    const events = await loadEventsCatalogFromDb();
    await setCachedEventCatalog(events);
    res.json(events);
  } catch (error) {
    console.error("❌ Error fetching events:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

/** Logged-in student: which events they marked registered (for Events UI). Admins get an empty list. */
eventRouter.get("/me/registrations", authJWT, async (req, res) => {
  try {
    if (req.user?.isAdminSession === true) {
      return res.json({ registeredEventIds: [] });
    }
    const email = String(req.user?.email || "")
      .trim()
      .toLowerCase();
    if (!email) {
      return res.status(400).json({ error: "No email on this account." });
    }
    const cached = await getCachedEventRegistrations(email);
    if (cached) {
      return res.json({ registeredEventIds: cached.registeredEventIds });
    }
    const student = await Student.findOne({ email }).select("registeredEventIds").lean();
    const ids = (student?.registeredEventIds || []).map((oid) => String(oid));
    await setCachedEventRegistrations(email, { registeredEventIds: ids });
    res.json({ registeredEventIds: ids });
  } catch (error) {
    console.error("❌ Error fetching event registrations:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

// Get single event by ID (must stay after /me/registrations so "me" is not parsed as :id)
eventRouter.get("/:id", async (req, res) => {
  try {
    const event = await Event.findById(req.params.id)
      .populate("createdBy", "username email")
      .select("-__v");

    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    res.json(event);
  } catch (error) {
    console.error("❌ Error fetching event:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

/** Student marks themselves registered for an event (stores `event_id` on their Student document). */
eventRouter.post("/:id/register", authJWT, async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid event id" });
    }
    if (req.user?.isAdminSession === true) {
      return res
        .status(403)
        .json({ error: "Event self-registration is only for student accounts." });
    }
    const email = String(req.user?.email || "")
      .trim()
      .toLowerCase();
    if (!email) {
      return res.status(400).json({ error: "No email on this account." });
    }

    const event = await Event.findById(id).select("_id lastDateToRegister").lean();
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }
    const endOfDay = new Date(event.lastDateToRegister);
    endOfDay.setHours(23, 59, 59, 999);
    if (endOfDay < new Date()) {
      return res.status(400).json({ error: "Registration deadline has passed for this event." });
    }

    const eventOid = new mongoose.Types.ObjectId(id);
    const result = await Student.updateOne(
      { email },
      { $addToSet: { registeredEventIds: eventOid } }
    );
    if (result.matchedCount === 0) {
      return res.status(404).json({
        error:
          "No student record matches your login email. Ask the placement office to add your record.",
      });
    }

    const student = await Student.findOne({ email }).select("registeredEventIds").lean();
    const registeredEventIds = (student?.registeredEventIds || []).map((oid) =>
      String(oid)
    );
    await setCachedEventRegistrations(email, { registeredEventIds });
    res.json({
      ok: true,
      registeredEventIds,
    });
  } catch (error) {
    console.error("❌ Error registering for event:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

// Admin routes - require authentication + admin session
eventRouter.post("/", authJWT, requireAdmin, validateRequest(eventCreateSchema), async (req, res) => {
  try {
    const { title, url, lastDateToRegister, type, organizer } = req.body;

    // Validation
    if (!title || !url || !lastDateToRegister) {
      return res.status(400).json({
        error: "Missing required fields: title, url, and lastDateToRegister are required",
      });
    }

    // Validate date
    const registrationDate = new Date(lastDateToRegister);
    if (isNaN(registrationDate.getTime())) {
      return res.status(400).json({ error: "Invalid date format for lastDateToRegister" });
    }

    const event = new Event({
      title,
      url,
      lastDateToRegister: registrationDate,
      type: String(type ?? "").trim(),
      organizer: String(organizer ?? "").trim(),
      createdBy: req.user._id,
    });

    await event.save();

    const populatedEvent = await Event.findById(event._id)
      .populate("createdBy", "username email")
      .select("-__v");

    await invalidateEventCatalogCache();

    res.status(201).json(populatedEvent);
  } catch (error) {
    console.error("❌ Error creating event:", error.message);

    if (error.name === "ValidationError") {
      const errors = {};
      Object.keys(error.errors || {}).forEach((key) => {
        errors[key] = error.errors[key].message;
      });
      return res.status(400).json({
        error: "Validation failed",
        details: errors,
      });
    }

    res.status(500).json({ error: "Server error" });
  }
});

eventRouter.put("/:id", authJWT, requireAdmin, validateRequest(eventUpdateSchema), async (req, res) => {
  try {
    const { title, url, lastDateToRegister, type, organizer } = req.body;

    const event = await Event.findById(req.params.id);

    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    // Update fields if provided
    if (type !== undefined) event.type = String(type ?? "").trim();
    if (organizer !== undefined) event.organizer = String(organizer ?? "").trim();
    if (title !== undefined) event.title = title;
    if (url !== undefined) event.url = url;
    if (lastDateToRegister !== undefined) {
      const registrationDate = new Date(lastDateToRegister);
      if (isNaN(registrationDate.getTime())) {
        return res.status(400).json({ error: "Invalid date format for lastDateToRegister" });
      }
      event.lastDateToRegister = registrationDate;
    }

    await event.save();

    const populatedEvent = await Event.findById(event._id)
      .populate("createdBy", "username email")
      .select("-__v");

    await invalidateEventCatalogCache();

    res.json(populatedEvent);
  } catch (error) {
    console.error("❌ Error updating event:", error.message);

    if (error.name === "ValidationError") {
      const errors = {};
      Object.keys(error.errors || {}).forEach((key) => {
        errors[key] = error.errors[key].message;
      });
      return res.status(400).json({
        error: "Validation failed",
        details: errors,
      });
    }

    res.status(500).json({ error: "Server error" });
  }
});

eventRouter.delete("/:id", authJWT, requireAdmin, async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);

    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    await Event.findByIdAndDelete(req.params.id);

    await invalidateEventCatalogCache();

    res.json({ message: "Event deleted successfully" });
  } catch (error) {
    console.error("❌ Error deleting event:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

export default eventRouter;
