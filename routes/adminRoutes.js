import express from "express";
import requireAdmin from "../middleware/requireAdmin.js";
import User from "../models/User.js";
import Submission from "../models/Submission.js";
import Company from "../models/Company.js";
import Notification from "../models/Notification.js";

const adminRouter = express.Router();

// All admin routes require admin authentication
adminRouter.use(requireAdmin);

// Sanitize text for company content (remove script tags; keep other text as-is)
function sanitizeText(text) {
  if (text === undefined || text === null) return '';
  let str = String(text);
  // Strip out any script tags and their contents completely
  str = str.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  return str.trim();
}

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
        // Initialize arrays if they don't exist
        if (!company.interviewQuestions) {
          company.interviewQuestions = [];
        }
        if (!company.interviewQuestions_solution) {
          company.interviewQuestions_solution = [];
        }
        const ensureSolutionArraySync = () => {
          while (company.interviewQuestions_solution.length < company.interviewQuestions.length) {
            company.interviewQuestions_solution.push("");
          }
        };
        
        const sanitizedQuestion = sanitizeText(questionText);
        
        if (sanitizedQuestion.length > 0) {
          const existingIndex = company.interviewQuestions.findIndex(
            (q) => typeof q === "string" && q.trim() === sanitizedQuestion.trim()
          );

          const getSanitizedSolution = () => {
            if (!parsedContent.solution) return "";
            return sanitizeText(parsedContent.solution);
          };

          if (existingIndex === -1) {
            company.interviewQuestions.push(sanitizedQuestion);
            company.markModified('interviewQuestions');

            ensureSolutionArraySync();
            const newIndex = company.interviewQuestions.length - 1;

            const sanitizedSolution = getSanitizedSolution();
            company.interviewQuestions_solution[newIndex] = sanitizedSolution || "";
            company.markModified('interviewQuestions_solution');
            
            console.log('✅ Added interview question to company:', company._id);
          } else {
            console.log('ℹ️ Question already exists, updating solution text');
            ensureSolutionArraySync();
            const sanitizedSolution = getSanitizedSolution();
            if (sanitizedSolution) {
              const existingSolution = company.interviewQuestions_solution[existingIndex] || "";
              const combined = existingSolution
                ? `${existingSolution}\n\n${sanitizedSolution}`
                : sanitizedSolution;
              company.interviewQuestions_solution[existingIndex] = combined;
              company.markModified('interviewQuestions_solution');
            } else if (
              !company.interviewQuestions_solution[existingIndex] ||
              typeof company.interviewQuestions_solution[existingIndex] !== "string"
            ) {
              company.interviewQuestions_solution[existingIndex] = "";
              company.markModified('interviewQuestions_solution');
            }
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
          
          // Check if this process already exists (compare content)
          // Handle both legacy string format and new JSON string format
          const processExists = company.interviewProcess.some(process => {
            try {
              // Try to parse as JSON (new format with metadata)
              const parsed = JSON.parse(process);
              if (parsed && typeof parsed === 'object' && parsed.content) {
                return parsed.content === sanitizedProcess;
              }
            } catch {
              // Not JSON, treat as legacy string
            }
            // Legacy string format - direct comparison
            return process === sanitizedProcess;
          });
          
          if (!processExists) {
            // Store as JSON string to preserve submitter info while keeping String type in schema
            const processEntry = JSON.stringify({
              content: sanitizedProcess,
              submittedBy: {
                name: submission.submittedBy.name,
                email: submission.submittedBy.email
              },
              isAnonymous: submission.isAnonymous === true || submission.isAnonymous === 'true'
            });
            company.interviewProcess.push(processEntry);
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
    if (company.interviewQuestions_solution) {
      company.interviewQuestions_solution = company.interviewQuestions_solution.map((s) => sanitizeText(s));
      company.markModified('interviewQuestions_solution');
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

    // Award leaderboard points: question = 5, interview experience = 10
    const POINTS_QUESTION = 5;
    const POINTS_INTERVIEW_EXPERIENCE = 10;
    const pointsToAdd =
      submission.type === "interviewProcess"
        ? POINTS_INTERVIEW_EXPERIENCE
        : POINTS_QUESTION; // onlineQuestions, interviewQuestions, mustDoTopics

    const contributor = await User.findOne({ email: submission.submittedBy?.email });
    if (contributor) {
      contributor.points = (contributor.points || 0) + pointsToAdd;
      await contributor.save();
    }

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
    // Save will trigger the post-save hook which creates notifications
    await company.save();

    res.json({ 
      message: "Company approved successfully",
      company: company
    });
  } catch (error) {
    console.error("❌ Error approving company:", error.message);
    console.error("❌ Error stack:", error.stack);
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

// Delete approved company (remove it from database)
adminRouter.delete("/companies/:id/delete", async (req, res) => {
  try {
    const company = await Company.findById(req.params.id);
    
    if (!company) {
      return res.status(404).json({ error: "Company not found" });
    }

    if (company.status !== 'approved') {
      return res.status(400).json({ error: "Only approved companies can be deleted using this endpoint" });
    }

    await Company.findByIdAndDelete(req.params.id);

    res.json({ message: "Approved company deleted successfully" });
  } catch (error) {
    console.error("❌ Error deleting approved company:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

// ---------- Admin edit/delete OA questions, interview questions, interview process ----------
adminRouter.put("/companies/:id/oa-questions/:index", async (req, res) => {
  try {
    const company = await Company.findById(req.params.id);
    if (!company) return res.status(404).json({ error: "Company not found" });
    const index = parseInt(req.params.index, 10);
    if (isNaN(index) || index < 0) return res.status(400).json({ error: "Invalid index" });
    const { question, solution } = req.body || {};
    if (!company.onlineQuestions || index >= company.onlineQuestions.length)
      return res.status(404).json({ error: "Question not found" });
    if (question !== undefined && question !== null) {
      company.onlineQuestions[index] = sanitizeText(question);
      company.markModified("onlineQuestions");
    }
    if (company.onlineQuestions_solution) {
      while (company.onlineQuestions_solution.length < company.onlineQuestions.length)
        company.onlineQuestions_solution.push("");
      if (solution !== undefined && solution !== null) {
        company.onlineQuestions_solution[index] = sanitizeText(solution);
        company.markModified("onlineQuestions_solution");
      }
    }
    await company.save();
    res.json({ message: "OA question updated", company });
  } catch (error) {
    console.error("❌ Error updating OA question:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

adminRouter.delete("/companies/:id/oa-questions/:index", async (req, res) => {
  try {
    const company = await Company.findById(req.params.id);
    if (!company) return res.status(404).json({ error: "Company not found" });
    const index = parseInt(req.params.index, 10);
    if (isNaN(index) || index < 0) return res.status(400).json({ error: "Invalid index" });
    if (!company.onlineQuestions || index >= company.onlineQuestions.length)
      return res.status(404).json({ error: "Question not found" });
    company.onlineQuestions.splice(index, 1);
    if (company.onlineQuestions_solution && index < company.onlineQuestions_solution.length)
      company.onlineQuestions_solution.splice(index, 1);
    company.markModified("onlineQuestions");
    if (company.onlineQuestions_solution) company.markModified("onlineQuestions_solution");
    await company.save();
    res.json({ message: "OA question deleted", company });
  } catch (error) {
    console.error("❌ Error deleting OA question:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

adminRouter.put("/companies/:id/interview-questions/:index", async (req, res) => {
  try {
    const company = await Company.findById(req.params.id);
    if (!company) return res.status(404).json({ error: "Company not found" });
    const index = parseInt(req.params.index, 10);
    if (isNaN(index) || index < 0) return res.status(400).json({ error: "Invalid index" });
    const { question, solution } = req.body || {};
    if (!company.interviewQuestions || index >= company.interviewQuestions.length)
      return res.status(404).json({ error: "Question not found" });
    if (question !== undefined && question !== null) {
      company.interviewQuestions[index] = sanitizeText(question);
      company.markModified("interviewQuestions");
    }
    if (company.interviewQuestions_solution) {
      while (company.interviewQuestions_solution.length < company.interviewQuestions.length)
        company.interviewQuestions_solution.push("");
      if (solution !== undefined && solution !== null) {
        company.interviewQuestions_solution[index] = sanitizeText(solution);
        company.markModified("interviewQuestions_solution");
      }
    }
    await company.save();
    res.json({ message: "Interview question updated", company });
  } catch (error) {
    console.error("❌ Error updating interview question:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

adminRouter.delete("/companies/:id/interview-questions/:index", async (req, res) => {
  try {
    const company = await Company.findById(req.params.id);
    if (!company) return res.status(404).json({ error: "Company not found" });
    const index = parseInt(req.params.index, 10);
    if (isNaN(index) || index < 0) return res.status(400).json({ error: "Invalid index" });
    if (!company.interviewQuestions || index >= company.interviewQuestions.length)
      return res.status(404).json({ error: "Question not found" });
    company.interviewQuestions.splice(index, 1);
    if (company.interviewQuestions_solution && index < company.interviewQuestions_solution.length)
      company.interviewQuestions_solution.splice(index, 1);
    company.markModified("interviewQuestions");
    if (company.interviewQuestions_solution) company.markModified("interviewQuestions_solution");
    await company.save();
    res.json({ message: "Interview question deleted", company });
  } catch (error) {
    console.error("❌ Error deleting interview question:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

adminRouter.put("/companies/:id/interview-process/:index", async (req, res) => {
  try {
    const company = await Company.findById(req.params.id);
    if (!company) return res.status(404).json({ error: "Company not found" });
    const index = parseInt(req.params.index, 10);
    if (isNaN(index) || index < 0) return res.status(400).json({ error: "Invalid index" });
    const arr = company.interviewProcess && Array.isArray(company.interviewProcess) ? company.interviewProcess : [];
    if (index >= arr.length) return res.status(404).json({ error: "Entry not found" });
    const { content } = req.body || {};
    if (content === undefined || content === null) return res.status(400).json({ error: "content required" });
    const sanitized = sanitizeText(content);
    let newEntry = arr[index];
    try {
      const parsed = typeof newEntry === "string" ? JSON.parse(newEntry) : {};
      if (parsed && typeof parsed === "object") {
        newEntry = JSON.stringify({ ...parsed, content: sanitized });
      } else newEntry = sanitized;
    } catch {
      newEntry = sanitized;
    }
    company.interviewProcess[index] = newEntry;
    company.markModified("interviewProcess");
    await company.save();
    res.json({ message: "Interview process updated", company });
  } catch (error) {
    console.error("❌ Error updating interview process:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

adminRouter.delete("/companies/:id/interview-process/:index", async (req, res) => {
  try {
    const company = await Company.findById(req.params.id);
    if (!company) return res.status(404).json({ error: "Company not found" });
    const index = parseInt(req.params.index, 10);
    if (isNaN(index) || index < 0) return res.status(400).json({ error: "Invalid index" });
    if (!company.interviewProcess || !Array.isArray(company.interviewProcess) || index >= company.interviewProcess.length)
      return res.status(404).json({ error: "Entry not found" });
    company.interviewProcess.splice(index, 1);
    company.markModified("interviewProcess");
    await company.save();
    res.json({ message: "Interview process entry deleted", company });
  } catch (error) {
    console.error("❌ Error deleting interview process:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

// PUT /api/admin/companies/:id/stats - update placement stats (admin only)
adminRouter.put("/companies/:id/stats", async (req, res) => {
  try {
    const company = await Company.findById(req.params.id);
    if (!company) return res.status(404).json({ error: "Company not found" });
    const { totalStudentsApplied, totalClearedOA, totalGotIn } = req.body || {};
    if (totalStudentsApplied !== undefined) {
      const n = parseInt(totalStudentsApplied, 10);
      if (isNaN(n) || n < 0) return res.status(400).json({ error: "totalStudentsApplied must be a non-negative number" });
      company.totalStudentsApplied = n;
    }
    if (totalClearedOA !== undefined) {
      const n = parseInt(totalClearedOA, 10);
      if (isNaN(n) || n < 0) return res.status(400).json({ error: "totalClearedOA must be a non-negative number" });
      company.totalClearedOA = n;
    }
    if (totalGotIn !== undefined) {
      const n = parseInt(totalGotIn, 10);
      if (isNaN(n) || n < 0) return res.status(400).json({ error: "totalGotIn must be a non-negative number" });
      company.totalGotIn = n;
    }
    company.markModified("totalStudentsApplied");
    company.markModified("totalClearedOA");
    company.markModified("totalGotIn");
    await company.save();
    res.json({ message: "Stats updated", company });
  } catch (error) {
    console.error("❌ Error updating company stats:", error.message);
    res.status(500).json({ error: "Server error" });
  }
});

// PUT /api/admin/companies/:id/roles - replace roles & CTC details (admin only)
adminRouter.put("/companies/:id/roles", async (req, res) => {
  try {
    const { roles } = req.body || {};
    if (!Array.isArray(roles)) {
      return res.status(400).json({ error: "roles must be an array" });
    }

    const normalizedRoles = roles.map((role, index) => {
      const rawName = role?.roleName ?? role?.name ?? "";
      const roleName = sanitizeText(rawName);
      if (!roleName) {
        throw new Error(`Role at index ${index} is missing a valid roleName`);
      }

      const internshipStipend =
        role.internshipStipend !== undefined && role.internshipStipend !== null
          ? Number(role.internshipStipend)
          : undefined;
      if (
        internshipStipend !== undefined &&
        (Number.isNaN(internshipStipend) || internshipStipend < 0)
      ) {
        throw new Error(
          `Role "${roleName}": internshipStipend must be a non‑negative number`
        );
      }

      const rawCtc = role.ctc && typeof role.ctc === "object" ? role.ctc : {};
      const ctc = {};
      Object.entries(rawCtc).forEach(([key, value]) => {
        if (value === null || value === undefined || value === "") {
          return;
        }
        const cleanKey = sanitizeText(key);
        if (!cleanKey) return;
        // Allow both numeric and string CTC components (backend schema uses Mixed)
        const numeric = Number(value);
        // If it's a valid non‑NaN number, store as number; otherwise keep as trimmed string
        ctc[cleanKey] = Number.isNaN(numeric)
          ? String(value).trim()
          : numeric;
      });

      return {
        roleName,
        ctc,
        ...(internshipStipend !== undefined ? { internshipStipend } : {}),
      };
    });

    const company = await Company.findByIdAndUpdate(
      req.params.id,
      { roles: normalizedRoles },
      { new: true, runValidators: true }
    );

    if (!company) {
      return res.status(404).json({ error: "Company not found" });
    }

    // Convert Map -> plain object for each role before sending back
    const rolesResponse = (company.roles || []).map((role) => ({
      ...(role.toObject ? role.toObject() : role),
      ctc:
        role.ctc instanceof Map
          ? Object.fromEntries(role.ctc)
          : role.ctc || {},
    }));

    res.json({ message: "Roles updated", roles: rolesResponse });
  } catch (error) {
    console.error("❌ Error updating company roles:", error.message);
    res.status(500).json({ error: "Server error", details: error.message });
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

// Delete approved submission (remove it from database)
adminRouter.delete("/submissions/:id/delete", async (req, res) => {
  try {
    const submission = await Submission.findById(req.params.id);
    
    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    if (submission.status !== 'approved') {
      return res.status(400).json({ error: "Only approved submissions can be deleted using this endpoint" });
    }

    // Delete the submission
    await Submission.findByIdAndDelete(req.params.id);
    
    console.log('✅ Approved submission deleted:', req.params.id);
    
    res.json({ 
      message: "Approved submission deleted successfully"
    });
  } catch (error) {
    console.error('❌ Error deleting approved submission:', error);
    res.status(500).json({ 
      error: "Server error", 
      details: error.message
    });
  }
});

export default adminRouter;

