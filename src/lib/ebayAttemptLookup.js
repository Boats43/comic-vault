// src/lib/ebayAttemptLookup.js -- B1-FINAL A3. SELLER-SCOPED, READ-ONLY lookup of a listing created (or not) by a
// specific marketplace attempt. It performs NO write and can never create a listing.
//
// OFFICIAL SOURCES (checked 2026-10-12):
//  * eBay Developers Program Knowledge Base 1462, "ItemID retrieval when you loose the AddFixedPriceItem response"
//    (updated 2022-08-09) -- https://developer.ebay.com/support/knowledge-base/1462 : resend the SAME request with the
//    SAME Item.UUID; if the first call created the listing, eBay rejects with error 488 "Duplicate UUID used" and
//    returns the existing item id. If SKU tracking was used, GetItem by SKU; "No Matching SKU" is described as
//    permitting the inference that the call failed. The article gives NO timing / indexing guarantee.
//  * KB 74, "No response for AddItem request" (updated 2022-07-15) -- https://developer.ebay.com/support/knowledge-base/74
//  * GetItem reference -- https://developer.ebay.com/devzone/xml/docs/reference/ebay/GetItem.html : lookup by SKU works
//    only for the seller's OWN item that was listed with Item.InventoryTrackingMethod = SKU.
//  * GetMyeBaySelling reference -- https://developer.ebay.com/devzone/xml/docs/reference/ebay/GetMyeBaySelling.html :
//    ActiveList / ScheduledList / SoldList / UnsoldList for the authenticated seller; SKU is returned on Active and
//    Scheduled items; Sold/Unsold are limited to DurationInDays <= 60; 25 000-item and 125-page ceilings; the reference
//    states no completeness or latency guarantee.
//  * The public Browse API is unauthenticated-seller-blind: it can never establish that a listing does NOT exist.
//
// CONSEQUENCE (encoded below): this module can establish PRESENCE (a match is evidence a listing exists) but it
// NEVER reports proven absence -- `absenceProven` is always false. A "no match" is recorded together with its
// coverage and caveats, and can only be weighed by the operator reconciliation policy; it is never, by itself,
// permission for another AddFixedPriceItem call.

const LISTS = [
  { name: 'ActiveList', container: 'ActiveList', skuReturned: true },
  { name: 'ScheduledList', container: 'ScheduledList', skuReturned: true },
  { name: 'UnsoldList', container: 'UnsoldList', skuReturned: 'not-confirmed-by-reference', durationInDays: 60 },
  { name: 'SoldList', container: 'SoldList', skuReturned: 'not-confirmed-by-reference', durationInDays: 60 },
];

export const LOOKUP_CAVEATS = Object.freeze([
  'SELLER_SCOPED_ONLY',
  'NO_PROVIDER_COMPLETENESS_GUARANTEE',
  'NO_PROVIDER_INDEXING_LATENCY_GUARANTEE',
  'SOLD_AND_UNSOLD_LIMITED_TO_60_DAYS',
  'SKU_NOT_CONFIRMED_ON_SOLD_OR_UNSOLD_ITEMS',
  'SKU_LABEL_NOT_GETITEM_LOOKUPABLE_WITHOUT_SKU_TRACKING',
]);

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const tag = (xml, name) => { const m = String(xml || '').match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`)); return m ? m[1].trim() : null; };

export function buildGetMyeBaySellingXml({ list, pageNumber = 1, entriesPerPage = 200 }) {
  const spec = LISTS.find((l) => l.name === list);
  if (!spec) throw new Error(`unknown list ${list}`);
  const include = LISTS.map((l) => `<${l.container}>${l.name === list ? `<Include>true</Include>${spec.durationInDays ? `<DurationInDays>${spec.durationInDays}</DurationInDays>` : ''}<Pagination><EntriesPerPage>${entriesPerPage}</EntriesPerPage><PageNumber>${pageNumber}</PageNumber></Pagination>` : '<Include>false</Include>'}</${l.container}>`).join('');
  return `<?xml version="1.0" encoding="utf-8"?><GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">${include}</GetMyeBaySellingRequest>`;
}

