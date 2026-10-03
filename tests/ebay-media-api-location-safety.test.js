// tests/ebay-media-api-location-safety.test.js — hostile Location / token-leak proof for src/lib/ebayMediaApi.js.
// Deterministic, no DB, no network (fetch is injected). Invariant: the seller bearer token is attached ONLY to
//   POST https://apim.ebay.com/commerce/media/v1_beta/image/create_image_from_file and to a canonical
//   GET https://apim.ebay.com/commerce/media/v1_beta/image/{image_id} rebuilt from a validated image_id —
// never to an arbitrary Location — and redirects are never followed with credentials attached.
// Invoke: node tests/ebay-media-api-location-safety.test.js
import { uploadImageViaMediaApi, parseMediaImageLocation, MediaApiError, EBAY_MEDIA_API_BASE } from '../src/lib/ebayMediaApi.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const TOKEN = 'SECRET-SELLER-ACCESS-TOKEN';
const GOOD_ID = 'abc-123_XYZ';
const GOOD_LOCATION = `${EBAY_MEDIA_API_BASE}/image/${GOOD_ID}`;
const EPS = 'https://i.ebayimg.com/images/g/good/s-l1600.jpg';

// Scripted fetch: records every call (url, method, redirect, auth header). create -> 201 + Location; get -> imageUrl.
function scripted({ location = GOOD_LOCATION, getStatus = 200, getBody = { imageUrl: EPS, expirationDate: new Date(Date.now() + 86400000).toISOString() }, getRedirectTo = null } = {}) {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method, redirect: opts.redirect, auth: opts.headers?.Authorization });
    if (String(url).endsWith('/image/create_image_from_file')) return { ok: true, status: 201, headers: { get: (h) => (String(h).toLowerCase() === 'location' ? location : null) }, json: async () => ({}) };
    if (getRedirectTo) return { ok: false, status: 302, headers: { get: (h) => (String(h).toLowerCase() === 'location' ? getRedirectTo : null) }, json: async () => ({}) };
    return { ok: getStatus >= 200 && getStatus < 300, status: getStatus, headers: { get: () => null }, json: async () => getBody };
  };
  return { calls, fetchImpl };
}
const run = (s) => uploadImageViaMediaApi({ bytes: PNG, mimeType: 'image/png', accessToken: TOKEN, fetchImpl: s.fetchImpl });
const rejects = async (s) => { try { await run(s); return null; } catch (e) { return e; } };
const tokenOnlyToEbayMedia = (calls) => calls.every((c) => !c.auth || c.url.startsWith(`${EBAY_MEDIA_API_BASE}/image/`));

console.log('\n=== parseMediaImageLocation: exact canonical form only ===');
ok(parseMediaImageLocation(GOOD_LOCATION)?.url === GOOD_LOCATION && parseMediaImageLocation(GOOD_LOCATION)?.imageId === GOOD_ID, 'canonical Location parses; imageId extracted; canonical URL rebuilt');
const hostile = [
  ['wrong origin', 'https://evil.example/commerce/media/v1_beta/image/x'],
  ['subdomain trick', 'https://apim.ebay.com.evil.example/commerce/media/v1_beta/image/x'],
  ['userinfo trick', 'https://apim.ebay.com@evil.example/commerce/media/v1_beta/image/x'],
  ['other ebay host', 'https://api.ebay.com/commerce/media/v1_beta/image/x'],
  ['http scheme', 'http://apim.ebay.com/commerce/media/v1_beta/image/x'],
  ['custom port', 'https://apim.ebay.com:8443/commerce/media/v1_beta/image/x'],
  ['wrong path', 'https://apim.ebay.com/commerce/media/v1_beta/video/x'],
  ['wrong version', 'https://apim.ebay.com/commerce/media/v2/image/x'],
  ['path traversal', 'https://apim.ebay.com/commerce/media/v1_beta/image/../../../identity/v1/oauth2/token'],
  ['encoded traversal', 'https://apim.ebay.com/commerce/media/v1_beta/image/%2e%2e%2fsecret'],
  ['extra path segment', 'https://apim.ebay.com/commerce/media/v1_beta/image/x/extra'],
  ['empty id', 'https://apim.ebay.com/commerce/media/v1_beta/image/'],
  ['query string', 'https://apim.ebay.com/commerce/media/v1_beta/image/x?redirect=https://evil.example'],
  ['fragment', 'https://apim.ebay.com/commerce/media/v1_beta/image/x#y'],
  ['backslash', 'https://apim.ebay.com\\@evil.example/commerce/media/v1_beta/image/x'],
  ['whitespace', 'https://apim.ebay.com/commerce/media/v1_beta/image/x y'],
  ['relative path', '/commerce/media/v1_beta/image/x'],
  ['protocol-relative', '//evil.example/commerce/media/v1_beta/image/x'],
  ['not a string', 12345],
  ['empty', ''],
];
for (const [label, loc] of hostile) ok(parseMediaImageLocation(loc) === null, `rejected: ${label}`);

