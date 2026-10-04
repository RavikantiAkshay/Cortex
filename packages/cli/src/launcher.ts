#!/usr/bin/env node

import chalk from 'chalk';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VERSION = '1.0.4';

// ─── Paths ──────────────────────────────────────────────────────────────────

function getCortexHome(): string {
  const ragHome = path.join(os.homedir(), '.cortex-rag');
  const codeHome = path.join(os.homedir(), '.cortex-code');
  if (fs.existsSync(ragHome)) return ragHome;
  if (fs.existsSync(codeHome)) return codeHome;
  return ragHome;
}

function getEnvFilePath(): string {
  return path.join(getCortexHome(), '.env');
}

function getDataDir(): string {
  return path.join(getCortexHome(), 'data');
}

// ─── Terminal I/O ───────────────────────────────────────────────────────────

function createRL() {
  return createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function prompt(rl: ReturnType<typeof createRL>, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer: string) => {
      resolve(answer.trim());
    });
  });
}

// ─── Banner ─────────────────────────────────────────────────────────────────

function printBanner() {
  console.log('');
  console.log(chalk.bold.white('  ╔══════════════════════════════════════════════════════╗'));
  console.log(chalk.bold.white('  ║') + chalk.bold.cyan('        ◆  C O R T E X  ◆                             ') + chalk.bold.white('║'));
  console.log(chalk.bold.white('  ║') + chalk.gray('        Codebase Intelligence Engine                  ') + chalk.bold.white('║'));
  console.log(chalk.bold.white('  ║') + chalk.gray(`        v${VERSION} · AST Chunking · Hybrid RAG · MCP     `) + chalk.bold.white('║'));
  console.log(chalk.bold.white('  ╚══════════════════════════════════════════════════════╝'));
  console.log('');
}

// ─── Setup / Configuration ──────────────────────────────────────────────────

function parseEnvFile(filePath: string): Record<string, string> {
  const config: Record<string, string> = {};
  if (fs.existsSync(filePath)) {
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        config[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
      }
    }
  }
  return config;
}

function loadExistingConfig(): Record<string, string> {
  // 1. User home config (~/.cortex-code/.env)
  const homeConfig = parseEnvFile(getEnvFilePath());
  if (homeConfig['GROQ_API_KEY'] && homeConfig['GROQ_API_KEY'].length > 10 && !homeConfig['GROQ_API_KEY'].includes('your_groq_api_key')) {
    return homeConfig;
  }

  // 2. Monorepo root / local .env
  const localEnvPath = path.resolve(getPackageRoot(), '.env');
  const localConfig = parseEnvFile(localEnvPath);
  if (localConfig['GROQ_API_KEY'] && localConfig['GROQ_API_KEY'].length > 10 && !localConfig['GROQ_API_KEY'].includes('your_groq_api_key')) {
    writeEnvFile(localConfig['GROQ_API_KEY']);
    return localConfig;
  }

  // 3. Environment variable
  if (process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.length > 10) {
    writeEnvFile(process.env.GROQ_API_KEY);
    return { ...homeConfig, GROQ_API_KEY: process.env.GROQ_API_KEY };
  }

  return homeConfig;
}

function isApiKeyConfigured(): boolean {
  const config = loadExistingConfig();
  const key = config['GROQ_API_KEY'] || '';
  return key.length > 10 && !key.includes('your_groq_api_key');
}

function writeEnvFile(groqKey: string) {
  const cortexHome = getCortexHome();
  const dataDir = getDataDir();

  if (!fs.existsSync(cortexHome)) fs.mkdirSync(cortexHome, { recursive: true });
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const envContent = `# Cortex Configuration (auto-generated)
# Location: ${getEnvFilePath()}

# Application
NODE_ENV=production
PORT=4000
HOST=0.0.0.0
LOG_LEVEL=info

# Database (embedded — zero setup required)
DATABASE_MODE=embedded
DATABASE_PATH=${dataDir.replace(/\\/g, '/')}/cortex_db

# Vector Store (embedded — zero setup required)
VECTOR_STORE_MODE=embedded
QDRANT_COLLECTION=cortex_code_chunks

# Cache (embedded — zero setup required)
REDIS_MODE=embedded

# Embeddings (local CPU — zero cost)
EMBEDDING_PROVIDER=local
EMBEDDING_MODEL=Xenova/all-MiniLM-L6-v2

# LLM Synthesis (Groq — free tier)
LLM_PROVIDER=groq
GROQ_API_KEY=${groqKey}
GROQ_MODEL=qwen/qwen3.8-27b

# MCP Configuration
MCP_SERVER_NAME=cortex-mcp
MCP_SERVER_VERSION=${VERSION}
MCP_TRANSPORT=stdio
`;

  fs.writeFileSync(getEnvFilePath(), envContent, 'utf-8');
}

