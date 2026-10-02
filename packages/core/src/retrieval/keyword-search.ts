import { DatabaseAdapter } from '../db/postgres.js';
import { ScoredChunk, CodeChunk } from '../types/index.js';

export class KeywordSearcher {
  constructor(private db: DatabaseAdapter) {}

  async search(repoId: string, query: string, limit = 20): Promise<ScoredChunk[]> {
    // Extract keywords
    const keywords = query
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(k => k.length > 2)
      .slice(0, 8);

    if (keywords.length === 0) return [];

    let rows: any[] = [];

    try {
      // Try full-text search
      const formattedQuery = keywords.join(' | ');
      rows = await this.db.query(
        `SELECT c.*, f.path as file_path, s.name as symbol_name, s.kind as symbol_kind,
                ts_rank(c.tsv_content, to_tsquery('english', $1)) as rank
         FROM chunks c
         JOIN files f ON c.file_id = f.id
         LEFT JOIN symbols s ON c.symbol_id = s.id
         WHERE c.repo_id = $2 AND c.tsv_content @@ to_tsquery('english', $1)
         ORDER BY rank DESC
         LIMIT $3`,
        [formattedQuery, repoId, limit]
      );
    } catch {
      // Fallback: ILIKE search across content
      const conditions = keywords.map((_, i) => `c.content ILIKE $${i + 3}`).join(' OR ');
      const params = [repoId, limit, ...keywords.map(k => `%${k}%`)];

      rows = await this.db.query(
        `SELECT c.*, f.path as file_path, s.name as symbol_name, s.kind as symbol_kind, 1.0 as rank
         FROM chunks c
         JOIN files f ON c.file_id = f.id
         LEFT JOIN symbols s ON c.symbol_id = s.id
         WHERE c.repo_id = $1 AND (${conditions})
         LIMIT $2`,
        params
      );
    }

    return rows.map((r, idx) => {
      const chunk: CodeChunk = {
        id: r.id,
        repoId: r.repo_id,
        fileId: r.file_id,
        symbolId: r.symbol_id,
        filePath: r.file_path,
        symbolName: r.symbol_name,
        symbolKind: r.symbol_kind,
        content: r.content,
        startLine: r.start_line,
        endLine: r.end_line,
        tokenCount: r.token_count || Math.ceil(r.content.length / 4),
        vectorId: r.vector_id,
        createdAt: new Date(),
      };

      return {
        chunk,
        score: r.rank || 1.0 / (idx + 1),
        source: 'bm25' as const,
      };
    });
  }
}
