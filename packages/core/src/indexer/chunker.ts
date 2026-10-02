import { CodeChunk, ExtractedSymbol, SourceFile } from '../types/index.js';
import { v4 as uuidv4 } from 'uuid';

export class SemanticChunker {
  private static MAX_TOKENS_PER_CHUNK = 600;
  private static MIN_TOKENS_PER_CHUNK = 25;

  static chunkFile(
    file: SourceFile,
    sourceCode: string,
    symbols: ExtractedSymbol[]
  ): CodeChunk[] {
    const lines = sourceCode.split('\n');
    const chunks: CodeChunk[] = [];
    const handledLines = new Set<number>();

    // 1. Sort symbols by start line
    const sortedSymbols = [...symbols].sort((a, b) => a.startLine - b.startLine);

    // 2. First pass: Create semantic chunks for each recognized symbol
    for (const sym of sortedSymbols) {
      const startIdx = Math.max(0, sym.startLine - 1);
      const endIdx = Math.min(lines.length, sym.endLine);

      for (let i = startIdx; i < endIdx; i++) {
        handledLines.add(i);
      }

      const symbolLines = lines.slice(startIdx, endIdx);
      const codeBlock = symbolLines.join('\n');
      const estimatedTokens = Math.ceil(codeBlock.length / 4);

      if (estimatedTokens <= this.MAX_TOKENS_PER_CHUNK) {
        // Fits comfortably in one chunk
        const header = `// File: ${file.path}\n// Scope: ${sym.kind} ${sym.name}\n`;
        const content = header + codeBlock;

        chunks.push({
          id: uuidv4(),
          repoId: file.repoId,
          fileId: file.id,
          symbolId: sym.id,
          filePath: file.path,
          symbolName: sym.name,
          symbolKind: sym.kind,
          content,
          startLine: sym.startLine,
          endLine: sym.endLine,
          tokenCount: Math.ceil(content.length / 4),
          vectorId: uuidv4(),
          createdAt: new Date(),
        });
      } else {
        // Large function/class: sub-chunk recursively with signature header retained
        const subChunks = this.splitLargeSymbol(file, sym, lines, startIdx, endIdx);
        chunks.push(...subChunks);
      }
    }

    // 3. Second pass: Collect unhandled module-level statements (imports, top-level constants)
    let looseBuffer: { lineIdx: number; text: string }[] = [];

    const flushBuffer = () => {
      if (looseBuffer.length === 0) return;
      const startLine = looseBuffer[0].lineIdx + 1;
      const endLine = looseBuffer[looseBuffer.length - 1].lineIdx + 1;
      const codeBlock = looseBuffer.map(b => b.text).join('\n').trim();

      if (codeBlock.length > 0) {
        const header = `// File: ${file.path}\n// Scope: Module Level\n`;
        const content = header + codeBlock;
        const tokens = Math.ceil(content.length / 4);

        if (tokens >= this.MIN_TOKENS_PER_CHUNK || chunks.length === 0) {
          chunks.push({
            id: uuidv4(),
            repoId: file.repoId,
            fileId: file.id,
            symbolId: null,
            filePath: file.path,
            symbolName: null,
            symbolKind: null,
            content,
            startLine,
            endLine,
            tokenCount: tokens,
            vectorId: uuidv4(),
            createdAt: new Date(),
          });
        }
      }
      looseBuffer = [];
    };

    for (let i = 0; i < lines.length; i++) {
      if (!handledLines.has(i)) {
        looseBuffer.push({ lineIdx: i, text: lines[i] });
        const currentTokens = Math.ceil(looseBuffer.map(b => b.text).join('\n').length / 4);
        if (currentTokens >= this.MAX_TOKENS_PER_CHUNK) {
          flushBuffer();
        }
      } else {
        if (looseBuffer.length > 0) {
          flushBuffer();
        }
      }
    }
    flushBuffer();

    return chunks;
  }

  private static splitLargeSymbol(
    file: SourceFile,
    sym: ExtractedSymbol,
    lines: string[],
    startIdx: number,
    endIdx: number
  ): CodeChunk[] {
    const chunks: CodeChunk[] = [];
    const signature = sym.signature || lines[startIdx];
    const headerPrefix = `// File: ${file.path}\n// Scope: ${sym.kind} ${sym.name} (Part)\n// Signature: ${signature}\n`;

    const CHUNK_LINE_SIZE = 40;
    for (let i = startIdx; i < endIdx; i += CHUNK_LINE_SIZE) {
      const sliceEnd = Math.min(endIdx, i + CHUNK_LINE_SIZE);
      const subLines = lines.slice(i, sliceEnd);
      const content = headerPrefix + subLines.join('\n');

      chunks.push({
        id: uuidv4(),
        repoId: file.repoId,
        fileId: file.id,
        symbolId: sym.id,
        filePath: file.path,
        symbolName: sym.name,
        symbolKind: sym.kind,
        content,
        startLine: i + 1,
        endLine: sliceEnd,
        tokenCount: Math.ceil(content.length / 4),
        vectorId: uuidv4(),
        createdAt: new Date(),
      });
    }

    return chunks;
  }
}
