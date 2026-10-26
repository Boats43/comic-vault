// tests/appsec01-cgc-endpoint.test.js
//
// APP-SEC-01 PACKAGE B — api/cgc-lookup.js must never be a public, unauthenticated route to the CGC scraper.
//
// VERDICT UNDER TEST: api/cgc-lookup.js has no default export (it was removed to free a Vercel function slot), so the
// platform route /api/cgc-lookup has no handler and cannot reach CGC. Its only caller is api/enrich.js, and that handler
// authenticates and spend-guards BEFORE lookupCGC can run. This file pins that invariant so a later edit that re-adds a
// default export, a second importer, or a pre-auth lookup fails loudly.
//
// No network is touched: fetch is a counting stub, and every refusal proof asserts the provider-call count stayed ZERO
// (CGC is a fetch() target too, so a CGC call would be counted).
//
// Invoke: node tests/appsec01-cgc-endpoint.test.js

import './helpers/spendGuardTestSetup.js';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.GRAILKEY_SESSION_SECRET = randomBytes(32).toString('base64url');
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-not-a-real-key';

let passed = 0;
let failed = 0;
const failures = [];
const ok = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; failures.push(label); console.log(`  ✗ ${label}`); }
};

let outboundCalls = 0;
const outboundUrls = [];
globalThis.fetch = async (url) => {
  outboundCalls++;
  outboundUrls.push(String(url));
  return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
};

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const read = (rel) => readFileSync(path.join(repoRoot, rel), 'utf8');

console.log('1. api/cgc-lookup.js exposes no HTTP handler');
{
  const live = stripComments(read('api/cgc-lookup.js'));
  ok(!/export\s+default\b/.test(live), 'no live `export default` in api/cgc-lookup.js (comments excluded)');
  const mod = await import('../api/cgc-lookup.js');
  ok(mod.default === undefined, 'the imported module has no default export, so the platform has nothing to invoke');
  ok(typeof mod.lookupCGC === 'function', 'only the named lookupCGC library function exists');
}

console.log('2. the only importer of api/cgc-lookup.js is api/enrich.js');
{
  const importers = [];
  const walk = (dir) => {
    for (const name of readdirSync(path.join(repoRoot, dir))) {
      const rel = `${dir}/${name}`;
      const st = statSync(path.join(repoRoot, rel));
      if (st.isDirectory()) { walk(rel); continue; }
      if (!/\.(js|jsx|mjs)$/.test(name)) continue;
      if (/cgc-lookup/.test(stripComments(read(rel))) && rel !== 'api/cgc-lookup.js') importers.push(rel);
    }
  };
  walk('api');
  walk('src');
  ok(importers.length === 1 && importers[0] === 'api/enrich.js', `exactly one live importer: api/enrich.js (found: ${JSON.stringify(importers)})`);
}

console.log('3. enrich.js orders authentication -> spend guard -> lookupCGC');
{
  const live = stripComments(read('api/enrich.js'));
  const iAuth = live.indexOf('requireAuthenticatedPrincipal(req)');
  const iSpend = live.indexOf("enforceSpendGuard(res, { principalId: auth.principalId, endpoint: 'enrich' })");
  const iLookup = live.indexOf('lookupCGC(certNumber)');
  ok(iAuth > 0 && iSpend > iAuth && iLookup > iSpend, `source order auth(${iAuth}) < spend guard(${iSpend}) < lookupCGC call(${iLookup})`);
}

console.log('4. real api/enrich.js handler: failed authentication causes ZERO outbound calls');
{
  const { issueToken } = await import('../src/modules/auth/token.js');
  const { default: enrich } = await import('../api/enrich.js');
  const mkRes = () => {
    const r = { statusCode: 200, headers: {}, body: undefined };
    r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; };
    r.status = (c) => { r.statusCode = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    return r;
  };
  let ip = 0;
  const call = async (headers, body) => {
    const res = mkRes();
    await enrich({ method: 'POST', headers: { 'x-forwarded-for': `10.9.0.${++ip}`, ...headers }, body }, res);
    return res;
  };
  // A graded-book request with a cert number: the exact shape that would reach lookupCGC if the gate were bypassed.
  const gradedBody = { title: 'Amazing Spider-Man', issue: '300', isGraded: true, certNumber: '0123456789' };

  outboundCalls = 0;
  const missing = await call({}, gradedBody);
  ok(missing.statusCode === 401 && outboundCalls === 0, `missing session -> 401, outbound calls ${outboundCalls}`);

  const garbage = await call({ authorization: 'Bearer not-a-real-token.garbage' }, gradedBody);
  ok(garbage.statusCode === 401 && outboundCalls === 0, `invalid (garbage) session -> 401, outbound calls ${outboundCalls}`);

  const { token } = issueToken({ principalId: 'principal-appsec01-cgc' });
  const [payload, sig] = token.split('.');
  const tampered = await call({ authorization: `Bearer ${payload}.${sig.slice(0, -2)}xx` }, gradedBody);
  ok(tampered.statusCode === 401 && outboundCalls === 0, `tampered-signature session -> 401, outbound calls ${outboundCalls}`);

  const shared = await call({ 'x-vault-key': 'anything' }, gradedBody);
  ok(shared.statusCode === 401 && outboundCalls === 0, `retired shared-secret header alone -> 401, outbound calls ${outboundCalls}`);

  console.log('5. valid session: gate passes; an exhausted spend cap still causes ZERO outbound calls');
  const warm = await call({ authorization: `Bearer ${token}` }, { warmup: true });
  ok(warm.statusCode === 200 && warm.body?.warmed === true && outboundCalls === 0, `valid session passes the gate (warmup 200), outbound calls ${outboundCalls}`);

  process.env.SPEND_GUARD_PRINCIPAL_DAILY_UNITS = '0';
  const refused = await call({ authorization: `Bearer ${token}` }, gradedBody);
  ok(refused.statusCode === 429 && refused.body?.error === 'SPEND_PRINCIPAL_DAILY_CAP', `valid session over its cap -> 429 SPEND_PRINCIPAL_DAILY_CAP (got ${refused.statusCode})`);
  ok(outboundCalls === 0 && !outboundUrls.some((u) => /cgccomics/i.test(u)), `refused request made no CGC or provider call (outbound calls ${outboundCalls})`);
  delete process.env.SPEND_GUARD_PRINCIPAL_DAILY_UNITS;
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(`  ${f}`));
  process.exit(1);
}
process.exit(0);
