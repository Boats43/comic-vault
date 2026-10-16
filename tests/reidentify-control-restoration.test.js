// tests/reidentify-control-restoration.test.js
//
// The saved-card "Re-evaluate Comic" control (originally "Re-identify Book", Ship #20a.6.19) vanished from every card whose
// device holds no raw photo bytes. It must stay visible AND work on any device: the saved server copy of the photo is served
// through the EXISTING protected image route to the EXISTING reIdentifyBook workflow. Also pins the governance of the
// unchanged action and the paid-AI disclosure. Source-parsing assertions FAIL (never skip) when the code is absent.
//
// Invoke: node tests/reidentify-control-restoration.test.js

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (rel) => import(pathToFileURL(path.join(root, rel)).href);
const { reIdentifyControlState, reIdentifyDisclosure, RE_IDENTIFY_REASONS, RE_IDENTIFY_COST_UNITS } = await imp('src/lib/reIdentifyControl.js');
const { fetchServerPhotoAsDataUrl, SERVER_PHOTO_ERRORS, MAX_SERVER_PHOTO_BYTES } = await imp('src/lib/serverPhotoForReidentify.js');
const { SPEND_UNITS } = await imp('src/lib/spendGuard.js');
const app = readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8');

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };

console.log('\n=== Re-evaluate / re-identify control ===\n--- control state ---');
const S = (item, o) => reIdentifyControlState(item, o);
const dev = S({ id: 'a', assetCategory: 'comic', images: ['data:image/jpeg;base64,AAAA'] });
ok(dev.visible && dev.enabled && dev.photoSource === 'device', 'raw bytes on this device: enabled, source=device (original behavior)');
const srv = S({ id: 'b', assetCategory: 'comic', images: [], remoteImages: ['x'] });
ok(srv.visible && srv.enabled && srv.photoSource === 'server', 'server-hydrated card (no local bytes, saved server copy): ENABLED, source=server');
ok(S({ id: 'c', remoteImages: ['x'] }).enabled === true, 'card with no images key at all (hydrate default): enabled via the server copy');
const none = S({ id: 'd', assetCategory: 'comic' });
ok(none.visible && !none.enabled && none.reason === RE_IDENTIFY_REASONS.NO_PHOTO_AT_ALL, 'no photo anywhere: visible, disabled, explained (never removed)');
ok(S({ id: 'e', images: [''] }).enabled === false, 'an empty-string placeholder is not a photo');
ok(S({ id: 'f', images: ['x'] }, { hasHandler: false }).visible === false, 'no handler wired: not rendered');
ok(S(null).visible === false, 'no item: not rendered');
ok(S({ id: 'g', assetCategory: 'generic', remoteImages: ['x'] }).visible === false, 'generic assets are not eligible (no comic re-grade for them)');
ok(S({ id: 'h', assetCategory: 'comic' }).label.includes('Re-evaluate Comic') && S({ id: 'i', assetCategory: 'book' }).label.includes('Re-identify Book'), 'labels: "Re-evaluate Comic" for comics, "Re-identify Book" for books');

