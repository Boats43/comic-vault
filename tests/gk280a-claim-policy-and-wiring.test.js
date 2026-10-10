// GK-280A — pure policy table + static wiring checks. No database, no network, no model call.
//   node tests/gk280a-claim-policy-and-wiring.test.js
// The wiring half is STATIC source-text evidence (labelled as such); the behavioural proof is
// tests/gk280a-grade-proof-claim.test.js (real handlers + real Development database).

import { readFileSync } from 'node:fs';
import { decideGradeClaim, buildGradePointer, GRADE_CLAIM_CODE as C, GRADE_POINTER_HISTORY_CAP } from '../src/lib/gradeClaimPolicy.js';

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };
const d = (o) => decideGradeClaim({ id: 'X', existedBefore: false, currentPointer: null, boundElsewhere: false, claim: { eventId: 'E1', targetItemId: null, eventCreatedAtMs: 100 }, ...o });

console.log('\n=== GK-280A claim policy (pure) ===');
console.log('— R4 fresh-scan proof');
ok(d({}).action === 'ASSOCIATE', 'fresh proof + newly created row => ASSOCIATE');
ok(d({ existedBefore: true }).code === C.NOT_NEW_ITEM, 'fresh proof + pre-existing row => NOT_NEW_ITEM');
console.log('— R1 one event, one item');
ok(d({ boundElsewhere: true }).code === C.CROSS_ITEM, 'event bound to another item => CROSS_ITEM (wins over everything else)');
ok(d({ boundElsewhere: true, claim: { eventId: 'E1', targetItemId: 'X', eventCreatedAtMs: 1 }, existedBefore: true }).code === C.CROSS_ITEM, 'even a correctly-targeted re-grade proof cannot rebind an event held elsewhere');
console.log('— R2/R5 re-grade proof');
ok(d({ claim: { eventId: 'E1', targetItemId: 'Y', eventCreatedAtMs: 1 }, existedBefore: true }).code === C.TARGET_MISMATCH, 'proof for item Y presented for X => TARGET_MISMATCH');
ok(d({ claim: { eventId: 'E1', targetItemId: 'X', eventCreatedAtMs: 1 }, existedBefore: false }).code === C.TARGET_NOT_EXISTING, 're-grade proof for a row that does not exist => TARGET_NOT_EXISTING');
const cur = { predictionEventId: 'E1', eventCreatedAtMs: 100, history: [] };
ok(d({ claim: { eventId: 'E2', targetItemId: 'X', eventCreatedAtMs: 200 }, existedBefore: true, currentPointer: cur }).action === 'ASSOCIATE', 'newer re-grade event on its own item => ASSOCIATE (transition)');
ok(d({ claim: { eventId: 'E2', targetItemId: 'X', eventCreatedAtMs: 50 }, existedBefore: true, currentPointer: cur }).code === C.STALE_TRANSITION, 'older event => STALE_TRANSITION');
ok(d({ claim: { eventId: 'E2', targetItemId: 'X', eventCreatedAtMs: 100 }, existedBefore: true, currentPointer: cur }).code === C.STALE_TRANSITION, 'equal timestamp is not newer => STALE_TRANSITION');
ok(d({ claim: { eventId: 'E2', targetItemId: 'X', eventCreatedAtMs: null }, existedBefore: true, currentPointer: cur }).code === C.STALE_TRANSITION, 'unknown event time never transitions an existing pointer');
console.log('— R3 idempotency');
ok(d({ existedBefore: true, currentPointer: { predictionEventId: 'E1', history: [] } }).status === 'ALREADY_ASSOCIATED', 'same event as current pointer => ALREADY_ASSOCIATED (even for a fresh proof on an existing row)');
ok(d({ existedBefore: true, currentPointer: { predictionEventId: 'E9', history: ['E1'] } }).status === 'ALREADY_ASSOCIATED', 'event in the pointer history => ALREADY_ASSOCIATED');
console.log('— R6 event-less receipt');
ok(d({ claim: { eventId: null } }).action === 'BASELINE_ONLY', 'no durable event + new row => baseline only');
ok(d({ claim: { eventId: null }, existedBefore: true }).code === C.NOT_NEW_ITEM, 'no durable event + existing row => refused');
console.log('— pointer construction');
const p1 = buildGradePointer({ previous: null, eventId: 'E1', resultId: 'R1', eventCreatedAtMs: 1, via: 'GRADE_PROOF', now: 1000 });
const p2 = buildGradePointer({ previous: p1, eventId: 'E2', resultId: 'R2', eventCreatedAtMs: 2, via: 'GRADE_PROOF', now: 2000 });
ok(p1.history.length === 0 && JSON.stringify(p2.history) === JSON.stringify(['E1']) && p2.predictionEventId === 'E2', 'history only grows, newest last; the previous pointer is never lost');
let pp = p2; for (let i = 0; i < 80; i++) pp = buildGradePointer({ previous: pp, eventId: `N${i}`, resultId: 'r', eventCreatedAtMs: 10 + i, via: 'GRADE_PROOF' });
ok(pp.history.length === GRADE_POINTER_HISTORY_CAP && pp.history[pp.history.length - 1] === 'N78', 'history is capped, dropping only the oldest');
ok(!('grade' in p1) && !('modelPredictedGrade' in p1), 'the pointer carries ids only — it duplicates no grade value (the immutable event is the single source of truth)');

