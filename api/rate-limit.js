// A4 RATE LIMIT — per-principal(+IP) sliding window, in-memory.
// 30 scans / 10 minutes per unique (principal+IP) pair.
// Returns 429 + x-ratelimit-remaining header.
//
// GK-269 (2026-09-30, FINAL AUTH CLOSURE) — previously keyed on
// `req.headers['x-vault-key'] || 'anonymous'`, the same shared secret
// this dispatch retires as an authentication mechanism. Cost control is a
// SEPARATE concern from authentication (src/lib/accessGate.js's own new
// header) — this function now keys on the caller's verified principalId
// when one is available (the 5 AI-cost endpoints now require one
// unconditionally via accessGate.js, so they always pass it), falling
// back to IP-only bucketing for the handful of pre-authentication
// endpoints (auth-login.js, auth-clerk.js) that call this before any
// session can exist. No other call site's behavior changes: none of the
// other ~19 already-session-gated endpoints (assets.js, collection.js,
// operator-action.js, ...) ever sent x-vault-key in the first place, so
// they were already effectively bucketed by IP alone under the old
// keying — this is a correction of the 5 AI-cost endpoints' bucket
// identity, not a behavior change for the rest.

const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_REQUESTS = 30;

// In-memory store: { "key:ip": [timestamp1, timestamp2, ...] }
const requests = new Map();

export function checkRateLimit(req, { principalId } = {}) {
  const key = principalId || 'anonymous';
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
    || req.headers['x-real-ip']
    || req.socket?.remoteAddress
    || 'unknown';

  const clientId = `${key}:${ip}`;
  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  // Get existing timestamps for this client, filter to sliding window
  const timestamps = (requests.get(clientId) || []).filter(t => t > windowStart);

  // Check if limit exceeded
  if (timestamps.length >= MAX_REQUESTS) {
    const oldestInWindow = Math.min(...timestamps);
    const resetMs = (oldestInWindow + WINDOW_MS) - now;
    const resetSec = Math.ceil(resetMs / 1000);
    return {
      allowed: false,
      remaining: 0,
      reset: resetSec,
      error: `Rate limit exceeded. Try again in ${resetSec} seconds.`,
    };
  }

  // Add current request timestamp
  timestamps.push(now);
  requests.set(clientId, timestamps);

  return {
    allowed: true,
    remaining: MAX_REQUESTS - timestamps.length,
    reset: Math.ceil(WINDOW_MS / 1000),
  };
}

// Periodic cleanup of stale entries (runs every 5 minutes)
setInterval(() => {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;
  for (const [clientId, timestamps] of requests.entries()) {
    const active = timestamps.filter(t => t > windowStart);
    if (active.length === 0) {
      requests.delete(clientId);
    } else {
      requests.set(clientId, active);
    }
  }
}, 5 * 60 * 1000);
