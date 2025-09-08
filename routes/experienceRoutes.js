import express from "express";
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import mammoth from "mammoth";
import dotenv from "dotenv";
import { streamToBuffer } from "../utils/streamToBuffer.js";
import { userAuth } from "../middlewares/auth.js";

dotenv.config();
const router = express.Router();


const s3 = new S3Client({
  region: process.env.BUCKET_REGION,
  credentials: {
    accessKeyId: process.env.ACCESS_KEY,
    secretAccessKey: process.env.SECRET_ACCESS_KEY,
  },
});

router.get("/experiences",userAuth, async (req, res) => {
    try {
      const params = { Bucket: process.env.BUCKET_NAME };
      const data = await s3.send(new ListObjectsV2Command(params));
  
      
  
      if (!data.Contents || data.Contents.length === 0) {
        return res.json([]);
      }
  
      const fileList = await Promise.all(
        data.Contents.map(async (file) => {
          try {
            console.log("📄 Processing file:", file.Key);
  
            if (!file.Key.endsWith(".docx")) {
              console.log(`⏭ Skipping non-docx file: ${file.Key}`);
              return { key: file.Key, html: "<p>Unsupported file format</p>" };
            }
  
            const command = new GetObjectCommand({
              Bucket: process.env.BUCKET_NAME,
              Key: file.Key,
            });
  
            const s3Response = await s3.send(command);
            console.log("📥 Got S3 object:", file.Key);
  
            
            if (!s3Response.Body) {2
              throw new Error("S3 response has no Body");
            }
  
            const buffer = await streamToBuffer(s3Response.Body);
            console.log("📦 Buffer length:", buffer.length);
  
            const result = await mammoth.convertToHtml({ buffer });
            console.log("✅ Converted to HTML:", file.Key);
  
            return { key: file.Key, html: result.value || "<p>No content</p>" };
          } catch (fileErr) {
            console.error(`❌ Error processing file ${file.Key}:`, fileErr);
            return { key: file.Key, html: "<p>Error reading file</p>" };
          }
        })
      );
  
      res.json(fileList);
    } catch (err) {
      console.error("🔥 Backend failed in /experiences:", err);
      res.status(500).json({
        error: "Failed to fetch experiences",
        details: err.message,
      });
    }
  });
  

export default router;

