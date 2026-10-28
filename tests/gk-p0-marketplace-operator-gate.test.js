// tests/gk-p0-marketplace-operator-gate.test.js
//
// GK-P0 (2026-10-13) -- the OPERATOR-ONLY gate on every marketplace-mutating route (api/list-ebay.js: single item, bundle,
// status; api/delist-ebay.js). REAL handlers, REAL Development Postgres (throwaway operator / ordinary-user principals minted
// per run). global.fetch THROWS and is counted: every rejected request must make ZERO eBay (or any network) calls and create ZERO
// operator_authority_event rows for the principals this test owns.
//
//   node tests/gk-p0-marketplace-operator-gate.test.js
//
// THE REAL CONFIGURATION DEPENDENCIES of the operator authority (named, not invented): the authority is database-backed
// (data1_dev.gk_principal.kind = 'operator', via isOperatorPrincipal -- the mechanism api/operator-reconcile.js already uses).
// It therefore depends on:
//   GRAILKEY_CATALOG_DATABASE_URL    where the principal table lives        (absent / empty / malformed / unrecognised)
//   GRAILKEY_CATALOG_ENVIRONMENT     the environment-identity guard (GK-179) (absent / empty / malformed / unrecognised)
//   GRAILKEY_SESSION_SECRET          verification of the Bearer session      (absent / short -> the token module treats an
//                                                                              unusable secret as an invalid token => 401)
// There is NO operator environment-variable list on this path (SPEND_GUARD_OPERATOR_PRINCIPAL_IDS belongs to the spend guard,
// a different control). Each configuration-failure case runs in its OWN child process so the auth module's lazy pool singleton
// is built from exactly that configuration.

import { readFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, '..');
const IS_CHILD = process.env.GK_GATE_CHILD === '1';

if (!IS_CHILD) {
  const envFile = path.join(repoRoot, '.env.development.local');
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    }
  }
  process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'development';
  if (!process.env.GRAILKEY_SESSION_SECRET) process.env.GRAILKEY_SESSION_SECRET = randomBytes(32).toString('base64url');
}
// dummy APPLICATION identifiers so the handlers get past their own "missing eBay application credentials" check; no call is ever made
process.env.EBAY_APP_ID = process.env.EBAY_APP_ID || 'test-app-id';
process.env.EBAY_CERT_ID = process.env.EBAY_CERT_ID || 'test-cert-id';
process.env.EBAY_DEV_ID = process.env.EBAY_DEV_ID || 'test-dev-id';

let fetchCalls = 0;
global.fetch = async (url) => { fetchCalls++; throw new Error(`NO NETWORK ALLOWED: attempted a call to ${String(url).slice(0, 70)}`); };

function mockRes() {
  const res = { statusCode: null, body: null, headers: {} };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.end = () => res;
  return res;
}
const importFrom = (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href);
const addr = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
async function callHandler(handler, { method = 'POST', token, body, headers } = {}) {
  const res = mockRes();
  await handler({
    method,
    headers: { 'x-forwarded-for': addr(), ...(token ? { authorization: `Bearer ${token}` } : {}), ...(headers || {}) },
    body, query: {},
  }, res);
  return res;
}

// ───────────────────────────────── CHILD MODE: one configuration case, one real handler call ─────────────────────────────────
if (IS_CHILD) {
  const route = process.env.GK_GATE_ROUTE;
  const token = process.env.GK_GATE_TOKEN || undefined;
  const wrecker = process.env.GK_GATE_WRECK_SECRET; // 'absent' | 'short' -- applied AFTER the token was minted by the parent
  if (wrecker === 'absent') delete process.env.GRAILKEY_SESSION_SECRET;
  if (wrecker === 'short') process.env.GRAILKEY_SESSION_SECRET = 'too-short';
  const handler = (await importFrom(route === 'delist' ? 'api/delist-ebay.js' : 'api/list-ebay.js')).default;
  const body = route === 'delist' ? { ebayItemId: '110000000000' } : route === 'bundle' ? { bundle: true, items: [{ title: 'x' }] } : route === 'status' ? { checkStatus: true } : { title: 'GK-P0 gate probe', issue: '1', year: '2000', price: 10 };
  const res = await callHandler(handler, { token, body });
  process.stdout.write(`\nRESULT:${JSON.stringify({ status: res.statusCode, error: res.body && res.body.error, fetchCalls })}\n`);
  process.exit(0);
}

