// GK-281 — client half of ONE LOGICAL SCAN ATTEMPT -> AT MOST ONE PAID GRADING WORKFLOW.
// Real client modules (src/lib/gradeAttemptClient.js) under a signed-in test principal with a real localStorage shim, plus
// (section 8) the HISTORICAL PRODUCTION INCIDENT reproduced end to end against the REAL api/grade.js handler: the first
// request finishes server-side, its response is lost, and the same file is submitted again ~10 s later.
//
//   node tests/gk281-grade-attempt-client.test.js

import './helpers/installBrowserSession.js';
import { signInTestPrincipal } from './helpers/installBrowserSession.js';
import { readFileSync } from 'node:fs';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };
const section = (t) => console.log(`\n-- ${t} --`);

const C = await import('../src/lib/gradeAttemptClient.js');
const A = await import('../src/lib/gradeAttempt.js');
const { tokenFor } = await import('./helpers/installBrowserSession.js');

const fakeRes = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body, clone() { return fakeRes(status, body); } });
const now0 = 1_800_000_000_000;

console.log('\n=== GK-281 client attempt identity, single-flight, bulk manifests ===');

section('1. the client digest is byte-equivalent to the server fingerprint');
for (const input of [
  { images: ['AAA'] }, { images: ['AAA', 'BBB'], voiceContext: 'near mint' }, { source: 'watch', images: ['x'] },
  { images: ['z'], targetItemId: 'item-1', predictionKind: 'RE_GRADE', imageViews: ['FRONT', null] },
]) {
  const d = await C.inputDigest(input);
  const s = A.computeAttemptFingerprint({ workflow: input.source === 'watch' ? 'watch' : 'standard', images: input.images, voiceContext: input.voiceContext, targetItemId: input.targetItemId, predictionKind: input.predictionKind, imageViews: input.imageViews });
  ok(d === s, `digest == server fingerprint for ${JSON.stringify(Object.keys(input))}`);
}
ok((await C.inputDigest({ images: ['A'], scanId: 'x' })) === (await C.inputDigest({ images: ['A'], scanId: 'y' })), 'scanId (a per-request ownership token) is NOT part of the identity');

section('2. attempt identity rules (persisted per principal)');
const mintSeq = (() => { let n = 0; return () => `attempt-${String(++n).padStart(16, '0')}`; })();
const d1 = await C.inputDigest({ images: ['photo-1'] });
const a1 = C.acquireAttempt({ digest: d1, kind: C.KINDS.SCAN, now: now0, mint: mintSeq });
ok(!a1.reused && a1.attemptId === 'attempt-0000000000000001', 'first pick mints a new attempt');
const a1b = C.acquireAttempt({ digest: d1, kind: C.KINDS.SCAN, now: now0 + 10_000, mint: mintSeq });
ok(a1b.reused && a1b.attemptId === a1.attemptId, 'a repeat pick ~10 s later (response never applied) RESUMES the same attempt');
C.markReceived(d1, a1.attemptId, now0 + 11_000);
const a1c = C.acquireAttempt({ digest: d1, kind: C.KINDS.SCAN, now: now0 + 20_000, mint: mintSeq });
ok(a1c.reused && a1c.attemptId === a1.attemptId, 'a result that arrived but was NOT saved is still the same attempt (the incident shape)');
const a1r = C.acquireAttempt({ digest: d1, kind: C.KINDS.REGRADE, now: now0 + 21_000, mint: mintSeq });
ok(!a1r.reused && a1r.attemptId !== a1.attemptId, 'a DELIBERATE re-grade of a RECEIVED result is a NEW attempt');
const d2 = await C.inputDigest({ images: ['photo-2'] });
const a2 = C.acquireAttempt({ digest: d2, kind: C.KINDS.SCAN, now: now0, mint: mintSeq });
C.markReceived(d2, a2.attemptId, now0 + 1);
C.markConsumed(d2, a2.attemptId, now0 + 2);
ok(!C.acquireAttempt({ digest: d2, kind: C.KINDS.SCAN, now: now0 + 3, mint: mintSeq }).reused, 'a SAVED (consumed) attempt is finished: the next pick is a new attempt');
const d3 = await C.inputDigest({ images: ['photo-3'] });
const a3 = C.acquireAttempt({ digest: d3, kind: C.KINDS.SCAN, now: now0, mint: mintSeq });
const d3u = await C.inputDigest({ images: ['photo-3u'] });
const a3u = C.acquireAttempt({ digest: d3u, kind: C.KINDS.SCAN, now: now0, mint: mintSeq });
ok(!C.acquireAttempt({ digest: d3, kind: C.KINDS.SCAN, now: now0 + C.REUSE_WINDOW_MS + 1, mint: mintSeq }).reused, 'after the reuse window a pick is a new attempt');
const a3w1 = C.acquireAttempt({ digest: null, kind: C.KINDS.WATCH, mint: mintSeq }), a3w2 = C.acquireAttempt({ digest: null, kind: C.KINDS.WATCH, mint: mintSeq });
ok(a3w1.attemptId !== a3w2.attemptId, 'every Watch frame is its own attempt');
C.markUncertain(d3u, a3u.attemptId, now0 + 5);
const blocked = C.acquireAttempt({ digest: d3u, kind: C.KINDS.SCAN, now: now0 + 6, mint: mintSeq });
ok(blocked.blocked === 'UNCERTAIN' && blocked.attemptId === a3u.attemptId, 'an UNCERTAIN attempt blocks silent re-billing');
const authorized = C.acquireAttempt({ digest: d3u, kind: C.KINDS.SCAN, authorizeNewAttempt: true, now: now0 + 7, mint: mintSeq });
ok(!authorized.reused && authorized.attemptId !== a3u.attemptId, 'explicit authorization mints a NEW attempt');
signInTestPrincipal('other-principal');
ok(!C.acquireAttempt({ digest: d1, kind: C.KINDS.SCAN, now: now0 + 12_000, mint: mintSeq }).reused, 'attempts are PRINCIPAL-SCOPED: another account never resumes this one\'s');
signInTestPrincipal();
ok(C.acquireAttempt({ digest: d1, kind: C.KINDS.SCAN, now: now0 + 13_000, mint: mintSeq }).reused, 'and the original principal still finds its own');

