import { DatabaseAdapter } from '../db/postgres.js';
import { ScoredChunk, CodeChunk } from '../types/index.js';

export class GraphSearcher {
  constructor(private db: DatabaseAdapter) {}

  async search(repoId: string, query: string, limit = 10): Promise<ScoredChunk[]> {
    // Extract potential symbol candidates (camelCase, PascalCase, or snake_case tokens)
    const tokens = query
      .split(/[\s,()]+/)
      .map(t => t.trim())
      .filter(t => /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(t) && t.length > 2);

    if (tokens.length === 0) return [];

    const tokenParams = tokens.map((_, i) => `$${i + 2}`).join(', ');
    const sql = `
      SELECT c.*, f.path as file_path, s.name as symbol_name, s.kind as symbol_kind
      FROM chunks c
      JOIN files f ON c.file_id = f.id
      JOIN symbols s ON c.symbol_id = s.id
      WHERE c.repo_id = $1 AND s.name IN (${tokenParams})
      UNION
      SELECT c.*, f.path as file_path, s.name as symbol_name, s.kind as symbol_kind
      FROM chunks c
      JOIN files f ON c.file_id = f.id
      LEFT JOIN symbols s ON c.symbol_id = s.id
      JOIN dependency_edges e ON e.source_file_id = f.id
      WHERE c.repo_id = $1 AND e.target_symbol_name IN (${tokenParams})
      LIMIT $${tokens.length + 2}
    `;

    const rows = await this.db.query(sql, [repoId, ...tokens, limit]);

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
        score: 1.0 / (idx + 1),
        source: 'graph' as const,
      };
    });
  }
}
