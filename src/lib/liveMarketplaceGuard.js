// src/lib/liveMarketplaceGuard.js -- V1.1a closeout: live eBay publication is a PRODUCTION-deployment capability.
//
// Vercel sets VERCEL_ENV on every deployment ('production' | 'preview' | 'development', or a custom environment slug). A Preview
// deployment must never publish to live eBay: it shares credentials/data with branch builds that have not been released. The rule is
// an ALLOW-LIST so an unknown or custom environment fails closed: publication is permitted only when VERCEL_ENV is 'production', or
// when it is absent / 'development' (a local `vercel dev` session or a test process, which is not a hosted deployment).
//
// This is enforced server-side in api/list-ebay.js; nothing the client sends is read.

export function liveMarketplacePublishAllowed(env = process.env) {
  const v = String(env?.VERCEL_ENV ?? '').trim().toLowerCase();
  return v === '' || v === 'production' || v === 'development';
}

export const PREVIEW_PUBLISH_DISABLED = Object.freeze({
  error: 'PREVIEW_PUBLISH_DISABLED',
  message: 'Publishing to live eBay is disabled on Preview deployments. Nothing was listed.',
});
