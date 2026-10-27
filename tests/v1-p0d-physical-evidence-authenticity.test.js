// V1 CERTIFICATION — P0-D physical evidence authenticity + ownership attestation + edition-claim containment.
//
// Part 1 (pure): capture-authenticity derivation is never "verified"; screen/uncertain captures withhold
//   physical-condition claims and mark the grade PROVISIONAL; the Street Fighter #1 shape (screen photo,
//   Thai claim, corner chips, "No restoration detected") is contained; foreign-edition claims need a verbatim
//   transcription; the containment is idempotent through ensureAssetType (every 200 passes there).
// Part 2 (real handler, no DB reached): api/capture-scan.js refuses a fresh owned-asset capture without the
//   explicit attestation, and refuses a scan-flagged screen capture, BEFORE any work.
// Part 3 (real handler + real Development Postgres): an attested capture mints, and the durable
//   `asset.minted` event records the attestation as an ASSERTION and the capture-authenticity as an
//   UNVERIFIED claim (verified:false).
//
// Retained append-only Development fixtures follow the repo's convention (gk_asset/identity rows are immutable).

import { readFileSync } from 'node:fs';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { Client } from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const envRaw = readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8');
for (const line of envRaw.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}
process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'development';
if (!process.env.GRAILKEY_SESSION_SECRET) process.env.GRAILKEY_SESSION_SECRET = randomBytes(32).toString('base64url');
delete process.env.MILESTONE_TEN_H8_PASS;
delete process.env.MILESTONE_TEN_H8_BOOTSTRAP;

const imp = (p) => import(pathToFileURL(path.join(repoRoot, p)).href);
const {
  deriveCaptureAuthenticity, containCaptureEvidence, REFERENCE_ONLY_REASON, UNCERTAIN_CAPTURE_REASON,
} = await imp('src/lib/captureAuthenticity.js');
const { buildOwnershipAttestation, normalizeOwnershipAttestation, OWNERSHIP_ATTESTATION_STATEMENT } = await imp('src/lib/ownershipAttestation.js');
const { ensureAssetType } = await imp('api/grade.js');

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { passed++; console.log(`  ✓ ${m}`); } else { failed++; console.log(`  ✗ ${m}`); } };

console.log('\n=== V1 P0-D: physical evidence authenticity ===\n');

console.log('-- 1. derivation is never "verified" --');
for (const v of ['physical', 'screen_or_reproduction', 'uncertain', null, undefined, 'bogus', 7]) {
  ok(deriveCaptureAuthenticity(v).verified === false, `surface ${JSON.stringify(v)} -> verified:false`);
}
ok(deriveCaptureAuthenticity(undefined).status === 'NOT_ASSESSED', 'a missing/skipped assessment is NOT_ASSESSED (unknown), never PHYSICAL');
ok(deriveCaptureAuthenticity('physical').status === 'PHYSICAL_CLAIMED', "a model 'physical' read is only PHYSICAL_CLAIMED (a claim)");