// ───────────────────────────────────────────────────── PARENT MODE ─────────────────────────────────────────────────────
import pg from 'pg';
let passed = 0, failed = 0;
const failures = [];
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; failures.push(l); console.log(`  ✗ ${l}`); } };

const { issueToken } = await importFrom('src/modules/auth/token.js');
const { requireMarketplaceOperator } = await importFrom('src/lib/marketplaceOperatorGate.js');
const listHandler = (await importFrom('api/list-ebay.js')).default;
const delistHandler = (await importFrom('api/delist-ebay.js')).default;
const reconcileHandler = (await importFrom('api/operator-reconcile.js')).default;

const db = new pg.Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const newPrincipal = async (label, kind) => {
  const id = (await db.query('SELECT uuidv7() AS id')).rows[0].id;
  await db.query('INSERT INTO data1_dev.gk_principal (id, display_name, kind) VALUES ($1, $2, $3)', [id, label, kind]);
  return id;
};
const OP = await newPrincipal('gkp0-operator', 'operator');
const USER = await newPrincipal('gkp0-ordinary-user', 'user');
const USER2 = await newPrincipal('gkp0-ordinary-user-2', 'user');
const MINE = [OP, USER, USER2];
const authorityRows = async () => Number((await db.query('SELECT count(*) AS n FROM data1_dev.operator_authority_event WHERE principal_id = ANY($1::uuid[])', [MINE])).rows[0].n);
const tok = (pid) => issueToken({ principalId: pid }).token;

console.log('\n=== GK-P0: marketplace operator-only gate ===\n');
const rows0 = await authorityRows();
ok(rows0 === 0, 'this test owns three fresh principals with zero marketplace-attempt authority records');

// ── 1. list-ebay single-item route ─────────────────────────────────────────────────────────────────────────────────────────
console.log('-- /api/list-ebay (single item)');
{
  const noAuth = await callHandler(listHandler, { body: {} });
  ok(noAuth.statusCode === 401 && noAuth.body.error === 'GRAILKEY_AUTH_REQUIRED', `no Authorization header -> 401 GRAILKEY_AUTH_REQUIRED (got ${noAuth.statusCode} ${noAuth.body?.error})`);
  const garbage = await callHandler(listHandler, { token: 'not.a.token', body: {} });
  ok(garbage.statusCode === 401, `malformed Bearer token -> 401 (got ${garbage.statusCode})`);
  const issued = tok(OP);
  process.env.GRAILKEY_SESSION_EPOCH = 'revoked-epoch-9';
  const revoked = await callHandler(listHandler, { token: issued, body: {} });
  delete process.env.GRAILKEY_SESSION_EPOCH;
  ok(revoked.statusCode === 401, `a genuine operator token from a revoked session epoch -> 401 (got ${revoked.statusCode})`);
  const tampered = (() => { const [p, s] = tok(USER).split('.'); const payload = JSON.parse(Buffer.from(p, 'base64url').toString()); payload.principalId = OP; return `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${s}`; })();
  const tam = await callHandler(listHandler, { token: tampered, body: {} });
  ok(tam.statusCode === 401, `a USER token whose payload was edited to name the operator (signature no longer valid) -> 401 (got ${tam.statusCode})`);

  const userRes = await callHandler(listHandler, { token: tok(USER), body: {} });
  ok(userRes.statusCode === 403 && userRes.body.error === 'MARKETPLACE_OPERATOR_ONLY', `authenticated NON-operator -> 403 MARKETPLACE_OPERATOR_ONLY (got ${userRes.statusCode} ${userRes.body?.error})`);

  const forged = await callHandler(listHandler, {
    token: tok(USER),
    headers: { 'x-operator': 'true', 'x-principal-id': OP, 'x-grailkey-role': 'operator', 'x-user-kind': 'operator' },
    body: { role: 'operator', kind: 'operator', isOperator: true, operator: true, principalId: OP, principal_id: OP, grailkeyPrincipalId: OP, asOperator: OP, gkAssetId: 'x', decisionEventId: 'x', operatorActionEventId: 'x' },
  });
  ok(forged.statusCode === 403 && forged.body.error === 'MARKETPLACE_OPERATOR_ONLY', `forged role / principal id / operator flags in the body AND headers cannot bypass -> still 403 (got ${forged.statusCode})`);

  const unknownPrincipal = await callHandler(listHandler, { token: tok('01a00000-0000-7000-8000-000000000000'), body: {} });
  ok(unknownPrincipal.statusCode === 403, `a validly SIGNED token for a principal id that is not in gk_principal -> 403 (got ${unknownPrincipal.statusCode})`);

  const opRes = await callHandler(listHandler, { token: tok(OP), body: { title: 'GK-P0 gate probe', issue: '1', year: '2000', price: 10 } });
  ok(opRes.statusCode === 400 && opRes.body.error === 'GRAILKEY_LINKAGE_INCOMPLETE', `OPERATOR reaches the EXISTING B1 preflight (linkage-incomplete) -> 400 GRAILKEY_LINKAGE_INCOMPLETE (got ${opRes.statusCode} ${opRes.body?.error})`);
  ok(fetchCalls === 0, `zero network calls across every single-item case above (fetchCalls=${fetchCalls})`);
  ok((await authorityRows()) === 0, 'zero operator_authority_event rows created by any single-item case');
}

