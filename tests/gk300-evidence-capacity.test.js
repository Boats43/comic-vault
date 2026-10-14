// tests/gk300-evidence-capacity.test.js
//
// GK-300 Phase B -- governed evidence capture, decoupled from identity resolution, with an
// authoritative 20-row per-asset media bound.
//
// REAL Development Postgres (throwaway principals/assets, permanent append-only Development
// fixtures per the repo convention), REAL attachMedia / insertMedia / api/asset-media-append handler,
// and a REAL execution of the client function captureEvidencePhoto (dependencies injected).
// SAFETY: media storage is forced to the LOCAL FILESYSTEM driver in a temp directory and the Blob
// token is deleted before any module is imported, so this test can never write to the shared Blob
// store (GK-301). The environment guard additionally refuses any database whose marker is not
// "development".
//
//   node tests/gk300-evidence-capacity.test.js

import { readFileSync, readdirSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
for (const line of readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}
process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'development';
const MEDIA_ROOT = mkdtempSync(path.join(os.tmpdir(), 'gk300-media-'));
process.env.MEDIA_STORAGE_DRIVER = 'localfs';
process.env.MEDIA_LOCALFS_ROOT = MEDIA_ROOT;
delete process.env.BLOB_READ_WRITE_TOKEN;
if (!process.env.GRAILKEY_SESSION_SECRET) process.env.GRAILKEY_SESSION_SECRET = randomBytes(32).toString('base64url');

let passed = 0, failed = 0;
const failures = [];
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; failures.push(l); console.log(`  ✗ ${l}`); } };
const imp = (p) => import(pathToFileURL(path.join(repoRoot, p)).href);

const A = await imp('src/modules/assets/index.js');
const repo = await imp('src/modules/assets/repository.js');
const { issueToken } = await imp('src/modules/auth/token.js');
const { createCollectionItem } = await imp('src/modules/collection/index.js');
const handler = (await imp('api/asset-media-append.js')).default;
const { captureEvidencePhoto, EvidenceRefusedError } = await imp('src/lib/evidenceCapture.js');

const db = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const marker = (await db.query('SELECT app_env FROM data1_dev.environment_marker')).rows.map((r) => r.app_env).join(',');
if (marker !== 'development') { console.log(`ABORT: database marker is "${marker}", not development`); process.exit(2); }
console.log(`\n=== GK-300 evidence capacity (database marker=${marker}, media driver=localfs) ===\n`);

