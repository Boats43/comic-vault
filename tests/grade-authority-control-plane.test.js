// Grade authority control plane — model confidence is not authority; barcode observes identity,
// not condition; client gradeLocked cannot skip Vision; prediction-provenance failures are
// OBSERVED (never refused) this pass. Real api/grade.js handler, fetch stubbed, no paid calls.
//   node tests/grade-authority-control-plane.test.js
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'test-anthropic-key';
process.env.EBAY_APP_ID = process.env.EBAY_APP_ID || 'test-app-id';
process.env.EBAY_CERT_ID = process.env.EBAY_CERT_ID || 'test-cert-id';
delete process.env.GRAILKEY_CATALOG_DATABASE_URL; // force the prediction-event write to fail
if (!process.env.GRAILKEY_SESSION_SECRET) {
  process.env.GRAILKEY_SESSION_SECRET = (await import('node:crypto')).randomBytes(32).toString('base64url');
}
const { readFileSync } = await import('node:fs');
const { issueToken } = await import('../src/modules/auth/token.js');
const { setResearchStoreForTests, createMemoryResearchStore } = await import('../src/lib/researchStore.js');
const { chooseBetterGrade } = await import('../src/lib/dataQualityGuard.js');
const { resolveGoverningGrade } = await import('../src/lib/gradeAuthority.js');
const { buildPredictionEvidenceMeta, classifyWriteFailure, counterKey, resolvePredictionKind } = await import('../src/lib/gradeProvenanceObservability.js');
const TOKEN = issueToken({ principalId: 'grade-authority-test-principal' }).token;

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };
const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const gradeSrc = readFileSync(new URL('../api/grade.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const enrichSrc = readFileSync(new URL('../api/enrich.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

console.log('\n=== grade authority control plane ===\n');

// --- static client laws -------------------------------------------------------
ok(!/data\.gradeLocked\s*=/.test(app), 'high model confidence no longer sets gradeLocked');
ok(!/gradeLocked:\s*true/.test(app), 'barcode path (and any other site) no longer sets gradeLocked:true');
ok(!/gradeLocked:\s*data\.gradeLocked/.test(app), 'addToCatalogue no longer persists a gradeLocked flag');
ok(!/gradeLocked:\s*item\.gradeLocked/.test(app), 'add-photo / re-identify requests no longer send gradeLocked');
const barcodeBlock = app.slice(app.indexOf('const handleBarcodeSubmit'), app.indexOf('const handleBulkImport'));
ok(!/grade\s*:/.test(barcodeBlock) && /skipVision:\s*true/.test(barcodeBlock) && !/images/.test(barcodeBlock),
  'barcode path: Vision skipped, no image, no grade written (identity only)');
const enrichGradeAssigns = enrichSrc.split('\n').filter((l) => /\bout\.grade\s*=[^=]/.test(l));
ok(enrichGradeAssigns.length === 1 && /confirmedGrade/.test(enrichGradeAssigns[0]), 'enrich never invents a condition grade (CGC-cert grade only) — a barcode item stays grade-less');

// --- server: client gradeLocked cannot skip Vision ------------------------------
const VISION = {
  title: 'Tales of Suspense', issue: '23', publisher: 'Marvel', year: '1961', assetTypeConfident: true, foreignEdition: false,
  isReprint: false, editionType: 'original', grade: 'GD 2.0', isGraded: false, numericGrade: null, certNumber: null, labelType: null,
  labelNotes: null, keyIssue: null, variant: null, creator: null, price: '$80', priceLow: '$60', priceHigh: '$100',
  reason: 'Cover wear and creasing.', confidence: 'high', detectedPrice: null, restoration: null, defectPenalty: null, cgcPenaltyFlags: null,
};
let anthropicCalls = 0;
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });
const originalFetch = global.fetch;
global.fetch = async (url) => {
  const u = String(url);
  if (u.includes('oauth2/token') || u.includes('/oauth/')) return json({ access_token: 'fake', expires_in: 7200, token_type: 'x' });
  if (u.includes('search_by_image')) return json({ itemSummaries: [], total: 0 });
  if (u.includes('api.anthropic.com')) {
    anthropicCalls++;
    return json({ id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-4-5-20250929', content: [{ type: 'text', text: JSON.stringify(VISION) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } });
  }
  return json({});
};
const origLog = console.log;
const logs = [];
console.log = (...a) => { logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); };
const store = createMemoryResearchStore();
setResearchStoreForTests(store);
const { default: handler } = await import('../api/grade.js');
const { default: Jimp } = await import('jimp');
const PNG = (await new Jimp(64, 48, 0xff0000ff).getBufferAsync(Jimp.MIME_PNG)).toString('base64');
let n = 0;
const run = async (body) => {
  let status = null, out = null, threw = null;
  const res = { status: (c) => ({ json: (d) => { status = c; out = d; return d; } }), setHeader: () => {} };
  try { await handler({ method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'x-forwarded-for': `10.7.0.${++n}` }, body }, res); } catch (e) { threw = e; }
  return { status, out, threw };
};
logs.length = 0;
const locked = await run({ images: [PNG], existingGrade: { grade: 'VG 4.0', isGraded: false }, gradeConfidence: 'HIGH', gradeLocked: true });
console.log = origLog;
ok(locked.threw === null && locked.status === 200, 'real handler runs for a request carrying a legacy gradeLocked flag');
ok(anthropicCalls >= 1, 'Vision IS called despite client gradeLocked + HIGH + existingGrade (no server skip)');
ok(locked.out?.skipReason === undefined && locked.out?.locked === undefined && locked.out?.skippedVision === undefined, 'response is a fresh model result, not a locked echo');
ok(locked.out?.grade === 'GD 2.0', 'the fresh model grade is returned (new evidence can produce a new prediction)');
ok(!/gradeLocked\s*===\s*true/.test(gradeSrc) && !/grade_locked/.test(gradeSrc.replace(/\/\/.*$/gm, '')), 'no server code path reads gradeLocked');

