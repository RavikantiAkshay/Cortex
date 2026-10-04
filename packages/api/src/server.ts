import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import {
  getDatabase,
  getVectorStore,
  getCacheStore,
  getEmbeddingProvider,
  getLLMProvider,
  IndexerCoordinator,
  VectorSearcher,
  KeywordSearcher,
  GraphSearcher,
  HybridRetriever,
  SemanticCache,
  SynthesisEngine,
  EvaluationService,
  QueryLogger,
  DependencyGraphBuilder,
  BenchmarkRunner,
} from '../../core/dist/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load .env: user home config first, then monorepo root as fallback
dotenv.config({ path: path.join(os.homedir(), '.cortex-rag', '.env') });
dotenv.config({ path: path.join(os.homedir(), '.cortex-code', '.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });


import fastifyStatic from '@fastify/static';
import fs from 'fs';

const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
  },
});

await fastify.register(cors, {
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
});

// Serve Web Dashboard if built dist exists
const webDistPath = path.resolve(__dirname, '../../web/dist');
if (fs.existsSync(webDistPath)) {
  await fastify.register(fastifyStatic, {
    root: webDistPath,
    prefix: '/',
    wildcard: false,
  });

  fastify.setNotFoundHandler((request, reply) => {
    if (!request.raw.url?.startsWith('/api/')) {
      return reply.sendFile('index.html');
    }
    reply.status(404).send({ error: { message: `Route ${request.method}:${request.url} not found` } });
  });
}

// Singletons
const db = await getDatabase();
const vectorStore = await getVectorStore();
const cacheStore = await getCacheStore();
const embeddingProvider = getEmbeddingProvider();
const llmProvider = getLLMProvider();

const semanticCache = new SemanticCache(cacheStore, embeddingProvider);
const indexer = new IndexerCoordinator(db, vectorStore, embeddingProvider);
const vectorSearcher = new VectorSearcher(vectorStore, embeddingProvider);
const keywordSearcher = new KeywordSearcher(db);
const graphSearcher = new GraphSearcher(db);
const hybridRetriever = new HybridRetriever(vectorSearcher, keywordSearcher, graphSearcher);
const synthesisEngine = new SynthesisEngine(llmProvider, db, semanticCache);
const evalService = new EvaluationService(db);
const queryLogger = new QueryLogger(db);
const depGraphBuilder = new DependencyGraphBuilder(db);
const benchmarkRunner = new BenchmarkRunner(hybridRetriever, synthesisEngine);

// Health check
fastify.get('/health', async () => {
  return { status: 'healthy', timestamp: new Date().toISOString() };
});

// 1. List all indexed repositories
fastify.get('/api/v1/repos', async () => {
  const repos = await db.query(
    `SELECT * FROM repositories ORDER BY created_at DESC`
  );
  return { data: repos };
});

// 2. Index a repository (local folder or git url)
fastify.post<{
  Body: { path: string; name?: string };
}>('/api/v1/repos', async (request, reply) => {
  const { path: sourcePath, name } = request.body;
  if (!sourcePath) {
    return reply.status(400).send({ error: { message: 'Repository path is required' } });
  }

  // Run indexing
  try {
    const repo = await indexer.indexRepository(sourcePath, name);
    return reply.status(201).send({ data: repo });
  } catch (err: any) {
    fastify.log.error(err);
    return reply.status(500).send({ error: { message: err.message } });
  }
});

// 3. Get repository details
fastify.get<{
  Params: { id: string };
}>('/api/v1/repos/:id', async (request, reply) => {
  const { id } = request.params;
  const repos = await db.query(`SELECT * FROM repositories WHERE id = $1`, [id]);
  if (repos.length === 0) {
    return reply.status(404).send({ error: { message: 'Repository not found' } });
  }
  return { data: repos[0] };
});

// 3b. Delete repository
fastify.delete<{
  Params: { id: string };
}>('/api/v1/repos/:id', async (request, reply) => {
  const { id } = request.params;
  try {
    await indexer.deleteRepository(id);
    return reply.status(200).send({ data: { success: true, id } });
  } catch (err: any) {
    fastify.log.error(err);
    return reply.status(500).send({ error: { message: err.message } });
  }
});

