import express from "express";
import Company from "../models/Company.js";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3 } from "../utils/s3.js";
import requireAuth from "../middleware/requireAuth.js";
import dotenv from "dotenv";
import Submission from "../models/Submission.js";
import { sendKnowMoreWebhook } from "../services/webhookService.js";
dotenv.config();

const companyRouter = express.Router();

companyRouter.post("/", async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "Not logged in" });
    }

    const newCompany = new Company({  
      ...req.body,
      submittedBy: {
        name: req.user.username, 
        email: req.user.email,
      }
    });

    await newCompany.save();
    res.status(201).json(newCompany);
  } catch (err) {
    console.error("Error creating company:", err);
    res.status(500).json({ message: "Server error" });
  }
});
companyRouter.get("/", async (req, res) => {
  try {
    // Only expose approved companies to the public list to avoid 404s on details
    const companies = await Company.find(
      { status: "approved" },
      "name type eligibility roles count business_model date_of_visit logo interview_difficulty_level difficulty_rating_count"
    );
    return res.json(companies);
  } catch (e) {
    console.error("❌ Error fetching companies:", e.message);
    return res.status(500).json({ error: "Server error" });
  }
});

// Update company difficulty rating - MUST be before /:id route
companyRouter.post("/:id/rate-difficulty", async (req, res) => {
  try {
    const { rating } = req.body;
    const { id } = req.params;

    console.log("📊 Rating request received:", { id, rating, ratingType: typeof rating, body: req.body });

    // Validate rating exists
    if (rating === undefined || rating === null || rating === '') {
      return res.status(400).json({ error: "Rating is required" });
    }

    // Validate company ID format
    if (!id || id.length < 10) {
      return res.status(400).json({ error: "Invalid company ID format" });
    }

    // Convert rating to integer and validate
    const ratingNum = parseInt(rating, 10);
    if (isNaN(ratingNum)) {
      return res.status(400).json({ error: `Rating must be a valid number. Received: ${rating} (${typeof rating})` });
    }
    
    if (ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ error: `Rating must be between 1 and 5. Received: ${ratingNum}` });
    }

    const company = await Company.findById(id);
    if (!company) {
      console.error("❌ Company not found with ID:", id);
      return res.status(404).json({ error: `Company not found with ID: ${id}` });
    }

    console.log("✅ Company found:", company.name);
    console.log("📊 Current difficulty_ratings:", company.difficulty_ratings);

    // Initialize arrays if they don't exist
    if (!company.difficulty_ratings || !Array.isArray(company.difficulty_ratings)) {
      company.difficulty_ratings = [];
    }

    // Clean existing ratings array - filter out invalid values and ensure all are valid integers between 1-5
    const cleanedRatings = company.difficulty_ratings
      .map(r => {
        if (r === null || r === undefined) return null;
        const num = parseInt(r, 10);
        return isNaN(num) ? null : num;
      })
      .filter(r => r !== null && r >= 1 && r <= 5);
    
    company.difficulty_ratings = cleanedRatings;
    console.log("📊 Cleaned ratings array:", cleanedRatings);

    if (company.difficulty_rating_count === undefined || company.difficulty_rating_count === null) {
      company.difficulty_rating_count = 0;
    }

    // Add the new rating (ensure it's a number)
    company.difficulty_ratings.push(ratingNum);
    company.difficulty_rating_count = company.difficulty_ratings.length;

    // Calculate average
    const sum = company.difficulty_ratings.reduce((acc, r) => acc + Number(r), 0);
    company.interview_difficulty_level = Number((sum / company.difficulty_ratings.length).toFixed(2));

    console.log("📊 Updated difficulty_ratings:", company.difficulty_ratings);
    console.log("📊 Updated interview_difficulty_level:", company.interview_difficulty_level);

    // Ensure interview_difficulty_level is within valid range
    if (company.interview_difficulty_level < 0) {
      company.interview_difficulty_level = 0;
    }
    if (company.interview_difficulty_level > 5) {
      company.interview_difficulty_level = 5;
    }

    // Mark as modified to ensure Mongoose saves the changes
    company.markModified('difficulty_ratings');
    company.markModified('interview_difficulty_level');
    company.markModified('difficulty_rating_count');

    // Save with validation
    await company.save();

    res.json({
      message: "Rating updated successfully",
      interview_difficulty_level: company.interview_difficulty_level,
      difficulty_rating_count: company.difficulty_rating_count,
    });
  } catch (error) {
    console.error("❌ Error updating difficulty rating:", error.message);
    console.error("❌ Error name:", error.name);
    console.error("❌ Full error stack:", error.stack);
    
    if (error.errors) {
      console.error("❌ Validation errors:", JSON.stringify(error.errors, null, 2));
      // Log each validation error
      const errorDetails = {};
      Object.keys(error.errors).forEach(key => {
        const err = error.errors[key];
        console.error(`  - ${key}: ${err.message} (value: ${err.value})`);
        errorDetails[key] = err.message;
      });
      
      if (error.name === 'ValidationError') {
        return res.status(400).json({ 
          error: "Validation error",
          message: error.message || "Data validation failed",
          details: errorDetails
        });
      }
    }
    
    if (error.name === 'ValidationError') {
      return res.status(400).json({ 
        error: "Validation error",
        message: error.message || "Data validation failed"
      });
    }
    
    res.status(500).json({ 
      error: "Server error",
      message: error.message || "Failed to update rating"
    });
  }
});

