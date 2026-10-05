// tests/u1-generic-book-live.test.js
//
// UNIVERSAL U1 — real client libraries + real handlers (api/capture-scan,
// api/collection, api/assets, api/grade, api/enrich, api/asset-media-append) +
// real Development Postgres. Only external providers are stubbed, and every
// provider call is COUNTED.
//
// Proves: Book mints as Book; Comic/Book/Generic category continuity through a
// refresh; Photo -> unsupported -> explicit SAVE AS GENERIC with ZERO paid calls
// after the one classification attempt; the GK-266-correct Generic ordering;
// Generic canonical Collection projection, media, Inventory Authority and basic
// management; category immutability; missing/unsupported category refused (never
// comic by absence); A->B->A principal isolation through the NEW Generic surface;
// a mid-flight account switch fails closed.
//
// Cleanup follows the Development convention (gk265/266/cert): tagged
// collection_item/link rows are deleted; append-only gk_asset/gk_principal rows
// remain as permanent Development fixtures.
//
// Invoke: node tests/u1-generic-book-live.test.js

import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const envRaw = readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8');
for (const line of envRaw.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}
process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'development';
if (!process.env.GRAILKEY_SESSION_SECRET) process.env.GRAILKEY_SESSION_SECRET = randomBytes(32).toString('base64url');
process.env.EBAY_APP_ID = process.env.EBAY_APP_ID || 'test-app-id';
process.env.EBAY_CERT_ID = process.env.EBAY_CERT_ID || 'test-cert-id';
process.env.PRICECHARTING_TOKEN = process.env.PRICECHARTING_TOKEN || 'test-pc-token';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-ant-test-not-real';
delete process.env.KV_REST_API_URL; delete process.env.KV_REST_API_TOKEN; delete process.env.UPSTASH_REDIS_REST_URL;

let passed = 0;
let failed = 0;
const failures = [];
const ok = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; failures.push(label); console.log(`  ✗ ${label}`); }
};

// ── browser shims ──
const lsMap = new Map();
globalThis.localStorage = {
  getItem: (k) => (lsMap.has(k) ? lsMap.get(k) : null),
  setItem: (k, v) => { lsMap.set(k, String(v)); },
  removeItem: (k) => { lsMap.delete(k); },
};
globalThis.window = new EventTarget();

const mintToken = (principalId) => {
  const now = Date.now();
  const payload = { principalId, iat: now, exp: now + 12 * 3600_000, epoch: process.env.GRAILKEY_SESSION_EPOCH || '1' };
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${b64}.${createHmac('sha256', process.env.GRAILKEY_SESSION_SECRET).update(b64).digest('base64url')}`;
};

// ── network: relative /api/* -> real handlers; everything else is a counted provider stub ──
const providerCalls = []; // { host, url }
let routedPaths = [];
let afterRoute = null; // optional hook(path) awaited after a handler ran (to simulate an account switch)
const ROUTES = {};
const UNSUPPORTED_SCAN_JSON = JSON.stringify({
  title: 'Vintage brass compass', publisher: null, year: null, issue: null, grade: null,
  confidence: 'low', assetTypeConfident: false, reason: 'a handheld navigation instrument, not a comic', isGraded: false,
});
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(String(url), 'http://local.test');
  if (u.host === 'local.test') {
    const handler = ROUTES[u.pathname];
    if (!handler) throw new Error(`unrouted /api fetch in test: ${u.pathname}`);
    const headers = {};
    for (const [k, v] of Object.entries(opts.headers || {})) headers[k.toLowerCase()] = v;
    headers['x-forwarded-for'] = `10.8.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
    const req = { method: opts.method || 'GET', headers, query: Object.fromEntries(u.searchParams.entries()), body: opts.body ? JSON.parse(opts.body) : undefined };
    const res = { statusCode: 200, headers: {}, body: undefined };
    res.setHeader = (k, v) => { res.headers[k] = v; };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    res.end = () => res;
    await handler(req, res);
    routedPaths.push(u.pathname);
    if (afterRoute) await afterRoute(u.pathname);
    return { ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json: async () => res.body };
  }
  providerCalls.push({ host: u.host, url: String(url) });
  const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
  if (u.host.includes('anthropic.com')) {
    return json({ id: 'msg_t', type: 'message', role: 'assistant', model: 'claude-sonnet-4-5-20250929', content: [{ type: 'text', text: UNSUPPORTED_SCAN_JSON }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } });
  }
  if (String(url).includes('oauth2/token') || String(url).includes('/oauth/')) return json({ access_token: 'x', expires_in: 7200, token_type: 'Application Access Token' });
  if (String(url).includes('search_by_image') || String(url).includes('item_summary/search')) return json({ itemSummaries: [], total: 0 });
  if (String(url).includes('pricecharting.com')) return json({ products: [] });
  return json({});
};

