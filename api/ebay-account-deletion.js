// GET/POST /api/ebay-account-deletion
//
// GK-269 Lane B — eBay Marketplace Account Deletion/Closure Notification
// compliance. Required before any outside user may connect their own
// eBay account (OUTSIDE-USER EBAY CONNECT remains BLOCKED until this is
// deployed AND configured in the eBay Developer Portal — see the three
// operator-action items in this file's own closing comment).
//
// TWO REQUESTS THIS ENDPOINT HANDLES:
//
// 1. GET ?challenge_code=XXXX — eBay's one-time endpoint-ownership proof,
//    sent when Jimmy registers this URL in the Developer Portal (and
//    periodically thereafter if eBay re-validates). Must respond
//    `{ challengeResponse: <hex> }` where <hex> is the lowercase hex
//    SHA-256 digest of the EXACT concatenation (no separators, this
//    exact order): challengeCode + verificationToken + endpointURL.
//    verificationToken and endpointURL both come from server env
//    (EBAY_ACCOUNT_DELETION_VERIFICATION_TOKEN /
//    EBAY_ACCOUNT_DELETION_ENDPOINT_URL) — never hardcoded, never logged.
//
// 2. POST <notification body> — eBay's actual deletion/closure event:
//    { metadata: {...}, notification: { data: { username, userId,
//    eiasToken } } }. provider_user_id in marketplace_connection is
//    populated from eiasToken (confirmed: api/ebay-callback.js's own
//    OAuth-callback write), so eiasToken is the ONLY field this handler
//    matches against. Resolves the owning GrailKey principal server-side
//    via findPrincipalByProviderIdentity (never trusts a principalId from
//    the request — there isn't one in a real eBay notification to begin
//    with), then disconnects that principal's own EBAY
//    marketplace_connection (credential ciphertext cleared,
//    connection_status set DISCONNECTED). This NEVER touches any other
//    GrailKey table — a deleted eBay account invalidates GrailKey's
//    authority to act on that external account, not the durable
//    physical-asset/collection/outcome history GrailKey itself owns.
//    Idempotent: an eiasToken matching no connection, or one already
//    DISCONNECTED, is treated as success (200), never an error — eBay
//    retries non-2xx responses, and "nothing left to disconnect" is not
//    a failure.
//
// SECURITY MODEL — UPDATED: every POST now requires a verified
// X-EBAY-SIGNATURE before any database read/write. The GET challenge
// alone only proves endpoint ownership ONCE, at registration time; it
// does not authenticate any later POST delivery. Without a per-POST
// signature check, any internet caller who learned (or guessed) a real
// eiasToken could forge a notification and force GrailKey to disconnect
// that principal's real marketplace_connection — a real, not merely
// theoretical, authority-forgery path. Verification algorithm matches
// eBay's own official event-notification-nodejs-sdk verbatim (fetched
// and read directly from github.com/eBay/event-notification-nodejs-sdk,
// lib/validator.js + lib/constants.js + lib/client.js):
//   1. x-ebay-signature header -> base64-decode -> JSON.parse -> {kid, signature}
//   2. fetch the public key: GET https://api.ebay.com/commerce/notification/v1/public_key/{kid}
//      with a client_credentials app token (reuses this repo's existing
//      api/comps.js#getOAuthToken — same BROWSE_SCOPE-class token, no new
//      OAuth plumbing) -> response shape {key: "<raw PEM-ish string>"}
//   3. reformat the raw key into real PEM (insert newlines after the
//      BEGIN/END markers -- eBay's raw response glues them onto the
//      base64 body without one; skipping this step produces
//      ERR_OSSL_UNSUPPORTED, a documented real-world failure class)
//   4. crypto.createVerify('ssl3-sha1').update(JSON.stringify(req.body))
//      .verify(pem, signature, 'base64') -- 'ssl3-sha1' is eBay's own
//      hardcoded digest name, not a typo; independently confirmed to be
//      accepted by Node 22's OpenSSL 3.0 build (createVerify('ssl3-sha1')
//      does not throw) before relying on it here.
// Public keys are cached in-memory by kid (bare Map, matching this
// repo's own api/rate-limit.js convention -- no new npm dependency).
//
// A missing or structurally malformed x-ebay-signature header is a 400
// (the caller isn't even claiming to be a verified eBay delivery). A
// present-but-invalid signature (wrong/tampered payload, unknown key,
// verification failure, or a public-key-fetch failure) is a 401 (claims
// authenticity, fails it). Neither path ever reaches
// findPrincipalByProviderIdentity/disconnectMarketplaceConnection.
//
// requireAuthenticatedPrincipal (the GrailKey-session gate every other
// endpoint in this repo now requires, GK-269) is still deliberately NOT
// applied here — eBay itself calls this endpoint directly and will never
// carry a GrailKey Bearer token. Signature verification is this
// endpoint's own, equally mandatory, authenticity gate.
//
// Never logs: the verification token, the signature value, the public
// key material, the app token, or the notification's username/userId/
// eiasToken (PII — logged only as "present"/"matched"/"no match").

