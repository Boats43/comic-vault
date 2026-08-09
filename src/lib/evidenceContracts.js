// GrailKey Dispatch 33 (2026-08-08) — Architecture v1.0, Week 1.
// TYPES AND TABLES ONLY. Nothing in this codebase imports this file yet
// (verify via grep before adding a consumer) — it exists to give the
// next evidence source (barcode tiers, catalog lookups, future agents) a
// contract to build against, not to change anything this week.
//
// Every future evidence source must obey two standing invariants,
// recorded in full in docs/PATTERN-LIBRARY.md "GrailKey Dispatch 33":
//
// INVARIANT 1 — MONOTONIC EVIDENCE EXTENSION. A new evidence source may
// strengthen, contradict, or leave unchanged an existing determination.
// Failure or absence of the new source must not weaken, contaminate,
// constrain, or otherwise alter the established fallback path. The
// legacy path is the floor, by construction.
//
// INVARIANT 2 — NO SELF-CORROBORATION. Evidence derived directly or
// transitively from an authority mechanism cannot count as independent
// corroboration of that same mechanism. Independence is COMPUTED by a
// future Authority Resolver from evidence lineage — it is never a
// boolean a worker sets. This is why there is no `independent` field
// anywhere below: see the note at the bottom of this file.

/**
 * @typedef {Object} EvidenceEnvelope
 * @property {string} envelopeId
 * @property {string} correlationId
 * @property {string|null} [assetId]
 * @property {string} observationId
 * @property {string|null} [productId]
 * @property {string} field
 * @property {*} value
 * @property {string} sourceId
 * @property {string} sourceType
 * @property {string} evidenceType
 * @property {string} confidence
 * @property {string} authorityClass
 * @property {string[]} derivedFromEnvelopeIds
 * @property {string} sourceIndependenceGroup
 * @property {string} observedAt
 * @property {string} retrievedAt
 * @property {string|null} [expiresAt]
 * @property {string|null} [rawEvidenceRef]
 * @property {string|null} [contentHash]
 * @property {RetentionClassValue} retentionClass
 * @property {boolean} rawRetentionAllowed
 * @property {boolean} displayAllowed
 * @property {boolean} deriveAllowed
 * @property {boolean} trainingAllowed
 * @property {string} rightsPolicyVersion
 * @property {string} worker
 * @property {string|null} workerVersion
 * @property {string|null} [model]
 * @property {string|null} [modelVersion]
 * @property {string|null} [promptVersion]
 * @property {number} latencyMs
 * @property {number} costUsd
 */

/**
 * @typedef {'FIRST_PARTY_PERMANENT'|'LICENSED_PERMANENT'|'TRANSIENT_EXTERNAL'} RetentionClassValue
 */
export const RetentionClass = Object.freeze({
  FIRST_PARTY_PERMANENT: 'FIRST_PARTY_PERMANENT',
  LICENSED_PERMANENT: 'LICENSED_PERMANENT',
  TRANSIENT_EXTERNAL: 'TRANSIENT_EXTERNAL',
});

/**
 * One row per external source. Populated conservatively per the
 * dispatch's own instruction: `termsCheckedAt: null` on every row with a
 * TODO, and the RESTRICTIVE value wherever uncertain. Do not assert
 * rights this codebase has not confirmed — a wrong-but-permissive value
 * here is worse than an honest, restrictive placeholder.
 *
 * @typedef {Object} SourcePolicyRow
 * @property {string} sourceId
 * @property {boolean} queryAllowed
 * @property {boolean} fetchAllowed
 * @property {boolean} rawRetentionAllowed
 * @property {boolean} displayAllowed
 * @property {boolean} deriveAllowed
 * @property {boolean} trainingAllowed
 * @property {number|null} retentionDays
 * @property {boolean} attributionRequired
 * @property {string} policyVersion
 * @property {string|null} termsCheckedAt
 */

