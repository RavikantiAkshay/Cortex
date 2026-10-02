-- Cortex Core Database Schema
-- Compatible with PostgreSQL 16+ & PGlite (WASM)

-- 1. Repositories
CREATE TABLE IF NOT EXISTS repositories (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    remote_url VARCHAR(1024),
    local_path VARCHAR(1024) NOT NULL,
    default_branch VARCHAR(100) DEFAULT 'main',
    commit_hash VARCHAR(40),
    indexed_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR(50) DEFAULT 'pending',
    total_files INT DEFAULT 0,
    total_chunks INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Files
CREATE TABLE IF NOT EXISTS files (
    id VARCHAR(64) PRIMARY KEY,
    repo_id VARCHAR(64) NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    path VARCHAR(1024) NOT NULL,
    language VARCHAR(50) NOT NULL,
    line_count INT NOT NULL,
    size_bytes INT NOT NULL,
    content_hash VARCHAR(64) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(repo_id, path)
);
CREATE INDEX IF NOT EXISTS idx_files_repo_path ON files(repo_id, path);

-- 3. AST Symbols (functions, classes, interfaces, etc.)
CREATE TABLE IF NOT EXISTS symbols (
    id VARCHAR(64) PRIMARY KEY,
    file_id VARCHAR(64) NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    repo_id VARCHAR(64) NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    kind VARCHAR(50) NOT NULL,
    signature TEXT,
    docstring TEXT,
    start_line INT NOT NULL,
    end_line INT NOT NULL,
    parent_symbol_id VARCHAR(64) REFERENCES symbols(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_symbols_repo_name ON symbols(repo_id, name);
CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_id);

-- 4. Code Chunks (AST-chunked units)
CREATE TABLE IF NOT EXISTS chunks (
    id VARCHAR(64) PRIMARY KEY,
    repo_id VARCHAR(64) NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    file_id VARCHAR(64) NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    symbol_id VARCHAR(64) REFERENCES symbols(id) ON DELETE SET NULL,
    content TEXT NOT NULL,
    start_line INT NOT NULL,
    end_line INT NOT NULL,
    token_count INT NOT NULL,
    vector_id VARCHAR(64) NOT NULL,
    tsv_content TSVECTOR,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_chunks_repo ON chunks(repo_id);
CREATE INDEX IF NOT EXISTS idx_chunks_tsv ON chunks USING GIN(tsv_content);

-- Full-text trigger for PostgreSQL
CREATE OR REPLACE FUNCTION update_chunk_tsv() RETURNS TRIGGER AS $$
BEGIN
    NEW.tsv_content := to_tsvector('english', NEW.content);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_chunks_tsv_update ON chunks;
CREATE TRIGGER trg_chunks_tsv_update
BEFORE INSERT OR UPDATE ON chunks
FOR EACH ROW EXECUTE FUNCTION update_chunk_tsv();

-- 5. Dependency Graph Edges
CREATE TABLE IF NOT EXISTS dependency_edges (
    id VARCHAR(64) PRIMARY KEY,
    repo_id VARCHAR(64) NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    source_file_id VARCHAR(64) NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    target_file_id VARCHAR(64) REFERENCES files(id) ON DELETE CASCADE,
    source_symbol_id VARCHAR(64) REFERENCES symbols(id) ON DELETE CASCADE,
    target_symbol_name VARCHAR(255) NOT NULL,
    edge_type VARCHAR(50) NOT NULL,
    raw_import_path VARCHAR(1024),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_dep_edges_source ON dependency_edges(source_file_id);
CREATE INDEX IF NOT EXISTS idx_dep_edges_target ON dependency_edges(target_file_id);
CREATE INDEX IF NOT EXISTS idx_dep_edges_symbol ON dependency_edges(target_symbol_name);

-- 6. Query Logs & Evaluation Telemetry
CREATE TABLE IF NOT EXISTS query_logs (
    id VARCHAR(64) PRIMARY KEY,
    repo_id VARCHAR(64) NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    query_text TEXT NOT NULL,
    cache_hit BOOLEAN DEFAULT FALSE,
    cache_similarity FLOAT,
    retrieved_chunk_ids TEXT[],
    response_text TEXT,
    precision_at_k FLOAT,
    groundedness_score FLOAT,
    latency_cache_ms INT,
    latency_retrieval_ms INT,
    latency_llm_ms INT,
    latency_total_ms INT,
    prompt_tokens INT,
    completion_tokens INT,
    cost_usd NUMERIC(8, 6),
    interface VARCHAR(50) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_query_logs_repo_created ON query_logs(repo_id, created_at DESC);
