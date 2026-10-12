// tests/b1rc-policy-exhaustive.test.js
//
// B1-RC RC3 -- recon-v1 SAFETY PROOF by exhaustive enumeration. DB-free, network-free.
// The policy (60 minutes, four Seller Hub views, evidence reference, no contradicting lookup, explicit request) is an OPERATOR
// POLICY, not a provider guarantee. This proves the one property that matters: over EVERY combination of the inputs below, a new
// publish is authorized if and only if ALL of the policy's conditions hold, and in no other case -- so an incomplete, conflicting,
// malformed or uncertain observation can never authorize a duplicate listing. The oracle is an independent re-statement of the
// rule, not a call back into the implementation.
//   node tests/b1rc-policy-exhaustive.test.js

import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OA = await import(pathToFileURL(path.join(root, 'src', 'lib', 'operatorAuthority.js')).href);

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };
console.log('\n=== B1-RC recon-v1 exhaustive safety proof ===\n');

const SUBMITTED = Date.parse('2026-10-12T10:00:00.000Z');
const NOW = Date.parse('2026-10-12T20:00:00.000Z');
const M = 60_000;
const ALL = OA.REQUIRED_ABSENCE_SOURCES;
const subsets = [];
for (let mask = 0; mask < 16; mask++) subsets.push(ALL.filter((_, i) => mask & (1 << i)));
const sourceOptions = [...subsets, ['SELLER_HUB_ACTIVE', 'SOMETHING_ELSE'], [...ALL, 'EXTRA_VIEW'], 'SELLER_HUB_ACTIVE,SELLER_HUB_SCHEDULED,SELLER_HUB_SOLD,SELLER_HUB_UNSOLD', null, undefined, {}];
const evidenceOptions = [undefined, null, '', ' ', 'abc', '    abc   ', 'screenshot-1', 'a-longer-evidence-reference', 12345, ['x']];
const checkedAtOptions = [
  ['undefined', undefined], ['null', null], ['junk', 'yesterday-ish'], ['empty', ''],
  ['before submission', new Date(SUBMITTED - 3600e3).toISOString()],
  ['at submission', new Date(SUBMITTED).toISOString()],
  ['+10 min', new Date(SUBMITTED + 10 * M).toISOString()],
  ['+59 min 59 s', new Date(SUBMITTED + 60 * M - 1000).toISOString()],
  ['exactly +60 min', new Date(SUBMITTED + 60 * M).toISOString()],
  ['+61 min', new Date(SUBMITTED + 61 * M).toISOString()],
  ['+3 h', new Date(SUBMITTED + 180 * M).toISOString()],
  ['now', new Date(NOW).toISOString()],
  ['now + 30 s (clock skew)', new Date(NOW + 30_000).toISOString()],
  ['now + 2 min', new Date(NOW + 2 * M).toISOString()],
  ['next day', new Date(NOW + 24 * 60 * M).toISOString()],
];
const requestOptions = [false, true, 'true', 1, undefined, null, 'yes'];
const lookupOptions = [['none', undefined], ['empty scan', { matches: [], scannedAllListsCompletely: true }], ['one match', { matches: [{ itemId: '1' }] }], ['matches not an array', { matches: 'x' }]];

// Independent oracle -- the rule stated from the policy text, not from the implementation.
function oracleAuthorizes({ sources, evidenceRef, checkedAtMs, request, lookup }) {
  const has = Array.isArray(sources) && ALL.every((s) => sources.includes(s));
  const evidence = typeof evidenceRef === 'string' && evidenceRef.trim().length >= 4;
  const timeOk = checkedAtMs !== null && checkedAtMs >= SUBMITTED + 60 * M && checkedAtMs <= NOW + 60_000;
  const noContradiction = !(lookup && Array.isArray(lookup.matches) && lookup.matches.length > 0);
  return has && evidence && timeOk && noContradiction && request === true;
}

