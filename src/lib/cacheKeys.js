// src/lib/cacheKeys.js
//
// Track B Phase 0, Commit 4.3 (revision round 2, 2026-07-30) — cache-key
// builders and parser, relocated here from api/enrich.js specifically so
// they are import-safe: importing api/enrich.js directly as an ES module
// in a bare Node/test context does not cleanly exit (confirmed during
// implementation — an open handle from its own module-level setup keeps
// the process alive), which made it impossible for a test to import the
// REAL builder functions directly and get a genuine, non-mocked proof.
// This file has zero side effects at module-load time — pure functions
// only — so both the real api/enrich.js call sites AND this feature's
// test can import the SAME implementation (invariant 10) without either
// needing handler-scale mocking or a test-local mirror.
//
// buildActiveCompCacheKey predates Commit 4.3 (Track B Phase 0, Commit 3,
// Safeguard 2 amendment) — relocated here alongside the three Commit 4.3
// additions because parseCacheKeyIssueSegment needs to operate uniformly
// across all three cache-key shapes this codebase constructs, and keeping
// all four in one cohesive, leaf-level module is narrower than splitting
// the pre-existing one back into api/enrich.js while its three new
// siblings live here.

import { createHash } from 'node:crypto';
import { extractNumericFromGrade } from './gradeUtils.js';

// GrailKey Dispatch 36 (P0, Hero for Hire class) — standing invariant:
// "Cache identity is an authority boundary. A cache key must encode
// every input capable of changing the cached result, unless the cached
// object is intentionally input-independent raw evidence." (full text:
// docs/PATTERN-LIBRARY.md "GrailKey Dispatch 35/36"). The object
// buildActiveCompCacheKey's key protects (below) is NOT raw evidence —
// it's the fully filtered, priced pool — so this invariant applies in
// full.
//
// Seven confirmed material dependencies (full filter-chain audit,
// api/comps.js's applyFilterChain, GrailKey Dispatch 35): grade target,
// confirmedYear, confirmedVariant, isGraded, labelType, signedConsensus,
// assetType — labelType and signedConsensus are listed separately, not
// folded into one axis, because each independently changes filter
// behavior (Filter 2b) and each independently changes this fingerprint
// (confirmed by dedicated test cases, tests/cacheKeys-fingerprint.test.js).
// Two of these seven — numeric grade target and normalized year —
// are DERIVED values, not raw request fields; the derivation logic here
// is DELIBERATELY DUPLICATED (not imported) from api/comps.js's own
// inline normalization (fetchComps, ~line 984-989 for grade, ~line 1020
// for year) rather than refactoring comps.js to share it, per explicit
// instruction to scope this fix to the cache-key layer only. Drift risk
// is low (both are small, stable parsing utilities, not pricing
// formulas) but real — if either normalization in api/comps.js ever
// changes, this MUST change identically or the fingerprint silently
// stops matching what the filter chain actually consumes.
const deriveNumericGradeTargetForFingerprint = (grade, numericGrade) =>
  numericGrade != null && !isNaN(Number(numericGrade))
    ? Number(numericGrade)
    : grade != null
    ? extractNumericFromGrade(grade)
    : null;

const deriveNormalizedYearForFingerprint = (year) => (year ? String(year).trim() : null);

// Dispatch 42 Task 2 (Dispatch 41 Part 1(d) finding) — cvVolumeStartYear
// (api/enrich.js's `comicVine?.startYear`) is consumed by
// applyEraConsistencyFilter/evaluateEraYearMatch's volume-label rescue
// (Q128, Harley Quinn #62 class) on the exact same fetchComps call whose
// result this fingerprint gates — but was never one of the fingerprinted
// dimensions. Two requests differing only in whether ComicVine corroborated
// a comp's year could silently share one cached pool. Same normalization
// style as year, for the same reason (values may arrive as number or string).
const deriveNormalizedCvVolumeStartYearForFingerprint = (cvVolumeStartYear) =>
  cvVolumeStartYear ? String(cvVolumeStartYear).trim() : null;

