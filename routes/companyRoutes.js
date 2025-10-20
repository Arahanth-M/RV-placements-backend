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
      "name type eligibility roles count business_model date_of_visit"
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




export default companyRouter;