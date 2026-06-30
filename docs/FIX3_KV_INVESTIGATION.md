# FIX 3 — VERCEL KV CACHE INVESTIGATION
**Date:** 2026-06-29  
**Status:** ⚠️ BLOCKED — KV store NOT provisioned

---

## INVESTIGATION RESULTS

### ✅ STEP 1: Package Installation

**Package:** `@vercel/kv@3.0.0` — ✅ INSTALLED

**⚠️ DEPRECATION WARNING:**
```
Vercel KV is deprecated. If you had an existing KV store, it should have 
moved to Upstash Redis which you will see under Vercel Integrations.
For new projects, install a Redis integration from Vercel Marketplace.
```

**Decision:** Proceed with `@vercel/kv` — API remains compatible, backend migrated to Upstash automatically.

---

### ❌ STEP 2: KV Store Provisioning

**Command:** `vercel env ls | grep -i "KV\|REDIS"`  
**Result:** No KV/Redis env vars found

**Missing environment variables:**
- `KV_URL`
- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`

**🚨 BLOCKER:** KV store must be provisioned in Vercel dashboard before deployment.

**Action required:**
1. Go to Vercel project dashboard
2. Navigate to **Storage** → **Create Database**
3. Select **KV** (Upstash Redis)
4. Name: `comic-vault-cache`
5. Region: Same as functions (US East)
6. Vercel will auto-inject env vars: `KV_URL`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`

---

### ✅ STEP 3: In-Memory Caches Found

#### Cache 1: ComicVine (`api/enrich.js:107`)
```javascript
const _cvCache = new Map();  // key: title|issue|publisher → { data, expires }
```
- **TTL:** 24 hours (86400s)
- **Pattern:** `{ data, expires }`
- **Usage:** Lines 1547-1563 (lookup + set)

#### Cache 2: PriceCharting (`api/enrich.js:108`)
```javascript
const _pcCache = new Map();  // key: title|issue → { data, expires }
```
- **TTL:** 24 hours (86400s)
- **Pattern:** `{ data, expires }`
- **Usage:** Lines 1689-1704 (lookup + set)

#### Cache 3: GoCollect (`api/enrich.js:109`)
```javascript
const _goCollectCache = new Map();  // key: title|issue → { data, expires }
```
- **TTL:** 24 hours (86400s)
- **Pattern:** `{ data, expires }`
- **Usage:** Lines 2350-2361 (lookup + set)

#### Cache 4: Active Comps (`api/enrich.js:110`)
```javascript
const _activeCompsCache = new Map();  // key: cleanTitle|issue → { data, expires }
```
- **TTL:** 1 hour (3600s) — NOT 6hr as documented
- **Pattern:** `{ data, expires }`
- **Usage:** Lines 1829-1842 (lookup + set)

#### Cache 5: Browse API Comps (`api/comps.js:18`)
```javascript
const _compsCache = new Map();
```
- **TTL:** 6 hours (21600s)
- **Pattern:** `{ data, expires }`
- **Usage:** Lines 569-575 (lookup + set)

#### Cache 6: PriceCharting HTML (`api/pricecharting-pop.js:25`)
```javascript
const htmlCache = new Map();
```
- **TTL:** 7 days (604800s)
- **Pattern:** `{ html, ts }`
- **Usage:** Lines 28-32 (lookup + set)

#### Cache 7: Finding API (`api/comps.js:158`)
```javascript
const findingCache = new Map();
```
- **TTL:** 6 hours (21600s)
- **Pattern:** `{ data, expires }`
- **Usage:** Dormant (Finding API dead)
- **Action:** Leave as-is (not worth migrating dead code)

#### Cache 8: Sold API (`api/sold.js:16`)
```javascript
const CACHE = new Map();
```
- **TTL:** 6 hours (21600s)
- **Pattern:** `{ data, expires }`
- **Usage:** Dormant (sold.js is helper-only)
- **Action:** Leave as-is (not worth migrating dead code)

---

## MIGRATION PLAN

### Caches to Migrate (6 active caches):

1. **ComicVine** (`api/enrich.js:107`) — TTL: 86400s (24hr)
2. **PriceCharting** (`api/enrich.js:108`) — TTL: 86400s (24hr)
3. **GoCollect** (`api/enrich.js:109`) — TTL: 86400s (24hr)
4. **Active Comps** (`api/enrich.js:110`) — TTL: 3600s (1hr)
5. **Browse Comps** (`api/comps.js:18`) — TTL: 21600s (6hr)
6. **PC HTML** (`api/pricecharting-pop.js:25`) — TTL: 604800s (7d)

### Caches to Skip (2 dormant caches):

7. **Finding API** (`api/comps.js:158`) — Skip (Finding API dead)
8. **Sold API** (`api/sold.js:16`) — Skip (sold.js dormant)