/**
 * Canonical, deterministic fingerprint over every input that materially
 * shapes the active-comp filter chain's output, per the standing
 * invariant above. SHA-256 over a fixed-key-order JSON serialization —
 * not a convenience hash, per explicit instruction ("cache identity is
 * an authority boundary").
 *
 * Values are taken as the filter chain actually consumes them:
 * `numericTarget` and the normalized year string are RE-DERIVED here
 * identically to fetchComps's own inline logic (see note above);
 * `variant`/`isGraded`/`labelType`/`signedConsensus`/`assetType` are
 * used exactly as fetchComps receives them — no filter renormalizes
 * them further before consuming them, so the as-received value already
 * IS what the filter chain consumes.
 *
 * null/undefined are coerced to the literal JSON `null` — their OWN
 * canonical token — never toward `''` or `false`, so a genuinely-absent
 * value can never collide with a real empty string or a real boolean
 * false. `isGraded`/`signedConsensus` are tri-state in this codebase's
 * actual usage (`true`/`false`/`undefined` only — confirmed via full
 * filter-chain audit) and each of the three states gets its own
 * distinct token.
 *
 * GrailKey Directive AE (GK-107) — `publisher` ADDED. Confirmed real gap:
 * this fingerprint (and therefore the ac: cache key, which never encoded
 * publisher any other way) omitted the ONE identity axis that also
 * appears as outgoing eBay search-query text (`pubKeyword`, api/comps.js
 * Attempt 0's `title #issue variant year publisher` template) and as an
 * era/publisher-consistency filter input — a publisher-only manual
 * correction (GK-99) previously produced a byte-identical ac: key and
 * could return the fully-filtered, PRICED pool fetched under the OLD,
 * wrong publisher's query terms, sourced `active_ask_derived`/
 * `verified_active` (EXACT_CURRENT-tier) — a live route to a false READY
 * verdict through the correction path GK-99 just made reachable. Raw
 * value, not normalized (matches how `variant`/`labelType` are already
 * treated here — no new normalization logic).
 *
 * @param {{grade?: string|null, numericGrade?: number|string|null, year?: string|number|null, variant?: string|null, isGraded?: boolean|null, labelType?: string|null, signedConsensus?: boolean|null, assetType?: string|null, cvVolumeStartYear?: string|number|null, publisher?: string|null}} inputs
 * @returns {string} 64-character hex SHA-256 digest
 */
export const buildFilterContextFingerprint = ({
  grade = null,
  numericGrade = null,
  year = null,
  variant = null,
  isGraded = null,
  labelType = null,
  signedConsensus = null,
  assetType = null,
  cvVolumeStartYear = null,
  publisher = null,
} = {}) => {
  const numericTarget = deriveNumericGradeTargetForFingerprint(grade, numericGrade);
  const normalizedYear = deriveNormalizedYearForFingerprint(year);
  const normalizedCvVolumeStartYear = deriveNormalizedCvVolumeStartYearForFingerprint(cvVolumeStartYear);
  const canonical = JSON.stringify({
    numericTarget: numericTarget ?? null,
    year: normalizedYear ?? null,
    variant: variant ?? null,
    isGraded: isGraded === true ? 'true' : isGraded === false ? 'false' : 'null',
    labelType: labelType ?? null,
    signedConsensus: signedConsensus === true ? 'true' : signedConsensus === false ? 'false' : 'null',
    assetType: assetType ?? null,
    cvVolumeStartYear: normalizedCvVolumeStartYear ?? null,
    publisher: publisher ?? null,
  });
  return createHash('sha256').update(canonical).digest('hex');
};