/** @returns {{ack:string|null, items:Array<{itemId:string|null, sku:string|null, title:string|null}>, totalPages:number|null}} */
export function parseSellingList(xml, list) {
  const spec = LISTS.find((l) => l.name === list);
  const body = tag(xml, spec.container) || '';
  const items = [];
  for (const m of body.matchAll(/<Item>([\s\S]*?)<\/Item>/g)) items.push({ itemId: tag(m[1], 'ItemID'), sku: tag(m[1], 'SKU'), title: tag(m[1], 'Title') });
  // sold lists nest the item under <Transaction><Item>; the same regex catches it.
  const tp = tag(body, 'TotalNumberOfPages');
  return { ack: tag(xml, 'Ack'), items, totalPages: tp ? Number(tp) : null };
}

/**
 * Scan the seller's own lists for the attempt's SKU label. Injected `fetchImpl` and `headers` keep this testable and
 * make it impossible to call anything but the Trading endpoint passed in.
 */
export async function findListingByAttempt({ correlation, fetchImpl, endpoint, headers, maxPagesPerList = 10 }) {
  const coverage = [];
  const matches = [];
  let errors = 0;
  for (const spec of LISTS) {
    const cov = { list: spec.name, pagesRead: 0, totalPages: null, complete: false, error: null, skuReturned: spec.skuReturned };
    for (let page = 1; page <= maxPagesPerList; page++) {
      let res, text;
      try {
        res = await fetchImpl(endpoint, { method: 'POST', headers: { ...headers, 'Content-Type': 'text/xml', 'X-EBAY-API-CALL-NAME': 'GetMyeBaySelling' }, body: buildGetMyeBaySellingXml({ list: spec.name, pageNumber: page }) });
        text = await res.text();
      } catch (e) { cov.error = `network:${e && e.message ? String(e.message).slice(0, 60) : 'error'}`; errors++; break; }
      const parsed = parseSellingList(text, spec.name);
      if (!parsed.ack || /Failure/i.test(parsed.ack)) { cov.error = `ack:${parsed.ack || 'none'}`; errors++; break; }
      cov.pagesRead = page;
      cov.totalPages = parsed.totalPages;
      for (const it of parsed.items) if (it.sku && it.sku === correlation.sku) matches.push({ list: spec.name, itemId: it.itemId, sku: it.sku, title: it.title });
      if (parsed.totalPages === null || page >= parsed.totalPages) { cov.complete = true; break; }
    }
    coverage.push(cov);
  }
  return {
    matches,
    coverage,
    scannedAllListsCompletely: errors === 0 && coverage.every((c) => c.complete),
    // The provider contract does not guarantee completeness or freshness, so absence is NEVER claimed here.
    absenceProven: false,
    caveats: [...LOOKUP_CAVEATS],
  };
}

/** GetItem by a KNOWN item id: confirms that listing exists for this seller and reports its status. Read-only. */
export async function verifyListingById({ itemId, fetchImpl, endpoint, headers }) {
  const xml = `<?xml version="1.0" encoding="utf-8"?><GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ItemID>${esc(itemId)}</ItemID><DetailLevel>ReturnSummary</DetailLevel></GetItemRequest>`;
  let res, text;
  try {
    res = await fetchImpl(endpoint, { method: 'POST', headers: { ...headers, 'Content-Type': 'text/xml', 'X-EBAY-API-CALL-NAME': 'GetItem' }, body: xml });
    text = await res.text();
  } catch (e) { return { checked: false, exists: null, reason: 'network-error' }; }
  const ack = tag(text, 'Ack');
  if (!ack || /Failure/i.test(ack)) return { checked: true, exists: false, reason: 'provider-failure-or-not-found', ack };
  return { checked: true, exists: true, status: tag(text, 'ListingStatus'), sku: tag(text, 'SKU'), ack };
}
