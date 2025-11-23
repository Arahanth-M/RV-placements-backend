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

// Get all submissions (with optional status filter)
adminRouter.get("/submissions", async (req, res) => {
  try {
    const { status } = req.query;
    const query = status ? { status } : {};
    
    const submissions = await Submission.find(query)
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
    const pendingSubmissions = await Submission.countDocuments({ status: "pending" });
    const approvedSubmissions = await Submission.countDocuments({ status: "approved" });
    const totalCompanies = await Company.countDocuments({ status: "approved" });
    const pendingCompanies = await Company.countDocuments({ status: "pending" });
    
    res.json({
      totalUsers,
      totalSubmissions,
      pendingSubmissions,
      approvedSubmissions,
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

    // Legacy support: if old field onlineQuestion_solution exists, migrate it
    const removeLegacySolutionField = () => {
      const legacyKeys = ["onlineQuestion_solution", "onlineQuestion_solutions"];
      legacyKeys.forEach((key) => {
        if (typeof company.set === "function") {
          company.set(key, undefined, { strict: false });
        }
        if (company._doc && Object.prototype.hasOwnProperty.call(company._doc, key)) {
          delete company._doc[key];
        }
      });
    };

    const legacySolutions = company.get?.("onlineQuestion_solution");
    if (
      (!company.onlineQuestions_solution || company.onlineQuestions_solution.length === 0) &&
      Array.isArray(legacySolutions) &&
      legacySolutions.length > 0
    ) {
      company.onlineQuestions_solution = legacySolutions;
      company.markModified("onlineQuestions_solution");
    }
    // Always remove the legacy field (even if empty) to prevent new writes
    removeLegacySolutionField();

    // Parse submission content
    let parsedContent;
    try {
      parsedContent = JSON.parse(submission.content);
    } catch {
      parsedContent = { question: submission.content, solution: "" };
    }

    // Helper function to sanitize text (remove script tags and dangerous HTML)
    const sanitizeText = (text) => {
      if (text === undefined || text === null) return '';
      let str = String(text);
      // Remove script tags
      str = str.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
      // Remove other potentially dangerous HTML tags
      str = str.replace(/<[^>]+>/g, '');
      return str.trim();
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
        if (!company.onlineQuestions_solution) {
          company.onlineQuestions_solution = [];
        }
        const ensureSolutionArraySync = () => {
          while (company.onlineQuestions_solution.length < company.onlineQuestions.length) {
            company.onlineQuestions_solution.push("");
          }
        };
        
        const sanitizedQuestion = sanitizeText(questionText);
        
        if (sanitizedQuestion.length > 0) {
          const existingIndex = company.onlineQuestions.findIndex(
            (q) => typeof q === "string" && q.trim() === sanitizedQuestion.trim()
          );

          const getSanitizedSolution = () => {
            if (!parsedContent.solution) return "";
            return sanitizeText(parsedContent.solution);
          };

          if (existingIndex === -1) {
            company.onlineQuestions.push(sanitizedQuestion);
            company.markModified('onlineQuestions');

            ensureSolutionArraySync();
            const newIndex = company.onlineQuestions.length - 1;

            const sanitizedSolution = getSanitizedSolution();
            company.onlineQuestions_solution[newIndex] = sanitizedSolution || "";
            company.markModified('onlineQuestions_solution');
            
            console.log('✅ Added online question to company:', company._id);
          } else {
            console.log('ℹ️ Question already exists, updating solution text');
            ensureSolutionArraySync();
            const sanitizedSolution = getSanitizedSolution();
            if (sanitizedSolution) {
              const existingSolution = company.onlineQuestions_solution[existingIndex] || "";
              const combined = existingSolution
                ? `${existingSolution}\n\n${sanitizedSolution}`
                : sanitizedSolution;
              company.onlineQuestions_solution[existingIndex] = combined;
              company.markModified('onlineQuestions_solution');
            } else if (
              !company.onlineQuestions_solution[existingIndex] ||
              typeof company.onlineQuestions_solution[existingIndex] !== "string"
            ) {
              company.onlineQuestions_solution[existingIndex] = "";
              company.markModified('onlineQuestions_solution');
            }
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
        
        const sanitizedQuestion = sanitizeText(questionText);
        
        if (sanitizedQuestion.length > 0) {
          if (!company.interviewQuestions.includes(sanitizedQuestion)) {
            company.interviewQuestions.push(sanitizedQuestion);
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
        const sanitizedProcess = sanitizeText(processText);
        if (sanitizedProcess.length > 0) {
          // Initialize array if it doesn't exist
          if (!company.interviewProcess || !Array.isArray(company.interviewProcess)) {
            company.interviewProcess = [];
          }
          
          // Append the new process to the array (avoid duplicates)
          if (!company.interviewProcess.includes(sanitizedProcess)) {
            company.interviewProcess.push(sanitizedProcess);
            company.markModified('interviewProcess');
            console.log('✅ Added interview process to company:', company._id);
          } else {
            console.log('⚠️ Interview process already exists in company');
          }
        }
      }
    } else if (submission.type === "mustDoTopics") {
      // Ensure we get a string value
      let topicText = parsedContent.question || parsedContent.content || parsedContent.topic || submission.content;
      if (topicText && typeof topicText !== 'string') {
        topicText = String(topicText);
      }
      if (topicText) {
        const sanitizedTopic = sanitizeText(topicText);
        if (sanitizedTopic.length > 0) {
          // Initialize array if it doesn't exist
          if (!company.Must_Do_Topics || !Array.isArray(company.Must_Do_Topics)) {
            company.Must_Do_Topics = [];
          }
          
          // Append the new topic to the array (avoid duplicates)
          if (!company.Must_Do_Topics.includes(sanitizedTopic)) {
            company.Must_Do_Topics.push(sanitizedTopic);
            company.markModified('Must_Do_Topics');
            console.log('✅ Added must do topic to company:', company._id);
          } else {
            console.log('⚠️ Must do topic already exists in company');
          }
        }
      }
    }

    // Final validation: ensure all array values don't exceed their max lengths
    // Also filter out empty strings that might cause validation issues
    if (company.onlineQuestions) {
      company.onlineQuestions = company.onlineQuestions
        .map((q) => sanitizeText(q))
        .filter((q) => q && q.length > 0);
      company.markModified('onlineQuestions');
    }
    if (company.onlineQuestions_solution) {
      company.onlineQuestions_solution = company.onlineQuestions_solution.map((s) => sanitizeText(s));
      company.markModified('onlineQuestions_solution');
    }
    if (company.interviewQuestions) {
      company.interviewQuestions = company.interviewQuestions
        .map((q) => sanitizeText(q))
        .filter((q) => q && q.length > 0);
      company.markModified('interviewQuestions');
    }
    if (company.interviewProcess) {
      // Handle both array and legacy string format
      if (Array.isArray(company.interviewProcess)) {
        company.interviewProcess = company.interviewProcess
          .map((p) => sanitizeText(p))
          .filter((p) => p && p.length > 0);
        company.markModified('interviewProcess');
      } else if (typeof company.interviewProcess === 'string') {
        // Convert legacy string to array
        const sanitized = sanitizeText(company.interviewProcess);
        if (sanitized && sanitized.length > 0) {
          company.interviewProcess = [sanitized];
          company.markModified('interviewProcess');
        }
      }
    }
    
    // Truncate Must_Do_Topics to max 200 characters
    if (company.Must_Do_Topics && Array.isArray(company.Must_Do_Topics)) {
      company.Must_Do_Topics = company.Must_Do_Topics.map(topic => {
        if (typeof topic === 'string' && topic.length > 200) {
          return topic.substring(0, 200);
        }
        return topic || '';
      }).filter(topic => topic && topic.trim().length > 0);
      company.markModified('Must_Do_Topics');
    }
    
    // Truncate mcqQuestions fields to their max lengths
    // Convert to plain objects first to ensure Mongoose recognizes changes
    if (company.mcqQuestions && Array.isArray(company.mcqQuestions)) {
      company.mcqQuestions = company.mcqQuestions.map((mcq, index) => {
        if (!mcq || typeof mcq !== 'object') return mcq;
        
        // Convert to plain object if it's a Mongoose subdocument
        const plainMcq = mcq.toObject ? mcq.toObject() : { ...mcq };
        const truncatedMcq = {};
        
        // Copy all fields first
        Object.keys(plainMcq).forEach(key => {
          truncatedMcq[key] = plainMcq[key];
        });
        
        // Question max 300
        if (typeof truncatedMcq.question === 'string') {
          if (truncatedMcq.question.length > 300) {
            console.log(`⚠️ Truncating mcqQuestions[${index}].question from ${truncatedMcq.question.length} to 300`);
            truncatedMcq.question = truncatedMcq.question.substring(0, 300);
          }
        }
        
        // Options max 100 each
        ['optionA', 'optionB', 'optionC', 'optionD', 'answer'].forEach(field => {
          if (typeof truncatedMcq[field] === 'string') {
            if (truncatedMcq[field].length > 100) {
              console.log(`⚠️ Truncating mcqQuestions[${index}].${field} from ${truncatedMcq[field].length} to 100`);
              truncatedMcq[field] = truncatedMcq[field].substring(0, 100);
            }
          }
        });
        
        // Final safety check - ensure no field exceeds limits
        if (truncatedMcq.question && truncatedMcq.question.length > 300) {
          truncatedMcq.question = truncatedMcq.question.substring(0, 300);
        }
        ['optionA', 'optionB', 'optionC', 'optionD', 'answer'].forEach(field => {
          if (truncatedMcq[field] && truncatedMcq[field].length > 100) {
            truncatedMcq[field] = truncatedMcq[field].substring(0, 100);
          }
        });
        
        return truncatedMcq;
      });
      
      // Mark as modified
      company.markModified('mcqQuestions');
      
      // Final verification pass - double check all lengths
      company.mcqQuestions.forEach((mcq, index) => {
        if (mcq && typeof mcq === 'object') {
          if (mcq.question && typeof mcq.question === 'string' && mcq.question.length > 300) {
            console.error(`❌ FINAL CHECK FAILED: mcqQuestions[${index}].question still ${mcq.question.length} chars`);
            mcq.question = mcq.question.substring(0, 300);
          }
          ['optionA', 'optionB', 'optionC', 'optionD', 'answer'].forEach(field => {
            if (mcq[field] && typeof mcq[field] === 'string' && mcq[field].length > 100) {
              console.error(`❌ FINAL CHECK FAILED: mcqQuestions[${index}].${field} still ${mcq[field].length} chars`);
              mcq[field] = mcq[field].substring(0, 100);
            }
          });
        }
      });
      
      // Mark again after final verification
      company.markModified('mcqQuestions');
    }
    
    // Truncate other string fields with maxlength constraints
    if (company.eligibility && typeof company.eligibility === 'string' && company.eligibility.length > 500) {
      company.eligibility = company.eligibility.substring(0, 500);
    }
    if (company.business_model && typeof company.business_model === 'string' && company.business_model.length > 100) {
      company.business_model = company.business_model.substring(0, 100);
    }
    
    // Truncate jobDescription fields
    if (company.jobDescription && Array.isArray(company.jobDescription)) {
      company.jobDescription = company.jobDescription.map(jd => {
        if (jd && typeof jd === 'object') {
          const truncatedJd = { ...jd };
          // Title max 100
          if (typeof truncatedJd.title === 'string' && truncatedJd.title.length > 100) {
            truncatedJd.title = truncatedJd.title.substring(0, 100);
          }
          return truncatedJd;
        }
        return jd;
      });
      company.markModified('jobDescription');
    }

    // Save the company and check for errors
    try {
      // Log current state before save for debugging
      console.log('📊 Company data before save:');
      if (company.mcqQuestions) {
        company.mcqQuestions.forEach((mcq, idx) => {
          if (mcq && typeof mcq === 'object') {
            console.log(`  mcqQuestions[${idx}]:`, {
              questionLength: mcq.question?.length || 0,
              optionALength: mcq.optionA?.length || 0,
              optionBLength: mcq.optionB?.length || 0,
              optionCLength: mcq.optionC?.length || 0,
              optionDLength: mcq.optionD?.length || 0,
            });
          }
        });
      }
      
      // Use validateBeforeSave: true to ensure validation runs
      const savedCompany = await company.save({ validateBeforeSave: true });
      console.log('✅ Company updated successfully:', savedCompany._id);
      console.log('Updated fields:', {
        onlineQuestions: savedCompany.onlineQuestions?.length || 0,
        interviewQuestions: savedCompany.interviewQuestions?.length || 0,
        interviewProcess: savedCompany.interviewProcess ? 'updated' : 'not updated'
      });
    } catch (saveError) {
      console.error('❌ Error saving company:', saveError);
      console.error('❌ Error details:', {
        name: saveError.name,
        message: saveError.message,
        errors: saveError.errors
      });
      
      // Log each validation error individually
      if (saveError.errors) {
        Object.keys(saveError.errors).forEach(key => {
          console.error(`❌ Validation error for ${key}:`, saveError.errors[key].message);
        });
      }
      
      // Return more detailed error information
      if (saveError.name === 'ValidationError') {
        const errors = {};
        Object.keys(saveError.errors || {}).forEach(key => {
          errors[key] = saveError.errors[key].message;
        });
        return res.status(400).json({ 
          error: "Validation failed", 
          details: errors,
          message: saveError.message 
        });
      }
      
      throw saveError;
    }

    // Mark submission as approved instead of deleting
    submission.status = "approved";
    submission.approvedAt = new Date();
    await submission.save();

    res.json({ 
      message: "Submission approved and company updated successfully",
      company: company,
      submission: submission
    });
  } catch (error) {
    console.error("❌ Error approving submission:", error.message);
    console.error("❌ Full error stack:", error.stack);
    console.error("❌ Error name:", error.name);
    console.error("❌ Error details:", error.errors || error);
    
    // Return more detailed error information
    const statusCode = error.name === 'ValidationError' ? 400 : 500;
    res.status(statusCode).json({ 
      error: "Server error", 
      details: error.message,
      errorName: error.name,
      validationErrors: error.errors || null
    });
  }
});

// Get all companies (with optional status filter)
adminRouter.get("/companies", async (req, res) => {
  try {
    const { status } = req.query;
    const query = status ? { status } : {};
    
    const companies = await Company.find(query)
      .sort({ createdAt: -1 });
    
    res.json(companies);
  } catch (error) {
    console.error("❌ Error fetching companies:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

// Approve a company
adminRouter.post("/companies/:id/approve", async (req, res) => {
  try {
    const company = await Company.findById(req.params.id);
    
    if (!company) {
      return res.status(404).json({ error: "Company not found" });
    }

    company.status = "approved";
    company.approvedAt = new Date();
    await company.save();

    res.json({ 
      message: "Company approved successfully",
      company: company
    });
  } catch (error) {
    console.error("❌ Error approving company:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

// Reject a company (delete it from database)
adminRouter.delete("/companies/:id/reject", async (req, res) => {
  try {
    const company = await Company.findById(req.params.id);
    
    if (!company) {
      return res.status(404).json({ error: "Company not found" });
    }

    await Company.findByIdAndDelete(req.params.id);

    res.json({ message: "Company rejected and deleted successfully" });
  } catch (error) {
    console.error("❌ Error rejecting company:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

// Reject submission (delete it from database)
adminRouter.delete("/submissions/:id/reject", async (req, res) => {
  try {
    const submission = await Submission.findById(req.params.id);
    
    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    // Delete the submission
    await Submission.findByIdAndDelete(req.params.id);
    
    console.log('✅ Submission rejected and deleted:', req.params.id);
    
    res.json({ 
      message: "Submission rejected and deleted successfully"
    });
  } catch (error) {
    console.error('❌ Error rejecting submission:', error);
    res.status(500).json({ 
      error: "Server error", 
      details: error.message
    });
  }
});

export default adminRouter;