// Track B Phase 0, Commit 3, Safeguard 2 amendment — the exact-issue
// active-comp cache key. Version-salted (a filter fix must not replay
// pools filtered by an old regex — Evil Ernie class) and NEVER built from
// a null confirmedIssue (a `title|null` key would be a title-only bucket
// any future request for the same title could collide on, regardless of
// which, or whether any, issue that later request resolves to — the
// historical failure class this exact template exists to prevent).
//
// GrailKey Dispatch 36 — `filterContextFingerprint` is REQUIRED and
// FAIL-CLOSED, not merely "no default value." A required-but-unvalidated
// parameter is not actually required in JavaScript: a 3-arg call still
// executes, `filterContextFingerprint` is simply `undefined`, and the
// template literal below silently coerces that to the literal substring
// "undefined" — no throw, no warning, a real (if visibly odd) key gets
// built and cached under. Confirmed live during this dispatch's own test
// authoring before this validation existed. A parameter being "required"
// only has teeth if a missing/malformed value throws — this is exactly
// that enforcement, not a restatement of the earlier comment.
const FILTER_CONTEXT_FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;
export const buildActiveCompCacheKey = (filterVersion, confirmedTitle, confirmedIssue, filterContextFingerprint) => {
  if (typeof filterContextFingerprint !== 'string' || !FILTER_CONTEXT_FINGERPRINT_PATTERN.test(filterContextFingerprint)) {
    throw new Error(
      `buildActiveCompCacheKey: filterContextFingerprint must be a 64-character lowercase hex SHA-256 digest, got ${JSON.stringify(filterContextFingerprint)}. ` +
      `Pass the return value of buildFilterContextFingerprint(...) — never omitted, never a hand-rolled string.`
    );
  }
  return `v${filterVersion}:${confirmedTitle}|${confirmedIssue}|${filterContextFingerprint}`;
};

