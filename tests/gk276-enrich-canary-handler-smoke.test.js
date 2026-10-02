// tests/gk276-enrich-canary-handler-smoke.test.js
//
// GK-276 — mandatory handler-level smoke (Handler-Wiring Verification, GK-138):
// the new Production canary block in api/enrich.js is executed through the REAL
// handler (stubbed fetch, no network, no DB write) to prove it runs without a
// ReferenceError/scope bug and surfaces the expected out.outcome1Result.
//
// What this proves: the block's lexical scope (ownedRefresh, principalIdGK260,
// collectionItemId, durableGradingAttributesGK213C, numericGrade, buildId,
// pipelineTraceId, out) is intact, and the gate decisions that need no database.
// What it cannot prove here: the allowlisted-write branch (needs a Production-
// environment database; unit-proved with injected deps in
// outcome1-runtime-bridge-unit.test.js and live-proved in
// gk276-economic-decision-live-proof.test.js) -- labelled accordingly.
//
// Invoke: node tests/gk276-enrich-canary-handler-smoke.test.js

delete process.env.ACCESS_CODE;
if (!process.env.GRAILKEY_SESSION_SECRET) {
  process.env.GRAILKEY_SESSION_SECRET = (await import('node:crypto')).randomBytes(32).toString('base64url');
}
const { issueToken } = await import('../src/modules/auth/token.js');
const token = issueToken({ principalId: 'gk276-smoke-principal' }).token;
for (const k of ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'D5D_RUNTIME_ENABLED']) delete process.env[k];
process.env.EBAY_APP_ID = process.env.EBAY_APP_ID || 'test-app-id';
process.env.EBAY_CERT_ID = process.env.EBAY_CERT_ID || 'test-cert-id';
process.env.PRICECHARTING_TOKEN = process.env.PRICECHARTING_TOKEN || 'test-pc-token';

const ALLOWED = '01a0c104-00ee-7055-bb95-359233761f53';
const item = (i, price) => ({
  itemId: `v1|9000${i}|0`, title: `Smoke Test Comic #5 Marvel 1990 VF`, price: { value: String(price), currency: 'USD' },
  leafCategoryIds: ['259104'], categories: [{ categoryId: '259104', categoryName: 'Comics & Graphic Novels' }],
  seller: { username: 's', feedbackPercentage: '99', feedbackScore: 100 }, condition: 'Used', conditionId: '3000',
  buyingOptions: ['FIXED_PRICE'], itemWebUrl: `https://www.ebay.com/itm/9000${i}`, legacyItemId: `9000${i}`,
  itemLocation: { postalCode: '000**', country: 'US' }, image: { imageUrl: 'https://i.ebayimg.com/x.jpg' },
});
const POOL = [10, 12, 14, 11, 13].map((p, i) => item(i, p));
const json = (body, status = 200) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
const originalFetch = global.fetch;
global.fetch = async (url) => {
  const u = String(url);
  if (u.includes('oauth2/token') || u.includes('/oauth/')) return json({ access_token: 't', expires_in: 7200, token_type: 'Application Access Token' });
  if (u.includes('item_summary/search') || u.includes('search_by_image')) return json({ itemSummaries: POOL, total: POOL.length });
  if (u.includes('comicvine.gamespot.com')) return json({ results: [], status_code: 1, error: 'OK' });
  if (u.includes('pricecharting.com')) return json({ error: 'not found' }, 404);
  if (u.includes('api.anthropic.com')) return json({ content: [{ type: 'text', text: '{}' }] });
  return json({});
};

let passed = 0, failed = 0; const failures = [];
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; failures.push(l); console.log(`  ✗ ${l}`); } };
const logs = []; const origLog = console.log; const origErr = console.error;
console.log = (...a) => { logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); origLog(...a); };
console.error = (...a) => { logs.push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); origErr(...a); };

