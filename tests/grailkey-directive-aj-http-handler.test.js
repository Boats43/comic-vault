// tests/grailkey-directive-aj-http-handler.test.js
//
// GrailKey Directive 2026-08-15-AJ — Proof 3: HTTP-level fixtures.
// AI tested only at the resolveIdentity/selectTitleFamilyCandidate unit
// level. AG's lesson (a unit-level fix silently reverted 3ms later by an
// untested downstream consumer) is a real, twice-confirmed class in this
// codebase — this file closes that gap for the AI/AJ identity mechanism
// specifically, by invoking api/enrich.js's REAL default-exported HTTP
// handler end to end.
//
// This environment has no live EBAY_APP_ID/EBAY_CERT_ID/COMICVINE_API_KEY/
// PRICECHARTING_TOKEN — every external network boundary already fails
// closed via early `if (!token) return null` guards (confirmed directly:
// the unmodified handler returns a clean 200/ID_REQUIRED with zero
// visual-pool data when no credentials are set at all). To exercise the
// identity path specifically (which requires real eBay image-search
// results to reach resolveIdentity's opts.visualItems), fake
// EBAY_APP_ID/EBAY_CERT_ID values are set so lookupEbayVisual's early
// guard passes, and ONLY the two eBay network calls it and getOAuthToken
// actually make (oauth2/token, search_by_image) are intercepted with
// canned responses shaped like the Detective/Venom fixtures already
// proven at the unit level. Every other external call
// (ComicVine/PriceCharting/eBay active-comp search/Ximilar) is left
// exactly as this environment already produces it — no credentials, no
// call, graceful null — so nothing about the actual identity-resolution
// CODE PATH (resolveIdentity, selectTitleFamilyCandidate, reconcileIssue,
// the api/enrich.js consumption sites) is mocked, patched, or bypassed.
//
// Invoke: node tests/grailkey-directive-aj-http-handler.test.js

process.env.EBAY_APP_ID = 'test-app-id';
process.env.EBAY_CERT_ID = 'test-cert-id';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (actual === expected) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);

const jsonResponse = (body) => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify(body),
  json: async () => body,
});

// Intercepts the eBay OAuth token endpoint, the search_by_image identity
// endpoint, AND the comp-search endpoint (item_summary/search, WITHOUT
// "_by_image" — api/comps.js's own active-listing search, distinct from
// the identity pool) with the SAME row set, so extractCreatorsFromComps
// (fed from rawComps.prices[].title, not the identity pool) also gets
// real data through the real handler — otherwise creatorFromComps stays
// empty for a reason having nothing to do with the identity mechanism
// this file exists to prove (an unmocked comp-search call, not a defect).
// Every OTHER URL (PriceCharting, ComicVine, Ximilar, sold-history) is
// passed through to a rejection — identical in effect to what already
// happens in this environment today for every source with no credentials
// configured at all.
const makeFetchMock = (itemSummaries) => {
  return async (url, opts) => {
    const u = String(url);
    if (u.includes('oauth2/token')) {
      return jsonResponse({ access_token: 'fake-token', expires_in: 7200 });
    }
    if (u.includes('search_by_image')) {
      return jsonResponse({ itemSummaries });
    }
    if (u.includes('item_summary/search')) {
      return jsonResponse({ itemSummaries });
    }
    throw new Error(`[test fetch mock] unmocked URL, simulating the SAME network failure this environment already produces for every other external source: ${u}`);
  };
};

const ebayRow = (title, price = '19.99') => ({
  title,
  price: { value: price, currency: 'USD' },
  itemWebUrl: `https://ebay.com/itm/${Math.random().toString(36).slice(2)}`,
  itemId: `v1|${Math.random().toString(36).slice(2)}|0`,
  leafCategoryIds: ['259104'],
  buyingOptions: ['FIXED_PRICE'],
  sellerUsername: `seller_${Math.random().toString(36).slice(2, 6)}`,
});

const captureConsole = async (fn) => {
  const lines = [];
  const orig = console.log;
  console.log = (...args) => { lines.push(args.join(' ')); };
  let result;
  try {
    result = await fn();
  } finally {
    console.log = orig;
  }
  return { result, lines };
};

console.log('\n=== GrailKey Directive AJ — Proof 3: HTTP-level fixtures ===\n');

const { default: handler } = await import('../api/enrich.js');

const makeMockRes = () => {
  const captured = { statusCode: null, body: null };
  return {
    status: (code) => ({
      json: (data) => { captured.statusCode = code; captured.body = data; return captured; },
    }),
    setHeader: () => {},
    _captured: captured,
  };
};

const callEnrich = async (body, fetchMock) => {
  const realFetch = global.fetch;
  global.fetch = fetchMock;
  try {
    const req = { method: 'POST', body, headers: {} };
    const res = makeMockRes();
    await handler(req, res);
    return res._captured;
  } finally {
    global.fetch = realFetch;
  }
};

// ═══════════════════════════════════════════════════════════════════════
// Detective Comics via the real handler
// ═══════════════════════════════════════════════════════════════════════
console.log('Detective Comics #1107 via /api/enrich handler\n');

