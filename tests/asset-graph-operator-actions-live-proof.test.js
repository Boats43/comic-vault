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

assertTrue(Array.isArray(graph.operatorActions), 'graph.operatorActions is an array');
assertTrue(graph.operatorActions.length === 2, `exactly 2 real operator actions for Creepy (got ${graph.operatorActions.length})`);
assertTrue(graph.operatorActions.some((a) => a.id === CREEPY_HOLD_OPERATOR_ACTION_EVENT_ID && a.action_code === 'HOLD'), 'the real HOLD row is present, untouched');
assertTrue(graph.operatorActions.some((a) => a.id === CREEPY_LIST_OPERATOR_ACTION_EVENT_ID && a.action_code === 'LIST'), 'the real LIST row is present, untouched');
assertTrue(graph.currentOperatorActionId === CREEPY_LIST_OPERATOR_ACTION_EVENT_ID, 'currentOperatorActionId names the LIST row, not the HOLD row -- the exact server-declared fact listOnEbay/selectCurrentOperatorAction depend on');

const currentRow = graph.operatorActions.find((a) => a.id === graph.currentOperatorActionId);
assertTrue(currentRow?.action_code === 'LIST', 'find-by-id on currentOperatorActionId resolves to a LIST row');

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  console.log('Failures:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