const handler = (await import('../api/enrich.js')).default;
async function call(envVars, bodyOver = {}) {
  for (const [k, v] of Object.entries(envVars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  let status = null, body = null;
  const res = { status: (c) => ({ json: (d) => { status = c; body = d; return { statusCode: c, body: d }; } }), setHeader: () => {} };
  let threw = null;
  try {
    await handler({ method: 'POST', headers: { authorization: `Bearer ${token}` }, body: { title: 'Smoke Test Comic', issue: '5', year: '1990', publisher: 'Marvel', grade: 'VF 8.0', isGraded: false, numericGrade: 8, skipVision: true, skipImageSearch: true, ...bodyOver } }, res);
  } catch (e) { threw = e; }
  return { status, body, threw };
}

console.log('\n=== GK-276 Production canary block — real-handler smoke ===\n');
const prevEnv = process.env.GRAILKEY_CATALOG_ENVIRONMENT;

try {
  const A = await call({ GRAILKEY_CATALOG_ENVIRONMENT: 'production', OUTCOME1_PRODUCTION_ASSET_ALLOWLIST: undefined }, { recordDurableDecision: true });
  ok(A.threw === null && A.status === 200, `A: handler completes (status ${A.status}, threw ${A.threw?.message ?? 'none'})`);
  ok(A.body?.outcome1Result?.attempted === false && A.body?.outcome1Result?.declineReason === 'production-asset-not-allowlisted', 'A: production + explicit intent + ABSENT allowlist -> declined production-asset-not-allowlisted');

  const A2 = await call({ GRAILKEY_CATALOG_ENVIRONMENT: 'production', OUTCOME1_PRODUCTION_ASSET_ALLOWLIST: '' }, { recordDurableDecision: true });
  ok(A2.body?.outcome1Result?.declineReason === 'production-asset-not-allowlisted', 'A2: EMPTY allowlist -> declined');

  const A3 = await call({ GRAILKEY_CATALOG_ENVIRONMENT: 'production', OUTCOME1_PRODUCTION_ASSET_ALLOWLIST: '*' }, { recordDurableDecision: true });
  ok(A3.body?.outcome1Result?.declineReason === 'production-asset-not-allowlisted', 'A3: wildcard allowlist -> declined');

  const B = await call({ GRAILKEY_CATALOG_ENVIRONMENT: 'production', OUTCOME1_PRODUCTION_ASSET_ALLOWLIST: ALLOWED }, { recordDurableDecision: true });
  ok(B.threw === null && B.body?.outcome1Result?.declineReason === 'no-auth-context', 'B: allowlisted, but not an owned-item flow (no verified owner) -> declined no-auth-context (no write, no DB touched)');

  const B2 = await call({ GRAILKEY_CATALOG_ENVIRONMENT: 'production', OUTCOME1_PRODUCTION_ASSET_ALLOWLIST: ALLOWED }, { recordDurableDecision: true, collectionItemId: 'ci-attacker', ownedRefresh: false, price: '$99999.00', valuation: { valueAmount: 99999 }, listPrice: 99999 });
  ok(B2.body?.outcome1Result?.attempted === false && B2.body?.outcome1Result?.valuationEventId === undefined, 'B2: client-supplied price/valuation/listPrice in the request body have no path to a write (declined, no ids returned)');

  const C = await call({ GRAILKEY_CATALOG_ENVIRONMENT: 'production', OUTCOME1_PRODUCTION_ASSET_ALLOWLIST: ALLOWED }, {});
  ok(C.threw === null && C.body?.outcome1Result === undefined, 'C: a plain refresh (no recordDurableDecision) never reaches the canary: no outcome1Result at all');

  const D = await call({ GRAILKEY_CATALOG_ENVIRONMENT: 'development', OUTCOME1_PRODUCTION_ASSET_ALLOWLIST: ALLOWED }, { recordDurableDecision: true });
  ok(D.threw === null && D.body?.outcome1Result === undefined, 'D: the canary block is inert outside Production (and Development D5D path is flag-gated off)');

  ok(!logs.some((l) => l.includes('ReferenceError')), 'no ReferenceError logged anywhere');
  ok(!logs.some((l) => l.includes('[outcome1-prod-canary] wiring error')), 'no canary wiring error logged');
  ok(logs.some((l) => l.includes('[outcome1-prod-canary] attempted=false declineReason=production-asset-not-allowlisted')), 'the canary log line is emitted (the block really ran)');
} finally {
  console.log = origLog; console.error = origErr;
  if (prevEnv === undefined) delete process.env.GRAILKEY_CATALOG_ENVIRONMENT; else process.env.GRAILKEY_CATALOG_ENVIRONMENT = prevEnv;
  global.fetch = originalFetch;
  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed) { failures.forEach((f) => console.log('  ✗', f)); process.exit(1); }
  process.exit(0);
}
