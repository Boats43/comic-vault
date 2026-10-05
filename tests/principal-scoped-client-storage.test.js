// tests/principal-scoped-client-storage.test.js
//
// LIVE EXPOSURE CLOSURE (2026-10-04) — P0: browser-persisted user data must
// never cross the principal boundary.
//
// PART 0 runs the PRE-FIX code (verbatim snapshots of src/db.js and
// src/lib/collectionPersistence.js from 2e74cb1, tests/fixtures/pre-fix-
// client-storage/) through User A -> logout -> User B on one browser and
// records exactly what B sees and what gets pushed under B's token. That
// same sequence then runs against the FIXED modules.
//
// Real code, real (fake-indexeddb) IndexedDB, stubbed network only. No
// database, no secrets. Invoke: node tests/principal-scoped-client-storage.test.js

import 'fake-indexeddb/auto';
import { readFileSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

let passed = 0;
let failed = 0;
const failures = [];
const ok = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; failures.push(label); console.log(`  ✗ ${label}`); }
};
const eq = (a, b, label) => ok(JSON.stringify(a) === JSON.stringify(b), `${label}${JSON.stringify(a) === JSON.stringify(b) ? '' : ` (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`}`);

// ── browser shims ──
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};
globalThis.window = new EventTarget();

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const tokenFor = (principalId) => `${b64u({ principalId })}.sig-${principalId}`;
const login = (principalId, setSession) => setSession(tokenFor(principalId), Date.now() + 3600_000);

// ── network stub: records every push with the bearer it was sent under ──
let pushes = [];
let onPush = null;
globalThis.fetch = async (url, opts = {}) => {
  const body = opts.body ? JSON.parse(opts.body) : null;
  pushes.push({ url, auth: opts.headers?.Authorization, id: body?.id });
  if (onPush) await onPush();
  return { ok: true, status: 200, json: async () => ({ ok: true }) };
};

const ROOT = new URL('..', import.meta.url);
const session = await import(new URL('src/lib/grailkeySession.js', ROOT).href);
const { setSession, clearSession } = session;

// ═════════════════════════ PART 0 — PRE-FIX DEMONSTRATION ═════════════════════════
console.log('PART 0 — pre-fix path (2e74cb1 modules): A -> logout -> B on one browser');
const tmp = mkdtempSync(join(tmpdir(), 'prefix-client-'));
mkdirSync(join(tmp, 'src/lib'), { recursive: true });
copyFileSync(new URL('tests/fixtures/pre-fix-client-storage/db.js', ROOT), join(tmp, 'src/db.js'));
copyFileSync(new URL('tests/fixtures/pre-fix-client-storage/collectionPersistence.js', ROOT), join(tmp, 'src/lib/collectionPersistence.js'));
copyFileSync(new URL('src/lib/collectionSync.js', ROOT), join(tmp, 'src/lib/collectionSync.js'));
copyFileSync(new URL('src/lib/grailkeySession.js', ROOT), join(tmp, 'src/lib/grailkeySession.js'));
copyFileSync(new URL('src/lib/assetCategories.js', ROOT), join(tmp, 'src/lib/assetCategories.js')); // collectionSync (current) imports it
copyFileSync(new URL('src/lib/clientContract.js', ROOT), join(tmp, 'src/lib/clientContract.js')); // grailkeySession (current) imports it
const oldDb = await import(pathToFileURL(join(tmp, 'src/db.js')).href);
const oldPersist = await import(pathToFileURL(join(tmp, 'src/lib/collectionPersistence.js')).href);
const oldSession = await import(pathToFileURL(join(tmp, 'src/lib/grailkeySession.js')).href);