// 3c. Incremental sync repository (Git diff)
fastify.post<{
  Params: { id: string };
}>('/api/v1/repos/:id/sync', async (request, reply) => {
  const { id } = request.params;
  try {
    const repo = await indexer.syncRepository(id);
    return reply.status(200).send({ data: repo });
  } catch (err: any) {
    fastify.log.error(err);
    return reply.status(500).send({ error: { message: err.message } });
  }
});

// 4. Get dependency graph for visualizer canvas
fastify.get<{
  Params: { id: string };
}>('/api/v1/repos/:id/graph', async (request, reply) => {
  const { id } = request.params;
  const graph = await depGraphBuilder.exportGraph(id);
  return { data: graph };
});

// 5. Query codebase with Server-Sent Events (SSE) streaming
fastify.post<{
  Body: { repo_id: string; query: string };
}>('/api/v1/query/stream', async (request, reply) => {
  const { repo_id, query } = request.body;
  if (!repo_id || !query) {
    return reply.status(400).send({ error: { message: 'repo_id and query are required' } });
  }

  reply.raw.setHeader('Content-Type', 'text/event-stream');
  reply.raw.setHeader('Cache-Control', 'no-cache');
  reply.raw.setHeader('Connection', 'keep-alive');
  reply.raw.setHeader('Access-Control-Allow-Origin', '*');

  const sendEvent = (event: string, data: any) => {
    reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // 1. Retrieve ranked chunks
    const retrievalStart = Date.now();
    const rankedResults = await hybridRetriever.retrieve(repo_id, query, 6);
    const retrievalLatency = Date.now() - retrievalStart;

    sendEvent('metadata', {
      retrieved_chunks: rankedResults.length,
      latency_retrieval_ms: retrievalLatency,
    });

    for (const res of rankedResults) {
      sendEvent('citation', {
        file: res.chunk.filePath,
        start_line: res.chunk.startLine,
        end_line: res.chunk.endLine,
        symbol: res.chunk.symbolName,
        score: res.rrfScore,
      });
    }

    // 2. Stream synthesis
    const result = await synthesisEngine.answerQuestion(
      repo_id,
      query,
      rankedResults,
      'web',
      (token: string) => {
        sendEvent('token', { text: token });
      }
    );

    sendEvent('done', {
      cache_hit: result.cacheHit,
      tokens_used: result.tokensUsed,
      latency_total_ms: result.latencyTotalMs,
    });
  } catch (err: any) {
    sendEvent('error', { message: err.message });
  } finally {
    reply.raw.end();
  }
});

// 6. Evaluation metrics endpoint
fastify.get<{
  Querystring: { repo_id?: string };
}>('/api/v1/eval/metrics', async (request, reply) => {
  const repoId = request.query.repo_id;
  if (!repoId) {
    return reply.status(400).send({ error: { message: 'repo_id query parameter is required' } });
  }
  const metrics = await evalService.getMetrics(repoId);
  return { data: metrics };
});

// 7. Run automated 20-question benchmark
fastify.post<{
  Body: { repo_id: string };
}>('/api/v1/eval/benchmark', async (request, reply) => {
  const { repo_id } = request.body;
  if (!repo_id) {
    return reply.status(400).send({ error: { message: 'repo_id is required' } });
  }
  try {
    const report = await benchmarkRunner.runBenchmark(repo_id);
    return reply.status(200).send({ data: report });
  } catch (err: any) {
    fastify.log.error(err);
    return reply.status(500).send({ error: { message: err.message } });
  }
});

// 8. Query Telemetry Audit Logs
fastify.get<{
  Querystring: { repo_id?: string; limit?: string };
}>('/api/v1/eval/logs', async (request, reply) => {
  const repoId = request.query.repo_id;
  const limit = Number(request.query.limit) || 25;
  if (!repoId) {
    return reply.status(400).send({ error: { message: 'repo_id query parameter is required' } });
  }
  const logs = await queryLogger.getRecentLogs(repoId, limit);
  return { data: logs };
});

const port = Number(process.env.PORT) || 4000;
const host = process.env.HOST || '0.0.0.0';

try {
  await fastify.listen({ port, host });
  console.log(`\n🚀 Cortex API Server running at http://${host}:${port}`);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
