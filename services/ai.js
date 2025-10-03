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

// --- Ask Question (Main Function with RAG) ---
export async function askQuestion(question) {
  console.log("\n🔍 Question:", question);
  
  try {
    // Step 1: Enhance question for better retrieval
    const enhancedQuestion = enhanceQuery(question);
    console.log("🔍 Enhanced query:", enhancedQuestion);
    
    // Step 2: Retrieve relevant documents with higher k for better coverage
    const retriever = await getRetriever(8);
    const docs = await retriever.getRelevantDocuments(enhancedQuestion);
    
    console.log(`📄 Retrieved ${docs.length} relevant documents`);

    if (docs.length === 0) {
      return "I couldn't find any relevant information in the placement database. Please try asking about specific companies, roles, packages, or departments. Make sure the data has been embedded first by running the embedding script.";
    }

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

    // Step 3: Generate answer based on provider
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
    
  } catch (error) {
    console.error("❌ Error in askQuestion:", error);
    throw error;
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