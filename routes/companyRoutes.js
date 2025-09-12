import express from "express";
import Company from "../models/Company.js"
const companyRouter = express.Router();
import { userAuth } from "../middlewares/auth.js";
import dotenv from 'dotenv';
dotenv.config();





companyRouter.post("/api/companies", userAuth , async (req, res) => {
    try {
      
        
      const company = await Company.create(req.body);
      console.log("✅ New company created");
      return res.status(201).json(company);
    } catch (e) {
      console.error("❌ Error creating company:", e.message);
      return res.status(400).json({ error: e.message });
    }
  });



  companyRouter.get("/api/companies", userAuth ,async (req, res) => {
    try {
  
      const companies = await Company.find({}, "name type eligibility roles count business_model date_of_visit");
      
      return res.json(companies);
    } catch (e) {
      console.error("❌ Error fetching companies:", e.message);
      return res.status(500).json({ error: "Server error" });
    }
  });




  companyRouter.get("/api/companies/:id", userAuth , async (req, res) => {
    try {
      const company = await Company.findById(req.params.id);
      if (!company) {
        return res.status(404).json({ error: "Company not found" });
      }
      return res.json(company);
    } catch (e) {
      console.error("❌ Error fetching company:", e.message);
      return res.status(400).json({ error: "Invalid company ID" });
    }
  });


export default companyRouter;