const importHandler = async (rel) => (await import(pathToFileURL(path.join(repoRoot, rel)).href)).default;
ROUTES['/api/capture-scan'] = await importHandler('api/capture-scan.js');
ROUTES['/api/collection'] = await importHandler('api/collection.js');
ROUTES['/api/assets'] = await importHandler('api/assets.js');
ROUTES['/api/asset-media-append'] = await importHandler('api/asset-media-append.js');
ROUTES['/api/grade'] = await importHandler('api/grade.js');
ROUTES['/api/enrich'] = await importHandler('api/enrich.js');

const session = await import(new URL('../src/lib/grailkeySession.js', import.meta.url).href);
const db = await import(new URL('../src/db.js', import.meta.url).href);
const generic = await import(new URL('../src/lib/genericAssetCapture.js', import.meta.url).href);
const manage = await import(new URL('../src/lib/genericAssetManage.js', import.meta.url).href);
const persistence = await import(new URL('../src/lib/collectionPersistence.js', import.meta.url).href);
const legacy = await import(new URL('../src/lib/legacyLocalClaim.js', import.meta.url).href);
const spend = await import(new URL('../src/lib/spendGuard.js', import.meta.url).href);
const rs = await import(new URL('../src/lib/researchStore.js', import.meta.url).href);

const login = (p) => session.setSession(mintToken(p), Date.now() + 12 * 3600_000);
const logout = () => session.clearSession();
const bearer = (p) => ({ Authorization: `Bearer ${mintToken(p)}` });
const jsonHeaders = (p) => ({ ...bearer(p), 'Content-Type': 'application/json' });

const client = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query('SET search_path TO data1_dev');

const TAG = `u1-${Date.now()}`;
const mkPrincipal = async (label) => {
  const id = randomUUID();
  await client.query(`INSERT INTO gk_principal (id, display_name, kind) VALUES ($1, $2, 'user')`, [id, `${TAG}-${label}`]);
  return id;
};
const PA = await mkPrincipal('a');
const PB = await mkPrincipal('b');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const PNG2 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR42mNk+M9Qz0AEYBxVSF+FABJADq0IcjtQAAAAAElFTkSuQmCC';
const createdIds = [];
const row = async (sql, params) => (await client.query(sql, params)).rows;
const assetOf = async (itemId) => (await row('SELECT a.id, a.asset_class FROM collection_item_link l JOIN gk_asset a ON a.id = l.gk_asset_id WHERE l.collection_item_id = $1', [itemId]))[0] || null;
const itemOf = async (id, principal) => (await row('SELECT asset_category, attributes FROM collection_item WHERE id = $1 AND principal_id = $2', [id, principal]))[0] || null;