async function runSetup(rl: ReturnType<typeof createRL>): Promise<void> {
  console.log(chalk.bold.cyan('  First-Time Setup'));
  console.log(chalk.gray('  ─────────────────────────────────────────────────'));
  console.log('');
  console.log(chalk.white('  Cortex uses ') + chalk.bold.yellow('Groq') + chalk.white(' (free tier) for LLM synthesis.'));
  console.log(chalk.white('  Get your free API key at: ') + chalk.underline.cyan('https://console.groq.com/keys'));
  console.log('');

  const groqKey = await prompt(rl, chalk.bold.white('  Enter your Groq API key: '));

  if (!groqKey || groqKey.length < 10) {
    console.log(chalk.red('\n  ✗ Invalid API key. Please try again.\n'));
    process.exit(1);
  }

  writeEnvFile(groqKey);

  console.log('');
  console.log(chalk.green('  ✓ Configuration saved to ') + chalk.gray(getEnvFilePath()));
  console.log(chalk.green('  ✓ Data directory created at ') + chalk.gray(getDataDir()));
  console.log('');
}

// ─── Mode Selection ─────────────────────────────────────────────────────────

async function selectMode(rl: ReturnType<typeof createRL>): Promise<string> {
  console.log(chalk.bold.cyan('  How would you like to use Cortex?'));
  console.log(chalk.gray('  ─────────────────────────────────────────────────'));
  console.log('');
  console.log(chalk.bold.white('  1. ') + chalk.bold.green('Web Dashboard') + chalk.gray('   — Browser-based UI with query playground, AST explorer, and observability'));
  console.log(chalk.bold.white('  2. ') + chalk.bold.yellow('CLI Terminal') + chalk.gray('    — Command-line interface for indexing repos and querying from your terminal'));
  console.log(chalk.bold.white('  3. ') + chalk.bold.magenta('MCP Server') + chalk.gray('      — Model Context Protocol server for Claude Desktop, Cursor, Windsurf, etc.'));
  console.log('');

  const choice = await prompt(rl, chalk.bold.white('  Select mode [1/2/3]: '));
  return choice;
}

// ─── Mode Handlers ──────────────────────────────────────────────────────────

function setEnvForChild(): NodeJS.ProcessEnv {
  const config = loadExistingConfig();
  return { ...process.env, ...config };
}

function getPackageRoot(): string {
  // Walk up from __dirname (packages/cli/dist/) to the monorepo root
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if ((pkg.name === 'cortex-rag' || pkg.name === 'cortex-code' || pkg.name === 'cortex') && pkg.workspaces) {
          return dir;
        }
      } catch {}
    }
    dir = path.dirname(dir);
  }
  // Fallback: 3 levels up from packages/cli/dist/
  return path.resolve(__dirname, '../../..');
}

function openBrowser(url: string) {
  const start =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
      ? 'start'
      : 'xdg-open';
  try {
    spawn(start, [url], { shell: true, stdio: 'ignore' });
  } catch {}
}

async function launchWeb() {
  const root = getPackageRoot();

  console.log(chalk.bold.green('\n  🌐 Launching Cortex Web Dashboard\n'));
  console.log(chalk.cyan('  URL: ') + chalk.bold.underline.white('http://localhost:4000'));
  console.log(chalk.gray('  Opening your default browser... Press Ctrl+C to stop.\n'));

  const env = setEnvForChild();

  const api = spawn('node', [path.join(root, 'packages/api/dist/server.js')], {
    cwd: root,
    env,
    stdio: 'inherit',
  });

  // Open browser after 1.5s
  setTimeout(() => {
    openBrowser('http://localhost:4000');
  }, 1500);

  // Handle cleanup
  const cleanup = () => {
    try { api.kill(); } catch {}
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  return new Promise<void>((resolve) => {
    api.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.error(chalk.red(`\n  Server exited with code ${code}`));
      }
      resolve();
    });
  });
}

async function launchCLI(args: string[]) {
  const root = getPackageRoot();
  const env = setEnvForChild();

  const cli = spawn('node', [path.join(root, 'packages/cli/dist/bin.js'), ...args], {
    cwd: root,
    env,
    stdio: 'inherit',
  });

  cli.on('exit', (code) => process.exit(code || 0));
}