console.log('\n=== wiring (STATIC source evidence) ===');
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const collection = read('api/collection.js'), grade = read('api/grade.js'), enrich = read('api/enrich.js');
const repo = read('src/modules/collection/repository.js'), svc = read('src/modules/collection/service.js');
const sync = read('src/lib/collectionSync.js'), app = read('src/App.jsx'), receipt = read('src/lib/gradeReceipt.js');
ok(!/claimGradeReceipt|claimModelBaseline\(/.test(collection) && /saveCollectionItemWithGradeClaim/.test(collection), 'api/collection.js no longer claims out-of-transaction; it uses the transactional save+claim');
ok((collection.match(/saveAndClaim\(/g) || []).length === 3, 'POST and PUT both route through the single saveAndClaim (two call sites plus its definition)');
ok(/gradeClaimUnavailable === true[\s\S]{0,200}status\(503\)/.test(collection), 'a transient claim-verification failure is a retryable 503, not a stranding refusal');
ok((repo.match(/'currentGradePrediction'/g) || []).length >= 3, 'currentGradePrediction is in BOTH protected-key lists (insert strip + update preservation)');
ok(/export async function setGradePredictionPointer/.test(repo) && (svc.match(/setGradePredictionPointer\(/g) || []).length === 1, 'the pointer has exactly one writer, called from one service site');
ok(/pg_advisory_xact_lock/.test(repo) && /await client\.query\('BEGIN'\)/.test(svc) && /lockGradeClaim/.test(svc), 'claim is serialized per (principal,event) inside a transaction');
ok(/issueGradeProof\(/.test(grade) && /result\.gradeProof = gradeProof/.test(grade) && /targetItemId/.test(grade), 'api/grade.js issues the proof only after the event exists and carries targetItemId');
ok(/_gradeProof, _gradeClaimStatus, _gradeClaimCode, assetCategory/.test(sync) && /gradeProof: typeof _gradeProof/.test(sync), 'collectionSync lifts _gradeProof out of attributes and sends it as its own field');
ok(/_gradeProof: typeof data\.gradeProof/.test(app) && /registerPendingPersist\(entry\.id/.test(app), 'addToCatalogue keeps the proof locally and registers the in-flight persist');
ok(/await awaitPendingPersist\(item\.id\)/.test(app), 'refreshMarketData waits (bounded) for the item\'s own in-flight persist');
ok((app.match(/targetItemId: item\.id/g) || []).length === 2, 'both RE_GRADE call sites declare their target item');
ok(/gradeProof: typeof data\.gradeProof === "string" \? data\.gradeProof : undefined,\s*\n\s*\};/.test(app), 'gradeBlob sends the proof with the fresh-scan enrich request');
const gpUses = enrich.split('\n').filter((l) => /\bgradeProof\b/.test(l.replace(/\/\/.*$/, '')));
ok(gpUses.length === 3 && /OBSERVABILITY ONLY/.test(enrich), `enrich reads gradeProof in exactly 3 code lines (destructure, guard, verify) and only logs the result (${gpUses.length})`);
ok(/buildBaselineFromReceipt/.test(receipt) && /GRADE_PROOF_TTL_SECONDS = 30/.test(receipt), 'the receipt module owns both the legacy receipt and the proof (no parallel receipt system)');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
