// src/lib/ebayPrincipalToken.js — GK-265 PHASE 3. The one server-only
// internal capability that turns a verified GrailKey principalId into a
// short-lived eBay User access token, scoped to that principal's OWN
// GK-263/GK-264 marketplace_connection. Never returns a token to
// browser/client code — every caller here is itself a server-side
// handler or internal module. No access token is ever persisted —
// resolved fresh on every call (request/invocation-local use only); no
// new caching subsystem is built.
//
// GOVERNING LAW: a marketplace credential belonging to Principal A may
// never be used to service Principal B's request. Enforced
// structurally — principalId is the ONLY selector anywhere in this
// file's public surface. There is no connectionId/provider_user_id
// parameter, so "caller supplies someone else's connection" is not
// expressible, not merely disallowed by convention.
//
// NO GLOBAL SELLER-TOKEN FALLBACK. This file never reads EBAY_AUTH_TOKEN,
// EBAY_USER_REFRESH_TOKEN, or EBAY_OAUTH_REFRESH_TOKEN. A principal with
// no usable EBAY connection always throws one of the typed errors below.
//
// FAILURE CLASSIFICATION (governing dispatch, Section 5):
//   A. CONNECTION ABSENT             -> EbayConnectionRequiredError
//   B. CONNECTION DISCONNECTED       -> EbayConnectionRequiredError
//   C. CONNECTION RECONNECT_REQUIRED -> EbayReconnectRequiredError
//   D. eBay definitive invalid_grant -> markMarketplaceReconnectRequired(),
//                                        then EbayReconnectRequiredError
//   E. Temporary eBay/network failure -> EbayTemporaryFailureError;
//                                         connection left untouched
//   F. Local decrypt/key-config fault -> EbayTokenResolutionInternalError;
//                                         connection left untouched, NEVER
//                                         treated as a revoked grant
//
// Never logs: refresh credential, access token, encryption key, or any
// part of the credential envelope.

import {
  getMarketplaceConnection,
  resolveMarketplaceRefreshCredential,
  markMarketplaceReconnectRequired,
  MarketplaceModuleError,
} from '../modules/marketplace/index.js';
import { refreshUserAccessToken, CONNECT_SCOPES } from './ebayUserOAuth.js';

export class EbayTokenResolutionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
  }
}
export class EbayConnectionRequiredError extends EbayTokenResolutionError {
  constructor(message) { super('EBAY_CONNECTION_REQUIRED', message); }
}
export class EbayReconnectRequiredError extends EbayTokenResolutionError {
  constructor(message) { super('EBAY_RECONNECT_REQUIRED', message); }
}
export class EbayTemporaryFailureError extends EbayTokenResolutionError {
  constructor(message) { super('EBAY_TEMPORARY_FAILURE', message); }
}
export class EbayTokenResolutionInternalError extends EbayTokenResolutionError {
  constructor(message) { super('EBAY_TOKEN_RESOLUTION_INTERNAL_ERROR', message); }
}

// classifyRefreshExchangeError — string-matched against eBay's own
// documented OAuth error vocabulary (`invalid_grant`) and this repo's
// own requireEnv() message shape (ebayUserOAuth.js) for a missing
// application credential — never against anything secret (these are
// error CODES/messages, not token material).
function classifyRefreshExchangeError(e) {
  const msg = String(e?.message || '');
  if (/invalid_grant/i.test(msg)) return 'DEFINITIVE_INVALID_GRANT';
  if (/is not set\b/i.test(msg)) return 'INTERNAL_CONFIG';
  return 'TEMPORARY';
}

/**
 * resolveEbayUserAccessToken — the smallest server-only capability for
 * obtaining a short-lived eBay User access token for a verified
 * GrailKey principal. Never returns the access token to the browser;
 * callers are server handlers/internal modules only.
 *
 * @returns {Promise<{accessToken: string, providerUserId: string}>}
 */
export async function resolveEbayUserAccessToken({ principalId } = {}) {
  if (!principalId) {
    throw new EbayTokenResolutionInternalError('resolveEbayUserAccessToken requires principalId');
  }

  let metadata;
  try {
    metadata = await getMarketplaceConnection({ principalId, provider: 'EBAY' });
  } catch (e) {
    // A failure reading connection metadata (malformed principalId, DB
    // hiccup) is a caller/infra problem, never "the seller revoked us."
    throw new EbayTokenResolutionInternalError(`could not read marketplace connection metadata: ${e?.message || e}`);
  }

  if (!metadata || metadata.connectionStatus === 'DISCONNECTED') {
    throw new EbayConnectionRequiredError('No eBay connection exists for this principal — Connect eBay first.');
  }
  if (metadata.connectionStatus === 'RECONNECT_REQUIRED') {
    throw new EbayReconnectRequiredError(metadata.lastError || 'eBay connection requires reconnection.');
  }

  let refreshCredential;
  let grantedScopes;
  try {
    ({ refreshCredential, grantedScopes } = await resolveMarketplaceRefreshCredential({ principalId, provider: 'EBAY' }));
  } catch (e) {
    // The marketplace module's own typed errors (NotFoundError/
    // ConflictError, both MarketplaceModuleError subclasses) describe a
    // real, already-legible connection-state fact — safe to surface as
    // reconnect-required. Anything else (a bare Error — decryptCredential
    // failing because GRAILKEY_MARKETPLACE_CREDENTIAL_KEY is missing,
    // wrong, or rotated without re-encryption) is a SERVER/OPERATOR
    // fault per Section 5F: never treated as a revoked eBay
    // authorization, detail withheld from any caller-facing response.
    if (e instanceof MarketplaceModuleError) {
      throw new EbayReconnectRequiredError(e.message);
    }
    throw new EbayTokenResolutionInternalError('local credential decryption/configuration failure — a server-side fault, not a revoked eBay authorization.');
  }

  let accessToken;
  const effectiveScopes = Array.isArray(grantedScopes) && grantedScopes.length ? grantedScopes : CONNECT_SCOPES;
  try {
    ({ accessToken } = await refreshUserAccessToken(refreshCredential, {
      scopes: effectiveScopes,
    }));
  } catch (e) {
    const classification = classifyRefreshExchangeError(e);
    if (classification === 'DEFINITIVE_INVALID_GRANT') {
      try {
        await markMarketplaceReconnectRequired({
          principalId, provider: 'EBAY',
          reason: 'eBay refresh_token exchange returned invalid_grant — authorization revoked or expired.',
        });
      } catch (markErr) {
        console.error('[ebayPrincipalToken] failed to mark connection RECONNECT_REQUIRED after invalid_grant:', markErr?.message || markErr);
      }
      throw new EbayReconnectRequiredError('eBay has revoked or expired this connection — reconnect required.');
    }
    if (classification === 'INTERNAL_CONFIG') {
      throw new EbayTokenResolutionInternalError(`eBay application credentials are misconfigured server-side: ${e?.message || e}`);
    }
    // Temporary eBay/network failure — connection state is NEVER
    // mutated here (Section 5E: preserve connection, return transient
    // failure).
    throw new EbayTemporaryFailureError(`eBay was temporarily unavailable while refreshing the access token: ${e?.message || e}`);
  }

  // `scopes` = the exact set the refresh token was consented/requested with (additive field; lets callers fail closed
  // BEFORE a call that needs a scope this connection never granted).
  return { accessToken, providerUserId: metadata.providerUserId, scopes: effectiveScopes };
}
