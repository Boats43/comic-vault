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

// Track B Phase 0, Commit 3, Safeguard 2 amendment — the exact-issue
// active-comp cache key. Version-salted (a filter fix must not replay
// pools filtered by an old regex — Evil Ernie class) and NEVER built from
// a null confirmedIssue (a `title|null` key would be a title-only bucket
// any future request for the same title could collide on, regardless of
// which, or whether any, issue that later request resolves to — the
// historical failure class this exact template exists to prevent).
export const buildActiveCompCacheKey = (filterVersion, confirmedTitle, confirmedIssue) =>
  `v${filterVersion}:${confirmedTitle}|${confirmedIssue}`;

// Track B Phase 0, Commit 4.3 (Matrix C / Precision Clause 3, 2026-07-30)
// — same buildActiveCompCacheKey precedent, so the real ComicVine cache-
// key call site (api/enrich.js) and this feature's regression fixture
// build the IDENTICAL key string, for a direct, spy-free "no issue-300
// activity" proof at the KEY-CONSTRUCTION level.
export const buildComicVineCacheKey = (cleanedTitle, confirmedIssue, confirmedPublisher) =>
  `cv:${cleanedTitle}|${confirmedIssue}|${confirmedPublisher}`;

export const buildPriceChartingCacheKey = (filterVersion, title, confirmedIssue, year) =>
  `pc:v${filterVersion}:${title}|${confirmedIssue}|${year || ''}`;

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
