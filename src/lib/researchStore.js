// GK-273 — persistence + cost-control primitives for Research the Market.
//
// FAIL-CLOSED: unlike kv-cache.js (best-effort, fails silently), this store
// is the daily-limit and de-dupe authority, so an unavailable store must
// STOP a paid run rather than let it through uncounted.
//
// Every key is namespaced by principalId — there is no cross-principal read
// path, by construction.

export class ResearchStoreUnavailableError extends Error {
  constructor(msg = 'research store unavailable') {
    super(msg);
    this.name = 'ResearchStoreUnavailableError';
  }
}

let override = null;
export const setResearchStoreForTests = (store) => { override = store; };

let redis = null;
const getRedis = async () => {
  if (redis) return redis;
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    throw new ResearchStoreUnavailableError('KV_REST_API_URL / KV_REST_API_TOKEN not configured');
  }
  const { Redis } = await import('@upstash/redis');
  redis = Redis.fromEnv();
  return redis;
};

const wrap = async (fn) => {
  try {
    return await fn(await getRedis());
  } catch (e) {
    if (e instanceof ResearchStoreUnavailableError) throw e;
    throw new ResearchStoreUnavailableError(e?.message || 'research store error');
  }
};

const redisStore = {
  get: (key) => wrap((r) => r.get(key)),
  set: (key, value, ttlSeconds) => wrap((r) => r.set(key, value, { ex: ttlSeconds })),
  del: (key) => wrap((r) => r.del(key)),
  // Atomic set-if-absent; true when this caller acquired it.
  setNx: (key, value, ttlSeconds) => wrap(async (r) => (await r.set(key, value, { nx: true, ex: ttlSeconds })) === 'OK'),
  // Atomic increment that (re)arms the TTL on first creation.
  incr: (key, ttlSeconds) => wrap(async (r) => {
    const n = await r.incr(key);
    if (n === 1) await r.expire(key, ttlSeconds);
    return n;
  }),
  decr: (key) => wrap((r) => r.decr(key)),
};

export const researchStore = () => override || redisStore;

// In-memory implementation for deterministic tests (same contract).
export const createMemoryResearchStore = () => {
  const m = new Map();
  const now = () => Date.now();
  const live = (k) => { const e = m.get(k); if (!e) return null; if (e.exp && e.exp <= now()) { m.delete(k); return null; } return e; };
  return {
    _dump: () => Object.fromEntries([...m.entries()].map(([k, e]) => [k, e.v])),
    get: async (k) => live(k)?.v ?? null,
    set: async (k, v, ttl) => { m.set(k, { v: JSON.parse(JSON.stringify(v)), exp: ttl ? now() + ttl * 1000 : 0 }); },
    del: async (k) => { m.delete(k); },
    setNx: async (k, v, ttl) => { if (live(k)) return false; m.set(k, { v, exp: ttl ? now() + ttl * 1000 : 0 }); return true; },
    incr: async (k, ttl) => { const e = live(k); const n = (e ? e.v : 0) + 1; m.set(k, { v: n, exp: e?.exp || (ttl ? now() + ttl * 1000 : 0) }); return n; },
    decr: async (k) => { const e = live(k); const n = (e ? e.v : 0) - 1; m.set(k, { v: n, exp: e?.exp || 0 }); return n; },
  };
};

// ───────────────────────── key scheme (always principal-scoped) ─────────────────────────

const clean = (s) => String(s).replace(/[^A-Za-z0-9._:-]/g, '_');
export const resultKey = (principalId, assetKey, fingerprint) => `rm:v1:res:${clean(principalId)}:${clean(assetKey)}:${clean(fingerprint)}`;
export const lastKey = (principalId, assetKey) => `rm:v1:last:${clean(principalId)}:${clean(assetKey)}`;
export const lockKey = (principalId, assetKey, fingerprint) => `rm:v1:lock:${clean(principalId)}:${clean(assetKey)}:${clean(fingerprint)}`;
export const dayKey = (principalId, date = new Date()) => `rm:v1:day:${clean(principalId)}:${date.toISOString().slice(0, 10)}`;
