// tests/v11a-closeout-guards.test.js -- V1.1a closeout: (1) GK-216 bundle publication is fail-closed in EVERY environment,
// (2) Preview / non-production hosted deployments cannot publish to live eBay (server-side, allow-list on VERCEL_ENV).
// Real api/list-ebay.js handler; global fetch is a COUNTING trap -- any outbound call fails the zero-provider-write assertions.
// DB-free: both refusals happen before any database or provider work (the Preview guard even precedes the operator gate).
//
// Invoke: node tests/v11a-closeout-guards.test.js

import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { liveMarketplacePublishAllowed, PREVIEW_PUBLISH_DISABLED } from '../src/lib/liveMarketplaceGuard.js';

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  PASS ${l}`); } else { failed++; console.log(`  FAIL ${l}`); } };

console.log('\n--- 1. the allow-list (pure) ---');
for (const [v, want] of [[undefined, true], ['', true], ['development', true], ['production', true], ['PRODUCTION', true], ['preview', false], ['Preview', false], ['staging', false], ['my-custom-env', false]]) {
  ok(liveMarketplacePublishAllowed({ VERCEL_ENV: v }) === want, `VERCEL_ENV=${JSON.stringify(v)} -> publish ${want ? 'allowed' : 'REFUSED'}`);
}
ok(PREVIEW_PUBLISH_DISABLED.error === 'PREVIEW_PUBLISH_DISABLED', 'stable refusal code');

console.log('\n--- 2. real handler ---');
process.env.EBAY_APP_ID ||= 'x'; process.env.EBAY_CERT_ID ||= 'x'; process.env.EBAY_DEV_ID ||= 'x';
process.env.GRAILKEY_SESSION_SECRET ||= randomBytes(32).toString('base64url');
let fetchCalls = 0;
globalThis.fetch = async () => { fetchCalls++; throw new Error('network is trapped in this test'); };
const handler = (await import('../api/list-ebay.js')).default;
const mockRes = () => { const r = { statusCode: null, body: null, headers: {} }; r.setHeader = (k, v) => { r.headers[k] = v; }; r.status = (c) => { r.statusCode = c; return r; }; r.json = (b) => { r.body = b; return r; }; r.end = () => r; return r; };
const call = async (env, body, headers = {}) => {
  if (env === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = env;
  fetchCalls = 0; const res = mockRes(); await handler({ method: 'POST', headers, body }, res); return { res, calls: fetchCalls };
};
const single = { title: 'Creepy #1', price: '$25.00', gkAssetId: '01a02d23-1acb-72e8-aae3-8f851308e9cf' };
const bundle = { bundle: true, items: [{ title: 'a', image: 'data:image/png;base64,AAAA' }, { title: 'b', image: 'data:image/png;base64,AAAA' }] };

for (const env of ['preview', 'staging', 'Preview']) {
  let r = await call(env, single);
  ok(r.res.statusCode === 403 && r.res.body?.error === 'PREVIEW_PUBLISH_DISABLED' && r.calls === 0, `VERCEL_ENV=${env}: single listing refused 403 PREVIEW_PUBLISH_DISABLED, zero provider calls`);
  r = await call(env, bundle);
  ok(r.res.statusCode === 403 && r.res.body?.error === 'PREVIEW_PUBLISH_DISABLED' && r.calls === 0, `VERCEL_ENV=${env}: bundle refused, zero provider calls`);
  r = await call(env, single, { authorization: 'Bearer anything', 'x-operator': 'true' });
  ok(r.res.statusCode === 403 && r.res.body?.error === 'PREVIEW_PUBLISH_DISABLED' && r.calls === 0, `VERCEL_ENV=${env}: credentials / operator headers do not bypass it`);
}
// Production-class environments pass the Preview guard and reach the (unchanged) operator gate: unauthenticated -> 401.
for (const env of ['production', 'development', undefined]) {
  const r = await call(env, single);
  ok(r.res.statusCode === 401 && r.calls === 0, `VERCEL_ENV=${String(env)}: not blocked by the Preview guard; the operator gate still answers 401 for an unauthenticated caller`);
}

console.log('\n--- 3. bundle publication is unreachable for a provider write in every environment (static) ---');
const src = readFileSync(new URL('../api/list-ebay.js', import.meta.url), 'utf8');
const i = src.indexOf('if (item.bundle === true) {');
const j = src.indexOf('const items = Array.isArray(item.items)', i);
const head = src.slice(i, j);
ok(/BUNDLE_LISTING_DISABLED'/.test(head) && /return;/.test(head) && !/GRAILKEY_CATALOG_ENVIRONMENT/.test(head.slice(head.indexOf('V1.1a CLOSEOUT'))), 'the bundle branch refuses unconditionally (no environment condition) before any item is read');
ok(i > 0 && src.indexOf('requireMarketplaceOperator(req') < i && src.indexOf('liveMarketplacePublishAllowed()') < src.indexOf('requireMarketplaceOperator(req'), 'order: Preview guard, then operator gate, then the bundle refusal');

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
process.exit(failed ? 1 : 0);
