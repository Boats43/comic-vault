// tests/q144c-confirmed-identity-merge.test.js
//
// Q144C dispatch, instance 7 (2026-07-22, Adventure Time weighted-consensus
// class) — traced live via a pre/post-finalizeResponse diagnostic (Jimmy's
// scan on commit 4ffe76b): server-side out.issue="1" survived cleanly
// through response assembly and serialization ([q144c-pre-finalize]
// hasIssue=true issue="1", [q144c-post-finalize] hasIssue=true issue="1")
// — the loss was 100% client-side, and NOT at applyProvisionalIdentity
// (0213bee's fix), since that only fires when enrich.identityProvisional
// is true. This scan resolved via weighted-consensus — a CONFIRMED
// identity — so that merge site never executed.
//
// Root cause: App.jsx's scan-to-catalogue persistence merge (the `updated`
// object built inside the savedId setCatalogue updater) never included a
// title/issue/publisher key at all outside the applyProvisionalIdentity
// spread (Q135's own comment on this exact site said so explicitly) — for
// a confirmed identity those three fields only ever fell through the
// `...cur` spread, i.e. the record never advanced past whatever Vision
// guessed at grade-time. year had a narrow yearCorrected/polybagDetected-
// only special case; variant used `||`, not presence.
//
// Fix: mergeConfirmedIdentity (src/lib/dataQualityGuard.js) — same
// hasOwnProperty presence contract as applyProvisionalIdentity's issue
// fix (0213bee), applied wholesale to title/issue/year/publisher/variant
// at once (the audit found all five sharing the same defect at this one
// site), always active (no provisional gate), spread BEFORE
// applyProvisionalIdentity so a provisional response's own honest-null
// semantics still win on key collision when both apply.
//
// Invoke: node tests/q144c-confirmed-identity-merge.test.js

