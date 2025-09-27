// import express from "express";
// import Company from "../models/Company.js"
// const companyRouter = express.Router();
// import {  GetObjectCommand } from "@aws-sdk/client-s3";
// import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
// import {s3} from "../utils/s3.js"
// import dotenv from "dotenv";
// dotenv.config();






// companyRouter.post("/api/companies",  async (req, res) => {
//     try {
      
        
//       const company = await Company.create(req.body);
//       console.log("✅ New company created");
//       return res.status(201).json(company);
//     } catch (e) {
//       console.error("❌ Error creating company:", e.message);
//       return res.status(400).json({ error: e.message });
//     }
//   });



//   companyRouter.get("/api/companies",async (req, res) => {
//     try {
  
//       const companies = await Company.find({}, "name type eligibility roles count business_model date_of_visit");
      
//       return res.json(companies);
//     } catch (e) {
//       console.error("❌ Error fetching companies:", e.message);
//       return res.status(500).json({ error: "Server error" });
//     }
//   });




//   // companyRouter.get("/api/companies/:id", userAuth , async (req, res) => {
//   //   try {
//   //     const company = await Company.findById(req.params.id);
//   //     if (!company) {
//   //       return res.status(404).json({ error: "Company not found" });
//   //     }
//   //     return res.json(company);
//   //   } catch (e) {
//   //     console.error("❌ Error fetching company:", e.message);
//   //     return res.status(400).json({ error: "Invalid company ID" });
//   //   }
//   // });

  
//   companyRouter.get("/api/companies/:id", async (req, res) => {
//     try {
//       const company = await Company.findById(req.params.id);
  
//       if (!company) {
//         return res.status(404).json({ error: "Company not found" });
//       }
  
//       let videoUrl = null;
  
//       if (company.videoKey) {
//         try {
//           const command = new GetObjectCommand({
//             Bucket: process.env.BUCKET_NAME,
//             Key: company.videoKey,
//           });
//           videoUrl = await getSignedUrl(s3, command, { expiresIn: 600 });
//         } catch (s3Err) {
//           console.error("❌ S3 Signed URL Error:", s3Err.message);
//         }
//       }
  
//       res.json({
//         ...company.toObject(),
//         videoUrl,
//       });
//     } catch (err) {
//       console.error("❌ Company Fetch Error:", err.message);
//       res.status(500).json({ error: "Internal Server Error" });
//     }
//   });
  


// export default companyRouter;

import express from "express";
import Company from "../models/Company.js";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3 } from "../utils/s3.js";
import requireAuth from "../middleware/requireAuth.js";
import dotenv from "dotenv";
dotenv.config();

const companyRouter = express.Router();

companyRouter.post("/", async (req, res) => {
  try {
    const company = await Company.create(req.body);
    console.log("✅ New company created");
    return res.status(201).json(company);
  } catch (e) {
    console.error("❌ Error creating company:", e.message);
    return res.status(400).json({ error: e.message });
  }
});

// companyRouter.get("/", async (req, res) => {
//   try {
//     const companies = await Company.find({}, "name type eligibility roles count business_model date_of_visit");
//     return res.json(companies);
//   } catch (e) {
//     console.error("❌ Error fetching companies:", e.message);
//     return res.status(500).json({ error: "Server error" });
//   }
// });

companyRouter.get("/", async (req, res) => {
  try {
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

// Protected route - requires authentication
companyRouter.get("/:id", requireAuth, async (req, res) => {
  try {
    const company = await Company.findOne({
      _id: req.params.id,
      status: "approved", // only approved companies accessible
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

    res.json({
      ...company.toObject(),
      videoUrl,
    });
  } catch (err) {
    console.error("❌ Company Fetch Error:", err.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default companyRouter;