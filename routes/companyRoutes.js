import express from "express";
import Company from "../models/Company.js";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3 } from "../utils/s3.js";
import requireAuth from "../middleware/requireAuth.js";
import dotenv from "dotenv";
import Submission from "../models/Submission.js";
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
      "name type eligibility roles count business_model date_of_visit logo helpfulCount"
    );
    return res.json(companies);
  } catch (e) {
    console.error("❌ Error fetching companies:", e.message);
    return res.status(500).json({ error: "Server error" });
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








// Increment helpful count for a company (one vote per user)
companyRouter.post("/:id/helpful", async (req, res) => {
  try {
    // Check if user is authenticated
    if (!req.user || !req.user.email) {
      return res.status(401).json({ error: "You must be logged in to upvote" });
    }

    const company = await Company.findById(req.params.id);
    
    if (!company) {
      return res.status(404).json({ error: "Company not found" });
    }

    // Initialize helpfulUsers array if it doesn't exist
    if (!company.helpfulUsers) {
      company.helpfulUsers = [];
    }

    const userEmail = req.user.email;

    // Check if user has already upvoted
    if (company.helpfulUsers.includes(userEmail)) {
      return res.status(400).json({ 
        error: "You have already upvoted this company",
        helpfulCount: company.helpfulCount,
        hasUpvoted: true
      });
    }

    // Add user email to helpfulUsers and increment count
    company.helpfulUsers.push(userEmail);
    company.helpfulCount = (company.helpfulCount || 0) + 1;
    await company.save();

    res.json({ 
      message: "Helpful count updated",
      helpfulCount: company.helpfulCount,
      hasUpvoted: true
    });
  } catch (error) {
    console.error("❌ Error updating helpful count:", error);
    res.status(500).json({ error: "Error updating helpful count" });
  }
});

// Check if current user has upvoted a company
companyRouter.get("/:id/helpful/status", async (req, res) => {
  try {
    if (!req.user || !req.user.email) {
      return res.json({ hasUpvoted: false });
    }

    const company = await Company.findById(req.params.id);
    
    if (!company) {
      return res.status(404).json({ error: "Company not found" });
    }

    const hasUpvoted = company.helpfulUsers && company.helpfulUsers.includes(req.user.email);

    res.json({ 
      hasUpvoted: hasUpvoted || false,
      helpfulCount: company.helpfulCount || 0
    });
  } catch (error) {
    console.error("❌ Error checking helpful status:", error);
    res.status(500).json({ error: "Error checking helpful status" });
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


export default companyRouter;