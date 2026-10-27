// Module-resolution hook: maps the database / session / seller-token modules api/list-ebay.js imports onto
// c1ListEbayStubs.mjs. Everything else (the receipt verifier, authority derivation, price binding, photo guard,
// metadata, XML builders, the handler itself) stays REAL.
const STUBBED = [
  '/src/modules/assets/index.js', '/src/modules/collection/index.js', '/src/modules/auth/index.js', '/src/modules/media/index.js',
  '/src/lib/inventoryListingPreflight.js', '/src/lib/marketplaceOperatorGate.js',
  '/src/lib/ebayPrincipalToken.js', '/src/lib/marketplaceOutcomeBridge.js',
];
let stubUrl = null;
export async function initialize(data) { stubUrl = data.stubUrl; }
export async function resolve(specifier, context, next) {
  const r = await next(specifier, context);
  if (STUBBED.some((s) => r.url.endsWith(s))) return { url: stubUrl, shortCircuit: true };
  return r;
}
