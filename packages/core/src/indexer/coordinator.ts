import fs from 'fs';
import path from 'path';
import { DatabaseAdapter } from '../db/postgres.js';
import { VectorStore } from '../db/vector-store.js';
import { EmbeddingProvider } from './embeddings.js';
import { FileCrawler } from './git-cloner.js';
import { SymbolExtractor } from './symbol-extractor.js';
import { DependencyGraphBuilder } from './dep-graph.js';
import { SemanticChunker } from './chunker.js';
import { Repository, SourceFile, CodeChunk } from '../types/index.js';
import { v4 as uuidv4 } from 'uuid';
import { resolveDataPath } from '../db/paths.js';

export interface IndexProgressCallback {
  (step: string, percent: number, detail?: string): void;
}

export class IndexerCoordinator {
  constructor(
    private db: DatabaseAdapter,
    private vectorStore: VectorStore,
    private embeddingProvider: EmbeddingProvider
  ) {}

  async indexRepository(
    sourcePathOrUrl: string,
    repoName?: string,
    onProgress?: IndexProgressCallback
  ): Promise<Repository> {
    const isRemote = sourcePathOrUrl.startsWith('http://') || sourcePathOrUrl.startsWith('https://');
    let localDir = sourcePathOrUrl;
    const name = repoName || path.basename(sourcePathOrUrl).replace(/\.git$/, '');
    const repoId = uuidv4();

    if (isRemote) {
      onProgress?.('Cloning remote Git repository...', 5);
      const tempDir = resolveDataPath(`data/temp_repos/${repoId}`);
      localDir = FileCrawler.cloneGitRepo(sourcePathOrUrl, tempDir);
    }

    onProgress?.('Initializing repository metadata...', 10);
    const repo: Repository = {
      id: repoId,
      name,
      remoteUrl: isRemote ? sourcePathOrUrl : undefined,
      localPath: localDir,
      defaultBranch: 'main',
      status: 'indexing',
      totalFiles: 0,
      totalChunks: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await this.db.query(
      `INSERT INTO repositories (id, name, remote_url, local_path, default_branch, status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [repo.id, repo.name, repo.remoteUrl || null, repo.localPath, repo.defaultBranch, repo.status]
    );

    // 1. Crawl files
    onProgress?.('Crawling files and detecting languages...', 20);
    const crawledFiles = FileCrawler.crawl({ repoId, targetDir: localDir });
    const allSourceFiles: SourceFile[] = crawledFiles.map(c => c.file);

    // 2. Persist files
    onProgress?.(`Found ${allSourceFiles.length} source files. Parsing AST symbols...`, 30);
    for (const { file } of crawledFiles) {
      await this.db.query(
        `INSERT INTO files (id, repo_id, path, language, line_count, size_bytes, content_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [file.id, file.repoId, file.path, file.language, file.lineCount, file.sizeBytes, file.contentHash]
      );
    }

    // 3. Extract symbols & imports
    const depGraphBuilder = new DependencyGraphBuilder(this.db);
    const allChunks: CodeChunk[] = [];

    let processedCount = 0;
    for (const { file, content } of crawledFiles) {
      const { symbols, imports } = SymbolExtractor.extract(content, file.language, file.id, repoId);

      // Persist symbols
      for (const sym of symbols) {
        await this.db.query(
          `INSERT INTO symbols (id, file_id, repo_id, name, kind, signature, start_line, end_line)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [sym.id, sym.fileId, sym.repoId, sym.name, sym.kind, sym.signature || null, sym.startLine, sym.endLine]
        );
      }

      // Build dependency edges
      await depGraphBuilder.buildEdges(repoId, file, imports, allSourceFiles);

      // Semantic chunking
      const chunks = SemanticChunker.chunkFile(file, content, symbols);
      allChunks.push(...chunks);

      processedCount++;
      if (processedCount % 10 === 0 || processedCount === crawledFiles.length) {
        const pct = 30 + Math.floor((processedCount / crawledFiles.length) * 30);
        onProgress?.(`Extracted symbols and chunked ${processedCount}/${crawledFiles.length} files...`, pct);
      }
    }

    // 4. Generate embeddings & upsert vectors
    onProgress?.(`Generating embeddings for ${allChunks.length} semantic chunks...`, 65);
    const collectionName = process.env.QDRANT_COLLECTION || 'cortex_code_chunks';
    await this.vectorStore.initCollection(collectionName, this.embeddingProvider.dimension);

    const BATCH_SIZE = 25;
    for (let i = 0; i < allChunks.length; i += BATCH_SIZE) {
      const batch = allChunks.slice(i, i + BATCH_SIZE);
      const texts = batch.map(c => c.content);
      const vectors = await this.embeddingProvider.embedBatch(texts);

      const points = batch.map((chunk, idx) => ({
        id: chunk.vectorId,
        vector: vectors[idx],
        payload: {
          chunk_id: chunk.id,
          repo_id: chunk.repoId,
          file_path: chunk.filePath,
          symbol_name: chunk.symbolName,
          symbol_kind: chunk.symbolKind,
          start_line: chunk.startLine,
          end_line: chunk.endLine,
          content: chunk.content,
        },
      }));

      await this.vectorStore.upsert(collectionName, points);

      // Persist chunk metadata to PostgreSQL
      for (const chunk of batch) {
        await this.db.query(
          `INSERT INTO chunks (id, repo_id, file_id, symbol_id, content, start_line, end_line, token_count, vector_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            chunk.id,
            chunk.repoId,
            chunk.fileId,
            chunk.symbolId || null,
            chunk.content,
            chunk.startLine,
            chunk.endLine,
            chunk.tokenCount,
            chunk.vectorId,
          ]
        );
      }

      const pct = 65 + Math.floor((i / allChunks.length) * 30);
      onProgress?.(`Embedded and indexed ${Math.min(i + BATCH_SIZE, allChunks.length)}/${allChunks.length} chunks...`, pct);
    }

    // 5. Complete repository indexing
    onProgress?.('Finalizing index...', 98);
    const now = new Date();
    await this.db.query(
      `UPDATE repositories 
       SET status = 'indexed', total_files = $1, total_chunks = $2, indexed_at = $3, updated_at = $3
       WHERE id = $4`,
      [allSourceFiles.length, allChunks.length, now, repoId]
    );

    repo.status = 'indexed';
    repo.totalFiles = allSourceFiles.length;
    repo.totalChunks = allChunks.length;
    repo.indexedAt = now;

    onProgress?.(`Indexing complete! Total: ${allSourceFiles.length} files, ${allChunks.length} chunks.`, 100);
    return repo;
  }

  async deleteRepository(repoId: string): Promise<void> {
    const collectionName = process.env.QDRANT_COLLECTION || 'cortex_code_chunks';
    try {
      await this.vectorStore.deleteByRepo(collectionName, repoId);
    } catch (e: any) {
      console.warn(`[IndexerCoordinator] Vector deletion warning: ${e.message}`);
    }

    await this.db.query(`DELETE FROM chunks WHERE repo_id = $1`, [repoId]);
    await this.db.query(`DELETE FROM symbols WHERE repo_id = $1`, [repoId]);
    await this.db.query(`DELETE FROM dependency_edges WHERE repo_id = $1`, [repoId]);
    await this.db.query(`DELETE FROM files WHERE repo_id = $1`, [repoId]);
    await this.db.query(`DELETE FROM query_logs WHERE repo_id = $1`, [repoId]);
    await this.db.query(`DELETE FROM repositories WHERE id = $1`, [repoId]);
  }
}

