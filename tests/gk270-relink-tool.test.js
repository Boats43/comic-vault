// tests/gk270-relink-tool.test.js
//
// GK-270 -- bounded historical collection-link reconciliation tool. Real Development DB, the real
// CLI tool run as a child process, the real api/assets.js handler for the read-path checks.
// The asset-level event tables are append-only, so this suite's principals/assets/events are RETAINED
// by design (assertions are scoped to this run's own fresh fixtures).
//
// Invoke: node tests/gk270-relink-tool.test.js

import { readFileSync } from 'node:fs';
import { createHmac, randomBytes, randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { Client } from 'pg';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const line of readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}
process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'development';
if (!process.env.GRAILKEY_SESSION_SECRET) process.env.GRAILKEY_SESSION_SECRET = randomBytes(32).toString('base64url');

let passed = 0, failed = 0; const failures = [];
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; failures.push(l); console.log(`  ✗ ${l}`); } };
const eq = (a, b, l) => ok(JSON.stringify(a) === JSON.stringify(b), `${l} (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`);

console.log('\n=== GK-270 -- pinned collection-link reconciliation tool (real Development DB) ===\n');

const assets = await import('../src/modules/assets/index.js');
const mapping = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'capture', 'mapping.js')));
const bridge = await import('../src/lib/outcome1RuntimeBridge.js');
const learning = await import('../src/modules/learning/index.js');
const collection = await import('../src/modules/collection/index.js');
const { default: assetsHandler } = await import('../api/assets.js');