console.log('\n=== hostile Location: the seller token is never sent to it, nothing is fetched after it ===');
for (const [label, loc] of hostile) {
  const s = scripted({ location: loc });
  const e = await rejects(s);
  ok(e instanceof MediaApiError && e.code === 'MEDIA_RESPONSE_MALFORMED', `${label}: fails closed MEDIA_RESPONSE_MALFORMED`);
  ok(s.calls.length === 1 && s.calls[0].url.endsWith('/image/create_image_from_file') && !s.calls.some((c) => c.url.includes('evil.example')), `${label}: exactly one call (the create), no request to the hostile Location`);
}

console.log('\n=== happy path: GET goes to the CANONICAL url, redirects are never followed ===');
{
  const s = scripted();
  const url = await run(s);
  ok(url === EPS, 'returns the verified EPS URL');
  ok(s.calls.length === 2 && s.calls[1].method === 'GET' && s.calls[1].url === GOOD_LOCATION, 'GET targets the canonical URL rebuilt from the validated image_id');
  ok(s.calls.every((c) => c.redirect === 'manual'), "both authenticated requests use redirect:'manual' (a redirect is never auto-followed with the bearer token)");
  ok(tokenOnlyToEbayMedia(s.calls), 'every request carrying the token targets only the Media API origin/path');
}

console.log('\n=== redirects: an unexpected 3xx on getImage is a failure, the redirect target is never requested ===');
{
  const s = scripted({ getStatus: 302, getRedirectTo: 'https://evil.example/steal' });
  const e = await rejects(s);
  ok(e instanceof MediaApiError, 'a 302 from getImage fails closed');
  ok(s.calls.length === 2 && !s.calls.some((c) => c.url.includes('evil.example')), 'the redirect target (evil.example) was never requested');
}
{
  // a 3xx on the create call itself (status !== 201) also fails closed without following
  const calls = [];
  const fetchImpl = async (url, opts = {}) => { calls.push({ url: String(url), redirect: opts.redirect }); return { ok: false, status: 307, headers: { get: () => 'https://evil.example/x' }, json: async () => ({}) }; };
  let err = null; try { await uploadImageViaMediaApi({ bytes: PNG, mimeType: 'image/png', accessToken: TOKEN, fetchImpl }); } catch (e) { err = e; }
  ok(err instanceof MediaApiError && calls.length === 1 && calls[0].redirect === 'manual', 'a 307 from create fails closed after exactly one call (not followed)');
}

console.log('\n=== returned EPS image must be https, eBay-hosted, non-placeholder, unexpired ===');
for (const [label, body] of [
  ['http EPS url', { imageUrl: 'http://i.ebayimg.com/x.jpg' }],
  ['non-eBay host', { imageUrl: 'https://cdn.evil.example/x.jpg' }],
  ['placeholder url', { imageUrl: 'https://i.ebayimg.com/DRYRUN-PLACEHOLDER/x.jpg' }],
  ['missing imageUrl', { notImageUrl: 1 }],
  ['expired image', { imageUrl: EPS, expirationDate: '2020-01-01T00:00:00.000Z' }],
  ['garbage expirationDate', { imageUrl: EPS, expirationDate: 'soon' }],
]) {
  const e = await rejects(scripted({ getBody: body }));
  ok(e instanceof MediaApiError && e.code === 'MEDIA_RESPONSE_MALFORMED', `${label}: fails closed`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
