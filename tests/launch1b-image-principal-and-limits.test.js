// tests/launch1b-image-principal-and-limits.test.js
//
// GK-L1B v4 (2026-10-12):
//   (1) PRINCIPAL SUBSTITUTION - the principal that governs an image read derives ONLY from the verified signed credential;
//       the URL's `p` is a consistency check and nothing else. Real handler + real Development DB + a full MATRIX of
//       (credential principal x URL p x item x index): the number of unauthorized 200s must be exactly ZERO.
//   (2) IMAGE GET COST CONTROL - bounded, concurrency-safe per-principal read limit (src/lib/imageReadLimiter.js): realistic
//       Collection loading (36 / 199 cards) is never throttled; bursts, repeated GETs, shared IPs and exhaustion behave.
//
// Invoke: node tests/launch1b-image-principal-and-limits.test.js

import './helpers/spendGuardTestSetup.js';
import { readFileSync } from 'node:fs';
import { createHmac, randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { Client } from 'pg';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const line of readFileSync(path.join(root, '.env.development.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}
process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'development';
if (!process.env.GRAILKEY_SESSION_SECRET || process.env.GRAILKEY_SESSION_SECRET.length < 32) process.env.GRAILKEY_SESSION_SECRET = randomBytes(32).toString('base64url');
process.env.GRAILKEY_SESSION_EPOCH = process.env.GRAILKEY_SESSION_EPOCH || '1';

let passed = 0, failed = 0;
const out = (s) => process.stdout.write(`${s}\n`);
const ok = (c, l) => { if (c) { passed++; out(`  ✓ ${l}`); } else { failed++; out(`  ✗ ${l}`); } };
const imp = (rel) => import(pathToFileURL(path.join(root, rel)).href);

const cred = await imp('src/lib/collectionImageUrl.js');
const lim = await imp('src/lib/imageReadLimiter.js');
const { default: v2 } = await imp('api/collection-image-v2.js');
const media = await imp('src/modules/media/index.js');

const mkRes = () => { const r = { code: null, body: null, buf: null, h: {} }; r.setHeader = (k, v) => { r.h[String(k).toLowerCase()] = v; }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; r.send = (b) => { r.buf = b; return r; }; return r; };
const call = async (fn, { method = 'GET', headers = {}, query = {}, body } = {}) => { const res = mkRes(); await fn({ method, headers, query, body, socket: {} }, res); return res; };
const sessionToken = (principalId) => { const now = Date.now(); const p = Buffer.from(JSON.stringify({ principalId, iat: now, exp: now + 3600e3, epoch: process.env.GRAILKEY_SESSION_EPOCH })).toString('base64url'); return `${p}.${createHmac('sha256', process.env.GRAILKEY_SESSION_SECRET).update(p).digest('base64url')}`; };
const cookieOf = async (pid, ip = '9.9.9.9') => { const r = await call(v2, { method: 'POST', headers: { authorization: `Bearer ${sessionToken(pid)}`, 'x-forwarded-for': ip } }); return String(r.h['set-cookie']).split(';')[0].split('=').slice(1).join('='); };
const get = (token, query, headers = {}) => call(v2, { method: 'GET', headers: { ...(token ? { cookie: `gk_img=${token}` } : {}), ...headers }, query });

// ───────────────────────────── (2a) pure limiter ─────────────────────────────
out('\n[1] limiter - realistic Collection loading is never throttled');
{
  lim.configureImageReadLimiterForTests();
  const T0 = 1_000_000;
  const burst = (n, p = 'pA', t = T0) => Array.from({ length: n }, () => lim.acquireImageRead(p, t));
  let leases = burst(36);
  ok(leases.every((l) => l.ok), '36 cards (a mobile screen of thumbnails) loaded at once: every read admitted');
  leases.forEach((l) => l.release());
  leases = burst(36, 'pB'); leases.forEach((l) => l.release());
  for (let i = 0; i < 199; i += 1) { const l = lim.acquireImageRead('pC', T0); if (!l.ok) { ok(false, `199-item first load: read ${i + 1} refused`); break; } l.release(); }
  ok(true, '199 cards (the operator\'s real Collection size), one after another: every read admitted');
  ok(lim.BURST_CAPACITY === 300 && lim.REFILL_PER_SECOND === 1 && lim.MAX_INFLIGHT === 40, 'thresholds: 300 burst, 1 read/second refill, 40 in flight');
  ok(lim.BURST_CAPACITY > 199, 'the burst exceeds a full real Collection load with headroom');
}

out('\n[2] limiter - bursts, repeated GETs, exhaustion, refill');
{
  lim.configureImageReadLimiterForTests();
  const T0 = 5_000_000;
  let granted = 0; let refused = null;
  for (let i = 0; i < 400; i += 1) { const l = lim.acquireImageRead('hog', T0); if (l.ok) { granted += 1; l.release(); } else if (!refused) refused = l; }
  ok(granted === 300, `400 rapid reads (a hostile loop or 400 repeated GETs): exactly ${granted} admitted (= capacity 300)`);
  ok(refused && refused.reason === 'rate' && refused.retryAfterSeconds >= 1, `the 301st is refused with reason "rate" and Retry-After ${refused?.retryAfterSeconds}s`);
  const later1 = lim.acquireImageRead('hog', T0 + 1000); ok(later1.ok, 'one second later one token has refilled');
  later1.release?.();
  ok(!lim.acquireImageRead('hog', T0 + 1000).ok, '...and only one');
  const full = []; for (let i = 0; i < 300; i += 1) { const l = lim.acquireImageRead('hog', T0 + 400_000); full.push(l.ok); l.release?.(); }
  ok(full.every(Boolean), 'after ~5 minutes the bucket is full again (300 admitted, one at a time)');
  ok(!lim.acquireImageRead('hog', T0 + 400_000).ok, 'and never above capacity (301st refused)');
  const a = lim.acquireImageRead('someone-else', T0); ok(a.ok, 'another principal is completely unaffected by the first principal\'s exhaustion'); a.release();
}

out('\n[3] limiter - SHARED IP: keyed by principal, never by address');
{
  lim.configureImageReadLimiterForTests({ capacity: 10 });
  const T0 = 9_000_000;
  const sharedIpUsers = Array.from({ length: 30 }, (_, i) => `user-behind-same-nat-${i}`);
  let allOk = true;
  for (const u of sharedIpUsers) { for (let i = 0; i < 10; i += 1) { const l = lim.acquireImageRead(u, T0); if (!l.ok) allOk = false; else l.release(); } }
  ok(allOk, '30 principals sharing one address each get their OWN full bucket (300 reads total from one IP, none throttled)');
  ok(!lim.acquireImageRead(sharedIpUsers[0], T0).ok, 'while the one that exceeds ITS bucket is refused');
  const src = readFileSync(path.join(root, 'src/lib/imageReadLimiter.js'), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  ok(!/forwarded|remoteAddress|x-real-ip|\bip\b/i.test(src), 'the limiter code never reads an IP address');
}

out('\n[4] limiter - concurrency: atomic admission and in-flight cap');
{
  lim.configureImageReadLimiterForTests({ capacity: 50, maxInflight: 8 });
  const T0 = 20_000_000;
  const results = await Promise.all(Array.from({ length: 200 }, async () => { await Promise.resolve(); return lim.acquireImageRead('racer', T0); }));
  const okc = results.filter((r) => r.ok).length;
  ok(okc === 8, `200 simultaneous admissions with 8 in-flight max: exactly ${okc} granted (never more than the cap)`);
  ok(results.filter((r) => !r.ok).every((r) => r.reason === 'inflight'), 'the rest are refused as "inflight"');
  results.filter((r) => r.ok).forEach((r) => r.release());
  const after = lim.acquireImageRead('racer', T0); ok(after.ok, 'releasing frees the slots (finally-released)'); after.release();
  const l = lim.acquireImageRead('rel', T0); l.release(); l.release(); l.release();
  const many = Array.from({ length: 8 }, () => lim.acquireImageRead('rel', T0)); ok(many.every((m) => m.ok) && !lim.acquireImageRead('rel', T0).ok, 'release is idempotent (a double release cannot create extra capacity)'); many.forEach((m) => m.release());
  lim.configureImageReadLimiterForTests({ capacity: 5, maxInflight: 40 });
  const bucket = await Promise.all(Array.from({ length: 100 }, async () => { await Promise.resolve(); const x = lim.acquireImageRead('tb', T0); x.release?.(); return x; }));
  ok(bucket.filter((x) => x.ok).length === 5, 'token bucket under 100 racing admissions: exactly capacity (5) granted');
}

out('\n[5] limiter - memory is bounded');
{
  lim.configureImageReadLimiterForTests();
  const T0 = 30_000_000;
  for (let i = 0; i < 8000; i += 1) lim.acquireImageRead(`p-${i}`, T0 + i * 1000).release();
  ok(lim.imageReadLimiterState().tracked <= 5000, `8000 distinct principals: tracked entries stay <= 5000 (${lim.imageReadLimiterState().tracked})`);
}

// ───────────────────────────── (1) principal substitution + handler-level limits (real DB) ─────────────────────────────
const db = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
if ((await db.query('select app_env from data1_dev.environment_marker limit 1')).rows[0]?.app_env !== 'development') { out('REFUSING: not a development database'); process.exit(2); }
const [A, B] = (await db.query("select p.id::text id from data1_dev.gk_principal p where p.kind in ('operator','user') order by p.created_at limit 2")).rows.map((r) => r.id);
const TAG = `l1bv4-${Date.now()}`;
const PNG_A = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const PNG_B = Buffer.concat([PNG_A, Buffer.from('B-ONLY')]);
const putA = await media.put({ bytes: PNG_A, contentType: 'image/png' });
const putB = await media.put({ bytes: PNG_B, contentType: 'image/png' });
const COLLIDE = `${TAG}-collide`, A_ONLY = `${TAG}-a-only`, B_ONLY = `${TAG}-b-only`;
const ins = (pid, id, uris) => db.query('insert into data1_dev.collection_item (id, principal_id, asset_category, attributes) values ($1,$2,$3,$4)', [id, pid, 'comic', JSON.stringify({ title: 'v4', remoteImages: uris })]);
try {
  await ins(A, COLLIDE, [putA.objectUri]); await ins(B, COLLIDE, [putB.objectUri]);
  await ins(A, A_ONLY, [putA.objectUri, putA.objectUri]); await ins(B, B_ONLY, [putB.objectUri]);
  lim.configureImageReadLimiterForTests({ capacity: 100000, refill: 100000, maxInflight: 1000 }); // this section tests AUTHORIZATION, not throttling
  const credA = await cookieOf(A); const credB = await cookieOf(B);
  const OWN = { [A]: { [COLLIDE]: PNG_A, [A_ONLY]: PNG_A }, [B]: { [COLLIDE]: PNG_B, [B_ONLY]: PNG_B } }; // what each principal is ENTITLED to read

  out('\n[6] the five required substitution cases');
  let r = await get(credA, { p: B, id: B_ONLY, i: '0' });
  ok(r.code === 403 && r.buf === null, 'cookie A, URL p=B, item owned by B -> 403, no bytes');
  r = await get(credA, { p: A, id: B_ONLY, i: '0' });
  ok(r.code === 404 && r.buf === null, 'cookie A, URL p=A, item owned ONLY by B -> 404, no bytes');
  r = await get(credA, { id: A_ONLY, i: '0' });
  ok(r.code === 400 && r.body.error === 'IMAGE_PRINCIPAL_REQUIRED' && r.buf === null, 'cookie A, MISSING p -> 400 IMAGE_PRINCIPAL_REQUIRED (defined fail-closed), no bytes');
  r = await get(credA, { p: '', id: A_ONLY, i: '0' });
  ok(r.code === 400 && r.buf === null, 'cookie A, EMPTY p -> 400, no bytes');
  r = await get(credA, { p: [A, B], id: A_ONLY, i: '0' });
  ok(r.code === 400 && r.buf === null, 'cookie A, p given twice (array) -> 400, no bytes (no parameter-pollution path to B)');
  r = await get(credA, { p: A, id: COLLIDE, i: '0' });
  ok(r.code === 200 && Buffer.compare(r.buf, PNG_A) === 0, 'cookie A, colliding item id -> ONLY A\'s bytes');
  r = await get(credB, { p: B, id: COLLIDE, i: '0' });
  ok(r.code === 200 && Buffer.compare(r.buf, PNG_B) === 0, 'cookie B, the SAME colliding id -> ONLY B\'s bytes');
  r = await get(credA, { p: B, id: COLLIDE, i: '0' });
  ok(r.code === 403 && r.buf === null, 'cookie A, URL p=B, colliding id -> 403 (the URL cannot re-point the read at B\'s row)');
  r = await get(credA, { p: A.toUpperCase(), id: A_ONLY, i: '0' });
  ok(A.toUpperCase() === A || (r.code === 403 && r.buf === null), 'a re-cased p is not "the same principal" -> 403');

  out('\n[7] tampered item / index with a VALID credential: no unauthorized bytes');
  for (const [label, q] of [['index beyond the item\'s images', { p: A, id: A_ONLY, i: '2' }], ['index 99', { p: A, id: A_ONLY, i: '99' }], ['index 100 (above the allowed range)', { p: A, id: A_ONLY, i: '100' }], ['negative index', { p: A, id: A_ONLY, i: '-1' }], ['non-numeric index', { p: A, id: A_ONLY, i: 'x' }], ['B\'s item id', { p: A, id: B_ONLY, i: '0' }], ['path traversal id', { p: A, id: '../../etc/passwd', i: '0' }], ['SQL-shaped id', { p: A, id: `${A_ONLY}' OR '1'='1`, i: '0' }], ['id with a LIKE wildcard', { p: A, id: `${TAG}-%`, i: '0' }], ['unicode look-alike id', { p: A, id: `${A_ONLY}​`, i: '0' }], ['over-long id', { p: A, id: 'x'.repeat(500), i: '0' }]]) {
    const x = await get(credA, q);
    ok(x.buf === null && [400, 404].includes(x.code), `${label} -> ${x.code}, no bytes`);
  }
  r = await get(credA, { p: A, id: A_ONLY, i: '1' });
  ok(r.code === 200 && Buffer.compare(r.buf, PNG_A) === 0, 'A\'s OWN second image (a legitimate index change) is served - tampering only ever selects A\'s own data');

  out('\n[8] exhaustive matrix: credential principal x URL p x item x index  ->  unauthorized 200s MUST be 0');
  let cases = 0, unauthorized = 0, served = 0, wrongBytes = 0;
  const creds = { [A]: credA, [B]: credB };
  const ids = [COLLIDE, A_ONLY, B_ONLY, `${TAG}-nope`, ''];
  for (const cp of [A, B]) for (const urlP of [A, B, '', 'junk']) for (const id of ids) for (const idx of ['0', '1', '2', '-1', '99']) {
    const x = await get(creds[cp], { ...(urlP === '' && idx === '0' ? {} : { p: urlP }), id, i: idx });
    cases += 1;
    if (x.code === 200) {
      served += 1;
      const entitled = urlP === cp && OWN[cp][id] && (idx === '0' || (idx === '1' && id === A_ONLY && cp === A));
      if (!entitled) unauthorized += 1;
      else if (Buffer.compare(x.buf, OWN[cp][id]) !== 0) wrongBytes += 1;
    }
  }
  out(`      ${cases} requests, ${served} served (all must be the credential holder's own data)`);
  ok(unauthorized === 0, `UNAUTHORIZED 200 RESPONSES: ${unauthorized} (any non-zero = HOLD)`);
  ok(wrongBytes === 0, `every served image carried the credential holder's own bytes (${wrongBytes} wrong)`);
  ok(served > 0, 'the matrix really did serve the legitimate cases (it is not vacuous)');
  const forge = (mut) => { const [pl, sg] = credA.split('.'); const pay = JSON.parse(Buffer.from(pl, 'base64url').toString()); return `${Buffer.from(JSON.stringify({ ...pay, ...mut })).toString('base64url')}.${sg}`; };
  r = await get(forge({ p: B }), { p: B, id: B_ONLY, i: '0' });
  ok(r.code === 403 && r.buf === null, 'a credential whose principal was edited to B (signature no longer matches) -> 403');
  const src = readFileSync(path.join(root, 'api/collection-image-v2.js'), 'utf8');
  ok(/getRemoteImageUriForPrincipal\(\{ principalId: v\.principalId/.test(src) && !/principalId:\s*(p|q\.p)\b/.test(src), 'static: the lookup\'s principal is v.principalId (verified credential) - never the URL value');

  out('\n[9] handler-level limits (real DB, real media)');
  lim.configureImageReadLimiterForTests(); // production thresholds
  const t36 = await Promise.all(Array.from({ length: 36 }, () => get(credA, { p: A, id: A_ONLY, i: '0' })));
  ok(t36.every((x) => x.code === 200), '36 simultaneous GETs (one screen) under PRODUCTION thresholds: all 200');
  const rep = []; for (let i = 0; i < 120; i += 1) rep.push((await get(credA, { p: A, id: COLLIDE, i: '0' })).code);
  ok(rep.every((c) => c === 200), '120 repeated GETs of the same URL (a reload storm) under production thresholds: all 200');
  lim.configureImageReadLimiterForTests({ capacity: 5, refill: 2, maxInflight: 100 });
  const seq = await Promise.all(Array.from({ length: 9 }, () => get(credA, { p: A, id: COLLIDE, i: '0' }, { 'x-forwarded-for': '1.2.3.4' })));
  ok(seq.filter((x) => x.code === 200).length === 5, 'exhaustion test (capacity 5, 9 simultaneous reads): exactly 5 are served');
  const first429 = seq.find((x) => x.code === 429);
  ok(!!first429 && first429.body.error === 'IMAGE_RATE_LIMITED' && Number(first429.h['retry-after']) >= 1 && first429.buf === null, 'the rest get 429 IMAGE_RATE_LIMITED with Retry-After and no bytes');
  const otherUser = await get(credB, { p: B, id: B_ONLY, i: '0' }, { 'x-forwarded-for': '1.2.3.4' }); // SAME IP as the exhausted principal
  ok(otherUser.code === 200, 'another principal on the SAME IP is unaffected by the first one\x27s exhaustion');
  await new Promise((r2) => setTimeout(r2, 700));
  ok((await get(credA, { p: A, id: COLLIDE, i: '0' })).code === 200, 'after the refill interval (2 reads/second here) the exhausted principal is served again');
  lim.configureImageReadLimiterForTests({ capacity: 1000, refill: 1000, maxInflight: 3 });
  const conc = await Promise.all(Array.from({ length: 24 }, () => get(credA, { p: A, id: A_ONLY, i: '0' })));
  const c200 = conc.filter((x) => x.code === 200).length; const c429 = conc.filter((x) => x.code === 429);
  ok(c200 + c429.length === 24 && c429.length > 0 && c429.every((x) => x.body.reason === 'inflight'), `24 concurrent reads with a 3-in-flight cap: ${c200} served, ${c429.length} refused as inflight (real DB/media work is bounded)`);
  ok((await get(credA, { p: A, id: A_ONLY, i: '0' })).code === 200, 'and afterwards the slots are all released (a following read is served)');
  const bad = await get('junk', { p: A, id: A_ONLY, i: '0' });
  ok(bad.code === 403, 'an invalid credential is refused BEFORE any limiter or database work (cheap: HMAC only)');
} finally {
  lim.configureImageReadLimiterForTests();
  await db.query('delete from data1_dev.collection_item where id like $1', [`${TAG}%`]);
  ok((await db.query('select count(*)::int n from data1_dev.collection_item where id like $1', [`${TAG}%`])).rows[0].n === 0, 'cleanup: throwaway Development rows removed');
  await db.end();
}
out(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