// ── 2. bundle route ──────────────────────────────────────────────────────────────────────────────────────────────────────
console.log('-- /api/list-ebay (bundle)');
{
  const bundleBody = { bundle: true, items: [{ title: 'a', image: 'data:image/png;base64,AAAA' }, { title: 'b', image: 'data:image/png;base64,AAAA' }] };
  const a = await callHandler(listHandler, { body: bundleBody });
  ok(a.statusCode === 401, `bundle, unauthenticated -> 401 (got ${a.statusCode})`);
  const u = await callHandler(listHandler, { token: tok(USER), body: bundleBody });
  ok(u.statusCode === 403 && u.body.error === 'MARKETPLACE_OPERATOR_ONLY', `bundle, authenticated NON-operator -> 403 BEFORE any picture upload or AddFixedPriceItem (got ${u.statusCode} ${u.body?.error})`);
  const f = await callHandler(listHandler, { token: tok(USER2), headers: { 'x-operator': 'true' }, body: { ...bundleBody, isOperator: true, role: 'operator', principalId: OP } });
  ok(f.statusCode === 403, `bundle with forged operator flags -> 403 (got ${f.statusCode})`);
  // V1.1a closeout (GK-216): even a genuine operator cannot publish a bundle in ANY environment -- refused before validation, picture upload or any provider call.
  const o = await callHandler(listHandler, { token: tok(OP), body: bundleBody });
  ok(o.statusCode === 503 && o.body?.error === 'BUNDLE_LISTING_DISABLED', `operator bundle publication is refused fail-closed (got ${o.statusCode} ${o.body?.error})`);
  const o1 = await callHandler(listHandler, { token: tok(OP), body: { bundle: true, items: [{ title: 'only-one' }] } });
  ok(o1.statusCode === 503 && o1.body?.error === 'BUNDLE_LISTING_DISABLED', `a malformed operator bundle is refused the same way (got ${o1.statusCode} ${o1.body?.error})`);
  ok(fetchCalls === 0, `zero network calls across every bundle case (fetchCalls=${fetchCalls})`);
  ok((await authorityRows()) === 0, 'zero operator_authority_event rows created by any bundle case');
}

// ── 3. status branch (GetItem read through the seller's token) ──────────────────────────────────────────────────────────
console.log('-- /api/list-ebay (checkStatus)');
{
  const a = await callHandler(listHandler, { body: { checkStatus: true, ebayItemId: '110000000000' } });
  ok(a.statusCode === 401, `status check, unauthenticated -> 401 (got ${a.statusCode})`);
  const u = await callHandler(listHandler, { token: tok(USER), body: { checkStatus: true, ebayItemId: '110000000000' } });
  ok(u.statusCode === 403, `status check, NON-operator -> 403 (got ${u.statusCode})`);
  const o = await callHandler(listHandler, { token: tok(OP), body: { checkStatus: true } });
  ok(o.statusCode === 400 && /ebayItemId required/i.test(o.body?.error || ''), `operator reaches the existing status validation -> 400 (got ${o.statusCode} ${o.body?.error})`);
  ok(fetchCalls === 0, 'zero network calls across every status case');
}

