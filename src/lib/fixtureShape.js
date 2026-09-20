// src/lib/fixtureShape.js
//
// PRODUCTION FIXTURE BANK dispatch (2026-09-20) — the single canonical
// implementation of fixture shape + sanitization. Isomorphic: no Node-only
// APIs (no `fs`, no `path`, no `process`), so it loads unmodified in the
// browser (App.jsx's "Bank Regression Fixture" action) and in the
// quarantined Node scripts (scripts/ingest-fixture-response.mjs,
// scripts/merge-fixture.mjs), which now import from here instead of
// carrying their own copies. There is no second sanitizer and no second
// fixture schema anywhere in this repo.
//
// A fixture is diagnostic evidence, never a physical asset — building one
// touches no gkAssetId, no collection_item, no valuation/decision/outcome
// event, no marketplace write. It is a frozen, sanitized snapshot of what
// a real /api/enrich (+ /api/grade) exchange actually returned, shaped so
// the regression harness can replay pricing deterministically without
// calling a live marketplace again.
//
// Production-shaped values are preserved verbatim — "$15.28" stays
// "$15.28", never silently coerced to 15.28. Every REQUIRED field below is
// present with its real value, or explicitly null with a `..Reason`
// sibling disclosing why — this file never silently omits a required key.

export const FIXTURE_SCHEMA_VERSION = 1;

// The four PRICE-LANE-1/2 known-answer books (Jimmy's Gate 1 corpus).
// Matching is case-insensitive and tolerant of "Amazing Spider-Man" vs
// "ASM"-style shorthand on the title, exact on the issue number.
const KNOWN_ANSWER_BOOKS = [
  { titleMatch: /amazing\s*spider-?\s*man|^asm$/i, issue: '91' },
  { titleMatch: /unexpected/i, issue: '122' },
  { titleMatch: /amazing\s*spider-?\s*man|^asm$/i, issue: '10' },
  { titleMatch: /new\s*mutants/i, issue: '98' },
];

export function isKnownAnswerFixture(title, issue) {
  const t = String(title || '');
  const i = String(issue ?? '');
  return KNOWN_ANSWER_BOOKS.some((b) => b.titleMatch.test(t) && b.issue === i);
}

// PRE_1970 / 1970_1989 / 1990_PLUS, per the dispatch's own stratification
// buckets. Null year -> null bucket, explicitly (never guessed).
export function classifyEraBucket(year) {
  const y = parseInt(year, 10);
  if (!Number.isFinite(y) || y <= 0) return null;
  if (y < 1970) return 'PRE_1970';
  if (y <= 1989) return '1970_1989';
  return '1990_PLUS';
}

// Fields that must never survive into a fixture: raw photo bytes (large,
// never needed to replay pricing) and anything auth/credential-shaped.
// "Copy Response"/the live app's own fetch responses never carry
// headers/cookies (those aren't part of a JSON body), so this list is
// about bulk (images) and defense-in-depth for any stray token-shaped key.
const STRIP_KEYS = new Set([
  'images', 'image', 'rawB64', 'b64', 'thumbnail', 'thumbnailB64',
  'authorization', 'cookie', 'apiKey', 'api_key', 'token', 'accessCode',
  'vaultKey',
]);

export function sanitizeForFixture(obj) {
  if (Array.isArray(obj)) return obj.map(sanitizeForFixture);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (STRIP_KEYS.has(k)) continue;
      out[k] = sanitizeForFixture(v);
    }
    return out;
  }
  return obj;
}

// A disclosed-null helper: every optional/conditionally-available field in
// the fixture goes through this so "field is null" and "why it's null"
// travel together, per the dispatch's "no silent omission" rule.
const disclose = (value, reasonIfNull) =>
  value != null ? { value, reason: null } : { value: null, reason: reasonIfNull };

/**
 * Build the canonical fixture object from a flat bag of fields. Both call
 * sites (browser — extracted from the live merged catalogue item; Node —
 * extracted from separately captured response.json/request.json/
 * grade-response.json) normalize into this SAME flat shape before calling
 * this function, so the actual fixture assembly logic exists exactly once.
 *
 * @param {object} fields - normalized source fields (see call sites for
 *   the exact extraction each source performs)
 * @param {object} meta - { capturedAt, buildSha, source, operatorNote }
 */