section('3. in-memory single-flight');
let runs = 0;
const slow = () => new Promise((r) => setTimeout(() => { runs += 1; r(runs); }, 30));
const [p1, p2, p3] = await Promise.all([C.singleFlight('k', slow), C.singleFlight('k', slow), C.singleFlight('k', slow)]);
ok(runs === 1 && p1 === p2 && p2 === p3, 'three concurrent identical submissions => one run');
await C.singleFlight('k', slow);
ok(runs === 2 && C._inFlightSize() === 0, 'a later submission runs again (the guard clears when the flight settles)');

section('4. postGradeWithAttempt: waits on IN_PROGRESS with the SAME attemptId; classifies UNCERTAIN');
const dW = await C.inputDigest({ images: ['wait-photo'] });
const aW = C.acquireAttempt({ digest: dW, kind: C.KINDS.SCAN, mint: mintSeq });
let n = 0; const seenIds = [];
const slept = [];
const waited = await C.postGradeWithAttempt({
  apiFetch: async (url, init) => { seenIds.push(JSON.parse(init.body).attemptId); n += 1; return n < 3 ? fakeRes(409, { error: 'GRADE_ATTEMPT_IN_PROGRESS', retryAfter: 3 }) : fakeRes(200, { title: 'X' }); },
  body: { images: ['wait-photo'] }, attemptId: aW.attemptId, digest: dW, sleepFn: async (ms) => { slept.push(ms); },
});
ok(waited.ok && n === 3 && new Set(seenIds).size === 1 && seenIds[0] === aW.attemptId, 'two IN_PROGRESS answers => waits and re-asks the SAME attemptId, then succeeds');
ok(slept.length === 2 && slept.every((ms) => ms === 3000), 'it honors retry-after');
ok(C.acquireAttempt({ digest: dW, kind: C.KINDS.SCAN, mint: mintSeq }).reused, 'success is remembered as RECEIVED');
const dU = await C.inputDigest({ images: ['unc-photo'] });
const aU = C.acquireAttempt({ digest: dU, kind: C.KINDS.SCAN, mint: mintSeq });
const unc = await C.postGradeWithAttempt({ apiFetch: async () => fakeRes(409, { error: 'GRADE_ATTEMPT_UNCERTAIN' }), body: { images: ['unc-photo'] }, attemptId: aU.attemptId, digest: dU });
ok(unc.status === 409 && C.acquireAttempt({ digest: dU, kind: C.KINDS.SCAN, mint: mintSeq }).blocked === 'UNCERTAIN', 'an UNCERTAIN answer is remembered and blocks silent re-billing');
let waitLoops = 0;
const forever = await C.postGradeWithAttempt({ apiFetch: async () => { waitLoops += 1; return fakeRes(409, { error: 'GRADE_ATTEMPT_IN_PROGRESS', retryAfter: 1 }); }, body: {}, attemptId: 'attempt-x-0000000000', digest: null, sleepFn: async () => {}, now: (() => { let t = 0; return () => (t += 40_000); })(), maxWaitMs: 95_000 });
ok(forever.status === 409 && waitLoops <= 4, 'the wait is bounded (does not spin forever)');

