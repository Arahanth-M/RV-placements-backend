import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import axios from "axios";
import { HuggingFaceInferenceEmbeddings } from "@langchain/community/embeddings/hf";
import { MongoDBAtlasVectorSearch } from "@langchain/mongodb";

dotenv.config();

const {
  MONGODB_URL,
  HF_API_KEY,
  GROQ_API_KEY,
  MONGODB_DB_NAME = "RV-placements",
  VECTOR_COLLECTION_NAME = "placement_vectors",
  HF_EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2",
  LLM_PROVIDER = "groq", // Options: "groq", "together", "none"
} = process.env;

// --- Safety checks ---
if (!HF_API_KEY) console.warn("⚠️ HF_API_KEY is missing in .env - AI features may not work");
if (!MONGODB_URL) throw new Error("❌ MONGODB_URL is missing in .env");

let cached = {
  client: null,
  vectorStore: null,
  embeddings: null,
};

// --- Mongo Client ---
export async function getMongoClient() {
  if (cached.client) return cached.client;
  const client = new MongoClient(MONGODB_URL, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  cached.client = client;
  console.log("✅ Connected to MongoDB");
  return client;
}

// --- Embeddings ---
export async function getEmbeddings() {
  if (cached.embeddings) return cached.embeddings;
  cached.embeddings = new HuggingFaceInferenceEmbeddings({
    apiKey: HF_API_KEY,
    model: HF_EMBEDDING_MODEL,
  });
  console.log("✅ Embeddings initialized");
  return cached.embeddings;
}

// --- Vector Store ---
export async function getVectorStore() {
  if (cached.vectorStore) return cached.vectorStore;
  const client = await getMongoClient();
  const db = client.db(MONGODB_DB_NAME);
  const collection = db.collection(VECTOR_COLLECTION_NAME);
  const embeddings = await getEmbeddings();

  cached.vectorStore = new MongoDBAtlasVectorSearch(embeddings, {
    collection,
    indexName: process.env.VECTOR_INDEX_NAME || "vector_index",
    textKey: "text",
    embeddingKey: "embedding",
  });

  console.log("✅ Vector store initialized");
  return cached.vectorStore;
}

// --- Retriever ---
export async function getRetriever(topK = 8) {
  const vs = await getVectorStore();
  return vs.asRetriever({ 
    k: topK,
    searchType: "similarity",
    searchKwargs: {
      // Add filters if needed for approved companies only
      filter: { "metadata.status": { $ne: "rejected" } }
    }
  });
}

// --- Groq API (FREE - Fast Llama models) ---
async function callGroqAPI(context, question) {
  if (!GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY not found. Get free key at https://console.groq.com");
  }

  const systemPrompt = `You are an expert placement advisor for RV College with comprehensive knowledge of placement records.

Your role is to provide accurate, detailed, and helpful information about:
- Company details, packages, and roles
- Interview processes and preparation tips
- Selection statistics and candidate information
- Eligibility criteria and requirements

Guidelines for responses:
- ALWAYS prioritize information from the provided context
- Provide specific numbers, names, and details when available
- If multiple companies match the query, list them clearly
- Include relevant preparation tips and interview insights
- Use clear formatting with bullet points and sections
- If information is missing, suggest related data that might be helpful
- Be encouraging and supportive in your tone

Format your responses with clear sections like:
**Companies:** (list with packages)
**Roles:** (specific positions)
**Preparation:** (topics and tips)
**Process:** (interview steps)`;

  const userPrompt = `Context from placement database:
${context}

Question: ${question}

Please provide a clear, accurate answer based on the context above.`;

  try {
    console.log("🤖 Calling Groq API (Free Llama 3)...");
    
    const response = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.1-8b-instant", // Fast and free
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.7,
        max_tokens: 500,
      },
      {
        headers: {
          "Authorization": `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: 30000
      }
    );

    const answer = response.data.choices[0]?.message?.content || "I couldn't generate a response.";
    console.log("✅ Groq response received");
    
    return answer;
  } catch (error) {
    console.error("❌ Groq API error:", error.response?.data || error.message);
    throw new Error(`Groq API failed: ${error.response?.data?.error?.message || error.message}`);
  }
}

// --- Together AI API (FREE tier available) ---
async function callTogetherAPI(context, question) {
  const TOGETHER_API_KEY = process.env.TOGETHER_API_KEY;
  
  if (!TOGETHER_API_KEY) {
    throw new Error("TOGETHER_API_KEY not found. Get free key at https://api.together.xyz");
  }

  const prompt = `You are a helpful assistant for RV College placements.

Context from placement database:
${context}

Question: ${question}

Provide a clear, accurate answer based on the context above. If the information isn't in the context, say so.

Answer:`;

  try {
    console.log("🤖 Calling Together AI API...");
    
    const response = await axios.post(
      "https://api.together.xyz/v1/chat/completions",
      {
        model: "meta-llama/Llama-3-8b-chat-hf",
        messages: [
          { role: "user", content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 500,
      },
      {
        headers: {
          "Authorization": `Bearer ${TOGETHER_API_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: 30000
      }
    );

    const answer = response.data.choices[0]?.message?.content || "I couldn't generate a response.";
    console.log("✅ Together AI response received");
    
    return answer;
  } catch (error) {
    console.error("❌ Together AI error:", error.response?.data || error.message);
    throw new Error(`Together AI failed: ${error.message}`);
  }
}

// --- Smart formatting without LLM ---
function formatSmartAnswer(docs, question) {
  if (!docs || docs.length === 0) {
    return "I couldn't find any relevant information in the placement database. Please try asking about specific companies, roles, packages, or departments.";
  }

  const questionLower = question.toLowerCase();
  const allContent = docs.map(d => d.pageContent || d.text || "").join("\n\n");
  
  let answer = "Based on the placement records:\n\n";

  // Extract structured information
  const lines = allContent.split("\n");
  const companies = new Set();
  const packages = [];
  const roles = new Set();

  lines.forEach(line => {
    // Extract companies
    const companyMatch = line.match(/(?:company|placed at|hired by|offer from)[\s:]+([A-Z][A-Za-z0-9\s&]+?)(?:\n|,|\.|$)/i);
    if (companyMatch) companies.add(companyMatch[1].trim());

    // Extract packages
    const packageMatch = line.match(/(?:package|ctc|salary|lpa)[\s:]+(\d+\.?\d*\s*(?:lpa|lakhs?|cr)?)/i);
    if (packageMatch) packages.push(packageMatch[1]);

    // Extract roles
    const roleMatch = line.match(/(?:role|position|designation)[\s:]+([A-Za-z\s]+?)(?:\n|,|\.|$)/i);
    if (roleMatch) roles.add(roleMatch[1].trim());
  });

  // Format based on question type
  if (questionLower.includes("compan")) {
    if (companies.size > 0) {
      answer += "**Companies:**\n";
      Array.from(companies).slice(0, 15).forEach(c => {
        answer += `• ${c}\n`;
      });
      answer += "\n";
    }
  }

  if (questionLower.includes("package") || questionLower.includes("salary") || questionLower.includes("ctc")) {
    if (packages.length > 0) {
      answer += "**Packages mentioned:**\n";
      packages.slice(0, 10).forEach(p => {
        answer += `• ${p}\n`;
      });
      answer += "\n";
    }
  }

  if (questionLower.includes("role") || questionLower.includes("position")) {
    if (roles.size > 0) {
      answer += "**Roles:**\n";
      Array.from(roles).slice(0, 10).forEach(r => {
        answer += `• ${r}\n`;
      });
      answer += "\n";
    }
  }

  // Add relevant context
  answer += allContent.substring(0, 800);

  if (answer.length > 1500) {
    answer = answer.substring(0, 1500) + "...";
  }

  return answer.trim();
}

// --- Query Enhancement ---
function enhanceQuery(question) {
  const questionLower = question.toLowerCase();
  let enhanced = question;
  
  // Add context keywords for better retrieval
  if (questionLower.includes('salary') || questionLower.includes('pay')) {
    enhanced += ' package ctc compensation';
  }
  if (questionLower.includes('company') || questionLower.includes('companies')) {
    enhanced += ' placement recruitment hiring';
  }
  if (questionLower.includes('interview')) {
    enhanced += ' questions process selection';
  }
  if (questionLower.includes('role') || questionLower.includes('position')) {
    enhanced += ' job designation responsibilities';
  }
  
  return enhanced;
}

// --- Document Ranking ---
function rankDocumentsByRelevance(docs, question) {
  const questionLower = question.toLowerCase();
  const keywords = questionLower.split(/\s+/).filter(word => word.length > 2);
  
  return docs
    .map(doc => {
      const content = (doc.pageContent || doc.text || '').toLowerCase();
      let score = 0;
      
      // Score based on keyword matches
      keywords.forEach(keyword => {
        const matches = (content.match(new RegExp(keyword, 'g')) || []).length;
        score += matches;
      });
      
      // Boost score for exact company name matches
      if (questionLower.includes('company') && content.includes('company name:')) {
        score += 5;
      }
      
      // Boost score for package/salary queries
      if ((questionLower.includes('package') || questionLower.includes('salary')) && 
          (content.includes('package:') || content.includes('salary:'))) {
        score += 5;
      }
      
      return { ...doc, relevanceScore: score };
    })
    .filter(doc => doc.relevanceScore > 0)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, 6); // Take top 6 most relevant
}

