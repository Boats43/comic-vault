// src/lib/ebayUserOAuth.js — GK-209 Outcome #1 CLOSER.
//
// The Authorization Code Grant flow eBay's seller-specific REST APIs
// (Fulfillment, Finances) require — a real User access token, NEVER
// obtainable via the client_credentials grant this repo already uses
// for Browse API (api/comps.js's getOAuthToken, application-level
// only). This module builds ONLY the pieces needed to reach and
// complete Jimmy's one-time interactive consent — it does not, and
// cannot, replace or touch the existing Trading API/Auth'n'Auth
// listing path (api/list-ebay.js is completely untouched by this file).
//
// PREREQUISITE, NOT YET SATISFIED (this is the actual long-pole item):
// eBay's authorization_code grant requires a "RuName" — a value eBay
// itself generates once you register a redirect page for your
// application (Developer Portal -> Application Keys -> "User Tokens"
// link next to your production Client ID -> set an Accept URL /
// Decline URL). No RuName has been created for this application yet
// (confirmed: no EBAY_OAUTH_RUNAME anywhere in this repo's env). Until
// Jimmy performs that one manual portal step and supplies the
// resulting RuName string as EBAY_OAUTH_RUNAME, buildConsentUrl() below
// will throw rather than construct an invalid/non-functional URL.
//
// Once EBAY_OAUTH_RUNAME is set, the flow is:
//   1. Give Jimmy the URL from buildConsentUrl() — he opens it, signs
//      into his real eBay seller account, and approves the requested
//      scopes once.
//   2. eBay redirects to the RuName's own Accept page carrying a
//      `code` query parameter (a real page Jimmy configured in the
//      portal — this module does not run that page).
//   3. Jimmy (or a script he runs) supplies that code to
//      exchangeAuthCodeForToken() below, which returns a real user
//      access_token + refresh_token pair.
//   4. Store the refresh_token (long-lived, ~18 months) securely
//      (never printed) — refreshUserAccessToken() mints new short-lived
//      access tokens from it going forward without repeating consent.

const EBAY_OAUTH_ENDPOINT = 'https://api.ebay.com/identity/v1/oauth2/token';
const EBAY_CONSENT_ENDPOINT = 'https://auth.ebay.com/oauth2/authorize';

// The exact, minimal scopes this dispatch actually needs — read-only
// wherever a read-only variant exists, since the observer never writes
// to the marketplace. Finances has no read-only-vs-write split; its one
// scope covers read access to seller financial data.
export const REQUIRED_SCOPES = Object.freeze([
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.finances',
]);

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `${name} is not set. This is the real, current blocker: Jimmy must first create a RuName in the eBay Developer Portal ` +
      `(Application Keys -> "User Tokens" link next to the production Client ID -> configure an Accept/Decline URL) and provide ` +
      `the resulting RuName string before this OAuth flow can be used at all.`
    );
  }
  return v;
}

// buildConsentUrl — the exact browser URL Jimmy must open and approve.
// Throws (does not return a broken URL) if EBAY_OAUTH_RUNAME is unset.
export function buildConsentUrl({ scopes = REQUIRED_SCOPES, state } = {}) {
  const clientId = requireEnv('EBAY_APP_ID'); // the SAME production Client ID already used for the existing Trading/Browse OAuth
  const ruName = requireEnv('EBAY_OAUTH_RUNAME');
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: ruName,
    response_type: 'code',
    scope: scopes.join(' '),
  });
  if (state) params.set('state', state);
  return `${EBAY_CONSENT_ENDPOINT}?${params.toString()}`;
}

// exchangeAuthCodeForToken — real, one-time call after Jimmy consents
// and eBay redirects with `code` in the query string. Returns
// {accessToken, refreshToken, expiresIn, refreshTokenExpiresIn} — NEVER
// logs or returns anything that would print the client secret.
export async function exchangeAuthCodeForToken(code) {
  const clientId = requireEnv('EBAY_APP_ID');
  const clientSecret = requireEnv('EBAY_CERT_ID');
  const ruName = requireEnv('EBAY_OAUTH_RUNAME');
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const res = await fetch(EBAY_OAUTH_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basicAuth}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: ruName,
    }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.access_token) {
    // eBay's own error responses do not embed the client secret, safe to surface directly.
    throw new Error(`eBay authorization_code exchange failed (HTTP ${res.status}): ${json?.error_description || json?.error || 'unknown error'}`);
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresIn: json.expires_in,
    refreshTokenExpiresIn: json.refresh_token_expires_in,
  };
}

// refreshUserAccessToken — mints a new short-lived user access token
// from a previously-obtained refresh_token, WITHOUT repeating Jimmy's
// interactive consent. This is the ongoing path once the one-time
// authorization above has happened.
export async function refreshUserAccessToken(refreshToken, { scopes = REQUIRED_SCOPES } = {}) {
  const clientId = requireEnv('EBAY_APP_ID');
  const clientSecret = requireEnv('EBAY_CERT_ID');
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const res = await fetch(EBAY_OAUTH_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basicAuth}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: scopes.join(' '),
    }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.access_token) {
    throw new Error(`eBay refresh_token exchange failed (HTTP ${res.status}): ${json?.error_description || json?.error || 'unknown error'}`);
  }
  return { accessToken: json.access_token, expiresIn: json.expires_in };
}