section('5. runGradeAttempt: confirm gate, scanId re-stamp, lost response resumes');
const dR = await C.inputDigest({ images: ['run-photo'], scanId: 'ignored' });
let reqs = [];
const lossy = async (url, init) => { reqs.push(JSON.parse(init.body)); if (reqs.length === 1) throw new Error('network lost'); return fakeRes(200, { title: 'OK', scanId: 'server-echo' }); };
let lostErr = null;
try { await C.runGradeAttempt({ apiFetch: lossy, body: { images: ['run-photo'], scanId: 'S1' }, kind: C.KINDS.SCAN }); } catch (e) { lostErr = e; }
ok(lostErr && reqs.length === 1, 'a lost response surfaces to the caller as an error');
const resumed = await C.runGradeAttempt({ apiFetch: lossy, body: { images: ['run-photo'], scanId: 'S2' }, kind: C.KINDS.SCAN });
ok(resumed.ok && reqs.length === 2 && reqs[0].attemptId === reqs[1].attemptId, 'the repeat submission carries the SAME attemptId (server will replay)');
ok(resumed.data.scanId === 'S2', 'the result is re-stamped with THIS caller\'s scanId');
const dUnc = await C.inputDigest({ images: ['gate-photo'] });
const aG = C.acquireAttempt({ digest: dUnc, kind: C.KINDS.SCAN, mint: mintSeq }); C.markUncertain(dUnc, aG.attemptId);
let gateReq = 0;
const declined = await C.runGradeAttempt({ apiFetch: async () => { gateReq += 1; return fakeRes(200, {}); }, body: { images: ['gate-photo'] }, kind: C.KINDS.SCAN, confirmNewAttempt: async () => false });
ok(declined.declined === true && declined.status === 409 && gateReq === 0, 'DECLINING the confirmation sends no request at all');
const approved = await C.runGradeAttempt({ apiFetch: async (u, init) => { gateReq += 1; return fakeRes(200, { attemptEcho: JSON.parse(init.body).attemptId }); }, body: { images: ['gate-photo'] }, kind: C.KINDS.SCAN, confirmNewAttempt: async () => true });
ok(approved.ok && gateReq === 1 && approved.attemptId !== aG.attemptId, 'APPROVING it starts a NEW attempt');
const sf = [];
const dup = await Promise.all([1, 2].map((i) => C.runGradeAttempt({ apiFetch: async (u, init) => { sf.push(1); await new Promise((r) => setTimeout(r, 20)); return fakeRes(200, { title: 'S' }); }, body: { images: ['sf-photo'], scanId: `Z${i}` }, kind: C.KINDS.SCAN })));
ok(sf.length === 1 && dup[0].data.scanId === 'Z1' && dup[1].data.scanId === 'Z2', 'two identical concurrent submissions => ONE request, each caller keeps its own scanId');

