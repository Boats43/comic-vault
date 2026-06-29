// FIX 3 — Vercel KV persistent cache wrapper
//
// Provides graceful fallback when KV is unavailable (local dev, KV downtime).
// All operations wrapped in try/catch — never crashes, falls through to API.
//
// Pattern:
//   const cached = await kvGet('cv:batman|1|dc');
//   if (cached) return cached;
//   const result = await apiCall();
//   await kvSet('cv:batman|1|dc', result, 86400); // TTL in seconds
//
// Key prefixes (namespace isolation):
//   cv: — ComicVine
//   pc: — PriceCharting
//   gc: — GoCollect
//   ac: — Active comps
//   bc: — Browse comps
//   ph: — PriceCharting HTML

let kv = null;
let kvUnavailable = false;
let kvInitPromise = null;

// Lazy-load KV client (only when first used)
const getKV = async () => {
  if (kvUnavailable) return null;
  if (kv) return kv;

  // Prevent concurrent initialization
  if (kvInitPromise) return kvInitPromise;

  kvInitPromise = (async () => {
    try {
      // Try to import @vercel/kv (may not exist locally)
      const kvModule = await import('@vercel/kv');
      kv = kvModule.kv;
      console.log('[kv-cache] KV client initialized');
      return kv;
    } catch (err) {
      console.warn('[kv-cache] KV client unavailable (local dev or not provisioned)');
      kvUnavailable = true;
      return null;
    }
  })();

  return kvInitPromise;
};

/**
 * Get value from KV cache.
 * Returns null on miss or error (graceful fallback).
 */
export const kvGet = async (key) => {
  const client = await getKV();
  if (!client) return null;

  try {
    const value = await client.get(key);
    if (value) {
      console.log('[kv-cache] HIT:', key);
      return value;
    }
    console.log('[kv-cache] MISS:', key);
    return null;
  } catch (err) {
    console.warn('[kv-cache] GET failed:', key, err.message);
    return null;
  }
};

/**
 * Set value in KV cache with TTL.
 * Fails silently on error (cache is best-effort).
 */
export const kvSet = async (key, value, ttlSeconds) => {
  const client = await getKV();
  if (!client) return;

  try {
    await client.set(key, value, { ex: ttlSeconds });
    console.log('[kv-cache] SET:', key, `(TTL: ${ttlSeconds}s)`);
  } catch (err) {
    console.warn('[kv-cache] SET failed:', key, err.message);
  }
};

/**
 * Delete value from KV cache.
 * Used for cache invalidation (rarely needed).
 */
export const kvDel = async (key) => {
  const client = await getKV();
  if (!client) return;

  try {
    await client.del(key);
    console.log('[kv-cache] DEL:', key);
  } catch (err) {
    console.warn('[kv-cache] DEL failed:', key, err.message);
  }
};

/**
 * TTL constants (in seconds, for KV ex: param)
 */
export const KV_TTL = {
  CV: 86400,        // 24 hours — ComicVine (story/creators rarely change)
  PC: 86400,        // 24 hours — PriceCharting (price ladder stable)
  GC: 86400,        // 24 hours — GoCollect (FMV monthly updates)
  ACTIVE: 3600,     // 1 hour — Active comps (listings change hourly)
  BROWSE: 21600,    // 6 hours — Browse comps
  PC_HTML: 604800,  // 7 days — PriceCharting HTML (very stable)
};