const nonce = (l) => `gk300-${l}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const blobCount = () => { let n = 0; const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { if (e.isDirectory()) walk(path.join(d, e.name)); else n++; } }; walk(MEDIA_ROOT); return n; };
async function newPrincipal(label) {
  const id = (await db.query('SELECT uuidv7() AS id')).rows[0].id;
  await db.query(`INSERT INTO data1_dev.gk_principal (id, display_name, kind) VALUES ($1, $2, 'operator')`, [id, label]);
  return id;
}
async function newAsset(principalId, label) {
  const n = nonce(label);
  const { assetId } = await A.createPhysicalAsset({ principalId, captureBasis: { test: true, label, n }, assetClass: 'comic', source: 'test-fixture', idempotencyKey: `${n}-mint` });
  return assetId;
}
const photo = (tag) => Buffer.from(`gk300-photo-${tag}-${randomBytes(8).toString('hex')}`);
const append = (principalId, gkAssetId, captureView, tag, key) => A.attachMedia({ principalId, gkAssetId, bytes: photo(tag), contentType: 'image/jpeg', captureRole: 'capture-photo', ...(captureView ? { captureView } : {}), idempotencyKey: key || nonce(`${tag}-key`) });
const fillTo = async (principalId, assetId, target, tag) => { const have = (await media(assetId)).length; await Promise.all(Array.from({ length: Math.max(0, target - have) }, (_, i) => append(principalId, assetId, 'DETAIL', `${tag}-${i}`))); };
const media = async (assetId) => (await db.query('SELECT id, capture_view, content_hash FROM data1_dev.media WHERE asset_id = $1 ORDER BY recorded_at, id', [assetId])).rows;

// ───────────────────────── A. five declared roles beside undeclared legacy rows ─────────────────────────
console.log('-- A. five declared roles alongside two undeclared (NULL capture_view) legacy rows --\n');
const p1 = await newPrincipal('gk300-cap-A');
const a1 = await newAsset(p1, 'A');
const sameBytes = photo('legacy-front');
const L1 = await A.attachMedia({ principalId: p1, gkAssetId: a1, bytes: sameBytes, contentType: 'image/jpeg', captureRole: 'capture-photo', idempotencyKey: nonce('legacy1') });
const L2 = await append(p1, a1, null, 'legacy2');
const before = await media(a1);
ok(before.length === 2 && before.every((r) => r.capture_view === null), 'precondition: two legacy rows, capture_view NULL');
const roles = ['FRONT', 'BACK', 'SPINE', 'PAGES', 'DETAIL'];
const declared = {};
for (const r of roles) declared[r] = await append(p1, a1, r, r);
const afterA = await media(a1);
ok(afterA.length === 7, `seven durable rows coexist (2 undeclared + 5 declared) — got ${afterA.length}`);
for (const r of roles) ok(afterA.filter((x) => x.capture_view === r).length === 1, `${r} persisted exactly once with durable capture_view=${r}`);
const legacyAfter = afterA.filter((x) => x.capture_view === null);
ok(legacyAfter.length === 2 && legacyAfter.map((x) => x.id).sort().join() === before.map((x) => x.id).sort().join(), 'both legacy rows still NULL, same ids, not relabeled/deleted');
ok(legacyAfter.map((x) => x.content_hash).sort().join() === before.map((x) => x.content_hash).sort().join(), 'legacy content hashes unchanged');
const frontIdentical = await A.attachMedia({ principalId: p1, gkAssetId: a1, bytes: sameBytes, contentType: 'image/jpeg', captureRole: 'capture-photo', captureView: 'FRONT', idempotencyKey: nonce('front-identical') });
const afterA2 = await media(a1);
ok(afterA2.length === 8 && frontIdentical.mediaId !== L1.mediaId, 'a declared FRONT with bytes IDENTICAL to a legacy capture is a distinct evidence row (never deduplicated)');
ok(afterA2.filter((x) => x.content_hash === L1.sha256).length === 2, 'same content hash held by the legacy row and the declared row (object deduped, evidence rows distinct)');

// ───────────────────────── B. identity / grade untouched server-side ─────────────────────────
console.log('\n-- B. operator identity and grade untouched by evidence append --\n');
const p2 = await newPrincipal('gk300-cap-B');
const a2 = await newAsset(p2, 'B');
const itemId = `cv_${nonce('item')}`;
const attrs = { title: 'old man logan deodato', issue: '25', year: '2017', publisher: 'Marvel', variant: '1:25', grade: 'NM 9.2', operatorGrade: '9.0', gradeAuthority: 'OPERATOR_CONFIRMED', identityAuthority: { title: 'OPERATOR_CONFIRMED', issue: 'OPERATOR_CONFIRMED' }, price: '$15.26' };
await createCollectionItem({ principalId: p2, id: itemId, assetCategory: 'comic', attributes: attrs });
const itemBefore = JSON.stringify((await db.query('SELECT attributes FROM data1_dev.collection_item WHERE id = $1', [itemId])).rows[0].attributes);
const predBefore = (await db.query(`SELECT count(*)::int AS n FROM data1_dev.model_prediction_event`)).rows[0].n;
for (const r of roles) await append(p2, a2, r, `B-${r}`);
const itemAfter = JSON.stringify((await db.query('SELECT attributes FROM data1_dev.collection_item WHERE id = $1', [itemId])).rows[0].attributes);
const predAfter = (await db.query(`SELECT count(*)::int AS n FROM data1_dev.model_prediction_event`)).rows[0].n;
ok(itemBefore === itemAfter, 'collection_item attributes (identity, operatorGrade, identityAuthority, price) byte-identical after five evidence appends');
ok(predBefore === predAfter, 'no model_prediction_event rows were written by evidence appends (no re-grade)');

// ───────────────────────── C. capacity bound ─────────────────────────
console.log('\n-- C. 20-row per-asset bound, replay at capacity, no orphan blob on rejection --\n');
ok(repo.MAX_MEDIA_PER_ASSET === 20, 'MAX_MEDIA_PER_ASSET is 20');
const p3 = await newPrincipal('gk300-cap-C');
const a3 = await newAsset(p3, 'C');
await append(p3, a3, null, 'C-legacy1'); await append(p3, a3, null, 'C-legacy2');
for (const r of roles) await append(p3, a3, r, `C-${r}`);
const replayKey = nonce('replay-key');
const replayBytes = photo('C-replay');
const firstRes = await A.attachMedia({ principalId: p3, gkAssetId: a3, bytes: replayBytes, contentType: 'image/jpeg', captureRole: 'capture-photo', captureView: 'DETAIL', idempotencyKey: replayKey });
await fillTo(p3, a3, 20, 'C-fill');
ok((await media(a3)).length === 20, 'asset filled to exactly 20 rows');
const blobsBefore = blobCount();
let capErr = null;
try { await append(p3, a3, 'FRONT', 'C-21st'); } catch (e) { capErr = e; }
ok(capErr && capErr.name === 'MediaCapacityExceededError' && capErr.code === 'MEDIA_CAPACITY_EXCEEDED', 'the 21st append is refused with MediaCapacityExceededError');
ok((await media(a3)).length === 20, 'row count still 20 after the refusal');
ok(blobCount() === blobsBefore, 'the refused append created NO blob (rejected before storage)');
const replayRes = await A.attachMedia({ principalId: p3, gkAssetId: a3, bytes: replayBytes, contentType: 'image/jpeg', captureRole: 'capture-photo', captureView: 'DETAIL', idempotencyKey: replayKey });
ok(replayRes.mediaId === firstRes.mediaId, 'an idempotent replay at capacity returns the ORIGINAL result');
ok((await media(a3)).length === 20, 'replay at capacity created no row');
let conflict = null;
try { await A.attachMedia({ principalId: p3, gkAssetId: a3, bytes: photo('C-other'), contentType: 'image/jpeg', captureRole: 'capture-photo', captureView: 'DETAIL', idempotencyKey: replayKey }); } catch (e) { conflict = e; }
ok(conflict && conflict.name === 'IdempotencyConflictError', 'same key + different bytes at capacity is still a typed idempotency conflict, not a capacity error or silent replay');

// ───────────────────────── D. concurrency ─────────────────────────
console.log('\n-- D. concurrent appends near the boundary --\n');
const p4 = await newPrincipal('gk300-cap-D');
const a4 = await newAsset(p4, 'D');
await fillTo(p4, a4, 15, 'D-fill');
const blobsD0 = blobCount();
const results = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => append(p4, a4, roles[i % 5], `D-race-${i}`)));
const okN = results.filter((r) => r.status === 'fulfilled').length;
const capN = results.filter((r) => r.status === 'rejected' && r.reason?.name === 'MediaCapacityExceededError').length;
const otherN = results.length - okN - capN;
ok(okN === 5 && capN === 7 && otherN === 0, `12 concurrent appends onto 15 rows: exactly 5 succeed, 7 refused by capacity, 0 other errors (got ${okN}/${capN}/${otherN})`);
ok((await media(a4)).length === 20, 'final row count is exactly 20, never above');
const orphanRace = blobCount() - blobsD0 - okN;
console.log(`  i boundary-race orphan blobs (concurrent requests that passed the pre-check, then lost the locked recount): ${orphanRace} -- known MEDIA-DEBT class, no cleanup path exists (media module has no delete); informational, not asserted`);

// ───────────────────────── E. handler ─────────────────────────
console.log('\n-- E. api/asset-media-append handler --\n');
const mockRes = () => { const res = { statusCode: null, body: null, headers: {} }; res.setHeader = (k, v) => { res.headers[k] = v; }; res.status = (c) => { res.statusCode = c; return res; }; res.json = (b) => { res.body = b; return res; }; return res; };
const call = async (principalId, body) => {
  const req = { method: 'POST', headers: { authorization: `Bearer ${issueToken({ principalId }).token}`, 'x-forwarded-for': `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` }, body };
  const res = mockRes(); await handler(req, res); return res;
};
const b64 = (tag) => photo(tag).toString('base64');
const hFull = await call(p3, { gkAssetId: a3, bytes: b64('E-full'), contentType: 'image/jpeg', captureView: 'BACK', idempotencyKey: nonce('E-full') });
ok(hFull.statusCode === 409 && hFull.body?.error === 'MEDIA_CAPACITY_EXCEEDED' && hFull.body?.limit === 20, 'handler maps capacity to HTTP 409 {error:MEDIA_CAPACITY_EXCEEDED, limit:20}');
const p5 = await newPrincipal('gk300-cap-E'); const a5 = await newAsset(p5, 'E');
const hOk = await call(p5, { gkAssetId: a5, bytes: b64('E-ok'), contentType: 'image/jpeg', captureView: 'SPINE', idempotencyKey: nonce('E-ok') });
ok(hOk.statusCode === 200 && hOk.body?.captureView === 'SPINE', 'handler still accepts a valid declared-role append (200, captureView echoed)');
const hForeign = await call(p5, { gkAssetId: a3, bytes: b64('E-foreign'), contentType: 'image/jpeg', captureView: 'BACK', idempotencyKey: nonce('E-foreign') });
ok(hForeign.statusCode === 404, 'a non-owner is still refused 404 (authorization unchanged)');
const hRole = await call(p5, { gkAssetId: a5, bytes: b64('E-role'), contentType: 'image/jpeg', captureView: 'COVER', idempotencyKey: nonce('E-role') });
ok(hRole.statusCode === 400 && hRole.body?.error === 'CAPTURE_VIEW_REQUIRED', 'an undeclared/invalid role is still refused 400 (never defaulted)');

// ───────────────────────── F. real client function ─────────────────────────
console.log('\n-- F. real captureEvidencePhoto (client), dependencies injected --\n');
const calls = { grade: 0, thumb: [], append: [], keys: [] };
const mkDeps = (appendImpl) => ({
  fileToBase64: async () => 'RAWB64',
  makeThumbnail: async (raw, px, q) => { calls.thumb.push([raw, px, q]); return 'data:image/jpeg;base64,QUJD'; },
  appendDetailed: async (a) => { calls.append.push(a); return appendImpl(a); },
  getKey: (item, view) => { const k = `key-${item}-${view}`; calls.keys.push(k); return k; },
  retireKey: () => {},
});
const f1 = await captureEvidencePhoto({ file: {}, itemId: 'it1', gkAssetId: 'g', captureView: 'SPINE', pendingAppends: [], deps: mkDeps(async () => ({ ok: true, status: 200, body: { mediaId: 'm1' } })) });
ok(f1.status === 'APPENDED' && f1.mediaId === 'm1' && f1.pendingAppends.length === 0, 'success -> APPENDED, queue empty');
ok(calls.thumb[0][1] === 1200 && calls.thumb[0][2] === 0.85, 'image preparation unchanged: 1200px / quality 0.85 (A6)');
ok(calls.append[0].captureView === 'SPINE' && calls.append[0].gkAssetId === 'g', 'append carries the explicitly declared role and asset');
const f2 = await captureEvidencePhoto({ file: {}, itemId: 'it1', gkAssetId: 'g', captureView: 'BACK', pendingAppends: [], deps: mkDeps(async () => ({ ok: false, status: null, body: null })) });
ok(f2.status === 'PENDING' && f2.pendingAppends.length === 1 && f2.pendingAppends[0].dataUrl === 'data:image/jpeg;base64,QUJD' && f2.pendingAppends[0].idempotencyKey === 'key-it1-BACK', 'no session/network -> PENDING with the EXACT bytes and stable idempotency key');
const f3 = await captureEvidencePhoto({ file: {}, itemId: 'it1', gkAssetId: 'g', captureView: 'BACK', pendingAppends: f2.pendingAppends, deps: mkDeps(async () => ({ ok: false, status: 503, body: null })) });
ok(f3.status === 'PENDING' && f3.pendingAppends.length === 1, 'a repeated transient failure replaces (never duplicates) the queued entry for that role');
const f4 = await captureEvidencePhoto({ file: {}, itemId: 'it1', gkAssetId: 'g', captureView: 'BACK', pendingAppends: f3.pendingAppends, deps: mkDeps(async (a) => ({ ok: true, status: 200, body: { mediaId: 'm2' } })) });
ok(f4.status === 'APPENDED' && f4.pendingAppends.length === 0, 'retry success clears the queued entry');
let refused = null;
try { await captureEvidencePhoto({ file: {}, itemId: 'it1', gkAssetId: 'g', captureView: 'FRONT', pendingAppends: [], deps: mkDeps(async () => ({ ok: false, status: 409, body: { error: 'MEDIA_CAPACITY_EXCEEDED', limit: 20 } })) }); } catch (e) { refused = e; }
ok(refused instanceof EvidenceRefusedError && refused.code === 'MEDIA_CAPACITY_EXCEEDED' && /maximum of 20/.test(refused.message), 'capacity refusal throws a clear EvidenceRefusedError and is NOT queued for retry');
let badRole = null;
try { await captureEvidencePhoto({ file: {}, itemId: 'it1', gkAssetId: 'g', captureView: 'COVER', pendingAppends: [], deps: mkDeps(async () => ({ ok: true, status: 200, body: { mediaId: 'x' } })) }); } catch (e) { badRole = e; }
ok(!!badRole, 'an undeclared role is rejected client-side before any network call');
const src = readFileSync(path.join(repoRoot, 'src/lib/evidenceCapture.js'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
ok(!/api\/grade|runGradeAttempt|\.images|identityAuthority|operatorGrade|gradeProof|\btitle\b|\bissue\b|publisher/.test(src), 'evidenceCapture.js (code, comments stripped) never references grading, catalogue images, identity or grade fields');

// ───────────────────────── G. wiring, regression, constants ─────────────────────────
console.log('\n-- G. wiring and regression guards --\n');
const app = readFileSync(path.join(repoRoot, 'src/App.jsx'), 'utf8');
const panel = readFileSync(path.join(repoRoot, 'src/components/GrailKeyOperatorPanel.jsx'), 'utf8');
const repoSrc = readFileSync(path.join(repoRoot, 'src/modules/assets/repository.js'), 'utf8');
ok(/<GrailKeyOperatorPanel[^>]*onAddEvidence=\{onAddEvidence\}/.test(app) && !/<GrailKeyOperatorPanel[^>]*onAddPhoto/.test(app), 'App passes ONLY onAddEvidence to the operator panel');
ok(/await onAddEvidence\(item, file, \{ gkAssetId, captureView: role \}\)/.test(panel) && !/onAddPhoto/.test(panel), 'operator panel evidence path calls onAddEvidence, never addPhotoToComic');
const fnStart = app.indexOf('const addEvidencePhoto = useCallback');
const fnBody = app.slice(fnStart, app.indexOf('}, []);', fnStart));
ok(!/runGradeAttempt|api\/grade|images:|photoRoles/.test(fnBody), 'addEvidencePhoto wrapper has no grading call and no catalogue image change');
ok(/Maximum 4 photos reached/.test(app) && /resolvePhotoRegradeIdentity\(item, data\)/.test(app) && /<button type="button" onClick=\{handleAddLibraryClick\}/.test(app), 'legacy catalogue-photo behavior intact: 4-photo cap, identity lock, camera+library strip buttons');
ok(repo.MEDIA_CAPACITY_LOCK_NAMESPACE === 40291 && repo.MEDIA_CAPACITY_LOCK_NAMESPACE !== 40284, 'media-capacity lock namespace is the named constant 40291, distinct from marketplace-attempt 40284');
const codeLines = repoSrc.split('\n').filter((l) => !l.trim().startsWith('//'));
ok(codeLines.filter((l) => /\b40291\b/.test(l)).length === 1, 'the literal 40291 appears in code exactly once (the constant definition) — no inline magic number');
ok(/await lockAssetMediaCapacity\(client, assetId\);\s*\n\s*const current = await countAssetMedia\(client, assetId\);/.test(repoSrc), 'insertMedia takes the per-asset lock BEFORE counting');

console.log(`\n${passed} passed, ${failed} failed`);
await db.end();
if (failed) console.log(failures.join('\n'));
// The asset/auth modules hold pooled connections open; exit explicitly.
process.exit(failed ? 1 : 0);