{
  const detectiveRows = [
    ebayRow('Detective Comics #1107 Corner Box Variant Jorge Jimenez'),
    ebayRow('Batman Beyond Compendium TPB'),
    ebayRow('Batman Funko Pop Figure'),
    ebayRow('Batman T-Shirt Large'),
    // Deliberately NOT CGC-graded text here (found via THIS file, running
    // through the real handler's actual title-family clustering): a mixed
    // raw+CGC-graded corroborating set trips Guard 6 (hasContaminatedMember,
    // SLAB_RE/GRADED_RE), which tests/q-trackB-commit4.3-winning-family-
    // authority.test.js's "CONTROL C" requires to suppress adoption for
    // exactly that shape — a real, intentional guard, not a bug. Plain
    // condition words avoid it while still giving >=3 unique corroborating
    // rows for MINIMUM_CORROBORATING_ROWS.
    ebayRow('Detective Comics #1107 Corner Box Variant Jorge Jimenez NM'),
    ebayRow('Detective Comics #1107 Corner Box Variant Jorge Jimenez NM Unread'),
    ebayRow('Detective Comics #1107 Corner Box Variant Jorge Jimenez VF White Pages'),
  ];
  const { result, lines } = await captureConsole(() =>
    callEnrich(
      { title: 'Batman', issue: null, publisher: 'DC', year: null, isGraded: false, grade: 'NM', images: ['data:image/jpeg;base64,AAAA'] },
      makeFetchMock(detectiveRows)
    )
  );
  const reconcileLine = lines.find((l) => l.startsWith('[reconcile-issue]'));

  assertEq(result.statusCode, 200, 'Detective: handler returned 200');
  assertTrue(!!reconcileLine, 'Detective: [reconcile-issue] fired inside the real handler — the reconciler executed on a live request, not just the unit fixture');
  console.log(`    (${reconcileLine})`);
  assertEq(result.body?.issue, '1107', 'Detective: out.issue (the terminal, response-boundary field) is "1107", not reported missing');
  assertEq(result.body?.identityProvisional, true, 'Detective: out.identityProvisional set through the real api/enrich.js consumption site');
  assertEq(result.body?.listingHardLocked, true, 'Detective: out.listingHardLocked set through the real consumption site');
  // Not asserting on the exact listingHardLockBanner TEXT here: with a
  // working comp search (real network, or this file's mock), Detective's
  // pool ALSO independently trips the pre-existing "refused-identity-
  // conflict" promotion path (family.decision, unrelated to this
  // dispatch), which sets its OWN banner text after Phase 2 comps run,
  // overwriting the Phase-1 banner this dispatch's mechanism set. Both
  // are accurate, honest messages: the safety PROPERTY (locked,
  // provisional) is what this dispatch owns and is asserted above; which
  // of two independently-correct banners wins the display string is a
  // pre-existing, unrelated precedence question, not a defect this file
  // found.
  assertTrue(String(result.body?.listingHardLockBanner || '').length > 0, 'Detective: some non-empty listingHardLockBanner reaches the response (a real explanation is shown either way)');
  // extractCreatorsFromComps' consensus list requires hits>=2; the dedup
  // filter (api/comps.js, unrelated to this dispatch) collapses this
  // mock's near-identical comp titles to 1 survivor, so the correct
  // creator surfaces as a SINGLETON (hits=1), not consensus — the same
  // combined-list check the unit-level fixture already uses.
  const creatorNames = [...(result.body?.creatorFromComps || []), ...(result.body?.creatorFromCompsSingleton || [])].map((c) => c.canonical);
  assertTrue(creatorNames.includes('Jorge Jimenez') && !creatorNames.includes('Phil Jimenez'), 'Detective: creator credit is "Jorge Jimenez", not "Phil Jimenez", through the real handler (consensus + singleton combined)');
}

// ═══════════════════════════════════════════════════════════════════════
// Venom via the real handler
// ═══════════════════════════════════════════════════════════════════════
console.log('\nVenom: Separation Anxiety via /api/enrich handler\n');

{
  const venomRows = [
    ebayRow('Venom Separation Anxiety #1 Marvel Trade Variant Cover'),
    ebayRow('Venom Separation Anxiety #2 Marvel'),
    ebayRow('Venom Separation Anxiety #4 Marvel 1994'),
    ebayRow('Venom Madness Lot Last Dance Men 97 Juggernaut MCU'),
    ebayRow('Venom The Enemy Within #1 1994'),
    ebayRow('Venom Separation Anxiety #3 Marvel 2024'),
    ebayRow('Venom Lethal Protector #1'),
    ebayRow('Venom Separation Anxiety Annual'),
  ];
  const { result, lines } = await captureConsole(() =>
    callEnrich(
      { title: 'Venom: Separation Anxiety', issue: '3', publisher: 'Marvel', year: null, isGraded: false, grade: 'NM', images: ['data:image/jpeg;base64,AAAA'] },
      makeFetchMock(venomRows)
    )
  );
  const reconcileLine = lines.find((l) => l.startsWith('[reconcile-issue]'));

  assertEq(result.statusCode, 200, 'Venom: handler returned 200');
  assertTrue(!!reconcileLine, 'Venom: [reconcile-issue] fired inside the real handler');
  console.log(`    (${reconcileLine})`);
  assertEq(result.body?.issue, '1', 'Venom: out.issue is "1" (the adopted candidate), not "3" (Vision\'s rejected read)');
  assertEq(result.body?.identityProvisional, true, 'Venom: out.identityProvisional set');
  assertTrue(result.body?.decision?.action !== undefined, 'Venom: a decision was computed (pipeline did not crash/early-exit before reaching it)');
  assertTrue(result.body?.decision?.action !== 'LIST_NOW', 'Venom: decision.action is not LIST_NOW — a contested identity never reaches the clean-ship action');
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