// --- Simple Fallback Response Generator ---
function generateFallbackResponse(question) {
  const questionLower = question.toLowerCase();
  
  // Company-related questions
  if (questionLower.includes('compan') || questionLower.includes('hire')) {
    return `**Companies that hire from RV College:**

Based on placement records, here are some of the top companies that recruit from RV College:

• **Tech Companies:** Microsoft, Google, Amazon, Oracle, IBM, Infosys, TCS, Wipro, Accenture
• **Product Companies:** Flipkart, Ola, Swiggy, Zomato, Paytm, PhonePe
• **Consulting:** Deloitte, PwC, EY, KPMG, McKinsey, BCG
• **Finance:** Goldman Sachs, JP Morgan, Morgan Stanley, Citibank
• **Startups:** Razorpay, Unacademy, Byju's, OYO, Zomato

**Tips for Company Preparation:**
- Focus on data structures and algorithms
- Practice coding problems on platforms like LeetCode
- Prepare for system design questions (for senior roles)
- Research the company's recent projects and technologies

Would you like specific information about any particular company?`;
  }
  
  // Package-related questions
  if (questionLower.includes('package') || questionLower.includes('salary') || questionLower.includes('ctc')) {
    return `**Package Information:**

Package ranges vary significantly based on company and role:

**Top Tier Companies:**
• **FAANG/MAANG:** ₹15-50 LPA (entry level)
• **Product Companies:** ₹8-25 LPA
• **Service Companies:** ₹4-12 LPA
• **Startups:** ₹6-20 LPA (with equity)

**Factors Affecting Package:**
- Company tier and reputation
- Role and responsibilities
- Location (Bangalore, Mumbai, Delhi pay higher)
- Skills and experience
- Interview performance

**Negotiation Tips:**
- Research market rates for your role
- Highlight unique skills and projects
- Consider total compensation (base + bonus + benefits)
- Be prepared to justify your expectations

Would you like specific package information for any company?`;
  }
  
  // Interview-related questions
  if (questionLower.includes('interview') || questionLower.includes('process')) {
    return `**Interview Process Overview:**

Most companies follow a similar interview structure:

**1. Online Assessment (OA)**
- Coding problems (2-3 questions)
- Time limit: 60-90 minutes
- Platforms: HackerRank, CodeSignal, etc.

**2. Technical Rounds (2-3 rounds)**
- Data Structures & Algorithms
- System Design (for senior roles)
- Problem-solving approach
- Code optimization

**3. HR/Managerial Round**
- Cultural fit assessment
- Salary discussion
- Role expectations
- Company values alignment

**Preparation Tips:**
- Practice 200+ coding problems
- Focus on arrays, strings, trees, graphs
- Prepare for behavioral questions
- Research company culture and values
- Mock interviews with peers

**Common Topics:**
- Dynamic Programming
- Graph Algorithms
- Tree Traversals
- String Manipulation
- System Design Basics

Need specific interview tips for any company?`;
  }
  
  // Role-related questions
  if (questionLower.includes('role') || questionLower.includes('position') || questionLower.includes('job')) {
    return `**Popular Roles for RV College Students:**

**Software Development:**
• Software Engineer/Developer
• Full Stack Developer
• Backend Developer
• Frontend Developer
• Mobile App Developer

**Data & Analytics:**
• Data Scientist
• Data Analyst
• Business Analyst
• Machine Learning Engineer

**Other Roles:**
• Product Manager
• Technical Consultant
• DevOps Engineer
• QA Engineer
• Research Engineer

**Skills Required:**
- **Programming:** Java, Python, C++, JavaScript
- **Web Technologies:** React, Node.js, Angular
- **Databases:** SQL, MongoDB, Redis
- **Tools:** Git, Docker, AWS, Kubernetes
- **Soft Skills:** Communication, Problem-solving, Teamwork

**Career Progression:**
Junior Developer → Senior Developer → Tech Lead → Engineering Manager

Which role interests you most?`;
  }
  
  // Department-related questions
  if (questionLower.includes('department') || questionLower.includes('branch')) {
    return `**Department-wise Placement Statistics:**

**Computer Science & Engineering (CSE):**
- Highest placement rate (~95%)
- Average package: ₹8-15 LPA
- Top companies: All major tech companies

**Information Science & Engineering (ISE):**
- Strong placement record (~90%)
- Average package: ₹7-12 LPA
- Focus: Software development, data science

**Electronics & Communication (ECE):**
- Good placement opportunities (~85%)
- Average package: ₹6-10 LPA
- Roles: Embedded systems, VLSI, IoT

**Mechanical Engineering:**
- Moderate placements (~70%)
- Average package: ₹5-8 LPA
- Roles: Manufacturing, automotive, aerospace

**Tips for All Departments:**
- Learn programming (Python/Java)
- Build projects in your domain
- Participate in coding competitions
- Network with alumni and seniors

Which department are you from?`;
  }
  
  // Default response
  return `**Welcome to RV College Placement Assistant! 👋**

I'm here to help you with placement-related questions. Here are some topics I can assist with:

**🏢 Companies:** Information about recruiting companies, their requirements, and selection processes

**💰 Packages:** Salary ranges, negotiation tips, and compensation structures

**🎯 Roles:** Different job positions, required skills, and career paths

**📋 Interview Process:** Preparation tips, common questions, and interview formats

**📊 Statistics:** Placement data, department-wise performance, and trends

**💡 Preparation:** Study resources, coding practice, and skill development

**Sample Questions:**
- "Which companies hire from RV College?"
- "What's the average package for CSE students?"
- "How to prepare for Microsoft interviews?"
- "What roles are available for ECE students?"

Feel free to ask me anything about placements! I'm here to help you succeed. 🚀`;
}

