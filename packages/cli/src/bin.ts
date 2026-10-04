#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
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
  BenchmarkRunner,
} from '../../core/dist/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(os.homedir(), '.cortex-rag', '.env') });
dotenv.config({ path: path.join(os.homedir(), '.cortex-code', '.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });


const program = new Command();

program
  .name('cortex')
  .description('Cortex — Codebase Intelligence Engine + MCP Server')
  .version('1.0.0');

// 1. cortex index <path>
program
  .command('index')
  .description('Indexes a local repository or remote Git URL')
  .argument('<path>', 'Path to local directory or Git clone URL')
  .option('-n, --name <name>', 'Custom repository name')
  .action(async (targetPath, options) => {
    console.log(chalk.bold.cyan('\n🧠 Cortex Indexer'));
    console.log(chalk.gray(`Target: ${targetPath}\n`));

    const spinner = ora('Initializing databases and indexer...').start();

    try {
      const db = await getDatabase();
      const vectorStore = await getVectorStore();
      const embeddingProvider = getEmbeddingProvider();

      const indexer = new IndexerCoordinator(db, vectorStore, embeddingProvider);

      const repo = await indexer.indexRepository(targetPath, options.name, (step, pct) => {
        spinner.text = `[${pct}%] ${step}`;
      });

      spinner.succeed(chalk.green(`Indexed repository successfully!`));
      console.log(chalk.bold('\nRepository Summary:'));
      console.log(`  ${chalk.cyan('ID:')}          ${repo.id}`);
      console.log(`  ${chalk.cyan('Name:')}        ${repo.name}`);
      console.log(`  ${chalk.cyan('Total Files:')} ${repo.totalFiles}`);
      console.log(`  ${chalk.cyan('Chunks:')}      ${repo.totalChunks}`);
      console.log(`  ${chalk.cyan('Path:')}        ${repo.localPath}\n`);
      console.log(chalk.gray(`Run \`cortex query "your question" --repo ${repo.id}\` to test retrieval.`));
      process.exit(0);
    } catch (err: any) {
      spinner.fail(chalk.red(`Indexing failed: ${err.message}`));
      process.exit(1);
    }
  });

// 1b. cortex sync [repo]
program
  .command('sync')
  .description('Incrementally synchronizes an indexed repository using Git diff')
  .argument('[repo]', 'Repository UUID or local directory path (defaults to most recently indexed)')
  .action(async (repoTarget) => {
    console.log(chalk.bold.cyan('\n⚡ Cortex Incremental Sync (Git Diff)'));

    const spinner = ora('Initializing databases and indexer...').start();

    try {
      const db = await getDatabase();
      const vectorStore = await getVectorStore();
      const embeddingProvider = getEmbeddingProvider();
      const indexer = new IndexerCoordinator(db, vectorStore, embeddingProvider);

      let repoId = repoTarget;
      if (!repoId) {
        const recent = await db.query(
          `SELECT id, name, local_path FROM repositories WHERE status = 'indexed' ORDER BY indexed_at DESC LIMIT 1`
        );
        if (recent.length === 0) {
          spinner.fail(chalk.red('No indexed repositories found. Run `cortex index <path>` first.'));
          process.exit(1);
        }
        repoId = recent[0].id;
      } else {
        const byPath = await db.query(
          `SELECT id FROM repositories WHERE id = $1 OR local_path = $2 LIMIT 1`,
          [repoTarget, path.resolve(repoTarget).replace(/\\/g, '/')]
        );
        if (byPath.length > 0) {
          repoId = byPath[0].id;
        }
      }

      spinner.text = 'Analyzing Git diff changes...';
      const repo = await indexer.syncRepository(repoId, (step, pct) => {
        spinner.text = `[${pct}%] ${step}`;
      });

      spinner.succeed(chalk.green(`Synchronized repository "${repo.name}" successfully!`));
      console.log(chalk.bold('\nUpdated Summary:'));
      console.log(`  ${chalk.cyan('ID:')}          ${repo.id}`);
      console.log(`  ${chalk.cyan('Total Files:')} ${repo.totalFiles}`);
      console.log(`  ${chalk.cyan('Chunks:')}      ${repo.totalChunks}`);
      if (repo.commitHash) {
        console.log(`  ${chalk.cyan('Commit:')}      ${repo.commitHash.slice(0, 8)}`);
      }
      console.log('');
      process.exit(0);
    } catch (err: any) {
      spinner.fail(chalk.red(`Sync failed: ${err.message}`));
      process.exit(1);
    }
  });

// 2. cortex query <prompt>
program
  .command('query')
  .description('Queries an indexed repository using hybrid search and LLM synthesis')
  .argument('<prompt>', 'Question about the codebase')
  .option('-r, --repo <id>', 'Repository UUID (defaults to most recently indexed)')
  .action(async (prompt, options) => {
    console.log(chalk.bold.cyan('\n🧠 Cortex Query'));
    console.log(chalk.gray(`Prompt: "${prompt}"\n`));

    const spinner = ora('Searching knowledge base...').start();

    try {
      const db = await getDatabase();
      let repoId = options.repo;

      if (!repoId) {
        const recent = await db.query(
          `SELECT id, name FROM repositories WHERE status = 'indexed' ORDER BY indexed_at DESC LIMIT 1`
        );
        if (recent.length === 0) {
          spinner.fail(chalk.red('No indexed repositories found. Run `cortex index <path>` first.'));
          process.exit(1);
        }
        repoId = recent[0].id;
        spinner.text = `Using repository: ${recent[0].name}`;
      }

      const vectorStore = await getVectorStore();
      const cacheStore = await getCacheStore();
      const embeddingProvider = getEmbeddingProvider();
      const llmProvider = getLLMProvider();

      const semanticCache = new SemanticCache(cacheStore, embeddingProvider);
      const vectorSearcher = new VectorSearcher(vectorStore, embeddingProvider);
      const keywordSearcher = new KeywordSearcher(db);
      const graphSearcher = new GraphSearcher(db);
      const hybridRetriever = new HybridRetriever(vectorSearcher, keywordSearcher, graphSearcher);
      const synthesisEngine = new SynthesisEngine(llmProvider, db, semanticCache);

      // Retrieve
      const rankedResults = await hybridRetriever.retrieve(repoId, prompt, 5);
      spinner.stop();

      console.log(chalk.bold.yellow('📂 Grounded Citations:'));
      for (const res of rankedResults) {
        const symbolStr = res.chunk.symbolName ? ` (${res.chunk.symbolName})` : '';
        console.log(
          `  • ${chalk.green(res.chunk.filePath)}:${chalk.cyan(res.chunk.startLine + '-' + res.chunk.endLine)}${symbolStr}`
        );
      }
      console.log('');

      console.log(chalk.bold.blue('💬 Cortex Answer:'));
      process.stdout.write(chalk.white(''));

      const result = await synthesisEngine.answerQuestion(
        repoId,
        prompt,
        rankedResults,
        'cli',
        (token: string) => {
          process.stdout.write(token);
        }
      );

      console.log(chalk.gray(`\n\n[Latency: ${result.latencyTotalMs}ms | Cache: ${result.cacheHit ? 'HIT' : 'MISS'}]\n`));
      process.exit(0);
    } catch (err: any) {
      spinner.fail(chalk.red(`Query failed: ${err.message}`));
      process.exit(1);
    }
  });

// 3. cortex repos
program
  .command('repos')
  .description('Lists all indexed repositories')
  .action(async () => {
    const db = await getDatabase();
    const repos = await db.query(`SELECT id, name, total_files, total_chunks, status, indexed_at FROM repositories`);

    console.log(chalk.bold.cyan('\nIndexed Repositories:'));
    if (repos.length === 0) {
      console.log(chalk.gray('  No repositories indexed yet. Use `cortex index <path>`.'));
    } else {
      for (const r of repos) {
        console.log(
          `  • ${chalk.bold(r.name)} [${chalk.cyan(r.id)}] — ${r.total_files} files, ${r.total_chunks} chunks (${r.status})`
        );
      }
    }
    console.log('');
    process.exit(0);
  });

// 4. cortex serve
program
  .command('serve')
  .description('Starts the Fastify API and background worker daemon')
  .action(async () => {
    const serverModule = path.resolve(__dirname, '../../api/dist/server.js');
    await import(serverModule);
  });

// 5. cortex mcp
program
  .command('mcp')
  .description('Runs the Model Context Protocol (MCP) server over stdio')
  .action(async () => {
    const mcpModule = path.resolve(__dirname, '../../mcp/dist/stdio.js');
    await import(mcpModule);
  });

// 6. cortex eval
program
  .command('eval')
  .description('Runs the standardized 20-question retrieval and groundedness benchmark suite')
  .option('-r, --repo <id>', 'Repository UUID (defaults to most recently indexed)')
  .action(async (options) => {
    console.log(chalk.bold.cyan('\n🧠 Cortex Evaluation & Telemetry Benchmark'));
    const spinner = ora('Initializing retriever and benchmark runner...').start();

    try {
      const db = await getDatabase();
      let repoId = options.repo;

      if (!repoId) {
        const recent = await db.query(
          `SELECT id, name FROM repositories WHERE status = 'indexed' ORDER BY indexed_at DESC LIMIT 1`
        );
        if (recent.length === 0) {
          spinner.fail(chalk.red('No indexed repositories found. Run `cortex index <path>` first.'));
          process.exit(1);
        }
        repoId = recent[0].id;
        spinner.text = `Running benchmark against: ${recent[0].name}`;
      }

      const vectorStore = await getVectorStore();
      const cacheStore = await getCacheStore();
      const embeddingProvider = getEmbeddingProvider();
      const llmProvider = getLLMProvider();

      const semanticCache = new SemanticCache(cacheStore, embeddingProvider);
      const vectorSearcher = new VectorSearcher(vectorStore, embeddingProvider);
      const keywordSearcher = new KeywordSearcher(db);
      const graphSearcher = new GraphSearcher(db);
      const hybridRetriever = new HybridRetriever(vectorSearcher, keywordSearcher, graphSearcher);
      const synthesisEngine = new SynthesisEngine(llmProvider, db, semanticCache);

      const runner = new BenchmarkRunner(hybridRetriever, synthesisEngine);

      spinner.stop();
      console.log(chalk.gray(`Executing 20 standardized codebase queries...\n`));

      const report = await runner.runBenchmark(repoId, undefined, (curr: number, total: number, res: any) => {
        const status = res.passed ? chalk.green('PASS') : chalk.yellow('WARN');
        console.log(
          `  [${curr}/${total}] ${status} ${chalk.bold(res.id)}: "${chalk.white(res.query.substring(0, 48))}..." (${res.latencyMs}ms)`
        );
      });

      console.log(chalk.bold.cyan('\n📊 Benchmark Aggregate Scorecard:'));
      console.log(`  ${chalk.cyan('Total Test Cases:')}       ${report.totalCases}`);
      console.log(`  ${chalk.cyan('Passed Cases:')}           ${chalk.green(report.passedCases)} / ${report.totalCases}`);
      console.log(`  ${chalk.cyan('Precision@5:')}            ${chalk.bold(Math.round(report.aggregatePrecisionAtK * 100))}%`);
      console.log(`  ${chalk.cyan('Mean Reciprocal Rank:')}    ${report.meanReciprocalRank}`);
      console.log(`  ${chalk.cyan('Average Groundedness:')}    ${chalk.bold(Math.round(report.averageGroundedness * 100))}% (Target: >=95%)`);
      console.log(`  ${chalk.cyan('Latency (p50 / p95):')}     ${report.latency.p50Ms}ms / ${report.latency.p95Ms}ms\n`);

      process.exit(0);
    } catch (err: any) {
      spinner.fail(chalk.red(`Evaluation failed: ${err.message}`));
      process.exit(1);
    }
  });

// 7. cortex remove <id>
program
  .command('remove')
  .alias('delete')
  .description('Removes an indexed repository and its vectors/metadata')
  .argument('<id>', 'Repository UUID or name')
  .action(async (targetId) => {
    const spinner = ora('Deleting repository...').start();
    try {
      const db = await getDatabase();
      const repos = await db.query(
        `SELECT id, name FROM repositories WHERE id = $1 OR name = $1`,
        [targetId]
      );
      if (repos.length === 0) {
        spinner.fail(chalk.red(`Repository "${targetId}" not found.`));
        process.exit(1);
      }

      const repo = repos[0];
      const vectorStore = await getVectorStore();
      const embeddingProvider = getEmbeddingProvider();
      const indexer = new IndexerCoordinator(db, vectorStore, embeddingProvider);

      await indexer.deleteRepository(repo.id);
      spinner.succeed(chalk.green(`Successfully removed repository "${repo.name}" (${repo.id}).`));
      process.exit(0);
    } catch (err: any) {
      spinner.fail(chalk.red(`Failed to remove repository: ${err.message}`));
      process.exit(1);
    }
  });

program.parse(process.argv);