console.log('\n-- 2. Street Fighter #1 production shape (screen photo) is contained --');
const streetFighter = () => ({
  title: 'street fighter', issue: '1', year: '1993', grade: 'VG 4.0', assetTypeConfident: true,
  foreignEdition: true, editionType: 'original', restoration: null, defectPenalty: 0.7,
  cgcPenaltyFlags: { cornerChips: { detected: true, count: 2 }, storeStamp: { detected: false, pedigreeName: null } },
  reason: 'Street Fighter #1 (1993) in raw condition showing moderate wear consistent with VG grade. Thai edition indicated by visible Thai-language text on cover masthead area. No restoration detected.',
  confidence: 'medium',
  captureSurface: 'screen_or_reproduction',
});
let r = ensureAssetType(streetFighter());
ok(r.captureAuthenticity.status === 'SCREEN_SUSPECTED' && r.captureAuthenticity.verified === false, 'screen capture -> SCREEN_SUSPECTED, verified:false');
ok(r.restoration === null && r.defectPenalty === null && r.cgcPenaltyFlags === null, 'restoration / defectPenalty / corner-chip flags are WITHHELD from a screen capture');
ok(Array.isArray(r.withheldPhysicalClaims) && r.withheldPhysicalClaims.includes('cgcPenaltyFlags') && r.withheldPhysicalClaims.includes('defectPenalty'), 'the withheld claims are RECORDED, not silently dropped');
ok(r.gradeProvisional === true && r.gradeProvisionalReason === 'capture-not-physical-evidence', 'grade annotated PROVISIONAL');
ok(r.grade === 'VG 4.0', 'the grade itself is NOT altered (annotation only)');
ok(r.referenceOnly === true, 'marked reference-only');
ok(r.reason === REFERENCE_ONLY_REASON && !/restoration detected|moderate wear|thai/i.test(r.reason), 'condition report replaced by the deterministic reference-only statement (no certainty from a screen)');
ok(r.foreignEdition === false && r.foreignEditionClaim?.status === 'UNSUPPORTED_DROPPED', 'the Thai/foreign claim has no transcription -> flag dropped, claim recorded as unsupported');
ok(r.title === 'street fighter' && r.issue === '1' && r.year === '1993', 'REFERENCE SCANNING PRESERVED: identity fields untouched');
ok(!('captureSurface' in r), 'raw model string is not part of the response');

console.log('\n-- 3. idempotent through repeated ensureAssetType passes --');
r = ensureAssetType(ensureAssetType(streetFighter()));
ok(r.captureAuthenticity.status === 'SCREEN_SUSPECTED' && r.referenceOnly === true, 'a second pass never downgrades SCREEN_SUSPECTED to NOT_ASSESSED');

console.log('\n-- 4. uncertain capture -> provisional, not reference-only --');
r = ensureAssetType({ ...streetFighter(), captureSurface: 'uncertain', foreignEdition: false });
ok(r.captureAuthenticity.status === 'UNCERTAIN' && r.gradeProvisional === true && r.referenceOnly === false, 'UNCERTAIN -> provisional (not reference-only)');
ok(r.reason === UNCERTAIN_CAPTURE_REASON && r.cgcPenaltyFlags === null, 'UNCERTAIN withholds physical-condition claims too');

console.log('\n-- 5. a physical-claimed capture keeps its model condition read (no over-blocking) --');
r = ensureAssetType({ ...streetFighter(), captureSurface: 'physical', foreignEdition: false, reason: 'Moderate spine wear, two corner chips.' });
ok(r.captureAuthenticity.status === 'PHYSICAL_CLAIMED' && r.captureAuthenticity.verified === false, "'physical' stays a CLAIM, never verified");
ok(r.cgcPenaltyFlags?.cornerChips?.count === 2 && r.defectPenalty === 0.7 && !r.gradeProvisional, 'physical-claimed capture keeps condition claims and is not provisional');

console.log('\n-- 6. skipped check never implies verification (older model output / watch path) --');
r = ensureAssetType({ title: 'x', issue: '1', publisher: 'p', year: '1999', grade: 'FN 6.0', cgcPenaltyFlags: { cornerChips: { detected: true, count: 1 } } });
ok(r.captureAuthenticity.status === 'NOT_ASSESSED' && r.captureAuthenticity.verified === false, 'no captureSurface -> NOT_ASSESSED, verified:false');
ok(r.cgcPenaltyFlags?.cornerChips?.count === 1, 'NOT_ASSESSED does not rewrite existing behavior (no silent regression for older paths)');