// ── 4. delist route (EndItem) ───────────────────────────────────────────────────────────────────────────────────────────
console.log('-- /api/delist-ebay (EndItem)');
{
  const a = await callHandler(delistHandler, { body: { ebayItemId: '110000000000' } });
  ok(a.statusCode === 401, `delist, unauthenticated -> 401 (got ${a.statusCode})`);
  const g = await callHandler(delistHandler, { token: 'garbage', body: { ebayItemId: '110000000000' } });
  ok(g.statusCode === 401, `delist, malformed token -> 401 (got ${g.statusCode})`);
  const u = await callHandler(delistHandler, { token: tok(USER), body: { ebayItemId: '110000000000' } });
  ok(u.statusCode === 403 && u.body.error === 'MARKETPLACE_OPERATOR_ONLY', `delist, NON-operator -> 403 MARKETPLACE_OPERATOR_ONLY (got ${u.statusCode} ${u.body?.error})`);
  const f = await callHandler(delistHandler, { token: tok(USER), headers: { 'x-operator': 'true' }, body: { ebayItemId: '110000000000', isOperator: true, role: 'operator', principalId: OP } });
  ok(f.statusCode === 403, `delist, forged operator flags -> 403 (got ${f.statusCode})`);
  const o = await callHandler(delistHandler, { token: tok(OP), body: { ebayItemId: '110000000000' } });
  ok(o.statusCode === 404 && o.body.error === 'EBAY_LISTING_NOT_LINKED', `operator reaches the existing ownership preflight -> 404 EBAY_LISTING_NOT_LINKED (got ${o.statusCode} ${o.body?.error})`);
  ok(fetchCalls === 0, `zero EndItem / network calls across every delist case (fetchCalls=${fetchCalls})`);
}

// ── 5. unit-level contract of the gate itself ───────────────────────────────────────────────────────────────────────────
console.log('-- requireMarketplaceOperator (unit contract)');
{
  const opR = await requireMarketplaceOperator({ headers: { authorization: `Bearer ${tok(OP)}` } }, { label: 'unit' });
  ok(opR.ok === true && opR.principalId === OP, 'operator -> { ok:true, principalId } (principal comes ONLY from the verified token)');
  const usr = await requireMarketplaceOperator({ headers: { authorization: `Bearer ${tok(USER)}` }, body: { principalId: OP } }, { label: 'unit' });
  ok(usr.ok === false && usr.status === 403, 'non-operator -> 403 even with an operator id in the body');
  const none = await requireMarketplaceOperator({ headers: {} }, { label: 'unit' });
  ok(none.ok === false && none.status === 401, 'no header -> 401');
  const lower = await requireMarketplaceOperator({ headers: { Authorization: `Bearer ${tok(USER)}` } }, { label: 'unit' });
  ok(lower.ok === false && lower.status === 403, 'capitalised Authorization header is honoured identically (and a user still gets 403)');
}