// Track B Phase 0, Commit 4.3 (Matrix C / Precision Clause 3, 2026-07-30)
// — same buildActiveCompCacheKey precedent, so the real ComicVine cache-
// key call site (api/enrich.js) and this feature's regression fixture
// build the IDENTICAL key string, for a direct, spy-free "no issue-300
// activity" proof at the KEY-CONSTRUCTION level.
//
// GrailKey Dispatch 03 (2026-08-06) added a variant segment here,
// believing it closed a MegaCon-exclusive-vs-standard-cover collision.
//
// GrailKey Dispatch 36 (P1) — REMOVED. Direct source audit of
// lookupComicVine (api/enrich.js) proved this segment was dead the whole
// time: `buildComicVineQueryParams` never had a variant slot,
// `lookupComicVine` never received one, and `cleanTitleForComicVine`'s
// own docstring says its `variant` parameter is "unused, kept for
// signature compat." The segment fragmented cache hits (two requests
// differing only in `req.body.variant` could never share an entry) for
// zero correctness benefit — the mirror-image problem to an
// under-scoped key, not a fix. Removing it is safe under the standing
// invariant ("cache key must encode every input capable of changing the
// cached result") precisely because variant is NOT such an input here.
//
// GrailKey Dispatch 36 (P1) — `year` ADDED in its place, the real gap:
// `lookupComicVine`'s `comicYear` (`parseInt(String(year).trim(), 10)`)
// drives the hard `cv-year-strict` reject AND the `total` score that
// picks the winning volume — two requests sharing title|issue|publisher
// but resolving different years can legitimately get different
// ComicVine matches, and today share one cache entry regardless.
// Normalized identically to lookupComicVine's own `comicYear` derivation
// so the key matches exactly what the lookup consumes. A genuinely
// absent year serializes to the literal token 'null' — never coerced
// toward '' or a real year number, so "no year" can never collide with
// an actual parsed year (all real years are digit-only strings, `null`
// is not).
//
// GrailKey Dispatch 36 (correction round) — `poolYearHint` (a distinct,
// eBay-pool-derived modal-year estimate, separate from `year`/
// `confirmedYear`) is ALSO consulted by lookupComicVine's scoring
// (api/enrich.js:942-1000, `scoreWithDetails`) and CAN change which
// volume gets selected — but only when `!hasYearComparison`. The
// GATING must match `hasYearComparison`'s OWN definition exactly
// (api/enrich.js:963): `const hasYearComparison = Boolean(comicYear &&
// startYear);` — a Boolean/truthiness test on the LEFT operand
// (`comicYear`), not a `!= null` test. Those two are NOT equivalent: a
// malformed/unusable year ("Unknown", any non-numeric string) parses via
// `parseInt` to `NaN`, and `NaN != null` is true (NaN is not null or
// undefined) while `Boolean(NaN)` is false (NaN is falsy). An earlier
// version of this function gated on `comicYear == null`, which would
// treat a NaN comicYear as "year present" and wrongly suppress
// poolYearHint from the key — while the real lookupComicVine, via
// `Boolean(NaN && startYear)` short-circuiting to `NaN` then to `false`,
// treats it as "no year" and DOES consult poolYearHint. That is a
// confirmed false-HIT class: two requests with the same unusable year
// but different poolYearHint values would incorrectly share one cache
// entry despite the real lookup behaving differently for each. Fixed by
// gating on `Boolean(comicYear)` — the exact same truthiness check
// `hasYearComparison` itself applies to this variable (the right-hand
// `startYear` operand is per-ComicVine-candidate data returned by the
// API, not a caller-side input, and is correctly out of this key's scope
// exactly as it already was before this correction).
//
// Only `.year` is proven to matter here — direct read of
// `scoreWithDetails` (the ONLY place inside lookupComicVine that touches
// `poolYearHint`, api/enrich.js:980-985) shows it reads exclusively
// `poolYearHint.year` and `poolYearHint?.year`; `.agreement` and
// `.sampleSize` are never referenced there (they ARE read by other,
// unrelated functions elsewhere in this codebase —
// detectVariantPoolYearConflict, pcMatchConflictsWithPoolYear — but
// those don't run inside lookupComicVine and don't affect what gets
// cached under this key). No representation of `.agreement`/
// `.sampleSize` is needed in this key. Confirmed and regression-tested,
// tests/cacheKeys-comicvine-year.test.js.
//
// A coarse bucket was rejected for the value itself (no proof every
// value in a bucket produces identical lookup behavior) — this keys the
// EXACT normalized `.year` value instead, only when behaviorally active.
// When `year` IS present (truthy comicYear), `poolYearHint` is
// normalized to `null` regardless of its actual value, matching
// lookupComicVine's own behavior of never consulting it in that case —
// two requests differing only in `poolYearHint` while both carrying a
// real `year` correctly share one cache entry, since the lookup itself
// would behave identically for both. `poolYearHint` was confirmed
// already in-scope at the one real call site (api/enrich.js,
// immediately adjacent to this function's own call, used one line later
// for the live lookupComicVine call) — no bypass needed, the "cannot be
// made available without disproportionate change" escape hatch does not
// apply here.
//
// `cvFilterVersion` defaults to
// 1 (not imported from kv-cache.js here — this file is deliberately
// side-effect-free at module load, per the file-header rationale above;
// callers pass CV_FILTER_VERSION explicitly) so existing call sites that
// don't pass one still produce a valid, version-prefixed key rather than
// silently reverting to the old unversioned shape. `poolYearHint` is
// appended AFTER `cvFilterVersion` (not inserted before it) specifically
// so every pre-existing call site that doesn't pass it continues to work
// unchanged, defaulting to `null` — the same safe, conservative value
// this function would compute anyway whenever `year` is present.
export const buildComicVineCacheKey = (cleanedTitle, confirmedIssue, confirmedPublisher, year = null, cvFilterVersion = 1, poolYearHint = null) => {
  const comicYear = year ? parseInt(String(year).trim(), 10) : null;
  // Boolean(comicYear) — NOT `comicYear == null` — to match
  // hasYearComparison's own truthiness test exactly (see comment above;
  // this is what makes NaN-from-malformed-year behave identically here
  // and in the real lookup).
  const yearIsAuthoritative = Boolean(comicYear);
  const activePoolYearHint = (!yearIsAuthoritative && poolYearHint?.year != null) ? poolYearHint.year : null;
  return `cv:v${cvFilterVersion}:${cleanedTitle}|${confirmedIssue}|${confirmedPublisher}|${comicYear ?? 'null'}|${activePoolYearHint ?? 'null'}`;
};

// GrailKey Directive AE (GK-107) — `publisher` ADDED, positioned right
// after issue (matching buildComicVineCacheKey's title|issue|publisher|...
// convention above). Confirmed real gap: this key never encoded publisher
// at all, so a publisher-only manual correction (GK-99) produced a
// byte-identical key on BOTH the full-title and stripped-title (`pcKey`,
// api/enrich.js) variants, reusing a PC anchor fetched under the wrong
// publisher assumption. Traced not directly actionable toward READY on
// its own (PC-sourced isFromPC variant/key multipliers only apply to
// VARIANT_MULT_ELIGIBLE_SOURCES = {pricecharting, pc_estimate,
// browse_api}, none of which are EXACT_CURRENT_SOURCES) but still a real
// stale-authority-inheritance gap and a contributing input to
// resolveYear() (api/enrich.js, runs unconditionally regardless of
// identitySource) — fixed alongside the ac: key fix (both keys share the
// same root cause), not left half-closed.
export const buildPriceChartingCacheKey = (filterVersion, title, confirmedIssue, year, variant = null, publisher = null) =>
  `pc:v${filterVersion}:${title}|${confirmedIssue}|${publisher || ''}|${year || ''}|${variant || ''}`;

