import { pipeline } from "@xenova/transformers";

let embedder;

export async function getEmbedder() {
  if (!embedder) {
    embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  }
  return embedder;
}

export async function getEmbedding(text) {
  const model = await getEmbedder();
  const output = await model(text);
  const row = output[0][0];
  return Array.from(row.data);
}

/** Returns null instead of throwing when the local embedder is unavailable. */
export async function safeGetEmbedding(text) {
  const safe = String(text ?? "").trim();
  if (!safe) return null;
  try {
    return await getEmbedding(safe);
  } catch (error) {
    console.warn("[embedding] safeGetEmbedding failed:", error?.message || error);
    return null;
  }
}

export function cosineSimilarity(a, b) {
  const dot = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const magA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const magB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  return dot / (magA * magB);
}