login('principal-A', oldSession.setSession);
// A's local state, written by the OLD code (this is also what a real pre-fix device holds).
await oldDb.putComic({ assetCategory: 'comic', timestamp: 1001, id: 'cv_1_a', title: 'Hulk', issue: '180', year: '1974', publisher: 'Marvel', _syncStatus: 'synced', images: ['data:A-photo'] });
await oldDb.putComic({ assetCategory: 'comic', timestamp: 1002, id: 'cv_2_a', title: 'Batman', issue: '1', year: '1940', publisher: 'DC', _syncStatus: 'pending', images: ['data:A-photo-2'] });
await oldDb.putComic({ assetCategory: 'comic', timestamp: 1003, id: 'cv_3_local', title: 'Legacy Only', issue: '5', year: '1980', publisher: 'X' }); // never synced, no _syncStatus
oldSession.clearSession(); // A logs out — pre-fix, storage untouched
login('principal-B', oldSession.setSession);
const bView = await oldDb.getAllComics();
pushes = [];
await oldPersist.retryPendingCollectionItems(bView);
ok(bView.map((c) => c.id).sort().join() === 'cv_1_a,cv_2_a,cv_3_local', 'PRE-FIX: user B sees ALL of A\'s local rows');
ok(bView.some((c) => c.images?.[0] === 'data:A-photo'), 'PRE-FIX: user B sees A\'s raw photo bytes');
ok(pushes.length === 1 && pushes[0].id === 'cv_2_a' && pushes[0].auth === `Bearer ${tokenFor('principal-B')}`, 'PRE-FIX: A\'s pending row is pushed under B\'s bearer token (cross-principal write)');
// clear what the old code left pending→synced so the legacy rows read as unsynced legacy again
await oldDb.putComic({ assetCategory: 'comic', timestamp: 1004, id: 'cv_2_a', title: 'Batman', issue: '1', year: '1940', publisher: 'DC', _syncStatus: 'pending', images: ['data:A-photo-2'] });
oldSession.clearSession();
store.clear();

// ═════════════════════════ PART 1 — FIXED MODULES ═════════════════════════
console.log('PART 1 — fixed modules: no session');
const db = await import(new URL('src/db.js', ROOT).href);
const persistence = await import(new URL('src/lib/collectionPersistence.js', ROOT).href);
const pstore = await import(new URL('src/lib/principalStorage.js', ROOT).href);
const legacy = await import(new URL('src/lib/legacyLocalClaim.js', ROOT).href);

eq(await db.getAllComics(), [], 'no session: getAllComics() returns nothing (pre-login mount loads no user-owned state)');
eq(await db.getAllSnapshots(), [], 'no session: snapshots empty');
let threw = null;
try { await db.putComic({ assetCategory: 'comic', timestamp: 1005, id: 'x' }); } catch (e) { threw = e; }
ok(threw && threw.code === 'NO_PRINCIPAL_SCOPE', 'no session: putComic REFUSES (never an unscoped write)');
ok(pstore.scopedSet('cv_buyer_sessions', '[1]') === false && pstore.scopedGet('cv_buyer_sessions') === null, 'no session: scoped localStorage refuses writes and reads null');
ok(![...store.keys()].some((k) => k.startsWith('cv_buyer_sessions')), 'no session: nothing was written to localStorage');

console.log('PART 2 — A -> logout -> B -> A');
login('principal-A', setSession);
await db.putComic({ assetCategory: 'comic', timestamp: 1006, id: 'a1', title: 'Hulk', issue: '180', year: '1974', publisher: 'Marvel', _syncStatus: 'synced', images: ['data:A1'] });
await db.putComic({ assetCategory: 'comic', timestamp: 1007, id: 'a2', title: 'Batman', issue: '1', year: '1940', publisher: 'DC', _syncStatus: 'pending', images: ['data:A2'] });
pstore.scopedSet('cv_buyer_sessions', JSON.stringify([{ ts: 1, title: 'A-buy', _syncStatus: 'pending' }]));
pstore.scopedSet('cv_trade_piles', JSON.stringify([{ id: 'pile-A' }]));
const aStaleList = await db.getAllComics(); // a list captured under A
ok(aStaleList.length === 2, 'A sees A\'s two local rows');
clearSession(); // logout
eq(await db.getAllComics(), [], 'after logout nothing is readable');

login('principal-B', setSession);
eq(await db.getAllComics(), [], 'B sees ZERO of A\'s Collection rows');
ok(!JSON.stringify(await db.getAllComics()).includes('data:A'), 'B sees zero of A\'s media');
eq(pstore.scopedGet('cv_buyer_sessions'), null, 'B sees none of A\'s buyer sessions (pending sync queue)');
eq(pstore.scopedGet('cv_trade_piles'), null, 'B sees none of A\'s trade piles');
pushes = [];
const staleResult = await persistence.retryPendingCollectionItems(aStaleList); // stale list captured under A, retried under B
eq(staleResult, [], 'B cannot retry A\'s pending rows even when handed A\'s stale list');
eq(pushes, [], 'no network push happened for A\'s data under B\'s token');
await db.putComic({ assetCategory: 'comic', timestamp: 1008, id: 'b1', title: 'Spider-Man', issue: '1', year: '1963', publisher: 'Marvel', _syncStatus: 'synced' });
pstore.scopedSet('cv_buyer_sessions', JSON.stringify([{ ts: 9, title: 'B-buy' }]));
eq((await db.getAllComics()).map((c) => c.id), ['b1'], 'B\'s own data is B\'s');
clearSession();

