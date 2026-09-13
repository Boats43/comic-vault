// tests/gk201-operator-action-idempotency-lifecycle.test.js
//
// CODE CERTIFICATION — reload-safe idempotency-key lifecycle
// (src/lib/operatorActionIdempotency.js), the frontend correction requested
// on top of the existing, unmodified GK-163 server-side mechanism. Pure
// logic + a localStorage shim, no DB, no live Development connection.
// "Reload" is simulated exactly as it is in reality for this module: a
// fresh read of localStorage, since the module holds no in-memory state of
// its own between calls.
//
// Invoke: node tests/gk201-operator-action-idempotency-lifecycle.test.js

function makeLocalStorageShim() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}
globalThis.localStorage = makeLocalStorageShim();

const {
  getPendingIdempotencyKey,
  getOrCreatePendingIdempotencyKey,
  retirePendingIdempotencyKey,
  isDefinitiveResponseStatus,
  isStale,
} = await import('../src/lib/operatorActionIdempotency.js');

let passed = 0, failed = 0;
const failures = [];
function assertTrue(cond, label) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
}

const gkAssetId = 'asset-1';
const decisionEventId = 'decision-1';

console.log('--- first submit creates and persists K1 ---');
assertTrue(getPendingIdempotencyKey({ principalScope: 'test-principal', gkAssetId, decisionEventId, actionCode: 'LIST' }) === null, 'nothing pending before the first click');
const k1 = getOrCreatePendingIdempotencyKey({ principalScope: 'test-principal', gkAssetId, decisionEventId, actionCode: 'LIST' });
assertTrue(typeof k1.idempotencyKey === 'string' && k1.idempotencyKey.length > 0, 'K1 minted');
assertTrue(getPendingIdempotencyKey({ principalScope: 'test-principal', gkAssetId, decisionEventId, actionCode: 'LIST' })?.idempotencyKey === k1.idempotencyKey,
  'K1 is durably readable immediately after creation (persisted before any request would be sent)');

console.log('--- ambiguous outcome retains K1 ---');
// Simulated ambiguous failure: the caller simply does NOT call retire.
assertTrue(getPendingIdempotencyKey({ principalScope: 'test-principal', gkAssetId, decisionEventId, actionCode: 'LIST' }) !== null, 'K1 still present after a simulated timeout/network-drop (no retire called)');

console.log('--- reload preserves K1 ---');
// A "reload" is exactly a fresh call against localStorage — this module
// keeps no other state to lose.
const afterReload = getPendingIdempotencyKey({ principalScope: 'test-principal', gkAssetId, decisionEventId, actionCode: 'LIST' });
assertTrue(afterReload?.idempotencyKey === k1.idempotencyKey, 'the exact same key reads back after a simulated reload');

console.log('--- retry of the same (asset, decision, action) reuses K1 ---');
const retry = getOrCreatePendingIdempotencyKey({ principalScope: 'test-principal', gkAssetId, decisionEventId, actionCode: 'LIST' });
assertTrue(retry.idempotencyKey === k1.idempotencyKey, 'retrying the same LIST attempt reuses K1, never mints a new key');

console.log('--- definitive success retires K1 ---');
assertTrue(isDefinitiveResponseStatus(200) === true, '200 is definitive');
retirePendingIdempotencyKey({ principalScope: 'test-principal', gkAssetId, decisionEventId, actionCode: 'LIST' });
assertTrue(getPendingIdempotencyKey({ principalScope: 'test-principal', gkAssetId, decisionEventId, actionCode: 'LIST' }) === null, 'K1 is gone after a definitive success response');

console.log('--- a later deliberate LIST gets a new key (K2) ---');
const k2 = getOrCreatePendingIdempotencyKey({ principalScope: 'test-principal', gkAssetId, decisionEventId, actionCode: 'LIST' });
assertTrue(k2.idempotencyKey !== k1.idempotencyKey, 'K2 is a genuinely different key from K1');
retirePendingIdempotencyKey({ principalScope: 'test-principal', gkAssetId, decisionEventId, actionCode: 'LIST' });

console.log('--- switching the intended action gets an independent key ---');
const listKey = getOrCreatePendingIdempotencyKey({ principalScope: 'test-principal', gkAssetId, decisionEventId, actionCode: 'LIST' });
const holdKey = getOrCreatePendingIdempotencyKey({ principalScope: 'test-principal', gkAssetId, decisionEventId, actionCode: 'HOLD' });
const passKey = getOrCreatePendingIdempotencyKey({ principalScope: 'test-principal', gkAssetId, decisionEventId, actionCode: 'PASS' });
assertTrue(new Set([listKey.idempotencyKey, holdKey.idempotencyKey, passKey.idempotencyKey]).size === 3,
  'LIST/HOLD/PASS each hold their own independent pending key — changing intention never reuses another action\'s key');