console.log('\n-- 7. foreign-edition claim needs a verbatim transcription --');
r = ensureAssetType({ ...streetFighter(), captureSurface: 'physical', reason: 'Light wear. Thai-language text on the masthead. No creases.' });
ok(r.foreignEdition === false && !/thai/i.test(r.reason || '') && r.droppedUnsupportedEditionClaims?.length === 1, 'without evidence: flag dropped AND the Thai sentence is scrubbed from the condition report (recorded)');
ok(/Light wear/.test(r.reason) && /No creases/.test(r.reason), 'unrelated condition sentences are kept');
r = ensureAssetType({ ...streetFighter(), captureSurface: 'physical', foreignEditionEvidence: '15p UK', reason: 'Price printed in pence.' });
ok(r.foreignEdition === true && r.foreignEditionClaim?.status === 'UNVERIFIED_CLAIM' && r.foreignEditionClaim.evidence === '15p UK', 'with transcribed evidence the flag stays, still labelled an UNVERIFIED claim');

console.log('\n-- 8. prompt + shapes carry the new fields; the Book shape is untouched --');
const gradeSrc = readFileSync(path.join(repoRoot, 'api', 'grade.js'), 'utf8');
const jsonShapeLine = gradeSrc.split('\n').find((l) => l.startsWith("  '{ \"title\": string, \"issue\": string"));
const gradeShapeLine = gradeSrc.split('\n').find((l) => l.startsWith('const GRADE_JSON_SHAPE'));
const bookShapeLine = gradeSrc.split('\n').find((l) => l.startsWith('const BOOK_JSON_SHAPE'));
ok(/"captureSurface":/.test(jsonShapeLine) && /"foreignEditionEvidence":/.test(jsonShapeLine), 'standard comic shape requests captureSurface + foreignEditionEvidence');
ok(/"captureSurface":/.test(gradeShapeLine) && /"foreignEditionEvidence":/.test(gradeShapeLine), 'grade-only (eBay-first) shape requests them too');
ok(!/captureSurface/.test(bookShapeLine), 'Book shape unchanged');
ok(/screen, monitor, TV, phone or tablet display/.test(gradeSrc) && /transcribe VERBATIM/.test(gradeSrc), 'prompt instructs screen detection and verbatim foreign-text transcription');

console.log('\n-- 9. ownership attestation: fixed statement, bare flag does not qualify --');
ok(normalizeOwnershipAttestation(buildOwnershipAttestation('t'))?.statement === OWNERSHIP_ATTESTATION_STATEMENT, 'the client builder satisfies the server normalizer');
for (const bad of [null, undefined, true, 'yes', {}, { attested: true }, { attested: 'true', version: 1, statement: OWNERSHIP_ATTESTATION_STATEMENT }, { attested: true, version: 1, statement: 'I own it' }, { attested: true, version: 2, statement: OWNERSHIP_ATTESTATION_STATEMENT }]) {
  ok(normalizeOwnershipAttestation(bad) === null, `rejected: ${JSON.stringify(bad)}`);
}

