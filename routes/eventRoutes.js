import express from "express";
import requireAdmin from "../middleware/requireAdmin.js";
import requireAuth from "../middleware/requireAuth.js";
import Event from "../models/Event.js";

const eventRouter = express.Router();

// Public route - Get all events (for students)
eventRouter.get("/", async (req, res) => {
  try {
    const events = await Event.find()
      .sort({ lastDateToRegister: 1, createdAt: -1 })
      .populate("createdBy", "username email")
      .select("-__v");
    
    res.json(events);
  } catch (error) {
    console.error("❌ Error fetching events:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

// Get single event by ID
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

// Admin routes - require authentication
eventRouter.use(requireAuth);
eventRouter.use(requireAdmin);

// Create new event (Admin only)
eventRouter.post("/", async (req, res) => {
  try {
    const { title, url, lastDateToRegister } = req.body;

    // Validation
    if (!title || !url || !lastDateToRegister) {
      return res.status(400).json({ 
        error: "Missing required fields: title, url, and lastDateToRegister are required" 
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
      createdBy: req.user._id,
    });

    await event.save();
    
    const populatedEvent = await Event.findById(event._id)
      .populate("createdBy", "username email")
      .select("-__v");

    res.status(201).json(populatedEvent);
  } catch (error) {
    console.error("❌ Error creating event:", error.message);
    
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

// Update event (Admin only)
eventRouter.put("/:id", async (req, res) => {
  try {
    const { title, url, lastDateToRegister } = req.body;

    const event = await Event.findById(req.params.id);
    
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    // Update fields if provided
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

    res.json(populatedEvent);
  } catch (error) {
    console.error("❌ Error updating event:", error.message);
    
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

// Delete event (Admin only)
eventRouter.delete("/:id", async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    await Event.findByIdAndDelete(req.params.id);
    
    res.json({ message: "Event deleted successfully" });
  } catch (error) {
    console.error("❌ Error deleting event:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

export default eventRouter;

