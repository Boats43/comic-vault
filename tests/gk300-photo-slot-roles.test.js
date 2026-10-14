// tests/gk300-photo-slot-roles.test.js
//
// GK-300 — Collection photo buttons assign the EXPLICITLY selected role
// (FRONT/BACK/SPINE/PAGES), never sequential position. Pure-function proof of
// src/lib/photoSlots.js (the logic addPhotoToComic delegates to) plus static
// wiring proof for both Take Photo and Choose Existing Photo. The full
// addPhotoToComic callback lives inside App() and is NOT executed here.
//
// Invoke: node tests/gk300-photo-slot-roles.test.js

import fs from 'node:fs';
import { PHOTO_ROLES, effectiveRoles, missingRoles, addPhotoWithRole, declaredViews } from '../src/lib/photoSlots.js';

let passed = 0, failed = 0;
const failures = [];
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; failures.push(l); console.log(`  ✗ ${l}`); } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Simulate the add flow exactly as addPhotoToComic uses it, including a
// persist/refresh round trip (JSON clone == IndexedDB structured clone / attributes sync).
const add = (item, photo, role) => {
  const placed = addPhotoWithRole(item.images, item.photoRoles, photo, role);
  return JSON.parse(JSON.stringify({ ...item, images: placed.images, photoRoles: placed.photoRoles }));
};

console.log('\n=== GK-300 — explicit photo-slot roles ===\n');

console.log('-- SPINE before BACK (the reported defect) --\n');
let it = { id: 'x', images: ['F'], photoRoles: null };
it = add(it, 'S', 'SPINE');
ok(eq(effectiveRoles(it.images.length, it.photoRoles), ['FRONT', 'SPINE']), 'SPINE upload lands as SPINE, not BACK (front was legacy-positional)');
ok(eq(missingRoles(it.images.length, it.photoRoles), ['BACK', 'PAGES']), 'BACK is still offered as missing (by role, not position)');
it = add(it, 'B', 'BACK');
ok(eq(it.images, ['F', 'B', 'S']), 'BACK later is inserted in canonical order');
ok(eq(effectiveRoles(3, it.photoRoles), ['FRONT', 'BACK', 'SPINE']), 'roles correct after both');

console.log('\n-- From empty, every upload order (24 permutations) --\n');
const perms = (a) => (a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p])));
let allGood = true, allRefresh = true;
for (const order of perms(PHOTO_ROLES)) {
  let item = { id: 'y', images: [], photoRoles: [] };
  for (const r of order) item = add(item, `img-${r}`, r);
  const roles = effectiveRoles(item.images.length, item.photoRoles);
  if (!eq(roles, PHOTO_ROLES) || !eq(item.images, PHOTO_ROLES.map((r) => `img-${r}`))) allGood = false;
  if (!eq(missingRoles(item.images.length, item.photoRoles), [])) allRefresh = false;
}
ok(allGood, 'every order yields image bytes under the correct role, canonical order');
ok(allRefresh, 'after a JSON round trip (refresh/sync) no slot is mis-reported missing');

console.log('\n-- Only SPINE, only BACK (no FRONT yet) --\n');
let o = add({ images: [], photoRoles: [] }, 'S', 'SPINE');
ok(eq(effectiveRoles(1, o.photoRoles), ['SPINE']) && eq(missingRoles(1, o.photoRoles), ['FRONT', 'BACK', 'PAGES']), 'lone SPINE is SPINE; FRONT/BACK/PAGES remain open');
o = add({ images: [], photoRoles: [] }, 'B', 'BACK');
ok(eq(effectiveRoles(1, o.photoRoles), ['BACK']), 'lone BACK is BACK (not promoted to FRONT by position)');

