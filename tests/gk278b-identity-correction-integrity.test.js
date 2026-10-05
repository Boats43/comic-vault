// tests/gk278b-identity-correction-integrity.test.js
//
// GK-278B -- IDENTITY CORRECTION CORPUS INTEGRITY. For an append-only learning corpus
//   operator_correction_event.after  ==  durable current-state value  ==  the validated value
// must hold, and a client's ordinary save must not be able to make them diverge.
//
// Real Development DB, real /api/enrich + /api/collection handlers (mocked fetch only).
// The event tables are append-only; this suite's events/principal are retained by design.
//
// Invoke: node tests/gk278b-identity-correction-integrity.test.js

import { readFileSync } from 'node:fs';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const line of readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}
process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'development';
if (!process.env.GRAILKEY_SESSION_SECRET) process.env.GRAILKEY_SESSION_SECRET = randomBytes(32).toString('base64url');
process.env.EBAY_APP_ID = process.env.EBAY_APP_ID || 'test-app-id';
process.env.EBAY_CERT_ID = process.env.EBAY_CERT_ID || 'test-cert-id';
process.env.PRICECHARTING_TOKEN = process.env.PRICECHARTING_TOKEN || 'test-pc-token';

let passed = 0, failed = 0; const failures = [];
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; failures.push(l); console.log(`  ✗ ${l}`); } };
const eq = (a, b, l) => ok(JSON.stringify(a) === JSON.stringify(b), `${l} (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`);
const rejects = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

console.log('\n=== GK-278B -- identity correction: event.after == durable value == validated value ===\n');

