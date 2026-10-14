// tests/gk300-d2-d3-retry-and-dead-branch.test.js
//
// GK-300 D2 + D3 (no database, no network):
//  D2  the REAL retryPendingPhysicalMediaAppends runs against REAL src/db.js on fake-indexeddb with a
//      stubbed fetch: a 409 MEDIA_CAPACITY_EXCEEDED is TERMINAL (entry preserved with its exact bytes,
//      role and idempotency key; never auto-retried again; actionable message), every other failure stays
//      transient, idempotency keys are stable, a success clears the entry.
//  D3  the obsolete evidence-append branch is gone from addPhotoToComic; normal catalogue-photo behavior
//      (4-photo cap, identity lock, camera/library buttons) is intact.
//
//   node tests/gk300-d2-d3-retry-and-dead-branch.test.js

import 'fake-indexeddb/auto';
import './helpers/installBrowserSession.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(repoRoot, p)).href);

let passed = 0, failed = 0;
const failures = [];
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; failures.push(l); console.log(`  ✗ ${l}`); } };

const { putComic, getAllComics } = await imp('src/db.js');
const M = await imp('src/lib/physicalMediaAppend.js');
const { captureEvidencePhoto } = await imp('src/lib/evidenceCapture.js');

console.log('\n=== GK-300 D2/D3 — terminal capacity retry + dead evidence branch ===\n');

console.log('-- D2. pure classifier --\n');
ok(M.classifyRetryResult({ ok: true, status: 200, body: { mediaId: 'm' } }) === M.RETRY_OUTCOME.APPENDED, '200 + mediaId -> APPENDED');
ok(M.classifyRetryResult({ ok: false, status: 409, body: { error: 'MEDIA_CAPACITY_EXCEEDED', limit: 20 } }) === M.RETRY_OUTCOME.TERMINAL_CAPACITY, '409 MEDIA_CAPACITY_EXCEEDED -> TERMINAL');
for (const [label, r] of [
  ['409 idempotency conflict (other 409)', { ok: false, status: 409, body: { error: 'idempotencyKey was already used' } }],
  ['no session / network', { ok: false, status: null, body: null }],
  ['503', { ok: false, status: 503, body: null }],
  ['401', { ok: false, status: 401, body: null }],
  ['429', { ok: false, status: 429, body: null }],
  ['404', { ok: false, status: 404, body: { error: 'Not found' } }],
  ['400', { ok: false, status: 400, body: { error: 'CAPTURE_VIEW_REQUIRED' } }],
  ['null', null],
]) ok(M.classifyRetryResult(r) === M.RETRY_OUTCOME.TRANSIENT, `${label} -> TRANSIENT (unchanged behavior)`);

console.log('\n-- D2. the REAL retry loop on fake-indexeddb with stubbed fetch --\n');
const entry = (view, tag) => ({ gkAssetId: 'asset-1', captureView: view, dataUrl: `data:image/jpeg;base64,${tag}`, idempotencyKey: `key-${view}` });
await putComic({ id: 'item-1', assetCategory: 'comic', title: 'Old Man Logan', timestamp: Date.now(), _pendingEvidenceAppends: [entry('BACK', 'QkFDSw=='), entry('SPINE', 'U1BJTkU='), entry('PAGES', 'UEFHRVM=')] });
const fetchLog = [];
let spineStatus = 503;
globalThis.fetch = async (url, opts) => {
  const b = JSON.parse(opts.body);
  fetchLog.push({ url: String(url), view: b.captureView, key: b.idempotencyKey });
  const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: () => null } });
  if (b.captureView === 'BACK') return res(409, { error: 'MEDIA_CAPACITY_EXCEEDED', limit: 20, current: 20 });
  if (b.captureView === 'SPINE') return spineStatus === 200 ? res(200, { mediaId: 'media-spine' }) : res(spineStatus, null);
  return res(200, { mediaId: 'media-pages' });
};
const resolved = [];
const runRetry = async () => {
  fetchLog.length = 0;
  const items = await getAllComics();
  const persists = [];
  // onResolved is fire-and-forget in the real loop (App.jsx does the same), so collect and await the persists.
  await M.retryPendingPhysicalMediaAppends(items, (itemId, stillPending) => {
    resolved.push({ itemId, stillPending });
    persists.push((async () => {
      const cur = (await getAllComics()).find((c) => c.id === itemId);
      await putComic({ ...cur, _pendingEvidenceAppends: stillPending }); // exactly what App.jsx does
    })());
  });
  await Promise.all(persists);
};
await runRetry();
const after1 = (await getAllComics()).find((c) => c.id === 'item-1')._pendingEvidenceAppends;
const back1 = after1.find((e) => e.captureView === 'BACK');
ok(fetchLog.length === 3, 'round 1: all three queued entries were attempted once');
ok(back1 && back1.terminal && back1.terminal.code === 'MEDIA_CAPACITY_EXCEEDED' && back1.terminal.status === 409, 'capacity-refused BACK is flagged TERMINAL (not dropped)');
ok(back1.dataUrl === 'data:image/jpeg;base64,QkFDSw==' && back1.idempotencyKey === 'key-BACK' && back1.captureView === 'BACK' && back1.gkAssetId === 'asset-1', 'rejected photo, role, asset and idempotency key preserved EXACTLY');
ok(/maximum of 20 evidence photos/.test(back1.terminal.message) && /will not be retried automatically/.test(back1.terminal.message), 'the stored message is actionable and says it will not auto-retry');
const spine1 = after1.find((e) => e.captureView === 'SPINE');
ok(spine1 && !spine1.terminal, 'a transient failure (503) stays a normal pending entry');
ok(!after1.some((e) => e.captureView === 'PAGES'), 'a successful retry clears its entry');
ok(resolved.length === 1, 'onResolved fired (the terminal flag counts as a change that must be persisted)');

