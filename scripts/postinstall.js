import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const cortexDir = path.join(root, 'node_modules', '@cortex');
const targetLink = path.join(cortexDir, 'core');
const sourceCore = path.join(root, 'packages', 'core');

if (fs.existsSync(sourceCore)) {
  try {
    if (!fs.existsSync(cortexDir)) {
      fs.mkdirSync(cortexDir, { recursive: true });
    }
    if (!fs.existsSync(targetLink)) {
      try {
        fs.symlinkSync(sourceCore, targetLink, 'junction');
      } catch {
        fs.cpSync(sourceCore, targetLink, { recursive: true });
      }
    }
  } catch (err) {
    // Non-fatal fallback
    console.error('Notice: Could not link @cortex/core in node_modules:', err.message);
  }
}