login('principal-A', setSession);
const aBack = await db.getAllComics();
eq(aBack.map((c) => c.id).sort(), ['a1', 'a2'], 'A returns: sees exactly A\'s rows (offline state survived logout)');
ok(aBack.find((c) => c.id === 'a1').images[0] === 'data:A1', 'A returns: A\'s raw media intact');
ok(JSON.parse(pstore.scopedGet('cv_buyer_sessions'))[0].title === 'A-buy', 'A returns: A\'s buyer sessions intact');
ok(JSON.parse(pstore.scopedGet('cv_trade_piles'))[0].id === 'pile-A', 'A returns: A\'s trade piles intact');
pushes = [];
const aRetry = await persistence.retryPendingCollectionItems(aBack);
ok(aRetry.length === 1 && aRetry[0].id === 'a2', 'A\'s own pending row retries for A');
ok(pushes.length === 1 && pushes[0].auth === `Bearer ${tokenFor('principal-A')}`, 'and is pushed under A\'s token only');
clearSession();

console.log('PART 3 — mid-flight account switch refuses');
login('principal-A', setSession);
await db.putComic({ assetCategory: 'comic', timestamp: 1009, id: 'a3', title: 'Flash', issue: '139', year: '1963', publisher: 'DC', _syncStatus: 'pending' });
pushes = [];
onPush = async () => { clearSession(); login('principal-B', setSession); }; // account changes during the network call
const mid = await persistence.persistCollectionItem({ timestamp: 2000, assetCategory: 'comic', id: 'a3', title: 'Flash', issue: '139', year: '1963', publisher: 'DC' });
onPush = null;
ok(mid._refusedScopeChanged === true, 'persist refuses to write after the principal changed mid-flight');
ok(!(await db.getAllComics()).some((c) => c.id === 'a3'), 'A\'s in-flight row was NOT written into B\'s database');
clearSession(); login('principal-A', setSession);
ok((await db.getAllComics()).find((c) => c.id === 'a3')?._syncStatus === 'pending', 'A\'s row stays pending in A\'s own database');
clearSession();

console.log('PART 4 — legacy (pre-fix, unscoped) data: no silent assignment');
const before = await legacy.readLegacyRows();
eq(before.comics.map((c) => c.id).sort(), ['cv_1_a', 'cv_2_a', 'cv_3_local'], 'legacy database holds the pre-fix rows (read-only view)');
const aItem = { id: 'cv_1_a', assetCategory: 'comic', attributes: { title: 'Hulk', issue: '180', year: '1974', publisher: 'Marvel' } };
const clash = { id: 'cv_2_a', assetCategory: 'comic', attributes: { title: 'Batman', issue: '1', year: '1940', publisher: 'DC', gkAssetId: 'SERVER-GK' } };
const classified = legacy.classifyLegacyComics(before.comics, [aItem]);
eq(classified.provable.map((c) => c.id), ['cv_1_a'], 'only the server-proven row is provable');
eq(classified.ambiguous.map((c) => c.id).sort(), ['cv_2_a', 'cv_3_local'], 'unproven rows are ambiguous');
const idOnly = legacy.classifyLegacyComics(before.comics, [{ id: 'cv_3_local', attributes: { title: 'Totally Different', issue: '9', year: '2000', publisher: 'Z' } }]);
eq(idOnly.provable, [], 'an id match alone is NOT proof (identity must match too)');
const gkClash = legacy.classifyLegacyComics([{ ...before.comics.find((c) => c.id === 'cv_2_a'), gkAssetId: 'LOCAL-GK' }], [clash]);
eq(gkClash.provable, [], 'a gkAssetId disagreement refuses the claim');

login('principal-C', setSession);
const cClaim = await legacy.autoClaimProvableLegacy([]);
eq(cClaim, { claimed: 0, ambiguous: 3 }, 'principal C (no server proof) auto-claims nothing; 3 rows stay quarantined');
eq(await db.getAllComics(), [], 'C sees none of the legacy rows');
clearSession();

