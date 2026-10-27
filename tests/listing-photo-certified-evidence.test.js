// tests/listing-photo-certified-evidence.test.js
//
// Outgoing eBay listing photo repair (Old Man Logan #25, 2026-10-16). The listing click used to send CATALOGUE photos, whose
// bytes are not durable media rows (and which are links on a server-only device), so the publication guard (correctly)
// refused every attempt. The listing now sends the asset's own FRONT evidence bytes, retrieved through the existing
// authenticated media pathway and hash-verified before leaving the device. The server guard is exercised REAL and UNCHANGED.
//
// Invoke: node tests/listing-photo-certified-evidence.test.js

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (rel) => import(pathToFileURL(path.join(root, rel)).href);
const { selectFrontEvidenceMedia, fetchCertifiedListingPhoto, LISTING_PHOTO_ERRORS, MAX_LISTING_PHOTO_BYTES } = await imp('src/lib/listingPhotoSelection.js');
const { assertSourceImages, assertPublishPhotos, PhotoGuardError } = await imp('src/lib/listingPhotoGuard.js');
const app = readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8');
const guardSrc = readFileSync(path.join(root, 'src', 'lib', 'listingPhotoGuard.js'), 'utf8');

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };
const sha = (b) => createHash('sha256').update(b).digest('hex');
const sha256Hex = async (b) => sha(Buffer.from(b));

// A real, magic-byte-valid JPEG body (the server guard checks the declared format's magic bytes).
const jpeg = (seed) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`front-${seed}`.repeat(20)), Buffer.from([0xff, 0xd9])]);
const FRONT = jpeg('A'), BACK = jpeg('B'), CAPTURE = jpeg('C'), OTHER_ASSET = jpeg('Z'), CATALOGUE = jpeg('catalogue-display');
const ASSET = 'asset-1';
const row = (id, view, buf, extra = {}) => ({ id, asset_id: ASSET, capture_view: view, content_type: 'image/jpeg', content_hash: sha(buf), recorded_at: '2026-10-15T22:45:23Z', ...extra });
const graph = { asset: { id: ASSET }, media: [row('m-cap', null, CAPTURE, { recorded_at: '2026-09-19T00:00:00Z' }), row('m-front', 'FRONT', FRONT), row('m-back', 'BACK', BACK)] };
const mkRes = (status, type, buf) => ({ ok: status >= 200 && status < 300, status, headers: { get: (k) => (k.toLowerCase() === 'content-type' ? type : null) }, arrayBuffer: async () => { const b = buf || Buffer.alloc(0); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); } });

console.log('\n=== Listing photo: certified FRONT evidence ===\n--- selection ---');
const sel = selectFrontEvidenceMedia(graph);
ok(sel.ok && sel.row.id === 'm-front', 'picks the asset\'s FRONT evidence row (not BACK, not the unlabeled original capture)');
ok(selectFrontEvidenceMedia({ asset: { id: ASSET }, media: [row('m-back', 'BACK', BACK), row('m-cap', null, CAPTURE)] }).code === LISTING_PHOTO_ERRORS.NO_FRONT_EVIDENCE, 'no FRONT row: explicit NO_FRONT_EVIDENCE (BACK/unlabeled are never promoted to the cover)');
ok(selectFrontEvidenceMedia({ asset: { id: ASSET }, media: [row('x', 'FRONT', OTHER_ASSET, { asset_id: 'asset-2' })] }).code === LISTING_PHOTO_ERRORS.NO_FRONT_EVIDENCE, 'a FRONT row belonging to ANOTHER asset is never selected (cross-asset)');
ok(selectFrontEvidenceMedia({ asset: { id: ASSET }, media: [row('x', 'FRONT', FRONT, { content_type: 'application/pdf' })] }).ok === false, 'a non-image FRONT row is not selected');
ok(selectFrontEvidenceMedia({ asset: { id: ASSET }, media: [row('x', 'FRONT', FRONT, { content_hash: 'nothex' })] }).ok === false, 'a FRONT row without a valid recorded hash is not selected');
ok(selectFrontEvidenceMedia({ media: [row('x', 'FRONT', FRONT)] }).ok === false && selectFrontEvidenceMedia(null).ok === false, 'no graph / no asset id: fail closed');
const two = selectFrontEvidenceMedia({ asset: { id: ASSET }, media: [row('f-old', 'FRONT', FRONT, { recorded_at: '2026-10-01T00:00:00Z' }), row('f-new', 'FRONT', jpeg('N'), { recorded_at: '2026-10-09T00:00:00Z' })] });
ok(two.ok && two.row.id === 'f-new', 'several FRONT rows: the newest is chosen deterministically');

