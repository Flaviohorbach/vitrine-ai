// From project 6 (semantic-catalog-search), unchanged.
import { createGoogle } from "@ai-sdk/google";
import { embed, embedMany } from "ai";
import { EMBEDDING_DIMENSIONS } from "./db";

export const EMBEDDING_MODEL = "gemini-embedding-001";

const options = (taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY") => ({
  google: { outputDimensionality: EMBEDDING_DIMENSIONS, taskType },
});

const model = () => createGoogle({ apiKey: process.env.GEMINI_API_KEY }).embedding(EMBEDDING_MODEL);

/**
 * Documents and queries are embedded differently (taskType): a question and
 * the passage that answers it are not similar sentences, and the model is
 * trained to bring them together when it knows which is which.
 */
export async function embedDocuments(texts: string[]): Promise<number[][]> {
  const { embeddings } = await embedMany({ model: model(), values: texts, providerOptions: options("RETRIEVAL_DOCUMENT"), maxRetries: 2 });
  return embeddings;
}

export async function embedQuery(text: string): Promise<number[]> {
  const { embedding } = await embed({ model: model(), value: text, providerOptions: options("RETRIEVAL_QUERY"), maxRetries: 1, abortSignal: AbortSignal.timeout(10_000) });
  return embedding;
}
