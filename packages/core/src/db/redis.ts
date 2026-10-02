import { Redis } from 'ioredis';

export interface CacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  getBuffer(key: string): Promise<Buffer | null>;
  setBuffer(key: string, value: Buffer, ttlSeconds?: number): Promise<void>;
  sadd(setKey: string, member: string): Promise<void>;
  smembers(setKey: string): Promise<string[]>;
  del(key: string): Promise<void>;
  ping(): Promise<string>;
}

class RealRedisStore implements CacheStore {
  private client: any;

  constructor(url: string) {
    this.client = new (Redis as any)(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.client.set(key, value, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, value);
    }
  }

  async getBuffer(key: string): Promise<Buffer | null> {
    return this.client.getBuffer(key);
  }

  async setBuffer(key: string, value: Buffer, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.client.set(key, value, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, value);
    }
  }

  async sadd(setKey: string, member: string): Promise<void> {
    await this.client.sadd(setKey, member);
  }

  async smembers(setKey: string): Promise<string[]> {
    return this.client.smembers(setKey);
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async ping(): Promise<string> {
    return this.client.ping();
  }
}

class EmbeddedCacheStore implements CacheStore {
  private strStore = new Map<string, { value: string; expiresAt?: number }>();
  private bufStore = new Map<string, { value: Buffer; expiresAt?: number }>();
  private setStore = new Map<string, Set<string>>();

  async get(key: string): Promise<string | null> {
    const entry = this.strStore.get(key);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.strStore.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined;
    this.strStore.set(key, { value, expiresAt });
  }

  async getBuffer(key: string): Promise<Buffer | null> {
    const entry = this.bufStore.get(key);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.bufStore.delete(key);
      return null;
    }
    return entry.value;
  }

  async setBuffer(key: string, value: Buffer, ttlSeconds?: number): Promise<void> {
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined;
    this.bufStore.set(key, { value, expiresAt });
  }

  async sadd(setKey: string, member: string): Promise<void> {
    let set = this.setStore.get(setKey);
    if (!set) {
      set = new Set<string>();
      this.setStore.set(setKey, set);
    }
    set.add(member);
  }

  async smembers(setKey: string): Promise<string[]> {
    const set = this.setStore.get(setKey);
    return set ? Array.from(set) : [];
  }

  async del(key: string): Promise<void> {
    this.strStore.delete(key);
    this.bufStore.delete(key);
    this.setStore.delete(key);
  }

  async ping(): Promise<string> {
    return 'PONG';
  }
}

let cacheInstance: CacheStore | null = null;

export async function getCacheStore(): Promise<CacheStore> {
  if (cacheInstance) return cacheInstance;

  const mode = process.env.REDIS_MODE || 'embedded';
  const url = process.env.REDIS_URL || 'redis://localhost:6379';

  if (mode === 'redis') {
    try {
      const real = new RealRedisStore(url);
      await real.connect();
      await real.ping();
      cacheInstance = real;
    } catch {
      console.warn(`[Cortex Cache] Could not connect to Redis at ${url}. Falling back to EmbeddedCacheStore.`);
      cacheInstance = new EmbeddedCacheStore();
    }
  } else {
    cacheInstance = new EmbeddedCacheStore();
  }

  return cacheInstance;
}
