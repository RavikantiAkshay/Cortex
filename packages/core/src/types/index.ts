export type LanguageId = 
  | 'typescript' 
  | 'javascript' 
  | 'python' 
  | 'go' 
  | 'rust' 
  | 'java' 
  | 'unknown';

export type SymbolKind = 
  | 'function' 
  | 'method' 
  | 'class' 
  | 'interface' 
  | 'type' 
  | 'variable' 
  | 'import' 
  | 'export';

export interface Repository {
  id: string;
  name: string;
  remoteUrl?: string;
  localPath: string;
  defaultBranch: string;
  commitHash?: string;
  indexedAt?: Date;
  status: 'pending' | 'indexing' | 'indexed' | 'failed';
  totalFiles: number;
  totalChunks: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SourceFile {
  id: string;
  repoId: string;
  path: string;
  language: LanguageId;
  lineCount: number;
  sizeBytes: number;
  contentHash: string;
  createdAt: Date;
}

export interface ExtractedSymbol {
  id: string;
  fileId: string;
  repoId: string;
  name: string;
  kind: SymbolKind;
  signature?: string;
  docstring?: string;
  startLine: number;
  endLine: number;
  parentSymbolId?: string | null;
  createdAt: Date;
}

export interface CodeChunk {
  id: string;
  repoId: string;
  fileId: string;
  symbolId?: string | null;
  filePath: string;
  symbolName?: string | null;
  symbolKind?: SymbolKind | null;
  content: string;
  startLine: number;
  endLine: number;
  tokenCount: number;
  vectorId: string;
  createdAt: Date;
}

export interface DependencyEdge {
  id: string;
  repoId: string;
  sourceFileId: string;
  targetFileId?: string | null;
  sourceSymbolId?: string | null;
  targetSymbolName: string;
  edgeType: 'IMPORTS' | 'CALLS' | 'EXTENDS' | 'IMPLEMENTS';
  rawImportPath?: string;
  createdAt: Date;
}

export interface Citation {
  filePath: string;
  startLine: number;
  endLine: number;
  symbolName?: string | null;
  snippet: string;
}

export interface QueryLog {
  id: string;
  repoId: string;
  queryText: string;
  cacheHit: boolean;
  cacheSimilarity?: number;
  retrievedChunkIds: string[];
  responseText: string;
  precisionAtK?: number;
  groundednessScore?: number;
  latencyCacheMs?: number;
  latencyRetrievalMs?: number;
  latencyLlmMs?: number;
  latencyTotalMs: number;
  promptTokens?: number;
  completionTokens?: number;
  costUsd?: number;
  interface: 'web' | 'cli' | 'mcp';
  createdAt: Date;
}

export interface EvaluationMetrics {
  repoId: string;
  precisionAtK: number;
  groundednessScore: number;
  latency: {
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
  };
  cache: {
    totalQueries: number;
    hitCount: number;
    hitRatePct: number;
    estimatedSavingsUsd: number;
  };
}

export interface ScoredChunk {
  chunk: CodeChunk;
  score: number;
  source: 'dense' | 'bm25' | 'graph';
}

export interface RankedResult {
  chunk: CodeChunk;
  rrfScore: number;
  ranks: {
    dense?: number;
    bm25?: number;
    graph?: number;
  };
}
