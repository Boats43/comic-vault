// tests/gk300-photo-input-identity-lock.test.js
//
// GK-300 — (A) an add-photo re-grade must not overwrite operator-confirmed
// identity; (B) every photo slot offers Take Photo (camera) AND Choose
// Existing Photo (picker without `capture`), both feeding the same pipeline.
// (A) is a pure-function proof plus static wiring proof; the full
// addPhotoToComic callback lives inside App() and is NOT executed here
// (disclosed gap: no real-callback test).
//
// Invoke: node tests/gk300-photo-input-identity-lock.test.js

import fs from 'node:fs';
import { resolvePhotoRegradeIdentity, lockedIdentityFields } from '../src/lib/photoIdentityLock.js';

let passed = 0, failed = 0;
const failures = [];
const ok = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; failures.push(label); console.log(`  ✗ ${label}`); }
};

console.log('\n=== GK-300 — identity lock on photo re-grade ===\n');

const locked = {
  title: 'Old Man Logan', issue: '25', publisher: 'Marvel', year: '2017',
  identityAuthority: { title: 'OPERATOR_CONFIRMED', issue: 'OPERATOR_CONFIRMED', publisher: 'OPERATOR_CONFIRMED', year: 'OPERATOR_CONFIRMED' },
};
const drift = { title: 'Wolverine Old Man Logan #26', issue: '26', publisher: 'Panini', year: '2019' };
const r1 = resolvePhotoRegradeIdentity(locked, drift);
ok(r1.title === 'Old Man Logan' && r1.issue === '25' && r1.publisher === 'Marvel' && r1.year === '2017', 'all four locked fields survive a drifting grade response');
ok(r1.lockedFields.length === 4, 'locked fields reported');

const partial = { ...locked, identityAuthority: { title: 'OPERATOR_CONFIRMED' } };
const r2 = resolvePhotoRegradeIdentity(partial, drift);
ok(r2.title === 'Old Man Logan', 'locked title preserved');
ok(r2.issue === '26' && r2.publisher === 'Panini' && r2.year === '2019', 'unlocked fields keep pre-existing behavior (negative control)');

const noAuth = { title: 'A', issue: '1', publisher: 'P', year: '2000' };
const r3 = resolvePhotoRegradeIdentity(noAuth, { title: 'B #2' });
ok(r3.title === 'B #2' && r3.issue === '2', 'no authority → unchanged legacy behavior (title + #issue derived)');
ok(resolvePhotoRegradeIdentity(noAuth, {}).title === 'A', 'empty response keeps stored identity');

ok(resolvePhotoRegradeIdentity(locked, { title: 'X #9' }).issue === '25', 'issue not re-derived from drifting title when locked');
ok(resolvePhotoRegradeIdentity(locked, {}).title === 'Old Man Logan', 'locked + empty response');
ok(lockedIdentityFields({ identityAuthority: { title: 'MODEL', year: 'OPERATOR_CONFIRMED', variant: 'OPERATOR_CONFIRMED', printingClass: 'OPERATOR_CONFIRMED' } }).join() === 'year,variant,printingClass', 'only OPERATOR_CONFIRMED counts; variant/printingClass reported');
ok(lockedIdentityFields(null).length === 0 && lockedIdentityFields({}).length === 0, 'null/absent authority safe');

console.log('\n-- Static wiring: addPhotoToComic uses the lock; grade is not overwritten --\n');
const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const fnStart = app.indexOf('const addPhotoToComic = useCallback');
const fnEnd = app.indexOf('}, []);', fnStart);
const fn = app.slice(fnStart, fnEnd);
ok(fn.includes('resolvePhotoRegradeIdentity(item, data)'), 'addPhotoToComic resolves identity through the lock helper');
ok(!/title:\s*data\.title\s*\|\|/.test(fn) && !/publisher:\s*data\.publisher\s*\|\|/.test(fn) && !/year:\s*data\.year\s*\|\|/.test(fn), 'no raw data.* identity assignment remains');
ok(/\.\.\.item,/.test(fn) && !/operatorGrade\s*:/.test(fn), 'operatorGrade* preserved by the ...item spread, never reassigned');
ok(fn.includes('persistCollectionItem(updated)') && fn.includes('putComic(updated)'), 'existing persistence pipeline unchanged');
ok(!/createPhysicalAsset|captureFromScan|capture-scan/.test(fn), "no asset-minting call in the add-photo path (no duplicate physical asset)");

console.log('\n-- Static wiring: Take Photo + Choose Existing on both surfaces --\n');
const panel = fs.readFileSync(new URL('../src/components/GrailKeyOperatorPanel.jsx', import.meta.url), 'utf8');
const inputsOf = (src) => [...src.matchAll(/<input[\s\S]*?\/>/g)].map((m) => m[0]).filter((t) => /type="file"/.test(t) && /accept="image\/\*"/.test(t));
const panelInputs = inputsOf(panel);
ok(panelInputs.length === 2, 'operator panel: exactly two image file inputs');
ok(panelInputs.filter((t) => /capture="environment"/.test(t)).length === 1, 'operator panel: one camera input');
ok(panelInputs.filter((t) => !/capture=/.test(t)).length === 1, 'operator panel: one picker input without capture');
ok(panelInputs.every((t) => /onChange=\{handleEvidenceFileChange\}/.test(t)), 'operator panel: both inputs use the same handler (same role/idempotency/pipeline)');
ok(/Take Photo/.test(panel) && /Choose Existing Photo/.test(panel), 'operator panel: both choices labeled');
ok(/requestEvidencePhoto\(role, source\)/.test(panel) && /setPendingRole\(role\)/.test(panel), 'role is chosen explicitly before either picker opens');

const strip = app.slice(app.indexOf('GK-300 — slots are keyed by ROLE'), app.indexOf('{/* Fullscreen photo overlay */}'));
const stripInputs = inputsOf(strip);
ok(stripInputs.length === 2 && stripInputs.filter((t) => /capture=/.test(t)).length === 1, 'catalogue strip: one camera + one picker input');
ok(stripInputs.every((t) => /onChange=\{handleAddPhotoChange\}/.test(t)), 'catalogue strip: both inputs use onAddPhoto handler');
ok(/Take Photo/.test(strip) && /Choose Existing/.test(strip), 'catalogue strip: both choices labeled');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log(failures.join('\n')); process.exit(1); }
