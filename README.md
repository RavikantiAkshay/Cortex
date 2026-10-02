# Cortex: High-Performance Codebase Intelligence Engine & MCP Server

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Fastify](https://img.shields.io/badge/Fastify-5.2-000000?logo=fastify&logoColor=white)](https://fastify.io/)
[![MCP Specification](https://img.shields.io/badge/Model_Context_Protocol-JSON--RPC_2.0-8A2BE2)](https://modelcontextprotocol.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-black.svg)](https://opensource.org/licenses/MIT)

**Cortex** is an enterprise-grade codebase intelligence engine and Model Context Protocol (MCP) server designed for deep architectural reasoning, context-grounded retrieval, and real-time agent pair programming. 

Standard code retrieval systems treat source code as unstructured text, splitting documents into arbitrary character windows that sever function signatures, drop type definitions, and produce hallucinated imports. Cortex solves this by combining **Abstract Syntax Tree (AST) syntactic boundary analysis**, **directed dependency graph expansion**, and **tri-hybrid retrieval (BM25 + Dense Vectors + Graph Hops with Reciprocal Rank Fusion)** to supply LLMs with verified, structurally grounded context.

---

## 🏛️ System Architecture

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

---

## ⚡ The Code RAG Problem & The Cortex Solution

| Challenge in Standard RAG | Root Cause | The Cortex Architecture |
|---|---|---|
| **Severed Function Scopes** | Naive character/token chunking cuts across function and loop bodies. | **AST Syntactic Chunking**: Splits code strictly along function, method, and class AST boundaries. |
| **Missing Type & Import Context** | Chunks are retrieved as isolated text snippets without dependencies. | **1-to-2 Hop Graph Traversal**: Automatically pulls in imported modules and caller signatures along graph edges. |
| **Exact Identifier Misses** | Dense vectors struggle with exact variable names and compiler macros. | **Tri-Hybrid RRF**: Combines BM25 lexical precision with dense vector semantics and graph topology. |
| **High Latency & Token Waste** | Repeated or similar architectural queries repeatedly hit external LLMs. | **Embedding Semantic Cache**: Sub-10ms vector cache matching queries at $\ge 0.88$ cosine similarity. |
| **Hallucinated File References** | Models cite non-existent files or fabricated line ranges. | **Groundedness Verifier**: Verifies generated file paths and line boundaries against retrieved AST chunks. |

---

## 🎯 Key Capabilities & Technical Features

### 1. AST Semantic Chunking & Hierarchical Breadcrumbs
Instead of fixed character splits, Cortex parses each source file's Abstract Syntax Tree (via Tree-sitter grammars). Chunks are cut precisely at semantic symbol boundaries (functions, classes, interfaces). Each chunk is injected with hierarchical breadcrumb metadata:
```typescript
// File: packages/core/src/indexer/coordinator.ts > IndexerCoordinator > indexRepository()
async indexRepository(sourcePathOrUrl: string, repoName?: string): Promise<Repository> {
  // ... complete syntactic body preserved
}
```

### 2. Tri-Hybrid Retrieval with Reciprocal Rank Fusion (RRF)
Queries are executed concurrently across three orthogonal search modalities:
* **Lexical Match (BM25)**: Evaluates exact identifier names, symbol definitions, and error strings.
* **Dense Vector Search**: Maps conceptual semantics via 384-dimensional dense vector embeddings (`all-MiniLM-L6-v2`).
* **Dependency Graph Traversal**: Expands candidate chunks by traversing upstream module imports and downstream callers.

Results are fused into a unified ranking using Reciprocal Rank Fusion:
$$RRF(d) = \sum_{m \in M} \frac{1}{k + r_m(d)}$$
where $k = 60$, eliminating score normalization disparities between dense vector distances and BM25 scores.

### 3. Directed AST Dependency Multi-Graph
During the indexing pipeline, Cortex extracts every import, export, and symbol invocation into a directed dependency graph.
* **Incoming Dependents**: Immediately inspect all files and modules that depend on a given file.
* **Outgoing Dependencies**: Trace external libraries and internal module imports.
* **Architectural Centrality**: Identify foundational core modules vs. peripheral leaf nodes.

### 4. Sub-10ms Vector Semantic Cache
Queries are normalized and embedded in real-time. If an incoming query has a cosine similarity $\ge 0.88$ with a previously answered question in the same repository:
* The engine returns the cached synthesis and citations immediately ($< 10\text{ms}$).
* Completely eliminates duplicate LLM token consumption and API latency.

### 5. Continuous Observability & Automated Evaluation Harness
Built-in evaluation telemetry tracks system performance on every interaction:
* **Automated 20-Question Benchmark**: Standardized benchmark suite evaluating Precision@k, Mean Reciprocal Rank (MRR), and Groundedness across AST chunking, RRF search, caching, and MCP.
* **Latency Percentiles**: Live calculations of $p50$, $p95$, and $p99$ response times from production query logs.
* **Audit Stream**: Real-time log tracking query text, origin interface (`web`, `cli`, `mcp`), cache hits, latency, and token consumption.

---

## 🔌 Model Context Protocol (MCP) Integration

Cortex provides full compliance with the [Model Context Protocol](https://modelcontextprotocol.io) (JSON-RPC 2.0 stdio transport), turning any modern AI IDE into an expert on your codebase.

### Claude Desktop Configuration
Add the server definition to `claude_desktop_config.json`:
* **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
* **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "cortex": {
      "command": "node",
      "args": [
        "/absolute/path/to/cortex/packages/mcp/dist/stdio.js"
      ]
    }
  }
}
```

### Cursor Configuration
Under **Settings > Features > MCP Servers**:
* **Name**: `cortex`
* **Type**: `command`
* **Command**: `node /absolute/path/to/cortex/packages/mcp/dist/stdio.js`

### Exposed Tools & Resources
| Identifier | Protocol Type | Description |
|---|---|---|
| `search_code` | Tool | Executes tri-hybrid search returning ranked snippets with exact line ranges. |
| `get_function` | Tool | Retrieves the exact implementation, signature, and docstring of a symbol. |
| `trace_deps` | Tool | Traces incoming callers and outgoing imports for any symbol or file. |
| `cortex://file/{repo}/{path}` | Resource | Direct raw source file reader. |
| `cortex://graph/{repo}` | Resource | Complete JSON export of the repository AST dependency graph. |

---

## 📦 Monorepo Workspace Structure

```
cortex/
├── packages/
│   ├── core/      # Indexing coordinator, AST chunker, dependency graph, RRF, eval
│   ├── api/       # Fastify REST gateway & Server-Sent Events (SSE) streaming
│   ├── mcp/       # Model Context Protocol stdio server for Cursor & Claude Desktop
│   ├── cli/       # Standalone terminal CLI utility ('cortex')
│   └── web/       # Monochrome React 19 + Vite dashboard with Architecture Explorer
├── package.json   # NPM workspaces configuration
└── README.md
```

---

## 🚀 Getting Started

### 1. Requirements
* **Node.js**: v20.0.0 or higher
* **npm**: v10.0.0 or higher
* **Git**: Installed and available on your system `PATH`

### 2. Installation & Build
```bash
# Clone the repository
git clone https://github.com/RavikantiAkshay/Cortex.git
cd Cortex

# Install monorepo dependencies
npm install

# Compile all TypeScript workspaces
npm run build
```

### 3. Environment Configuration
Create a `.env` file from `.env.example`:
```bash
cp .env.example .env
```

Configure your LLM provider credentials:
```env
# Synthesis LLM (Groq Cloud or local Ollama)
GROQ_API_KEY=gsk_your_api_key_here
GROQ_MODEL=qwen/qwen3.8-27b

# Storage Mode (embedded or postgres/qdrant/redis)
DATABASE_MODE=embedded
VECTOR_STORE_MODE=embedded
CACHE_STORE_MODE=embedded

# Server Configuration
PORT=4000
HOST=0.0.0.0
```

---

## 💻 Developer Workflows

### Running the Services
```bash
# Start the Fastify API Gateway (Port 4000)
npm run dev:api

# Start the Web Dashboard (Port 5173)
npm run dev:web
```

### Using the Terminal CLI

```bash
# Index a local codebase or remote repository
node packages/cli/dist/bin.js index ./my-project --name "my-project"
node packages/cli/dist/bin.js index https://github.com/org/repo.git

# Execute architectural queries directly from the shell
node packages/cli/dist/bin.js query "Where is JWT authentication verified?"

# List all indexed repositories
node packages/cli/dist/bin.js list

# Remove a repository and clean its vector indexes
node packages/cli/dist/bin.js remove <repo-id>

# Run the 20-question retrieval benchmark
node packages/cli/dist/bin.js bench <repo-id>
```

---

## 📄 License

Distributed under the MIT License. See [LICENSE](LICENSE) for details.