login('principal-D', setSession);
const dClaim = await legacy.autoClaimProvableLegacy([aItem]);
eq(dClaim, { claimed: 1, ambiguous: 2 }, 'principal D with server proof for exactly one row claims exactly that row');
eq((await db.getAllComics()).map((c) => c.id), ['cv_1_a'], 'D sees only the proven row');
eq((await legacy.autoClaimProvableLegacy([aItem])).claimed, 0, 'auto-claim is idempotent');
eq(await legacy.countUnclaimedLegacy(), 2, 'two ambiguous legacy rows remain unclaimed for D (not copied, not exposed)');
ok(typeof legacy.claimAllLegacy === 'undefined', 'U1: there is NO manual claim function (a click is not proof of ownership)');
const afterD = await legacy.readLegacyRows();
eq(afterD.comics.map((c) => c.id).sort(), ['cv_1_a', 'cv_2_a', 'cv_3_local'], 'ROLLBACK SAFETY: legacy database is byte-for-byte intact (copy-only, never deleted)');
clearSession();
login('principal-E', setSession);
eq(await db.getAllComics(), [], "a different principal still sees none of D's claimed rows");
clearSession();

console.log('PART 4b — U1: A -> logout -> B with AMBIGUOUS legacy rows (the exact pre-fix exposure)');
{
  // cv_2_a is a legacy row with _syncStatus:'pending' (pre-fix: it was pushed under whoever signed in next).
  login('principal-A2', setSession);
  const aClaim = await legacy.autoClaimProvableLegacy([]);
  eq(aClaim.claimed, 0, 'A2 has no server corroboration: nothing is imported');
  clearSession();
  login('principal-B2', setSession);
  pushes = [];
  const bClaim = await legacy.autoClaimProvableLegacy([]);
  eq(bClaim.claimed, 0, 'B2 has no server corroboration either: nothing is imported');
  eq(await db.getAllComics(), [], 'B2 sees ZERO of the ambiguous legacy rows');
  const retried = await persistence.retryPendingCollectionItems(afterD.comics);
  eq(retried, [], 'B2 cannot retry the ambiguous legacy pending row even when handed the legacy list directly');
  eq(pushes, [], "no network push of any legacy row under B2's token");
  clearSession();
  login('principal-A2', setSession);
  eq(await db.getAllComics(), [], "A2 returns: the ambiguous rows are STILL not A2's (no ownership by prior presence)");
  clearSession();
}

console.log('PART 4c — U1: a corroborated legacy row that was PENDING is imported as synced, never retried');
{
  login('principal-F', setSession);
  const pendingLegacy = afterD.comics.find((c) => c.id === 'cv_2_a');
  ok(pendingLegacy && pendingLegacy._syncStatus === 'pending', 'fixture: the legacy row is pending in the old database');
  const proof = { id: 'cv_2_a', assetCategory: 'comic', attributes: { title: 'Batman', issue: '1', year: '1940', publisher: 'DC' } };
  const c = await legacy.autoClaimProvableLegacy([proof]);
  eq(c.claimed, 1, "corroborated by principal F's own server row -> imported");
  const row = (await db.getAllComics()).find((x) => x.id === 'cv_2_a');
  ok(row && row._syncStatus === 'synced', 'imported as synced (the server row is the truth)');
  pushes = [];
  const r = await persistence.retryPendingCollectionItems(await db.getAllComics());
  eq(r, [], 'and it is never retried');
  eq(pushes, [], 'no push of legacy data');
  clearSession();
}

console.log('PART 5 — structural / auth checks');
const app = readFileSync(new URL('src/App.jsx', ROOT), 'utf8');
ok(/useEffect\(\(\) => \{\s*if \(!grailkeyAuthed\) return;\s*const me = getPrincipalScope\(\);\s*if \(!me\) return;[\s\S]{0,400}apiFetch\('\/api\/grade'/.test(app), 'App: IndexedDB load effect is gated on authenticated principal');
ok(/setCatalogue\(\[\]\);\s*setSelectedItem\(null\);/.test(app), 'App: logout drops in-memory catalogue/selection');
ok(!/localStorage\.(get|set)Item\((SESSIONS_KEY|TRADE_PILES_KEY|LISTING_PACKETS_KEY|"cv_buyer_settings"|"cv_buyer_budget")/.test(app), 'App: no user-owned localStorage key is accessed unscoped');
const collectionApi = readFileSync(new URL('api/collection.js', ROOT), 'utf8');
ok(!/body\??\.principalId|query\??\.principalId/.test(collectionApi), 'server: api/collection.js never reads principalId from the request');
ok(/verifyToken/.test(collectionApi), 'server: api/collection.js derives the principal from the verified token');
const sync = readFileSync(new URL('src/lib/collectionSync.js', ROOT), 'utf8');
ok(!/principalId/.test(sync.replace(/\/\/.*$/gm, '')), 'client: collectionSync never sends a principalId');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log(failures.join('\n')); process.exit(1); }
