// WATCH provenance — persisted model_prediction_event proof against the REAL Development database.
// TICKET: UNASSIGNED. Real api/grade.js WATCH handler + real learning module + real Development Postgres.
// Mocked: global fetch (Anthropic transport only) and the receipt store (in-memory stand-in for KV).
// NO paid call. NO Production access (GRAILKEY_CATALOG_ENVIRONMENT is pinned to development and the environment
// marker is asserted before anything is written).
//
// Convention (GK-278 / GK-265/266): model_prediction_event is append-only by DB trigger, so this suite's rows and its
// fixture principal are RETAINED (never deleted); every assertion is scoped to this run's own principal/result ids.
//   node tests/watch-provenance-persisted-live.test.js

import { readFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
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
process.env.ANTHROPIC_API_KEY = 'test-anthropic-key-unused'; // forced: never a real key in this suite
process.env.EBAY_APP_ID = process.env.EBAY_APP_ID || 'test-app-id';
process.env.EBAY_CERT_ID = process.env.EBAY_CERT_ID || 'test-cert-id';

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };
const logAll = console.log;

const client = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query('SET search_path TO data1_dev');
const marker = (await client.query('SELECT app_env FROM data1_dev.environment_marker')).rows;
const dbName = (await client.query('SELECT current_database() AS d')).rows[0].d;
if (marker.length !== 1 || marker[0].app_env !== 'development') {
  console.log(`REFUSING TO RUN: environment_marker is not exactly development (${JSON.stringify(marker)})`);
  process.exit(2);
}
const hostLabel = (() => { try { return new URL(process.env.GRAILKEY_CATALOG_DATABASE_URL).hostname.split('.')[0]; } catch { return 'unparseable'; } })();
console.log(`\n=== WATCH provenance — persisted rows, real Development DB (marker=development, database=${dbName}, endpoint=${hostLabel}) ===\n`);

const TAG = `watch-prov-${Date.now()}`;
const PRINCIPAL = randomUUID();
await client.query(`INSERT INTO gk_principal (id, display_name, kind) VALUES ($1,$2,'user')`, [PRINCIPAL, TAG]);

const countTables = ['valuation_event', 'decision_event', 'outcome_event', 'operator_action_event', 'gk_asset', 'inventory_current_state'];
const snap = async () => {
  const o = {};
  for (const t of countTables) {
    try { o[t] = Number((await client.query(`SELECT count(*)::int AS n FROM data1_dev.${t}`)).rows[0].n); } catch { o[t] = 'n/a'; }
  }
  return o;
};
const before = await snap();

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const base = (o) => ({ title: 'Creepy', issue: '1', publisher: 'Warren', year: '1964', assetTypeConfident: true, foreignEdition: false, isReprint: false, editionType: 'original', grade: 'VG 4.0', isGraded: false, numericGrade: null, certNumber: null, labelType: null, labelNotes: null, keyIssue: null, variant: null, creator: null, price: '$20', priceLow: '$10', priceHigh: '$30', reason: 'Moderate wear.', confidence: 'high', detectedPrice: null, restoration: null, defectPenalty: null, cgcPenaltyFlags: null, ...o });
let script = []; let n = 0; let omitModel = false; const realFetch = global.fetch;
global.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('count_tokens')) return json({ input_tokens: 1 });
  if (u.includes('api.anthropic.com')) {
    const requested = JSON.parse(init.body).model; n += 1;
    const body = { id: 'm' + n, type: 'message', role: 'assistant', model: `reported::${requested}::${TAG}::call${n}`, content: [{ type: 'text', text: JSON.stringify(script[n - 1] ?? script[script.length - 1]) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1000, output_tokens: 500 } };
    if (omitModel) delete body.model;
    return json(body);
  }
  return realFetch(url, init); // no other outbound traffic is expected; anything else would be a real call (none are made by the WATCH path)
};
const rs = await import('../src/lib/researchStore.js'); rs.setResearchStoreForTests(rs.createMemoryResearchStore());
const receiptLib = await import('../src/lib/gradeReceipt.js');
const rmem = new Map();
receiptLib.__setReceiptStoreForTests({ async set(k, v) { rmem.set(k, JSON.parse(JSON.stringify(v))); }, async get(k) { return rmem.has(k) ? JSON.parse(JSON.stringify(rmem.get(k))) : null; }, async getdel(k) { const v = rmem.get(k) ?? null; rmem.delete(k); return v; } });
const { issueToken } = await import('../src/modules/auth/token.js');
const TOKEN = issueToken({ principalId: PRINCIPAL }).token;
const { default: handler } = await import('../api/grade.js');
const { default: Jimp } = await import('jimp');
const PNG = (await new Jimp(64, 64, 0xff0000ff).getBufferAsync(Jimp.MIME_PNG)).toString('base64');
let ip = 0;
const watch = async (resps, { omit = false } = {}) => {
  n = 0; script = resps; omitModel = omit;
  const logs = []; console.log = (...a) => { logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); };
  let status = null, body = null;
  const res = { status: (c) => ({ json: (d) => { status = c; body = d; } }), setHeader: () => {} };
  try { await handler({ method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'x-forwarded-for': `10.7.0.${++ip}` }, body: { images: [PNG], source: 'watch' } }, res); } finally { console.log = logAll; }
  const claim = body?.gradeReceiptId ? await receiptLib.claimGradeReceipt({ principalId: PRINCIPAL, receiptId: body.gradeReceiptId }) : null;
  const rec = claim?.ok ? claim.record : null;
  const rows = rec?.predictionEventId ? (await client.query(`SELECT id, principal_id, surface, result_id, provider, model, model_version, prompt_version, build_sha, prediction FROM data1_dev.model_prediction_event WHERE principal_id=$1 AND result_id=$2 ORDER BY surface`, [PRINCIPAL, rec.resultId])).rows : [];
  return { status, body, rec, rows, calls: n, logs };
};
const HI = base({ confidence: 'high' }), LOW = base({ confidence: 'low' });

