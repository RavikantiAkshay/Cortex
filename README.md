# 🧠 Cortex — Codebase Intelligence Engine & Model Context Protocol (MCP) Server

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22+-green.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![MCP Compatible](https://img.shields.io/badge/MCP-JSON--RPC_2.0-black.svg)](https://modelcontextprotocol.io)

**Cortex** is a high-performance codebase intelligence engine and Model Context Protocol (MCP) server. It ingests, parses, indexes, and queries repositories using **AST syntactic chunking**, **dependency graph traversal**, and **tri-hybrid search (BM25 + Dense Vectors + Graph Hops with Reciprocal Rank Fusion)**.

Cortex exposes codebase intelligence through three distinct interfaces:
1. **Interactive Web Dashboard** — High-contrast monochrome UI with streaming answers, clickable line citations, interactive AST dependency explorer, and real-time observability telemetry.
2. **Terminal CLI (`cortex`)** — Fast terminal commands: `cortex index`, `cortex query`, `cortex list`, `cortex remove`, and `cortex serve`.
3. **Model Context Protocol (MCP) Server** — Native JSON-RPC 2.0 tools and resources connecting directly into **Cursor**, **Claude Desktop**, and modern AI IDEs.

---

## 🏗️ Architecture Overview

```
                      ┌────────────────────────────────────────┐
                      │          Developer Interfaces          │
                      │  Web UI  │  Terminal CLI  │  MCP Tools │
                      └──────────────────┬─────────────────────┘
                                         │
                                         ▼
                      ┌────────────────────────────────────────┐
                      │        Fastify Gateway & API           │
                      │  SSE Streaming │ REST │ Evaluation     │
                      └──────────────────┬─────────────────────┘
                                         │
                     ┌───────────────────┴───────────────────┐
                     ▼                                       ▼
        ┌─────────────────────────┐             ┌─────────────────────────┐
        │   Semantic Cache Layer  │             │   Tri-Hybrid Retrieval  │
        │  Cosine sim >= 0.88     │             │  ┌───────────────────┐  │
        │  Sub-10ms response      │             │  │ BM25 Full-Text    │  │
        └─────────────────────────┘             │  ├───────────────────┤  │
                                                │  │ Dense Vectors     │  │
                                                │  ├───────────────────┤  │
                                                │  │ AST Graph Hops    │  │
                                                │  └─────────┬─────────┘  │
                                                │            ▼            │
                                                │  Reciprocal Rank Fusion │
                                                └────────────┬────────────┘
                                                             │
                                                             ▼
                                                ┌─────────────────────────┐
                                                │   Context-Grounded LLM  │
                                                │  Streaming Synthesis    │
                                                │  Exact Line Citations   │
                                                └─────────────────────────┘
```

---

## ⚡ 100% Free ($0.00) Architecture

Cortex is architected to run completely free without paid cloud databases or API charges:
* **Local Embeddings**: Generates 384-dimensional dense vectors locally using `@xenova/transformers` (`all-MiniLM-L6-v2`) on CPU ($0.00, runs offline, zero API keys required).
* **LLM Synthesis**: Uses Groq Cloud's free tier for 300+ tokens/sec streaming inference, or local Ollama.
* **Storage**: Embedded **PGlite** (in-process WASM PostgreSQL) and on-disk JSON vector storage with zero external dependencies. (Optional Docker Compose provided for PostgreSQL 16, Qdrant, and Redis).

---

## 📦 Monorepo Packages

```
cortex/
├── packages/
│   ├── core/      # Indexing, AST chunker, dependency graph, hybrid search, eval
│   ├── api/       # Fastify REST & SSE streaming server (port 4000)
│   ├── mcp/       # Model Context Protocol stdio server for Cursor & Claude
│   ├── cli/       # 'cortex' terminal command-line interface
│   └── web/       # React 19 + Vite dashboard with interactive graph & telemetry
├── package.json   # NPM workspaces root
└── README.md
```

---

## 🚀 Quick Start

### 1. Prerequisites
* **Node.js**: v20 or v22+
* **npm**: v10+
* **Git** installed on PATH

### 2. Installation
Clone the repository and install all dependencies across the monorepo:
```bash
git clone https://github.com/RavikantiAkshay/Cortex.git
cd Cortex
npm install
npm run build
```

### 3. Environment Setup
Copy the example environment file:
```bash
cp .env.example .env
```
Add your free Groq API key (obtainable at [console.groq.com](https://console.groq.com/keys)):
```env
GROQ_API_KEY=gsk_your_groq_api_key_here
GROQ_MODEL=qwen/qwen3.8-27b
PORT=4000
```

---

## 💻 Usage

### Starting the Web Dashboard & API
Run both services with one command or in separate terminals:
```bash
# Terminal 1: Fastify API Server
npm run dev:api

# Terminal 2: React Web UI
npm run dev:web
```
Open **`http://localhost:5173`** in your browser.

### Using the Terminal CLI

```bash
# Index a local directory or remote git repo
node packages/cli/dist/bin.js index ./my-project --name "my-project"
node packages/cli/dist/bin.js index https://github.com/org/repo.git

# Ask architectural questions with citations
node packages/cli/dist/bin.js query "Where is JWT authentication verified?"

# List indexed repositories
node packages/cli/dist/bin.js list

# Remove a repository
node packages/cli/dist/bin.js remove <repo-id>

# Run automated 20-question benchmark
node packages/cli/dist/bin.js bench <repo-id>
```

---

## 🔌 Connecting to Cursor & Claude Desktop (MCP)

Cortex implements the official [Model Context Protocol](https://modelcontextprotocol.io) (MCP) specification via stdio transport.

### Claude Desktop Configuration
Add Cortex to your `claude_desktop_config.json`:
* **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
* **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "cortex": {
      "command": "node",
      "args": [
        "E:/NewProject2/cortex/packages/mcp/dist/stdio.js"
      ]
    }
  }
}
```

### Cursor Configuration
In Cursor **Settings > Features > MCP Servers**:
* **Name**: `cortex`
* **Type**: `command`
* **Command**: `node <path-to-cortex>/packages/mcp/dist/stdio.js`

### Exposed MCP Tools & Resources
| Tool / Resource | Type | Description |
|---|---|---|
| `search_code` | Tool | Tri-hybrid vector + keyword + graph search returning ranked snippets with exact line ranges. |
| `get_function` | Tool | Retrieves the exact implementation, signature, and docstring of a function or class. |
| `trace_deps` | Tool | Traces outgoing imports and incoming callers for any symbol or file. |
| `cortex://file/{repo}/{path}` | Resource | Direct source file reader. |
| `cortex://graph/{repo}` | Resource | Full AST dependency adjacency graph. |

---

## 📊 Key Technical Features

### 1. AST Semantic Chunking
Instead of splitting code into naive character windows, Cortex parses the AST to create chunks aligned with function and class boundaries, prepending breadcrumb context (`// File: path/to/file.ts > Class > method()`).

### 2. Reciprocal Rank Fusion (RRF)
Merges ranked outputs from dense vector search, BM25 full-text keyword matching, and 1-2 hop AST dependency graph traversals using:
$$RRF(d) = \sum_{m \in M} \frac{1}{k + r_m(d)}$$
where $k = 60$.

### 3. Semantic Caching
Caches queries and synthesized answers using vector cosine similarity. Queries with $\ge 0.88$ similarity bypass the LLM and return instantly ($< 10\text{ms}$) with zero token consumption.

### 4. Observability & Groundedness Verification
* **Groundedness Evaluation**: Verifies that citations in synthesized answers match actual code boundaries.
* **Latency Percentiles**: Live tracking of $p50$, $p95$, and $p99$ response times.
* **Telemetry Audit Log**: Logs every query with execution time, token counts, interface origin, and cache hit/miss status.

---

## 📄 License

MIT License. Free for open-source and commercial use.
