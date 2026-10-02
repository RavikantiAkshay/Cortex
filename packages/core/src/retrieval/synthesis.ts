import { LLMProvider } from './llm-provider.js';
import { RankedResult, Citation } from '../types/index.js';
import { DatabaseAdapter } from '../db/postgres.js';
import { SemanticCache } from '../cache/semantic-cache.js';
import { v4 as uuidv4 } from 'uuid';

export interface SynthesisResult {
  answer: string;
  citations: Citation[];
  cacheHit: boolean;
  tokensUsed: number;
  latencyTotalMs: number;
}

export class SynthesisEngine {
  constructor(
    private llmProvider: LLMProvider,
    private db: DatabaseAdapter,
    private semanticCache?: SemanticCache
  ) {}

  async answerQuestion(
    repoId: string,
    query: string,
    rankedResults: RankedResult[],
    interfaceType: 'web' | 'cli' | 'mcp' = 'web',
    onToken?: (token: string) => void
  ): Promise<SynthesisResult> {
    const startTime = Date.now();

    // 1. Check Semantic Cache
    if (this.semanticCache) {
      const cached = await this.semanticCache.get(query, repoId);
      if (cached) {
        if (onToken) {
          for (const word of cached.answer.split(' ')) {
            onToken(word + ' ');
          }
        }

        const latencyTotalMs = Date.now() - startTime;
        await this.logQuery(repoId, query, true, cached.similarity, [], cached.answer, latencyTotalMs, 0, interfaceType);

        return {
          answer: cached.answer,
          citations: cached.citations,
          cacheHit: true,
          tokensUsed: 0,
          latencyTotalMs,
        };
      }
    }

    // 2. Format Citations and Context
    const citations: Citation[] = rankedResults.map(r => ({
      filePath: r.chunk.filePath,
      startLine: r.chunk.startLine,
      endLine: r.chunk.endLine,
      symbolName: r.chunk.symbolName,
      snippet: r.chunk.content,
    }));

    const contextBlocks = rankedResults
      .map(
        (r, i) =>
          `[Snippet ${i + 1}: ${r.chunk.filePath}:${r.chunk.startLine}-${r.chunk.endLine} (${r.chunk.symbolName || 'Module'})]\n${r.chunk.content}\n`
      )
      .join('\n---\n');

    const systemPrompt = `You are Cortex, a senior codebase intelligence engine.
Answer the developer's question accurately using ONLY the provided code snippets.
CRITICAL RULES:
1. Always cite exact file paths and line ranges in your explanation (e.g. \`src/auth/jwt.strategy.ts:24-68\`).
2. Provide a concise, direct architectural summary before showing any relevant code examples.
3. If the snippets do not contain enough information to answer definitively, state clearly what is known and what is missing. Never fabricate file paths or function names.`;

    const userPrompt = `Codebase Context:\n${contextBlocks}\n\nDeveloper Question:\n${query}`;

    // 3. Generate with LLM
    let answer = '';
    let tokensUsed = 0;

    if (onToken) {
      const res = await this.llmProvider.generateStream(systemPrompt, userPrompt, onToken);
      answer = res.fullText;
      tokensUsed = res.tokensUsed;
    } else {
      answer = await this.llmProvider.generate(systemPrompt, userPrompt);
      tokensUsed = Math.ceil(answer.length / 4);
    }

    const latencyTotalMs = Date.now() - startTime;

    // 4. Save to Semantic Cache
    if (this.semanticCache) {
      await this.semanticCache.set(query, repoId, answer, citations);
    }

    // 5. Log Query
    const chunkIds = rankedResults.map(r => r.chunk.id);
    await this.logQuery(repoId, query, false, undefined, chunkIds, answer, latencyTotalMs, tokensUsed, interfaceType);

    return {
      answer,
      citations,
      cacheHit: false,
      tokensUsed,
      latencyTotalMs,
    };
  }

  private async logQuery(
    repoId: string,
    queryText: string,
    cacheHit: boolean,
    cacheSimilarity: number | undefined,
    chunkIds: string[],
    responseText: string,
    latencyTotalMs: number,
    tokensUsed: number,
    interfaceType: string
  ): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO query_logs 
         (id, repo_id, query_text, cache_hit, cache_similarity, retrieved_chunk_ids, response_text, latency_total_ms, completion_tokens, interface)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          uuidv4(),
          repoId,
          queryText,
          cacheHit,
          cacheSimilarity || null,
          chunkIds,
          responseText,
          latencyTotalMs,
          tokensUsed,
          interfaceType,
        ]
      );
    } catch (e: any) {
      console.warn(`[SynthesisEngine] Telemetry log warning: ${e.message}`);
    }
  }
}
