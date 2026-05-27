import type { AuthResult, StoredEmbedding } from '../types/auth';

export const DEFAULT_THRESHOLD = 0.75;

let _threshold = DEFAULT_THRESHOLD;

export function getMatchThreshold(): number { return _threshold; }
export function setMatchThreshold(v: number): void {
  _threshold = Math.max(0.50, Math.min(0.95, v));
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// Compares incoming embedding against all stored embeddings.
// Returns the best-matching user if confidence exceeds the current threshold.
export function verifyFace(
  incoming: Float32Array,
  stored: StoredEmbedding[],
): AuthResult {
  let bestScore  = -1;
  let bestUserId: string | null = null;

  for (const entry of stored) {
    const score = cosineSimilarity(incoming, entry.embedding);
    if (score > bestScore) {
      bestScore  = score;
      bestUserId = entry.userId;
    }
  }

  if (bestScore >= _threshold) {
    return { matched: true, userId: bestUserId, confidence: bestScore };
  }
  return { matched: false, userId: null, confidence: Math.max(0, bestScore) };
}