console.log('--- paid-AI disclosure ---');
ok(RE_IDENTIFY_COST_UNITS.grade === SPEND_UNITS.grade && RE_IDENTIFY_COST_UNITS.enrich === SPEND_UNITS.enrich, 'disclosed units equal the real spend-guard units (no drift)');
const disc = reIdentifyDisclosure('server');
ok(/PAID AI/.test(disc) && disc.includes(`${SPEND_UNITS.grade + SPEND_UNITS.enrich} usage units`), 'the disclosure says it is a paid AI re-grade and states the cost');
ok(/saved server copy/.test(disc) && /photo on this device/.test(reIdentifyDisclosure('device')), 'the disclosure names which photo is used');
ok(/confirmed title, variant and grade are kept/i.test(disc) && /Listing approval is not affected/.test(disc), 'the disclosure states authority is preserved and listing is not authorized');
ok(/window\.confirm\(reIdentifyDisclosure\(/.test(app), 'the disclosure is shown (confirm) before anything runs');

console.log('--- serving the saved photo through the existing route ---');
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const mkRes = (status, type, bytes) => ({ ok: status >= 200 && status < 300, status, headers: { get: (k) => (k.toLowerCase() === 'content-type' ? type : null) }, arrayBuffer: async () => (bytes || new Uint8Array(0)).buffer.slice(bytes?.byteOffset || 0, (bytes?.byteOffset || 0) + (bytes?.length || 0)) });
const item = { id: 'cv_1', remoteImages: ['u'] };
const base = { getUrl: () => '/api/collection-image-v2?p=P&id=cv_1&i=0', subscribe: () => () => {}, waitMs: 20 };
let seen = null;
const good = await fetchServerPhotoAsDataUrl(item, { ...base, fetchImpl: async (u, o) => { seen = { u, o }; return mkRes(200, 'image/png', PNG); } });
ok(good.ok && good.dataUrl === `data:image/png;base64,${Buffer.from(PNG).toString('base64')}`, 'a served image becomes a data URL for the existing grading call');
ok(seen && seen.u.startsWith('/api/collection-image-v2?') && seen.o.credentials === 'same-origin', 'it calls ONLY the existing protected image route with the same-origin cookie credential');
ok(!/[?&](token|key|credential)=/.test(seen.u), 'no credential is placed in the URL');
const code = async (deps, it = item) => (await fetchServerPhotoAsDataUrl(it, { ...base, ...deps })).code;
ok(await code({ fetchImpl: async () => mkRes(404) }) === SERVER_PHOTO_ERRORS.NOT_FOUND, 'missing photo: explicit NOT_FOUND');
ok(await code({ fetchImpl: async () => mkRes(403) }) === SERVER_PHOTO_ERRORS.FORBIDDEN, 'inaccessible photo (403): explicit FORBIDDEN');
ok(await code({ fetchImpl: async () => mkRes(401) }) === SERVER_PHOTO_ERRORS.FORBIDDEN, 'expired session (401): explicit FORBIDDEN');
ok(await code({ fetchImpl: async () => mkRes(500) }) === SERVER_PHOTO_ERRORS.NETWORK, 'server error: explicit NETWORK, nothing changed');
ok(await code({ fetchImpl: async () => { throw new Error('offline'); } }) === SERVER_PHOTO_ERRORS.NETWORK, 'offline: explicit NETWORK');
ok(await code({ fetchImpl: async () => mkRes(200, 'text/html', PNG) }) === SERVER_PHOTO_ERRORS.NOT_AN_IMAGE, 'a non-image response is refused');
ok(await code({ fetchImpl: async () => mkRes(200, 'image/png', new Uint8Array(0)) }) === SERVER_PHOTO_ERRORS.NOT_AN_IMAGE, 'an empty body is refused');
ok(await code({ fetchImpl: async () => mkRes(200, 'image/jpeg', new Uint8Array(MAX_SERVER_PHOTO_BYTES + 1)) }) === SERVER_PHOTO_ERRORS.TOO_LARGE, 'an oversize photo is refused before it reaches the grading route');
ok(await code({ getUrl: () => null, fetchImpl: async () => mkRes(200, 'image/png', PNG) }) === SERVER_PHOTO_ERRORS.NO_CREDENTIAL, 'no image credential (bounded wait): explicit NO_CREDENTIAL, no request made');
ok(await code({ fetchImpl: async () => mkRes(200, 'image/png', PNG) }, { id: 'cv_2' }) === SERVER_PHOTO_ERRORS.NO_REMOTE_PHOTO, 'no saved photo recorded: explicit NO_REMOTE_PHOTO, no request made');
let late = null;
const cbs = [];
const waiting = fetchServerPhotoAsDataUrl(item, { getUrl: () => late, subscribe: (fn) => { cbs.push(fn); return () => {}; }, fetchImpl: async () => mkRes(200, 'image/png', PNG), waitMs: 2000 });
late = '/api/collection-image-v2?p=P&id=cv_1&i=0'; cbs.forEach((f) => f());
ok((await waiting).ok === true, 'waits for the credential mint and proceeds as soon as it arrives');

console.log('--- wiring (App.jsx) ---');
ok(!/\{item\.images\?\.\[0\]\s*&&\s*onReIdentify\s*&&\s*\(/.test(app), 'the render gate no longer hides the control when local photo bytes are absent');
ok(/reIdentifyControl\.visible\s*&&/.test(app) && /disabled=\{reIdentifying \|\| refreshing \|\| !reIdentifyControl\.enabled\}/.test(app), 'the control renders from reIdentifyControlState and is disabled (not removed) when it cannot run');
ok(/data-testid="reidentify-disabled-reason"/.test(app), 'the disabled state shows its reason on the card');
ok(/onReIdentify=\{reIdentifyBook\}/.test(app), 'the control still invokes the existing reIdentifyBook pathway (no new endpoint)');

console.log('--- the action stays governed ---');
const start = app.indexOf('const reIdentifyBook = useCallback');
const end = app.indexOf('const submitManualCorrection = useCallback');
const body = start > 0 && end > start ? app.slice(start, end) : '';
ok(body.length > 1000, 'reIdentifyBook body located');
ok(/fetchServerPhotoAsDataUrl\(item\)/.test(body) && /throw new Error\(served\.message\)/.test(body), 'a missing/inaccessible server photo aborts BEFORE any paid call, with an explicit message');
const guardIdx = body.indexOf('fetchServerPhotoAsDataUrl(item)');
ok(guardIdx > 0 && guardIdx < body.indexOf('runGradeAttempt('), 'the photo is obtained before the paid grading call');
ok(!/putComic\(|setCatalogue\([^)]*served|images:\s*\[served/.test(body.slice(0, body.indexOf('runGradeAttempt('))), 'the fetched bytes are not persisted to the card or IndexedDB');
ok(/mergeConfirmedIdentity\(reIdentifyFreshIdentity, item\)/.test(body), 'identity merges through mergeConfirmedIdentity (OPERATOR_CONFIRMED facets are held)');
ok(/ownedReidentify:\s*true/.test(body) && /collectionItemId:\s*item\.id/.test(body), 'targets the EXISTING collection record via the owned re-identify flow (no new record)');
ok(!/q41Ack/.test(body), 'never sets or clears q41Ack (cannot authorize listing or override Q41)');
ok(!/modelPredicted(Grade|At)\s*:/.test(body), 'never writes the write-once model baseline');
ok(!/operatorGrade\s*:|gradeAuthority\s*:/.test(body), 'never rewrites the operator grade or its authority');
ok(!/createPhysicalAsset|captureFromScan|capture-scan/.test(body), 'does not mint or capture a physical asset');

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed ? 1 : 0);
