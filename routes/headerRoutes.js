import express from "express";
 
import User from "../models/User.js"; 
import { userAuth } from "../middlewares/auth.js";

const headerRouter = express.Router();


headerRouter.get("/me", userAuth, async (req, res) => {
  try {
    
    const user = await User.findById(req.user.id).select("-password"); 
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json(user);
  } catch (err) {
    console.error("Error in /auth/me:", err);
    res.status(500).json({ message: "Server error" });
  }
});

export default headerRouter;
