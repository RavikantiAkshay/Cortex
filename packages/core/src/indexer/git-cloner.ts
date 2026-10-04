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

  static readSingleFile(repoId: string, baseDir: string, relPath: string, maxFileSizeKb = 500): CrawledFile | null {
    const fullPath = path.resolve(baseDir, relPath);
    if (!fs.existsSync(fullPath)) return null;

    const ext = path.extname(relPath).toLowerCase();
    if (DEFAULT_IGNORED_EXTS.has(ext)) return null;

    const lang = detectLanguage(relPath);
    if (!isSupportedLanguage(lang)) return null;

    try {
      const stats = fs.statSync(fullPath);
      if (stats.size > maxFileSizeKb * 1024 || stats.size === 0) return null;

      const content = fs.readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n').length;
      const contentHash = computeHash(content);

      const sourceFile: SourceFile = {
        id: uuidv4(),
        repoId,
        path: relPath.replace(/\\/g, '/'),
        language: lang,
        lineCount: lines,
        sizeBytes: stats.size,
        contentHash,
        createdAt: new Date(),
      };

      return { file: sourceFile, content };
    } catch {
      return null;
    }
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

export interface GitDiffResult {
  isGitRepo: boolean;
  currentCommit: string | null;
  hasChanges: boolean;
  addedFiles: string[];
  modifiedFiles: string[];
  deletedFiles: string[];
}

export class GitUtils {
  static isGitRepo(dir: string): boolean {
    if (!fs.existsSync(dir)) return false;
    try {
      const res = execSync('git rev-parse --is-inside-work-tree', {
        cwd: dir,
        stdio: 'pipe',
        encoding: 'utf-8',
      }).trim();
      return res === 'true';
    } catch {
      return false;
    }
  }

  static getCurrentCommit(dir: string): string | null {
    if (!this.isGitRepo(dir)) return null;
    try {
      return execSync('git rev-parse HEAD', {
        cwd: dir,
        stdio: 'pipe',
        encoding: 'utf-8',
      }).trim();
    } catch {
      return null;
    }
  }

  static getDiffFiles(dir: string, baseCommit?: string | null): GitDiffResult {
    if (!this.isGitRepo(dir)) {
      return {
        isGitRepo: false,
        currentCommit: null,
        hasChanges: false,
        addedFiles: [],
        modifiedFiles: [],
        deletedFiles: [],
      };
    }

    const currentCommit = this.getCurrentCommit(dir);
    const addedFiles = new Set<string>();
    const modifiedFiles = new Set<string>();
    const deletedFiles = new Set<string>();

    // 1. If baseCommit is provided and valid, check committed diff between baseCommit and HEAD
    if (baseCommit && baseCommit !== currentCommit) {
      try {
        const diffOutput = execSync(`git diff --name-status "${baseCommit}" HEAD`, {
          cwd: dir,
          stdio: 'pipe',
          encoding: 'utf-8',
        }).trim();
        if (diffOutput) {
          const lines = diffOutput.split('\n');
          for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 2) {
              const status = parts[0][0]; // 'M', 'A', 'D', 'R'
              const filePath = parts[parts.length - 1].replace(/\\/g, '/');
              if (status === 'A') addedFiles.add(filePath);
              else if (status === 'D') deletedFiles.add(filePath);
              else modifiedFiles.add(filePath);
            }
          }
        }
      } catch {
        // Fallback to working status if baseCommit is not in branch history
      }
    }

    // 2. Also check uncommitted working directory changes (staged + unstaged + untracked)
    try {
      const statusOutput = execSync('git status --porcelain', {
        cwd: dir,
        stdio: 'pipe',
        encoding: 'utf-8',
      }).trim();
      if (statusOutput) {
        const lines = statusOutput.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const status = trimmed.slice(0, 2);
          const filePath = trimmed.slice(2).trim().replace(/^"|"$/g, '').replace(/\\/g, '/');

          if (status.includes('D')) {
            deletedFiles.add(filePath);
            modifiedFiles.delete(filePath);
            addedFiles.delete(filePath);
          } else if (status.includes('?') || status.includes('A')) {
            addedFiles.add(filePath);
          } else {
            modifiedFiles.add(filePath);
          }
        }
      }
    } catch {}

    return {
      isGitRepo: true,
      currentCommit,
      hasChanges: addedFiles.size > 0 || modifiedFiles.size > 0 || deletedFiles.size > 0,
      addedFiles: Array.from(addedFiles),
      modifiedFiles: Array.from(modifiedFiles),
      deletedFiles: Array.from(deletedFiles),
    };
  }
}