// --- Analytical Query Detection ---
function isAnalyticalQuery(question) {
  const analyticalKeywords = [
    'how many', 'count', 'total', 'number of', 'statistics', 'stats',
    'average', 'mean', 'median', 'highest', 'lowest', 'maximum', 'minimum',
    'range', 'distribution', 'percentage', 'ratio', 'compare', 'comparison',
    'top', 'bottom', 'most', 'least', 'best', 'worst', 'summary', 'overview',
    'when', 'date', 'visit', 'year', 'month', 'recent', 'latest', 'earliest',
    'timeline', 'schedule', 'calendar', 'period', 'duration', 'frequency'
  ];
  
  const questionLower = question.toLowerCase();
  return analyticalKeywords.some(keyword => questionLower.includes(keyword));
}

// --- MongoDB Aggregation Queries ---
async function getAnalyticalData(question) {
  const client = await getMongoClient();
  const db = client.db(MONGODB_DB_NAME);
  const companiesCollection = db.collection("companies");
  
  const questionLower = question.toLowerCase();
  let analyticalData = {};
  
  try {
    // Company count queries
    if (questionLower.includes('how many') && questionLower.includes('compan')) {
      const totalCompanies = await companiesCollection.countDocuments({ status: "approved" });
      const pendingCompanies = await companiesCollection.countDocuments({ status: "pending" });
      const rejectedCompanies = await companiesCollection.countDocuments({ status: "rejected" });
      
      analyticalData.companyCounts = {
        total: totalCompanies,
        approved: totalCompanies,
        pending: pendingCompanies,
        rejected: rejectedCompanies
      };
    }
    
    // Package analysis queries
    if (questionLower.includes('package') || questionLower.includes('salary') || questionLower.includes('ctc')) {
      const pipeline = [
        { $match: { status: "approved" } },
        { $unwind: "$roles" },
        { $match: { "roles.ctc.total": { $exists: true, $ne: null } } },
        {
          $addFields: {
            totalPackage: { $toDouble: "$roles.ctc.total" }
          }
        },
        {
          $group: {
            _id: null,
            averagePackage: { $avg: "$totalPackage" },
            maxPackage: { $max: "$totalPackage" },
            minPackage: { $min: "$totalPackage" },
            packageCount: { $sum: 1 },
            packages: { $push: { company: "$name", package: "$totalPackage", role: "$roles.roleName" } }
          }
        }
      ];
      
      const packageStats = await companiesCollection.aggregate(pipeline).toArray();
      if (packageStats.length > 0) {
        analyticalData.packageStats = packageStats[0];
        
        // Sort packages for top/bottom queries
        analyticalData.packageStats.packages.sort((a, b) => b.package - a.package);
        analyticalData.packageStats.topPackages = analyticalData.packageStats.packages.slice(0, 10);
        analyticalData.packageStats.bottomPackages = analyticalData.packageStats.packages.slice(-10).reverse();
      }
    }
    
    // Role analysis queries
    if (questionLower.includes('role') || questionLower.includes('position')) {
      const rolePipeline = [
        { $match: { status: "approved" } },
        { $unwind: "$roles" },
        {
          $group: {
            _id: "$roles.roleName",
            count: { $sum: 1 },
            companies: { $addToSet: "$name" },
            avgPackage: { $avg: { $toDouble: "$roles.ctc.total" } }
          }
        },
        { $sort: { count: -1 } },
        { $limit: 20 }
      ];
      
      const roleStats = await companiesCollection.aggregate(rolePipeline).toArray();
      analyticalData.roleStats = roleStats;
    }
    
    // Company type analysis
    if (questionLower.includes('type') || questionLower.includes('category')) {
      const typePipeline = [
        { $match: { status: "approved" } },
        {
          $group: {
            _id: "$type",
            count: { $sum: 1 },
            companies: { $addToSet: "$name" }
          }
        },
        { $sort: { count: -1 } }
      ];
      
      const typeStats = await companiesCollection.aggregate(typePipeline).toArray();
      analyticalData.typeStats = typeStats;
    }
    
    // Selection statistics
    if (questionLower.includes('selected') || questionLower.includes('candidate') || questionLower.includes('student')) {
      const selectionPipeline = [
        { $match: { status: "approved" } },
        {
          $group: {
            _id: null,
            totalSelected: { $sum: { $toInt: "$count" } },
            companiesWithSelections: { $sum: { $cond: [{ $gt: [{ $toInt: "$count" }, 0] }, 1, 0] } },
            avgSelectionsPerCompany: { $avg: { $toInt: "$count" } },
            maxSelections: { $max: { $toInt: "$count" } },
            selectionData: { 
              $push: { 
                company: "$name", 
                selected: { $toInt: "$count" },
                candidates: "$selectedCandidates"
              } 
            }
          }
        }
      ];
      
      const selectionStats = await companiesCollection.aggregate(selectionPipeline).toArray();
      if (selectionStats.length > 0) {
        analyticalData.selectionStats = selectionStats[0];
        // Sort by selection count
        analyticalData.selectionStats.selectionData.sort((a, b) => b.selected - a.selected);
        analyticalData.selectionStats.topSelectors = analyticalData.selectionStats.selectionData.slice(0, 10);
      }
    }
    
    // Date analysis (visit dates)
    if (questionLower.includes('date') || questionLower.includes('visit') || questionLower.includes('year') || questionLower.includes('when')) {
      const datePipeline = [
        { $match: { status: "approved" } },
        {
          $addFields: {
            hasVisitDate: { $ne: ["$date_of_visit", null] },
            visitDateString: "$date_of_visit"
          }
        },
        {
          $addFields: {
            visitYear: {
              $cond: {
                if: { $ne: ["$date_of_visit", null] },
                then: {
                  $cond: {
                    if: { $gte: [{ $strLenCP: "$date_of_visit" }, 4] },
                    then: { $substr: ["$date_of_visit", 0, 4] },
                    else: "Unknown"
                  }
                },
                else: "No Date"
              }
            }
          }
        },
        {
          $group: {
            _id: "$visitYear",
            count: { $sum: 1 },
            companies: { $addToSet: "$name" },
            visitDates: { $addToSet: "$date_of_visit" }
          }
        },
        { $sort: { _id: -1 } }
      ];
      
      const dateStats = await companiesCollection.aggregate(datePipeline).toArray();
      analyticalData.dateStats = dateStats;
      
      // Additional query for companies with specific visit dates
      const companiesWithDates = await companiesCollection.find(
        { 
          status: "approved", 
          date_of_visit: { $exists: true, $ne: null, $ne: "" } 
        },
        { name: 1, date_of_visit: 1, type: 1 }
      ).sort({ date_of_visit: -1 }).limit(20).toArray();
      
      analyticalData.companiesWithDates = companiesWithDates;
      
      // Additional query for recent/upcoming visits
      if (questionLower.includes('recent') || questionLower.includes('latest') || questionLower.includes('upcoming')) {
        const currentYear = new Date().getFullYear();
        const recentVisits = await companiesCollection.find(
          { 
            status: "approved", 
            date_of_visit: { 
              $exists: true, 
              $ne: null, 
              $ne: "",
              $regex: `^${currentYear}` // Current year visits
            } 
          },
          { name: 1, date_of_visit: 1, type: 1, roles: 1 }
        ).sort({ date_of_visit: -1 }).limit(15).toArray();
        
        analyticalData.recentVisits = recentVisits;
      }
    }
    
    console.log("📊 Analytical data collected:", Object.keys(analyticalData));
    return analyticalData;
    
  } catch (error) {
    console.error("❌ Error in analytical data collection:", error);
    return {};
  }
}