---

## IMPLEMENTATION PATTERN

### Before (in-memory, lost on cold start):
```javascript
const _cvCache = new Map();
const CV_TTL = 24 * 60 * 60 * 1000;

// Lookup
const key = `${title}|${issue}|${publisher}`;
const cached = _cvCache.get(key);
if (cached && cached.expires > Date.now()) {
  console.log('[cv-cache] HIT:', key);
  return cached.data;
}

// Set
const result = await lookupComicVine({ title, issue, year, publisher });
_cvCache.set(key, { data: result, expires: Date.now() + CV_TTL });
console.log('[cv-cache] SET:', key);
```

### After (persistent across cold starts):
```javascript
import { kv } from '@vercel/kv';

// Lookup
const key = `cv:${title}|${issue}|${publisher}`;
try {
  const cached = await kv.get(key);
  if (cached) {
    console.log('[kv-cache] HIT:', key);
    return cached;
  }
  console.log('[kv-cache] MISS:', key);
} catch (err) {
  console.warn('[kv-cache] KV unavailable, using live API:', err.message);
}

// Set
const result = await lookupComicVine({ title, issue, year, publisher });
try {
  await kv.set(key, result, { ex: 86400 }); // TTL in seconds
  console.log('[kv-cache] SET:', key);
} catch (err) {
  console.warn('[kv-cache] SET failed:', err.message);
}
```

---

## KEY PREFIXES (namespace isolation)

- `cv:` — ComicVine cache
- `pc:` — PriceCharting cache
- `gc:` — GoCollect cache
- `ac:` — Active comps cache
- `bc:` — Browse comps cache
- `ph:` — PriceCharting HTML cache

**Why prefixes?**
- Prevents key collisions (e.g., `batman|1` could be CV or PC)
- Enables selective cache invalidation (`kv.scan('cv:*')`)
- Makes debugging easier (logs show which cache)

---

## FALLBACK STRATEGY

**Every KV operation wrapped in try/catch:**
```javascript
try {
  const cached = await kv.get(key);
  if (cached) return cached;
} catch (err) {
  console.warn('[kv-cache] unavailable, falling through to API');
}
// Fall through to live API call
```

**Result:** System never crashes due to KV downtime. Cache is best-effort optimization, not critical dependency.

---

## EXPECTED IMPACT

### Cost Reduction:
- **ComicVine:** 24h cache → ~95% API call reduction (200/hr rate limit → ~10/hr)
- **PriceCharting:** 24h cache → ~90% scrape reduction (same books re-scanned)
- **GoCollect:** 24h cache → ~85% API call reduction (when key available)
- **Active Comps:** 1h cache → ~50% eBay Browse API reduction
- **Browse Comps:** 6h cache → ~70% eBay Browse API reduction

**Total estimated savings:** 50-80% external API costs

### Speed Improvement:
- **Cold start:** 5-10s enrichment → 2-3s (cached CV/PC/GC/comps)
- **Warm Lambda:** No change (in-memory cache already fast)
- **Cross-request:** First user benefits from second user's cache hits

### Consistency:
- **Before:** Same book scanned twice = different PC products (product list changes)
- **After:** Same book scanned twice = identical data (cached 24h)

---

## DEPLOYMENT CHECKLIST

**Before deploy:**
- [ ] KV store provisioned in Vercel dashboard
- [ ] Env vars confirmed: `KV_URL`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`
- [ ] Build passes: `npm run build`
- [ ] Tests pass: `node scripts/test-deterministic.mjs`
- [ ] Fallback tested: System works WITHOUT KV env vars (local dev)

**After deploy:**
- [ ] Monitor Vercel logs for `[kv-cache] HIT/SET/MISS` markers
- [ ] Verify cache persistence: scan same book twice, second scan = instant
- [ ] Check KV usage: Vercel dashboard → Storage → comic-vault-cache → Metrics
- [ ] Confirm no errors: `[kv-cache] unavailable` should be rare/never

---

## RECOMMENDATION

**🚨 BLOCK IMPLEMENTATION** until KV store is provisioned.

**Steps for user:**
1. Open Vercel dashboard: https://vercel.com/dashboard
2. Navigate to project: `comic-vault`
3. Click **Storage** tab
4. Click **Create Database** → **KV**
5. Name: `comic-vault-cache`
6. Region: **US East** (same as functions)
7. Click **Create**
8. Vercel auto-injects env vars (no manual setup needed)

**After provisioning:**
- Run `vercel env pull` to sync env vars locally
- Proceed with implementation (code changes below)

---

## CODE CHANGES READY

All 6 cache sites identified and migration pattern ready. Implementation will be straightforward once KV is provisioned.

**Estimated time:** ~1 hour (6 cache replacements + testing)

---

**AWAITING KV PROVISIONING BEFORE PROCEEDING.**
