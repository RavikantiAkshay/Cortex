import { ExtractedSymbol, LanguageId, SymbolKind } from '../types/index.js';
import { v4 as uuidv4 } from 'uuid';

export interface ExtractedImport {
  sourceModule: string;
  importedSymbols: string[];
  rawStatement: string;
  line: number;
}

export interface ExtractionResult {
  symbols: ExtractedSymbol[];
  imports: ExtractedImport[];
}

export class SymbolExtractor {
  static extract(
    sourceCode: string,
    language: LanguageId,
    fileId: string,
    repoId: string
  ): ExtractionResult {
    switch (language) {
      case 'typescript':
      case 'javascript':
        return this.extractJavaScriptLike(sourceCode, fileId, repoId);
      case 'python':
        return this.extractPython(sourceCode, fileId, repoId);
      case 'go':
        return this.extractGo(sourceCode, fileId, repoId);
      default:
        return this.extractGeneric(sourceCode, fileId, repoId);
    }
  }

  private static extractJavaScriptLike(
    code: string,
    fileId: string,
    repoId: string
  ): ExtractionResult {
    const lines = code.split('\n');
    const symbols: ExtractedSymbol[] = [];
    const imports: ExtractedImport[] = [];

    // 1. Imports: import { a, b } from './module'; or import x from 'y';
    const importRegex = /^import\s+(?:(?:(?:\{([^}]+)\})|([*\w]+))\s+from\s+)?['"]([^'"]+)['"]/gm;
    let match: RegExpExecArray | null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Check imports
      if (line.startsWith('import ') || line.startsWith('import{')) {
        const namedMatch = line.match(/import\s+(?:\{([^}]+)\}|(\w+))\s+from\s+['"]([^'"]+)['"]/);
        const bareMatch = line.match(/import\s+['"]([^'"]+)['"]/);
        if (namedMatch) {
          const rawSymbols = namedMatch[1] || namedMatch[2] || '';
          const imported = rawSymbols
            .split(',')
            .map(s => s.trim().split(' as ')[0].trim())
            .filter(Boolean);
          imports.push({
            sourceModule: namedMatch[3],
            importedSymbols: imported,
            rawStatement: line,
            line: i + 1,
          });
        } else if (bareMatch) {
          imports.push({
            sourceModule: bareMatch[1],
            importedSymbols: [],
            rawStatement: line,
            line: i + 1,
          });
        }
      }

      // Check classes: class Foo [extends Bar] [implements Baz]
      const classMatch = line.match(/^(?:export\s+)?(?:default\s+)?class\s+(\w+)/);
      if (classMatch) {
        const name = classMatch[1];
        const endLine = this.findBlockEnd(lines, i);
        symbols.push({
          id: uuidv4(),
          fileId,
          repoId,
          name,
          kind: 'class',
          signature: line.replace(/\{.*$/, '').trim(),
          startLine: i + 1,
          endLine,
          createdAt: new Date(),
        });
      }

      // Check interfaces & types
      const interfaceMatch = line.match(/^(?:export\s+)?interface\s+(\w+)/);
      if (interfaceMatch) {
        const name = interfaceMatch[1];
        const endLine = this.findBlockEnd(lines, i);
        symbols.push({
          id: uuidv4(),
          fileId,
          repoId,
          name,
          kind: 'interface',
          signature: line.replace(/\{.*$/, '').trim(),
          startLine: i + 1,
          endLine,
          createdAt: new Date(),
        });
      }

      // Check functions: function foo(...)
      const funcMatch = line.match(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/);
      if (funcMatch) {
        const name = funcMatch[1];
        const endLine = this.findBlockEnd(lines, i);
        symbols.push({
          id: uuidv4(),
          fileId,
          repoId,
          name,
          kind: 'function',
          signature: line.replace(/\{.*$/, '').trim(),
          startLine: i + 1,
          endLine,
          createdAt: new Date(),
        });
      }

      // Check const/let arrow functions: const foo = async (...) =>
      const arrowMatch = line.match(
        /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[a-zA-Z0-9_]+)\s*=>/
      );
      if (arrowMatch) {
        const name = arrowMatch[1];
        const endLine = this.findBlockEnd(lines, i);
        symbols.push({
          id: uuidv4(),
          fileId,
          repoId,
          name,
          kind: 'function',
          signature: line.replace(/=>.*$/, '=>').trim(),
          startLine: i + 1,
          endLine,
          createdAt: new Date(),
        });
      }
    }

    return { symbols, imports };
  }

  private static extractPython(code: string, fileId: string, repoId: string): ExtractionResult {
    const lines = code.split('\n');
    const symbols: ExtractedSymbol[] = [];
    const imports: ExtractedImport[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Imports: from x import y, z  OR  import x
      const fromMatch = trimmed.match(/^from\s+([a-zA-Z0-9_.]+)\s+import\s+([^#]+)/);
      const importMatch = trimmed.match(/^import\s+([a-zA-Z0-9_., ]+)/);

      if (fromMatch) {
        const imported = fromMatch[2]
          .split(',')
          .map(s => s.trim().split(' as ')[0].trim())
          .filter(Boolean);
        imports.push({
          sourceModule: fromMatch[1],
          importedSymbols: imported,
          rawStatement: trimmed,
          line: i + 1,
        });
      } else if (importMatch) {
        const imported = importMatch[1]
          .split(',')
          .map(s => s.trim().split(' as ')[0].trim())
          .filter(Boolean);
        imports.push({
          sourceModule: imported[0] || '',
          importedSymbols: imported,
          rawStatement: trimmed,
          line: i + 1,
        });
      }

      // Classes: class Foo(Bar):
      const classMatch = trimmed.match(/^class\s+([a-zA-Z0-9_]+)(?:\(([^)]*)\))?:/);
      if (classMatch) {
        const name = classMatch[1];
        const endLine = this.findPythonBlockEnd(lines, i);
        symbols.push({
          id: uuidv4(),
          fileId,
          repoId,
          name,
          kind: 'class',
          signature: trimmed,
          startLine: i + 1,
          endLine,
          createdAt: new Date(),
        });
      }

      // Functions & Methods: def foo(...):
      const defMatch = trimmed.match(/^(?:async\s+)?def\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)(?:\s*->\s*[^:]+)?:/);
      if (defMatch) {
        const name = defMatch[1];
        const endLine = this.findPythonBlockEnd(lines, i);
        symbols.push({
          id: uuidv4(),
          fileId,
          repoId,
          name,
          kind: line.startsWith(' ') || line.startsWith('\t') ? 'method' : 'function',
          signature: trimmed,
          startLine: i + 1,
          endLine,
          createdAt: new Date(),
        });
      }
    }

    return { symbols, imports };
  }

  private static extractGo(code: string, fileId: string, repoId: string): ExtractionResult {
    const lines = code.split('\n');
    const symbols: ExtractedSymbol[] = [];
    const imports: ExtractedImport[] = [];

    let inImportBlock = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Go imports
      if (line === 'import (') {
        inImportBlock = true;
        continue;
      }
      if (inImportBlock) {
        if (line === ')') {
          inImportBlock = false;
        } else {
          const mod = line.replace(/["']/g, '').trim();
          if (mod) {
            imports.push({
              sourceModule: mod,
              importedSymbols: [],
              rawStatement: line,
              line: i + 1,
            });
          }
        }
        continue;
      }
      if (line.startsWith('import "')) {
        const mod = line.replace(/import\s+["']/g, '').replace(/["'].*$/, '').trim();
        imports.push({
          sourceModule: mod,
          importedSymbols: [],
          rawStatement: line,
          line: i + 1,
        });
      }

      // Functions: func Foo(...)
      const funcMatch = line.match(/^func\s+([A-Za-z0-9_]+)\s*\(/);
      if (funcMatch) {
        const endLine = this.findBlockEnd(lines, i);
        symbols.push({
          id: uuidv4(),
          fileId,
          repoId,
          name: funcMatch[1],
          kind: 'function',
          signature: line.replace(/\{.*$/, '').trim(),
          startLine: i + 1,
          endLine,
          createdAt: new Date(),
        });
      }

      // Methods: func (r *Receiver) MethodName(...)
      const methodMatch = line.match(/^func\s*\([^)]+\)\s*([A-Za-z0-9_]+)\s*\(/);
      if (methodMatch) {
        const endLine = this.findBlockEnd(lines, i);
        symbols.push({
          id: uuidv4(),
          fileId,
          repoId,
          name: methodMatch[1],
          kind: 'method',
          signature: line.replace(/\{.*$/, '').trim(),
          startLine: i + 1,
          endLine,
          createdAt: new Date(),
        });
      }

      // Structs: type Foo struct
      const structMatch = line.match(/^type\s+([A-Za-z0-9_]+)\s+struct/);
      if (structMatch) {
        const endLine = this.findBlockEnd(lines, i);
        symbols.push({
          id: uuidv4(),
          fileId,
          repoId,
          name: structMatch[1],
          kind: 'class',
          signature: line.replace(/\{.*$/, '').trim(),
          startLine: i + 1,
          endLine,
          createdAt: new Date(),
        });
      }
    }

    return { symbols, imports };
  }

  private static extractGeneric(code: string, fileId: string, repoId: string): ExtractionResult {
    // Basic fallback for unknown languages
    return { symbols: [], imports: [] };
  }

  private static findBlockEnd(lines: string[], startIdx: number): number {
    let braceCount = 0;
    let foundOpen = false;

    for (let i = startIdx; i < lines.length; i++) {
      const line = lines[i];
      for (const char of line) {
        if (char === '{') {
          braceCount++;
          foundOpen = true;
        } else if (char === '}') {
          braceCount--;
        }
      }

      if (foundOpen && braceCount <= 0) {
        return i + 1;
      }
    }

    return Math.min(startIdx + 20, lines.length);
  }

  private static findPythonBlockEnd(lines: string[], startIdx: number): number {
    const startLine = lines[startIdx];
    const initialIndent = startLine.search(/\S|$/);

    for (let i = startIdx + 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().length === 0) continue; // skip blank lines
      const indent = line.search(/\S|$/);
      if (indent <= initialIndent) {
        return i; // previous line was end of block
      }
    }
    return lines.length;
  }
}
