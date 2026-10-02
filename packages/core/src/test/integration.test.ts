import { ReciprocalRankFusion } from '../retrieval/rrf.js';
import { GroundednessEvaluator } from '../eval/groundedness.js';
import { SemanticChunker } from '../indexer/chunker.js';
import { ScoredChunk, RankedResult, Citation, SourceFile, ExtractedSymbol } from '../types/index.js';

async function runTestSuite() {
  console.log('\n========================================');
  console.log('🧪 Running Cortex Verification Test Suite');
  console.log('========================================\n');

  let passed = 0;
  let failed = 0;

  function assert(name: string, condition: boolean, details?: string) {
    if (condition) {
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${name} ${details ? `(${details})` : ''}`);
      failed++;
    }
  }

  // Test 1: RRF Algorithm Validation
  try {
    const denseCandidates: ScoredChunk[] = [
      {
        chunk: {
          id: 'c1',
          repoId: 'r1',
          fileId: 'f1',
          filePath: 'auth.ts',
          startLine: 1,
          endLine: 20,
          content: 'export function verifyAuth() {}',
          tokenCount: 10,
          vectorId: 'v1',
          createdAt: new Date(),
        },
        score: 0.95,
        source: 'dense',
      },
      {
        chunk: {
          id: 'c2',
          repoId: 'r1',
          fileId: 'f2',
          filePath: 'jwt.ts',
          startLine: 1,
          endLine: 30,
          content: 'export function signJwt() {}',
          tokenCount: 15,
          vectorId: 'v2',
          createdAt: new Date(),
        },
        score: 0.88,
        source: 'dense',
      },
    ];

    const keywordCandidates: ScoredChunk[] = [
      {
        chunk: {
          id: 'c2',
          repoId: 'r1',
          fileId: 'f2',
          filePath: 'jwt.ts',
          startLine: 1,
          endLine: 30,
          content: 'export function signJwt() {}',
          tokenCount: 15,
          vectorId: 'v2',
          createdAt: new Date(),
        },
        score: 12.5,
        source: 'bm25',
      },
      {
        chunk: {
          id: 'c3',
          repoId: 'r1',
          fileId: 'f3',
          filePath: 'routes.ts',
          startLine: 1,
          endLine: 40,
          content: 'export const router = {}',
          tokenCount: 12,
          vectorId: 'v3',
          createdAt: new Date(),
        },
        score: 8.2,
        source: 'bm25',
      },
    ];

    const graphCandidates: ScoredChunk[] = [];

    const fused = ReciprocalRankFusion.fuse(denseCandidates, keywordCandidates, graphCandidates, 6);

    assert('RRF fuses multiple search branches', fused.length === 3);
    assert('RRF ranks items appearing in multiple branches highest', fused[0].chunk.id === 'c2');
    assert('RRF scores are descending', fused[0].rrfScore >= fused[1].rrfScore && fused[1].rrfScore >= fused[2].rrfScore);
  } catch (err: any) {
    assert('RRF test execution', false, err.message);
  }

  // Test 2: Semantic Chunker
  try {
    const mockFile: SourceFile = {
      id: 'f1',
      repoId: 'r1',
      path: 'src/auth.ts',
      language: 'typescript',
      lineCount: 7,
      sizeBytes: 150,
      contentHash: 'xyz',
      createdAt: new Date(),
    };

    const sampleCode = `import { db } from './db.js';\n\nexport class AuthService {\n  login() {\n    return 'ok';\n  }\n}\n`;
    const symbols: ExtractedSymbol[] = [
      {
        id: 's1',
        fileId: 'f1',
        repoId: 'r1',
        name: 'AuthService',
        kind: 'class',
        startLine: 3,
        endLine: 7,
        signature: 'class AuthService',
        createdAt: new Date(),
      },
    ];

    const chunks = SemanticChunker.chunkFile(mockFile, sampleCode, symbols);
    assert('Semantic chunker divides source into valid chunks', chunks.length >= 1);
    assert('Chunks contain breadcrumbs', chunks[0].content.includes('// File: src/auth.ts'));
    assert('Chunks preserve valid line ranges', chunks[0].startLine >= 1 && chunks[0].endLine >= chunks[0].startLine);
  } catch (err: any) {
    assert('Semantic chunker test execution', false, err.message);
  }

  // Test 3: Groundedness Evaluator
  try {
    const evaluator = new GroundednessEvaluator();
    const mockChunks: RankedResult[] = [
      {
        chunk: {
          id: 'chunk-1',
          repoId: 'repo-1',
          fileId: 'f1',
          filePath: 'packages/core/src/auth.ts',
          startLine: 10,
          endLine: 45,
          content: 'export function verifyToken() { ... }',
          tokenCount: 20,
          vectorId: 'v1',
          createdAt: new Date(),
        },
        rrfScore: 0.03,
        ranks: { dense: 1 },
      },
    ];

    const groundedAnswer = 'Authentication is handled in `packages/core/src/auth.ts:15-30` by checking JWT signatures.';
    const citations: Citation[] = [
      {
        filePath: 'packages/core/src/auth.ts',
        startLine: 10,
        endLine: 45,
        symbolName: 'verifyToken',
        snippet: 'export function verifyToken()',
      },
    ];

    const report = evaluator.evaluate(groundedAnswer, citations, mockChunks);
    assert('Groundedness evaluator scores accurate citations high', report.score >= 0.95);
    assert('Zero hallucinations detected for supported lines', report.hallucinatedCitations.length === 0);

    // Hallucination test
    const hallucinatedAnswer = 'Check `secret/unknown_file.ts:100-200` for passwords.';
    const badReport = evaluator.evaluate(hallucinatedAnswer, [], mockChunks);
    assert('Groundedness evaluator flags unsupported citations', badReport.hallucinatedCitations.length > 0);
  } catch (err: any) {
    assert('Groundedness evaluator test execution', false, err.message);
  }

  console.log('\n----------------------------------------');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('========================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTestSuite();
