import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;

export interface DatabaseAdapter {
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

class PostgresAdapter implements DatabaseAdapter {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
    const res = await this.pool.query(sql, params);
    return res.rows as T[];
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

class PGliteAdapter implements DatabaseAdapter {
  private pglite: PGlite;

  constructor(dataDir?: string) {
    if (dataDir) {
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      this.pglite = new PGlite(dataDir);
    } else {
      this.pglite = new PGlite();
    }
  }

  async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
    const res = await this.pglite.query<T>(sql, params);
    return res.rows;
  }

  async exec(sql: string): Promise<void> {
    await this.pglite.exec(sql);
  }

  async close(): Promise<void> {
    await this.pglite.close();
  }
}

let dbInstance: DatabaseAdapter | null = null;

import { resolveDataPath } from './paths.js';

export async function getDatabase(): Promise<DatabaseAdapter> {
  if (dbInstance) return dbInstance;

  const mode = process.env.DATABASE_MODE || 'embedded';
  const url = process.env.DATABASE_URL || 'postgresql://cortex:cortex_secret@localhost:5432/cortex_db';
  const rawPath = process.env.DATABASE_PATH || 'data/cortex_db';
  const dataPath = resolveDataPath(rawPath);

  if (mode === 'postgres') {
    try {
      const adapter = new PostgresAdapter(url);
      await adapter.query('SELECT 1');
      dbInstance = adapter;
    } catch (err) {
      console.warn(`[Cortex DB] Unable to connect to PostgreSQL at ${url}. Falling back to embedded PGlite.`);
      dbInstance = new PGliteAdapter(dataPath);
    }
  } else {
    dbInstance = new PGliteAdapter(dataPath);
  }

  await initializeSchema(dbInstance);
  return dbInstance;
}

export async function initializeSchema(db: DatabaseAdapter): Promise<void> {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  let schemaPath = path.resolve(__dirname, 'schema.sql');
  if (!fs.existsSync(schemaPath)) {
    schemaPath = path.resolve(__dirname, '../../src/db/schema.sql');
  }
  
  if (fs.existsSync(schemaPath)) {
    const ddl = fs.readFileSync(schemaPath, 'utf-8');
    const statements: string[] = [];
    let current = '';
    let inDollarQuote = false;

    for (let i = 0; i < ddl.length; i++) {
      if (ddl.slice(i, i + 2) === '$$') {
        inDollarQuote = !inDollarQuote;
        current += '$$';
        i++;
        continue;
      }
      if (ddl[i] === ';' && !inDollarQuote) {
        if (current.trim().length > 0) statements.push(current.trim());
        current = '';
      } else {
        current += ddl[i];
      }
    }
    if (current.trim().length > 0) statements.push(current.trim());

    for (const stmt of statements) {
      try {
        await db.exec(stmt);
      } catch (e: any) {
        if (!e.message?.includes('already exists') && !e.message?.includes('extension')) {
          console.warn(`[Cortex DB Schema Notice] ${e.message ? e.message.slice(0, 90) : ''}`);
        }
      }
    }
  }
}
