<div align="center">

# ◆ Cortex

### Codebase Intelligence Engine & MCP Server

**AST Semantic Chunking · Tri-Hybrid Retrieval · Grounded LLM Synthesis**

[![npm version](https://img.shields.io/npm/v/cortex-rag?color=cb3837&logo=npm)](https://www.npmjs.com/package/cortex-rag)
[![Node.js](https://img.shields.io/badge/Node.js-22+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/Model_Context_Protocol-JSON--RPC_2.0-8A2BE2)](https://modelcontextprotocol.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-black.svg)](https://opensource.org/licenses/MIT)

[Quick Start](#-quick-start) · [Web Dashboard](#-web-dashboard) · [CLI Usage](#-cli-usage) · [MCP Integration](#-mcp-integration) · [Architecture](#-architecture) · [Benchmarks](#-evaluation--benchmarks)

</div>

---

## What is Cortex?

Cortex is a **codebase intelligence engine** that indexes any Git repository and lets you ask natural-language questions about its architecture, functions, dependencies, and patterns — with verified, line-level citations grounding every answer.

Standard code RAG systems treat source code as unstructured text, splitting files into arbitrary character windows that sever function signatures, drop type definitions, and produce hallucinated imports. **Cortex solves this** by combining:

- **AST Syntactic Chunking** — Splits code strictly along function, class, and method boundaries using Tree-sitter grammars
- **Tri-Hybrid Retrieval** — Fuses BM25 lexical search, dense vector similarity, and directed dependency graph traversal using Reciprocal Rank Fusion (RRF)
- **Grounded Synthesis** — Every LLM answer is verified against retrieved AST chunks with file path and line-range citations

It ships as a **Web Dashboard**, a **Terminal CLI**, and a **Model Context Protocol (MCP) server** — plug it directly into Claude Desktop, Cursor, Windsurf, or any MCP-compatible IDE.

---

## ⚡ Quick Start

### Prerequisites

- **Node.js 20+** ([download](https://nodejs.org/))
- **Groq API Key** (free) — [Get one here](https://console.groq.com/keys)

### Installation & First Run

```bash
npx cortex-rag
```

That's it. On first run, Cortex will:

1. **Ask for your Groq API key** — This powers the LLM synthesis layer. Groq's free tier provides ultra-fast inference at zero cost.
2. **Save configuration** to `~/.cortex-rag/.env` — All indexed data and settings are stored in your home directory.
3. **Present three usage modes** — Choose how you want to use Cortex:

```
  ╔══════════════════════════════════════════════════════╗
  ║        ◆  C O R T E X  ◆                            ║
  ║        Codebase Intelligence Engine                  ║
  ║        v1.0.4 · AST Chunking · Hybrid RAG · MCP      ║
  ╚══════════════════════════════════════════════════════╝

  How would you like to use Cortex?
  ─────────────────────────────────────────────────

  1. Web Dashboard   — Browser-based UI with query playground, AST explorer, and observability
  2. CLI Terminal    — Command-line interface for indexing repos and querying from your terminal
  3. MCP Server      — Model Context Protocol server for Claude Desktop, Cursor, Windsurf, etc.

  Select mode [1/2/3]:
```

### Global Install (Optional)

If you prefer a permanent global command instead of `npx`:

```bash
npm install -g cortex-rag
cortex-rag
```

---

## 🌐 Web Dashboard

Launch the full browser-based dashboard with a single command:

```bash
npx cortex-rag web
```

This starts the unified Cortex server and automatically opens your default browser at:
- **Web Dashboard & API**: `http://localhost:4000`

### Dashboard Features

| Tab | What It Does |
|---|---|
| **Query Studio** | Ask natural-language questions about any indexed repo. Answers stream in real-time with grounded file:line citations, latency metrics, and cache hit/miss indicators. |
| **AST Architecture Explorer** | Browse the full dependency graph of an indexed repository. View callers, imports, symbol counts, and identify central vs. leaf modules. |
| **Observability & Benchmarks** | Run the automated 20-question evaluation suite. View aggregate Precision@5, Mean Reciprocal Rank, Groundedness %, and p50/p95 latency. Inspect individual query telemetry logs. |
| **Repository Manager** | Index new repositories (local paths or Git URLs), view indexed repos, and remove repos you no longer need. |

---

## 📟 CLI Usage

Use `npx cortex-rag cli <command>` to interact from your terminal.

### Index a Repository

Index a local folder or a remote Git URL:

```bash
# Index a GitHub repository
npx cortex-rag cli index https://github.com/expressjs/express

# Index a local project
npx cortex-rag cli index /path/to/your/project

# Index with a custom name
npx cortex-rag cli index https://github.com/facebook/react --name react
```

**Output:**
```
🧠 Cortex Indexer
Target: https://github.com/expressjs/express

✓ Indexed repository successfully!

Repository Summary:
  ID:          a1b2c3d4-e5f6-7890-abcd-ef1234567890
  Name:        express
  Total Files: 187
  Chunks:      1,432
  Path:        ~/.cortex-rag/data/temp_repos/a1b2c3d4...
```

### Incremental Git Diff Sync

When you modify code in an indexed repository, re-indexing is practically instantaneous. Cortex inspects `git diff` against your last indexed commit, only re-parsing and embedding the specific files that changed (or completing in under 50ms if no files changed):

```bash
# Sync the most recently indexed repository
npx cortex-rag cli sync

# Sync a specific repository by UUID or local path
npx cortex-rag cli sync ./my-project
```

### Query a Repository

Ask natural-language questions about your indexed codebase:

```bash
# Query the most recently indexed repo
npx cortex-rag cli query "How does the routing middleware work?"

# Query a specific repo by ID
npx cortex-rag cli query "What error handling patterns are used?" --repo a1b2c3d4
```

**Output:**
```
🧠 Cortex Query
Prompt: "How does the routing middleware work?"

📂 Grounded Citations:
  • lib/router/index.js:45-128 (Router)
  • lib/router/route.js:12-67 (Route)
  • lib/application.js:190-215 (lazyrouter)

💬 Cortex Answer:
The routing middleware in Express is implemented through a two-layer system...

[Latency: 847ms | Cache: MISS]
```

### List Indexed Repositories

```bash
npx cortex-rag cli repos
```

### Remove a Repository

```bash
npx cortex-rag cli remove <repo-id-or-name>
```

### Run Evaluation Benchmark

Run the automated 20-question retrieval quality suite:

```bash
npx cortex-rag cli eval
```

**Output:**
```
📊 Benchmark Aggregate Scorecard:
  Total Test Cases:       20
  Passed Cases:           18 / 20
  Precision@5:            87%
  Mean Reciprocal Rank:   0.91
  Average Groundedness:   96% (Target: >=95%)
  Latency (p50 / p95):    312ms / 1,240ms
```

### Reconfigure API Key

```bash
npx cortex-rag config
```

---

## 🔌 MCP Integration

Cortex ships as a fully compliant **Model Context Protocol (MCP) server**. Connect it to Claude Desktop, Cursor, Windsurf, or any MCP-compatible IDE to give your AI assistant deep codebase understanding.

### Step 1: Index a Repository First

Before connecting MCP, index at least one repository:

```bash
npx cortex-rag cli index https://github.com/your-org/your-repo
```

Note the **Repository UUID** from the output — you'll need it when calling MCP tools.

### Step 2: Connect to Your IDE

#### Option A: Zero-Config via NPX (Recommended)

Add this directly to your IDE's MCP configuration. It uses the global setup created during your first `npx cortex-rag` run:

```json
{
  "mcpServers": {
    "cortex": {
      "command": "npx",
      "args": ["-y", "cortex-rag", "mcp-server"]
    }
  }
}
```

#### Option B: Direct Node Path

If you cloned the repository or want to specify explicit environment variables:

```json
{
  "mcpServers": {
    "cortex": {
      "command": "node",
      "args": ["/path/to/cortex/packages/mcp/dist/stdio.js"],
      "env": {
        "GROQ_API_KEY": "gsk_your_key_here",
        "DATABASE_MODE": "embedded",
        "DATABASE_PATH": "~/.cortex-rag/data/cortex_db",
        "VECTOR_STORE_MODE": "embedded",
        "EMBEDDING_PROVIDER": "local",
        "EMBEDDING_MODEL": "Xenova/all-MiniLM-L6-v2",
        "REDIS_MODE": "embedded"
      }
    }
  }
}
```

To see your system's exact pre-filled configuration, run:
```bash
npx cortex-rag mcp
```

### Config File Locations

| Tool | Config File Location |
|---|---|
| **Claude Desktop** | `~/AppData/Roaming/Claude/claude_desktop_config.json` (Windows)<br>`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) |
| **Cursor** | `Settings` → `MCP` → `Add Server` (paste configuration) |
| **Windsurf / Antigravity** | `mcp_config.json` |


### Available MCP Tools

Once connected, your AI assistant gains access to these tools:

| Tool | Description | Parameters |
|---|---|---|
| `search_code` | Hybrid vector + keyword + graph search with RRF scoring | `repo_id` (string), `query` (string), `limit` (number, optional) |
| `get_function` | Retrieves complete source code of a function or class by exact name | `repo_id` (string), `symbol_name` (string) |
| `trace_deps` | Traces import and call dependencies for a file or symbol | `repo_id` (string), `target` (string) |
| `index_repository` | Indexes a local directory or Git URL into Cortex | `path` (string), `name` (string, optional) |
| `sync_repository` | Incrementally syncs an indexed repository via Git diff in milliseconds | `repo_id` (string) |

### Available MCP Resources

| Resource URI | Description |
|---|---|
| `cortex://file/{repo_id}/{path}` | Read file contents from an indexed repository |
| `cortex://graph/{repo_id}` | Full dependency graph as JSON |

### Example Usage in Claude

Once connected, you can ask Claude questions like:

> *"Using the cortex MCP, search the express repo for how middleware chaining works"*

Claude will automatically call `search_code` with the appropriate parameters and return grounded, citation-backed answers.

---

## 🏛️ Architecture

```
                              ┌────────────────────────────────────────┐
                              │          Developer Touchpoints         │
                              │  Web UI  │  Terminal CLI  │  MCP Tools │
                              └──────────────────┬─────────────────────┘
                                                 │
                                                 ▼
                              ┌────────────────────────────────────────┐
                              │      High-Throughput Fastify API       │
                              │   SSE Streaming  │  Evaluation Service │
                              └──────────────────┬─────────────────────┘
                                                 │
                         ┌───────────────────────┴───────────────────────┐
                         │                                               │
                         ▼                                               ▼
           ┌───────────────────────────┐                   ┌───────────────────────────┐
           │    Semantic Cache Layer   │                   │    Tri-Hybrid Retrieval   │
           │   Cosine Similarity ≥0.88 │                   │                           │
           │   Sub-10ms Instant Bypass │                   │  ┌─────────────────────┐  │
           └─────────────┬─────────────┘                   │  │   BM25 Lexical      │  │
                         │                                 │  ├─────────────────────┤  │
               [Cache Hit│Cache Miss]                      │  │   Dense Vector      │  │
                         │                                 │  ├─────────────────────┤  │
                         │                                 │  │   AST Graph Hops    │  │
                         │                                 │  └──────────┬──────────┘  │
                         │                                 │             ▼             │
                         │                                 │   Reciprocal Rank Fusion  │
                         │                                 │         (RRF k=60)        │
                         │                                 └─────────────┬─────────────┘
                         │                                               │
                         ▼                                               ▼
                  ┌─────────────────────────────────────────────────────────────┐
                  │                 Grounded Synthesis Engine                   │
                  │         Streaming Multi-Hop Contextual Synthesis            │
                  │          Verified Line Citations & Groundedness             │
                  └─────────────────────────────────────────────────────────────┘
```

### Monorepo Structure

```
cortex-rag/
├── packages/
│   ├── core/          # Business logic: indexer, retrieval, evaluation, caching
│   │   ├── indexer/   # AST chunker, symbol extractor, git cloner, dependency graph
│   │   ├── retrieval/ # Vector search, keyword search, graph search, RRF, synthesis
│   │   ├── eval/      # Benchmark runner, groundedness verifier, query logger
│   │   ├── cache/     # Semantic cache with embedding similarity matching
│   │   └── db/        # PGlite (embedded PostgreSQL), Qdrant vector store, Redis
│   ├── api/           # Fastify HTTP server with SSE streaming
│   ├── cli/           # Commander.js terminal interface + interactive launcher
│   ├── mcp/           # Model Context Protocol server (stdio transport)
│   └── web/           # React + Vite dashboard with query playground & observability
├── package.json       # Root package (published as cortex-rag)
└── README.md
```

### Key Technical Decisions

| Decision | Rationale |
|---|---|
| **PGlite (WASM PostgreSQL)** | Zero-install embedded database. No Docker, no PostgreSQL server needed. Users run `npx` and it works immediately. |
| **Local Embeddings (all-MiniLM-L6-v2)** | Runs entirely on CPU via `@xenova/transformers`. No API key needed for embeddings, zero cost, works offline. |
| **Groq for LLM Synthesis** | Free tier with 300+ tokens/sec inference speed. No cost for users, but requires a free API key from console.groq.com. |
| **Tree-sitter AST Parsing** | Language-aware code chunking. Preserves function boundaries, class scopes, and import statements instead of arbitrary text splits. |
| **RRF (k=60) for Fusion** | Score-agnostic rank fusion eliminates normalization issues between heterogeneous search modalities (BM25 scores vs cosine distances vs graph hops). |

---

## 📊 Evaluation & Benchmarks

Cortex includes a built-in 20-question evaluation suite that measures retrieval quality and synthesis groundedness:

| Metric | Description | Target |
|---|---|---|
| **Precision@5** | Percentage of top-5 retrieved chunks that are relevant to the query | ≥80% |
| **Mean Reciprocal Rank (MRR)** | Average inverse rank of the first relevant result | ≥0.85 |
| **Groundedness** | Percentage of generated citations that map to valid file paths and line ranges in retrieved chunks | ≥95% |
| **Latency (p50/p95)** | End-to-end query response time including retrieval + synthesis | p50 <500ms |

Run the benchmark:

```bash
npx cortex-rag cli eval --repo <repo-id>
```

---

## ⚙️ Configuration

All configuration is stored in `~/.cortex-rag/.env`. The launcher creates this automatically on first run.

| Variable | Default | Description |
|---|---|---|
| `GROQ_API_KEY` | *(required)* | Your Groq API key for LLM synthesis |
| `GROQ_MODEL` | `qwen/qwen3.8-27b` | Groq model for synthesis |
| `DATABASE_MODE` | `embedded` | `embedded` (PGlite) or `postgres` (external PostgreSQL) |
| `VECTOR_STORE_MODE` | `embedded` | `embedded` (in-memory) or `qdrant` (Qdrant server) |
| `REDIS_MODE` | `embedded` | `embedded` (in-memory) or `redis` (external Redis) |
| `EMBEDDING_PROVIDER` | `local` | `local` (CPU, free) or `openai` (requires OPENAI_API_KEY) |
| `LLM_PROVIDER` | `groq` | `groq`, `ollama`, or `openai` |

To reconfigure at any time:

```bash
npx cortex-rag config
```

---

## 🐳 Production Deployment (Optional)

For production deployments with external databases, use the included Docker Compose:

```bash
# Start PostgreSQL + Qdrant + Redis
docker-compose up -d

# Update ~/.cortex-rag/.env to use external services:
# DATABASE_MODE=postgres
# VECTOR_STORE_MODE=qdrant
# REDIS_MODE=redis
```

---

## 🛠️ Development

```bash
# Clone the repository
git clone https://github.com/RavikantiAkshay/Cortex.git
cd Cortex

# Install dependencies
npm install

# Create .env from template
cp .env.example .env
# Edit .env and add your GROQ_API_KEY

# Build all packages
npm run build

# Start development servers
npm run dev:api   # API on :4000
npm run dev:web   # Web on :5173

# Run tests
npm test
```

---

## 📄 License

[MIT](./LICENSE) © Akshay Ravikanti