// --- observation of prediction-write failure; grade continues exactly as today --
const failLine = logs.find((l) => l.startsWith('[grade-provenance]') && l.includes('write_failed'));
ok(!!failLine, 'prediction write failure emits a structured [grade-provenance] line');
ok(failLine && /"branch":"SONNET_VISION_FALLBACK"/.test(failLine) && /"model":"claude-sonnet-4-5-20250929"/.test(failLine) && /"errorClass":"NO_DB_ENV"/.test(failLine), 'line carries branch, model and error class');
ok(failLine && !/Cover wear|data:image|base64/.test(failLine), 'line carries no prompt, image or condition content');
const day = new Date().toISOString().slice(0, 10);
const buildSha = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || process.env.CV_BUILD_ID || null;
// 2 images => RE_GRADE (inferred); the legacy-lock request above carried 1 image => FIRST_GRADE.
const k = counterKey({ day, kind: 'prediction', outcome: 'write_failed', branch: 'SONNET_VISION_FALLBACK', model: 'claude-sonnet-4-5-20250929', buildSha, predictionKind: 'FIRST_GRADE' });
ok(Number(await store.get(k)) === 1, 'durable daily counter incremented for the failure (FIRST_GRADE)');
ok(locked.out?.grade === 'GD 2.0' && locked.out?.confidence === 'high', 'scan outcome unchanged by the failure (grade and confidence still returned, no refusal)');
ok(locked.out?.gradeEvidence === undefined, 'RC does not depend on d32ca0d: no gradeEvidence field is produced or required');
const re1 = await run({ images: [PNG, PNG] });
const k2 = counterKey({ day, kind: 'prediction', outcome: 'write_failed', branch: 'SONNET_VISION_FALLBACK', model: 'claude-sonnet-4-5-20250929', buildSha, predictionKind: 'RE_GRADE' });
ok(re1.status === 200 && Number(await store.get(k2)) === 1, 'two-image request is counted as RE_GRADE (distinct denominator)');
const re2 = await run({ images: [PNG], predictionKind: 'RE_GRADE' });
ok(re2.status === 200 && Number(await store.get(k2)) === 2, 'a client RE_GRADE label on a 1-image re-identify is counted as RE_GRADE');
const fake = await run({ images: [PNG], predictionKind: 'ADMIN' });
ok(fake.status === 200 && Number(await store.get(k)) === 2, 'an unknown predictionKind label is ignored (falls back to inference), never trusted');
ok(resolvePredictionKind('RE_GRADE', 1) === 'RE_GRADE' && resolvePredictionKind(undefined, 3) === 'RE_GRADE' && resolvePredictionKind(undefined, 1) === 'FIRST_GRADE', 'predictionKind resolution is deterministic');
const recLine = logs.find((l) => l.startsWith('[grade-provenance]'));
ok(!!recLine && !/principal|grade-authority-test-principal/i.test(recLine), 'observability line carries no principal id');

// --- metadata ---------------------------------------------------------------------
const meta = buildPredictionEvidenceMeta({ branch: 'HAIKU_EBAY_CONSENSUS', imageCount: 2, imageViews: ['FRONT', 'BACK'], sentDimensions: [{ width: 800, height: 600 }], gradeEvidence: { precision: 'LIMITED' } });
ok(meta.purpose === 'CONDITION_GRADING' && meta.branch === 'HAIKU_EBAY_CONSENSUS' && meta.imageCount === 2 && meta.gradeEvidenceTier === 'LIMITED', 'evidence meta: purpose, branch, count, tier');
ok(buildPredictionEvidenceMeta({ imageCount: 1 }).gradeEvidenceTier === 'UNKNOWN' && buildPredictionEvidenceMeta({ imageCount: 1 }).predictionKind === 'FIRST_GRADE', 'evidence meta: tier UNKNOWN without gradeEvidence, predictionKind recorded');
ok(JSON.stringify(meta.declaredViews) === '["FRONT","BACK"]' && meta.sentDimensions[0].width === 800, 'evidence meta: declared views and sent dimensions');
ok(buildPredictionEvidenceMeta({ imageCount: 2, imageViews: null }).declaredViews === 'UNDECLARED', 'evidence meta: undeclared views recorded as UNDECLARED, never inferred from count');
ok(meta.resolutionPolicy.validatedFor === 'IDENTIFICATION_ONLY', '800px recorded as validated for identification only');
ok(/sentDimensions\.push/.test(gradeSrc) && /buildPredictionEvidenceMeta\(/.test(gradeSrc), 'handler records real post-resize dimensions into the GRADE prediction payload');
ok(classifyWriteFailure(new Error('GRAILKEY_CATALOG_DATABASE_URL is not set in process.env')) === 'NO_DB_ENV', 'failure classes are non-sensitive labels');

// --- authority semantics unchanged --------------------------------------------------
ok(resolveGoverningGrade({ gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: 'VG 4.0', grade: 'GD 2.0' }).source === 'operator', 'operator-confirmed grade still governs');
ok(resolveGoverningGrade({ grade: 'GD 2.0', gradeLocked: true }).source === 'model', 'a bare gradeLocked on legacy data confers no authority');
const cbg = chooseBetterGrade({ confidenceLevel: 'LOW' }, { grade: 'GD 2.0', confidenceLevel: 'HIGH' });
ok(cbg.grade === 'GD 2.0', 'chooseBetterGrade: enrich carries no model grade, so it can never install or block a model grade (documented)');

global.fetch = originalFetch;
origLog(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed ? 1 : 0);