const persisted = [];
const check = (label, r, { model, modelVersion, calls }) => {
  ok(r.status === 200 && r.calls === calls, `${label}: handler 200, ${calls} model call(s)`);
  ok(r.rows.length === 1 && r.rows[0].surface === 'GRADE', `${label}: exactly one GRADE prediction row persisted (no IDENTITY/CONDITION rows for a WATCH grade)`);
  const row = r.rows[0];
  ok(row?.id === r.rec?.predictionEventId, `${label}: receipt.predictionEventId === persisted row id (${row?.id})`);
  ok(row?.model === model, `${label}: persisted model (requested) === ${model}`);
  ok(row?.model_version === modelVersion, `${label}: persisted model_version (reported) === ${modelVersion}`);
  ok(row?.provider === 'anthropic', `${label}: persisted provider anthropic`);
  ok(row?.model === r.rec?.model && row?.model_version === r.rec?.modelVersion && row?.provider === r.rec?.provider, `${label}: receipt and persisted row agree on provider/model/model_version`);
  ok(row?.prediction?.grade === 'VG 4.0' && r.body?.grade === 'VG 4.0', `${label}: grade unchanged end to end (response and persisted prediction both VG 4.0)`);
  persisted.push({ label, id: row?.id, model: row?.model, model_version: row?.model_version, result_id: row?.result_id });
};

const haiku = await watch([HI]);
check('WATCH Haiku-accepted (pass 1)', haiku, { model: 'claude-haiku-4-5-20251001', modelVersion: `reported::claude-haiku-4-5-20251001::${TAG}::call1`, calls: 1 });
const opus = await watch([LOW, LOW, HI]);
check('WATCH Opus-accepted (pass 3)', opus, { model: 'claude-opus-4-7', modelVersion: `reported::claude-opus-4-7::${TAG}::call3`, calls: 3 });
ok(!/haiku/.test(`${opus.rows[0]?.model} ${opus.rows[0]?.model_version}`), 'Opus-accepted row carries no Haiku metadata (no cross-attribution)');
ok(!/opus/.test(`${haiku.rows[0]?.model} ${haiku.rows[0]?.model_version}`), 'Haiku-accepted row carries no Opus metadata');
const noRep = await watch([HI], { omit: true });
ok(noRep.rows.length === 1 && noRep.rows[0].model === 'claude-haiku-4-5-20251001' && noRep.rows[0].model_version === null, 'provider omitted its model => persisted model_version is NULL (never filled from the request)');
persisted.push({ label: 'WATCH provider-omitted-model', id: noRep.rows[0]?.id, model: noRep.rows[0]?.model, model_version: noRep.rows[0]?.model_version, result_id: noRep.rows[0]?.result_id });

const after = await snap();
ok(JSON.stringify(before) === JSON.stringify(after), `no economic/authority table changed (${JSON.stringify(after)}; before ${JSON.stringify(before)})`);
const own = (await client.query(`SELECT count(*)::int AS n FROM data1_dev.model_prediction_event WHERE principal_id=$1`, [PRINCIPAL])).rows[0].n;
ok(own === 3, `fixture principal owns exactly 3 prediction rows (${own})`);

console.log(`\nPERSISTED ROW IDS: ${JSON.stringify(persisted)}`);
console.log(`FIXTURE PRINCIPAL: ${PRINCIPAL} (1 retained, display_name=${TAG}); DATABASE: marker=development database=${dbName} endpoint=${hostLabel}`);
console.log(`\n${passed} passed, ${failed} failed`);
await client.end();
process.exit(failed ? 1 : 0);
