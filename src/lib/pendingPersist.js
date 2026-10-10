// GK-280A — in-flight durable-persist registry (client). addToCatalogue returns as soon as the local
// IndexedDB write is done and starts the server push without awaiting it. A refresh of that same item
// that follows immediately would otherwise reach /api/enrich as an owned-item request before the server
// row exists (enrich fails closed in that case). Callers that are about to refresh an owned item wait,
// bounded, for THIS item's own in-flight push — they never block on anything else, and a timeout or a
// failed push changes nothing (the refresh simply proceeds exactly as it did before).
const pending = new Map();
const SETTLE_YIELD_MS = 80;

export function registerPendingPersist(id, promise) {
  if (typeof id !== 'string' || !id || !promise || typeof promise.then !== 'function') return promise;
  pending.set(id, promise);
  const clear = () => { if (pending.get(id) === promise) pending.delete(id); };
  promise.then(clear, clear);
  return promise;
}

/** Resolves 'none' (nothing in flight), 'settled', or 'timeout'. Never rejects, never throws. */
export async function awaitPendingPersist(id, timeoutMs = 5000) {
  const p = pending.get(id);
  if (!p) return 'none';
  let timer;
  try {
    const r = await Promise.race([
      p.then(() => 'settled', () => 'settled'),
      new Promise((resolve) => { timer = setTimeout(() => resolve('timeout'), timeoutMs); }),
    ]);
    // The persist's own completion handler updates React state; the card aborts any in-flight enrich when its item
    // changes (onAbortEnrich). Yield one macrotask so that commit lands BEFORE the caller sends its request.
    if (r === 'settled') await new Promise((resolve) => setTimeout(resolve, SETTLE_YIELD_MS));
    return r;
  } catch {
    return 'settled';
  } finally {
    clearTimeout(timer);
  }
}

export function __pendingPersistCountForTests() { return pending.size; }
