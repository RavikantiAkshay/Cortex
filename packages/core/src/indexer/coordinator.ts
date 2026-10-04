import fs from 'fs';
import path from 'path';
import { DatabaseAdapter } from '../db/postgres.js';
import { VectorStore } from '../db/vector-store.js';
import { EmbeddingProvider } from './embeddings.js';
import { FileCrawler, GitUtils } from './git-cloner.js';
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

    // Check if an existing repository for this path or remote URL is already indexed
    const normalizedLocal = path.resolve(localDir).replace(/\\/g, '/');
    const existing = await this.db.query(
      `SELECT * FROM repositories 
       WHERE local_path = $1 OR local_path = $2 OR (remote_url IS NOT NULL AND remote_url = $3)
       LIMIT 1`,
      [localDir, normalizedLocal, sourcePathOrUrl]
    );

    if (existing.length > 0) {
      onProgress?.(`Existing repository found (${existing[0].name}). Checking for changes via Git diff...`, 5);
      return this.syncRepository(existing[0].id, onProgress);
    }

    const repoId = uuidv4();

    if (isRemote) {
      onProgress?.('Cloning remote Git repository...', 5);
      const tempDir = resolveDataPath(`data/temp_repos/${repoId}`);
      localDir = FileCrawler.cloneGitRepo(sourcePathOrUrl, tempDir);
    }

    const currentCommit = GitUtils.getCurrentCommit(localDir);

    onProgress?.('Initializing repository metadata...', 10);
    const repo: Repository = {
      id: repoId,
      name,
      remoteUrl: isRemote ? sourcePathOrUrl : undefined,
      localPath: localDir,
      defaultBranch: 'main',
      commitHash: currentCommit || undefined,
      status: 'indexing',
      totalFiles: 0,
      totalChunks: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await this.db.query(
      `INSERT INTO repositories (id, name, remote_url, local_path, default_branch, commit_hash, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [repo.id, repo.name, repo.remoteUrl || null, repo.localPath, repo.defaultBranch, repo.commitHash || null, repo.status]
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

      // Persist chunk metadata to database
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
       SET status = 'indexed', total_files = $1, total_chunks = $2, commit_hash = $3, indexed_at = $4, updated_at = $4
       WHERE id = $5`,
      [allSourceFiles.length, allChunks.length, currentCommit || null, now, repoId]
    );

    repo.status = 'indexed';
    repo.totalFiles = allSourceFiles.length;
    repo.totalChunks = allChunks.length;
    repo.commitHash = currentCommit || undefined;
    repo.indexedAt = now;

    onProgress?.(`Indexing complete! Total: ${allSourceFiles.length} files, ${allChunks.length} chunks.`, 100);
    return repo;
  }

  /**
   * Incrementally synchronizes an existing repository using Git diff or content hash detection.
   * If 0 files changed, executes in under 50ms without re-indexing.
   */
  async syncRepository(
    repoId: string,
    onProgress?: IndexProgressCallback
  ): Promise<Repository> {
    const rows = await this.db.query(`SELECT * FROM repositories WHERE id = $1`, [repoId]);
    if (rows.length === 0) {
      throw new Error(`Repository with ID ${repoId} not found.`);
    }
    const repoRecord = rows[0];
    const localDir = repoRecord.local_path;

    if (!fs.existsSync(localDir)) {
      throw new Error(`Repository directory ${localDir} does not exist on disk.`);
    }

    const startTime = Date.now();
    onProgress?.('Analyzing repository changes via Git diff...', 10);
    const isGit = GitUtils.isGitRepo(localDir);
    const currentCommit = isGit ? GitUtils.getCurrentCommit(localDir) : null;

    let addedPaths: string[] = [];
    let modifiedPaths: string[] = [];
    let deletedPaths: string[] = [];

    if (isGit) {
      const diff = GitUtils.getDiffFiles(localDir, repoRecord.commit_hash);
      if (!diff.hasChanges) {
        const durationMs = Date.now() - startTime;
        onProgress?.(`Repository is up-to-date! 0 files modified (${durationMs}ms).`, 100);
        const now = new Date();
        await this.db.query(
          `UPDATE repositories SET indexed_at = $1, updated_at = $1 WHERE id = $2`,
          [now, repoId]
        );
        return {
          id: repoRecord.id,
          name: repoRecord.name,
          remoteUrl: repoRecord.remote_url,
          localPath: repoRecord.local_path,
          defaultBranch: repoRecord.default_branch,
          commitHash: currentCommit || repoRecord.commit_hash,
          status: 'indexed',
          totalFiles: repoRecord.total_files,
          totalChunks: repoRecord.total_chunks,
          indexedAt: now,
          createdAt: repoRecord.created_at,
          updatedAt: now,
          syncStats: {
            isGit: true,
            hasChanges: false,
            modifiedFiles: [],
            addedFiles: [],
            deletedFiles: [],
            chunksUpdated: 0,
            durationMs,
            message: `Git diff: 0 files modified — repository is already up to date (${durationMs}ms)`,
          },
        };
      }
      addedPaths = diff.addedFiles;
      modifiedPaths = diff.modifiedFiles;
      deletedPaths = diff.deletedFiles;
    } else {
      // Non-git fallback: compare content hashes against database
      const crawled = FileCrawler.crawl({ repoId, targetDir: localDir });
      const dbFiles = await this.db.query(`SELECT id, path, content_hash FROM files WHERE repo_id = $1`, [repoId]);
      const dbFileMap = new Map<string, { id: string; content_hash: string }>();
      for (const dbf of dbFiles) {
        dbFileMap.set(dbf.path, dbf);
      }

      const diskMap = new Map<string, string>();
      for (const c of crawled) {
        diskMap.set(c.file.path, c.file.contentHash);
        const existing = dbFileMap.get(c.file.path);
        if (!existing) {
          addedPaths.push(c.file.path);
        } else if (existing.content_hash !== c.file.contentHash) {
          modifiedPaths.push(c.file.path);
        }
      }

      for (const dbf of dbFiles) {
        if (!diskMap.has(dbf.path)) {
          deletedPaths.push(dbf.path);
        }
      }

      if (addedPaths.length === 0 && modifiedPaths.length === 0 && deletedPaths.length === 0) {
        const durationMs = Date.now() - startTime;
        onProgress?.(`Repository is up-to-date! 0 files modified (${durationMs}ms).`, 100);
        const now = new Date();
        await this.db.query(
          `UPDATE repositories SET indexed_at = $1, updated_at = $1 WHERE id = $2`,
          [now, repoId]
        );
        return {
          id: repoRecord.id,
          name: repoRecord.name,
          remoteUrl: repoRecord.remote_url,
          localPath: repoRecord.local_path,
          defaultBranch: repoRecord.default_branch,
          commitHash: repoRecord.commit_hash,
          status: 'indexed',
          totalFiles: repoRecord.total_files,
          totalChunks: repoRecord.total_chunks,
          indexedAt: now,
          createdAt: repoRecord.created_at,
          updatedAt: now,
          syncStats: {
            isGit: false,
            hasChanges: false,
            modifiedFiles: [],
            addedFiles: [],
            deletedFiles: [],
            chunksUpdated: 0,
            durationMs,
            message: `Content hash: 0 files modified — repository is already up to date (${durationMs}ms)`,
          },
        };
      }
    }

    onProgress?.(
      `Git diff detected: ${modifiedPaths.length} modified, ${addedPaths.length} added, ${deletedPaths.length} deleted. Applying incremental update...`,
      25
    );

    const collectionName = process.env.QDRANT_COLLECTION || 'cortex_code_chunks';
    await this.vectorStore.initCollection(collectionName, this.embeddingProvider.dimension);

    // 1. Remove deleted & modified files from vectors & db
    const filesToPurge = [...deletedPaths, ...modifiedPaths];
    for (const p of filesToPurge) {
      const normP = p.replace(/\\/g, '/');
      await this.vectorStore.deleteByFile(collectionName, repoId, normP);
      await this.db.query(`DELETE FROM files WHERE repo_id = $1 AND (path = $2 OR path = $3)`, [repoId, p, normP]);
    }

    // 2. Read, parse, chunk, and embed added & modified files
    const filesToProcess = [...addedPaths, ...modifiedPaths];
    const crawledFiles: { file: SourceFile; content: string }[] = [];

    for (const p of filesToProcess) {
      const read = FileCrawler.readSingleFile(repoId, localDir, p);
      if (read) {
        crawledFiles.push(read);
      }
    }

    // Fetch existing files from DB to build complete graph edges
    const existingSourceFiles = await this.db.query(`SELECT * FROM files WHERE repo_id = $1`, [repoId]);
    const allSourceFiles: SourceFile[] = [
      ...existingSourceFiles.map(r => ({
        id: r.id,
        repoId: r.repo_id,
        path: r.path,
        language: r.language,
        lineCount: r.line_count,
        sizeBytes: r.size_bytes,
        contentHash: r.content_hash,
        createdAt: r.created_at,
      })),
      ...crawledFiles.map(c => c.file),
    ];

    const depGraphBuilder = new DependencyGraphBuilder(this.db);
    const newChunks: CodeChunk[] = [];

    for (let i = 0; i < crawledFiles.length; i++) {
      const { file, content } = crawledFiles[i];

      // Insert file record
      await this.db.query(
        `INSERT INTO files (id, repo_id, path, language, line_count, size_bytes, content_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [file.id, file.repoId, file.path, file.language, file.lineCount, file.sizeBytes, file.contentHash]
      );

      // Extract symbols & imports
      const { symbols, imports } = SymbolExtractor.extract(content, file.language, file.id, repoId);

      for (const sym of symbols) {
        await this.db.query(
          `INSERT INTO symbols (id, file_id, repo_id, name, kind, signature, start_line, end_line)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [sym.id, sym.fileId, sym.repoId, sym.name, sym.kind, sym.signature || null, sym.startLine, sym.endLine]
        );
      }

      await depGraphBuilder.buildEdges(repoId, file, imports, allSourceFiles);

      const chunks = SemanticChunker.chunkFile(file, content, symbols);
      newChunks.push(...chunks);
    }

    // 3. Generate embeddings & upsert vectors for new chunks
    if (newChunks.length > 0) {
      onProgress?.(`Embedding ${newChunks.length} updated semantic chunks...`, 65);
      const BATCH_SIZE = 25;
      for (let i = 0; i < newChunks.length; i += BATCH_SIZE) {
        const batch = newChunks.slice(i, i + BATCH_SIZE);
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
      }
    }

    // 4. Update repository totals
    const fCountRes = await this.db.query(`SELECT count(*) as total FROM files WHERE repo_id = $1`, [repoId]);
    const cCountRes = await this.db.query(`SELECT count(*) as total FROM chunks WHERE repo_id = $1`, [repoId]);
    const totalFiles = Number(fCountRes[0]?.total || 0);
    const totalChunks = Number(cCountRes[0]?.total || 0);
    const now = new Date();

    await this.db.query(
      `UPDATE repositories 
       SET commit_hash = $1, total_files = $2, total_chunks = $3, status = 'indexed', indexed_at = $4, updated_at = $4
       WHERE id = $5`,
      [currentCommit || repoRecord.commit_hash, totalFiles, totalChunks, now, repoId]
    );

    onProgress?.(
      `Incremental sync complete! Total: ${totalFiles} files, ${totalChunks} chunks (${newChunks.length} updated).`,
      100
    );

    const durationMs = Date.now() - startTime;
    return {
      id: repoId,
      name: repoRecord.name,
      remoteUrl: repoRecord.remote_url,
      localPath: repoRecord.local_path,
      defaultBranch: repoRecord.default_branch,
      commitHash: currentCommit || repoRecord.commit_hash,
      status: 'indexed',
      totalFiles,
      totalChunks,
      indexedAt: now,
      createdAt: repoRecord.created_at,
      updatedAt: now,
      syncStats: {
        isGit,
        hasChanges: true,
        modifiedFiles: modifiedPaths,
        addedFiles: addedPaths,
        deletedFiles: deletedPaths,
        chunksUpdated: newChunks.length,
        durationMs,
        message: `Synced ${modifiedPaths.length} modified, ${addedPaths.length} added, ${deletedPaths.length} deleted (${newChunks.length} chunks updated in ${durationMs}ms)`,
      },
    };
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
