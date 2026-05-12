/**
 * Forge MCP — In-Memory TTL Cache Layer
 *
 * Generic TTL cache with LRU-style eviction and singleton instances
 * for Forge API endpoints.
 */

// ─── TTL Cache ─────────────────────────────────────────────────────────

export class TTLCache<T> {
  private cache: Map<string, { data: T; expiresAt: number }>;
  private maxSize: number;
  private defaultTtl: number;
  private hits = 0;
  private misses = 0;

  constructor(maxSize = 100, defaultTtl = 30_000) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.defaultTtl = defaultTtl;
  }

  /** Get a value from the cache. Returns undefined if missing or expired. */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.misses++;
      return undefined;
    }
    this.hits++;
    return entry.data;
  }

  /** Set a value in the cache with a TTL in milliseconds. */
  set(key: string, data: T, ttlMs?: number): void {
    if (this.cache.size >= this.maxSize) {
      // LRU-style eviction: remove the oldest entry (first insertion order)
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtl),
    });
  }

  /** Check if a key exists in the cache and is not expired. */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  /** Delete a key from the cache. */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /** Clear all entries and reset hit/miss counters. */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /** Get cache statistics. */
  stats(): { size: number; hits: number; misses: number; hitRate: number } {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }
}

// ─── Singleton Cache Instances ─────────────────────────────────────────

/** Cache for packs catalog — TTL 60s */
export const packsCache = new TTLCache<any>(100, 60_000);

/** Cache for agents list — TTL 30s */
export const agentsCache = new TTLCache<any>(100, 30_000);

/** Cache for user profile — TTL 15s */
export const profileCache = new TTLCache<any>(100, 15_000);

/** Default fallback cache — TTL 30s */
export const anyCache = new TTLCache<any>(100, 30_000);

// ─── Cache Routing ─────────────────────────────────────────────────────

/**
 * Determine if a request should be cached based on HTTP method and path.
 * Returns true for GET requests to non-sensitive paths.
 */
export function shouldCache(method: string, path: string): boolean {
  if (method.toUpperCase() !== "GET") return false;

  // Never cache sensitive/auth paths
  if (path.startsWith("/v1/auth/")) return false;
  if (path.startsWith("/v1/webhooks/")) return false;

  // Cacheable paths
  const cacheablePaths = ["/packs", "/v1/agents", "/v1/me", "/v1/me/tier"];
  return cacheablePaths.some((p) => path.startsWith(p));
}

/**
 * Pick the right cache singleton based on the request path prefix.
 */
export function getCacheForPath(path: string): TTLCache<any> {
  if (path.startsWith("/packs")) return packsCache;
  if (path.startsWith("/v1/agents")) return agentsCache;
  if (path.startsWith("/v1/me")) return profileCache;
  return anyCache;
}