const TAG = `gk270-${Date.now()}`;
const db = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
await db.query('SET search_path TO data1_dev');
const mintToken = (principalId) => {
  const payload = { principalId, iat: Date.now(), exp: Date.now() + 12 * 3600 * 1000, epoch: process.env.GRAILKEY_SESSION_EPOCH || '1' };
  const b = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${b}.${createHmac('sha256', process.env.GRAILKEY_SESSION_SECRET).update(b).digest('base64url')}`;
};
const canon = (v) => { if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null); if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']'; return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}'; };
const hashOf = async (id) => createHash('sha256').update(canon((await db.query('SELECT attributes FROM collection_item WHERE id=$1', [id])).rows[0].attributes)).digest('hex');
const tool = (args) => { const r = spawnSync(process.execPath, ['scripts/gk270-relink-collection-projection.mjs', 'development', ...args], { cwd: repoRoot, encoding: 'utf8' }); let json = null; try { json = JSON.parse(r.stdout.slice(r.stdout.indexOf('{'), r.stdout.lastIndexOf('}') + 1)); } catch {} return { status: r.status, json, stdout: r.stdout, stderr: r.stderr }; };
const linkOf = async (assetId) => (await db.query('SELECT collection_item_id FROM collection_item_link WHERE gk_asset_id=$1', [assetId])).rows.map((r) => r.collection_item_id);

const P = randomUUID(), P2 = randomUUID();
for (const [id, n] of [[P, 'A'], [P2, 'B']]) await db.query(`INSERT INTO gk_principal (id, display_name, kind) VALUES ($1,$2,'user')`, [id, `${TAG}-${n}`]);

// A fresh fixture: asset + SERVER_DERIVED valuation/decision + a thin stub linked + a rich unlinked row with LEGACY client attributes.
let seq = 0;
async function fixture({ principal = P, richPrincipal = principal } = {}) {
  const n = ++seq;
  const basis = mapping.buildCaptureBasis(principal, { correlationId: `${TAG}-s${n}`, scanlogKey: `${TAG}-sl${n}`, book: { title: `GK-270 fixture ${n}` } });
  const mint = await assets.createPhysicalAsset({ principalId: principal, captureBasis: basis, assetClass: 'comic', source: 'gk270-test', idempotencyKey: `${TAG}:mint${n}` });
  const stub = `${TAG}-stub${n}`, rich = `${TAG}-rich${n}`;
  await db.query(`INSERT INTO collection_item (id, principal_id, asset_category, attributes) VALUES ($1,$2,'comic',$3)`, [stub, principal, JSON.stringify({ title: 'fixture stub', issue: '1', year: 1990 })]);
  await db.query(`INSERT INTO collection_item (id, principal_id, asset_category, attributes) VALUES ($1,$2,'comic',$3)`, [rich, richPrincipal, JSON.stringify({
    title: 'fixture rich', issue: '1', year: '1990', publisher: 'Marvel', price: '$999.99', pricingSource: 'active_ask_derived',
    decision: { action: 'RESEARCH' }, comps: { count: 21 }, grade: 'NM 9.2', modelPredictedGrade: 'NM 9.2', remoteImages: ['blob:x'],
  })]);
  await assets.linkCollectionItem({ principalId: principal, collectionItemId: stub, gkAssetId: mint.assetId, idempotencyKey: `${TAG}:link${n}` });
  const fp = bridge.computeEconomicDecisionFingerprint({ principalId: principal, gkAssetId: mint.assetId, valueAmount: 263.8, gradeAssumption: 4, evidenceKey: 'k', recommendation: 'LIST_NOW', reasonCodes: [], buildSha: 'abc1234' });
  const econ = await assets.recordEconomicDecision({ principalId: principal, gkAssetId: mint.assetId, valueAmount: 263.8, buildSha: 'abc1234', recommendation: 'LIST_NOW', reasonCodes: [], gradeAssumption: 4, semanticFingerprint: fp, correlationId: randomUUID() });
  return { assetId: mint.assetId, stub, rich, econ, principal };
}
const args = (f, over = {}) => ['--asset', over.asset ?? f.assetId, '--from', over.from ?? f.stub, '--to', over.to ?? f.rich];

try {
  console.log('-- default is DRY RUN; wildcards are rejected --\n');
  const f0 = await fixture();
  const stubHash0 = await hashOf(f0.stub), richHash0 = await hashOf(f0.rich);
  const dry = tool(args(f0));
  eq(dry.json?.mode, 'DRY-RUN', 'default mode is DRY-RUN');
  ok(/DRY-RUN-OK/.test(dry.json?.result || ''), 'dry run reports what it would do');
  eq(await linkOf(f0.assetId), [f0.stub], 'dry run changed NOTHING (link still on the stub)');
  ok(tool(['--asset', f0.assetId, '--from', f0.stub, '--to', '%']).status === 2, 'a wildcard target is rejected before any DB work');
  ok(tool(['--asset', f0.assetId, '--from', f0.stub, '--to', f0.stub]).status === 2, 'from == to is rejected');

  console.log('\n-- A/G/H/I/J. valid pinned pair applied --\n');
  const histBefore = dry.json.before.history;
  const apply = tool([...args(f0), '--apply']);
  eq(apply.json?.result, 'APPLIED', 'A: valid pinned pair -> APPLIED');
  eq(await linkOf(f0.assetId), [f0.rich], 'A: the routing edge now points at the rich row, exactly one link for the asset');
  eq(apply.json.after.links.map((l) => l.gk_asset_id), [f0.assetId], 'G: gkAssetId unchanged on the link');
  eq(apply.json.after.history, histBefore, 'H: every asset-level event id is unchanged (valuation/decision/ownership/inventory/media/actions/outcomes/corrections)');
  eq(await hashOf(f0.rich), richHash0, 'I: target attributes byte-identical');
  eq(await hashOf(f0.stub), stubHash0, 'J: source (stub) attributes byte-identical (not deleted, not modified)');
  eq((await db.query('SELECT count(*)::int n FROM collection_item WHERE id = ANY($1)', [[f0.stub, f0.rich]])).rows[0].n, 2, 'no collection row was created or deleted');

  console.log('\n-- K/L/M. authority stays asset-event sourced (real api/assets.js handler) --\n');
  const callAssets = async (principal, collectionItemId) => { const res = { statusCode: null, body: null, status(c) { this.statusCode = c; return this; }, json(d) { this.body = d; return this; }, setHeader() {} }; await assetsHandler({ method: 'GET', headers: { authorization: `Bearer ${mintToken(principal)}`, 'x-forwarded-for': `10.70.${Date.now() % 250}.${++seq % 250}` }, query: { collectionItemId } }, res); return res; };
  const viaRich = await callAssets(P, f0.rich);
  eq(viaRich.statusCode, 200, 'the rich collection id now resolves to the asset');
  const g = viaRich.body.asset;
  const cur = g.valuations.find((v) => v.id === g.currentValuationId);
  eq([Number(cur.value_amount), cur.provenance], [263.8, 'SERVER_DERIVED'], 'K: the current valuation is the SERVER_DERIVED event value');
  ok(!JSON.stringify(g).includes('999.99'), 'L: the legacy collection price ($999.99) appears nowhere in the asset projection');
  eq(g.decisions.find((d) => d.id === g.currentDecisionId).recommendation, 'LIST_NOW', 'L: the current decision is the event-sourced LIST_NOW, not the legacy RESEARCH attribute');
  ok(!JSON.stringify(g).includes('NM 9.2'), 'M: the legacy client model grade appears nowhere in the asset projection');
  eq((await db.query(`SELECT count(*)::int n FROM organic_model_prediction_event WHERE principal_id=$1`, [P])).rows[0].n, 0, 'M: the legacy model grade created no model_prediction_event (organic corpus unchanged)');
  const viaStub = await callAssets(P, f0.stub);
  eq(viaStub.statusCode, 404, 'the old stub id no longer resolves to the asset');

  console.log('\n-- F. identical second apply is idempotent --\n');
  const again = tool([...args(f0), '--apply']);
  eq(again.json?.result, 'ALREADY-APPLIED', 'F: second identical apply -> ALREADY-APPLIED');
  eq(await linkOf(f0.assetId), [f0.rich], 'F: no additional mutation');

  console.log('\n-- B. wrong expected current id --\n');
  const fB = await fixture();
  const other = `${TAG}-other-b`;
  await db.query(`INSERT INTO collection_item (id, principal_id, asset_category, attributes) VALUES ($1,$2,'comic','{"title":"third"}')`, [other, P]);
  const rB = tool(args(fB, { from: other }));
  eq([rB.status, rB.json?.refusal?.code], [3, 'LINK_NOT_ON_EXPECTED_STUB'], 'B: pinning the wrong "current" id is REFUSED');
  eq(await linkOf(fB.assetId), [fB.stub], 'B: link unchanged');

  console.log('\n-- C. wrong principal --\n');
  const fC = await fixture({ principal: P, richPrincipal: P2 });
  const rC = tool([...args(fC), '--apply']);
  eq([rC.status, rC.json?.refusal?.code], [3, 'PRINCIPAL_MISMATCH'], 'C: target owned by a different principal is REFUSED');
  eq(await linkOf(fC.assetId), [fC.stub], 'C: link unchanged');

  console.log('\n-- D. target linked elsewhere --\n');
  const fD = await fixture(); const fD2 = await fixture();
  const rD = tool([...args(fD, { to: fD2.stub }), '--apply']);
  eq([rD.status, rD.json?.refusal?.code], [3, 'TARGET_ALREADY_LINKED'], 'D: a target already linked to another asset is REFUSED');
  eq([await linkOf(fD.assetId), await linkOf(fD2.assetId)], [[fD.stub], [fD2.stub]], 'D: neither link changed');

  console.log('\n-- forbidden learning/governance reference --\n');
  const fR = await fixture();
  await collection.applyGradingAuthorityPatch({ principalId: P, id: fR.rich, patch: { operatorGrade: 'VF 8.0', operatorGradeNumeric: 8, operatorGradeSetAt: Date.now(), gradeAuthority: 'OPERATOR_CONFIRMED' }, correction: { source: 'test' } });
  const rR = tool([...args(fR), '--apply']);
  eq([rR.status, rR.json?.refusal?.code], [3, 'FORBIDDEN_REFERENCE'], 'a learning event referencing the target id -> REFUSED');
  eq(await linkOf(fR.assetId), [fR.stub], 'link unchanged');

  console.log('\n-- E. failure after UPDATE, before COMMIT -> original link restored --\n');
  const fE = await fixture();
  await db.query(`CREATE OR REPLACE FUNCTION gk270_fail_commit() RETURNS trigger AS $$ BEGIN IF NEW.collection_item_id = '${fE.rich}' THEN RAISE EXCEPTION 'gk270 injected failure at commit'; END IF; RETURN NULL; END; $$ LANGUAGE plpgsql`);
  await db.query(`CREATE CONSTRAINT TRIGGER gk270_fail_commit_trg AFTER UPDATE ON collection_item_link DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gk270_fail_commit()`);
  try {
    const rE = tool([...args(fE), '--apply']);
    ok(rE.status === 1 && /injected failure at commit/.test(rE.stderr), 'E: the injected failure fired at COMMIT, after the UPDATE ran');
    eq(await linkOf(fE.assetId), [fE.stub], 'E: the original link is restored (nothing committed)');
  } finally {
    await db.query('DROP TRIGGER IF EXISTS gk270_fail_commit_trg ON collection_item_link');
    await db.query('DROP FUNCTION IF EXISTS gk270_fail_commit()');
  }
  const rE2 = tool([...args(fE), '--apply']);
  eq(rE2.json?.result, 'APPLIED', 'control: without the injected failure the same pair applies');
} finally {
  await db.end();
  await assets.closePool?.(); await collection.closePool?.(); await learning.closePool?.();
  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) { console.log('FAILURES:'); failures.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
  process.exit(0);
}