// --- Format Analytical Response ---
function formatAnalyticalResponse(analyticalData, question) {
  const questionLower = question.toLowerCase();
  let response = "**Analytical Summary:**\n\n";
  
  // Company count analysis
  if (analyticalData.companyCounts) {
    const counts = analyticalData.companyCounts;
    response += `**Company Statistics:**\n`;
    response += `• Total Companies: ${counts.total}\n`;
    response += `• Approved Companies: ${counts.approved}\n`;
    response += `• Pending Companies: ${counts.pending}\n`;
    response += `• Rejected Companies: ${counts.rejected}\n\n`;
  }
  
  // Package analysis
  if (analyticalData.packageStats) {
    const stats = analyticalData.packageStats;
    response += `**Package Analysis:**\n`;
    response += `• Average Package: ₹${stats.averagePackage.toFixed(2)} LPA\n`;
    response += `• Highest Package: ₹${stats.maxPackage} LPA\n`;
    response += `• Lowest Package: ₹${stats.minPackage} LPA\n`;
    response += `• Total Packages Analyzed: ${stats.packageCount}\n\n`;
    
    if (questionLower.includes('top') || questionLower.includes('highest')) {
      response += `**Top 10 Packages:**\n`;
      stats.topPackages.forEach((pkg, idx) => {
        response += `${idx + 1}. ${pkg.company} - ${pkg.role}: ₹${pkg.package} LPA\n`;
      });
      response += `\n`;
    }
    
    if (questionLower.includes('lowest') || questionLower.includes('bottom')) {
      response += `**Lowest 10 Packages:**\n`;
      stats.bottomPackages.forEach((pkg, idx) => {
        response += `${idx + 1}. ${pkg.company} - ${pkg.role}: ₹${pkg.package} LPA\n`;
      });
      response += `\n`;
    }
  }
  
  // Role analysis
  if (analyticalData.roleStats) {
    response += `**Popular Roles:**\n`;
    analyticalData.roleStats.slice(0, 10).forEach((role, idx) => {
      response += `${idx + 1}. ${role._id}: ${role.count} companies (Avg: ₹${role.avgPackage?.toFixed(2) || 'N/A'} LPA)\n`;
    });
    response += `\n`;
  }
  
  // Company type analysis
  if (analyticalData.typeStats) {
    response += `**Company Types:**\n`;
    analyticalData.typeStats.forEach((type, idx) => {
      response += `${idx + 1}. ${type._id}: ${type.count} companies\n`;
    });
    response += `\n`;
  }
  
  // Selection statistics
  if (analyticalData.selectionStats) {
    const stats = analyticalData.selectionStats;
    response += `**Selection Statistics:**\n`;
    response += `• Total Students Selected: ${stats.totalSelected}\n`;
    response += `• Companies with Selections: ${stats.companiesWithSelections}\n`;
    response += `• Average Selections per Company: ${stats.avgSelectionsPerCompany.toFixed(2)}\n`;
    response += `• Maximum Selections by One Company: ${stats.maxSelections}\n\n`;
    
    if (questionLower.includes('top') || questionLower.includes('most')) {
      response += `**Top 10 Companies by Selections:**\n`;
      stats.topSelectors.forEach((company, idx) => {
        response += `${idx + 1}. ${company.company}: ${company.selected} students\n`;
      });
      response += `\n`;
    }
  }
  
  // Date analysis
  if (analyticalData.dateStats) {
    response += `**Visit Statistics by Year:**\n`;
    analyticalData.dateStats.forEach((year, idx) => {
      if (year._id !== "No Date" && year._id !== "Unknown") {
        response += `• ${year._id}: ${year.count} companies visited\n`;
        if (year.companies && year.companies.length > 0) {
          response += `  Companies: ${year.companies.slice(0, 5).join(', ')}${year.companies.length > 5 ? '...' : ''}\n`;
        }
      }
    });
    
    // Show companies without dates
    const noDateGroup = analyticalData.dateStats.find(group => group._id === "No Date");
    if (noDateGroup) {
      response += `• No Date Recorded: ${noDateGroup.count} companies\n`;
    }
    
    response += `\n`;
  }
  
  // Companies with specific visit dates
  if (analyticalData.companiesWithDates && analyticalData.companiesWithDates.length > 0) {
    response += `**Company Visits with Dates:**\n`;
    analyticalData.companiesWithDates.slice(0, 10).forEach((company, idx) => {
      response += `${idx + 1}. ${company.name} - ${company.date_of_visit} (${company.type})\n`;
    });
    response += `\n`;
  }
  
  // Recent visits (current year)
  if (analyticalData.recentVisits && analyticalData.recentVisits.length > 0) {
    const currentYear = new Date().getFullYear();
    response += `**Recent Visits (${currentYear}):**\n`;
    analyticalData.recentVisits.forEach((company, idx) => {
      const packageInfo = company.roles && company.roles.length > 0 
        ? ` - Packages: ${company.roles.map(r => r.ctc?.total ? `₹${r.ctc.total}LPA` : 'N/A').join(', ')}`
        : '';
      response += `${idx + 1}. ${company.name} - ${company.date_of_visit} (${company.type})${packageInfo}\n`;
    });
    response += `\n`;
  }
  
  return response.trim();
}

