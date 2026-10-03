import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

export function getCortexHome(): string {
  const ragHome = path.join(os.homedir(), '.cortex-rag');
  const codeHome = path.join(os.homedir(), '.cortex-code');
  if (fs.existsSync(ragHome)) return ragHome;
  if (fs.existsSync(codeHome)) return codeHome;
  return ragHome;
}

export function getCortexRootDir(): string {
  // 1. Walk up from process.cwd() to find cortex monorepo root package.json (dev mode)
  let cur = process.cwd();
  for (let i = 0; i < 6; i++) {
    const pkgPath = path.join(cur, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if ((pkg.name === 'cortex-rag' || pkg.name === 'cortex-code' || pkg.name === 'cortex') && pkg.workspaces) {
          return cur;
        }
      } catch {}
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }

  // 2. Fallback using file location (npm global / npx install)
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const candidate = path.resolve(__dirname, '../../..');
    const pkgPath = path.join(candidate, 'package.json');
    if (fs.existsSync(pkgPath)) {
      return candidate;
    }
  } catch {}

  return process.cwd();
}

export function resolveDataPath(relativePath: string): string {
  if (path.isAbsolute(relativePath)) {
    return relativePath;
  }

  // Strip leading ./ if present
  const cleanRelative = relativePath.startsWith('./') ? relativePath.slice(2) : relativePath;

  // If ~/.cortex-code/data/ exists, use it (npx / global install mode)
  const homePath = path.resolve(getCortexHome(), cleanRelative);
  if (fs.existsSync(getCortexHome())) {
    // Ensure parent dir exists
    const parentDir = path.dirname(homePath);
    if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });
    return homePath;
  }

  // Otherwise, resolve relative to the monorepo root (dev mode)
  const root = getCortexRootDir();
  return path.resolve(root, cleanRelative);
}
