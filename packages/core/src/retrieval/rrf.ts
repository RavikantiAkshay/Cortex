import { ScoredChunk, RankedResult, CodeChunk } from '../types/index.js';

export class ReciprocalRankFusion {
  private static K = 60; // Smoothing constant

  static fuse(
    denseResults: ScoredChunk[],
    bm25Results: ScoredChunk[],
    graphResults: ScoredChunk[],
    topN = 6
  ): RankedResult[] {
    const scoreMap = new Map<
      string,
      {
        chunk: CodeChunk;
        totalScore: number;
        ranks: { dense?: number; bm25?: number; graph?: number };
      }
    >();

    const applyRanking = (
      list: ScoredChunk[],
      weight: number,
      sourceKey: 'dense' | 'bm25' | 'graph'
    ) => {
      list.forEach((item, index) => {
        const rank = index + 1;
        const chunkId = item.chunk.id;
        const current = scoreMap.get(chunkId) || {
          chunk: item.chunk,
          totalScore: 0,
          ranks: {},
        };

        current.totalScore += weight / (this.K + rank);
        current.ranks[sourceKey] = rank;
        scoreMap.set(chunkId, current);
      });
    };

    applyRanking(denseResults, 1.0, 'dense');
    applyRanking(bm25Results, 0.8, 'bm25');
    applyRanking(graphResults, 0.9, 'graph');

    const sorted = Array.from(scoreMap.values()).sort(
      (a, b) => b.totalScore - a.totalScore
    );

    return sorted.slice(0, topN).map(item => ({
      chunk: item.chunk,
      rrfScore: item.totalScore,
      ranks: item.ranks,
    }));
  }
}