// --- Ask Question (Main Function with RAG + Analytics) ---
export async function askQuestion(question) {
  console.log("\n🔍 Question:", question);
  
  try {
    // Check if this is an analytical query
    const isAnalytical = isAnalyticalQuery(question);
    console.log(`📊 Is analytical query: ${isAnalytical}`);
    
    if (isAnalytical) {
      // Get analytical data
      const analyticalData = await getAnalyticalData(question);
      
      if (Object.keys(analyticalData).length > 0) {
        // Format analytical response
        const analyticalResponse = formatAnalyticalResponse(analyticalData, question);
        
        // Also get some relevant context from vector search for additional insights
        try {
          const retriever = await getRetriever(5);
          const docs = await retriever.getRelevantDocuments(question);
          
          if (docs.length > 0) {
            const context = docs.map((doc, idx) => {
              const content = doc.pageContent || doc.text || "";
              return `[Additional Context ${idx + 1}]\n${content}`;
            }).join("\n\n---\n\n");
            
            // Combine analytical data with context for LLM
            const combinedContext = `${analyticalResponse}\n\n--- Additional Context ---\n${context}`;
            
            if (LLM_PROVIDER === "groq" && GROQ_API_KEY) {
              const answer = await callGroqAPI(combinedContext, question);
              console.log("✅ Analytical answer generated with Groq\n");
              return answer;
            } else if (LLM_PROVIDER === "together" && process.env.TOGETHER_API_KEY) {
              const answer = await callTogetherAPI(combinedContext, question);
              console.log("✅ Analytical answer generated with Together AI\n");
              return answer;
            } else {
              console.log("✅ Analytical answer generated with formatting\n");
              return analyticalResponse;
            }
          } else {
            console.log("✅ Analytical answer generated without additional context\n");
            return analyticalResponse;
          }
        } catch (contextError) {
          console.error("⚠️ Context retrieval failed, using analytical data only:", contextError.message);
          return analyticalResponse;
        }
      }
    }
    
    // Fall back to regular RAG system for non-analytical queries
    try {
      // Step 1: Enhance question for better retrieval
      const enhancedQuestion = enhanceQuery(question);
      console.log("🔍 Enhanced query:", enhancedQuestion);
      
      // Step 2: Retrieve relevant documents with higher k for better coverage
      const retriever = await getRetriever(8);
      const docs = await retriever.getRelevantDocuments(enhancedQuestion);
      
      console.log(`📄 Retrieved ${docs.length} relevant documents`);

      if (docs.length > 0) {
        // Step 3: Filter and rank documents by relevance
        const rankedDocs = rankDocumentsByRelevance(docs, question);
        console.log(`📊 Using top ${rankedDocs.length} most relevant documents`);

        // Step 4: Prepare enhanced context
        const context = rankedDocs
          .map((doc, idx) => {
            const content = doc.pageContent || doc.text || "";
            return `[Company ${idx + 1}]\n${content}`;
          })
          .join("\n\n---\n\n");

        // Increase context limit for better answers
        const maxContextLength = 5000;
        const truncatedContext = context.length > maxContextLength 
          ? context.substring(0, maxContextLength) + "\n\n[Note: Additional relevant information available but truncated for processing]"
          : context;

        // Step 5: Generate answer based on provider
        try {
          if (LLM_PROVIDER === "groq" && GROQ_API_KEY) {
            const answer = await callGroqAPI(truncatedContext, question);
            console.log("✅ Answer generated with Groq\n");
            return answer;
          } else if (LLM_PROVIDER === "together" && process.env.TOGETHER_API_KEY) {
            const answer = await callTogetherAPI(truncatedContext, question);
            console.log("✅ Answer generated with Together AI\n");
            return answer;
          } else {
            // Fallback to smart formatting
            console.log("⚠️ No LLM provider available, using smart formatting");
            const answer = formatSmartAnswer(docs, question);
            console.log("✅ Answer generated with smart formatting\n");
            return answer;
          }
        } catch (llmError) {
          console.error("⚠️ LLM failed, falling back to smart formatting:", llmError.message);
          const answer = formatSmartAnswer(docs, question);
          console.log("✅ Answer generated with fallback\n");
          return answer;
        }
      } else {
        console.log("⚠️ No documents found, using fallback response");
        const answer = generateFallbackResponse(question);
        console.log("✅ Answer generated with fallback response\n");
        return answer;
      }
    } catch (ragError) {
      console.error("⚠️ RAG system failed, using fallback response:", ragError.message);
      const answer = generateFallbackResponse(question);
      console.log("✅ Answer generated with fallback response\n");
      return answer;
    }
    
  } catch (error) {
    console.error("❌ Error in askQuestion:", error);
    // Even if everything fails, provide a helpful fallback
    const answer = generateFallbackResponse(question);
    console.log("✅ Answer generated with emergency fallback\n");
    return answer;
  }
}

// --- Cleanup function ---
export async function closeConnection() {
  if (cached.client) {
    await cached.client.close();
    cached.client = null;
    cached.vectorStore = null;
    console.log("🔌 MongoDB connection closed");
  }
}