export function buildFixture(fields, meta = {}) {
  const {
    title = null, issue = null, publisher = null, year = null,
    grade = null, gradeConfidence = null, isGraded = null, numericGrade = null,
    defectPenalty = null, defectPenaltySource = null,
    cgcPenaltyFlags = null, cgcPenaltyFlagsSource = null,
    restoration = null,
    soldComps = null, soldCompDiagnostics = null,
    rawComps = null, priceLadder = null,
    activePoolSuspect = null, activePoolSuspectReason = null,
    activeCompDiagnostics = null,
    priceBands = null, priceDerivationTrace = null,
    pricingSource = null, gradeMultiplier = null,
    price = null, priceLow = null, priceHigh = null,
    decision = null, contract = null,
    traceId = null,
  } = fields;

  const eraBucket = classifyEraBucket(year);
  const knownAnswer = isKnownAnswerFixture(title, issue);

  const soldEvidence = disclose(
    Array.isArray(soldComps) ? soldComps : null,
    'no admitted sold comps on this response (zero-sold scan, or sold path did not run)'
  );
  const rawCompsEvidence = disclose(
    rawComps,
    'no active comp pool on this response (zero-active scan, or active path did not run)'
  );
  const ladderEvidence = disclose(
    priceLadder,
    'PriceCharting returned no per-grade ladder for this book (thin-market book, or PC lookup skipped — e.g. polybag pricing, issue=null)'
  );
  const activeDiagEvidence = disclose(
    activeCompDiagnostics,
    'api/comps.js does not currently expose an active-side rejection-reason breakdown on the /api/enrich response (pre-existing gap, confirmed during PRICE-LANE-2 T3 trace — not fixed by this dispatch)'
  );
  const conditionSourceEvidence = disclose(
    cgcPenaltyFlags,
    cgcPenaltyFlagsSource || 'condition evidence not captured for this scan (browser bank action always has it; a Node-CLI-reconstructed fixture only has it when grade-response.json was also supplied)'
  );

  // GK-237 (2026-09-20) — trichotomy, not disclose(): unlike every other
  // field above, activePoolSuspect's reason is meaningful in TWO of its
  // three states, not just when null. `true` carries the real "why it's
  // suspect" text (computePriceBands' own contamination-detection
  // message); `false` legitimately has no reason (the check ran and found
  // nothing); `null`/`undefined` means the check was never evaluated for
  // this book's pricing tier (only Tier 2 runs it) and gets its own
  // explicit unavailability reason. Previously this field used `?? false`,
  // which silently converted "never evaluated" into an affirmative "pool
  // is clean" on every non-Tier-2 book — exactly the false-negative this
  // fixes. `false` is intentionally excluded from the `== null` check
  // (`!= null` is false only for null/undefined, never for `false`).
  const activePoolSuspectValue = activePoolSuspect === true ? true : (activePoolSuspect === false ? false : null);
  const activePoolSuspectFinalReason = activePoolSuspectValue === null
    ? (activePoolSuspectReason || 'active-pool-suspect check was not evaluated for this book (computed only inside computePriceBands\' Tier 2 branch — Tier 1/2.5/3/4 pricing paths never run it)')
    : (activePoolSuspectValue === true ? (activePoolSuspectReason || null) : null);

  return {
    fixtureSchemaVersion: FIXTURE_SCHEMA_VERSION,
    source: meta.source || 'production-phone-scan',
    capturedAt: meta.capturedAt || new Date().toISOString(),
    buildSha: meta.buildSha ?? null,
    operatorNote: meta.operatorNote ?? null,
    traceId: traceId ?? null,

    identity: {
      title, issue,
      publisher: publisher ?? null,
      year: year ?? null,
      eraBucket,
      knownAnswerFixture: knownAnswer,
    },

    conditionEvidence: {
      grade: grade ?? null,
      gradeConfidence: gradeConfidence ?? null,
      isGraded: isGraded ?? null,
      numericGrade: numericGrade ?? null,
      defectPenalty: defectPenalty ?? null,
      defectPenaltySource: defectPenaltySource ?? (defectPenalty != null ? 'unspecified' : 'not present on this scan'),
      cgcPenaltyFlags: conditionSourceEvidence.value,
      cgcPenaltyFlagsSource: cgcPenaltyFlagsSource ?? conditionSourceEvidence.reason,
      restoration: restoration ?? null,
    },

    pricingEvidence: {
      soldComps: soldEvidence.value,
      soldCompsReason: soldEvidence.reason,
      soldCompDiagnostics: soldCompDiagnostics ?? null, // includes .reasons.ungradedTitle, .rejectedSamples, .verifiedCount, .rejectedCount, .rawCount
      rawComps: rawCompsEvidence.value, // {average, lowest, highest, count, prices} — active floor/avg/high
      rawCompsReason: rawCompsEvidence.reason,
      activeCompDiagnostics: activeDiagEvidence.value,
      activeCompDiagnosticsReason: activeDiagEvidence.reason,
      activePoolSuspect: activePoolSuspectValue,
      activePoolSuspectReason: activePoolSuspectFinalReason,
      priceLadder: ladderEvidence.value,
      priceLadderReason: ladderEvidence.reason,
    },

    pricingResult: {
      tier: priceBands?.tier ?? null,
      branch: priceBands?.source ?? null, // exact sub-tier, e.g. "tier2_sold_only"
      pricingSource: pricingSource ?? priceBands?.source ?? null,
      quick: priceBands?.quick ?? null,
      market: priceBands?.market ?? null,
      stretch: priceBands?.stretch ?? null,
      gradeMultiplier: gradeMultiplier ?? null,
      price: price ?? null,           // Production-shaped: keep whatever the response sent (string, e.g. "$32.00")
      priceLow: priceLow ?? null,
      priceHigh: priceHigh ?? null,
      priceDerivationTrace: priceDerivationTrace ?? null,
      decisionAction: decision?.action ?? null,
      decisionPrice: decision?.price ?? null,
      decisionWarnings: decision?.warnings ?? null,
      marketStanding: contract?.actionAuthority?.marketStanding ?? null,
      contractState: contract?.state ?? null,
    },
  };
}
