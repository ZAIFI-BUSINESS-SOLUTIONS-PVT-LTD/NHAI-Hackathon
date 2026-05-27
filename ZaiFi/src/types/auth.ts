export interface AuthResult {
  matched: boolean;
  userId: string | null;
  confidence: number; // cosine similarity [0, 1]
}

export interface StoredEmbedding {
  userId: string;
  embedding: Float32Array;
}

