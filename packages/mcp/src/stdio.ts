import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import {
  getDatabase,
  getVectorStore,
  getEmbeddingProvider,
  VectorSearcher,
  KeywordSearcher,
  GraphSearcher,
  HybridRetriever,
  DependencyGraphBuilder,
} from '@cortex/core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(os.homedir(), '.cortex-rag', '.env') });
dotenv.config({ path: path.join(os.homedir(), '.cortex-code', '.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });


const db = await getDatabase();
const vectorStore = await getVectorStore();
const embeddingProvider = getEmbeddingProvider();

const vectorSearcher = new VectorSearcher(vectorStore, embeddingProvider);
const keywordSearcher = new KeywordSearcher(db);
const graphSearcher = new GraphSearcher(db);
const hybridRetriever = new HybridRetriever(vectorSearcher, keywordSearcher, graphSearcher);
const depGraphBuilder = new DependencyGraphBuilder(db);

const server = new McpServer({
  name: process.env.MCP_SERVER_NAME || 'cortex-mcp',
  version: process.env.MCP_SERVER_VERSION || '1.0.0',
});

// Tool 1: search_code
server.tool(
  'search_code',
  'Searches codebase using hybrid vector similarity, keyword matching, and graph traversal',
  {
    repo_id: z.string().describe('Repository UUID'),
    query: z.string().describe('Natural language query, symbol name, or technical concept'),
    limit: z.number().optional().default(5).describe('Number of results to return'),
  },
  async ({ repo_id, query, limit }) => {
    try {
      const results = await hybridRetriever.retrieve(repo_id, query, limit);
      const formatted = results.map(r => ({
        file: r.chunk.filePath,
        lines: `${r.chunk.startLine}-${r.chunk.endLine}`,
        symbol: r.chunk.symbolName || 'Module Scope',
        kind: r.chunk.symbolKind || 'code',
        score: Math.round(r.rrfScore * 1000) / 1000,
        content: r.chunk.content,
      }));

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(formatted, null, 2),
          },
        ],
      };
    } catch (e: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Search error: ${e.message}` }],
      };
    }
  }
);

// Tool 2: get_function
server.tool(
  'get_function',
  'Retrieves the complete declaration and source code of a specific function or class by name',
  {
    repo_id: z.string().describe('Repository UUID'),
    symbol_name: z.string().describe('Exact name of function, method, or class'),
  },
  async ({ repo_id, symbol_name }) => {
    try {
      const rows = await db.query(
        `SELECT s.*, f.path as file_path, c.content as chunk_content
         FROM symbols s
         JOIN files f ON s.file_id = f.id
         LEFT JOIN chunks c ON c.symbol_id = s.id
         WHERE s.repo_id = $1 AND s.name = $2
         LIMIT 1`,
        [repo_id, symbol_name]
      );

      if (rows.length === 0) {
        return {
          content: [{ type: 'text', text: `Symbol '${symbol_name}' not found in repository.` }],
        };
      }

      const sym = rows[0];
      return {
        content: [
          {
            type: 'text',
            text: `// Symbol: ${sym.kind} ${sym.name}\n// Location: ${sym.file_path}:${sym.start_line}-${sym.end_line}\n// Signature: ${sym.signature || 'N/A'}\n\n${sym.chunk_content || 'Source code stored in file.'}`,
          },
        ],
      };
    } catch (e: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Error retrieving function: ${e.message}` }],
      };
    }
  }
);

// Tool 3: trace_deps
server.tool(
  'trace_deps',
  'Traces import and call dependencies for a given file or symbol',
  {
    repo_id: z.string().describe('Repository UUID'),
    target: z.string().describe('File path or symbol name to trace'),
  },
  async ({ repo_id, target }) => {
    try {
      // Check if target is a file or symbol
      const callers = await depGraphBuilder.getSymbolCallers(repo_id, target);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ target, callers }, null, 2),
          },
        ],
      };
    } catch (e: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Trace deps error: ${e.message}` }],
      };
    }
  }
);

// Resource 1: file contents
server.resource(
  'file-contents',
  'cortex://file/{repo_id}/{path}',
  async (uri: any) => {
    const pathname = uri.pathname || '';
    const parts = pathname.split('/').filter(Boolean);
    const repoId = parts[0];
    const relPath = parts.slice(1).join('/');

    const repos = await db.query(`SELECT local_path FROM repositories WHERE id = $1`, [repoId]);
    if (repos.length === 0) {
      throw new Error(`Repository ${repoId} not found.`);
    }

    const fullPath = path.resolve(repos[0].local_path, relPath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File ${relPath} not found.`);
    }

    const text = fs.readFileSync(fullPath, 'utf-8');
    return {
      contents: [
        {
          uri: uri.href,
          text,
        },
      ],
    };
  }
);

// Resource 2: dependency graph
server.resource(
  'dep-graph',
  'cortex://graph/{repo_id}',
  async (uri: any) => {
    const repoId = uri.pathname.replace(/^\//, '');
    const graph = await depGraphBuilder.exportGraph(repoId);
    return {
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify(graph, null, 2),
        },
      ],
    };
  }
);

// Connect via stdio
const transport = new StdioServerTransport();
await server.connect(transport);