// Track B Phase 0, Commit 4.3 (Precision Clause 3) — the zero-#300
// assertions must not depend on capitalization or one literal, incomplete
// key spelling ("catch pc:v1:spawn|300|2020, pc:v1:Spawn|300|2024,
// ac:v9:Spawn|300 ... rather than checking only one exact spelling").
// This parses ANY of the three cache-key shapes this file constructs
// (ac:v<N>:, pc:v<N>:, cv:) back into their structured
// {title, issue, rest} segments, so a test can assert on the PARSED,
// case-normalized issue component directly, not a substring match
// against one hardcoded spelling.
export const parseCacheKeyIssueSegment = (cacheKey) => {
  const afterPrefix = String(cacheKey || '').replace(/^[a-z]+:(v\d+:)?/i, '');
  const parts = afterPrefix.split('|');
  return {
    title: parts[0] != null ? parts[0].trim().toLowerCase() : null,
    issue: parts[1] != null ? parts[1].trim().toLowerCase() : null,
    rest: parts.slice(2),
  };
};

// Track B Phase 0, Commit 4.3 (IMPLEMENTATION PACKET HOLD, Section 3) —
// pure query-parameter builders, extracted from the real api/enrich.js
// Promise.all call sites for lookupComicVine/lookupPriceCharting (Fix 3
// block). These do NOT touch the fetch layer or either lookup function's
// internals — they only name the "what object would this call site pass"
// step, exactly as buildComicVineCacheKey/buildPriceChartingCacheKey
// already do for the cache-key step. This is what makes a direct,
// non-network, non-mocked proof possible: a test can call these same
// exported functions with a resolved identity and assert on the returned
// object directly — the identical object api/enrich.js constructs at its
// real call site — without invoking either lookup function or its
// underlying network request.
export const buildComicVineQueryParams = (cleanedTitle, confirmedIssue, confirmedYear, confirmedPublisher, poolYearHint) => ({
  title: cleanedTitle,
  issue: confirmedIssue,
  year: confirmedYear,
  publisher: confirmedPublisher,
  poolYearHint,
});

export const buildPriceChartingQueryParams = (confirmedTitle, confirmedIssue, pcQueryYear, yearConfidence, eraHint, variant, pcDiag, pcProductId) => ({
  title: confirmedTitle,
  issue: confirmedIssue,
  year: pcQueryYear,
  yearConfidence,
  eraHint,
  variant: variant || null,
  pcDiag,
  pcProductId: pcProductId || null,
});

// Track B Phase 0, Commit 4.3 (IMPLEMENTATION PACKET HOLD — FINAL NARROW
// HOLD, item 3, 2026-07-30) — the real PriceCharting cache READ adapter,
// extracted verbatim from api/enrich.js's real Fix-3 Promise.all call site
// (the "try full title, fall back to stripped title" pattern) so the real
// call site and a test can invoke the IDENTICAL function — a genuine
// read-CUSTODY proof, not merely a key-construction proof. `kvGetFn` is
// injected (not imported here) so a test can pass a spy wrapper around the
// real kvGet (api/kv-cache.js) and observe every call this function makes,
// while the real api/enrich.js call site passes the real kvGet directly —
// same function, same behavior, different caller. Returns `{hit, result}`
// where `hit` is `'full'` | `'stripped'` | `null`, matching the two real
// log lines the call site emits ('[pc-query] cache hit for full title' /
// '...for stripped title (fallback)').
export const readPriceChartingCache = async (fullTitleKey, strippedTitleKey, kvGetFn) => {
  const cachedFull = await kvGetFn(fullTitleKey);
  if (cachedFull) return { hit: 'full', result: cachedFull };
  if (strippedTitleKey !== fullTitleKey) {
    const cachedStripped = await kvGetFn(strippedTitleKey);
    if (cachedStripped) return { hit: 'stripped', result: cachedStripped };
  }
  return { hit: null, result: null };
};
