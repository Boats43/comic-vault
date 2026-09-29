// src/lib/ebayIdentityProof.js — GK-264. Server-side-only eBay identity
// resolution for the Connect flow, using the newly issued User OAuth
// access token via the Trading API's X-EBAY-API-IAF-TOKEN mechanism —
// NEVER the legacy RequesterCredentials/eBayAuthToken path api/list-ebay.js's
// verifySellerAccount uses (that function, and everything else in
// api/list-ebay.js, is untouched by this file).
//
// No caller-controlled UserID is ever sent — GetUser resolves the
// identity of whoever the token belongs to. EIASToken (not the mutable
// eBay username/UserID) is the value this module returns, because it is
// stable across username changes — the ONLY safe choice for a durable
// provider_user_id (GK-263's own marketplace_connection.provider_user_id).
//
// Read-only Trading API call. Never logs the access token.

const EBAY_ENDPOINT = 'https://api.ebay.com/ws/api.dll';
const COMPAT_LEVEL = '1193';
const SITE_ID = '0'; // US

function extractTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}>(.*?)</${tag}>`));
  return m ? m[1] : null;
}

// resolveEbayIdentityFromUserToken — throws (never returns a partial
// result) if Ack is not Success or EIASToken is absent. Callers must
// treat either as FAIL CLOSED: persist nothing.
export async function resolveEbayIdentityFromUserToken(userAccessToken) {
  if (!userAccessToken || typeof userAccessToken !== 'string') {
    throw new Error('[ebayIdentityProof] a User OAuth access token is required.');
  }

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<GetUserRequest xmlns="urn:ebay:apis:eBLBaseComponents">
</GetUserRequest>`;

  const res = await fetch(EBAY_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml',
      'X-EBAY-API-COMPATIBILITY-LEVEL': COMPAT_LEVEL,
      'X-EBAY-API-CALL-NAME': 'GetUser',
      'X-EBAY-API-SITEID': SITE_ID,
      'X-EBAY-API-IAF-TOKEN': userAccessToken,
    },
    body: xml,
  });

  const text = await res.text();
  const ack = extractTag(text, 'Ack');
  const eiasToken = extractTag(text, 'EIASToken');

  if (!ack || /Failure/i.test(ack) || !eiasToken) {
    const msg = extractTag(text, 'ShortMessage') || extractTag(text, 'LongMessage') || 'GetUser failed or EIASToken absent';
    throw new Error(`eBay identity proof failed (HTTP ${res.status}): ${msg}`);
  }

  return { eiasToken };
}