// ── 6. static inventory: every provider mutation lives behind the gate ─────────────────────────────────────────────────
console.log('-- provider-mutation inventory (static)');
{
  const { readdirSync } = await import('node:fs');
  const apiDir = path.join(repoRoot, 'api');
  const MUTATING = /(AddFixedPriceItem|AddItem\b|ReviseFixedPriceItem|ReviseItem|RelistFixedPriceItem|RelistItem|EndFixedPriceItem|EndItem|UploadSiteHostedPictures|VerifyAddFixedPriceItem|create_image_from_file|uploadImageViaMediaApi|\/sell\/inventory|publishOffer|withdrawOffer)/;
  const callers = readdirSync(apiDir).filter((f) => f.endsWith('.js')).filter((f) => {
    const src = readFileSync(path.join(apiDir, f), 'utf8');
    // an actual provider call: the call-name header or a Media API / Inventory helper invocation, not a comment
    return /"X-EBAY-API-CALL-NAME":\s*"(AddFixedPriceItem|AddItem|Revise\w+|Relist\w+|End\w+|UploadSiteHostedPictures|VerifyAdd\w+)"/.test(src) || /uploadImageViaMediaApi\s*\(/.test(src) || /\/sell\/inventory\//.test(src);
  });
  ok(JSON.stringify(callers.sort()) === JSON.stringify(['delist-ebay.js', 'list-ebay.js']), `the ONLY api files that can call an eBay mutation are list-ebay.js and delist-ebay.js (found: ${callers.join(', ')})`);
  // the Media API helper (src/lib/ebayMediaApi.js) is imported by api/list-ebay.js only
  const importers = [];
  const walk = (dir) => { for (const e of readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); } else if (/\.(js|mjs|jsx)$/.test(e.name)) { const s = readFileSync(p, 'utf8'); if (/from\s+["'][^"']*ebayMediaApi\.js["']/.test(s)) importers.push(path.relative(repoRoot, p).replace(/\\/g, '/')); } } };
  walk(path.join(repoRoot, 'api')); walk(path.join(repoRoot, 'src'));
  ok(importers.every((p) => p === 'api/list-ebay.js'), `the Media API upload helper is imported only by api/list-ebay.js (importers: ${importers.join(', ')}) -- no standalone upload route exists`);
  for (const f of ['list-ebay.js', 'delist-ebay.js']) {
    const src = readFileSync(path.join(apiDir, f), 'utf8');
    const handlerStart = src.indexOf('export default async function handler');
    const body = src.slice(handlerStart);
    const gateAt = body.indexOf('requireMarketplaceOperator(');
    const firstWrite = Math.min(...['resolveEbayUserAccessToken(', 'authorizeOperatorManualListing(', 'uploadSiteHostedPicture(', 'uploadImageViaMediaApi(', 'fetch(', 'recordOutcomeEvent(', 'validateOutcomeAttachment(', 'resolveOwnedAssetForListing('].map((s) => { const i = body.indexOf(s); return i < 0 ? Infinity : i; }));
    ok(gateAt > 0 && gateAt < firstWrite, `${f}: requireMarketplaceOperator is called inside the handler BEFORE the first token resolution / upload / authority write / network call`);
    ok(/import \{[^}]*requireMarketplaceOperator[^}]*\} from ["']\.\.\/src\/lib\/marketplaceOperatorGate\.js["']/.test(src), `${f}: imports the gate`);
  }
  const listSrc = readFileSync(path.join(apiDir, 'list-ebay.js'), 'utf8');
  ok(!/process\.env\.[A-Z_]*(OPERATOR|GATE|BYPASS|DISABLE)[A-Z_]*/.test(readFileSync(path.join(repoRoot, 'src', 'lib', 'marketplaceOperatorGate.js'), 'utf8')), 'the gate reads NO environment switch (no bypass, no disable flag, no default-allow)');
  ok(!/isOperator\s*=\s*req\.|req\.body\??\.(role|isOperator|operator|kind)|req\.headers\??\.\[?['"]x-operator/.test(readFileSync(path.join(repoRoot, 'src', 'lib', 'marketplaceOperatorGate.js'), 'utf8') + listSrc), 'no code path reads an operator claim from the request body or headers');
}

// ── 7. REAL configuration-failure cases, one child process each ────────────────────────────────────────────────────────
console.log('-- operator authority cannot be established -> 503 (real configuration, one child process per case)');
function child(route, envMods, { token = tok(OP), wreckSecret } = {}) {
  const env = { ...process.env, GK_GATE_CHILD: '1', GK_GATE_ROUTE: route, GK_GATE_TOKEN: token };
  if (wreckSecret) env.GK_GATE_WRECK_SECRET = wreckSecret;
  for (const [k, v] of Object.entries(envMods)) { if (v === undefined) delete env[k]; else env[k] = v; }
  const r = spawnSync(process.execPath, [__filename], { env, encoding: 'utf8', timeout: 90000 });
  const m = /RESULT:(\{.*\})/.exec(r.stdout || '');
  return m ? JSON.parse(m[1]) : { status: null, error: `no result (exit ${r.status}) ${String(r.stderr).slice(-160)}`, fetchCalls: null };
}
const CASES = [
  ['GRAILKEY_CATALOG_DATABASE_URL', 'ABSENT', undefined],
  ['GRAILKEY_CATALOG_DATABASE_URL', 'EMPTY', ''],
  ['GRAILKEY_CATALOG_DATABASE_URL', 'MALFORMED', 'this is not a connection string'],
  ['GRAILKEY_CATALOG_DATABASE_URL', 'UNRECOGNISED (well-formed URL naming no reachable database)', 'postgresql://nobody:nothing@127.0.0.1:9/no_such_db?sslmode=disable'],
  ['GRAILKEY_CATALOG_ENVIRONMENT', 'ABSENT', undefined],
  ['GRAILKEY_CATALOG_ENVIRONMENT', 'EMPTY', ''],
  ['GRAILKEY_CATALOG_ENVIRONMENT', 'MALFORMED', 'Prod uction!!'],
  ['GRAILKEY_CATALOG_ENVIRONMENT', 'UNRECOGNISED value', 'banana'],
  ['GRAILKEY_CATALOG_ENVIRONMENT', 'valid name that does NOT match this database (production vs a development marker)', 'production'],
];
for (const route of ['list', 'delist']) {
  for (const [dep, label, value] of CASES) {
    const r = child(route, { [dep]: value });
    ok(r.status === 503 && r.error === 'MARKETPLACE_OPERATOR_AUTHORITY_UNAVAILABLE' && r.fetchCalls === 0,
      `${route}: ${dep} ${label} -> 503 MARKETPLACE_OPERATOR_AUTHORITY_UNAVAILABLE, zero eBay calls (got ${r.status} ${r.error} fetch=${r.fetchCalls})`);
  }
}
{
  // single control: the SAME child harness with correct configuration reaches the existing preflight (proves the harness is not just always failing)
  const r = child('list', {});
  ok(r.status === 400 && r.error === 'GRAILKEY_LINKAGE_INCOMPLETE', `control: unmodified configuration in the same child harness reaches the existing preflight (got ${r.status} ${r.error})`);
  const rb = child('bundle', {});
  ok(rb.status === 503 && rb.error === 'BUNDLE_LISTING_DISABLED', `control: bundle route, operator, valid configuration is refused fail-closed (V1.1a closeout, GK-216) (got ${rb.status} ${rb.error})`);
  const rs = child('status', {});
  ok(rs.status === 400, `control: status route, operator, valid configuration reaches the status validation (got ${rs.status} ${rs.error})`);
  // the session secret: an unusable secret cannot verify ANY token; the token module reports that as an invalid token (401) -- still fail closed
  for (const mode of ['absent', 'short']) {
    const x = child('list', {}, { wreckSecret: mode });
    ok(x.status === 401 && x.fetchCalls === 0, `GRAILKEY_SESSION_SECRET ${mode} at verification time -> 401 (an unusable secret verifies nothing), zero eBay calls (got ${x.status} ${x.error})`);
  }
  // and the other protected routes under a broken database configuration
  const rbb = child('bundle', { GRAILKEY_CATALOG_DATABASE_URL: undefined });
  ok(rbb.status === 503 && rbb.fetchCalls === 0, `bundle: database configuration ABSENT -> 503, zero eBay calls (got ${rbb.status})`);
  const rss = child('status', { GRAILKEY_CATALOG_DATABASE_URL: '' });
  ok(rss.status === 503 && rss.fetchCalls === 0, `status: database configuration EMPTY -> 503, zero eBay calls (got ${rss.status})`);
}

// ── 8. nothing leaked: the whole run created no authority records and made no network calls ────────────────────────────
console.log('-- totals');
ok(fetchCalls === 0, `parent process: zero network calls in total (fetchCalls=${fetchCalls})`);
ok((await authorityRows()) === 0, 'zero operator_authority_event rows for this test\'s principals after the whole run');

// the unchanged operator-reconcile endpoint still enforces its own operator check (its behaviour is not touched by this patch)
const rec = await callHandler(reconcileHandler, { method: 'GET', token: tok(USER) });
ok(rec.statusCode === 403, `api/operator-reconcile.js unchanged: non-operator -> 403 (got ${rec.statusCode})`);

await db.end();
console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
process.exit(0);
