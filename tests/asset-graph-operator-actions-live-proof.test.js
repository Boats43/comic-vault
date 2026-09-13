// tests/asset-graph-operator-actions-live-proof.test.js
//
// Outcome #1 PRE-PUBLISH HARDENING — real, live-DB proof that
// getAssetGraph (src/modules/assets/repository.js) now returns
// operatorActions + currentOperatorActionId, and that for Creepy #1's
// own REAL two-row history (HOLD, then LIST), currentOperatorActionId
// names the LIST row -- the exact fact src/App.jsx's listOnEbay and
// src/lib/operatorActionAlignment.js's selectCurrentOperatorAction
// depend on. Read-only: never writes, never mutates Creepy's rows.
//
// Invoke: node tests/asset-graph-operator-actions-live-proof.test.js

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

const envRaw = readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8');
for (const line of envRaw.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}
process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'development';

const { getPhysicalAsset } = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'assets', 'index.js')).href);

let passed = 0, failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};

const JIMMY = '01a0283a-b1b6-7f90-9b41-9c06bee6ecba';
const CREEPY_ASSET_ID = '01a02d23-1acb-72e8-aae3-8f851308e9cf';
const CREEPY_LIST_OPERATOR_ACTION_EVENT_ID = '01a097a1-6e78-71c9-9309-1ed9344c40db';
const CREEPY_HOLD_OPERATOR_ACTION_EVENT_ID = '01a09767-3179-7f93-ad0e-8d251f3a80ba';

console.log('\n=== getAssetGraph -- real, live operatorActions/currentOperatorActionId proof (Creepy #1) ===\n');

const graph = await getPhysicalAsset({ principalId: JIMMY, gkAssetId: CREEPY_ASSET_ID });

// GK-208 correction: this originally asserted "exactly 2 rows" and a
// hardcoded currentOperatorActionId. That was true only as a snapshot —
// Creepy's real operator_action_event history is genuinely live and
// append-only (Jimmy's own real usage adds to it over time, e.g. a
// third real LIST row recorded 2026-09-13T04:02:07Z), so hardcoding an
// exact count or a specific "current" id is inherently stale-prone.
// This test now asserts the two things that must ALWAYS be true
// regardless of how many real rows accumulate: the original two rows
// are present and untouched, and currentOperatorActionId — whichever
// row it names — always resolves to a real row in the array whose
// action_code is a valid one (never dangling, never fabricated).
assertTrue(Array.isArray(graph.operatorActions), 'graph.operatorActions is an array');
assertTrue(graph.operatorActions.length >= 2, `at least the 2 known real operator actions for Creepy are present (got ${graph.operatorActions.length})`);
assertTrue(graph.operatorActions.some((a) => a.id === CREEPY_HOLD_OPERATOR_ACTION_EVENT_ID && a.action_code === 'HOLD'), 'the original real HOLD row is present, untouched');
assertTrue(graph.operatorActions.some((a) => a.id === CREEPY_LIST_OPERATOR_ACTION_EVENT_ID && a.action_code === 'LIST'), 'the original real LIST row is present, untouched');

const currentRow = graph.operatorActions.find((a) => a.id === graph.currentOperatorActionId);
assertTrue(!!currentRow, 'currentOperatorActionId resolves to a REAL row in operatorActions, never a dangling/fabricated id');
assertTrue(currentRow?.action_code === 'LIST', `find-by-id on currentOperatorActionId resolves to a LIST row (currently ${currentRow?.id}, action_code=${currentRow?.action_code})`);
// The "current" row must be the one with the latest (recorded_at, id) —
// never an earlier row — confirming the deterministic tie-break still
// holds against however many real rows exist right now.
const sorted = [...graph.operatorActions].sort((a, b) => {
  const t = new Date(a.recorded_at) - new Date(b.recorded_at);
  return t !== 0 ? t : (a.id < b.id ? -1 : 1);
});
assertTrue(graph.currentOperatorActionId === sorted[sorted.length - 1].id, 'currentOperatorActionId is genuinely the chronologically-last row by (recorded_at, id), not a stale or arbitrary one');

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  console.log('Failures:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
