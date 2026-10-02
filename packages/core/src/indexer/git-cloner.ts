import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { LanguageId, SourceFile } from '../types/index.js';
import { v4 as uuidv4 } from 'uuid';

const DEFAULT_IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  'coverage',
  '.turbo',
  'vendor',
  '__pycache__',
  '.pytest_cache',
  'venv',
  '.venv',
  'target',
  'bin',
  'obj',
]);

const DEFAULT_IGNORED_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp',
  '.mp4', '.mp3', '.wav', '.mov',
  '.zip', '.tar', '.gz', '.7z', '.rar',
  '.exe', '.dll', '.so', '.dylib', '.wasm',
  '.lock', '-lock.json', '.log', '.map',
  '.min.js', '.min.css',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx',
]);

export function detectLanguage(filePath: string): LanguageId {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.ts':
    case '.tsx':
      return 'typescript';
    case '.js':
    case '.jsx':
    case '.mjs':
    case '.cjs':
      return 'javascript';
    case '.py':
      return 'python';
    case '.go':
      return 'go';
    case '.rs':
      return 'rust';
    case '.java':
      return 'java';
    default:
      return 'unknown';
  }
}

export function isSupportedLanguage(lang: LanguageId): boolean {
  return lang !== 'unknown';
}

export function computeHash(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

export interface CrawlOptions {
  repoId: string;
  targetDir: string;
  maxFileSizeKb?: number;
}

export interface CrawledFile {
  file: SourceFile;
  content: string;
}

export class FileCrawler {
  static crawl(options: CrawlOptions): CrawledFile[] {
    const { repoId, targetDir, maxFileSizeKb = 500 } = options;
    const maxBytes = maxFileSizeKb * 1024;
    const results: CrawledFile[] = [];

    function scan(currentDir: string) {
      if (!fs.existsSync(currentDir)) return;
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        const relPath = path.relative(targetDir, fullPath).replace(/\\/g, '/');

        if (entry.isDirectory()) {
          if (DEFAULT_IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.')) {
            continue;
          }
          scan(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (DEFAULT_IGNORED_EXTS.has(ext)) continue;

          const lang = detectLanguage(entry.name);
          if (!isSupportedLanguage(lang)) continue;

          try {
            const stats = fs.statSync(fullPath);
            if (stats.size > maxBytes || stats.size === 0) continue;

            const content = fs.readFileSync(fullPath, 'utf-8');
            const lines = content.split('\n').length;
            const contentHash = computeHash(content);

            const sourceFile: SourceFile = {
              id: uuidv4(),
              repoId,
              path: relPath,
              language: lang,
              lineCount: lines,
              sizeBytes: stats.size,
              contentHash,
              createdAt: new Date(),
            };

            results.push({ file: sourceFile, content });
          } catch {
            // skip unreadable files
          }
        }
      }
    }

    scan(targetDir);
    return results;
  }

  static cloneGitRepo(gitUrl: string, targetDir: string): string {
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
    fs.mkdirSync(targetDir, { recursive: true });
    execSync(`git clone --depth 1 "${gitUrl}" "${targetDir}"`, { stdio: 'pipe' });
    return targetDir;
  }
}
