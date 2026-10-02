import { DatabaseAdapter } from '../db/postgres.js';
import { v4 as uuidv4 } from 'uuid';

export interface QueryLogEntry {
  id?: string;
  repoId: string;
  queryText: string;
  cacheHit: boolean;
  cacheSimilarity?: number;
  retrievedChunkIds: string[];
  responseText: string;
  latencyTotalMs: number;
  promptTokens?: number;
  completionTokens: number;
  interfaceType: 'web' | 'cli' | 'mcp' | 'eval';
}

export class QueryLogger {
  constructor(private db: DatabaseAdapter) {}

  async log(entry: QueryLogEntry): Promise<string> {
    const id = entry.id || uuidv4();
    try {
      await this.db.query(
        `INSERT INTO query_logs 
         (id, repo_id, query_text, cache_hit, cache_similarity, retrieved_chunk_ids, response_text, latency_total_ms, prompt_tokens, completion_tokens, interface)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          id,
          entry.repoId,
          entry.queryText,
          entry.cacheHit,
          entry.cacheSimilarity ?? null,
          entry.retrievedChunkIds,
          entry.responseText,
          entry.latencyTotalMs,
          entry.promptTokens ?? 0,
          entry.completionTokens,
          entry.interfaceType,
        ]
      );
    } catch {
      // In embedded or lightweight mode, gracefully proceed if table is busy
    }
    return id;
  }

  async getRecentLogs(repoId: string, limit: number = 50): Promise<any[]> {
    try {
      return await this.db.query(
        `SELECT * FROM query_logs WHERE repo_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [repoId, limit]
      );
    } catch {
      return [];
    }
  }
}
