// tests/gk227-physical-media-checklist-unit.test.js
//
// GK-227 — pure function proof, no DB. Certification photo-completeness
// must derive ONLY from durable media rows + capture_view, never from
// raw count, remoteImages, or model prose.
//
// Invoke: node tests/gk227-physical-media-checklist-unit.test.js

import { computeCaptureViewChecklist, isCertificationPhotoPacketComplete, missingRequiredCaptureViews, REQUIRED_CAPTURE_VIEWS } from '../src/lib/physicalMediaChecklist.js';

let passed = 0, failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};

console.log('\n=== GK-227 — physical media checklist (pure function) ===\n');

console.log('-- Old Man Logan #25\'s real current state: 1 media row, capture_view NULL --\n');
const oml25Media = [{ id: 'm1', capture_view: null, media_type: 'capture-photo' }];
const oml25Checklist = computeCaptureViewChecklist(oml25Media);
assertTrue(Object.values(oml25Checklist).every((v) => v === false), 'a single NULL-view row counts toward NO role — not silently treated as FRONT');
assertTrue(!isCertificationPhotoPacketComplete(oml25Media), 'certification packet is NOT complete with only the original capture photo');
assertTrue(missingRequiredCaptureViews(oml25Media).length === 4, `all 4 required views reported missing (got ${missingRequiredCaptureViews(oml25Media).join(',')})`);

console.log('\n-- raw count is never trusted: 10 rows, all capture_view NULL, still incomplete --\n');
const manyNullRows = Array.from({ length: 10 }, (_, i) => ({ id: `m${i}`, capture_view: null }));
assertTrue(!isCertificationPhotoPacketComplete(manyNullRows), '10 photos with no recorded view is still an incomplete packet — count alone proves nothing');

console.log('\n-- exactly the 4 required views present (DETAIL absent) -> complete --\n');
const completeMedia = [
  { id: 'm1', capture_view: null },
  { id: 'm2', capture_view: 'FRONT' },
  { id: 'm3', capture_view: 'BACK' },
  { id: 'm4', capture_view: 'SPINE' },
  { id: 'm5', capture_view: 'PAGES' },
];
assertTrue(isCertificationPhotoPacketComplete(completeMedia), 'FRONT+BACK+SPINE+PAGES present -> complete, DETAIL never required');
assertTrue(missingRequiredCaptureViews(completeMedia).length === 0, 'zero missing views reported');
const fullChecklist = computeCaptureViewChecklist(completeMedia);
assertTrue(REQUIRED_CAPTURE_VIEWS.every((v) => fullChecklist[v] === true), 'all 4 required checklist entries true');
assertTrue(fullChecklist.DETAIL === false, 'DETAIL correctly reported absent (was never supplied)');

console.log('\n-- 3 of 4 required views -> still incomplete --\n');
const threeOfFour = completeMedia.filter((m) => m.capture_view !== 'PAGES');
assertTrue(!isCertificationPhotoPacketComplete(threeOfFour), 'missing exactly PAGES -> still incomplete');
assertTrue(JSON.stringify(missingRequiredCaptureViews(threeOfFour)) === JSON.stringify(['PAGES']), 'the ONE missing view is named precisely, not fabricated');

console.log('\n-- multiple rows for the same view (a re-take) still just counts as present, once --\n');
const retake = [...completeMedia, { id: 'm6', capture_view: 'FRONT' }];
assertTrue(computeCaptureViewChecklist(retake).FRONT === true, 'FRONT still true with 2 real FRONT rows');
assertTrue(isCertificationPhotoPacketComplete(retake), 'a legitimate re-take does not break completeness');

console.log('\n-- empty/absent media array --\n');
assertTrue(!isCertificationPhotoPacketComplete([]), 'empty array -> incomplete');
assertTrue(!isCertificationPhotoPacketComplete(undefined), 'undefined -> incomplete, does not throw');
assertTrue(missingRequiredCaptureViews(null).length === 4, 'null media -> all 4 reported missing, does not throw');

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.log('FAILURES:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
