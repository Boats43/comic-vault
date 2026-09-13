// tests/gk201-principal-scope-idempotency.test.js
//
// FINAL GK-201 CORRECTION — principal-scoped pending OperatorAction
// idempotency keys. Exactly the seven scenarios specified. Login/logout are
// NOT exercised as real functionality here — cases 2, 3, and 6 are test
// scenarios only: "logging in as A/B" is simulated by using a different
// principalScope string, exactly what getPrincipalScope() would yield from
// two different operators' tokens. No new logout/login/account-switch code
// is added anywhere by this file.
//
// Invoke: node tests/gk201-principal-scope-idempotency.test.js

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
} = await import('../src/lib/operatorActionIdempotency.js');

let passed = 0, failed = 0;
const failures = [];
function assertTrue(cond, label) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
}

const PRINCIPAL_A = 'principal-A-uuid';
const PRINCIPAL_B = 'principal-B-uuid';
const gkAssetId = 'asset-shared-browser';
const decisionEventId = 'decision-shared-browser';

console.log('--- 1. A creates ambiguous LIST K1 ---');
const K1 = getOrCreatePendingIdempotencyKey({ principalScope: PRINCIPAL_A, gkAssetId, decisionEventId, actionCode: 'LIST' });
assertTrue(typeof K1.idempotencyKey === 'string', 'A\'s K1 minted and persisted under A\'s own scope');
// Ambiguous outcome: no retire is called, exactly as the panel would leave
// it after a timeout/network drop.

console.log('--- 2. A logs out (test scenario only — no logout code exercised) ---');
// Logging out only ever clears the SESSION (grailkeySession.clearSession),
// which this file does not even hold — it never touches or clears any
// gk_pending_op:* record. Modeled here by simply no longer using
// PRINCIPAL_A's scope for the next steps.
assertTrue(getPendingIdempotencyKey({ principalScope: PRINCIPAL_A, gkAssetId, decisionEventId, actionCode: 'LIST' })?.idempotencyKey === K1.idempotencyKey,
  'logging out does not touch A\'s still-pending key — it is still on disk under A\'s scope');

console.log('--- 3. B logs in (test scenario only) ---');
// Modeled as: the panel now computes principalScope = PRINCIPAL_B for every
// subsequent call, exactly as getPrincipalScope() would return a different
// principalId once a different operator's token is the active session.
assertTrue(getPendingIdempotencyKey({ principalScope: PRINCIPAL_B, gkAssetId, decisionEventId, actionCode: 'LIST' }) === null,
  'B has no pending record yet under B\'s own scope');

console.log('--- 4. B cannot resolve/reuse A\'s K1 ---');
assertTrue(getPendingIdempotencyKey({ principalScope: PRINCIPAL_B, gkAssetId, decisionEventId, actionCode: 'LIST' })?.idempotencyKey !== K1.idempotencyKey,
  'B\'s lookup under the identical (gkAssetId, decisionEventId, actionCode) never yields A\'s key');
const bLookupBeforeSubmit = getOrCreatePendingIdempotencyKey({ principalScope: PRINCIPAL_B, gkAssetId, decisionEventId, actionCode: 'LIST' });
assertTrue(bLookupBeforeSubmit.idempotencyKey !== K1.idempotencyKey,
  'B minting/reusing a key for the same asset+decision+action produces a key genuinely distinct from A\'s K1, never a silent reuse across principals');
retirePendingIdempotencyKey({ principalScope: PRINCIPAL_B, gkAssetId, decisionEventId, actionCode: 'LIST' }); // cleanup before scenario 5's own fresh mint

console.log('--- 5. B\'s same asset/decision/action creates B-K1 ---');
const K1_B = getOrCreatePendingIdempotencyKey({ principalScope: PRINCIPAL_B, gkAssetId, decisionEventId, actionCode: 'LIST' });
assertTrue(typeof K1_B.idempotencyKey === 'string' && K1_B.idempotencyKey !== K1.idempotencyKey,
  'B-K1 is minted, independent of and different from A\'s K1, for the identical (gkAssetId, decisionEventId, actionCode) tuple');
assertTrue(getPendingIdempotencyKey({ principalScope: PRINCIPAL_A, gkAssetId, decisionEventId, actionCode: 'LIST' })?.idempotencyKey === K1.idempotencyKey,
  'A\'s K1 is completely undisturbed by B minting B-K1');

console.log('--- 6. A logs back in and recovers original A-K1 (test scenario only) ---');
// Modeled as: the panel now computes principalScope = PRINCIPAL_A again.
const aRecovered = getOrCreatePendingIdempotencyKey({ principalScope: PRINCIPAL_A, gkAssetId, decisionEventId, actionCode: 'LIST' });
assertTrue(aRecovered.idempotencyKey === K1.idempotencyKey,
  'A, back on the same browser, reuses the ORIGINAL K1 rather than minting a new one — the ambiguous attempt from step 1 is still safely resolvable');

console.log('--- 7. resolving A-K1 leaves B-K1 untouched ---');
retirePendingIdempotencyKey({ principalScope: PRINCIPAL_A, gkAssetId, decisionEventId, actionCode: 'LIST' }); // simulates A's definitive success/rejection
assertTrue(getPendingIdempotencyKey({ principalScope: PRINCIPAL_A, gkAssetId, decisionEventId, actionCode: 'LIST' }) === null,
  'A\'s key is retired');
assertTrue(getPendingIdempotencyKey({ principalScope: PRINCIPAL_B, gkAssetId, decisionEventId, actionCode: 'LIST' })?.idempotencyKey === K1_B.idempotencyKey,
  'B\'s still-pending key is completely unaffected by resolving A\'s — success/rejection retires only the matching principal-scoped key');
retirePendingIdempotencyKey({ principalScope: PRINCIPAL_B, gkAssetId, decisionEventId, actionCode: 'LIST' }); // cleanup

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) { console.log('\nFAILURES:'); failures.forEach(f => console.log(f)); process.exit(1); }
process.exit(0);
