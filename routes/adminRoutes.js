import express from "express";
import requireAdmin from "../middleware/requireAdmin.js";
import User from "../models/User.js";
import Submission from "../models/Submission.js";
import Company from "../models/Company.js";

const adminRouter = express.Router();

// All admin routes require admin authentication
adminRouter.use(requireAdmin);

// Get total number of users
adminRouter.get("/stats/users", async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    res.json({ totalUsers });
  } catch (error) {
    console.error("❌ Error fetching user count:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

// Get all submissions
adminRouter.get("/submissions", async (req, res) => {
  try {
    const submissions = await Submission.find()
      .populate("companyId", "name")
      .sort({ submittedAt: -1 });
    
    res.json(submissions);
  } catch (error) {
    console.error("❌ Error fetching submissions:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

// Get dashboard stats
adminRouter.get("/stats", async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const totalSubmissions = await Submission.countDocuments();
    const totalCompanies = await Company.countDocuments({ status: "approved" });
    const pendingCompanies = await Company.countDocuments({ status: "pending" });
    
    res.json({
      totalUsers,
      totalSubmissions,
      totalCompanies,
      pendingCompanies,
    });
  } catch (error) {
    console.error("❌ Error fetching dashboard stats:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

// Approve submission and update company
adminRouter.post("/submissions/:id/approve", async (req, res) => {
  try {
    const submission = await Submission.findById(req.params.id);
    
    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    const company = await Company.findById(submission.companyId);
    
    if (!company) {
      return res.status(404).json({ error: "Company not found" });
    }

    // Parse submission content
    let parsedContent;
    try {
      parsedContent = JSON.parse(submission.content);
    } catch {
      parsedContent = { question: submission.content, solution: "" };
    }

    // Helper function to truncate text to max length (strictly enforce limit)
    const truncateText = (text, maxLength) => {
      if (!text || typeof text !== 'string') return '';
      // Convert to string, trim, then truncate
      const trimmed = String(text).trim();
      if (trimmed.length <= maxLength) return trimmed;
      // Truncate to maxLength, then trim again to remove any partial words/whitespace
      return trimmed.substring(0, maxLength).trim();
    };

    // Update company based on submission type
    if (submission.type === "onlineQuestions") {
      // Ensure we get a string value
      let questionText = parsedContent.question || submission.content;
      if (questionText && typeof questionText !== 'string') {
        questionText = String(questionText);
      }
      if (questionText) {
        // Initialize arrays if they don't exist
        if (!company.onlineQuestions) {
          company.onlineQuestions = [];
        }
        if (!company.onlineQuestion_solution) {
          company.onlineQuestion_solution = [];
        }
        
        // Truncate question to max length (500 characters) - be very strict
        let truncatedQuestion = truncateText(questionText, 500);
        
        // Final safety check: ensure it's exactly 500 or less
        if (truncatedQuestion && truncatedQuestion.length > 500) {
          truncatedQuestion = truncatedQuestion.slice(0, 500).trim();
        }
        
        // Double-check length before adding (should never exceed 500)
        if (truncatedQuestion && truncatedQuestion.length <= 500) {
          // Only add if question doesn't already exist
          if (!company.onlineQuestions.includes(truncatedQuestion)) {
            company.onlineQuestions.push(truncatedQuestion);
            // Mark array as modified for Mongoose
            company.markModified('onlineQuestions');
            
            // If solution exists, truncate and add to onlineQuestion_solution
            if (parsedContent.solution) {
              let truncatedSolution = truncateText(parsedContent.solution, 500);
              // Final safety check
              if (truncatedSolution.length > 500) {
                truncatedSolution = truncatedSolution.slice(0, 500).trim();
              }
              // Ensure solution also doesn't exceed limit
              if (truncatedSolution.length <= 500) {
                company.onlineQuestion_solution.push(truncatedSolution);
              } else {
                // Last resort: force to 500
                company.onlineQuestion_solution.push(truncatedSolution.slice(0, 500));
              }
            } else {
              // Add empty string to maintain array alignment
              company.onlineQuestion_solution.push("");
            }
            // Mark solution array as modified for Mongoose
            company.markModified('onlineQuestion_solution');
            
            console.log('✅ Added online question to company:', company._id);
          } else {
            console.log('⚠️ Question already exists in company');
          }
        } else {
          console.warn(`Question truncated but still exceeds limit: ${truncatedQuestion?.length || 0} chars`);
        }
      }
    } else if (submission.type === "interviewQuestions") {
      // Ensure we get a string value
      let questionText = parsedContent.question || submission.content;
      if (questionText && typeof questionText !== 'string') {
        questionText = String(questionText);
      }
      if (questionText) {
        // Initialize array if it doesn't exist
        if (!company.interviewQuestions) {
          company.interviewQuestions = [];
        }
        
        // Truncate question to max length (500 characters)
        const truncatedQuestion = truncateText(questionText, 500);
        
        // Double-check length before adding
        if (truncatedQuestion && truncatedQuestion.length <= 500) {
          // Only add if question doesn't already exist
          if (!company.interviewQuestions.includes(truncatedQuestion)) {
            company.interviewQuestions.push(truncatedQuestion);
            // Mark array as modified for Mongoose
            company.markModified('interviewQuestions');
            console.log('✅ Added interview question to company:', company._id);
          } else {
            console.log('⚠️ Interview question already exists in company');
          }
        }
      }
    } else if (submission.type === "interviewProcess") {
      // Ensure we get a string value
      let processText = parsedContent.question || parsedContent.content || submission.content;
      if (processText && typeof processText !== 'string') {
        processText = String(processText);
      }
      if (processText) {
        // Truncate interview process to max length (500 characters)
        const truncatedProcess = truncateText(processText, 500);
        
        if (truncatedProcess && truncatedProcess.length <= 500) {
          // If there's existing content, try to append, but ensure total doesn't exceed 500
          if (company.interviewProcess) {
            const separator = "\n\n";
            const combined = `${company.interviewProcess}${separator}${truncatedProcess}`;
            // If combined exceeds 500, just replace with new content
            const finalProcess = combined.length > 500 
              ? truncatedProcess 
              : truncateText(combined, 500);
            // Final safety check
            company.interviewProcess = finalProcess.length <= 500 ? finalProcess : finalProcess.substring(0, 500).trim();
          } else {
            company.interviewProcess = truncatedProcess;
          }
          console.log('✅ Updated interview process for company:', company._id);
        }
      }
    }

    // Final validation: ensure all array values don't exceed 500 characters
    if (company.onlineQuestions) {
      company.onlineQuestions = company.onlineQuestions.map(q => {
        if (typeof q === 'string' && q.length > 500) {
          return q.slice(0, 500).trim();
        }
        return q;
      });
      // Mark array as modified for Mongoose
      company.markModified('onlineQuestions');
    }
    if (company.onlineQuestion_solution) {
      company.onlineQuestion_solution = company.onlineQuestion_solution.map(s => {
        if (typeof s === 'string' && s.length > 500) {
          return s.slice(0, 500).trim();
        }
        return s;
      });
      // Mark array as modified for Mongoose
      company.markModified('onlineQuestion_solution');
    }
    if (company.interviewQuestions) {
      company.interviewQuestions = company.interviewQuestions.map(q => {
        if (typeof q === 'string' && q.length > 500) {
          return q.slice(0, 500).trim();
        }
        return q;
      });
      // Mark array as modified for Mongoose
      company.markModified('interviewQuestions');
    }
    if (company.interviewProcess && typeof company.interviewProcess === 'string' && company.interviewProcess.length > 500) {
      company.interviewProcess = company.interviewProcess.slice(0, 500).trim();
    }

    // Save the company and check for errors
    try {
      const savedCompany = await company.save();
      console.log('✅ Company updated successfully:', savedCompany._id);
      console.log('Updated fields:', {
        onlineQuestions: savedCompany.onlineQuestions?.length || 0,
        interviewQuestions: savedCompany.interviewQuestions?.length || 0,
        interviewProcess: savedCompany.interviewProcess ? 'updated' : 'not updated'
      });
    } catch (saveError) {
      console.error('❌ Error saving company:', saveError);
      throw saveError;
    }

    // Optionally delete the submission after approval
    await Submission.findByIdAndDelete(req.params.id);

    res.json({ 
      message: "Submission approved and company updated successfully",
      company: company 
    });
  } catch (error) {
    console.error("❌ Error approving submission:", error.message);
    res.status(500).json({ error: "Server error", details: error.message });
  }
});

export default adminRouter;

