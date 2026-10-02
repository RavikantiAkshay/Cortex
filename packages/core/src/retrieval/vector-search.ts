import { VectorStore } from '../db/vector-store.js';
import { EmbeddingProvider } from '../indexer/embeddings.js';
import { ScoredChunk, CodeChunk } from '../types/index.js';

export class VectorSearcher {
  constructor(
    private vectorStore: VectorStore,
    private embeddingProvider: EmbeddingProvider
  ) {}

  async search(repoId: string, query: string, limit = 20): Promise<ScoredChunk[]> {
    const queryVector = await this.embeddingProvider.embed(query);
    const collectionName = process.env.QDRANT_COLLECTION || 'cortex_code_chunks';

    const results = await this.vectorStore.search(collectionName, queryVector, limit, {
      repo_id: repoId,
    });

    return results.map(r => {
      const chunk: CodeChunk = {
        id: r.payload.chunk_id,
        repoId: r.payload.repo_id,
        fileId: r.payload.file_id || '',
        symbolId: r.payload.symbol_id || null,
        filePath: r.payload.file_path,
        symbolName: r.payload.symbol_name || null,
        symbolKind: r.payload.symbol_kind || null,
        content: r.payload.content,
        startLine: r.payload.start_line,
        endLine: r.payload.end_line,
        tokenCount: Math.ceil((r.payload.content || '').length / 4),
        vectorId: r.id,
        createdAt: new Date(),
      };

      return {
        chunk,
        score: r.score,
        source: 'dense' as const,
      };
    });
  }
}
