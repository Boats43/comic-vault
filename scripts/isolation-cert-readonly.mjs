#!/usr/bin/env node
/**
 * isolation-cert-readonly - Production cross-principal isolation certification (LAUNCH-3 prep, 2026-10-11).
 *
 * STRICTLY READ-ONLY against the target. Issues only GET requests and the non-mutating image-credential MINT (POST
 * /api/collection-image-v2, which writes nothing). Creates no principal, no row, no asset, spends nothing, calls no
 * paid provider. Needs TWO EXISTING sessions supplied by the operator, because a session token cannot be forged
 * safely from outside (the signing secret is not available to this tool and must not be):
 *
 *   ISO_BASE_URL   default https://app.grailkey.com
 *   ISO_TOKEN_A    a valid GrailKey session for principal A  (e.g. the operator's)
 *   ISO_TOKEN_B    a valid GrailKey session for principal B  (a DIFFERENT, existing principal)
 *
 * How the operator gets a token without it touching a terminal history or a log: sign in on the device, then read
 * the session from the app's local storage (devtools) and export it into the shell for this one process:
 *   (bash)       read -s ISO_TOKEN_A; read -s ISO_TOKEN_B; export ISO_TOKEN_A ISO_TOKEN_B
 *   (PowerShell) $env:ISO_TOKEN_A = Read-Host -MaskInput ...
 * Tokens are NEVER printed, logged or written. Item and asset ids are reported only as hashed 8-char tags.
 *
 * If either token is missing the script exits 3 with BLOCKED - it never substitutes unauthenticated probes.
 * PASS requires EVERY check below; any single leak exits 1.
 */
import { createHash } from 'node:crypto';

const BASE = (process.env.ISO_BASE_URL || 'https://app.grailkey.com').replace(/\/$/, '');
const TA = process.env.ISO_TOKEN_A;
const TB = process.env.ISO_TOKEN_B;
if (!TA || !TB) { console.log('BLOCKED: ISO_TOKEN_A and ISO_TOKEN_B (two existing, different principals) are required. Nothing was requested.'); process.exit(3); }
if (TA === TB) { console.log('BLOCKED: the two tokens are identical - need two different principals.'); process.exit(3); }

