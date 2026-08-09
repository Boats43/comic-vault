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
 * @param {{grade?: string|null, numericGrade?: number|string|null, year?: string|number|null, variant?: string|null, isGraded?: boolean|null, labelType?: string|null, signedConsensus?: boolean|null, assetType?: string|null}} inputs
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
} = {}) => {
  const numericTarget = deriveNumericGradeTargetForFingerprint(grade, numericGrade);
  const normalizedYear = deriveNormalizedYearForFingerprint(year);
  const canonical = JSON.stringify({
    numericTarget: numericTarget ?? null,
    year: normalizedYear ?? null,
    variant: variant ?? null,
    isGraded: isGraded === true ? 'true' : isGraded === false ? 'false' : 'null',
    labelType: labelType ?? null,
    signedConsensus: signedConsensus === true ? 'true' : signedConsensus === false ? 'false' : 'null',
    assetType: assetType ?? null,
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
// GrailKey Dispatch 03 prerequisite (2026-08-06) — variant segment +
// version prefix added. Before this, two genuinely different variants of
// the same title|issue|publisher (a MegaCon exclusive vs. a standard
// cover, e.g.) collided on one cache entry.
//
// The variant this function receives is req.body.variant, NOT
// confirmedVariant — deliberately. Both real call sites (api/enrich.js,
// this CV key and the sibling PC key below) construct their cache keys
// BEFORE confirmedVariant is resolved in the handler (that resolution
// runs later, ~enrich.js:4847+); req.body.variant is the pre-resolution
// proxy already established for this exact reason at the PC query
// call site (Q108 CHANGE 2 comment, a few lines below this file's own
// PC builder). This means a cache key built here can diverge from the
// FINAL confirmedVariant a request ends up with (e.g. a Q140/Strip-1
// reroute admitting a variant token AFTER this key is built) — an
// accepted gap, not a bug: worst case is a cache miss (a fresh lookup
// keyed on the pre-resolution variant guess) rather than a collision
// (two different confirmed variants sharing one entry), which is the
// failure mode this change exists to close. Revisit only if a future
// case shows the reverse — a false HIT across two different confirmed
// variants because both happened to share the same req.body.variant.
//
// `cvFilterVersion` defaults to
// 1 (not imported from kv-cache.js here — this file is deliberately
// side-effect-free at module load, per the file-header rationale above;
// callers pass CV_FILTER_VERSION explicitly) so existing call sites that
// don't pass one still produce a valid, version-prefixed key rather than
// silently reverting to the old unversioned shape.
export const buildComicVineCacheKey = (cleanedTitle, confirmedIssue, confirmedPublisher, variant = null, cvFilterVersion = 1) =>
  `cv:v${cvFilterVersion}:${cleanedTitle}|${confirmedIssue}|${confirmedPublisher}|${variant || ''}`;

export const buildPriceChartingCacheKey = (filterVersion, title, confirmedIssue, year, variant = null) =>
  `pc:v${filterVersion}:${title}|${confirmedIssue}|${year || ''}|${variant || ''}`;

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
