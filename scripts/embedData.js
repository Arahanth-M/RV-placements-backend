import dotenv from "dotenv";
import mongoose from "mongoose";
import { MongoClient } from "mongodb";
import { HuggingFaceInferenceEmbeddings } from "@langchain/community/embeddings/hf";

dotenv.config();

// CONFIG
const {
  MONGODB_URL,
  MONGODB_DB_NAME = "RV-placements",
  VECTOR_COLLECTION_NAME = "placement_vectors",
  SOURCE_COLLECTION_NAME = process.env.SOURCE_COLLECTION_NAME || "companies",
  VECTOR_INDEX_NAME = process.env.VECTOR_INDEX_NAME || "vector_index",
  HF_EMBEDDING_MODEL = "sentence-transformers/all-MiniLM-L6-v2",
} = process.env;

async function ensureVectorIndex(collection) {
  // Creates Atlas Vector Search index if not present (idempotent attempt)
  try {
    await collection.indexes();
    // Best effort: users should create Atlas vector index via UI or API.
    // Here we keep a standard index on embedding if not exists to avoid failures in local envs.
    await collection.createIndex({ embedding: "cosine" }, { name: VECTOR_INDEX_NAME }).catch(() => {});
  } catch {}
}

function buildDocText(doc) {
  // Create rich, searchable text for better semantic understanding
  const parts = [];
  
  // Company basic info - most important for search
  if (doc.name) parts.push(`Company Name: ${doc.name}`);
  if (doc.type) parts.push(`Company Type: ${doc.type}`);
  if (doc.business_model) parts.push(`Business Model: ${doc.business_model}`);
  if (doc.eligibility) parts.push(`Eligibility Criteria: ${doc.eligibility}`);
  
  // Roles and compensation - critical for placement queries
  if (doc.roles && Array.isArray(doc.roles)) {
    doc.roles.forEach((role, idx) => {
      parts.push(`Role ${idx + 1}: ${role.roleName || 'Not specified'}`);
      
      if (role.ctc) {
        const ctcObj = role.ctc instanceof Map ? Object.fromEntries(role.ctc) : role.ctc;
        if (ctcObj.total) parts.push(`Package: ${ctcObj.total} LPA`);
        if (ctcObj.base) parts.push(`Base Salary: ${ctcObj.base} LPA`);
        if (ctcObj.bonus) parts.push(`Bonus: ${ctcObj.bonus} LPA`);
        if (ctcObj.stock) parts.push(`Stock Options: ${ctcObj.stock} LPA`);
      }
      
      if (role.internshipStipend) parts.push(`Internship Stipend: ${role.internshipStipend}`);
      if (role.finalPayFirstYear) parts.push(`First Year Pay: ${role.finalPayFirstYear} LPA`);
    });
  }
  
  // Interview and selection process
  if (doc.interviewProcess) parts.push(`Interview Process: ${doc.interviewProcess}`);
  
  // Questions for preparation
  if (doc.onlineQuestions && doc.onlineQuestions.length > 0) {
    parts.push(`Online Questions: ${doc.onlineQuestions.join('; ')}`);
  }
  
  if (doc.interviewQuestions && doc.interviewQuestions.length > 0) {
    parts.push(`Interview Questions: ${doc.interviewQuestions.join('; ')}`);
  }
  
  // MCQ Questions
  if (doc.mcqQuestions && doc.mcqQuestions.length > 0) {
    const mcqText = doc.mcqQuestions.map(q => q.question).filter(Boolean).join('; ');
    if (mcqText) parts.push(`MCQ Questions: ${mcqText}`);
  }
  
  // Important topics
  if (doc.Must_Do_Topics && doc.Must_Do_Topics.length > 0) {
    parts.push(`Must Do Topics: ${doc.Must_Do_Topics.join(', ')}`);
  }
  
  // Selection statistics
  if (doc.count) parts.push(`Students Selected: ${doc.count}`);
  if (doc.selectedCandidates && doc.selectedCandidates.length > 0) {
    const candidateNames = doc.selectedCandidates.map(c => c.name).join(', ');
    parts.push(`Selected Candidates: ${candidateNames}`);
  }
  
  // Visit information
  if (doc.date_of_visit) parts.push(`Visit Date: ${doc.date_of_visit}`);
  
  // Add submission info for context
  if (doc.submittedBy && doc.submittedBy.name) {
    parts.push(`Submitted by: ${doc.submittedBy.name}`);
  }
  
  return parts.join('\n');
}

async function main() {
  if (!MONGODB_URL) throw new Error("MONGODB_URL not set");

  const client = new MongoClient(MONGODB_URL);
  await client.connect();
  const db = client.db(MONGODB_DB_NAME);
  const sourceCol = db.collection(SOURCE_COLLECTION_NAME);
  const vectorCol = db.collection(VECTOR_COLLECTION_NAME);

  await ensureVectorIndex(vectorCol);

  // Choose embeddings provider without importing local transformers unless needed
  let embeddings;
  if (process.env.HF_API_KEY) {
    embeddings = new HuggingFaceInferenceEmbeddings({ apiKey: process.env.HF_API_KEY, model: HF_EMBEDDING_MODEL });
  } else {
    const { HuggingFaceTransformersEmbeddings } = await import("@langchain/community/embeddings/hf_transformers");
    embeddings = new HuggingFaceTransformersEmbeddings({ modelName: "Xenova/all-MiniLM-L6-v2" });
  }

  const cursor = sourceCol.find({});
  let count = 0;
  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    const text = buildDocText(doc);
    const embedding = await embeddings.embedQuery(text);
    await vectorCol.updateOne(
      { sourceId: doc._id },
      {
        $set: {
          sourceId: doc._id,
          text,
          embedding,
          metadata: { collection: SOURCE_COLLECTION_NAME },
        },
      },
      { upsert: true }
    );
    count += 1;
    if (count % 25 === 0) console.log(`Embedded ${count} documents...`);
  }

  console.log(`Finished embedding ${count} documents.`);
  await client.close();
  await mongoose.disconnect().catch(() => {});
}

main().catch((err) => {
  console.error("Embedding failed:", err);
  process.exit(1);
});

