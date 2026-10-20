// V1 P0 PHYSICAL-ASSET RECEIPT BINDING -- a receipt proves what the server derived for one identity AND for which physical asset.
// Pure (no DB, no network): real authorityReceipt / listingAuthorityEvidence / governIncomingAuthority. Fixtures are Old Man Logan #25-shaped:
// one canonical Collection row linked to a physical asset, one unlinked catalogue stub with the same identity, and a second distinct asset
// that shares the catalogue identity. Nothing here touches Production.
// Invoke: node tests/v1-receipt-asset-binding.test.js

if (!process.env.GRAILKEY_SESSION_SECRET) process.env.GRAILKEY_SESSION_SECRET = (await import('node:crypto')).randomBytes(32).toString('base64url');
const { issueAuthorityReceipt, governIncomingAuthority, computeEvidenceVersion, verifyAuthorityReceipt } = await import('../src/lib/authorityReceipt.js');
const { resolveListingAuthorityEvidence } = await import('../src/lib/listingAuthorityEvidence.js');

let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) { pass++; console.log(`PASS  ${name}`); } else { fail++; console.log(`FAIL  ${name}${detail ? ' :: ' + detail : ''}`); } };

const P = 'principal-owner-0001';
const CANON_ROW = 'cv_canonical_oml25', STUB_ROW = 'cv_stub_oml25', OTHER_ROW = 'cv_second_copy_oml25';
const ASSET_A = 'asset-A-canonical', ASSET_B = 'asset-B-second-copy';
const hashesA = ['hA1', 'hA2'], hashesB = ['hB1'];
const evA = computeEvidenceVersion(hashesA), evB = computeEvidenceVersion(hashesB);

const response = {
  title: 'Old Man Logan', issue: '25', year: '2017',
  decision: { action: 'LIST_NOW' }, pricingSource: 'verified_sold', matchConfidence: { tier: 'HIGH' },
  soldCompDiagnostics: { rawCount: 6, verifiedCount: 4, newestDaysAgo: 12 }, identityConfident: true,
  rawComps: { count: 9 }, soldComps: [{}, {}, {}, {}], contract: { locks: [] },
};
const bindingA = { collectionItemId: CANON_ROW, gkAssetId: ASSET_A, evidenceVersion: evA };
const receiptA = issueAuthorityReceipt({ principalId: P, response, binding: bindingA });
const receiptUnbound = issueAuthorityReceipt({ principalId: P, response, binding: null });
const durable = (r) => ({ title: 'Old Man Logan', issue: '25', authorityReceipt: r });
const listing = (r, o) => resolveListingAuthorityEvidence({}, durable(r), { principalId: P, ...o });
const bothMatch = { gkAssetId: ASSET_A, collectionItemId: CANON_ROW, evidenceVersion: evA };

// ---- baseline: the signed binding is in the signed body and unforgeable
check('receipt carries the signed binding', verifyAuthorityReceipt(receiptA, P).payload.binding.gkAssetId === ASSET_A);
const tampered = { ...receiptA, body: receiptA.body.replace(ASSET_A, ASSET_B) };
check('editing the bound asset id invalidates the signature', verifyAuthorityReceipt(tampered, P).ok === false);

// ---- listing preflight revalidation
check('canonical asset + current evidence => VERIFIED', listing(receiptA, bothMatch).sources.receipt === 'VERIFIED');
check('canonical receipt authorises (decision comes from the receipt)', listing(receiptA, bothMatch).evidence.decision?.action === 'LIST_NOW');

// cross-asset replay: asset A's receipt on a second distinct asset that shares the catalogue identity
const replayOnB = listing(receiptA, { gkAssetId: ASSET_B, collectionItemId: OTHER_ROW, evidenceVersion: evB });
check('cross-asset replay (A receipt, asset B) => ASSET_MISMATCH', replayOnB.sources.receipt === 'ASSET_MISMATCH', replayOnB.sources.receipt);
check('cross-asset replay yields NO authority (decision null, zero sold evidence)', replayOnB.evidence.decision === null && replayOnB.evidence.soldCompDiagnostics.verifiedCount === 0);
// same asset id but a different Collection row claims it
check('right asset, wrong Collection row => ASSET_MISMATCH', listing(receiptA, { ...bothMatch, collectionItemId: OTHER_ROW }).sources.receipt === 'ASSET_MISMATCH');

// stub lacking an independent valid gkAssetId: its receipt was issued unbound, so it cannot authorise ANY asset
const stub = listing(receiptUnbound, bothMatch);
check('unbound receipt (stub / pre-capture) => UNBOUND, fail closed', stub.sources.receipt === 'UNBOUND', stub.sources.receipt);
check('unbound receipt yields no authority', stub.evidence.decision === null && stub.evidence.pricingSource === null);

// evidence version
const added = listing(receiptA, { ...bothMatch, evidenceVersion: computeEvidenceVersion([...hashesA, 'hA3']) });
check('new physical evidence since the receipt => EVIDENCE_VERSION_STALE', added.sources.receipt === 'EVIDENCE_VERSION_STALE', added.sources.receipt);
check('evidence lookup failure sentinel can never match', listing(receiptA, { ...bothMatch, evidenceVersion: 'EVIDENCE_UNAVAILABLE' }).sources.receipt === 'EVIDENCE_VERSION_STALE');
check('evidence version is order-independent and content-derived', computeEvidenceVersion(['b', 'a']) === computeEvidenceVersion(['a', 'b']) && computeEvidenceVersion(['a']) !== computeEvidenceVersion(['b']));

// principal binding still holds
check('another principal cannot use the receipt', resolveListingAuthorityEvidence({}, durable(receiptA), { principalId: 'someone-else', ...bothMatch }).sources.receipt.startsWith('UNVERIFIED:'));

