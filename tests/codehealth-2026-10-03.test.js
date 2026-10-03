// tests/codehealth-2026-10-03.test.js — code-health pass. Deterministic behavioral / invariant checks
// (no database, no network, no line numbers, no source-text regexes on app code).
//
//  1. REAL api/enrich.js handler, authenticated, forced internal failure -> HTTP 500 whose JSON body has
//     an `error` and NO `stack`; the stack is still logged server-side.
//  2. src/App.jsx has no undefined identifier named onSyncEbay / setSelectionMode (ESLint no-undef invariant;
//     both were real ReferenceErrors: the Sync eBay button and the chat "bundle" action).
//  3. REAL api/list-ebay.js packet builder: the packet carries the resolved shipping token, never Media Mail,
//     never the invented "Modern Age (1991-1999)" Era, and no Best Offer unless opted in; the module loads
//     and still exposes its handler after the dead legacy helpers were removed.
//
// Invoke: node tests/codehealth-2026-10-03.test.js
import { randomBytes, createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.GRAILKEY_SESSION_SECRET = process.env.GRAILKEY_SESSION_SECRET || randomBytes(32).toString('base64url');
process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'development';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const imp = (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href);

// ---- 1. enrich 500 carries no stack ------------------------------------------------------------------
console.log('\n=== enrich 500 sanitization (real handler) ===');
{
  const enrich = (await imp('api/enrich.js')).default;
  const now = Date.now();
  const payloadB64 = Buffer.from(JSON.stringify({ principalId: '00000000-0000-7000-8000-00000000c0de', iat: now, exp: now + 3600_000, epoch: process.env.GRAILKEY_SESSION_EPOCH || '1' })).toString('base64url');
  const token = `${payloadB64}.${createHmac('sha256', process.env.GRAILKEY_SESSION_SECRET).update(payloadB64).digest('base64url')}`;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('network disabled in test'); };
  const errLines = [];
  const realErr = console.error, realLog = console.log;
  console.error = (...a) => errLines.push(a.join(' '));
  console.log = () => {};
  let status = null, body = null;
  const res = { setHeader() {}, status(c) { status = c; return this; }, json(b) { body = b; return this; } };
  try {
    await enrich({
      method: 'POST', headers: { authorization: `Bearer ${token}` },
      body: { title: { toString() { throw new Error('forced-test-failure'); }, valueOf() { throw new Error('forced-test-failure'); } }, issue: '1' },
    }, res);
  } finally { console.error = realErr; console.log = realLog; globalThis.fetch = realFetch; }
  ok(status === 500, `forced internal failure -> HTTP 500 (got ${status})`);
  ok(body && typeof body.error === 'string' && body.error.length > 0, 'response carries a machine-usable error string');
  ok(body && !('stack' in body) && !JSON.stringify(body).includes(' at '), 'response body carries NO stack trace');
  ok(errLines.some((l) => l.includes('[enrich-error] stack:')), 'the stack is still logged server-side');
}

// ---- 2. no undefined identifiers for the two fixed ReferenceErrors ------------------------------------
console.log('\n=== App.jsx: no undefined onSyncEbay / setSelectionMode ===');
{
  const eslintBin = path.join(repoRoot, 'node_modules', 'eslint', 'bin', 'eslint.js');
  let out;
  try { out = execFileSync(process.execPath, [eslintBin, 'src/App.jsx', '-f', 'json'], { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 }).toString(); }
  catch (e) { out = e.stdout?.toString() || '[]'; }
  const msgs = JSON.parse(out)[0]?.messages || [];
  const undef = msgs.filter((m) => m.ruleId === 'no-undef').map((m) => m.message);
  ok(!undef.some((m) => m.includes("'onSyncEbay'")), 'onSyncEbay is defined everywhere it is used (Sync eBay button)');
  ok(!undef.some((m) => m.includes("'setSelectionMode'")), 'setSelectionMode is not referenced (chat bundle action uses a defined setter)');
}

// ---- 3. list-ebay packet builder after dead-helper removal --------------------------------------------
console.log('\n=== list-ebay packet builder (real module) ===');
{
  const mod = await imp('api/list-ebay.js');
  ok(typeof mod.default === 'function' && typeof mod.__dryRunBuildListingXml === 'function', 'module loads; handler + dry-run builder still exported');
  const item = { title: 'The New Mutants', issue: '98', year: '1991', publisher: 'Marvel', price: '$263.80' };
  const plan = { conditionId: null, bestOffer: false, specifics: [], shippingService: { token: 'USPSParcel', description: 'USPS Ground Advantage' } };
  const xml = mod.__dryRunBuildListingXml(item, ['https://i.ebayimg.com/x.jpg'], plan);
  ok(xml.includes('<ShippingService>USPSParcel</ShippingService>'), 'packet uses the resolved shipping token');
  ok(!xml.includes('USPSMedia') && !/Media Mail/i.test(xml), 'packet never contains Media Mail');
  ok(!xml.includes('Modern Age (1991-1999)'), 'packet never contains the invented Era string');
  ok(!xml.includes('BestOfferDetails'), 'no Best Offer unless explicitly opted in');
  const withOffer = mod.__dryRunBuildListingXml(item, ['https://i.ebayimg.com/x.jpg'], { ...plan, bestOffer: true });
  ok(withOffer.includes('BestOfferEnabled'), 'Best Offer still works when opted in (functionality preserved)');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
