// GK-281 A1 — PROVIDER RETRIES AND UNCERTAINTY. The Anthropic SDK retries a failed request ITSELF (default maxRetries 2: connection
// failures, timeouts, 408, 409, 429, every 5xx). Inside one claimed attempt that is a hidden second/third PAID invocation. This test:
//   1. demonstrates the hazard with a default SDK client (3 raw POSTs for one logical call),
//   2. proves the grading client sends exactly ONE raw POST per logical call (maxRetries: 0),
//   3. proves the five outcome classes stay distinct and fail closed:
//        pre-invocation failure | definitive provider rejection | timeout/connection (uncertain) | success + lost response | durable completion.
// REAL api/grade.js handler, REAL Development database for prediction events, stubbed provider with a RAW-POST counter. No paid call.
//
//   node tests/gk281-provider-retry-uncertainty.test.js

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
process.env.ANTHROPIC_API_KEY = 'test-anthropic-key-unused';
process.env.EBAY_APP_ID = process.env.EBAY_APP_ID || 'x'; process.env.EBAY_CERT_ID = process.env.EBAY_CERT_ID || 'x';
delete process.env.KV_REST_API_URL; delete process.env.KV_REST_API_TOKEN;
delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN;
delete process.env.GRADE_ATTEMPT_ENFORCEMENT; delete process.env.SPEND_GUARD_PRINCIPAL_DAILY_UNITS;

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };
const origLog = console.log, origErr = console.error;
const quiet = async (fn) => { console.log = () => {}; console.error = () => {}; try { return await fn(); } finally { console.log = origLog; console.error = origErr; } };
const section = (t) => origLog(`\n-- ${t} --`);

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const VISION = { title: 'Creepy', issue: '1', publisher: 'Warren', year: '1964', assetTypeConfident: true, grade: 'VG 4.0', isGraded: false, confidence: 'medium', reason: 'Light spine wear.', price: '$20' };
let rawPosts = 0;
let mode = { kind: 'ok' };
global.fetch = async (url) => {
  const u = String(url);
  if (u.includes('/messages/count_tokens')) return json({ input_tokens: 10 });
  if (u.includes('api.anthropic.com')) {
    rawPosts += 1;
    if (mode.kind === 'throw') throw new TypeError('fetch failed');
    if (mode.kind === 'http') return json({ type: 'error', error: { type: 'api_error', message: 'x' } }, mode.status);
    return json({ id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-4-5-20250929', content: [{ type: 'text', text: JSON.stringify(VISION) }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } });
  }
  if (u.includes('oauth')) return json({ access_token: 'x', expires_in: 7200, token_type: 'Application Access Token' });
  return json({ itemSummaries: [], total: 0 });
};
const mkRes = () => { const r = { statusCode: null, body: null, headers: {} }; r.status = (c) => { r.statusCode = c; return r; }; r.json = (d) => { r.body = d; return r; }; r.setHeader = (k, v) => { r.headers[k] = v; }; return r; };
const rs = await import('../src/lib/researchStore.js');
const base = rs.createMemoryResearchStore();
rs.setResearchStoreForTests(base);
const receiptLib = await import('../src/lib/gradeReceipt.js');
const rmem = new Map();
receiptLib.__setReceiptStoreForTests({ async set(k, v) { rmem.set(k, v); }, async get(k) { return rmem.get(k) ?? null; }, async getdel(k) { const v = rmem.get(k) ?? null; rmem.delete(k); return v; } });
const A = await import('../src/lib/gradeAttempt.js');
const { default: gradeHandler } = await import('../api/grade.js');
const { default: Anthropic } = await import('@anthropic-ai/sdk');
const { default: Jimp } = await import('jimp');
let seed = 0x31425364;
const nextPng = async () => (await new Jimp(64, 64, (seed = (seed + 0x01010101) >>> 0) | 0xff).getBufferAsync(Jimp.MIME_PNG)).toString('base64');
const db = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const marker = (await db.query('SELECT app_env FROM data1_dev.environment_marker')).rows;
if (marker.length !== 1 || marker[0].app_env !== 'development') { origLog('REFUSING TO RUN: environment_marker is not development'); process.exit(2); }
const P = randomUUID();
await db.query(`INSERT INTO data1_dev.gk_principal (id, display_name, kind) VALUES ($1,$2,'user')`, [P, `gk281-retry-${Date.now()}`]);
const tok = (() => { const payload = { principalId: P, iat: Date.now(), exp: Date.now() + 3600e3, epoch: process.env.GRAILKEY_SESSION_EPOCH || '1' }; const b = Buffer.from(JSON.stringify(payload)).toString('base64url'); return `${b}.${createHmac('sha256', process.env.GRAILKEY_SESSION_SECRET).update(b).digest('base64url')}`; })();
let ip = 0;
const grade = async (body) => { const r = mkRes(); await quiet(() => gradeHandler({ method: 'POST', headers: { authorization: `Bearer ${tok}`, 'x-forwarded-for': `10.87.${Date.now() % 250}.${++ip % 250}` }, body }, r)); return r; };
const rec = (a, g = 0) => base.get(A.attemptKey(P, a, g));
const events = async (a) => Number((await db.query(`SELECT count(*)::int n FROM data1_dev.model_prediction_event WHERE principal_id=$1 AND result_id=$2 AND surface='GRADE'`, [P, A.deriveResultId(P, a)])).rows[0].n);

origLog('\n=== GK-281 A1 provider retries and uncertainty (database marker=development) ===');

section('1. the hazard: a DEFAULT SDK client re-POSTs a failed request by itself');
mode = { kind: 'http', status: 503 };
const defaultClient = new Anthropic({ apiKey: 'x' });
rawPosts = 0;
await defaultClient.messages.create({ model: 'claude-haiku-4-5-20251001', max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] }).catch(() => {});
ok(rawPosts === 3, `default SDK: ONE logical call that fails with 503 becomes ${rawPosts} raw POSTs (1 + 2 hidden retries)`);
mode = { kind: 'ok' };

section('2. the grading client: exactly ONE raw POST per logical call');
const src = readFileSync(path.join(repoRoot, 'api/grade.js'), 'utf8');
ok(/new Anthropic\(\{[^}]*maxRetries:\s*0[^}]*\}\)/.test(src), 'api/grade.js constructs its Anthropic client with maxRetries: 0');
ok((src.match(/new Anthropic\(/g) || []).length === 1, 'api/grade.js has exactly one provider client');
for (const [label, m] of [['connection failure', { kind: 'throw' }], ['HTTP 503', { kind: 'http', status: 503 }], ['HTTP 529', { kind: 'http', status: 529 }], ['HTTP 429', { kind: 'http', status: 429 }]]) {
  mode = m; rawPosts = 0;
  const r = await grade({ images: [await nextPng()], attemptId: randomUUID() });
  ok(rawPosts === 1 && r.statusCode >= 400, `${label}: ONE raw provider POST, no hidden retry (got ${rawPosts})`);
}
mode = { kind: 'ok' };

section('3. outcome classification stays distinct and fails closed');
const classify = async (m) => {
  mode = m; const at = randomUUID(); const img = await nextPng(); rawPosts = 0;
  const r1 = await grade({ images: [img], attemptId: at });
  const state = (await rec(at))?.state, failure = (await rec(at))?.failure;
  const afterFail = rawPosts;
  mode = { kind: 'ok' };
  const r2 = await grade({ images: [img], attemptId: at });
  return { r1, state, failure, afterFail, r2, retryPosts: rawPosts - afterFail, at };
};
for (const status of [429, 529, 400, 401, 403, 413, 422]) {
  const c = await classify({ kind: 'http', status });
  ok(c.state === 'FAILED_BEFORE_INVOCATION' && c.failure === 'PROVIDER_REJECTED' && c.afterFail === 1 && c.r2.statusCode === 200 && c.retryPosts === 1, `definitive rejection ${status}: unbilled, ONE POST, safely retryable under the SAME attempt (retry made ${c.retryPosts})`);
}
for (const status of [408, 409, 500, 502, 503, 504]) {
  const c = await classify({ kind: 'http', status });
  ok(c.state === 'UNCERTAIN' && c.afterFail === 1 && c.r2.statusCode === 409 && c.r2.body.error === 'GRADE_ATTEMPT_UNCERTAIN' && c.retryPosts === 0, `HTTP ${status}: provider execution UNCERTAIN, fail closed, retry makes ZERO provider POSTs`);
}
{
  const c = await classify({ kind: 'throw' });
  ok(c.state === 'UNCERTAIN' && c.afterFail === 1 && c.r2.statusCode === 409 && c.retryPosts === 0 && (await events(c.at)) === 0, 'connection failure / timeout: UNCERTAIN, no event, retry makes ZERO provider POSTs, operator authorization required');
  ok(c.r2.body.requiresOperatorAuthorization === true, 'the response says explicit operator authorization is required to pay again');
}
{
  rawPosts = 0;
  const failed = await grade({ images: ['not-an-image'], attemptId: randomUUID() });
  ok(failed.statusCode === 400 && rawPosts === 0, 'pre-invocation failure (undecodable image): 400 and NO provider POST at all');
}
{
  // success with a lost response: the server completed durably; the retry replays (covered end to end elsewhere, asserted here against raw POSTs)
  const at = randomUUID(); const img = await nextPng(); rawPosts = 0;
  const first = await grade({ images: [img], attemptId: at });
  const again = await grade({ images: [img], attemptId: at });
  ok(first.statusCode === 200 && again.body.attemptReplay === true && rawPosts === 1 && (await events(at)) === 1 && (await rec(at)).state === 'COMPLETED', 'success + lost response: ONE raw POST, durable event, retry is a replay');
}
{
  // parseResponse never throws: an unparseable body after a successful (BILLED) provider response becomes a stored result, never a retry
  const at = randomUUID(); const img = await nextPng();
  const realFetch = global.fetch;
  global.fetch = async (url, init) => (String(url).includes('api.anthropic.com') && !String(url).includes('count_tokens')
    ? (rawPosts += 1, json({ id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-4-5-20250929', content: [{ type: 'text', text: 'this is not json at all' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } }))
    : realFetch(url, init));
  rawPosts = 0;
  const r1 = await grade({ images: [img], attemptId: at });
  const r2 = await grade({ images: [img], attemptId: at });
  global.fetch = realFetch;
  ok(r1.statusCode === 200 && (await rec(at)).state === 'COMPLETED' && r2.body.attemptReplay === true && rawPosts === 1, 'unparseable body after a successful (billed) response: ONE POST, stored as COMPLETED, replayed — the provider is never re-invoked under this attempt');
}

section('4. classifier table');
ok(JSON.stringify(A.DEFINITIVE_REJECTION_STATUSES) === JSON.stringify([400, 401, 402, 403, 404, 413, 422, 429, 529]), 'the definitive set is an explicit allowlist');
ok([408, 409, 500, 502, 503, 504, undefined, 0].every((s) => !A.isDefinitiveProviderRejection({ status: s })) && !A.isDefinitiveProviderRejection(new Error('x')) && !A.isDefinitiveProviderRejection(null), 'timeouts, gateways, 5xx and status-less errors are never definitive');

origLog(`\n${passed} passed, ${failed} failed`);
await db.end();
process.exit(failed ? 1 : 0);
