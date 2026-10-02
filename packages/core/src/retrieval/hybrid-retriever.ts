import { VectorSearcher } from './vector-search.js';
import { KeywordSearcher } from './keyword-search.js';
import { GraphSearcher } from './graph-search.js';
import { ReciprocalRankFusion } from './rrf.js';
import { RankedResult } from '../types/index.js';

export class HybridRetriever {
  constructor(
    private vectorSearcher: VectorSearcher,
    private keywordSearcher: KeywordSearcher,
    private graphSearcher: GraphSearcher
  ) {}

  async retrieve(repoId: string, query: string, limit = 6): Promise<RankedResult[]> {
    // Run all 3 retrieval branches in parallel
    const [denseResults, bm25Results, graphResults] = await Promise.all([
      this.vectorSearcher.search(repoId, query, 20).catch(() => []),
      this.keywordSearcher.search(repoId, query, 20).catch(() => []),
      this.graphSearcher.search(repoId, query, 10).catch(() => []),
    ]);

    // Reciprocal Rank Fusion
    return ReciprocalRankFusion.fuse(denseResults, bm25Results, graphResults, limit);
  }
}