let total = 0, authorized = 0, mismatches = 0, unsafe = 0;
const examples = [];
for (const sources of sourceOptions) for (const evidenceRef of evidenceOptions) for (const [, checkedAt] of checkedAtOptions) for (const request of requestOptions) for (const [, lookup] of lookupOptions) {
  total++;
  let r;
  try {
    r = OA.evaluateOperatorReconciliation({ verdict: 'NOT_FOUND', externalListingId: undefined, checkedSources: sources, checkedAt, evidenceRef, requestNewPublish: request, submittedAt: new Date(SUBMITTED).toISOString(), automatedLookup: lookup, now: new Date(NOW).toISOString() });
  } catch (e) { r = { threw: true }; }
  const ms = (() => { if (checkedAt === undefined || checkedAt === null) return null; const d = new Date(checkedAt); return Number.isNaN(d.getTime()) ? null : d.getTime(); })();
  const expected = oracleAuthorizes({ sources, evidenceRef, checkedAtMs: ms, request, lookup });
  const actual = r.threw ? false : r.newPublishAuthorized === true;
  if (actual) authorized++;
  if (actual !== expected) { mismatches++; if (actual && !expected) unsafe++; if (examples.length < 3) examples.push({ sources, evidenceRef, checkedAt, request, lookup, actual, expected }); }
  // a recorded NOT_FOUND must always be a policy-passing one; anything else must be downgraded to UNRESOLVED
  if (!r.threw && r.recordedVerdict === 'NOT_FOUND' && !expected && !(request !== true)) unsafe++;
}
console.log(`     enumerated ${total.toLocaleString()} combinations; ${authorized.toLocaleString()} authorize a publish`);
ok(total === sourceOptions.length * evidenceOptions.length * checkedAtOptions.length * requestOptions.length * lookupOptions.length && total > 90000, `the grid is exhaustive over its input space (${total.toLocaleString()} cases)`);
ok(mismatches === 0, `the implementation agrees with the independent oracle on every case (${mismatches} mismatches${examples.length ? ': ' + JSON.stringify(examples[0]) : ''})`);
ok(unsafe === 0, `ZERO unsafe authorizations: no incomplete, conflicting, malformed or uncertain observation authorizes a publish (${unsafe})`);
ok(authorized > 0, `the policy is satisfiable (${authorized.toLocaleString()} cases authorize), so the operator has a documented recovery route that does not depend on guessing`);

console.log('\n-- the other verdicts can never authorize, whatever else is supplied --');
let otherAuth = 0, otherTotal = 0;
for (const verdict of ['LISTING_FOUND', 'UNRESOLVED']) for (const request of requestOptions) for (const [, lookup] of lookupOptions) for (const sources of [ALL, [], undefined]) {
  otherTotal++;
  const r = OA.evaluateOperatorReconciliation({ verdict, externalListingId: 'ITEM-1', checkedSources: sources, checkedAt: new Date(NOW - 3600e3).toISOString(), evidenceRef: 'screenshot-1', requestNewPublish: request, submittedAt: new Date(SUBMITTED).toISOString(), automatedLookup: lookup, now: new Date(NOW).toISOString() });
  if (r.newPublishAuthorized !== false) otherAuth++;
}
ok(otherAuth === 0, `LISTING_FOUND and UNRESOLVED never authorize a publish, in any of ${otherTotal} combinations, even with every condition otherwise met`);
let garbage = 0; for (const v of [undefined, null, '', 'MAYBE', 'not_found', 'found', 1, {}]) { try { OA.evaluateOperatorReconciliation({ verdict: v }); } catch { garbage++; } }
ok(garbage === 8, 'an unknown, mis-cased or missing verdict is rejected outright (8 of 8)');

console.log('\n-- state machine: only a policy-passing NOT_FOUND ever unblocks; everything else keeps the block --');
const st = (rows) => OA.reduceAttemptState([{ phase: 'AUTHORIZED' }, { phase: 'SUBMITTED' }, { phase: 'AMBIGUOUS' }, ...rows]);
const evt = (recon_verdict, new_publish_authorized) => ({ phase: 'OPERATOR_RECONCILED', recon_verdict, new_publish_authorized });
let unblocking = 0, combos = 0;
for (const v of ['LISTING_FOUND', 'NOT_FOUND', 'UNRESOLVED', null, undefined, 'garbage']) for (const a of [true, false, null, undefined]) {
  combos++;
  const state = st([evt(v, a)]);
  if (!OA.assessListingAttemptGuard([{ attempt_id: 'A', phase: 'AUTHORIZED' }, { attempt_id: 'A', phase: 'SUBMITTED' }, { attempt_id: 'A', phase: 'AMBIGUOUS' }, { attempt_id: 'A', ...evt(v, a) }]).allowed) continue;
  unblocking++;
  if (!(v === 'NOT_FOUND' && a === true)) { unblocking += 1000; }
}
ok(unblocking === 1, `of ${combos} verdict/authorization pairs on an ambiguous attempt, exactly ONE unblocks (NOT_FOUND + authorized:true)`);
ok(st([]) === 'AMBIGUOUS', 'with no reconciliation at all an ambiguous attempt stays AMBIGUOUS (blocked); time alone never unblocks');
ok(st([evt('NOT_FOUND', true), evt('UNRESOLVED', false)]) === 'CLOSED_BLOCKED', 'a LATER inconclusive event re-blocks (the latest event governs)');
ok(st([evt('NOT_FOUND', true), evt('LISTING_FOUND', false)]) === 'LISTED', 'a LATER found event wins over an earlier not-found');

console.log(`\n${'='.repeat(60)}\nB1-RC POLICY EXHAUSTIVE: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