import { mergeConfirmedIdentity, applyProvisionalIdentity } from '../src/lib/dataQualityGuard.js';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (actual === expected) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`; failures.push(msg); console.log(msg); }
};

console.log('\n=== Q144C instance 7 — confirmed-identity client merge ===\n');

// ═══════════════════════════════════════════════════════════════════════
// Part 1 — the real Adventure Time case (weighted-consensus, confirmed)
// ═══════════════════════════════════════════════════════════════════════
console.log('Part 1: Adventure Time — confirmed identity, issue was stuck at stale value\n');

{
  // Vision misread at grade-time; enrich's family-scoped resolution (Q140)
  // correctly resolved title/issue, but identityProvisional is FALSE
  // (this is a confirmed, weighted-consensus identity, not a provisional
  // pool-override) — applyProvisionalIdentity would no-op here.
  const enrich = {
    identityProvisional: false,
    title: 'Adventure Time Summer Special',
    issue: '1',
    year: '2013',
    publisher: 'BOOM! Studios',
    variantNote: 'SDCC Convention Exclusive',
  };
  const staleCur = { title: 'Adventure Time', issue: '5', year: '2016', publisher: null, variant: null };

  // Confirm applyProvisionalIdentity is genuinely a no-op for this response.
  assertEq(Object.keys(applyProvisionalIdentity(enrich, staleCur)).length, 0,
    'applyProvisionalIdentity is a true no-op for this confirmed (non-provisional) response');

  const merged = mergeConfirmedIdentity(enrich, staleCur);
  assertEq(merged.title, 'Adventure Time Summer Special', `title corrects from stale "Adventure Time" (got "${merged.title}")`);
  assertEq(merged.issue, '1', `issue corrects from stale "5" (got "${merged.issue}")`);
  assertEq(merged.year, '2013', `year corrects from stale "2016" (got "${merged.year}")`);
  assertEq(merged.publisher, 'BOOM! Studios', `publisher fills in from null (got "${merged.publisher}")`);
  assertEq(merged.variant, 'SDCC Convention Exclusive', `variant fills in from null (got "${merged.variant}")`);
}

// ═══════════════════════════════════════════════════════════════════════
// Part 2 — presence-semantics fixtures per field (fresh corrects / explicit
//      null clears / omitted preserves), mirroring the issue-only suite
//      already proven for the provisional path
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 2: presence semantics per field\n');

{
  const prior = { title: 'Old Title', issue: '99', year: '1999', publisher: 'Old Pub', variant: 'Old Variant' };

  // Fresh value corrects.
  const fresh = mergeConfirmedIdentity(
    { title: 'New Title', issue: '1', year: '2013', publisher: 'New Pub', variantNote: 'New Variant' },
    prior
  );
  assertEq(fresh.title, 'New Title', 'title: fresh value corrects stale');
  assertEq(fresh.issue, '1', 'issue: fresh value corrects stale');
  assertEq(fresh.year, '2013', 'year: fresh value corrects stale');
  assertEq(fresh.publisher, 'New Pub', 'publisher: fresh value corrects stale');
  assertEq(fresh.variant, 'New Variant', 'variant: fresh value corrects stale');

  // Explicit null clears.
  const cleared = mergeConfirmedIdentity(
    { title: null, issue: null, year: null, publisher: null, variantNote: null },
    prior
  );
  assertEq(cleared.title, null, 'title: explicit null clears rather than keeping stale');
  assertEq(cleared.issue, null, 'issue: explicit null clears rather than keeping stale');
  assertEq(cleared.year, null, 'year: explicit null clears rather than keeping stale');
  assertEq(cleared.publisher, null, 'publisher: explicit null clears rather than keeping stale');
  assertEq(cleared.variant, null, 'variant: explicit null clears rather than keeping stale');

  // Omitted key preserves prior.
  const preserved = mergeConfirmedIdentity({}, prior);
  assertEq(preserved.title, 'Old Title', 'title: omitted key preserves prior');
  assertEq(preserved.issue, '99', 'issue: omitted key preserves prior');
  assertEq(preserved.year, '1999', 'year: omitted key preserves prior');
  assertEq(preserved.publisher, 'Old Pub', 'publisher: omitted key preserves prior');
  assertEq(preserved.variant, 'Old Variant', 'variant: omitted key preserves prior (keyed on variantNote, not variant)');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 3 — collision precedence: provisional wins over confirmed-merge
//      when both spreads apply to the same response (App.jsx spreads
//      mergeConfirmedIdentity BEFORE applyProvisionalIdentity)
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 3: spread order — provisional honest-null wins on collision\n');

{
  const enrich = {
    identityProvisional: true,
    title: 'Pop Kill',
    confirmedTitle: 'Pop Kill',
    issue: '3',
    year: null,   // provisional pool doesn't corroborate year — must stay null
    publisher: null,
    variantNote: null,
  };
  const cur = { title: 'Harley Quinn', issue: '75', year: '2020', publisher: 'DC Comics', variant: 'Kunkka beer variant' };

  // Mirrors App.jsx's exact spread order.
  const updated = {
    ...cur,
    ...mergeConfirmedIdentity(enrich, cur),
    ...applyProvisionalIdentity(enrich, cur),
  };
  assertEq(updated.title, 'Pop Kill', 'title: provisional result wins (both agree here)');
  assertEq(updated.issue, '3', 'issue: provisional result wins (both agree here)');
  assertEq(updated.year, null, 'year: provisional honest-null wins over mergeConfirmedIdentity (which would also see year:null present and also clear — both agree, confirms no fighting between the two)');
  assertEq(updated.publisher, null, 'publisher: provisional honest-null wins');
  assertEq(updated.variant, null, 'variant: provisional honest-null wins');
}

// ═══════════════════════════════════════════════════════════════════════
// Part 4 — Rachta Lin standing regression control (RESEARCH/LOCKED/$31.49)
//      stays intact: mergeConfirmedIdentity must not fire ahead of / instead
//      of applyProvisionalIdentity's honest-null behavior for a genuinely
//      provisional card.
// ═══════════════════════════════════════════════════════════════════════
console.log('\nPart 4: Rachta Lin standing control — provisional path unaffected\n');

{
  const rachtaLinEnrich = {
    identityProvisional: true,
    title: 'Pop Kill',
    confirmedTitle: 'Pop Kill',
    issue: '3',
    year: null,
    publisher: null,
    variantNote: null,
  };
  const staleCur = { title: 'Harley Quinn', issue: '75', year: '2020', publisher: 'DC Comics', variant: 'Kunkka beer variant' };
  const updated = { ...staleCur, ...mergeConfirmedIdentity(rachtaLinEnrich, staleCur), ...applyProvisionalIdentity(rachtaLinEnrich, staleCur) };
  assertEq(updated.title, 'Pop Kill', 'Rachta Lin: title still resolves correctly through the combined spread');
  assertEq(updated.year, null, 'Rachta Lin: year stays honestly null (not resurrected by mergeConfirmedIdentity)');
  assertEq(updated.publisher, null, 'Rachta Lin: publisher stays honestly null');
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