function printMCPInstructions() {
  const root = getPackageRoot();
  const mcpPath = path.join(root, 'packages/mcp/dist/stdio.js').replace(/\\/g, '/');
  const config = loadExistingConfig();
  const groqKey = config['GROQ_API_KEY'] || 'YOUR_GROQ_API_KEY';

  console.log(chalk.bold.magenta('\n  🔌 MCP Server Integration Guide\n'));
  console.log(chalk.gray('  ─────────────────────────────────────────────────────────────────'));
  console.log('');
  console.log(chalk.bold.white('  Choose either the NPX setup (recommended for all users) or the Direct Node setup.'));
  console.log('');

  // Method 1: NPX (Recommended)
  console.log(chalk.bold.cyan('  Option A: Zero-Config via NPX (Recommended)'));
  console.log(chalk.gray('  Works seamlessly in Claude Desktop, Cursor, and Windsurf without needing local paths:'));
  console.log('');
  console.log(chalk.green(`    {`));
  console.log(chalk.green(`      "mcpServers": {`));
  console.log(chalk.green(`        "cortex": {`));
  console.log(chalk.green(`          "command": "npx",`));
  console.log(chalk.green(`          "args": ["-y", "cortex-rag", "mcp-server"]`));
  console.log(chalk.green(`        }`));
  console.log(chalk.green(`      }`));
  console.log(chalk.green(`    }`));
  console.log('');

  // Method 2: Direct Local Node
  console.log(chalk.bold.cyan('  Option B: Direct Node Path'));
  console.log(chalk.gray('  For local development or custom environment variables:'));
  console.log('');
  console.log(chalk.green(`    {`));
  console.log(chalk.green(`      "mcpServers": {`));
  console.log(chalk.green(`        "cortex": {`));
  console.log(chalk.green(`          "command": "node",`));
  console.log(chalk.green(`          "args": ["${mcpPath}"],`));
  console.log(chalk.green(`          "env": {`));
  console.log(chalk.green(`            "GROQ_API_KEY": "${groqKey}",`));
  console.log(chalk.green(`            "DATABASE_MODE": "embedded",`));
  console.log(chalk.green(`            "DATABASE_PATH": "${getDataDir().replace(/\\/g, '/')}/cortex_db",`));
  console.log(chalk.green(`            "VECTOR_STORE_MODE": "embedded",`));
  console.log(chalk.green(`            "EMBEDDING_PROVIDER": "local",`));
  console.log(chalk.green(`            "EMBEDDING_MODEL": "Xenova/all-MiniLM-L6-v2",`));
  console.log(chalk.green(`            "REDIS_MODE": "embedded"`));
  console.log(chalk.green(`          }`));
  console.log(chalk.green(`        }`));
  console.log(chalk.green(`      }`));
  console.log(chalk.green(`    }`));
  console.log('');

  // IDE Config Locations
  console.log(chalk.bold.cyan('  Configuration File Locations:'));
  console.log(chalk.white('    • Claude Desktop: ') + chalk.gray('~/AppData/Roaming/Claude/claude_desktop_config.json'));
  console.log(chalk.white('    • Cursor:         ') + chalk.gray('Settings → MCP → Add Server (paste JSON)'));
  console.log(chalk.white('    • Antigravity:    ') + chalk.gray('mcp_config.json'));
  console.log('');

  // Cursor
  console.log(chalk.bold.cyan('  ▸ Cursor'));
  console.log(chalk.gray('    Settings → MCP → Add Server → Use the same JSON config above.'));
  console.log('');

  // Antigravity / Windsurf
  console.log(chalk.bold.cyan('  ▸ Antigravity / Windsurf'));
  console.log(chalk.gray('    Add to your IDE\'s mcp_config.json using the same structure.'));
  console.log('');

  console.log(chalk.gray('  ─────────────────────────────────────────────────────────────────'));
  console.log('');
  console.log(chalk.bold.white('  Available MCP Tools:'));
  console.log(chalk.white('    • ') + chalk.bold.green('search_code') + chalk.gray('    — Hybrid vector + keyword + graph search with RRF scoring'));
  console.log(chalk.white('    • ') + chalk.bold.green('get_function') + chalk.gray('   — Retrieves complete source code of a function or class'));
  console.log(chalk.white('    • ') + chalk.bold.green('trace_deps') + chalk.gray('     — Traces import/call dependencies for a file or symbol'));
  console.log('');
  console.log(chalk.bold.white('  Available MCP Resources:'));
  console.log(chalk.white('    • ') + chalk.bold.blue('cortex://file/{repo_id}/{path}') + chalk.gray('  — Read file contents from an indexed repo'));
  console.log(chalk.white('    • ') + chalk.bold.blue('cortex://graph/{repo_id}') + chalk.gray('        — Full dependency graph JSON'));
  console.log('');

  console.log(chalk.bold.yellow('  ⚠  Important: ') + chalk.white('Before using MCP tools, index a repository first:'));
  console.log(chalk.gray('     Run: ') + chalk.cyan('npx cortex-rag cli index <path-or-git-url>'));
  console.log('');
}