import { createHash, createVerify } from 'node:crypto';
import { getOAuthToken } from './comps.js';
import { findPrincipalByProviderIdentity, disconnectMarketplaceConnection, NotFoundError } from '../src/modules/marketplace/index.js';

function computeChallengeResponse(challengeCode, verificationToken, endpointUrl) {
  return createHash('sha256').update(challengeCode + verificationToken + endpointUrl).digest('hex');
}

// kid -> raw key string (as returned by eBay, before PEM reformatting).
// Module-scoped, in-memory only -- a cold start simply refetches, same
// trade-off api/comps.js's own in-memory tokenCache already accepts.
const publicKeyCache = new Map();

const NOTIFICATION_PUBLIC_KEY_ENDPOINT = 'https://api.ebay.com/commerce/notification/v1/public_key/';
const NOTIFICATION_OAUTH_SCOPE = 'https://api.ebay.com/oauth/api_scope';

async function fetchEbayPublicKey(kid) {
  const cached = publicKeyCache.get(kid);
  if (cached) return cached;

  const { EBAY_APP_ID, EBAY_CERT_ID } = process.env;
  if (!EBAY_APP_ID || !EBAY_CERT_ID) {
    throw new Error('EBAY_APP_ID/EBAY_CERT_ID not configured');
  }
  const accessToken = await getOAuthToken(EBAY_APP_ID, EBAY_CERT_ID, NOTIFICATION_OAUTH_SCOPE);

  const res = await fetch(`${NOTIFICATION_PUBLIC_KEY_ENDPOINT}${encodeURIComponent(kid)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`eBay public key fetch failed: HTTP ${res.status}`);
  }
  const json = await res.json();
  if (!json?.key || typeof json.key !== 'string') {
    throw new Error('eBay public key response missing key field');
  }
  publicKeyCache.set(kid, json.key);
  return json.key;
}

// eBay's raw key value glues "-----BEGIN PUBLIC KEY-----"/"-----END
// PUBLIC KEY-----" directly onto the base64 body with no newline --
// Node's PEM parser requires one. Matches eBay's own SDK's formatKey()
// verbatim.
function formatEbayPublicKeyPem(rawKey) {
  return rawKey
    .replace(/-----BEGIN PUBLIC KEY-----/, '-----BEGIN PUBLIC KEY-----\n')
    .replace(/-----END PUBLIC KEY-----/, '\n-----END PUBLIC KEY-----');
}

// Returns { ok: true } or { ok: false, reason: 'missing'|'malformed'|'verification-failed' }.
// Never throws -- every failure mode (header missing, bad base64/JSON,
// key-fetch failure, bad signature) collapses to a typed, non-exceptional
// result so the caller can map it to the correct HTTP status without a
// try/catch at the call site.
async function verifyEbayNotificationSignature(req) {
  const headerValue = req.headers?.['x-ebay-signature'];
  if (!headerValue || typeof headerValue !== 'string') {
    return { ok: false, reason: 'missing' };
  }

  let decoded;
  try {
    const json = Buffer.from(headerValue, 'base64').toString('ascii');
    decoded = JSON.parse(json);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!decoded || typeof decoded.kid !== 'string' || typeof decoded.signature !== 'string') {
    return { ok: false, reason: 'malformed' };
  }

  let rawKey;
  try {
    rawKey = await fetchEbayPublicKey(decoded.kid);
  } catch (e) {
    console.error('[ebay-account-deletion] public key fetch failed:', e?.message || e);
    return { ok: false, reason: 'verification-failed' };
  }

  try {
    const verifier = createVerify('ssl3-sha1');
    verifier.update(JSON.stringify(req.body));
    const isValid = verifier.verify(formatEbayPublicKeyPem(rawKey), decoded.signature, 'base64');
    return isValid ? { ok: true } : { ok: false, reason: 'verification-failed' };
  } catch (e) {
    console.error('[ebay-account-deletion] signature verification threw:', e?.message || e);
    return { ok: false, reason: 'verification-failed' };
  }
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const challengeCode = req.query?.challenge_code;
    if (!challengeCode || typeof challengeCode !== 'string') {
      res.status(400).json({ error: 'challenge_code query parameter is required' });
      return;
    }

    const verificationToken = process.env.EBAY_ACCOUNT_DELETION_VERIFICATION_TOKEN;
    const endpointUrl = process.env.EBAY_ACCOUNT_DELETION_ENDPOINT_URL;
    if (!verificationToken || !endpointUrl) {
      console.error('[ebay-account-deletion] EBAY_ACCOUNT_DELETION_VERIFICATION_TOKEN or EBAY_ACCOUNT_DELETION_ENDPOINT_URL is not set');
      res.status(500).json({ error: 'Internal error' });
      return;
    }

    const challengeResponse = computeChallengeResponse(challengeCode, verificationToken, endpointUrl);
    res.status(200).json({ challengeResponse });
    return;
  }

  if (req.method === 'POST') {
    try {
      const sigResult = await verifyEbayNotificationSignature(req);
      if (!sigResult.ok) {
        const status = sigResult.reason === 'missing' || sigResult.reason === 'malformed' ? 400 : 401;
        console.log(`[ebay-account-deletion] POST rejected before any database access — signature ${sigResult.reason}`);
        res.status(status).json({ error: 'Invalid signature' });
        return;
      }

      const eiasToken = req.body?.notification?.data?.eiasToken;
      if (!eiasToken || typeof eiasToken !== 'string') {
        console.log('[ebay-account-deletion] POST received with no usable eiasToken in payload — nothing to disconnect, acking anyway');
        res.status(200).json({ ok: true });
        return;
      }

      let match;
      try {
        match = await findPrincipalByProviderIdentity({ provider: 'EBAY', providerUserId: eiasToken });
      } catch (e) {
        console.error('[ebay-account-deletion] lookup failed:', e?.message || e);
        res.status(500).json({ error: 'Internal error' });
        return;
      }

      if (!match) {
        console.log('[ebay-account-deletion] no matching marketplace_connection found for this notification — acking, nothing to do');
        res.status(200).json({ ok: true });
        return;
      }

      try {
        await disconnectMarketplaceConnection({ principalId: match.principalId, provider: 'EBAY' });
        console.log('[ebay-account-deletion] matching connection disconnected');
      } catch (e) {
        if (e instanceof NotFoundError) {
          // Already disconnected/gone by the time we got here (duplicate
          // notification, or a race with some other path) — idempotent
          // success, not an error.
          console.log('[ebay-account-deletion] matching connection already absent — idempotent no-op');
        } else {
          throw e;
        }
      }

      res.status(200).json({ ok: true });
    } catch (e) {
      console.error('[ebay-account-deletion] unexpected error:', e?.message || e);
      res.status(500).json({ error: 'Internal error' });
    }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}

// ─────────────────────────────────────────────────────────────────────
// OPERATOR ACTION REQUIRED (Jimmy, eBay Developer Portal) BEFORE
// OUTSIDE-USER EBAY CONNECT CAN BE UNBLOCKED:
//
// 1. Set two env vars in Vercel (Production, and Preview if eBay will
//    ever validate a preview URL — unlikely, but harmless to set both):
//      EBAY_ACCOUNT_DELETION_VERIFICATION_TOKEN — a random 32-80 char
//        string Jimmy generates himself (e.g. `openssl rand -hex 32`),
//        kept secret, never shared with eBay as a visible value beyond
//        pasting it into the Portal's own verification-token field.
//      EBAY_ACCOUNT_DELETION_ENDPOINT_URL — the exact HTTPS URL eBay will
//        call, e.g. https://app.grailkey.com/api/ebay-account-deletion
//        (must match byte-for-byte what's registered in the Portal).
// 2. In the eBay Developer Portal: Application Keys -> Notifications ->
//    Marketplace Account Deletion -> enter the endpoint URL (same value
//    as EBAY_ACCOUNT_DELETION_ENDPOINT_URL) and the verification token
//    (same value as EBAY_ACCOUNT_DELETION_VERIFICATION_TOKEN) -> Save.
//    eBay will immediately send a GET challenge to the endpoint; it must
//    already be deployed and the env vars already set before this step.
// 3. Confirm the Portal shows the subscription as verified/active.
// ─────────────────────────────────────────────────────────────────────
