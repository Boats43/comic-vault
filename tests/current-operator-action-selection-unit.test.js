// tests/current-operator-action-selection-unit.test.js
//
// Outcome #1 PRE-PUBLISH HARDENING — pure-function proof for
// src/lib/operatorActionAlignment.js's selectCurrentOperatorAction,
// the function the real "List on eBay" button (src/App.jsx's
// listOnEbay) uses to pick the durable operator_action_event it must
// attach a LISTED outcome to. No DB, no network, no React — this
// isolates the SELECTION LOGIC itself: "does it pick the row the
// server actually names as current, never the row that merely happens
// to be last in array order."
//
// Uses Creepy #1's own real, disclosed two-row shape (HOLD at
// 2026-09-12T20:55:17Z, then LIST at 2026-09-12T21:58:54Z) as the
// canonical fixture.
//
// Invoke: node tests/current-operator-action-selection-unit.test.js

import { selectCurrentOperatorAction } from '../src/lib/operatorActionAlignment.js';

let passed = 0, failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};

console.log('\n=== selectCurrentOperatorAction -- pure selection-logic proof ===\n');

const HOLD_ROW = { id: '01a09767-3179-7f93-ad0e-8d251f3a80ba', action_code: 'HOLD', occurred_at: '2026-09-12T20:55:17.290Z' };
const LIST_ROW = { id: '01a097a1-6e78-71c9-9309-1ed9344c40db', action_code: 'LIST', occurred_at: '2026-09-12T21:58:54.014Z' };

console.log('-- Creepy\'s real, in-order history: [HOLD, LIST], currentOperatorActionId names the LIST row --\n');
{
  const graph = { operatorActions: [HOLD_ROW, LIST_ROW], currentOperatorActionId: LIST_ROW.id };
  const selected = selectCurrentOperatorAction(graph);
  assertTrue(selected?.id === LIST_ROW.id, 'selects the LIST row');
  assertTrue(selected?.action_code === 'LIST', 'selected row\'s action_code is LIST, not HOLD');
  assertTrue(selected !== HOLD_ROW, 'does NOT select the HOLD row, even though it is chronologically first');
}

console.log('\n-- the array is NOT what decides the answer: reversed/shuffled array order, SAME currentOperatorActionId, SAME result --\n');
{
  const graphReversed = { operatorActions: [LIST_ROW, HOLD_ROW], currentOperatorActionId: LIST_ROW.id };
  const selected = selectCurrentOperatorAction(graphReversed);
  assertTrue(selected?.id === LIST_ROW.id, 'still selects LIST even when it is FIRST in array order (proves this is find-by-id, never array-position/array-length arithmetic)');

  // The naive, forbidden implementation this function replaces:
  // operatorActions[operatorActions.length - 1]. Prove that naive form
  // would have given the WRONG answer on the reversed array, to make
  // the regression this test guards against concrete, not hypothetical.
  const naiveWrongAnswer = graphReversed.operatorActions[graphReversed.operatorActions.length - 1];
  assertTrue(naiveWrongAnswer.id === HOLD_ROW.id, 'sanity check: the forbidden array-position approach WOULD have picked HOLD here -- exactly the bug this selector exists to prevent');
}

console.log('\n-- adversarial: currentOperatorActionId points at HOLD (e.g. a real future case where HOLD is genuinely the latest action) -- selector honestly returns HOLD, never silently substitutes LIST --\n');
{
  const graph = { operatorActions: [HOLD_ROW], currentOperatorActionId: HOLD_ROW.id };
  const selected = selectCurrentOperatorAction(graph);
  assertTrue(selected?.id === HOLD_ROW.id && selected?.action_code === 'HOLD', 'honestly returns the HOLD row when that IS the current one -- the caller (listOnEbay) is responsible for refusing to publish against it, not this pure selector');
}

console.log('\n-- absent/malformed input never throws, always returns null --\n');
{
  assertTrue(selectCurrentOperatorAction({}) === null, 'no operatorActions, no currentOperatorActionId -> null');
  assertTrue(selectCurrentOperatorAction({ operatorActions: [], currentOperatorActionId: null }) === null, 'empty history -> null');
  assertTrue(selectCurrentOperatorAction({ operatorActions: [HOLD_ROW], currentOperatorActionId: 'does-not-exist' }) === null, 'currentOperatorActionId naming a row not present in operatorActions -> null, never a guess');
  assertTrue(selectCurrentOperatorAction(undefined) === null, 'undefined graph -> null, never throws');
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  console.log('Failures:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
