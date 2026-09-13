// tests/gk201-operator-path-source-contract.test.js
//
// CODE CERTIFICATION — static source-text contract proof, this repo's own
// established convention for App.jsx-adjacent UI code (no jsdom/component
// mounting available here — see grailkey-directive-p-task3-variant-on-card
// and grailkey-directive-j-gk79a-relabel for precedent). Proves SHAPE and
// WIRING against the real committed files; does not execute a live request.
// Live behavior is separately covered by gk201-auth-primitives-unit and
// gk201-grailkey-session-unit (real execution, no DB) and is held for full
// end-to-end proof until Development is repaired (GK-179 regression).
//
// Invoke: node tests/gk201-operator-path-source-contract.test.js

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const read = (rel) => readFileSync(path.join(repoRoot, rel), 'utf8');

let passed = 0, failed = 0;
const failures = [];
function assertTrue(cond, label) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
}

console.log('--- api/assets.js: collectionItemId wiring ---');
{
  const src = read('api/assets.js');
  assertTrue(src.includes("import { verifyToken, InvalidTokenError } from '../src/modules/auth/index.js';"),
    'still derives the principal exclusively from the verified bearer token');
  assertTrue(/resolveCollectionItemLink/.test(src), 'imports/calls resolveCollectionItemLink for the new lookup path');
  assertTrue(/req\.query\?\.collectionItemId/.test(src), 'reads collectionItemId from the query string, not the body');
  assertTrue(!/principalId\s*[:=]\s*req\.(query|body)/.test(src),
    'principalId is never assigned from a client-supplied query/body field');
  assertTrue(/if \(!link\) return res\.status\(404\)/.test(src),
    'a null resolution (unowned or nonexistent collectionItemId) returns 404, the same shape as every other not-found/unauthorized case in this file');
}

console.log('--- src/components/GrailKeyLoginGate.jsx ---');
{
  const src = read('src/components/GrailKeyLoginGate.jsx');
  assertTrue(/api\/auth-login/.test(src), 'posts to the existing auth-login endpoint, no new auth mechanism');
  assertTrue(!/console\.(log|error|warn)\([^)]*passphrase/i.test(src), 'never logs the passphrase');
  assertTrue(!/console\.(log|error|warn)\([^)]*token/i.test(src), 'never logs the token');
  assertTrue(/setSession\(/.test(src), 'stores the returned session via the shared session helper, not ad hoc localStorage calls');
}

console.log('--- src/components/GrailKeyOperatorPanel.jsx ---');
{
  const src = read('src/components/GrailKeyOperatorPanel.jsx');
  assertTrue(!/list-ebay|delist-ebay|ebay\.com|fetch\([^)]*ebay/i.test(src), 'no eBay call anywhere in the operator panel');
  assertTrue(!/mint|createPhysicalAsset/i.test(src), 'never mints an asset from the UI');
  assertTrue(!/method:\s*["'](PUT|PATCH|DELETE)["']/.test(src),
    'issues no PUT/PATCH/DELETE request — the only write is the POST to operator-action');
  assertTrue(!/decision_event["'\s]*[:=]/.test(src) && !/updateDecision|reviseDecision|editDecision/.test(src),
    'never attempts to mutate decision_event — only reads it and posts a separate operator-action');
  assertTrue(/api\/operator-action/.test(src), 'posts to the existing operator-action endpoint, no new write path');
  assertTrue(/getOrCreatePendingIdempotencyKey/.test(src) && !/idempotencyKey:\s*crypto\.randomUUID\(\)/.test(src),
    'idempotency key comes from the reload-safe persisted lifecycle helper, never a bare inline crypto.randomUUID() per submit');
  assertTrue(/retirePendingIdempotencyKey/.test(src), 'retires the pending key on a definitive response');
  assertTrue(/getPrincipalScope/.test(src), 'namespaces the pending key by principal scope (shared-browser safety)');
  assertTrue(/principalScope,\s*gkAssetId/.test(src), 'principalScope is threaded into the idempotency calls, not left implicit');
  assertTrue(/isDefinitiveResponseStatus/.test(src), 'distinguishes definitive vs ambiguous responses before deciding whether to retire');
  assertTrue(/disabled=\{submitting/.test(src), 'action buttons are disabled while a submission is in flight (double-click guard)');
  assertTrue(!/console\.(log|error|warn)\([^)]*token/i.test(src), 'never logs the session token');
  assertTrue(/latestDecision\?\.id/.test(src) && /decisionEventId,\s*actionCode/.test(src),
    'decisionEventId sent to the server is derived from the real decision_event row id, never guessed/hardcoded');
  assertTrue(!/['"]Creepy['"]/i.test(src), 'Chain #2\'s subject is never hardcoded into the production component');
}

console.log('--- src/lib/operatorActionIdempotency.js ---');
{
  const src = read('src/lib/operatorActionIdempotency.js');
  assertTrue(/localStorage\.(get|set|remove)Item/.test(src), 'persists via localStorage (the chosen, smallest-consistent-with-architecture mechanism)');
  assertTrue(!/indexedDB|IDBDatabase/.test(src), 'does not also reach for IndexedDB — one mechanism, not two');
  assertTrue(/principalScope.*gkAssetId.*decisionEventId.*actionCode/s.test(src),
    'the storage key is scoped to (principalScope, gkAssetId, decisionEventId, actionCode) — a shared browser namespaces per operator');
  assertTrue(/gk_pending_op:v1:/.test(src), 'storage key carries the v1 format marker (this dispatch\'s format change)');
  assertTrue(!/setTimeout\(.*remove|setInterval\(.*remove/.test(src), 'no automatic time-based deletion of a pending key exists in this file');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) { console.log('\nFAILURES:'); failures.forEach(f => console.log(f)); process.exit(1); }
process.exit(0);