await runRetry();
ok(!fetchLog.some((c) => c.view === 'BACK'), 'round 2: the terminal BACK entry is NOT sent again (no automatic reconnect retry)');
ok(fetchLog.filter((c) => c.view === 'SPINE').length === 1 && fetchLog.find((c) => c.view === 'SPINE').key === 'key-SPINE', 'round 2: the transient SPINE entry IS retried, with the SAME idempotency key');
const afterTerminal = (await getAllComics()).find((x) => x.id === 'item-1')._pendingEvidenceAppends.find((e) => e.captureView === 'BACK');
ok(JSON.stringify(afterTerminal) === JSON.stringify(back1), 'terminal entry byte-identical across a further reconnect');

spineStatus = 200;
await runRetry();
const after3 = (await getAllComics()).find((x) => x.id === 'item-1')._pendingEvidenceAppends;
ok(after3.length === 1 && after3[0].captureView === 'BACK' && after3[0].terminal, 'once transient SPINE succeeds only the preserved terminal BACK remains');
await runRetry();
ok(fetchLog.length === 0, 'round 4: nothing is sent at all while only a terminal entry remains');

console.log('\n-- D2. a fresh, successful capture of a terminal role replaces the stale terminal entry --\n');
const deps = { fileToBase64: async () => 'RAW', makeThumbnail: async () => 'data:image/jpeg;base64,TkVX', appendDetailed: async () => ({ ok: true, status: 200, body: { mediaId: 'm-new' } }), getKey: () => 'k', retireKey: () => {} };
const replaced = await captureEvidencePhoto({ file: {}, itemId: 'item-1', gkAssetId: 'asset-1', captureView: 'BACK', pendingAppends: after3, deps });
ok(replaced.status === 'APPENDED' && replaced.pendingAppends.length === 0, 'success for that role clears the terminal entry');

console.log('\n-- D3. dead evidence branch removed; catalogue-photo behavior intact --\n');
const app = readFileSync(path.join(repoRoot, 'src/App.jsx'), 'utf8');
const s0 = app.indexOf('const addPhotoToComic = useCallback');
const fn = app.slice(s0, app.indexOf('}, []);', s0));
ok(!/appendPhysicalMediaEvidence|getOrCreateEvidenceIdempotencyKey|retireEvidenceIdempotencyKey|_pendingEvidenceAppends|evidenceGkAssetId/.test(fn), 'addPhotoToComic no longer contains the kernel-evidence append, retry marker or evidence idempotency handling');
ok(!/appendPhysicalMediaEvidence\b(?!Detailed)/.test(app.replace(/^\s*\/\/.*$/gm, '')), 'App.jsx no longer references appendPhysicalMediaEvidence (import removed, no dangling use)');
ok(/Maximum 4 photos reached/.test(fn) && /resolvePhotoRegradeIdentity\(item, data\)/.test(fn) && /runGradeAttempt\(/.test(fn) && /persistCollectionItem\(updated\)/.test(fn) && /putComic\(updated\)/.test(fn), 'normal behavior intact: 4-photo cap, identity lock, grade request, local + synced persistence');
ok(/imageViews/.test(fn), 'GK-271 declared-views request plumbing retained (asserted by gk271b)');
ok(/onAddPhoto\(item, file\)/.test(app) && !/onAddPhoto\(item, file, /.test(app), 'the only caller of addPhotoToComic passes no evidence options (branch was unreachable)');
const panel = readFileSync(path.join(repoRoot, 'src/components/GrailKeyOperatorPanel.jsx'), 'utf8');
ok(/isTerminal/.test(panel) && /pendingEntry\.terminal\.message/.test(panel), 'operator panel shows the terminal message');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) console.log(failures.join('\n'));
process.exit(failed ? 1 : 0);
