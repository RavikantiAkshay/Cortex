import path from 'path';
import { DatabaseAdapter } from '../db/postgres.js';
import { DependencyEdge, SourceFile } from '../types/index.js';
import { ExtractedImport } from './symbol-extractor.js';
import { v4 as uuidv4 } from 'uuid';

export class DependencyGraphBuilder {
  constructor(private db: DatabaseAdapter) {}

  async buildEdges(
    repoId: string,
    sourceFile: SourceFile,
    imports: ExtractedImport[],
    allFiles: SourceFile[]
  ): Promise<DependencyEdge[]> {
    const edges: DependencyEdge[] = [];
    const fileMapByNormalizedPath = new Map<string, SourceFile>();

    for (const f of allFiles) {
      fileMapByNormalizedPath.set(this.normalizePath(f.path), f);
    }

    const sourceDir = path.dirname(sourceFile.path);

    for (const imp of imports) {
      let resolvedTargetFile: SourceFile | undefined;

      // Handle relative imports
      if (imp.sourceModule.startsWith('.')) {
        const potentialTarget = path.join(sourceDir, imp.sourceModule).replace(/\\/g, '/');
        resolvedTargetFile = this.resolveExtension(potentialTarget, fileMapByNormalizedPath);
      }

      const symbols = imp.importedSymbols.length > 0 ? imp.importedSymbols : ['*'];

      for (const sym of symbols) {
        const edge: DependencyEdge = {
          id: uuidv4(),
          repoId,
          sourceFileId: sourceFile.id,
          targetFileId: resolvedTargetFile?.id || null,
          targetSymbolName: sym,
          edgeType: 'IMPORTS',
          rawImportPath: imp.sourceModule,
          createdAt: new Date(),
        };

        edges.push(edge);
      }
    }

    // Persist edges to database
    for (const edge of edges) {
      await this.db.query(
        `INSERT INTO dependency_edges 
         (id, repo_id, source_file_id, target_file_id, target_symbol_name, edge_type, raw_import_path)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          edge.id,
          edge.repoId,
          edge.sourceFileId,
          edge.targetFileId,
          edge.targetSymbolName,
          edge.edgeType,
          edge.rawImportPath || null,
        ]
      );
    }

    return edges;
  }

  private resolveExtension(basePath: string, fileMap: Map<string, SourceFile>): SourceFile | undefined {
    const exts = ['', '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '/index.ts', '/index.js'];
    for (const ext of exts) {
      const candidate = this.normalizePath(basePath + ext);
      const match = fileMap.get(candidate);
      if (match) return match;
    }
    return undefined;
  }

  private normalizePath(p: string): string {
    return p.replace(/\\/g, '/').toLowerCase();
  }

  async get1HopDependencies(fileId: string): Promise<any[]> {
    return this.db.query(
      `SELECT e.*, sf.path as source_path, tf.path as target_path
       FROM dependency_edges e
       LEFT JOIN files sf ON e.source_file_id = sf.id
       LEFT JOIN files tf ON e.target_file_id = tf.id
       WHERE e.source_file_id = $1 OR e.target_file_id = $1`,
      [fileId]
    );
  }

  async getSymbolCallers(repoId: string, symbolName: string): Promise<any[]> {
    return this.db.query(
      `SELECT e.*, sf.path as caller_file_path
       FROM dependency_edges e
       JOIN files sf ON e.source_file_id = sf.id
       WHERE e.repo_id = $1 AND e.target_symbol_name = $2`,
      [repoId, symbolName]
    );
  }

  async exportGraph(repoId: string): Promise<{ nodes: any[]; edges: any[] }> {
    const files = await this.db.query(
      `SELECT id, path, language, line_count FROM files WHERE repo_id = $1`,
      [repoId]
    );
    const edges = await this.db.query(
      `SELECT source_file_id, target_file_id, target_symbol_name, edge_type, raw_import_path
       FROM dependency_edges 
       WHERE repo_id = $1`,
      [repoId]
    );

    return {
      nodes: files.map(f => ({
        id: f.id,
        label: path.basename(f.path),
        path: f.path,
        language: f.language,
        lines: f.line_count,
      })),
      edges: edges.map((e, idx) => ({
        id: `e-${idx}`,
        source: e.source_file_id,
        target: e.target_file_id,
        rawImport: e.raw_import_path,
        symbol: e.target_symbol_name,
        type: e.edge_type,
      })),
    };
  }
}
