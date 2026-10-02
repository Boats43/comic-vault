// GK-248 (partial progress) — integrity of the COMMITTED real fixtures.
// Real captured scan fixtures are scarce; this proves what is committed is
// valid, unmodified, secret/PII-free, correctly typed, and that operator
// labels are never called "truth".
// Run: node tests/gk248-real-fixture-integrity.test.js
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };
const root = new URL('./fixtures/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SECRET_KEY_RE = /principal|token|bearer|secret|password|authorization|api[_-]?key|email|username|seller|collectionItemId|userId|credential|cookie/i;
const SECRET_VAL_RE = /\bsk-ant-|Bearer\s+[A-Za-z0-9._-]{12,}|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}|-----BEGIN/i;
const scan = (o, p = '') => {
  const hits = [];
  if (o && typeof o === 'object') for (const k of Object.keys(o)) { if (SECRET_KEY_RE.test(k)) hits.push(`key:${p}.${k}`); hits.push(...scan(o[k], `${p}.${k}`)); }
  else if (typeof o === 'string' && SECRET_VAL_RE.test(o)) hits.push(`val:${p}`);
  return hits;
};

console.log('\n=== GK-248 committed real-fixture integrity ===\n');
console.log('— REAL_CAPTURE scan fixtures —');
const dir = path.join(root, 'real-captures');
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
ok(manifest.fixtures.length === 5, `manifest lists 5 real captures (got ${manifest.fixtures.length})`);
ok(manifest.fixtures.every((f) => f.sourceType === 'REAL_CAPTURE'), 'every entry is typed REAL_CAPTURE');
ok(manifest.fixtures.every((f) => f.labels.operatorLabel === null && f.labels.adjudication === null), 'no real capture claims an operator label or adjudication');
ok(/no ground truth/i.test(manifest.purpose), 'manifest states these are frozen engine output, not ground truth');
const seenTrace = new Set();
for (const e of manifest.fixtures) {
  const text = fs.readFileSync(path.join(dir, e.file), 'utf8');
  let j = null; try { j = JSON.parse(text); } catch { /* parse flag below */ }
  ok(j !== null, `${e.file}: parseable JSON`);
  if (!j) continue;
  ok(crypto.createHash('sha256').update(text.split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))).digest('hex') === e.sha256, `${e.file}: identical to what was validated (sha256, line endings normalized)`);
  ok(j.fixtureSchemaVersion === 1 && j.identity?.title && j.pricingResult && j.pricingEvidence, `${e.file}: fixtureShape v1 (identity, pricingEvidence, pricingResult)`);
  ok(Object.keys(j).length === e.topLevelFieldCount, `${e.file}: field count ${e.topLevelFieldCount}`);
  ok((j.pricingEvidence.soldComps || []).length === e.recordCounts.soldComps && (j.pricingEvidence.rawComps?.prices || []).length === e.recordCounts.rawCompsPrices, `${e.file}: record counts match (sold ${e.recordCounts.soldComps}, raw ${e.recordCounts.rawCompsPrices})`);
  ok(scan(j).length === 0, `${e.file}: no secret / PII / principal / seller / image material`);
  ok(!seenTrace.has(j.traceId), `${e.file}: unique traceId`); seenTrace.add(j.traceId);
  ok(!JSON.stringify(j).includes('data:image'), `${e.file}: no embedded image bytes`);
}
ok(!fs.readdirSync(dir).some((f) => /\(1\)|diagnostics/.test(f)), 'the empty GK-236 export and diagnostics files were NOT committed');
ok(manifest.excluded.some((x) => /EMPTY/.test(x.reason)) && manifest.excluded.some((x) => /DUPLICATE/.test(x.reason)), 'exclusions are recorded with reasons (empty export, duplicate traceId)');

console.log('\n— PREDICTION_VS_OPERATOR_LABEL records (real Production, read-only export) —');
const pdir = path.join(root, 'prediction-vs-label');
const pfiles = fs.readdirSync(pdir).filter((f) => f.endsWith('.json'));
ok(pfiles.length === 3, `3 prediction/label pairs (got ${pfiles.length})`);
for (const f of pfiles) {
  const text = fs.readFileSync(path.join(pdir, f), 'utf8');
  const j = JSON.parse(text);
  ok(j.fixtureKind === 'PREDICTION_VS_OPERATOR_LABEL' && j.sourceType === 'REAL_PRODUCTION_RECORD', `${f}: typed REAL_PRODUCTION_RECORD pair`);
  ok(j.historicalPredictionClaim?.grade && j.operatorLabel?.grade && j.assetIdentity?.title, `${f}: asset identity + historicalPredictionClaim + operatorLabel present`);
  ok(!('truth' in j) && !('groundTruth' in j) && !JSON.stringify(Object.keys(j.operatorLabel)).match(/truth/i) && !JSON.stringify(Object.keys(j.historicalPredictionClaim)).match(/truth/i), `${f}: operator label is a LABEL, never "truth"/"groundTruth"`);
  ok(['provider', 'model', 'modelVersion', 'promptVersion'].every((k) => j.historicalPredictionClaim[k] === 'UNKNOWN'), `${f}: provider/model/version/prompt are UNKNOWN (never inferred)`);
  ok(j.historicalPredictionClaim.sourceStanding === 'CLIENT_REPORTED_UNCORROBORATED' && !('modelPrediction' in j), `${f}: prediction is a client-reported historical claim, not a verified model output`);
  ok(j.adjudication === null, `${f}: no adjudicated answer claimed`);
  ok(scan(j).length === 0 && !/"(id|principalId|collectionItemId|gkAssetId)"/.test(text), `${f}: no principal ID, item ID, credential or PII`);
  ok(j.labelDiffersFromPrediction === (j.operatorLabel.grade !== j.historicalPredictionClaim.grade) && j.labelDiffersFromPrediction === true, `${f}: operator label differs from the first model grade`);
}

console.log('\n— corpus classes (do not conflate) —');
console.log('  SYNTHETIC REGRESSION : 393 test files (behavioural; not counted as ground truth)');
console.log(`  REAL CAPTURE         : ${manifest.fixtures.length} committed (+2 on phone, not on this machine)`);
console.log(`  OPERATOR-LABELED     : ${pfiles.length} prediction-vs-label records (labels, not truth)`);
console.log('  ADJUDICATED          : 0');
console.log('  REALIZED-OUTCOME     : 0 (no real SOLD row exists)');

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed ? 1 : 0);