section('6. bulk manifests: one attempt per file; resume vs new import');
const fl = (name, size = 1000, lm = 5) => ({ name, size, lastModified: lm });
const three = [fl('a.jpg'), fl('b.jpg'), fl('c.jpg')];
const b1 = C.beginBulkImport({ files: three.map((f) => ({ fp: C.fileFingerprint(f) })), now: now0, mint: mintSeq });
ok(!b1.resumed && new Set(b1.files.map((f) => f.attemptId)).size === 3, 'a new three-file import mints three DISTINCT attempts');
const slots1 = C.alignBulkManifest(three, b1.files);
C.markBulkFile({ importId: b1.importId, fp: slots1[0].fp, attemptId: slots1[0].attemptId, status: 'consumed', now: now0 + 1 });
const b2 = C.beginBulkImport({ files: [...three].reverse().map((f) => ({ fp: C.fileFingerprint(f) })), now: now0 + 2, mint: mintSeq });
ok(b2.resumed && b2.importId === b1.importId, 'the SAME file set (any order) with an unfinished batch RESUMES it');
const slots2 = C.alignBulkManifest([...three].reverse(), b2.files);
ok(slots2.every((s, i) => s.attemptId === slots1[2 - i].attemptId), 'resume keeps the ORIGINAL per-file attemptIds');
ok(slots2[2].status === 'consumed', 'a finished file is marked so it is not re-graded');
for (const s of slots1.slice(1)) C.markBulkFile({ importId: b1.importId, fp: s.fp, attemptId: s.attemptId, status: 'consumed', now: now0 + 3 });
const b3 = C.beginBulkImport({ files: three.map((f) => ({ fp: C.fileFingerprint(f) })), now: now0 + 4, mint: mintSeq });
ok(!b3.resumed && b3.importId !== b1.importId && b3.files.every((f) => !slots1.some((s) => s.attemptId === f.attemptId)), 'a FINISHED batch is never resumed: re-importing identical files is a NEW import with new attemptIds');
const b4 = C.beginBulkImport({ files: [fl('a.jpg'), fl('z.jpg')].map((f) => ({ fp: C.fileFingerprint(f) })), now: now0 + 5, mint: mintSeq });
ok(!b4.resumed, 'a different file set is a new import');
const dupFiles = [fl('d.jpg', 1, 1), fl('d.jpg', 1, 1)];
const b5 = C.beginBulkImport({ files: dupFiles.map((f) => ({ fp: C.fileFingerprint(f) })), now: now0 + 6, mint: mintSeq });
const s5 = C.alignBulkManifest(dupFiles, b5.files);
ok(s5[0].attemptId !== s5[1].attemptId, 'two files with identical fingerprints still get distinct attempts');
const b6 = C.beginBulkImport({ files: [fl('e.jpg')].map((f) => ({ fp: C.fileFingerprint(f) })), now: now0 + 7, mint: mintSeq });
const e0 = b6.files[0];
const renewed = C.renewBulkAttempt({ importId: b6.importId, fp: e0.fp, oldAttemptId: e0.attemptId, now: now0 + 7, mint: mintSeq });
ok(renewed && renewed !== e0.attemptId, 'an operator-approved renewal replaces ONE slot\'s attemptId');
const b7 = C.beginBulkImport({ files: [fl('e.jpg')].map((f) => ({ fp: C.fileFingerprint(f) })), now: now0 + 8, mint: mintSeq });
ok(b7.resumed && b7.files[0].attemptId === renewed, `and the renewed id survives a restart (resumed=${b7.resumed} got=${b7.files[0].attemptId} want=${renewed})`);
const b8 = C.beginBulkImport({ files: [fl('e.jpg')].map((f) => ({ fp: C.fileFingerprint(f) })), now: now0 + C.BULK_MANIFEST_TTL_MS + 100, mint: mintSeq });
ok(!b8.resumed, 'a stale manifest (older than 24 h) is not resumed');

section('7. no session => nothing is remembered');
localStorage.removeItem('gk_session_token'); localStorage.removeItem('gk_session_expires_at');
const noSess = C.acquireAttempt({ digest: 'sha256:nosession', kind: C.KINDS.SCAN, mint: mintSeq });
signInTestPrincipal();
ok(!C.acquireAttempt({ digest: 'sha256:nosession', kind: C.KINDS.SCAN, mint: mintSeq }).reused && typeof noSess.attemptId === 'string', 'without a principal an attempt is minted but never persisted');

