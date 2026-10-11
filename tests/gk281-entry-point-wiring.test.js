// GK-281 — STATIC WIRING INVENTORY: every paid-grade entry point is accounted for, and the server's ordering
// guarantees (claim BEFORE spend, IN_PROGRESS BEFORE the first provider call, checkpoint BEFORE the events) cannot
// regress silently. Source-text checks only (no database, no network). Complements the behavioral suites.
//
//   node tests/gk281-entry-point-wiring.test.js

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(repoRoot, p), 'utf8');
let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };
const section = (t) => console.log(`\n-- ${t} --`);
const count = (s, re) => (s.match(re) || []).length;
const idx = (s, needle) => s.indexOf(needle);

const app = read('src/App.jsx');
const grade = read('api/grade.js');
const client = read('src/lib/gradeAttemptClient.js');

console.log('\n=== GK-281 entry-point wiring inventory ===');

section('1. no unmanaged /api/grade caller exists anywhere in src/ or api/');
const walk = (d) => readdirSync(path.join(repoRoot, d)).flatMap((n) => { const rel = `${d}/${n}`; return statSync(path.join(repoRoot, rel)).isDirectory() ? walk(rel) : [rel]; });
const callers = [...walk('src'), ...walk('api')].filter((f) => /\.(js|jsx)$/.test(f)).filter((f) => /['"`]\/api\/grade['"`]/.test(read(f)) && !f.endsWith('api/grade.js'));
ok(callers.length === 2 && callers.includes('src/App.jsx') && callers.includes('src/lib/gradeAttemptClient.js'), `only App.jsx and the attempt client name /api/grade (${callers.join(', ')})`);
ok(count(app, /apiFetch\(\s*["']\/api\/grade["']/g) === 2, 'App.jsx has exactly two direct /api/grade fetches (the Watch frame and the warm-up ping)');
const watchSite = app.slice(app.indexOf("source: 'watch', voiceContext: watchContextRef.current"), app.indexOf("source: 'watch', voiceContext: watchContextRef.current") + 220);
ok(/attemptId:\s*mintAttemptId\(\)/.test(watchSite), 'the Watch frame mints its own attemptId per frame');
ok(/warmup:\s*true/.test(app.slice(app.indexOf("apiFetch('/api/grade'"), app.indexOf("apiFetch('/api/grade'") + 200)), 'the other direct fetch is the free warm-up (no provider call)');

section('2. each paid entry point runs under an attempt');
ok(count(app, /runGradeAttempt\(/g) === 3, 'three runGradeAttempt call sites: gradeBlob, reIdentifyBook, addPhotoToComic');
const gb = app.slice(app.indexOf('const gradeBlob = useCallback'), app.indexOf('const gradeBlob = useCallback') + 6500);
ok(/runGradeAttempt\(\{[^}]*kind:\s*GRADE_ATTEMPT_KINDS\.SCAN/.test(gb), 'gradeBlob (Scan, Buyer file, share-target) => kind SCAN');
ok(/gradeBlobFlights\.has\(gradeFlightKey\)/.test(gb) && /gradeBlobFlights\.delete\(gradeFlightKey\)/.test(app), 'gradeBlob single-flights the same file and releases the slot in `finally`');
ok(/markGradeAttemptConsumed\(gradeOut\.digest, gradeOut\.attemptId\)/.test(app), 'gradeBlob marks the attempt consumed only after the item is saved');
const reid = app.slice(app.indexOf('const reIdentifyBook = useCallback'), app.indexOf('const reIdentifyBook = useCallback') + 2500);
ok(/kind:\s*GRADE_ATTEMPT_KINDS\.REGRADE/.test(reid), 'reIdentifyBook => deliberate re-grade (REGRADE)');
const addp = app.slice(app.indexOf('GK-281 — adding a photo is a DELIBERATE re-grade'), app.indexOf('GK-281 — adding a photo is a DELIBERATE re-grade') + 400);
ok(/kind:\s*GRADE_ATTEMPT_KINDS\.REGRADE/.test(addp), 'addPhotoToComic => deliberate re-grade (REGRADE)');
const bulk = app.slice(app.indexOf('const handleBulkImport = useCallback'), app.indexOf('const handleBulkImport = useCallback') + 9000);
ok(/beginBulkImport\(/.test(bulk) && /postGradeWithAttempt\(/.test(bulk) && /attemptId:\s*bulkSlot\.attemptId/.test(bulk), 'handleBulkImport => a manifest and one attempt per FILE');
ok(count(bulk, /settleBulkSlot\(bulkSlot\)/g) === 3, 'bulk settles a slot on exactly the three finished outcomes (saved, held for review, not-a-comic)');
ok(!/settleBulkSlot/.test(app.slice(app.indexOf("failed to save"), app.indexOf("failed to save") + 120)), 'a failed save does NOT settle the slot (the retry replays instead of paying again)');
ok(/share-target/i.test(app) && /gradeBlob\(blob, \{ save: false, buyerMode: true \}\)/.test(app), 'the Web Share Target reaches grading only through gradeBlob (so it is single-flighted and attempt-bound)');

section('3. server ordering guarantees (api/grade.js)');
const iClaim = idx(grade, 'claim = await claimAttempt('), iSpend = idx(grade, 'if (await enforceSpendGuard(res'), iBuild = idx(grade, 'imageContent = await buildImageContent(images)');
ok(iClaim > 0 && iClaim < iSpend, 'the attempt is CLAIMED before the spend guard (a replay can never reserve spend)');
ok(iSpend < iBuild, 'spend is reserved before any image work or provider call');
const iTracked = idx(grade, 'const callModel = async (model, content, promptText) => {'), iBegin = idx(grade, 'await attempt.beginInvocation();');
ok(iTracked > 0 && iBegin > iTracked && idx(grade, 'callModelUntracked(model, content, promptText)') > iBegin, 'IN_PROGRESS is written immediately BEFORE the raw provider call');
ok(count(grade, /callModelUntracked\(/g) === 1, 'the raw provider call is reachable only through the tracked wrapper');
ok(/watchPipeline\(imageContent, body\.voiceContext, callModel\)/.test(grade), 'Watch passes use the tracked wrapper (all three passes belong to the attempt)');
const fin = grade.slice(grade.indexOf('const finalizeResult = async'), grade.indexOf('const finalizeResult = async') + 1800);
ok(fin.indexOf('attempt.checkpoint(') > 0 && fin.indexOf('attempt.checkpoint(') < fin.indexOf('await attachGradeReceipt('), 'the result is CHECKPOINTED before any prediction event is written');
ok(fin.indexOf('await attachGradeReceipt(') < fin.indexOf('attempt.complete(out)'), 'COMPLETED is recorded only after the events and the proof exist');
ok(/!needsProof \|\| out\.gradeProof/.test(fin), 'COMPLETED requires the proof whenever a grade exists');
ok(count(grade, /finalizeResult\(/g) === 3, 'all three response branches (Watch, eBay-first, Vision fallback) finalize through the one path');
ok(count(grade, /await attachGradeReceipt\(/g) === 2, 'attachGradeReceipt runs from finalize and from the checkpoint resume only');
ok(/resultId = ctx\.resultId \|\| randomUUID\(\)/.test(grade), 'the prediction result id is the attempt-derived id when an attempt exists');
ok(/failFromError\(err\)/.test(grade), 'the catch block records what happened to the attempt');

ok(/new Anthropic\(\{[^}]*maxRetries:\s*0/.test(grade), 'the grading provider client disables SDK-level retries (maxRetries: 0)');
ok(/markGradeAttemptConsumed\(gradeOut\.digest, gradeOut\.attemptId\);\s*\n\s*if \(save\) setUnsupportedScan/.test(app), 'a result the operator rejects as unidentifiable releases the attempt (the retake is an explicit new attempt)');

section('4. client contract');
ok(count(client, /postGradeWithAttempt\(/g) >= 2 && /attemptId/.test(client), 'the client library posts every grade request with an attemptId');
ok(!/localStorage\./.test(client), 'persistence goes only through the principal-scoped storage helper');
ok(/scopedGet\(STORE_KEY\)/.test(client) && /scopedSet\(STORE_KEY/.test(client), 'attempt state is principal-scoped');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
