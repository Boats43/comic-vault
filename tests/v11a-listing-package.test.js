// tests/v11a-listing-package.test.js -- V1.1a: the evidence-grounded LISTING PACKAGE (pure, DB-free, network-free).
//
// Covers: correct title + variant, category-valid condition, validated item specifics, factual descriptions only, multiple eligible
// physical photographs, no reference-image substitution, missing-photo honesty, seller corrections + their validation, unsupported
// claim blocking, package-hash binding, and the server-signed approval (tamper / principal / asset / stale).
//
// Invoke: node tests/v11a-listing-package.test.js

import { randomBytes } from 'node:crypto';
if (!process.env.GRAILKEY_SESSION_SECRET) process.env.GRAILKEY_SESSION_SECRET = randomBytes(32).toString('base64url');

const { buildListingPackage, selectListingPhotos, scanUnsupportedClaims, validateSellerTitle, isApprovalCurrent, appendShippingAndReturns, describePriceEvidence } = await import('../src/lib/listingPackage.js');
const { issueListingApproval, verifyListingApproval, checkListingApproval } = await import('../src/lib/listingApproval.js');

let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  PASS ${l}`); } else { failed++; console.log(`  FAIL ${l}`); } };

const ASPECTS = new Map([
  ['Publisher', { mode: 'FREE_TEXT', values: [] }], ['Series Title', { mode: 'FREE_TEXT', values: [] }],
  ['Issue Number', { mode: 'FREE_TEXT', values: [] }], ['Publication Year', { mode: 'FREE_TEXT', values: [] }],
  ['Era', { mode: 'SELECTION_ONLY', values: ['Modern Age (1992-Now)', 'Copper Age (1984-1991)'] }],
  ['Format', { mode: 'SELECTION_ONLY', values: ['Single Issue', 'Trade Paperback'] }],
]);
const POLICY_OPTIONAL = { itemConditionRequired: false, itemConditions: [] };
const POLICY_REQUIRED = { itemConditionRequired: true, itemConditions: [{ conditionId: '3000', conditionDescription: 'Used' }] };

const OML = { title: 'Avengers', issue: '4', year: '2023', publisher: 'Marvel', variant: 'Alex Ross Connecting Virgin Variant',
  gradeAuthority: 'OPERATOR_CONFIRMED', operatorGrade: '9.2', operatorIsGraded: false, operatorGradeNumeric: 9.2 };
const m = (id, view, hash, over = {}) => ({ mediaId: id, mediaType: 'capture-photo', contentHash: hash, contentType: 'image/jpeg', captureView: view, ...over });
const PHOTOS = [m('m-front', 'FRONT', 'a'.repeat(64)), m('m-back', 'BACK', 'b'.repeat(64)), m('m-spine', 'SPINE', 'c'.repeat(64))];
const build = (over = {}) => buildListingPackage({ governed: OML, media: PHOTOS, price: 15.42, pricingSource: 'active_ask_derived', aspectMeta: ASPECTS, conditionPolicy: POLICY_OPTIONAL, ...over });

console.log('\n--- 1. correct title and variant ---');
{
  const p = build();
  ok(p.title === 'Avengers #4 Alex Ross Connecting Virgin Variant Marvel 2023 Raw NM-', `governed title keeps series, issue, exact variant, publisher, year, raw condition (got "${p.title}")`);
  ok(p.title.length <= 80 && p.titleSource === 'governed', 'title within 80 chars and sourced from verified facts');
  ok(p.approvable === true && !!p.packageHash, 'a complete, honest package is approvable and hashed');
}

console.log('\n--- 2. variant kinds stay distinct in seller titles ---');
{
  ok(validateSellerTitle('Avengers #4 Alex Ross B&W Sketch Virgin 2023', { ...OML, issue: '4' }).some((x) => /different edition/.test(x)), 'colour-virgin book: a B&W/sketch title is refused');
  ok(validateSellerTitle('Avengers #4 Alex Ross Trade Dress Cover 2023', OML).some((x) => /different edition/.test(x)), 'colour-virgin book: a trade-dress title is refused');
  ok(validateSellerTitle('Avengers #4 Alex Ross B&W Sketch Virgin 2023', { ...OML, variant: 'Alex Ross B&W Sketch Virgin' }).length === 0, 'a B&W/sketch book may name B&W/sketch');
  ok(validateSellerTitle('Avengers Alex Ross Virgin 2023', OML).some((x) => /issue number/.test(x)), 'a title that drops the verified issue is refused');
  ok(validateSellerTitle('Avengers #4 Alex Ross Virgin 1999', OML).some((x) => /year/.test(x)), 'a title with a different year is refused');
  ok(validateSellerTitle('X'.repeat(81), OML).some((x) => /80/.test(x)), 'over-length title is refused');
  const p = build({ draft: { titleOverride: 'Avengers #4 Alex Ross B&W Sketch Virgin 2023' } });
  ok(!p.approvable && p.unresolved.some((u) => u.field === 'title' && u.severity === 'blocking'), 'a contradicting seller title makes the package non-approvable');
  const p2 = build({ draft: { titleOverride: 'Avengers #4 (2023) Alex Ross Connecting Virgin Variant Marvel NM-' } });
  ok(p2.approvable && p2.titleSource === 'seller' && p2.title.startsWith('Avengers #4 (2023)'), 'a valid seller title is used and flagged as seller-edited');
}

console.log('\n--- 3. condition mapping is category-valid and never a certification ---');
{
  const p = build();
  ok(p.condition.ebayConditionId === null && p.condition.mapping === 'OMITTED_CATEGORY_OPTIONAL', 'comics category does not require a condition: none is sent');
  ok(p.condition.certification === 'NONE' && p.condition.isRaw === true, 'operator grade on a raw copy is not a certification');
  ok(/Raw copy\. GrailKey\/operator condition assessment approximately NM- 9\.2\. Not professionally graded or slabbed\./.test(p.descriptionHtml), 'description carries the exact raw-copy disclosure');
  ok(!/CGC|CBCS/.test(p.descriptionHtml.replace('Not professionally graded or slabbed.', '')), 'no CGC/CBCS claim anywhere in generated copy');
  const req = build({ conditionPolicy: POLICY_REQUIRED });
  ok(!req.approvable && req.unresolved.some((u) => u.field === 'condition' && u.severity === 'blocking'), 'a category that requires a condition with no governed mapping blocks approval (no invented enum)');
  const none = build({ conditionPolicy: null });
  ok(!none.approvable && none.packageHash === null, 'unavailable condition policy blocks approval and yields no hash');
  const ungraded = buildListingPackage({ governed: { ...OML, gradeAuthority: undefined, operatorGrade: undefined, operatorGradeNumeric: undefined }, media: PHOTOS, price: 15.42, aspectMeta: ASPECTS, conditionPolicy: POLICY_OPTIONAL });
  ok(/See photos for condition details/.test(ungraded.descriptionHtml) && ungraded.condition.publicGrade === null, 'no operator grade => no grade published; "See photos" sentence');
  const slab = buildListingPackage({ governed: { ...OML, operatorIsGraded: true, operatorGradeNumeric: 9.4, operatorGrade: '9.4' }, media: PHOTOS, price: 15.42, aspectMeta: ASPECTS, conditionPolicy: POLICY_OPTIONAL });
  ok(slab.condition.certification === 'SLAB_CLAIMED_BY_OPERATOR', 'an operator-declared slab is labelled as operator-declared, not verified certification');
}

console.log('\n--- 4. item specifics are validated against eBay metadata ---');
{
  const p = build();
  const names = p.specifics.map((s) => s.name);
  ok(['Publisher', 'Series Title', 'Issue Number', 'Publication Year', 'Era', 'Format'].every((n) => names.includes(n)), `specifics present and enum-valid: ${names.join(', ')}`);
  ok(p.specifics.find((s) => s.name === 'Era').value === 'Modern Age (1992-Now)' && p.specifics.find((s) => s.name === 'Format').value === 'Single Issue', 'Era and Format come from eBay enum values');
  const bare = build({ aspectMeta: new Map([['Publisher', { mode: 'FREE_TEXT', values: [] }]]) });
  ok(bare.specifics.length === 1 && bare.specifics[0].name === 'Publisher', 'fields the category does not define are never invented');
  ok(build({ aspectMeta: null }).approvable === false, 'unavailable aspect metadata blocks approval');
  ok(!p.specifics.some((s) => /signed|rare|ratio|1:/i.test(s.value)), 'no signature / scarcity specifics are fabricated');
}

console.log('\n--- 5. descriptions are factual: seller text is scanned for unsupported claims ---');
{
  const bad = {
    certification: 'Beautiful copy, CGC 9.8 candidate', signature: 'Signed by Alex Ross', flawless: 'Flawless, no creases, gem mint', restoration: 'Unrestored and never pressed',
    scarcity: 'Rare 1:100 ratio', provenance: 'From the collection of a first owner', commercial: 'Worth $200 per Overstreet and recent sales',
  };
  for (const [rule, text] of Object.entries(bad)) {
    const p = build({ draft: { conditionNote: text } });
    ok(!p.approvable && p.unsupportedClaims.length > 0, `[${rule}] "${text}" is blocked as an unsupported claim`);
  }
  ok(build({ draft: { conditionNote: 'Light shelf wear on the lower right corner; one small crease at the staple.' } }).approvable, 'an honest seller observation is allowed');
  ok(scanUnsupportedClaims({ n: 'signed' }, { variant: 'Alex Ross Signed Variant' }).length === 0, 'a signature already in the governed variant is not a new claim');
  ok(scanUnsupportedClaims({ n: 'cgc 9.4 label' }, { isSlab: true }).length === 0, 'a CGC mention is allowed when the operator declared a slab');
  const p = build({ draft: { conditionNote: 'Seen in hand; spine intact.' } });
  ok(/Seller note: Seen in hand; spine intact\./.test(p.descriptionHtml), 'the seller note appears verbatim, labelled as a seller note');
  ok(!/flawless|mint|no defects|perfect/i.test(p.descriptionHtml), 'generated copy never asserts flawlessness');
  ok(!/Overstreet|price guide|sold for|market value|recent sales|census/i.test(p.descriptionHtml), 'no external commercial-data claim in generated copy');
  ok(/Condition of areas not shown is not represented/.test(p.descriptionHtml), 'unphotographed areas are disclosed as not represented, not assumed clean');
  const model = buildListingPackage({ governed: { ...OML, restoration: 'color touch on spine', defectPenalty: 0.8 }, media: PHOTOS, price: 15.42, aspectMeta: ASPECTS, conditionPolicy: POLICY_OPTIONAL });
  ok(model.modelObserved.restoration === 'color touch on spine' && !/color touch|restoration/i.test(model.descriptionHtml), 'model-observed condition is shown to the seller but NOT published');
}

console.log('\n--- 6. photographs: multiple eligible, FRONT primary, honest about missing, no substitution ---');
{
  const p = build();
  ok(p.photos.selected.length === 3 && p.photos.selected[0].captureView === 'FRONT' && p.photos.selected[0].role === 'PRIMARY', 'three durable photos publish, FRONT is primary');
  ok(p.photos.selected.map((x) => x.captureView).join() === 'FRONT,BACK,SPINE', 'published in FRONT, BACK, SPINE order');
  ok(p.photos.missingViews.join() === 'PAGES', 'PAGES is reported missing, not manufactured');
  ok(p.unresolved.some((u) => u.field === 'photo:PAGES'), 'the missing view is listed as unresolved');
  ok(/3 photos of the actual book shown: Front cover, Back cover, Spine\./.test(p.descriptionHtml) && /Not photographed: Interior pages/.test(p.descriptionHtml), 'the description states exactly which views are shown and which are not');
  const shuffled = selectListingPhotos([PHOTOS[2], PHOTOS[0], PHOTOS[1]]);
  ok(shuffled.selected[0].captureView === 'FRONT', 'FRONT stays primary regardless of storage order');
  const noFront = selectListingPhotos([m('x1', 'BACK', 'd'.repeat(64))]);
  ok(noFront.selected[0].role === 'PRIMARY' && noFront.primaryIsFront === false, 'with no FRONT the primary is flagged as not the front cover');
  const docs = selectListingPhotos([m('d1', null, 'e'.repeat(64), { mediaType: 'document', contentType: 'application/pdf' }), m('w1', 'FRONT', 'f'.repeat(64), { contentType: 'text/html' })]);
  ok(docs.selected.length === 0, 'documents and non-image rows are never published');
  const none = build({ media: [] });
  ok(!none.approvable && none.unresolved.some((u) => u.field === 'photos' && u.severity === 'blocking'), 'no photograph => blocking (never a catalogue / marketplace substitute)');
  const legacy = selectListingPhotos([m('l1', null, '1'.repeat(64))]);
  ok(legacy.selected.length === 1 && legacy.selected[0].viewLabel === 'Unlabelled capture photo' && legacy.unlabeledCount === 1, 'a legacy unlabelled photo is shown as unlabelled, not assigned a view');
  const picked = selectListingPhotos(PHOTOS, { selectedMediaIds: ['m-front', 'm-spine'] });
  ok(picked.selected.map((x) => x.mediaId).join() === 'm-front,m-spine' && picked.candidates.length === 3, 'the seller can choose a subset; every candidate stays listed');
  const excl = selectListingPhotos(PHOTOS, { excludedMediaIds: ['m-front'] });
  ok(excl.selected[0].captureView === 'BACK' && excl.hasFront === false, 'excluding FRONT is honoured and the primary is then not the front');
  ok(selectListingPhotos(Array.from({ length: 20 }, (_, i) => m(`p${i}`, null, String(i).padStart(64, '0')))).selected.length === 12, 'at most 12 photos');
}

console.log('\n--- 7. price and evidence-class disclosure (preview only) ---');
{
  ok(describePriceEvidence('active_ask_derived').evidenceClass === 'ACTIVE_ASKS' && /not sold prices/.test(describePriceEvidence('active_ask_derived').disclosure), 'ask-derived price is disclosed as asking prices, not sold prices');
  ok(describePriceEvidence('verified_sold').evidenceClass === 'VERIFIED_SOLD' && describePriceEvidence(null).evidenceClass === 'OPERATOR_SET', 'sold and operator-set classes');
  const p = build();
  ok(p.price.amount === 15.42 && !/asking price|sold/i.test(p.descriptionHtml.replace(/Packed in|Ships within/g, '')), 'the disclosure lives in the preview, not in buyer-facing copy');
  ok(!build({ price: 0 }).approvable, 'no approved price blocks approval');
}

console.log('\n--- 8. package hash binds exactly what publishes ---');
{
  const a = build(); const b = build();
  ok(a.packageHash === b.packageHash, 'deterministic');
  ok(build({ price: 15.43 }).packageHash !== a.packageHash, 'a price change changes the hash');
  ok(build({ draft: { conditionNote: 'One small crease.' } }).packageHash !== a.packageHash, 'a seller note changes the hash');
  ok(build({ media: [...PHOTOS, m('m-pages', 'PAGES', '9'.repeat(64))] }).packageHash !== a.packageHash, 'a new photo changes the hash');
  ok(build({ media: [PHOTOS[1], PHOTOS[0], PHOTOS[2]] }).packageHash === a.packageHash, 'storage order of rows does not change the hash (publish order is by view)');
  ok(build({ governed: { ...OML, variant: 'Alex Ross B&W Sketch Virgin' } }).packageHash !== a.packageHash, 'a different edition changes the hash');
  ok(appendShippingAndReturns('x', 'USPS Ground Advantage') !== appendShippingAndReturns('x', 'USPS Priority Mail') && /SHIPPING/.test(appendShippingAndReturns('x')), 'shipping text is appended after hashing (V1.1b seller-shipping work is independent)');
}

console.log('\n--- 9. server-signed approval ---');
{
  const P = 'principal-1'; const A = 'asset-1';
  const pkg = build();
  const ap = issueListingApproval({ principalId: P, gkAssetId: A, packageHash: pkg.packageHash });
  ok(!!ap && verifyListingApproval(ap, P).ok, 'approval issues and verifies for its principal');
  ok(checkListingApproval(ap, { principalId: P, gkAssetId: A, currentPackageHash: pkg.packageHash }).ok, 'valid for the same asset + same package');
  ok(checkListingApproval(null, { principalId: P, gkAssetId: A, currentPackageHash: pkg.packageHash }).reason === 'absent', 'absent approval is refused');
  ok(checkListingApproval({ ...ap, sig: ap.sig.slice(0, -3) + 'AAA' }, { principalId: P, gkAssetId: A, currentPackageHash: pkg.packageHash }).reason === 'invalid:bad-signature', 'forged signature is refused');
  ok(checkListingApproval({ ...ap, body: ap.body.replace(pkg.packageHash, '0'.repeat(64)) }, { principalId: P, gkAssetId: A, currentPackageHash: pkg.packageHash }).reason === 'invalid:bad-signature', 'an edited body is refused');
  ok(checkListingApproval(ap, { principalId: 'principal-2', gkAssetId: A, currentPackageHash: pkg.packageHash }).reason === 'invalid:principal-mismatch', "another principal cannot use this seller's approval");
  ok(checkListingApproval(ap, { principalId: P, gkAssetId: 'asset-2', currentPackageHash: pkg.packageHash }).reason === 'asset-mismatch', 'approval is bound to its asset');
  ok(checkListingApproval(ap, { principalId: P, gkAssetId: A, currentPackageHash: build({ price: 99 }).packageHash }).reason === 'stale-package', 'any change to the package makes the approval stale');
  ok(checkListingApproval(ap, { principalId: P, gkAssetId: A, currentPackageHash: null }).reason === 'package-unavailable', 'a non-approvable package can never match');
  ok(isApprovalCurrent({ approvedPackageHash: pkg.packageHash }, pkg) && !isApprovalCurrent({ approvedPackageHash: 'x' }, pkg), 'the UI current-check agrees');
  ok(issueListingApproval({ principalId: P, gkAssetId: A, packageHash: null }) === null, 'no approval can be issued for a non-hashed package');
  const saved = process.env.GRAILKEY_SESSION_SECRET; process.env.GRAILKEY_SESSION_SECRET = 'short';
  ok(issueListingApproval({ principalId: P, gkAssetId: A, packageHash: pkg.packageHash }) === null, 'fails closed below the 32-char secret floor');
  process.env.GRAILKEY_SESSION_SECRET = saved;
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
process.exit(failed ? 1 : 0);