const TAG = `gk278b-${Date.now()}`;
const mintToken = (principalId) => {
  const payload = { principalId, iat: Date.now(), exp: Date.now() + 12 * 3600 * 1000, epoch: process.env.GRAILKEY_SESSION_EPOCH || '1' };
  const b = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${b}.${createHmac('sha256', process.env.GRAILKEY_SESSION_SECRET).update(b).digest('base64url')}`;
};
const client = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query('SET search_path TO data1_dev');
const PA = randomUUID();
await client.query(`INSERT INTO gk_principal (id, display_name, kind) VALUES ($1,$2,'user')`, [PA, `${TAG}-A`]);
const tokA = mintToken(PA);

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
global.fetch = async (url) => {
  const u = String(url);
  if (u.includes('oauth2/token') || u.includes('/oauth/')) return json({ access_token: 'x', expires_in: 7200, token_type: 'Application Access Token' });
  if (u.includes('search_by_image') || u.includes('item_summary/search')) return json({ itemSummaries: [], total: 0 });
  if (u.includes('comicvine.gamespot.com')) return json({ results: [], status_code: 1, error: 'OK' });
  if (u.includes('pricecharting.com')) return json({ products: [] });
  return json({});
};
const origLog = console.log;
const quiet = async (fn) => { console.log = () => {}; try { return await fn(); } finally { console.log = origLog; } };
const mkRes = () => { const r = { statusCode: null, body: null }; r.status = (c) => { r.statusCode = c; return r; }; r.json = (d) => { r.body = d; return r; }; r.setHeader = () => {}; return r; };
const { default: collectionHandler } = await import('../api/collection.js');
const { default: enrichHandler } = await import('../api/enrich.js');
const { default: Jimp } = await import('jimp');
const PNG = (await new Jimp(64, 64, 0xff0000ff).getBufferAsync(Jimp.MIME_PNG)).toString('base64');
let ip = 0;
const coll = async (method, { id, body } = {}) => { const r = mkRes(); await quiet(() => collectionHandler({ method, headers: { authorization: `Bearer ${tokA}`, 'x-forwarded-for': `10.81.${Date.now() % 250}.${++ip % 250}` }, query: id ? { id } : {}, body }, r)); return r; };
const correct = async (id, field, value, prior) => {
  const r = mkRes();
  await quiet(() => enrichHandler({ method: 'POST', headers: { authorization: `Bearer ${tokA}`, 'x-forwarded-for': `10.82.${Date.now() % 250}.${++ip % 250}` }, body: {
    title: 'Creepy', issue: '98', year: '1964', publisher: 'Warren', grade: 'VG 4.0', confidence: 'medium', isGraded: false, numericGrade: null,
    [field]: value, images: [`data:image/png;base64,${PNG}`], skipVision: true, skipImageSearch: true, manualIdentity: true, identitySource: 'manual',
    manualAuthority: { correctedBy: 'operator', correctedFields: [field] },
    priorIdentity: { title: 'Creepy', issue: '98', year: '1964', publisher: 'Warren', ...(prior || {}) },
    collectionItemId: id, ownedRefresh: true,
  } }, r));
  return r;
};
const attrs = async (id) => (await client.query('SELECT attributes FROM collection_item WHERE principal_id=$1 AND id=$2', [PA, id])).rows[0]?.attributes;
const events = async (id) => (await client.query(`SELECT * FROM operator_correction_event WHERE principal_id=$1 AND collection_item_id=$2 AND surface='IDENTITY' ORDER BY id`, [PA, id])).rows;
const seed = async (id) => { await coll('POST', { body: { assetCategory: 'comic', id, attributes: { title: 'Creepy', issue: '98', year: '1964', publisher: 'Warren' } } }); };

try {
  console.log('-- A. validated issue correction 98 -> 99: ONE transaction --\n');
  const A = `${TAG}-A`; await seed(A);
  const rA = await correct(A, 'issue', '99');
  eq(rA.statusCode, 200, 'enrich correction request: 200');
  const evA = await events(A);
  eq(evA.length, 1, 'exactly one IDENTITY correction event');
  eq(evA[0]?.before_value, { issue: '98' }, 'event.before = 98 (read from the durable row)');
  eq(evA[0]?.after_value, { issue: '99' }, 'event.after = 99 (validated)');
  eq((await attrs(A)).issue, '99', 'durable issue = 99 -- written by the SERVER in the same transaction');
  eq((await attrs(A)).identityAuthority, { issue: 'OPERATOR_CONFIRMED' }, 'authority mutation committed');
  eq(Object.keys(evA[0]?.after_value || {}).sort(), ['issue'], 'only the corrected field is in the event (no unrelated identity fields globally server-owned)');
  eq((await attrs(A)).title, 'Creepy', 'unrelated identity field (title) untouched');

  console.log('\n-- B/E. client tries to persist a DIFFERENT value afterwards --\n');
  let r = await coll('PUT', { id: A, body: { attributes: { title: 'Creepy', issue: '97', year: '1964', publisher: 'Warren' } } });
  eq(r.statusCode, 200, 'ordinary save accepted as a request');
  eq((await attrs(A)).issue, '99', 'B: durable issue stays 99 -- client 97 cannot win');
  eq((await events(A))[0].after_value, { issue: '99' }, 'B: event.after still equals the durable value');
  r = await coll('POST', { body: { assetCategory: 'comic', id: A, attributes: { title: 'Creepy', issue: '96', year: '1964', publisher: 'Warren' } } });
  eq((await attrs(A)).issue, '99', 'E: upsert (ON CONFLICT) cannot replace the corrected value');
  await coll('PUT', { id: A, body: { attributes: { title: 'Creepy', issue: null } } });
  eq((await attrs(A)).issue, '99', 'E: explicit null cannot clear the corrected value');
  await coll('PUT', { id: A, body: { attributes: { title: 'Creepy' } } });
  eq((await attrs(A)).issue, '99', 'E: omission cannot drop the corrected value');
  await coll('PUT', { id: A, body: { attributes: { title: 'Creepy', issue: '99', year: '1999', publisher: 'Warren' } } });
  eq((await attrs(A)).year, '1999', 'an UNLOCKED facet (year) still changes via the ordinary write -- only corrected facets are protected');
  eq((await events(A)).length, 1, 'no second event from ordinary saves');

  console.log('\n-- a NEW validated transition may change the protected value --\n');
  await correct(A, 'issue', '100', { issue: '99' });
  eq((await attrs(A)).issue, '100', 'a new validated correction updates the value');
  const evA2 = await events(A);
  eq(evA2.length, 2, 'appended a second event (history, not overwrite)');
  eq([evA2[1].before_value, evA2[1].after_value], [{ issue: '99' }, { issue: '100' }], 'second event chain 99 -> 100');
  eq(evA2[0].after_value, { issue: '99' }, 'first event unchanged');

  console.log('\n-- C/D. injected failures: no event, no value, no authority --\n');
  const C = `${TAG}-C`; await seed(C);
  await client.query(`CREATE OR REPLACE FUNCTION gk278b_fail_event() RETURNS trigger AS $$ BEGIN IF NEW.collection_item_id = '${C}' THEN RAISE EXCEPTION 'gk278b injected event failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
  await client.query(`CREATE TRIGGER gk278b_fail_event_trg BEFORE INSERT ON operator_correction_event FOR EACH ROW EXECUTE FUNCTION gk278b_fail_event()`);
  const collection = await import('../src/modules/collection/index.js');
  try {
    const e = await rejects(() => collection.applyIdentityAuthorityPatch({ principalId: PA, id: C, identityAuthority: { issue: 'OPERATOR_CONFIRMED' }, correction: { fields: ['issue'], afterValues: { issue: '99' }, source: 'test' } }));
    ok(e && /injected event failure/.test(e.message), 'C: the event insert failed (injected) AFTER the value+authority mutation ran');
    const a = await attrs(C);
    eq([a.issue, 'identityAuthority' in a], ['98', false], 'C: durable value and authority both rolled back');
    eq((await events(C)).length, 0, 'C: no correction event survives');
  } finally {
    await client.query('DROP TRIGGER IF EXISTS gk278b_fail_event_trg ON operator_correction_event');
    await client.query('DROP FUNCTION IF EXISTS gk278b_fail_event()');
  }
  const D = `${TAG}-D`; await seed(D);
  await client.query(`CREATE OR REPLACE FUNCTION gk278b_fail_commit() RETURNS trigger AS $$ BEGIN IF NEW.collection_item_id = '${D}' THEN RAISE EXCEPTION 'gk278b injected failure at commit'; END IF; RETURN NULL; END; $$ LANGUAGE plpgsql`);
  await client.query(`CREATE CONSTRAINT TRIGGER gk278b_fail_commit_trg AFTER INSERT ON operator_correction_event DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION gk278b_fail_commit()`);
  try {
    const e = await rejects(() => collection.applyIdentityAuthorityPatch({ principalId: PA, id: D, identityAuthority: { issue: 'OPERATOR_CONFIRMED' }, correction: { fields: ['issue'], afterValues: { issue: '99' }, source: 'test' } }));
    ok(e && /injected failure at commit/.test(e.message), 'D: the failure fired at COMMIT, after value, authority and event were all written');
    const a = await attrs(D);
    eq([a.issue, 'identityAuthority' in a], ['98', false], 'D: everything rolled back (value + authority)');
    eq((await events(D)).length, 0, 'D: no event survives');
  } finally {
    await client.query('DROP TRIGGER IF EXISTS gk278b_fail_commit_trg ON operator_correction_event');
    await client.query('DROP FUNCTION IF EXISTS gk278b_fail_commit()');
  }
  const ctl = await collection.applyIdentityAuthorityPatch({ principalId: PA, id: D, identityAuthority: { issue: 'OPERATOR_CONFIRMED' }, correction: { fields: ['issue'], afterValues: { issue: '99' }, source: 'test' } });
  ok(ctl.correctionEventIds.length === 1 && (await attrs(D)).issue === '99', 'control: without injection, value + authority + event commit together');

  console.log('\n-- legacy / un-corrected items remain ordinary --\n');
  const L = `${TAG}-L`; await seed(L);
  await coll('PUT', { id: L, body: { attributes: { title: 'Creepy', issue: '55', year: '1964', publisher: 'Warren' } } });
  eq((await attrs(L)).issue, '55', 'an item with NO operator-confirmed facet remains freely editable (no behavior change)');
} finally {
  await client.end();
  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) { console.log('FAILURES:'); failures.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
  process.exit(0);
}
