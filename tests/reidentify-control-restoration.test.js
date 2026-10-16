// tests/reidentify-control-restoration.test.js
//
// The saved-card "Re-identify" control (Ship #20a.6.19; the operator calls it "Re-evaluate Comic") was REMOVED from every
// card whose device holds no raw photo bytes (item.images[0]) — i.e. every server-hydrated card on a device/origin that did
// not scan it. It must stay visible and explain itself. Also pins the governance of the unchanged action so a restored
// button can never become an authority bypass. Source-parsing assertions FAIL (never skip) when the code is absent.
//
// Invoke: node tests/reidentify-control-restoration.test.js

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { reIdentifyControlState, RE_IDENTIFY_REASONS } = await import(pathToFileURL(path.join(root, 'src', 'lib', 'reIdentifyControl.js')).href);
const app = readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8');

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };

console.log('\n=== Re-identify control restoration ===\n--- control state ---');
const S = (item, o) => reIdentifyControlState(item, o);
ok(S({ id: 'a', images: ['data:image/jpeg;base64,AAAA'] }).visible && S({ id: 'a', images: ['data:image/jpeg;base64,AAAA'] }).enabled, 'local photo present: visible and enabled (original behavior)');
const serverOnly = S({ id: 'b', images: [], remoteImages: ['x'] });
ok(serverOnly.visible === true, 'server-hydrated card (no local bytes): control stays VISIBLE');
ok(serverOnly.enabled === false && serverOnly.reason === RE_IDENTIFY_REASONS.NO_LOCAL_PHOTO, 'server-hydrated card: disabled with the "photo is on the server" explanation');
const noKey = S({ id: 'c', remoteImages: ['x'] });
ok(noKey.visible && !noKey.enabled && noKey.reason === RE_IDENTIFY_REASONS.NO_LOCAL_PHOTO, 'card with no images key at all (hydrate default): visible, disabled, explained');
const none = S({ id: 'd' });
ok(none.visible && !none.enabled && none.reason === RE_IDENTIFY_REASONS.NO_PHOTO_AT_ALL, 'no photo anywhere: visible, disabled, explained');
ok(S({ id: 'e', images: [''] }).enabled === false, 'an empty-string placeholder is not a photo');
ok(S({ id: 'f', images: ['x'] }, { hasHandler: false }).visible === false, 'no handler wired: not rendered (nothing to call)');
ok(S(null).visible === false, 'no item: not rendered');

console.log('--- wiring (App.jsx) ---');
ok(!/\{item\.images\?\.\[0\]\s*&&\s*onReIdentify\s*&&\s*\(/.test(app), 'the render gate no longer hides the control when local photo bytes are absent');
ok(/reIdentifyControl\.visible\s*&&/.test(app), 'the control renders from reIdentifyControlState');
ok(/disabled=\{reIdentifying \|\| refreshing \|\| !reIdentifyControl\.enabled\}/.test(app), 'the button is disabled (not removed) when the action cannot run');
ok(/data-testid="reidentify-disabled-reason"/.test(app), 'the disabled state shows its reason on the card');
ok(/onReIdentify=\{reIdentifyBook\}/.test(app), 'the control still invokes the existing reIdentifyBook pathway (no new endpoint)');

console.log('--- the unchanged action stays governed ---');
const start = app.indexOf('const reIdentifyBook = useCallback');
const end = app.indexOf('const submitManualCorrection = useCallback');
const body = start > 0 && end > start ? app.slice(start, end) : '';
ok(body.length > 1000, 'reIdentifyBook body located');
ok(/mergeConfirmedIdentity\(reIdentifyFreshIdentity, item\)/.test(body), 'identity merges through mergeConfirmedIdentity (OPERATOR_CONFIRMED facets are held)');
ok(/ownedReidentify:\s*true/.test(body) && /collectionItemId:\s*item\.id/.test(body), 'targets the EXISTING collection record via the owned re-identify flow (no new record)');
ok(!/q41Ack/.test(body), 'never sets or clears q41Ack (cannot authorize listing or override Q41)');
ok(!/modelPredicted(Grade|At)\s*:/.test(body), 'never writes the write-once model baseline');
ok(!/operatorGrade\s*:|gradeAuthority\s*:/.test(body), 'never rewrites the operator grade or its authority');
ok(!/createPhysicalAsset|captureFromScan|capture-scan/.test(body), 'does not mint or capture a physical asset');

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed ? 1 : 0);
