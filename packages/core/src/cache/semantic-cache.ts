import crypto from 'crypto';
import { CacheStore } from '../db/redis.js';
import { EmbeddingProvider } from '../indexer/embeddings.js';
import { cosineSimilarity } from '../db/vector-store.js';
import { Citation } from '../types/index.js';

export interface CachedQueryResult {
  answer: string;
  citations: Citation[];
  similarity: number;
}

export class SemanticCache {
  private SIMILARITY_THRESHOLD = 0.94;

  constructor(
    private cacheStore: CacheStore,
    private embeddingProvider: EmbeddingProvider
  ) {}

  async get(query: string, repoId: string): Promise<CachedQueryResult | null> {
    try {
      const queryVector = await this.embeddingProvider.embed(query);
      const setKey = `cortex:cache:keys:${repoId}`;
      const candidateKeys = await this.cacheStore.smembers(setKey);

      let bestMatch: { key: string; similarity: number } | null = null;

      for (const key of candidateKeys) {
        const storedBuffer = await this.cacheStore.getBuffer(`cortex:cache:vec:${key}`);
        if (!storedBuffer) continue;

        const floatArray = new Float32Array(
          storedBuffer.buffer,
          storedBuffer.byteOffset,
          storedBuffer.byteLength / Float32Array.BYTES_PER_ELEMENT
        );

        const similarity = cosineSimilarity(queryVector, floatArray);
        if (similarity >= this.SIMILARITY_THRESHOLD && (!bestMatch || similarity > bestMatch.similarity)) {
          bestMatch = { key, similarity };
        }
      }

      if (bestMatch) {
        const rawData = await this.cacheStore.get(`cortex:cache:data:${bestMatch.key}`);
        if (rawData) {
          const parsed = JSON.parse(rawData);
          return {
            answer: parsed.answer,
            citations: parsed.citations || [],
            similarity: bestMatch.similarity,
          };
        }
      }
    } catch (e: any) {
      console.warn(`[SemanticCache] Read warning: ${e.message}`);
    }

    return null;
  }

  async set(query: string, repoId: string, answer: string, citations: Citation[]): Promise<void> {
    try {
      const queryVector = await this.embeddingProvider.embed(query);
      const key = crypto.randomUUID();
      const ttl = 86400 * 7; // 7 days

      const floatArray = new Float32Array(queryVector);
      const buffer = Buffer.from(floatArray.buffer, floatArray.byteOffset, floatArray.byteLength);

      await this.cacheStore.setBuffer(`cortex:cache:vec:${key}`, buffer, ttl);
      await this.cacheStore.set(
        `cortex:cache:data:${key}`,
        JSON.stringify({ query, answer, citations, createdAt: new Date() }),
        ttl
      );
      await this.cacheStore.sadd(`cortex:cache:keys:${repoId}`, key);
    } catch (e: any) {
      console.warn(`[SemanticCache] Write warning: ${e.message}`);
    }
  }
}