section('8. THE HISTORICAL INCIDENT, end to end through the real handler');
for (const line of readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}
process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'development';
if (!process.env.GRAILKEY_SESSION_SECRET) process.env.GRAILKEY_SESSION_SECRET = randomBytes(32).toString('base64url');
process.env.ANTHROPIC_API_KEY = 'test-anthropic-key-unused';
process.env.EBAY_APP_ID = process.env.EBAY_APP_ID || 'x'; process.env.EBAY_CERT_ID = process.env.EBAY_CERT_ID || 'x';
delete process.env.KV_REST_API_URL; delete process.env.KV_REST_API_TOKEN;
const pg = (await import('pg')).default;
let providerCalls = 0;
const jsonRes = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
const VISION = { title: 'Creepy', issue: '1', publisher: 'Warren', year: '1964', assetTypeConfident: true, grade: 'VF 8.0', isGraded: false, confidence: 'high', reason: 'Clean.', price: '$20' };
global.fetch = async (url) => {
  const u = String(url);
  if (u.includes('/messages/count_tokens')) return jsonRes({ input_tokens: 10 });
  if (u.includes('api.anthropic.com')) { providerCalls += 1; return jsonRes({ id: 'm', type: 'message', role: 'assistant', model: 'claude-haiku-4-5-20251001', content: [{ type: 'text', text: JSON.stringify(VISION) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } }); }
  if (u.includes('oauth')) return jsonRes({ access_token: 'x', expires_in: 7200, token_type: 'Application Access Token' });
  return jsonRes({ itemSummaries: [], total: 0 });
};
const rs = await import('../src/lib/researchStore.js'); rs.setResearchStoreForTests(rs.createMemoryResearchStore());
const receiptLib = await import('../src/lib/gradeReceipt.js');
const rmem = new Map();
receiptLib.__setReceiptStoreForTests({ async set(k, v) { rmem.set(k, v); }, async get(k) { return rmem.get(k) ?? null; }, async getdel(k) { const v = rmem.get(k) ?? null; rmem.delete(k); return v; } });
const { default: gradeHandler } = await import('../api/grade.js');
const { default: Jimp } = await import('jimp');
const photo = (await new Jimp(64, 64, 0x778899ff).getBufferAsync(Jimp.MIME_PNG)).toString('base64');
const db = new pg.Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const P = randomUUID();
await db.query(`INSERT INTO data1_dev.gk_principal (id, display_name, kind) VALUES ($1,$2,'user')`, [P, `gk281-client-${Date.now()}`]);
const tok = (() => { const payload = { principalId: P, iat: Date.now(), exp: Date.now() + 3600e3, epoch: process.env.GRAILKEY_SESSION_EPOCH || '1' }; const b = Buffer.from(JSON.stringify(payload)).toString('base64url'); return `${b}.${createHmac('sha256', process.env.GRAILKEY_SESSION_SECRET).update(b).digest('base64url')}`; })();
localStorage.setItem('gk_session_token', tokenFor(P)); // client-side scope = the same principal (only the id is read client-side)
let ipn = 0;
const realApiFetch = async (url, init) => {
  const r = { statusCode: null, body: null, headers: {} };
  r.status = (c) => { r.statusCode = c; return r; }; r.json = (d) => { r.body = d; return r; }; r.setHeader = (k, v) => { r.headers[k] = v; };
  const log = console.log; console.log = () => {}; const err = console.error; console.error = () => {};
  try { await gradeHandler({ method: 'POST', headers: { authorization: `Bearer ${tok}`, 'x-forwarded-for': `10.85.${Date.now() % 250}.${++ipn % 250}` }, body: JSON.parse(init.body) }, r); } finally { console.log = log; console.error = err; }
  return fakeRes(r.statusCode, r.body);
};
let dropFirst = true;
const flakyFetch = async (url, init) => { const res = await realApiFetch(url, init); if (dropFirst) { dropFirst = false; throw new Error('Failed to fetch (response lost after the server finished)'); } return res; };
let firstErr = null;
try { await C.runGradeAttempt({ apiFetch: flakyFetch, body: { images: [photo], scanId: 'first' }, kind: C.KINDS.SCAN }); } catch (e) { firstErr = e; }
ok(firstErr && providerCalls === 1, 'attempt 1: the server finished (1 paid call) but the client never saw the response');
const second = await C.runGradeAttempt({ apiFetch: flakyFetch, body: { images: [photo], scanId: 'second' }, kind: C.KINDS.SCAN });
ok(second.ok && second.replayed === true && !('attemptReplay' in second.data) && providerCalls === 1, 'the SAME file submitted again afterwards is a REPLAY: no second paid call');
const gradeEvents = Number((await db.query(`SELECT count(*)::int n FROM data1_dev.model_prediction_event WHERE principal_id=$1 AND surface='GRADE'`, [P])).rows[0].n);
ok(gradeEvents === 1, 'exactly one prediction event exists for the two submissions');
const dInc = await C.inputDigest({ images: [photo] });
C.markConsumed(dInc, second.attemptId);
const third = await C.runGradeAttempt({ apiFetch: flakyFetch, body: { images: [photo], scanId: 'third' }, kind: C.KINDS.SCAN });
ok(third.ok && !third.replayed && providerCalls === 2 && third.attemptId !== second.attemptId, 'after the first result was SAVED, scanning the same photo again is a deliberate new attempt (a second workflow)');
await db.end();

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