console.log('--- retrieval (existing authenticated media route) ---');
const calls = [];
const good = await fetchCertifiedListingPhoto({ row: sel.row, sha256Hex, fetchMedia: async (id) => { calls.push(id); return mkRes(200, 'image/jpeg', FRONT); } });
ok(good.ok && good.images.length === 1 && good.images[0] === `data:image/jpeg;base64,${FRONT.toString('base64')}`, 'matching bytes: the exact stored bytes become the outgoing data URL');
ok(calls.length === 1 && calls[0] === 'm-front', 'only the selected media id is requested (a single read; no listing, no write)');
const bad = await fetchCertifiedListingPhoto({ row: sel.row, sha256Hex, fetchMedia: async () => mkRes(200, 'image/jpeg', OTHER_ASSET) });
ok(!bad.ok && bad.code === LISTING_PHOTO_ERRORS.HASH_MISMATCH && !bad.images, 'MISMATCHING bytes (wrong/altered/other asset): HASH_MISMATCH, nothing sent');
for (const status of [401, 403, 404]) {
  const r = await fetchCertifiedListingPhoto({ row: sel.row, sha256Hex, fetchMedia: async () => mkRes(status) });
  ok(!r.ok && r.code === LISTING_PHOTO_ERRORS.MEDIA_UNAUTHORIZED, `UNAUTHORIZED / missing media (${status}): explicit MEDIA_UNAUTHORIZED, nothing sent`);
}
ok((await fetchCertifiedListingPhoto({ row: sel.row, sha256Hex, fetchMedia: async () => mkRes(500) })).code === LISTING_PHOTO_ERRORS.MEDIA_NETWORK, 'server error: explicit MEDIA_NETWORK');
ok((await fetchCertifiedListingPhoto({ row: sel.row, sha256Hex, fetchMedia: async () => { throw new Error('offline'); } })).code === LISTING_PHOTO_ERRORS.MEDIA_NETWORK, 'offline: explicit MEDIA_NETWORK');
ok((await fetchCertifiedListingPhoto({ row: sel.row, sha256Hex, fetchMedia: async () => mkRes(200, 'text/html', FRONT) })).code === LISTING_PHOTO_ERRORS.NOT_AN_IMAGE, 'a non-image response is refused');
ok((await fetchCertifiedListingPhoto({ row: sel.row, sha256Hex, fetchMedia: async () => mkRes(200, 'image/jpeg', Buffer.alloc(0)) })).code === LISTING_PHOTO_ERRORS.NOT_AN_IMAGE, 'an empty body is refused');
const big = Buffer.alloc(MAX_LISTING_PHOTO_BYTES + 1, 7);
ok((await fetchCertifiedListingPhoto({ row: { ...sel.row, content_hash: sha(big) }, sha256Hex, fetchMedia: async () => mkRes(200, 'image/jpeg', big) })).code === LISTING_PHOTO_ERRORS.TOO_LARGE, 'an oversize photo is refused before it can exceed the listing request limit');

console.log('--- the UNCHANGED server photo guard accepts exactly what this produces ---');
const assetHashes = graph.media.map((m) => m.content_hash);
let passedGuard = null;
try { passedGuard = assertSourceImages({ images: good.images, assetMediaHashes: assetHashes }); } catch (e) { passedGuard = e; }
ok(Array.isArray(passedGuard) && passedGuard[0].sha256 === sha(FRONT), 'assertSourceImages (real) accepts the FRONT bytes: sha256 is a media row of this asset');
let lastMile = null;
try { await assertPublishPhotos({ sourceImages: [{ bytes: passedGuard[0].bytes, url: 'https://i.ebayimg.com/images/g/x/s-l1600.jpg' }], assetMediaHashes: assetHashes, fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => 'image/jpeg' } }) }); lastMile = 'passed'; } catch (e) { lastMile = e; }
ok(lastMile === 'passed', 'assertPublishPhotos (real, last-mile) accepts the same bytes after upload');
let rejected = null;
try { assertSourceImages({ images: [`data:image/jpeg;base64,${CATALOGUE.toString('base64')}`], assetMediaHashes: assetHashes }); } catch (e) { rejected = e; }
ok(rejected instanceof PhotoGuardError && rejected.reason === 'media-not-for-this-asset', 'the guard still REFUSES a catalogue photo whose bytes are not a durable media row (not weakened)');
let urlRejected = null;
try { assertSourceImages({ images: ['/api/collection-image-v2?p=P&id=cv&i=0'], assetMediaHashes: assetHashes }); } catch (e) { urlRejected = e; }
ok(urlRejected instanceof PhotoGuardError && urlRejected.reason === 'source-not-an-image-data-url', 'the guard still REFUSES a URL in place of image bytes (server-only device)');
ok(/media-not-for-this-asset/.test(guardSrc) && /source-not-an-image-data-url/.test(guardSrc), 'the guard source still contains both refusals');

console.log('--- wiring (App.jsx listOnEbay) ---');
const start = app.indexOf('const listOnEbay = useCallback');
const end = app.indexOf('apiFetch("/api/list-ebay"', start);
const body = start > 0 && end > start ? app.slice(start, end) : '';
ok(body.length > 1000, 'listOnEbay located');
// V1.1a Phase 2: bytes no longer travel from the device. The listing declares the approved package's ordered content hashes and the
// server resolves each photograph from the owner-authorized media row (tests/v11a-server-photo-resolution.test.js proves that path).
ok(/approvedPhotoHashes\s*=\s*Array\.isArray\(item\.listingApprovalPhotoHashes\)/.test(body), 'the listing declares the approved package ordered content hashes');
ok(!/authFetch\(`\/api\/asset-media/.test(body) && !/fetchCertifiedListingPhoto\(/.test(body), 'the client no longer retrieves or sends photo bytes');
ok(!/asset-media-append|capture-scan|putComic\(|createPhysicalAsset/.test(body), 'no media is created or written by the listing path (no duplicate media)');
ok(/approvedPhotoHashes,/.test(app.slice(end, end + 4000)) && !/image:\s*coverPhoto/.test(app.slice(end, end + 4000)), 'the request carries the hashes, not image/images');

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed ? 1 : 0);