// companyRouter.get("/:id", requireAuth, async (req, res) => {
//   try {
//     const company = await Company.findOne({
//       _id: req.params.id,
//       status: "approved", 
//     });

//     if (!company) {
//       return res.status(404).json({ error: "Company not found" });
//     }

//     let videoUrl = null;

//     if (company.videoKey) {
//       try {
//         const command = new GetObjectCommand({
//           Bucket: process.env.BUCKET_NAME,
//           Key: company.videoKey,
//         });
//         videoUrl = await getSignedUrl(s3, command, { expiresIn: 600 });
//       } catch (s3Err) {
//         console.error("❌ S3 Signed URL Error:", s3Err.message);
//       }
//     }

//     res.json({
//       ...company.toObject(),
//       videoUrl,
//     });
//   } catch (err) {
//     console.error("❌ Company Fetch Error:", err.message);
//     res.status(500).json({ error: "Internal Server Error" });
//   }
// });
companyRouter.get("/:id", requireAuth, async (req, res) => {
  try {
    const company = await Company.findOne({
      _id: req.params.id,
      status: "approved", 
    });

    if (!company) {
      return res.status(404).json({ error: "Company not found" });
    }

    let videoUrl = null;

    if (company.videoKey) {
      try {
        const command = new GetObjectCommand({
          Bucket: process.env.BUCKET_NAME,
          Key: company.videoKey,
        });
        videoUrl = await getSignedUrl(s3, command, { expiresIn: 600 });
      } catch (s3Err) {
        console.error("❌ S3 Signed URL Error:", s3Err.message);
      }
    }

    // Convert Map -> Object for each role
    const companyObj = company.toObject();
    companyObj.roles = (companyObj.roles || []).map(role => ({
      ...role,
      ctc: role.ctc instanceof Map ? Object.fromEntries(role.ctc) : role.ctc
    }));

    // Legacy support: if onlineQuestions_solution missing, fallback to old field names
    const legacySolutionsArrays = [
      companyObj.onlineQuestions_solution,
      companyObj.onlineQuestion_solution,
      companyObj.onlineQuestion_solutions,
    ].filter(Array.isArray);

    if (
      (!companyObj.onlineQuestions_solution || companyObj.onlineQuestions_solution.length === 0) &&
      legacySolutionsArrays.length > 0
    ) {
      // Use the first available legacy array
      companyObj.onlineQuestions_solution = legacySolutionsArrays.find(Array.isArray);
    }
    delete companyObj.onlineQuestion_solution;
    delete companyObj.onlineQuestion_solutions;

    res.json({
      ...companyObj,
      videoUrl,
    });
  } catch (err) {
    console.error("❌ Company Fetch Error:", err.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
});








companyRouter.post("/", async (req, res) => {
  try {
    const { companyId, type, content } = req.body;

    if (!companyId || !type || !content) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const newSubmission = new Submission({ companyId, type, content });
    await newSubmission.save();

    res.status(201).json({ message: "Submission received and pending approval." });
  } catch (error) {
    res.status(500).json({ error: "Error saving submission" });
  }
});

// Get "Know More" information from webhook
companyRouter.post("/know-more", async (req, res) => {
  try {
    const { companyName } = req.body;

    if (!companyName) {
      return res.status(400).json({ error: "Company name is required" });
    }

    const data = await sendKnowMoreWebhook(companyName);
    res.json(data);
  } catch (error) {
    console.error("❌ Error fetching Know More webhook:", error.message);
    res.status(500).json({ 
      error: error.message || "Failed to fetch company information. Please try again later." 
    });
  }
});




export default companyRouter;