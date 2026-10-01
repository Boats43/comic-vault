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
// SECURITY MODEL (deliberately no per-POST signature check — eBay's own
// Marketplace Account Deletion spec doesn't define one beyond the
// one-time GET challenge-response): the GET challenge proves this URL is
// genuinely under GrailKey's control, once, at registration time. The
// POST handler's only possible action is DISCONNECTING a marketplace
// connection matching a real eiasToken — an attacker who already knows a
// victim's eiasToken (not a secret GrailKey ever transmits or displays)
// gains nothing but forcing that principal to reconnect; no credential is
// read, exposed, or returned by this path. requireAuthenticatedPrincipal
// (the GrailKey-session gate every other endpoint in this repo now
// requires, GK-269) is deliberately NOT applied here — eBay itself calls
// this endpoint directly and will never carry a GrailKey Bearer token.
//
// Never logs: the verification token, the notification's username/
// userId/eiasToken (PII — logged only as "present"/"matched"/"no match"),
// any credential material.

import { createHash } from 'node:crypto';
import { findPrincipalByProviderIdentity, disconnectMarketplaceConnection, NotFoundError } from '../src/modules/marketplace/index.js';

function computeChallengeResponse(challengeCode, verificationToken, endpointUrl) {
  return createHash('sha256').update(challengeCode + verificationToken + endpointUrl).digest('hex');
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