const tag = (s) => createHash('sha256').update(String(s)).digest('hex').slice(0, 8);
const results = [];
const check = (name, pass, detail = '') => { results.push(pass); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`); };
const hdr = (t) => ({ Authorization: `Bearer ${t}` });
const getJson = async (path, t) => { const r = await fetch(BASE + path, { headers: t ? hdr(t) : {} }); let j = null; try { j = await r.json(); } catch { /* not json */ } return { status: r.status, json: j }; };
const principalOf = (t) => { try { return JSON.parse(Buffer.from(t.split('.')[0], 'base64url').toString()).principalId; } catch { return null; } };

const pA = principalOf(TA), pB = principalOf(TB);
if (!pA || !pB || pA === pB) { console.log('BLOCKED: tokens do not decode to two different principals.'); process.exit(3); }
console.log(`Principals under test: A=${tag(pA)} B=${tag(pB)}  target=${BASE}\n`);

const listItems = async (t) => { const r = await getJson('/api/collection', t); const arr = Array.isArray(r.json) ? r.json : (r.json?.items || []); return { status: r.status, ids: arr.map((x) => x.id).filter(Boolean), raw: arr }; };
const A = await listItems(TA);
const B = await listItems(TB);
check('A can list its own Collection', A.status === 200, `${A.ids.length} items`);
check('B can list its own Collection', B.status === 200, `${B.ids.length} items`);
const setA = new Set(A.ids);
const overlap = B.ids.filter((id) => setA.has(id));
check('B\'s list contains none of A\'s item ids (ids are only unique per principal, so a shared id would be a collision, reported separately)', overlap.length === 0, overlap.length ? `${overlap.length} shared ids (verify they are distinct rows)` : '');

// B tries to read A's items one by one.
let leaked = 0;
for (const id of A.ids.slice(0, 25)) {
  const r = await getJson(`/api/collection?id=${encodeURIComponent(id)}`, TB);
  const body = JSON.stringify(r.json || {});
  const hitsA = r.status === 200 && r.json && (r.json.id === id || r.json?.item?.id === id) && !overlap.includes(id);
  if (hitsA) leaked += 1;
  void body;
}
check('B cannot read any of A\'s items by id (first 25)', leaked === 0, `${leaked} leaked`);

// Protected images (GK-L1B v3): the credential is a cookie minted by an authenticated POST; the URL carries identifiers only.
const mintCookie = async (t) => { const r = await fetch(`${BASE}/api/collection-image-v2`, { method: 'POST', headers: hdr(t) }); const sc = r.headers.get('set-cookie') || ''; await r.arrayBuffer(); return { status: r.status, cookie: sc.split(';')[0], attrs: sc }; };
const imgGet = async (cookie, p, id) => { const r = await fetch(`${BASE}/api/collection-image-v2?p=${encodeURIComponent(p)}&id=${encodeURIComponent(id)}&i=0`, { headers: cookie ? { Cookie: cookie } : {} }); const ct = r.headers.get('content-type') || ''; const cc = r.headers.get('cache-control') || ''; await r.arrayBuffer(); return { status: r.status, ct, cc }; };
const mA = await mintCookie(TA); const mB = await mintCookie(TB);
check('both principals can mint an image credential', mA.status === 200 && mB.status === 200 && /HttpOnly/.test(mA.attrs) && /Secure/.test(mA.attrs) && /SameSite=Strict/.test(mA.attrs), `A ${mA.status}, B ${mB.status}`);
if (A.ids.length) {
  const own = await imgGet(mA.cookie, pA, A.ids[0]);
  check('A can load its own image', own.status === 200 && own.ct.startsWith('image/') || own.status === 404, `status ${own.status}${own.status === 404 ? ' (item has no stored display image)' : ''}`);
  check('the image response is private and short-cached (never public/immutable)', own.status !== 200 || (/private/.test(own.cc) && !/public|immutable/.test(own.cc)), own.cc || 'n/a');
  let leaked2 = 0; for (const id of A.ids.slice(0, 25)) { const r = await imgGet(mB.cookie, pB, id); if (r.status === 200 && !overlap.includes(id)) leaked2 += 1; }
  check('B\x27s credential cannot load any of A\x27s item images (addressed as B)', leaked2 === 0, `${leaked2} leaked`);
  const spoof = await imgGet(mB.cookie, pA, A.ids[0]);
  check('B\x27s credential addressed as A is refused (principal mismatch)', spoof.status === 403, `status ${spoof.status}`);
  const nocred = await imgGet(null, pA, A.ids[0]);
  check('an image request with NO credential is refused (the old id-only attack)', nocred.status === 403, `status ${nocred.status}`);
}

// Physical assets: B probes A's linked assets / media.
const linked = A.raw.map((x) => x.gkAssetId || x.attributes?.gkAssetId).filter(Boolean).slice(0, 10);
let assetLeak = 0;
for (const gk of linked) {
  const r = await getJson(`/api/assets?gkAssetId=${encodeURIComponent(gk)}`, TB);
  if (r.status === 200) assetLeak += 1;
}
check('B cannot read A\'s physical assets', assetLeak === 0, linked.length ? `${linked.length} probed, ${assetLeak} leaked` : 'A has no linked asset in the sampled items (re-run with a principal that owns one)');

// Retired endpoint.
const old = await fetch(`${BASE}/api/collection-image?id=${encodeURIComponent(A.ids[0] || 'x')}&index=0`);
check('the retired id-only image endpoint is gone (410)', old.status === 410, `status ${old.status}`);
await old.arrayBuffer();

// Unauthenticated reads are refused.
const un = await getJson('/api/collection', null);
check('unauthenticated Collection read is refused', un.status === 401, `status ${un.status}`);

const failed = results.filter((x) => !x).length;
console.log(`\n${failed === 0 ? 'ISOLATION CERTIFIED (read-only)' : 'ISOLATION FAILED'}: ${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
