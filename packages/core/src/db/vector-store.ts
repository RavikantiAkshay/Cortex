import { QdrantClient } from '@qdrant/js-client-rest';
import fs from 'fs';
import path from 'path';

export interface VectorPoint {
  id: string;
  vector: number[];
  payload: Record<string, any>;
}

export interface VectorSearchResult {
  id: string;
  score: number;
  payload: Record<string, any>;
}

export interface VectorStore {
  initCollection(collectionName: string, vectorDim: number): Promise<void>;
  upsert(collectionName: string, points: VectorPoint[]): Promise<void>;
  search(collectionName: string, vector: number[], limit: number, filter?: Record<string, any>): Promise<VectorSearchResult[]>;
  deleteByRepo(collectionName: string, repoId: string): Promise<void>;
}

export function cosineSimilarity(a: number[] | Float32Array, b: number[] | Float32Array): number {
  let dot = 0.0;
  let normA = 0.0;
  let normB = 0.0;
  const len = a.length;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

class QdrantVectorStore implements VectorStore {
  private client: QdrantClient;

  constructor(url: string, apiKey?: string) {
    this.client = new QdrantClient({
      url,
      apiKey: apiKey || undefined,
      checkCompatibility: false,
    });
  }

  async initCollection(collectionName: string, vectorDim: number): Promise<void> {
    try {
      const collections = await this.client.getCollections();
      const exists = collections.collections.some(c => c.name === collectionName);
      if (!exists) {
        await this.client.createCollection(collectionName, {
          vectors: {
            size: vectorDim,
            distance: 'Cosine',
          },
          hnsw_config: {
            m: 16,
            ef_construct: 128,
          },
        });
      }
    } catch (e: any) {
      console.warn(`[Qdrant] Collection init notice: ${e.message}`);
    }
  }

  async upsert(collectionName: string, points: VectorPoint[]): Promise<void> {
    await this.client.upsert(collectionName, {
      wait: true,
      points: points.map(p => ({
        id: p.id,
        vector: p.vector,
        payload: p.payload,
      })),
    });
  }

  async search(
    collectionName: string,
    vector: number[],
    limit: number,
    filter?: Record<string, any>
  ): Promise<VectorSearchResult[]> {
    const qdrantFilter: any = filter ? { must: [] } : undefined;
    if (filter) {
      for (const [key, value] of Object.entries(filter)) {
        qdrantFilter.must.push({
          key,
          match: { value },
        });
      }
    }

    const response = await this.client.query(collectionName, {
      query: vector,
      limit,
      filter: qdrantFilter,
      with_payload: true,
    });

    const points = response.points || [];
    return points.map((r: any) => ({
      id: String(r.id),
      score: r.score,
      payload: (r.payload as Record<string, any>) || {},
    }));
  }

  async deleteByRepo(collectionName: string, repoId: string): Promise<void> {
    await this.client.delete(collectionName, {
      filter: {
        must: [{ key: 'repo_id', match: { value: repoId } }],
      },
    });
  }
}

import { resolveDataPath } from './paths.js';

class EmbeddedVectorStore implements VectorStore {
  private points: Map<string, VectorPoint> = new Map();
  private storageFile: string;

  constructor(dataPath = 'data/cortex_vectors.json') {
    this.storageFile = resolveDataPath(dataPath);
    this.loadFromDisk();
  }

  private loadFromDisk() {
    try {
      if (fs.existsSync(this.storageFile)) {
        const raw = fs.readFileSync(this.storageFile, 'utf-8');
        const list: VectorPoint[] = JSON.parse(raw);
        for (const pt of list) {
          this.points.set(pt.id, pt);
        }
      }
    } catch {
      // fresh start
    }
  }

  private saveToDisk() {
    try {
      const dir = path.dirname(this.storageFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.storageFile, JSON.stringify(Array.from(this.points.values())), 'utf-8');
    } catch (e: any) {
      console.warn(`[EmbeddedVectorStore] save notice: ${e.message}`);
    }
  }

  async initCollection(_collectionName: string, _vectorDim: number): Promise<void> {
    // In-memory collection requires no DDL
  }

  async upsert(_collectionName: string, points: VectorPoint[]): Promise<void> {
    for (const pt of points) {
      this.points.set(pt.id, pt);
    }
    this.saveToDisk();
  }

  async search(
    _collectionName: string,
    vector: number[],
    limit: number,
    filter?: Record<string, any>
  ): Promise<VectorSearchResult[]> {
    const scored: VectorSearchResult[] = [];

    for (const pt of this.points.values()) {
      if (filter) {
        let match = true;
        for (const [k, v] of Object.entries(filter)) {
          if (pt.payload[k] !== v) {
            match = false;
            break;
          }
        }
        if (!match) continue;
      }

      const score = cosineSimilarity(vector, pt.vector);
      scored.push({
        id: pt.id,
        score,
        payload: pt.payload,
      });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  async deleteByRepo(_collectionName: string, repoId: string): Promise<void> {
    for (const [id, pt] of this.points.entries()) {
      if (pt.payload.repo_id === repoId) {
        this.points.delete(id);
      }
    }
    this.saveToDisk();
  }
}

let vectorStoreInstance: VectorStore | null = null;

export async function getVectorStore(): Promise<VectorStore> {
  if (vectorStoreInstance) return vectorStoreInstance;

  const mode = process.env.VECTOR_STORE_MODE || 'embedded';
  const url = process.env.QDRANT_URL || 'http://localhost:6333';
  const apiKey = process.env.QDRANT_API_KEY;

  if (mode === 'qdrant') {
    try {
      const qdrant = new QdrantVectorStore(url, apiKey);
      await qdrant.initCollection(process.env.QDRANT_COLLECTION || 'cortex_code_chunks', 384);
      vectorStoreInstance = qdrant;
    } catch {
      console.warn(`[Cortex Vector] Could not connect to Qdrant at ${url}. Falling back to EmbeddedVectorStore.`);
      vectorStoreInstance = new EmbeddedVectorStore();
    }
  } else {
    vectorStoreInstance = new EmbeddedVectorStore();
  }

  return vectorStoreInstance;
}