console.log('\n-- Legacy photos (no recorded roles) keep positional meaning --\n');
ok(eq(effectiveRoles(2, undefined), ['FRONT', 'BACK']) && eq(missingRoles(2, undefined), ['SPINE', 'PAGES']), 'legacy 2-photo item: front+back, spine/pages missing');
let lg = add({ images: ['A', 'B'] }, 'P', 'PAGES');
ok(eq(effectiveRoles(3, lg.photoRoles), ['FRONT', 'BACK', 'PAGES']) && eq(missingRoles(3, lg.photoRoles), ['SPINE']), 'new explicit PAGES on legacy item: legacy roles intact, PAGES explicit, SPINE open');
lg = add(lg, 'S', 'SPINE');
ok(eq(lg.images, ['A', 'B', 'S', 'P']) && eq(effectiveRoles(4, lg.photoRoles), PHOTO_ROLES), 'SPINE then slots in before PAGES');

console.log('\n-- Replace / duplicate / DETAIL / invalid --\n');
const rep = addPhotoWithRole(['F', 'B'], [null, 'BACK'], 'B2', 'BACK');
ok(rep.replaced && eq(rep.images, ['F', 'B2']), 'explicitly re-selecting a held role replaces that photo in place, count unchanged');
const det = addPhotoWithRole(['F'], [null], 'D1', 'DETAIL');
ok(eq(det.photoRoles, [null, 'DETAIL']) && eq(missingRoles(2, det.photoRoles), ['BACK', 'SPINE', 'PAGES']), 'DETAIL does not occupy a numbered slot');
let threw = false;
try { addPhotoWithRole([], [], 'x', 'COVER'); } catch { threw = true; }
ok(threw, 'unknown role is rejected, never defaulted');
ok(effectiveRoles(2, ['SPINE', 'SPINE'])[0] === 'SPINE' && effectiveRoles(2, ['SPINE', 'SPINE'])[1] === null, 'duplicate explicit claim: first wins, loser stays unassigned (never silently re-labeled)');

console.log('\n-- Grade request views: declared only --\n');
ok(declaredViews([null, null], 2) === null, 'all-legacy item sends no imageViews (positions are not declarations)');
ok(eq(declaredViews([null, 'SPINE'], 2), [null, 'SPINE']), 'only the declared role is sent; legacy slot stays null');

console.log('\n-- Static wiring --\n');
const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const fnStart = app.indexOf('const addPhotoToComic = useCallback');
const fn = app.slice(fnStart, app.indexOf('}, []);', fnStart));
ok(/slotRole/.test(fn) && /addPhotoWithRole\(existingPhotos, item\.photoRoles, newThumb, photoRole\)/.test(fn), 'addPhotoToComic stores the photo under the explicitly supplied role');
ok(/photoRoles: nextPhotoRoles/.test(fn) && /photoRoles: nextPhotoRoles\.slice\(-3\)/.test(fn), 'roles persisted in the normal and quota-fallback writes (kept parallel to images)');
ok(fn.includes('resolvePhotoRegradeIdentity(item, data)'), 'GK-300 identity lock still in place');
ok(!/title:\s*data\.title\s*\|\|/.test(fn), 'no raw data.title assignment reintroduced');
const strip = app.slice(app.indexOf('GK-300 — slots are keyed by ROLE'), app.indexOf('{/* Fullscreen photo overlay */}'));
ok(/missingRoles\(photos\.length, item\.photoRoles\)/.test(strip), 'strip offers slots by missing ROLE, not by position');
ok(/handleAddPhotoClick\(label\.toUpperCase\(\)\)/.test(strip) && /handleAddLibraryClick\(label\.toUpperCase\(\)\)/.test(strip), 'Take Photo AND Choose Existing both pass the tapped slot role');
const clicks = app.slice(app.indexOf('const handleAddPhotoClick'), app.indexOf('const handleSync'));
ok((clicks.match(/pendingPhotoRoleRef\.current = role/g) || []).length === 2, 'both click handlers record the role before opening their picker');
ok(/onAddPhoto\(item, file, \{ slotRole \}\)/.test(clicks) && /!slotRole\) return/.test(clicks), 'shared change handler forwards the role and refuses to add without one');
const panel = fs.readFileSync(new URL('../src/components/GrailKeyOperatorPanel.jsx', import.meta.url), 'utf8');
ok(/onAddPhoto\(item, file, \{ gkAssetId, captureView: role \}\)/.test(panel), 'operator panel path still passes its explicit role (camera and library share the handler)');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log(failures.join('\n')); process.exit(1); }
