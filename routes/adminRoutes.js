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

    // Helper function to sanitize text (remove script tags and dangerous HTML)
    const sanitizeText = (text) => {
      if (!text) return '';
      let str = String(text);
      // Remove script tags
      str = str.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
      // Remove other potentially dangerous HTML tags
      str = str.replace(/<[^>]+>/g, '');
      return str.trim();
    };

    // Helper function to truncate text to max length (strictly enforce limit)
    const truncateText = (text, maxLength) => {
      if (!text) return '';
      // Sanitize first, then convert to string, trim
      const sanitized = sanitizeText(text);
      const str = String(sanitized).trim();
      if (str.length <= maxLength) return str;
      // Truncate to maxLength exactly (no trim after to avoid going under)
      return str.substring(0, maxLength);
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
        if (truncatedQuestion.length > 500) {
          truncatedQuestion = truncatedQuestion.substring(0, 500);
        }
        
        // Double-check length before adding (should never exceed 500)
        // Also ensure it's not just whitespace after sanitization
        if (truncatedQuestion.length > 0 && truncatedQuestion.length <= 500 && truncatedQuestion.trim().length > 0) {
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
                truncatedSolution = truncatedSolution.substring(0, 500);
              }
              // Ensure solution also doesn't exceed limit
              if (truncatedSolution.length <= 500) {
                company.onlineQuestion_solution.push(truncatedSolution);
              } else {
                // Last resort: force to 500
                company.onlineQuestion_solution.push(truncatedSolution.substring(0, 500));
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
        // Also ensure it's not just whitespace after sanitization
        if (truncatedQuestion.length > 0 && truncatedQuestion.length <= 500 && truncatedQuestion.trim().length > 0) {
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
        
        if (truncatedProcess.length > 0 && truncatedProcess.length <= 500 && truncatedProcess.trim().length > 0) {
          // If there's existing content, try to append, but ensure total doesn't exceed 500
          if (company.interviewProcess) {
            const separator = "\n\n";
            const combined = `${company.interviewProcess}${separator}${truncatedProcess}`;
            // If combined exceeds 500, just replace with new content
            let finalProcess = combined.length > 500 
              ? truncatedProcess 
              : truncateText(combined, 500);
            // Final safety check - ensure it's exactly 500 or less
            if (finalProcess.length > 500) {
              finalProcess = finalProcess.substring(0, 500);
            }
            company.interviewProcess = finalProcess;
          } else {
            company.interviewProcess = truncatedProcess;
          }
          console.log('✅ Updated interview process for company:', company._id);
        }
      }
    }

    // Final validation: ensure all array values don't exceed their max lengths
    // Also filter out empty strings that might cause validation issues
    if (company.onlineQuestions) {
      company.onlineQuestions = company.onlineQuestions
        .map(q => {
          if (typeof q === 'string' && q.length > 500) {
            return q.substring(0, 500);
          }
          return q || '';
        })
        .filter(q => q && q.trim().length > 0); // Remove empty strings
      // Mark array as modified for Mongoose
      company.markModified('onlineQuestions');
    }
    if (company.onlineQuestion_solution) {
      company.onlineQuestion_solution = company.onlineQuestion_solution.map(s => {
        if (typeof s === 'string' && s.length > 500) {
          return s.substring(0, 500);
        }
        return s || '';
      });
      // Mark array as modified for Mongoose
      company.markModified('onlineQuestion_solution');
    }
    if (company.interviewQuestions) {
      company.interviewQuestions = company.interviewQuestions
        .map(q => {
          if (typeof q === 'string' && q.length > 500) {
            return q.substring(0, 500);
          }
          return q || '';
        })
        .filter(q => q && q.trim().length > 0); // Remove empty strings
      // Mark array as modified for Mongoose
      company.markModified('interviewQuestions');
    }
    if (company.interviewProcess && typeof company.interviewProcess === 'string' && company.interviewProcess.length > 500) {
      company.interviewProcess = company.interviewProcess.substring(0, 500);
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

    // Optionally delete the submission after approval
    await Submission.findByIdAndDelete(req.params.id);

    res.json({ 
      message: "Submission approved and company updated successfully",
      company: company 
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

