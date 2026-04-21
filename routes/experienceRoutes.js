import express from "express";
import authJWT from "../middleware/authJWT.js";

const router = express.Router();

/** Legacy route: previously served DOCX from S3. No backing store — return empty list. */
router.get("/", authJWT, async (req, res) => {
  res.json([]);
});

export default router;
