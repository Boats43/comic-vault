// tests/v11a-server-photo-resolution.test.js -- V1.1a Phase 2: pure proof of resolveApprovedSourcePhotos (src/lib/listingPhotoGuard.js).
// The client declares ONLY ordered content hashes; the server loads the stored bytes itself. DB-free, network-free.
//
// Invoke: node tests/v11a-server-photo-resolution.test.js

import { createHash } from 'node:crypto';
import { resolveApprovedSourcePhotos, PhotoGuardError } from '../src/lib/listingPhotoGuard.js';

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  PASS ${l}`); } else { failed++; console.log(`  FAIL ${l}`); } };
const sha = (b) => createHash('sha256').update(b).digest('hex');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('jpeg-ish-body')]);
const store = new Map([[sha(PNG), PNG], [sha(JPG), JPG]]);
const rows = [
  { mediaId: 'm-png', contentHash: sha(PNG), contentType: 'image/png' },
  { mediaId: 'm-jpg', contentHash: sha(JPG), contentType: 'image/jpeg' },
];
const loadBytes = async (row) => store.get(row.contentHash);
const refusal = async (args) => { try { await resolveApprovedSourcePhotos({ mediaRows: rows, loadBytes, ...args }); return null; } catch (e) { return e instanceof PhotoGuardError ? e.reason : `other:${e?.message}`; } };

console.log('\n--- accepted ---');
let r = await resolveApprovedSourcePhotos({ approvedHashes: [sha(PNG), sha(JPG)], mediaRows: rows, loadBytes });
ok(r.length === 2 && r[0].sha256 === sha(PNG) && r[1].sha256 === sha(JPG), 'resolves in the APPROVED order, bytes from the store');
ok(r[0].mimeType === 'image/png' && r[1].mimeType === 'image/jpeg' && r[0].bytes.equals(PNG), 'mime from the durable row, bytes are the stored bytes');
r = await resolveApprovedSourcePhotos({ approvedHashes: [sha(JPG), sha(PNG)], mediaRows: rows, loadBytes });
ok(r[0].sha256 === sha(JPG), 'a different declared order is preserved as declared (the handler then compares it to the approved package order)');

console.log('\n--- refused ---');
ok(await refusal({ approvedHashes: undefined }) === 'approved-hashes-missing', 'missing declaration');
ok(await refusal({ approvedHashes: [] }) === 'approved-hashes-missing', 'empty declaration');
ok(await refusal({ approvedHashes: 'abc' }) === 'approved-hashes-missing', 'non-array declaration');
ok(await refusal({ approvedHashes: ['XYZ'] }) === 'approved-hash-malformed', 'malformed hash');
ok(await refusal({ approvedHashes: [sha(PNG).toUpperCase()] }) === 'approved-hash-malformed', 'upper-case hash is not canonical');
ok(await refusal({ approvedHashes: [sha(PNG), sha(PNG)] }) === 'approved-hash-duplicate', 'duplicate hash');
ok(await refusal({ approvedHashes: Array.from({ length: 13 }, (_, i) => String(i).padStart(64, '0')) }) === 'too-many-photos', 'more than 12 photographs');
ok(await refusal({ approvedHashes: ['f'.repeat(64)] }) === 'media-not-for-this-asset', 'hash that is not a media row of this asset');
ok(await refusal({ approvedHashes: [sha(PNG), 'f'.repeat(64)] }) === 'media-not-for-this-asset', 'one owned + one foreign');
ok(await refusal({ approvedHashes: [sha(PNG)], loadBytes: async () => { throw new Error('boom'); } }) === 'stored-media-unreadable', 'storage read failure');
ok(await refusal({ approvedHashes: [sha(PNG)], loadBytes: async () => Buffer.alloc(0) }) === 'source-empty', 'empty stored object');
ok(await refusal({ approvedHashes: [sha(PNG)], loadBytes: async () => Buffer.concat([PNG, Buffer.from('x')]) }) === 'stored-bytes-hash-mismatch', 'ALTERED stored bytes (hash no longer matches)');
ok(await refusal({ approvedHashes: [sha(PNG)], loadBytes: async () => JPG }) === 'stored-bytes-hash-mismatch', 'SUBSTITUTED stored object (a different photo under this row)');
ok(await refusal({ approvedHashes: [sha(PNG)], maxBytes: 10 }) === 'source-too-large', 'oversize photograph');
const notImage = Buffer.from('definitely not a png');
ok(await refusal({ approvedHashes: [sha(notImage)], mediaRows: [{ mediaId: 'x', contentHash: sha(notImage), contentType: 'image/png' }], loadBytes: async () => notImage }) === 'source-bytes-not-the-declared-format', 'bytes that are not the declared format');
const svg = Buffer.from('<svg/>');
ok(await refusal({ approvedHashes: [sha(svg)], mediaRows: [{ mediaId: 'x', contentHash: sha(svg), contentType: 'image/svg+xml' }], loadBytes: async () => svg }) === 'source-format-unsupported', 'unsupported format');
ok(await refusal({ approvedHashes: [sha(PNG)], mediaRows: [{ mediaId: 'x', contentHash: sha(PNG), contentType: null }] }) === 'source-format-unsupported', 'row with no content type');

console.log('\n--- the handler contract (static) ---');
import { readFileSync } from 'node:fs';
const api = readFileSync(new URL('../api/list-ebay.js', import.meta.url), 'utf8');
ok(/LEGACY_CLIENT_PHOTOS_REJECTED/.test(api) && /item\.images/.test(api) && !/assertSourceImages/.test(api), 'the handler rejects client-supplied photo data and no longer parses it');
ok(/getMediaById\(\{ principalId: grailkeyPrincipalId/.test(api) && /media\.getBytes/.test(api), 'bytes come from the owner-authorized media row via the media module');
const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const body = app.slice(app.indexOf('const res = await apiFetch("/api/list-ebay"'), app.indexOf('const res = await apiFetch("/api/list-ebay"') + 2500);
ok(/approvedPhotoHashes/.test(body) && !/\bimages:\s*allPhotos/.test(body) && !/\bimage:\s*coverPhoto/.test(body), 'the client sends approvedPhotoHashes and no photo bytes');

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
process.exit(failed ? 1 : 0);