// ---- operator corrections / Q41 are NOT promoted to server evidence
const forged = resolveListingAuthorityEvidence({ decision: { action: 'LIST_NOW' }, pricingSource: 'verified_sold', soldCompDiagnostics: { rawCount: 9, verifiedCount: 9, newestDaysAgo: 1 }, operatorPrice: 999, q41Acknowledged: true },
  durable(receiptUnbound), { principalId: P, ...bothMatch });
check('request-supplied decision/pricingSource/sold counts are ignored without a bound receipt', forged.evidence.decision === null && forged.evidence.pricingSource === null && forged.evidence.soldCompDiagnostics.verifiedCount === 0);
check('request can still ADD restrictions with a bound receipt', resolveListingAuthorityEvidence({ manualReviewRequired: true }, durable(receiptA), { principalId: P, ...bothMatch }).evidence.manualReviewRequired === true);

// ---- /api/collection write path (row binding)
const incoming = (r) => ({ title: 'Old Man Logan', issue: '25', decision: { action: 'LIST_NOW' }, authorityReceipt: r });
check('receipt for row A accepted on row A', governIncomingAuthority(incoming(receiptA), P, CANON_ROW).verified === true);
const wrongRow = governIncomingAuthority(incoming(receiptA), P, STUB_ROW);
check('receipt for row A REJECTED on the stub row (row-mismatch)', wrongRow.verified === false && wrongRow.reason === 'row-mismatch', JSON.stringify(wrongRow.reason));
check('rejected write also loses the client-supplied execution fields and the receipt slot', wrongRow.attributes.decision === undefined && wrongRow.attributes.authorityReceipt === undefined);
check('replay of A onto second-copy row rejected', governIncomingAuthority(incoming(receiptA), P, OTHER_ROW).verified === false);
check('unbound (pre-asset) receipt still accepted on any of the principal\'s own rows (no asset exists to protect yet)', governIncomingAuthority(incoming(receiptUnbound), P, STUB_ROW).verified === true);
check('no rowId supplied => legacy behaviour preserved', governIncomingAuthority(incoming(receiptA), P).verified === true);

// ---- evidence-version determinism (R3). computeEvidenceVersion is DUPLICATE-SENSITIVE by design (preserved, not changed here): it sorts, then hashes the
// multiset. Old Man Logan #25 (Production asset 01a0bb24-...) has 8 media rows but only 7 distinct content hashes, so removing the duplicate RECORD would
// change its version (08c87b24...), and the receipt would go EVIDENCE_VERSION_STALE.
console.log('\n-- evidence version: determinism --');
const H = ['b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f901', '0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9', 'ffeeddccbbaa00998877665544332211ffeeddccbbaa00998877665544332211'];
const GOLDEN_INPUT = JSON.stringify(H);
const GOLDEN = '1de3602a01e06e91f8b4ab1201b1736b';
check('GOLDEN: the exact input set ' + GOLDEN_INPUT + ' -> ' + GOLDEN, computeEvidenceVersion(H) === GOLDEN, computeEvidenceVersion(H));
check('golden is retrieval-order independent (all 6 permutations)', [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]].every((o) => computeEvidenceVersion(o.map((i) => H[i])) === GOLDEN));
check('hash REMOVAL changes the version', computeEvidenceVersion(H.slice(0, 2)) !== GOLDEN && computeEvidenceVersion(H.slice(1)) !== GOLDEN && computeEvidenceVersion(H.slice(0, 2)) !== computeEvidenceVersion(H.slice(1)));
check('hash ADDITION changes the version', computeEvidenceVersion([...H, 'ab'.repeat(32)]) !== GOLDEN);
const dup = computeEvidenceVersion([...H, H[0]]);
check('DUPLICATE addition changes the version (duplicate-sensitive, preserved)', dup !== GOLDEN);
check('duplicate removal returns exactly to the original version', computeEvidenceVersion([H[0], H[1], H[2], H[0]].slice(0, 3)) === GOLDEN);
check('duplicate version is itself deterministic across order', dup === computeEvidenceVersion([H[2], H[0], H[1], H[0]]) && dup === computeEvidenceVersion([H[0], H[0], H[2], H[1]]));
check('the OML shape: 8 rows / 7 distinct -> dropping the duplicate RECORD changes the version', (() => {
  const seven = Array.from({ length: 7 }, (_, i) => String(i + 1).repeat(64).slice(0, 64));
  const eight = [...seven, seven[3]];
  return computeEvidenceVersion(eight) !== computeEvidenceVersion(seven) && new Set(eight).size === 7 && eight.length === 8;
})());
check('empty evidence -> null (never a hash of nothing)', computeEvidenceVersion([]) === null && computeEvidenceVersion(undefined) === null && computeEvidenceVersion(null) === null);
check('null / empty / non-string entries are dropped deterministically', computeEvidenceVersion([null, '', undefined, 7, ...H]) === GOLDEN && computeEvidenceVersion([null, '']) === null);
check('only missing hashes + real ones == the real ones alone', computeEvidenceVersion([H[1], null, H[0], '', H[2]]) === GOLDEN);
check('an unbound-evidence receipt (null version) on an asset that LATER gains media goes STALE', (() => {
  const r = issueAuthorityReceipt({ principalId: P, response, binding: { collectionItemId: CANON_ROW, gkAssetId: ASSET_A, evidenceVersion: null } });
  return listing(r, { gkAssetId: ASSET_A, collectionItemId: CANON_ROW, evidenceVersion: null }).sources.receipt === 'VERIFIED'
    && listing(r, { gkAssetId: ASSET_A, collectionItemId: CANON_ROW, evidenceVersion: GOLDEN }).sources.receipt === 'EVIDENCE_VERSION_STALE';
})());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
