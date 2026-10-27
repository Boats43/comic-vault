// tests/v11a-approve-and-list-ui.test.js -- V1.1a Phase 1: where the one-action control may appear, and that the Q41 / LIST logic was
// MOVED to the shared modules (not copied): no inline payload literals remain in App.jsx, the operator panel no longer owns the
// /api/operator-action request. DB-free, network-free (Vite SSR loads the real components).
//
// Invoke: node tests/v11a-approve-and-list-ui.test.js

import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  PASS ${l}`); } else { failed++; console.log(`  FAIL ${l}`); } };

const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const panel = readFileSync(new URL('../src/components/GrailKeyOperatorPanel.jsx', import.meta.url), 'utf8');
const slice = (src, from, to) => { const a = src.indexOf(from); const b = src.indexOf(to, a + 1); return a < 0 || b < 0 ? null : src.slice(a, b); };

console.log('\n--- 1. the control appears ONLY where an existing acknowledgement / List control already does ---');
ok((app.match(/<ApproveAndListControl/g) || []).length === 3, 'exactly three render sites (insufficiency ack, research ack, final List branch)');
const integrity = slice(app, '// Integrity lock — hard, never acknowledgeable', '// Ship #26 v0-D — Decision Engine hard-block gate');
ok(integrity && !integrity.includes('ApproveAndListControl'), 'NOT in the integrity-lock branch (never acknowledgeable)');
const blocker = slice(app, 'if (hasDecisionBlocker) {', '// Q73: Incomplete enrich state');
ok(blocker && !blocker.includes('ApproveAndListControl'), 'NOT in the decision-engine hard-block branch');
const linkGate = slice(app, 'if (linkGate.blocked) {', 'const linkGate') || slice(app, 'if (linkGate.blocked) {', 'data-testid="listing-link-gate"');
ok(linkGate && !linkGate.includes('ApproveAndListControl'), 'NOT in the physical-asset link-gate branch');
ok(/onApproveAndList && !listLocked/.test(app), 'the final-branch control is additionally withheld when the List button is locked');
ok(app.includes('onApproveAndList={approveAndListItem}'), 'CollectionDetail receives the orchestrator wiring');

console.log('\n--- 2. the logic moved to shared modules (no copies left behind) ---');
ok(!/lockClassAcknowledged:/.test(app), 'App.jsx no longer builds Q41 payloads inline');
ok(/buildQ41Payload\(\{ kind: Q41_KIND\.INSUFFICIENCY/.test(app) && /buildQ41Payload\(\{ kind: Q41_KIND\.RESEARCH_NOT_LISTABLE/.test(app) && /buildQ41Override\(/.test(app), 'the existing buttons and handleList call the shared Q41 module');
ok(!/authFetch\("\/api\/operator-action"/.test(panel) && /recordListAction\(/.test(panel), 'the operator panel records actions through the shared recorder');
ok(/approveAndList\(\{ item, price, confirmed, deps, onStep \}\)/.test(app), 'the one-action flow passes the explicit confirmation through unchanged');
ok(!/confirmed: true/.test(app.slice(app.indexOf('const approveAndListItem'), app.indexOf('const approveAndListItem') + 3500)), 'App never hard-codes the confirmation: it only comes from the control click');

console.log('\n--- 3. gating rules the control shows before any click (real component via Vite SSR) ---');
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', root: process.cwd(), optimizeDeps: { noDiscovery: true } });
try {
  const { deriveApproveAndListGate } = await server.ssrLoadModule('/src/components/ApproveAndListControl.jsx');
  const insuff = { contract: { state: 'REVIEW', listable: false, locks: [{ code: 'no-sold-evidence', class: 'insufficiency' }] }, priceOverridden: true };
  let g = deriveApproveAndListGate({ item: insuff, price: 15.42 });
  ok(g.blocked === null && g.q41.required && g.q41.canAcknowledge, 'insufficiency + manual price: startable, acknowledgement described');
  g = deriveApproveAndListGate({ item: { ...insuff, priceOverridden: false }, price: 15.42 });
  ok(/Set your own list price first/.test(g.blocked), 'insufficiency without a manual price: blocked with guidance');
  g = deriveApproveAndListGate({ item: { contract: { state: 'REFUSED', locks: [] } }, price: 15.42 });
  ok(/REFUSED/.test(g.blocked), 'REFUSED: blocked');
  g = deriveApproveAndListGate({ item: { contract: { state: 'REVIEW', listable: false, locks: [{ code: 'manual-review', class: 'integrity' }] } }, price: 15.42 });
  ok(/Integrity lock/.test(g.blocked), 'integrity lock: blocked');
  g = deriveApproveAndListGate({ item: { contract: { state: 'READY', listable: true, locks: [] } }, price: 0 });
  ok(/no valid list price/.test(g.blocked), 'no price: blocked');
  g = deriveApproveAndListGate({ item: { contract: { state: 'READY', listable: true, locks: [] } }, price: 12 });
  ok(g.blocked === null && !g.q41.required, 'READY: startable, no acknowledgement');
} finally { await server.close(); }

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
process.exit(failed ? 1 : 0);