assertTrue(getPendingIdempotencyKey({ principalScope: 'test-principal', gkAssetId, decisionEventId, actionCode: 'LIST' })?.idempotencyKey === listKey.idempotencyKey,
  'creating HOLD/PASS keys did not disturb the still-pending LIST key');
retirePendingIdempotencyKey({ principalScope: 'test-principal', gkAssetId, decisionEventId, actionCode: 'LIST' });
retirePendingIdempotencyKey({ principalScope: 'test-principal', gkAssetId, decisionEventId, actionCode: 'HOLD' });
retirePendingIdempotencyKey({ principalScope: 'test-principal', gkAssetId, decisionEventId, actionCode: 'PASS' });

console.log('--- definitive rejection retires the key, and a fresh attempt is a new key ---');
assertTrue(isDefinitiveResponseStatus(401) === true, '401 is definitive');
assertTrue(isDefinitiveResponseStatus(403) === true, '403 is definitive');
assertTrue(isDefinitiveResponseStatus(400) === true, '400 (validation) is definitive');
assertTrue(isDefinitiveResponseStatus(404) === true, '404 is definitive');
assertTrue(isDefinitiveResponseStatus(409) === true, '409/idempotency-conflict is definitive');
const kBeforeReject = getOrCreatePendingIdempotencyKey({ principalScope: 'test-principal', gkAssetId, decisionEventId, actionCode: 'HOLD' });
retirePendingIdempotencyKey({ principalScope: 'test-principal', gkAssetId, decisionEventId, actionCode: 'HOLD' }); // simulates the panel's own retire-on-definitive-rejection path
assertTrue(getPendingIdempotencyKey({ principalScope: 'test-principal', gkAssetId, decisionEventId, actionCode: 'HOLD' }) === null, 'key retired after a definitive rejection');
const kAfterReject = getOrCreatePendingIdempotencyKey({ principalScope: 'test-principal', gkAssetId, decisionEventId, actionCode: 'HOLD' });
assertTrue(kAfterReject.idempotencyKey !== kBeforeReject.idempotencyKey, 'a new attempt after a definitive rejection mints a genuinely new key, never the rejected one');
retirePendingIdempotencyKey({ principalScope: 'test-principal', gkAssetId, decisionEventId, actionCode: 'HOLD' });

console.log('--- non-definitive (ambiguous) statuses are never treated as resolved ---');
assertTrue(isDefinitiveResponseStatus(500) === false, '500 is treated as ambiguous, not definitive (conservative: retain, never assume nothing happened)');
assertTrue(isDefinitiveResponseStatus(503) === false, '503 is treated as ambiguous');

console.log('--- orphan/stale rule: age is informational only, never triggers auto-replacement ---');
{
  const staleAssetId = 'asset-stale';
  const rec = getOrCreatePendingIdempotencyKey({ principalScope: 'test-principal', gkAssetId: staleAssetId, decisionEventId, actionCode: 'LIST' });
  assertTrue(isStale(rec.createdAt) === false, 'a freshly-created key is not stale');
  // Simulate the operator returning much later: manually backdate the
  // stored record's createdAt past the documented threshold.
  const key = `gk_pending_op:v1:test-principal:${staleAssetId}:${decisionEventId}:LIST`;
  const backdated = { idempotencyKey: rec.idempotencyKey, createdAt: Date.now() - 25 * 60 * 60 * 1000 };
  localStorage.setItem(key, JSON.stringify(backdated));
  assertTrue(isStale(backdated.createdAt) === true, 'a 25h-old pending record is reported stale (informational label threshold)');
  const reused = getOrCreatePendingIdempotencyKey({ principalScope: 'test-principal', gkAssetId: staleAssetId, decisionEventId, actionCode: 'LIST' });
  assertTrue(reused.idempotencyKey === rec.idempotencyKey,
    'staleness never causes a new key to be minted — the same key is reused no matter how old it is, preserving correctness');
  retirePendingIdempotencyKey({ principalScope: 'test-principal', gkAssetId: staleAssetId, decisionEventId, actionCode: 'LIST' });
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) { console.log('\nFAILURES:'); failures.forEach(f => console.log(f)); process.exit(1); }
process.exit(0);