// ─── Reconfigure Command ────────────────────────────────────────────────────

async function reconfigure() {
  const rl = createRL();
  console.log(chalk.bold.yellow('\n  🔧 Reconfiguring Cortex\n'));

  const groqKey = await prompt(rl, chalk.bold.white('  Enter your new Groq API key: '));
  if (!groqKey || groqKey.length < 10) {
    console.log(chalk.red('\n  ✗ Invalid API key.\n'));
    process.exit(1);
  }

  writeEnvFile(groqKey);
  console.log(chalk.green('\n  ✓ Configuration updated successfully.\n'));
  rl.close();
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  // Headless MCP stdio server mode (for Claude Desktop, Cursor, etc. invoking npx -y cortex-code mcp-server)
  if (args[0] === 'mcp-server' || args[0] === 'serve-mcp') {
    const root = getPackageRoot();
    const env = setEnvForChild();
    const mcp = spawn('node', [path.join(root, 'packages/mcp/dist/stdio.js')], {
      cwd: root,
      env,
      stdio: 'inherit',
    });
    mcp.on('exit', (code) => process.exit(code || 0));
    return;
  }

  // Direct subcommands: cortex-code cli <...>, cortex-code web, cortex-code mcp, cortex-code config
  if (args[0] === 'config' || args[0] === 'reconfigure') {
    printBanner();
    await reconfigure();
    return;
  }

  if (args[0] === 'cli') {
    // Ensure configured
    if (!isApiKeyConfigured()) {
      printBanner();
      const rl = createRL();
      await runSetup(rl);
      rl.close();
    }
    // Pass remaining args to CLI
    await launchCLI(args.slice(1));
    return;
  }

  if (args[0] === 'web') {
    if (!isApiKeyConfigured()) {
      printBanner();
      const rl = createRL();
      await runSetup(rl);
      rl.close();
    }
    await launchWeb();
    return;
  }

  if (args[0] === 'mcp') {
    if (!isApiKeyConfigured()) {
      printBanner();
      const rl = createRL();
      await runSetup(rl);
      rl.close();
    }
    printBanner();
    printMCPInstructions();
    return;
  }

  // Interactive mode (no arguments or just `npx cortex-code`)
  printBanner();

  const rl = createRL();

  // Step 1: Setup if needed
  if (!isApiKeyConfigured()) {
    await runSetup(rl);
  } else {
    console.log(chalk.green('  ✓ Groq API key configured') + chalk.gray(` (${getEnvFilePath()})`));
    console.log('');
  }

  // Step 2: Mode selection
  const mode = await selectMode(rl);
  rl.close();

  switch (mode) {
    case '1':
      await launchWeb();
      break;

    case '2':
      console.log(chalk.bold.yellow('\n  📟 CLI Mode'));
      console.log(chalk.gray('  ─────────────────────────────────────────────────'));
      console.log('');
      console.log(chalk.white('  Available commands:'));
      console.log(chalk.white('    • ') + chalk.cyan('npx cortex-rag cli index <path>') + chalk.gray('      — Index a local repo or Git URL'));
      console.log(chalk.white('    • ') + chalk.cyan('npx cortex-rag cli query "question"') + chalk.gray('  — Ask questions about indexed code'));
      console.log(chalk.white('    • ') + chalk.cyan('npx cortex-rag cli repos') + chalk.gray('              — List indexed repositories'));
      console.log(chalk.white('    • ') + chalk.cyan('npx cortex-rag cli remove <id>') + chalk.gray('       — Remove an indexed repository'));
      console.log(chalk.white('    • ') + chalk.cyan('npx cortex-rag cli eval') + chalk.gray('               — Run 20-question benchmark'));
      console.log('');
      console.log(chalk.gray('  Example:'));
      console.log(chalk.cyan('    npx cortex-rag cli index https://github.com/expressjs/express'));
      console.log(chalk.cyan('    npx cortex-rag cli query "How does the routing middleware work?"'));
      console.log('');
      break;

    case '3':
      printMCPInstructions();
      break;

    default:
      console.log(chalk.red('\n  ✗ Invalid selection. Please enter 1, 2, or 3.\n'));
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(chalk.red(`\n  Fatal error: ${err.message}\n`));
  process.exit(1);
});