const stripPrefix = (d) => d.slice(d.indexOf(',') + 1);
const post = async (p, body, who) => {
  const r = await fetch(p, { method: 'POST', headers: jsonHeaders(who), body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
// The owned-capture path the operator button uses: sync the item, then capture with ITS OWN category.
async function captureOwned(who, { category, title, issue = null, year = null }) {
  const id = `${TAG}-${randomUUID().slice(0, 8)}`;
  createdIds.push(id);
  const entry = { id, timestamp: Date.now(), assetCategory: category, title, issue, year, images: [PNG] };
  await db.putComic(entry);
  const synced = await persistence.persistCollectionItem(entry);
  const key = randomUUID();
  const cap = await post('/api/capture-scan', {
    scanPayload: { correlationId: key, collectionItemId: id, book: { title, issue, year }, outcome: { decisionAction: null, pricingSource: null, price: null, gradeMultiplier: null } },
    photos: [{ bytes: stripPrefix(PNG), contentType: 'image/png', captureRole: 'capture-photo' }],
    idempotencyKey: key, assetClass: category,
  }, who);
  return { id, key, synced, cap };
}

console.log('=== UNIVERSAL U1 — Generic/Book/category truth (real client + real handlers + real Development DB) ===\n');
try {
  login(PA);

  console.log('1. BOOK mints as BOOK');
  const book = await captureOwned(PA, { category: 'book', title: 'The Rationalists' });
  ok(book.synced._syncStatus === 'synced', 'book item synced to the server Collection');
  ok(book.cap.status === 200 && !!book.cap.body.gkAssetId, `book capture succeeded (HTTP ${book.cap.status}${book.cap.status === 200 ? '' : ' ' + JSON.stringify(book.cap.body).slice(0, 140)})`);
  const bookAsset = await assetOf(book.id);
  ok(bookAsset && bookAsset.asset_class === 'book', `gk_asset.asset_class = book (got ${bookAsset?.asset_class})`);
  ok((await itemOf(book.id, PA))?.asset_category === 'book', 'collection_item.asset_category = book');
  const wrong = await post('/api/capture-scan', {
    scanPayload: { correlationId: randomUUID(), collectionItemId: book.id, book: { title: 'x' } },
    photos: [{ bytes: stripPrefix(PNG), contentType: 'image/png', captureRole: 'capture-photo' }],
    idempotencyKey: randomUUID(), assetClass: 'comic',
  }, PA);
  // an already-linked item attaches; but a FRESH mint for a book-category row as comic is refused:
  const freshBookItem = `${TAG}-fb-${randomUUID().slice(0, 6)}`; createdIds.push(freshBookItem);
  await post('/api/collection', { id: freshBookItem, assetCategory: 'book', attributes: { title: 'Another Book' } }, PA);
  const mismatch = await post('/api/capture-scan', {
    scanPayload: { correlationId: randomUUID(), collectionItemId: freshBookItem, book: { title: 'Another Book' } },
    photos: [{ bytes: stripPrefix(PNG), contentType: 'image/png', captureRole: 'capture-photo' }],
    idempotencyKey: randomUUID(), assetClass: 'comic',
  }, PA);
  ok(mismatch.status === 400 && /categories must match/.test(JSON.stringify(mismatch.body)), 'a book-category row can NOT be minted as a comic (400, categories must match)');
  ok((await assetOf(freshBookItem)) === null, 'and no asset was minted for it');
  void wrong;

  console.log('\n2. COMIC / BOOK / GENERIC continuity through an owned refresh');
  const comic = await captureOwned(PA, { category: 'comic', title: 'Amazing Fantasy', issue: '15', year: '1962' });
  ok(comic.cap.status === 200 && (await assetOf(comic.id))?.asset_class === 'comic', 'comic mints as comic');
  const gen = await generic.createGenericCaptureDraft({ photoDataUrl: PNG, name: 'Brass compass', description: 'old', acquisitionCost: 12 });
  createdIds.push(gen.id);
  const refreshOf = async (id, extra = {}) => post('/api/enrich', { collectionItemId: id, ownedRefresh: true, skipVision: true, skipImageSearch: true, title: 'x', ...extra }, PA);
  const rBook = await refreshOf(book.id, { title: 'The Rationalists' });
  ok(rBook.status === 200 && rBook.body.assetType === 'book', `book refresh -> still book (got ${rBook.body.assetType})`);
  ok(rBook.body.refusedToPrice === true, 'book valuation stays REFUSED (no Book economics added)');
  ok((await itemOf(book.id, PA))?.asset_category === 'book', 'the stored category is still book after the refresh');
  const rComic = await refreshOf(comic.id, { title: 'Amazing Fantasy', issue: '15', year: '1962' });
  ok(rComic.status === 200 && rComic.body.assetType === 'comic', `comic refresh -> still comic (got ${rComic.body.assetType})`);
  ok((await itemOf(comic.id, PA))?.asset_category === 'comic', 'the stored category is still comic after the refresh');
  // an owned refresh that CLAIMS a different category cannot change the stored one
  const lie = await refreshOf(book.id, { title: 'The Rationalists', assetType: 'comic' });
  ok(lie.body.assetType === 'book', 'an owned refresh claiming "comic" is pinned back to the durable category (book)');
  ok((await itemOf(book.id, PA))?.asset_category === 'book', 'the stored category did not move');
  // a request with NO category at all is never comic by absence
  const bare = await post('/api/enrich', { title: 'Something', issue: '1', skipVision: true, skipImageSearch: true }, PA);
  ok(bare.status === 200 && bare.body.assetType !== 'comic' && bare.body.refusedToPrice === true, `an enrich request with no assetType is NOT treated as comic and is refused pricing (assetType=${JSON.stringify(bare.body.assetType)})`);

  console.log('\n3. missing / unsupported category is refused — never comic by absence');
  const noCat = `${TAG}-nocat`; createdIds.push(noCat);
  const rNo = await post('/api/collection', { id: noCat, attributes: { title: 'No category' } }, PA);
  ok(rNo.status === 400 && rNo.body.error === 'ASSET_CATEGORY_REQUIRED', 'POST /api/collection without assetCategory -> 400 ASSET_CATEGORY_REQUIRED');
  ok((await itemOf(noCat, PA)) === null, '...and NO row (not even a "comic" one) was written');
  const rBad = await post('/api/collection', { id: noCat, assetCategory: 'merchandise', attributes: { title: 'x' } }, PA);
  ok(rBad.status === 400 && (await itemOf(noCat, PA)) === null, 'an unsupported category is refused too');
  const capNo = await post('/api/capture-scan', {
    scanPayload: { correlationId: randomUUID(), collectionItemId: comic.id },
    photos: [{ bytes: stripPrefix(PNG), contentType: 'image/png', captureRole: 'capture-photo' }], idempotencyKey: randomUUID(),
  }, PA);
  ok(capNo.status === 400 && /assetClass is required/.test(JSON.stringify(capNo.body)), 'POST /api/capture-scan without assetClass -> 400 (no default)');
  const flip = await post('/api/collection', { id: comic.id, assetCategory: 'generic', attributes: { title: 'Amazing Fantasy' } }, PA);
  ok(flip.status === 409 && flip.body.error === 'ASSET_CATEGORY_IMMUTABLE', 'POST that tries to change an existing comic to generic -> 409 ASSET_CATEGORY_IMMUTABLE');
  ok((await itemOf(comic.id, PA))?.asset_category === 'comic', 'the established category is untouched');
  const put = await fetch(`/api/collection?id=${encodeURIComponent(book.id)}`, { method: 'PUT', headers: jsonHeaders(PA), body: JSON.stringify({ assetCategory: 'comic', attributes: { title: 'The Rationalists' } }) });
  ok(put.status === 409, 'PUT that tries to change an existing book to comic -> 409');
  ok((await itemOf(book.id, PA))?.asset_category === 'book', 'the book is still a book');

  console.log('\n4. PHOTO -> unsupported -> explicit SAVE AS GENERIC (one paid classification attempt, zero more)');
  rs.setResearchStoreForTests(null);
  providerCalls.length = 0; routedPaths = [];
  // A real, decodable image (the resize step rejects an undecodable one before any provider call).
  const Jimp = (await import('jimp')).default;
  const jimg = new Jimp(96, 96, 0x888888ff);
  const realJpeg = 'data:image/jpeg;base64,' + (await jimg.getBufferAsync(Jimp.MIME_JPEG)).toString('base64');
  const scan = await post('/api/grade', { images: [realJpeg], scanId: randomUUID() }, PA);
  ok(scan.status === 200, `the one classification attempt answered (HTTP ${scan.status}${scan.status === 200 ? '' : ' ' + JSON.stringify(scan.body).slice(0, 160)})`);
  ok(scan.body.assetType === 'unsupported', `the classifier result is UNSUPPORTED, not comic (got ${JSON.stringify(scan.body.assetType)})`);
  // /v1/messages is the classification call; /v1/messages/count_tokens is the pre-existing cost-audit probe (GK-33), not a classification.
  const anthropicUrls = providerCalls.filter((c) => c.host.includes('anthropic.com')).map((c) => new URL(c.url).pathname);
  const classifications = anthropicUrls.filter((p) => p === '/v1/messages').length;
  ok(classifications === 1, `exactly ONE paid classification (model) call was made for the scan (${classifications}; anthropic paths: ${anthropicUrls.join(', ')})`);
  const scanDraft = await generic.createGenericCaptureDraft({ photoDataUrl: PNG, name: '', description: '', acquisitionCost: null }); // the operator explicitly chose SAVE AS GENERIC (no name)
  createdIds.push(scanDraft.id);
  const providerBefore = providerCalls.length; routedPaths = [];
  const unitsBefore = (await spend.reserveSpend({ principalId: PA, endpoint: 'chat' })).principalUsed;
  const saved = await generic.submitGenericCapture(scanDraft);
  ok(saved.ok === true && !!saved.gkAssetId, `SAVE AS GENERIC minted a durable asset (${saved.ok ? 'ok' : JSON.stringify(saved)})`);
  ok(providerCalls.length === providerBefore, `ZERO additional provider calls from the Generic mint (${providerCalls.length - providerBefore})`);
  ok(!routedPaths.includes('/api/grade') && !routedPaths.includes('/api/enrich'), 'the Generic mint never re-ran /api/grade or /api/enrich (no second classification)');
  ok(routedPaths.join(',') === '/api/collection,/api/capture-scan,/api/collection', `GK-266-correct order: Collection row FIRST, then physical mint, then record the id (${routedPaths.join(' -> ')})`);
  const unitsAfter = (await spend.reserveSpend({ principalId: PA, endpoint: 'chat' })).principalUsed;
  ok(unitsAfter - unitsBefore === 1, 'and the mint charged no paid-provider spend units (only the probe\'s own 1)');

  console.log('\n5. Generic canonical projection, media, inventory');
  const gAsset = await assetOf(scanDraft.id);
  ok(gAsset && gAsset.asset_class === 'generic', `gk_asset.asset_class = generic (got ${gAsset?.asset_class})`);
  const gItem = await itemOf(scanDraft.id, PA);
  ok(gItem && gItem.asset_category === 'generic', 'collection_item.asset_category = generic');
  ok(gItem.attributes.title === '' , 'the unnamed asset stores NO placeholder title (identity authority is empty, not "Unidentified asset")');
  ok(gItem.attributes.gkAssetId === saved.gkAssetId, 'the Collection row records the durable gkAssetId');
  const owner = await row('SELECT owner_principal_id FROM current_owner WHERE asset_id = $1', [saved.gkAssetId]);
  ok(owner[0]?.owner_principal_id === PA, 'the authenticated principal owns it server-side');
  const media = await row('SELECT id FROM media WHERE asset_id = $1', [saved.gkAssetId]);
  ok(media.length === 1, 'the photo is a durable media row on that asset');
  const inv = await row('SELECT state FROM inventory_current_state WHERE gk_asset_id = $1', [saved.gkAssetId]);
  ok(inv[0]?.state === 'AVAILABLE', 'Inventory Authority holds it in the existing neutral AVAILABLE state (no Generic-only state)');
  const states = await row("SELECT DISTINCT state FROM inventory_current_state WHERE state NOT IN ('AVAILABLE','RESERVED','SOLD')");
  ok(states.length === 0, 'no Generic-only inventory state exists anywhere');
  const label = generic.genericDisplayLabel({ id: scanDraft.id, timestamp: scanDraft.createdAt, title: '' });
  ok(/^Unidentified asset · [A-Z][a-z]{2} \d{1,2} · #[A-Z0-9]{4}$/.test(label), `the unnamed asset gets a presentation-only label (${label})`);
  const other = generic.genericDisplayLabel({ id: 'zzzz-other-id-9999', timestamp: scanDraft.createdAt, title: '' });
  ok(label !== other, 'two unnamed assets on the same day get DIFFERENT labels');
  ok(generic.genericDisplayLabel({ id: 'x', title: 'Brass lamp' }) === 'Brass lamp', 'a named asset shows its real name');
  const viaApi = await (await fetch(`/api/assets?gkAssetId=${saved.gkAssetId}`, { headers: bearer(PA) })).json();
  ok(viaApi.inventoryState === 'AVAILABLE', 'GET /api/assets exposes the inventory state');
  const gCopy = await post('/api/collection', { id: `${TAG}-g2`, assetCategory: 'generic', attributes: { title: '' } }, PA);
  createdIds.push(`${TAG}-g2`);
  ok(gCopy.status === 200, 'a second unnamed Generic is NOT blocked as a duplicate of the first (no physical-copy prompt for Generic)');

  const namedSaved = await generic.submitGenericCapture(gen); // named, with an acquisition cost of $12
  ok(namedSaved.ok === true, 'a NAMED Generic with an acquisition cost also saves');
  const acq = await row('SELECT cost_amount FROM acquisition_event WHERE asset_id = $1', [namedSaved.gkAssetId]);
  ok(acq.length === 1 && Number(acq[0].cost_amount) === 12, 'the acquisition basis supplied by the operator is a durable acquisition_event');
  ok((await itemOf(gen.id, PA)).attributes.title === 'Brass compass', 'and the operator-supplied name is stored as the title');

  console.log('\n6. Generic basic management (name/notes, extra photo, persistence)');
  let cur = (await db.getAllComics()).find((c) => c.id === scanDraft.id);
  ok(!!cur && cur.assetCategory === 'generic' && cur.gkAssetId === saved.gkAssetId, 'the local record carries category + gkAssetId');
  const renamed = await manage.updateGenericFields(cur, { name: 'Brass compass (WWII)', description: 'Found at an estate sale' });
  ok(renamed._syncStatus === 'synced', 'name/notes edit synced to the server');
  const afterEdit = await itemOf(scanDraft.id, PA);
  ok(afterEdit.attributes.title === 'Brass compass (WWII)' && afterEdit.attributes.description === 'Found at an estate sale' && afterEdit.asset_category === 'generic', 'the server row holds the edited name + notes and is still generic');
  const added = await manage.addGenericPhoto(renamed, PNG2);
  ok(added.kernel === 'appended', `an additional photo became a durable kernel media row (${added.kernel})`);
  ok((await row('SELECT id FROM media WHERE asset_id = $1', [saved.gkAssetId])).length === 2, 'the asset now has 2 media rows');
  const remote = (await itemOf(scanDraft.id, PA)).attributes.remoteImages;
  ok(Array.isArray(remote) && remote.length === 2, 'the Collection projection carries both photos');
  ok((await manage.fetchGenericInventoryState(saved.gkAssetId)) === 'AVAILABLE', 'the detail view can read its inventory state');
  logout();
  login(PA);
  const restored = (await db.getAllComics()).find((c) => c.id === scanDraft.id);
  ok(restored && restored.title === 'Brass compass (WWII)' && restored.images.length === 2, 'logout/relogin: the managed Generic asset is intact for its owner');
  const refGeneric = await refreshOf(scanDraft.id, { title: 'Brass compass (WWII)' });
  ok(refGeneric.body.assetType === 'generic' && refGeneric.body.refusedToPrice === true, 'Generic stays Generic through an owned refresh (never priced, never comic)');

  console.log('\n7. principal isolation through the NEW Generic surface (A -> B -> A)');
  const aItemCount = (await db.getAllComics()).length;
  logout();
  // ambiguous pre-fix legacy row on this "device"
  await new Promise((resolve, reject) => {
    const req = indexedDB.open('comic-vault', 4);
    req.onupgradeneeded = () => { const d = req.result; if (!d.objectStoreNames.contains('comics')) d.createObjectStore('comics', { keyPath: 'id' }).createIndex('timestamp', 'timestamp'); };
    req.onsuccess = () => { const tx = req.result.transaction('comics', 'readwrite'); tx.objectStore('comics').put({ id: 'cv_legacy_ambiguous', timestamp: 1, title: 'Legacy', _syncStatus: 'pending', images: [PNG] }); tx.oncomplete = () => { req.result.close(); resolve(); }; tx.onerror = () => reject(tx.error); };
    req.onerror = () => reject(req.error);
  });
  login(PB);
  ok((await db.getAllComics()).length === 0, 'B sees ZERO of A\'s asset rows');
  ok(!JSON.stringify(await db.getAllComics()).includes('data:image'), 'B sees zero of A\'s media');
  ok((await generic.listGenericCaptureDrafts()).length === 0, 'B sees zero of A\'s drafts');
  ok((await legacy.autoClaimProvableLegacy([])).claimed === 0 && (await db.getAllComics()).length === 0, 'B cannot import the ambiguous legacy row');
  routedPaths = [];
  ok((await persistence.retryPendingCollectionItems([{ id: 'cv_legacy_ambiguous', _syncStatus: 'pending' }, ...(await db.getAllComics())])).length === 0 && routedPaths.length === 0, 'B cannot retry any pending/legacy A data (no request made)');
  const bDraft = await generic.createGenericCaptureDraft({ photoDataUrl: PNG, name: 'B sneaker', description: '', acquisitionCost: null });
  createdIds.push(bDraft.id);
  const bSaved = await generic.submitGenericCapture(bDraft);
  ok(bSaved.ok === true, 'B captures their OWN Generic');
  const bOwner = await row('SELECT owner_principal_id FROM current_owner WHERE asset_id = $1', [bSaved.gkAssetId]);
  ok(bOwner[0]?.owner_principal_id === PB, 'server owner = B');
  ok((await db.getAllComics()).length === 1, 'B\'s local scope holds only B\'s asset');
  const bSeesA = await fetch(`/api/assets?gkAssetId=${saved.gkAssetId}`, { headers: bearer(PB) });
  ok(bSeesA.status === 404, 'B cannot read A\'s asset on the server');
  logout();
  login(PA);
  const aAgain = await db.getAllComics();
  ok(aAgain.length === aItemCount && aAgain.some((c) => c.id === scanDraft.id) && !aAgain.some((c) => c.id === bDraft.id), 'A returns and sees A (and not B)');
  const aSeesB = await fetch(`/api/assets?gkAssetId=${bSaved.gkAssetId}`, { headers: bearer(PA) });
  ok(aSeesB.status === 404, 'A cannot read B\'s asset');

  console.log('\n8. an account switch DURING an async Generic save fails closed');
  const midDraft = await generic.createGenericCaptureDraft({ photoDataUrl: PNG, name: 'mid-flight', description: '', acquisitionCost: null });
  createdIds.push(midDraft.id);
  afterRoute = async (p) => { if (p === '/api/capture-scan') { logout(); login(PB); afterRoute = null; } };
  const mid = await generic.submitGenericCapture(midDraft);
  ok(mid.ok === false && mid.scopeChanged === true, 'the save refuses once the account changed (scopeChanged)');
  ok((await db.getAllComics()).every((c) => c.id !== midDraft.id), 'NOTHING was written into B\'s local scope');
  ok((await row('SELECT 1 FROM collection_item WHERE id = $1 AND principal_id = $2', [midDraft.id, PB])).length === 0, 'and nothing under B on the server');
  const midAsset = await assetOf(midDraft.id);
  ok(midAsset && (await row('SELECT owner_principal_id FROM current_owner WHERE asset_id = $1', [midAsset.id]))[0].owner_principal_id === PA, 'the asset that WAS minted is owned by A (never re-attributed to B)');
  logout();
  login(PA);
  ok((await generic.listGenericCaptureDrafts()).some((d) => d.id === midDraft.id), 'A\'s draft is preserved in A\'s own scope for an idempotent retry');
  const retry = await generic.submitGenericCapture((await generic.listGenericCaptureDrafts()).find((d) => d.id === midDraft.id));
  ok(retry.ok === true && retry.gkAssetId === midAsset.id, 'A\'s retry completes against the SAME asset (no duplicate mint)');
  ok((await row('SELECT count(*)::int AS n FROM collection_item_link WHERE collection_item_id = $1', [midDraft.id]))[0].n === 1, 'exactly one link exists');
  logout();
} finally {
  for (const id of createdIds) {
    await client.query('DELETE FROM collection_item_link WHERE collection_item_id = $1', [id]).catch(() => {});
    await client.query('DELETE FROM collection_item WHERE id = $1', [id]).catch(() => {});
  }
  console.log(`\n  (cleanup) ${TAG}-tagged collection rows removed; gk_asset/gk_principal rows kept as permanent Development fixtures (repo convention).`);
  await client.end();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log(failures.join('\n')); }
process.exit(failed ? 1 : 0);
