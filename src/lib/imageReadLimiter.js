// src/lib/imageReadLimiter.js - GK-L1B v4: bounded, concurrency-safe PER-PRINCIPAL limit on protected image READS.
//
// WHY: every image GET costs one primary-key lookup (collection_item by principal_id + id, a pooled database connection),
// one media head() and one media getBytes() (about 100-150 KB from Blob). The credential already bounds WHO can read (their
// own images only, 10 minutes), but an authenticated principal in a tight loop could still drive unbounded database and
// egress work. The shared api/rate-limit.js (30 requests / 10 min, keyed by IP) was the wrong tool for the old endpoint:
// a single Collection screen legitimately loads dozens of thumbnails, so it turned them into 429 broken images.
//
// DESIGN (chosen from measured loading behaviour, not an arbitrary ceiling):
//   * keyed by the VERIFIED principal (from the signed credential), never by IP - users behind one shared address
//     (office, carrier-grade NAT) never throttle each other, and one principal's exhaustion never affects another.
//   * TOKEN BUCKET: capacity BURST_CAPACITY reads, refilling REFILL_PER_SECOND. A bucket check is synchronous, so under
//     Node's single-threaded event loop it is atomic: concurrent requests each see a distinct post-decrement value and cannot
//     jointly exceed the capacity.
//   * IN-FLIGHT CAP: at most MAX_INFLIGHT concurrent reads per principal, released in a finally block, so a stalled blob
//     cannot pile up unbounded concurrent work.
//   * PER-INSTANCE: state lives in this serverless instance's memory (the same trade-off api/rate-limit.js accepts). The
//     bound for one principal is therefore  limit x (number of warm instances)  - still finite, and each instance serves a
//     principal's own images only. A durable cross-instance counter would add an Upstash round trip to EVERY thumbnail
//     (dozens per screen) for a bound that the credential TTL and the browser cache already make small; revisit if abuse is seen.
//
// THRESHOLDS: BURST_CAPACITY 300 covers a full first load of a 199-item Collection (the operator's real size) with headroom;
// REFILL 1/s (600 reads per 10 minutes, 3,600/hour) restores a full screen in about 3 minutes. The browser's private cache
// (max-age <= 300 s, URLs stable across silent credential refreshes) means a returning viewer re-requests little.
//   expected worst-case load for ONE principal on ONE instance: 300 reads immediately, then 1 read/second sustained
//   = about 1 DB lookup + 2 media calls per second and ~0.13 MB/s (~470 MB/hour) of egress.
//
// MEMORY: idle buckets are pruned; the map is hard-bounded.

export const BURST_CAPACITY = 300;
export const REFILL_PER_SECOND = 1;
export const MAX_INFLIGHT = 40;
const IDLE_PRUNE_MS = 15 * 60 * 1000;
const MAX_TRACKED = 5000;

let cfg = { capacity: BURST_CAPACITY, refill: REFILL_PER_SECOND, maxInflight: MAX_INFLIGHT };
const buckets = new Map(); // principalId -> { tokens, ts, inflight }

/** TEST seam only: shrink the limits so exhaustion is cheap to prove. Production never calls it. */
export function configureImageReadLimiterForTests(next = {}) {
  cfg = { capacity: next.capacity ?? BURST_CAPACITY, refill: next.refill ?? REFILL_PER_SECOND, maxInflight: next.maxInflight ?? MAX_INFLIGHT };
  buckets.clear();
}
export const imageReadLimiterState = () => ({ ...cfg, tracked: buckets.size });

function prune(now) {
  if (buckets.size < MAX_TRACKED / 2) return;
  for (const [k, b] of buckets) if (b.inflight === 0 && now - b.ts > IDLE_PRUNE_MS) buckets.delete(k);
  if (buckets.size >= MAX_TRACKED) { // hard bound: drop the oldest idle entries
    const idle = [...buckets.entries()].filter(([, b]) => b.inflight === 0).sort((a, b) => a[1].ts - b[1].ts);
    for (const [k] of idle.slice(0, Math.ceil(MAX_TRACKED / 4))) buckets.delete(k);
  }
}

/**
 * @returns {{ok:true, release:()=>void} | {ok:false, reason:'rate'|'inflight', retryAfterSeconds:number}}
 * Synchronous (atomic under the event loop). The caller MUST call release() in a finally block when ok.
 */
export function acquireImageRead(principalId, now = Date.now()) {
  prune(now);
  let b = buckets.get(principalId);
  if (!b) { b = { tokens: cfg.capacity, ts: now, inflight: 0 }; buckets.set(principalId, b); }
  const elapsed = Math.max(0, now - b.ts) / 1000;
  b.tokens = Math.min(cfg.capacity, b.tokens + elapsed * cfg.refill);
  b.ts = now;
  if (b.inflight >= cfg.maxInflight) return { ok: false, reason: 'inflight', retryAfterSeconds: 1 };
  if (b.tokens < 1) return { ok: false, reason: 'rate', retryAfterSeconds: Math.max(1, Math.ceil((1 - b.tokens) / cfg.refill)) };
  b.tokens -= 1;
  b.inflight += 1;
  let released = false;
  return { ok: true, release: () => { if (!released) { released = true; b.inflight = Math.max(0, b.inflight - 1); } } };
}
