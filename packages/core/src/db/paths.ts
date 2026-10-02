import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export function getCortexRootDir(): string {
  // 1. Walk up from process.cwd() to find cortex root package.json
  let cur = process.cwd();
  for (let i = 0; i < 6; i++) {
    const pkgPath = path.join(cur, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg.name === 'cortex' && pkg.workspaces) {
          return cur;
        }
      } catch {}
    }
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }

  // 2. Fallback using file location
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
  const root = getCortexRootDir();
  return path.resolve(root, cleanRelative);
}
