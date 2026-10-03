// src/lib/ebayListingMetadata.js — Outcome #1: marketplace enums/values come from
// AUTHORITATIVE eBay selling metadata, never from memory, prose or a browse page.
//
//   * Item-condition policy ....... Sell Metadata API  getItemConditionPolicies  (EBAY_US, category)
//   * Item aspects / enums ......... Taxonomy API       getItemAspectsForCategory (tree 0, category)
//   * Domestic shipping service .... Trading API        GeteBayDetails / ShippingServiceDetails (SiteID 0)
//
// Every function takes an injectable `fetchImpl` (tests mock it; production passes the real fetch).
// Nothing here writes to eBay.
//
// PROVENANCE classes for item specifics:
//   A = resolved/validated against eBay metadata, B = derived from a GOVERNED catalogue fact,
//   C = constructed (NOT allowed to ship — such a value is omitted).

const REST = 'https://api.ebay.com';
const TRADING = 'https://api.ebay.com/ws/api.dll';

let tokenCache = null; // { token, exp }
export function __resetMetadataCachesForTests() { tokenCache = null; aspectCache.clear(); conditionCache.clear(); }
const aspectCache = new Map();
const conditionCache = new Map();

export async function getApplicationToken({ fetchImpl = fetch, env = process.env } = {}) {
  if (tokenCache && tokenCache.exp > Date.now() + 60_000) return tokenCache.token;
  const id = env.EBAY_APP_ID, secret = env.EBAY_CERT_ID;
  if (!id || !secret) throw new Error('EBAY app credentials unavailable');
  const res = await fetchImpl(`${REST}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64') },
    body: 'grant_type=client_credentials&scope=' + encodeURIComponent(`${REST}/oauth/api_scope`),
  });
  const body = await res.json();
  if (!body?.access_token) throw new Error('eBay application token unavailable');
  tokenCache = { token: body.access_token, exp: Date.now() + (Number(body.expires_in) || 7200) * 1000 };
  return tokenCache.token;
}

export async function getItemConditionPolicy(categoryId, opts = {}) {
  const f = opts.fetchImpl || fetch;
  if (conditionCache.has(categoryId)) return conditionCache.get(categoryId);
  const token = await getApplicationToken(opts);
  const res = await f(`${REST}/sell/metadata/v1/marketplace/EBAY_US/get_item_condition_policies?filter=categoryIds:%7B${encodeURIComponent(categoryId)}%7D`, {
    headers: { Authorization: `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US', Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`condition policy lookup failed (HTTP ${res.status})`);
  const body = await res.json();
  const policy = (body.itemConditionPolicies || []).find((p) => String(p.categoryId) === String(categoryId));
  if (!policy) throw new Error('no condition policy returned for category');
  conditionCache.set(categoryId, policy);
  return policy; // RAW: { itemConditionRequired, itemConditions: [{conditionId, conditionDescription}] }
}

export async function getAspectMetadata(categoryId, opts = {}) {
  const f = opts.fetchImpl || fetch;
  if (aspectCache.has(categoryId)) return aspectCache.get(categoryId);
  const token = await getApplicationToken(opts);
  const res = await f(`${REST}/commerce/taxonomy/v1/category_tree/0/get_item_aspects_for_category?category_id=${encodeURIComponent(categoryId)}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`aspect metadata lookup failed (HTTP ${res.status})`);
  const body = await res.json();
  const byName = new Map();
  for (const a of body.aspects || []) {
    byName.set(a.localizedAspectName, {
      mode: a.aspectConstraint?.aspectMode, required: a.aspectConstraint?.aspectRequired === true,
      values: (a.aspectValues || []).map((v) => v.localizedValue),
    });
  }
  aspectCache.set(categoryId, byName);
  return byName;
}

// A condition id may be emitted ONLY if the authoritative category policy lists it.
export function validateConditionId(conditionId, policy) {
  return !!policy && (policy.itemConditions || []).some((c) => String(c.conditionId) === String(conditionId));
}

// Era enum labels look like "Copper Age (1984-1991)" / "Modern Age (1992-Now)".
export function resolveEraAspect(year, aspectMeta, now = new Date()) {
  const era = aspectMeta?.get?.('Era');
  const y = parseInt(year, 10);
  if (!era || era.mode !== 'SELECTION_ONLY' || !Number.isFinite(y)) return null;
  const hits = [];
  for (const label of era.values) {
    // eBay's own labels mix 4-digit and 2-digit end years: "Copper Age (1984-1991)", "Silver Age (1956-69)".
    const m = label.match(/\((\d{4})\s*-\s*(\d{2,4}|Now)\)\s*$/);
    if (!m) continue;
    const lo = Number(m[1]);
    let hi = m[2] === 'Now' ? now.getFullYear() : Number(m[2]);
    if (m[2] !== 'Now' && m[2].length === 2) hi = Math.floor(lo / 100) * 100 + hi;
    if (y >= lo && y <= hi) hits.push(label);
  }
  return hits.length === 1 ? hits[0] : null; // ambiguous / unmatched => omit, never guess
}

// Build item specifics from GOVERNED facts, validated against eBay aspect metadata.
// Returns [{ name, value, provenance, source }] — only values that pass. Anything that
// cannot be proven is OMITTED (never constructed).
export function buildItemSpecificsFromMetadata(facts, aspectMeta, { isTPB = false, isMagazine = false, now } = {}) {
  const out = [];
  const known = (n) => aspectMeta?.has?.(n);
  const add = (name, value, provenance, source) => { if (value && known(name)) out.push({ name, value: String(value), provenance, source }); };
  add('Publisher', facts.publisher, 'B', 'governed catalogue fact: publisher');
  add('Series Title', facts.title, 'B', 'governed catalogue fact: title');
  add('Issue Number', facts.issue, 'B', 'governed catalogue fact: issue');
  add('Publication Year', facts.year, 'B', 'governed catalogue fact: year');
  const era = resolveEraAspect(facts.year, aspectMeta, now);
  if (era) add('Era', era, 'A', 'eBay Era enum (Taxonomy API) selected by the governed year');
  const fmt = aspectMeta?.get?.('Format');
  if (facts.issue && !isTPB && !isMagazine && fmt?.mode === 'SELECTION_ONLY' && fmt.values.includes('Single Issue')) {
    add('Format', 'Single Issue', 'A', 'eBay Format enum value; governed issue number present and not TPB/magazine');
  }
  return out;
}

// Domestic shipping service: resolved from eBay's own GeteBayDetails response. Media Mail
// is NEVER selectable. Returns the raw facts of the chosen service.
export function parseShippingServices(xml) {
  const blocks = String(xml).match(/<ShippingServiceDetails>[\s\S]*?<\/ShippingServiceDetails>/g) || [];
  return blocks.map((b) => {
    const g = (t) => (b.match(new RegExp(`<${t}>([^<]*)</${t}>`)) || [])[1] ?? null;
    return {
      token: g('ShippingService'), description: (g('Description') || '').trim(), id: g('ShippingServiceID'), serviceType: g('ServiceType'),
      validForSellingFlow: g('ValidForSellingFlow') === 'true', international: g('InternationalService') === 'true',
      carrier: g('ShippingCarrier'), minDays: g('ShippingTimeMin'), maxDays: g('ShippingTimeMax'),
      packages: [...b.matchAll(/<ShippingPackage>([^<]*)<\/ShippingPackage>/g)].map((m) => m[1]),
    };
  });
}

export const FORBIDDEN_SHIPPING_TOKENS = ['USPSMedia'];

export function selectDomesticShippingService(services, { preferredDescription = 'USPS Ground Advantage' } = {}) {
  const pick = services.find((s) => s.validForSellingFlow && !s.international && s.carrier === 'USPS'
    && s.description === preferredDescription && !FORBIDDEN_SHIPPING_TOKENS.includes(s.token) && !/media mail/i.test(s.description));
  return pick || null;
}

export async function resolveDomesticShippingService({ headers, fetchImpl = fetch, preferredDescription } = {}) {
  const xml = '<?xml version="1.0" encoding="utf-8"?><GeteBayDetailsRequest xmlns="urn:ebay:apis:eBLBaseComponents"><DetailName>ShippingServiceDetails</DetailName></GeteBayDetailsRequest>';
  const res = await fetchImpl(TRADING, { method: 'POST', headers: { ...headers, 'Content-Type': 'text/xml', 'X-EBAY-API-CALL-NAME': 'GeteBayDetails' }, body: xml });
  const text = await res.text();
  if (!/<Ack>(Success|Warning)<\/Ack>/.test(text)) throw new Error('GeteBayDetails did not succeed');
  return selectDomesticShippingService(parseShippingServices(text), { preferredDescription });
}