console.log('\n-- 10. real api/capture-scan.js: refusals happen before any work --');
const captureScanRoute = (await imp('api/capture-scan.js')).default;
const JIMMY = '01a0283a-b1b6-7f90-9b41-9c06bee6ecba';
const mintTestToken = (principalId) => {
  const now = Date.now();
  const payload = { principalId, iat: now, exp: now + 12 * 60 * 60 * 1000, epoch: process.env.GRAILKEY_SESSION_EPOCH || '1' };
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${b64}.${createHmac('sha256', process.env.GRAILKEY_SESSION_SECRET).update(b64).digest('base64url')}`;
};
const token = mintTestToken(JIMMY);
const mockRes = () => { const res = { statusCode: null, body: null, headers: {} }; res.setHeader = (k, v) => { res.headers[k] = v; }; res.status = (c) => { res.statusCode = c; return res; }; res.json = (b) => { res.body = b; return res; }; return res; };
const post = async (body) => { const res = mockRes(); await captureScanRoute({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body }, res); return res; };
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const photos = [{ bytes: PNG_B64, contentType: 'image/png', captureRole: 'capture-photo' }];

let res = await post({ assetClass: 'comic', scanPayload: { correlationId: randomUUID(), collectionItemId: 'never-created' }, photos, idempotencyKey: randomUUID() });
ok(res.statusCode === 400 && res.body?.code === 'OWNERSHIP_ATTESTATION_REQUIRED', `no attestation -> 400 OWNERSHIP_ATTESTATION_REQUIRED (got ${res.statusCode} ${res.body?.code})`);
res = await post({ assetClass: 'comic', ownershipAttestation: { attested: true }, scanPayload: { correlationId: randomUUID(), collectionItemId: 'never-created' }, photos, idempotencyKey: randomUUID() });
ok(res.statusCode === 400 && res.body?.code === 'OWNERSHIP_ATTESTATION_REQUIRED', 'a bare { attested: true } is refused');
res = await post({ assetClass: 'comic', ownershipAttestation: buildOwnershipAttestation('t'), scanPayload: { correlationId: randomUUID(), collectionItemId: 'never-created', captureAuthenticity: { status: 'SCREEN_SUSPECTED' } }, photos, idempotencyKey: randomUUID() });
// C3-R1 (2026-10-26): a model SCREEN_SUSPECTED read is ADVISORY, not a refusal - an attested capture proceeds past the screen gate.
ok(res.body?.code !== 'CAPTURE_REFERENCE_ONLY', `attested but scan-flagged SCREEN_SUSPECTED is no longer refused at a screen gate (got ${res.statusCode} ${res.body?.code})`);

console.log('\n-- 11. real handler + real Development DB: attested capture records the assertion durably --');
const client = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query('SET search_path TO data1_dev');
const { createCollectionItem } = await imp('src/modules/collection/index.js');
// letters-only random title: the GK-279 physical-copy guard compares catalogue similarity against everything this
// principal already owns, and earlier runs of this file leave permanent Development fixtures.
const UNIQUE = Array.from(randomBytes(10), (b) => String.fromCharCode(97 + (b % 26))).join('');
const ITEM_ID = `v1-p0d-${Date.now()}-${UNIQUE}`;
try {
  await createCollectionItem({ principalId: JIMMY, id: ITEM_ID, assetCategory: 'comic', attributes: { title: `Zqx ${UNIQUE}`, issue: '901', year: '1987' } });
  res = await post({
    assetClass: 'comic', ownershipAttestation: buildOwnershipAttestation('operator-panel'),
    scanPayload: { correlationId: randomUUID(), collectionItemId: ITEM_ID, captureAuthenticity: { status: 'PHYSICAL_CLAIMED', verified: true }, book: { title: `Zqx ${UNIQUE}`, issue: '901', year: '1987' }, outcome: { decisionAction: null, pricingSource: null, price: null, gradeMultiplier: null } },
    photos, idempotencyKey: randomUUID(),
  });
  ok(res.statusCode === 200 && !!res.body?.gkAssetId, `attested capture mints (got ${res.statusCode} ${JSON.stringify(res.body).slice(0, 120)})`);
  const ev = await client.query(`SELECT payload FROM domain_event WHERE event_type = 'asset.minted' AND subject->>'entity_id' = $1`, [res.body.gkAssetId]);
  const prov = ev.rows[0]?.payload?.provenance;
  ok(prov?.ownershipAttestation?.attested === true && prov.ownershipAttestation.statement === OWNERSHIP_ATTESTATION_STATEMENT && !!prov.ownershipAttestation.attestedAt, 'asset.minted event durably records the ownership ATTESTATION (statement + server receive time)');
  ok(prov?.captureAuthenticity?.status === 'PHYSICAL_CLAIMED' && prov.captureAuthenticity.verified === false, 'capture authenticity recorded as a CLAIM; a client-supplied verified:true is forced to false');
} finally {
  await client.query('DELETE FROM collection_item WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM collection_item_link WHERE collection_item_id = $1)', [ITEM_ID]).catch(() => {});
  await client.end();
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed ? 1 : 0);
