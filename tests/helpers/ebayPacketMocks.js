// tests/helpers/ebayPacketMocks.js — shared mocks for the real-handler eBay tests.
// Values mirror the REAL authoritative eBay responses captured 2026-10-03:
//   * Sell Metadata getItemConditionPolicies (EBAY_US, category 259104)
//   * Taxonomy getItemAspectsForCategory (tree 0, category 259104) — abridged to the aspects used
//   * Trading GeteBayDetails / ShippingServiceDetails — USPS Ground Advantage's SELLING token is
//     "USPSParcel" (the "USPSGroundAdvantageReturn" entry is a return label, ValidForSellingFlow=false)
// NO real network is touched.

export const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
export const TINY_PNG_DATA_URL = `data:image/png;base64,${TINY_PNG_B64}`;
export const HOSTED_PICTURE_URL = 'https://i.ebayimg.com/images/g/test-hosted/s-l1600.jpg';

export const META_ASPECTS = { aspects: [
  { localizedAspectName: 'Publisher', aspectConstraint: { aspectMode: 'FREE_TEXT' }, aspectValues: [] },
  { localizedAspectName: 'Series Title', aspectConstraint: { aspectMode: 'FREE_TEXT' }, aspectValues: [] },
  { localizedAspectName: 'Issue Number', aspectConstraint: { aspectMode: 'FREE_TEXT' }, aspectValues: [] },
  { localizedAspectName: 'Publication Year', aspectConstraint: { aspectMode: 'FREE_TEXT' }, aspectValues: [] },
  { localizedAspectName: 'Format', aspectConstraint: { aspectMode: 'SELECTION_ONLY' }, aspectValues: ['Single Issue', 'Trade Paperback', 'Hardcover'].map((v) => ({ localizedValue: v })) },
  { localizedAspectName: 'Era', aspectConstraint: { aspectMode: 'SELECTION_ONLY' }, aspectValues: ['Bronze Age (1970-83)', 'Copper Age (1984-1991)', 'Golden Age (1938-55)', 'Modern Age (1992-Now)', 'Platinum Age (1897-1937)', 'Silver Age (1956-69)'].map((v) => ({ localizedValue: v })) },
  { localizedAspectName: 'Language', aspectConstraint: { aspectMode: 'SELECTION_ONLY' }, aspectValues: [{ localizedValue: 'English' }] },
] };

export const META_CONDITIONS = { itemConditionPolicies: [{ categoryTreeId: '0', categoryId: '259104', itemConditionRequired: false, itemConditions: [
  { conditionId: '1000', conditionDescription: 'Brand New' }, { conditionId: '2750', conditionDescription: 'Like New' },
  { conditionId: '4000', conditionDescription: 'Very Good' }, { conditionId: '5000', conditionDescription: 'Good' }, { conditionId: '6000', conditionDescription: 'Acceptable' },
] }] };

export const SHIPPING_XML = `<?xml version="1.0"?><GeteBayDetailsResponse><Ack>Success</Ack>
<ShippingServiceDetails><Description>USPS Media Mail</Description><ShippingService>USPSMedia</ShippingService><ShippingServiceID>9</ShippingServiceID><ServiceType>Calculated</ServiceType><ValidForSellingFlow>true</ValidForSellingFlow><ShippingCarrier>USPS</ShippingCarrier></ShippingServiceDetails>
<ShippingServiceDetails><Description>USPS Ground Advantage</Description><ShippingService>USPSGroundAdvantageReturn</ShippingService><ShippingServiceID>1155</ShippingServiceID><ServiceType>Calculated</ServiceType><ValidForSellingFlow>false</ValidForSellingFlow><ShippingCarrier>USPS</ShippingCarrier></ShippingServiceDetails>
<ShippingServiceDetails><Description>USPS Ground Advantage</Description><ShippingService>USPSParcel</ShippingService><ShippingServiceID>8</ShippingServiceID><ServiceType>Calculated</ServiceType><ValidForSellingFlow>true</ValidForSellingFlow><ShippingCarrier>USPS</ShippingCarrier></ShippingServiceDetails>
</GeteBayDetailsResponse>`;

// Mutable behavior switches a test may flip.
export const mockState = { picture: 'ok', metaDown: false, shippingFails: false };

// Returns a fetch-like response for REST metadata + the hosted picture URL, or null if not handled.
export function metaFetch(urlStr) {
  if (urlStr.includes('/sell/metadata/v1/')) return mockState.metaDown ? { ok: false, status: 503, json: async () => ({}) } : { ok: true, status: 200, json: async () => META_CONDITIONS };
  if (urlStr.includes('/commerce/taxonomy/v1/')) return mockState.metaDown ? { ok: false, status: 503, json: async () => ({}) } : { ok: true, status: 200, json: async () => META_ASPECTS };
  if (/^https:\/\/i\.ebayimg\.com\//.test(urlStr)) {
    if (mockState.picture === 'unreachable') return { ok: false, status: 404, headers: { get: () => 'text/html' } };
    return { ok: true, status: 206, headers: { get: (h) => (String(h).toLowerCase() === 'content-type' ? (mockState.picture === 'not-image' ? 'text/html' : 'image/jpeg') : null) } };
  }
  return null;
}

export function shippingResponse() {
  if (mockState.shippingFails) return { status: 200, text: async () => '<GeteBayDetailsResponse><Ack>Failure</Ack></GeteBayDetailsResponse>' };
  return { status: 200, text: async () => SHIPPING_XML };
}