/** @type {Record<string, SourcePolicyRow>} */
export const SOURCE_POLICIES = Object.freeze({
  ebay: {
    sourceId: 'ebay',
    queryAllowed: true, // this codebase already queries eBay's Browse/Trading APIs in production
    fetchAllowed: true,
    rawRetentionAllowed: false, // TODO: verify against current eBay API License Agreement — restrictive default
    displayAllowed: true, // comp listings are already shown to users today (I13 log-card fidelity)
    deriveAllowed: true, // pricing/comps already derive from eBay data today
    trainingAllowed: false, // TODO: verify — restrictive default, no confirmed grant to use for model training
    retentionDays: 1, // matches api/kv-cache.js's KV_TTL.BROWSE / ACTIVE short TTLs already in production, not a new decision
    attributionRequired: false, // TODO: verify against current eBay API terms
    policyVersion: '0.1.0-unverified',
    termsCheckedAt: null, // TODO: verify against current eBay API License Agreement
  },
  pricecharting: {
    sourceId: 'pricecharting',
    queryAllowed: true, // this codebase already queries PriceCharting in production
    fetchAllowed: true,
    rawRetentionAllowed: false, // TODO: verify against current PriceCharting API terms — restrictive default
    displayAllowed: true, // PC-sourced prices/pop data already shown to users today
    deriveAllowed: true,
    trainingAllowed: false, // TODO: verify — restrictive default
    retentionDays: 1, // matches api/kv-cache.js's KV_TTL.PC (86400s) already in production
    attributionRequired: false, // TODO: verify against current PriceCharting terms
    policyVersion: '0.1.0-unverified',
    termsCheckedAt: null, // TODO: verify against current PriceCharting API terms
  },
  comicvine: {
    sourceId: 'comicvine',
    queryAllowed: true, // this codebase already queries ComicVine in production
    fetchAllowed: true,
    rawRetentionAllowed: false, // TODO: verify against current ComicVine API terms — restrictive default
    displayAllowed: true, // CV-sourced identity fields already shown to users today
    deriveAllowed: true,
    trainingAllowed: false, // TODO: verify — restrictive default
    retentionDays: 1, // matches api/kv-cache.js's KV_TTL.CV (86400s) already in production
    attributionRequired: false, // TODO: verify against current ComicVine API terms
    policyVersion: '0.1.0-unverified',
    termsCheckedAt: null, // TODO: verify against current ComicVine API terms
  },
  google: {
    // No Google integration exists anywhere in this codebase today —
    // fully unverified, fully restrictive placeholder row for a source
    // that isn't in use yet.
    sourceId: 'google',
    queryAllowed: false,
    fetchAllowed: false,
    rawRetentionAllowed: false,
    displayAllowed: false,
    deriveAllowed: false,
    trainingAllowed: false,
    retentionDays: null,
    attributionRequired: true, // restrictive default — assume required until confirmed otherwise
    policyVersion: '0.0.0-unverified',
    termsCheckedAt: null, // TODO: verify before any Google integration is built
  },
  gcd: {
    // The one row with real, cited terms — GrailKey Dispatch 17
    // (2026-08-07, PATTERN-LIBRARY.md): GCD App Guidelines obtained via
    // an external channel, explicit verbatim-vs-reported caveat still
    // outstanding (full verbatim page text not yet received). No live
    // query API exists (would require a DB-dump import + own query
    // layer). Images permitted only fetch-on-demand-and-archive, not
    // bulk retrieval. CC-BY-SA attribution is a hard UI requirement on
    // any GCD-sourced data.
    sourceId: 'gcd',
    queryAllowed: false, // no live query API exists — DB-dump import required first, not built
    fetchAllowed: false, // fetch-on-demand-and-archive only, not bulk — not built, do not flip until built deliberately
    rawRetentionAllowed: false, // bulk/cached retention not confirmed permitted — restrictive until reviewed (Dispatch 18)
    displayAllowed: false, // no GCD-sourced data is displayed anywhere today
    deriveAllowed: false,
    trainingAllowed: false,
    retentionDays: null,
    attributionRequired: true, // CC-BY-SA attribution — confirmed requirement, not a placeholder
    policyVersion: '0.2.0-partial', // reflects Dispatch 17's real (if incomplete) terms, not fully unverified
    termsCheckedAt: null, // TODO: full verbatim App Guidelines text still outstanding (Dispatch 18)
  },
});

/**
 * Barcode authority ladder — three distinct strengths, not one flag.
 * Decoding is deterministic; MAPPING is authoritative only when the
 * crosswalk is unambiguous. Enum only, no decode logic here.
 *
 * NOTE: this codebase's EXISTING barcode path (api/enrich.js,
 * lookupComicVineByUPC, identitySource==='barcode') is an all-or-nothing
 * lock today — UPC found in ComicVine skips identity resolution entirely
 * ("100% certain"); UPC not found is a hard 404. There is no "observed
 * but unmapped" state at all. Reconciling that existing lock with this
 * 3-tier ladder is future work, out of scope this week — do not wire
 * this enum into api/enrich.js's barcode branch without that dedicated
 * pass (see PATTERN-LIBRARY.md "GrailKey Dispatch 33").
 *
 * @typedef {'BARCODE_OBSERVED'|'BARCODE_MAPPED'|'BARCODE_EDITION_RESOLVED'} BarcodeAuthorityLadderValue
 */
export const BARCODE_AUTHORITY_LADDER = Object.freeze({
  BARCODE_OBSERVED: 'BARCODE_OBSERVED', // raw UPC decoded
  BARCODE_MAPPED: 'BARCODE_MAPPED', // UPC uniquely maps to a catalog product
  BARCODE_EDITION_RESOLVED: 'BARCODE_EDITION_RESOLVED', // base + supplement + publisher/era scheme uniquely resolves issue/cover/printing
});

// Deliberately no `independent: boolean` field anywhere in this file or
// in EvidenceEnvelope above. Invariant 2 requires a future Authority
// Resolver to COMPUTE independence from `derivedFromEnvelopeIds` and
// `sourceIndependenceGroup` — never a flag a worker sets on its own
// envelope. A stored boolean defeats the guard: a worker could (even
// unintentionally) assert its own independence, exactly the
// self-corroboration Invariant 2 exists to prevent. If a future change
// to this file adds such a field, that change violates Invariant 2 by
// construction — reject it, don't patch around it.
