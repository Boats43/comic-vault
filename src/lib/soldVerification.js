// Sold-comp verification — Ship #20a.6.
//
// Pure function. Filters PriceCharting sold rows (api/pricecharting-pop.js
// fetchPricechartingSales) before they enter the pricing math chain. Reuses
// the same hygiene primitives as active-comp filtering (src/lib/compHygiene.js)
// plus sold-specific filters: printing match, artist-variant match, grade-
// tab vs listing-title consistency, raw-vs-slab separation, stale recency
// bands, and price outlier detection.
//
// Design tenets (from Ship #20a.6 investigation report):
//   - Hard filters first, soft filters last (same order as Ship #13 active
//     filter chain). Issue/lot/format checks before grade/recency/outlier.
//   - Conservative direction: when in doubt, reject (sold rows feed
//     blendedAvg pricing math; bad data is worse than thin data).
//   - Diagnostics: every reject increments a reason counter. Top 3
//     rejected rows preserved with reason for post-deploy phone QA.
//
// Location note (per Ship #15 architectural learning): pure helper, no
// HTTP handler — lives in src/lib/, NOT api/. api/enrich.js imports via
// `../src/lib/soldVerification.js`. No Vercel function added.

import {
  REPRINT_RE,
  SLAB_RE,
  VARIANT_CONTAM_RE,
  SIGNED_RE,
  LOT_RE,
  HALF_ISSUE_RE,
  isValidIssueRange,
  hasIssueNumber,
  detectSeriesMarkers,
  hasSufficientTitleOverlap,
  tokenizeTitle,
  parseListingGrade,
  applyPriceSanity,
  extractArtist,
} from "./compHygiene.js";

// Stale recency thresholds (per user Q3 answer, Ship #20a.6):
//   Modern (bookYear >= 1985): reject rows older than 540 days.
//   Vintage (< 1985): keep all (sold pools naturally thin), tag with
//   recencyBand='stale' for future Ship #20b weighting.
const MODERN_STALE_DAYS = 540;
const MODERN_ERA_CUTOFF_YEAR = 1985;

// Cap raw rows preserved in out.soldCompsRaw (per Q5 answer). Diagnostics
// counts use the FULL raw set before capping so the V/R chip is honest.
const RAW_CAP = 20;

// Format-asymmetry markers we treat as one-sided rejects in sold pools.
// When sold row carries one of these AND our title doesn't, reject.
// Same pattern as Ship #13 Bug 2 sequel-asymmetry filter for active comps.
const FORMAT_MARKER_PREFIXES = [
  'roman-', 'vol-', 're-', 'pre-', 'part-', 'book-',
  'annual-', 'special-', 'king-size-', 'giant-size-',
];

// ─────────────────────────── small helpers ────────────────────────────

const lc = (s) => String(s || '').toLowerCase();

const matchesNthPrint = (s) =>
  /\b(?:2nd|3rd|4th|5th|6th|7th|8th|9th|second|third|fourth|fifth)\s*p(?:rint|tg)\b/i
    .test(String(s || ''));

const matchesFirstPrint = (s) =>
  /\b(?:1st|first)\s*(?:p(?:rint|tg))\b/i.test(String(s || ''));

const matchesAnyPrintMarker = (s) =>
  matchesNthPrint(s) || matchesFirstPrint(s);

// Our book is signed if variant carries a signed indicator.
const isOurBookSigned = (variant) =>
  /\b(?:signed|signature|autograph(?:ed)?|\bauto\b|remarked?|yellow\s*label|green\s*label)\b/i
    .test(String(variant || ''));

// Our book is a lot if variant carries lot|set|bundle.
const isOurBookALot = (variant) =>
  /\b(?:lot|set|bundle)\b/i.test(String(variant || ''));

// Compute recency band tag. Always returned alongside the row.
const recencyBandFor = (daysAgo) => {
  if (daysAgo == null) return 'unknown';
  if (daysAgo <= 90) return 'fresh';
  if (daysAgo <= 540) return 'aging';
  return 'stale';
};

// ─────────────────────────── filter helpers ───────────────────────────

// Hard reject when row title contains a format marker (annual / special /
// king-size / giant-size / sequel / volume) that our title does not.
// One-sided: "row has marker we lack → reject". Symmetric to Ship #13
// active-comp Bug 2 sequel filter.
//
// Wildcard handling: the `?` suffix (e.g. `annual-?`) means "format
// detected but no specific number". When EITHER side carries `prefix-?`
// AND the OTHER side carries any `prefix-N` (or also `prefix-?`), they
// are treated as compatible — we don't have enough info to assert
// mismatch. Hard mismatch only when both sides have specific numbers
// AND the numbers differ.
const hasFormatAsymmetry = (rowTitle, ourMarkers) => {
  const theirs = detectSeriesMarkers(rowTitle);
  // Build a Set of prefixes we have (any form: prefix-N or prefix-?).
  const ourPrefixSet = new Set();
  for (const m of ourMarkers) {
    const prefix = FORMAT_MARKER_PREFIXES.find((p) => m.startsWith(p));
    if (prefix) ourPrefixSet.add(prefix);
  }
  for (const m of theirs) {
    // Only treat as asymmetric if prefix is in our format list.
    const prefix = FORMAT_MARKER_PREFIXES.find((p) => m.startsWith(p));
    if (!prefix) continue;
    // If we share the prefix at all, consider compatible — wildcard
    // handling: prefix-? on either side accepts any prefix-N.
    if (ourPrefixSet.has(prefix)) continue;
    // We don't have this prefix → row has format marker we lack → reject.
    return { mismatch: true, marker: m };
  }
  return { mismatch: false };
};

// Bidirectional printing match. Returns 'match' | 'mismatch' | 'unknown'.
// Our N-th print → row MUST also have N-th print marker.
// Our blank/1st print → row MUST NOT have N-th print marker.
const printingMatch = (rowTitle, ourVariant) => {
  const t = String(rowTitle || '');
  const ourIsNthPrint = matchesNthPrint(ourVariant);
  const rowIsNthPrint = matchesNthPrint(t);
  const rowIsReprint = REPRINT_RE.test(t);
  if (ourIsNthPrint) {
    // Tightened: when ours is e.g. "2nd print", row's marker should also
    // be 2nd print. Approximate via exact substring match on the print
    // word. If row has a different Nth marker (3rd/4th/etc), reject.
    const ourPrintMatch = String(ourVariant || '').match(/\b(\d+)(?:st|nd|rd|th)\s*p(?:rint|tg)\b/i);
    const rowPrintMatch = t.match(/\b(\d+)(?:st|nd|rd|th)\s*p(?:rint|tg)\b/i);
    if (ourPrintMatch && rowPrintMatch) {
      return ourPrintMatch[1] === rowPrintMatch[1] ? 'match' : 'mismatch';
    }
    // Row has no Nth-print marker → mismatch (our 2nd print can't be a row
    // with no print designation).
    return rowIsNthPrint ? 'match' : 'mismatch';
  }
  // Ours is blank or 1st-print: REPRINT_RE catches Nth-print + facsimile +
  // anniversary edition + Marvel Milestones + reproduction etc.
  if (rowIsReprint) return 'mismatch';
  return rowIsNthPrint ? 'mismatch' : (matchesAnyPrintMarker(t) ? 'unknown' : 'unknown');
};

// Variant-artist mismatch. When our variant names a known artist (per
// ARTIST_PATTERNS), reject sold rows whose title names a DIFFERENT known
// artist. Keep rows that name no artist at all (we can't prove mismatch).
const variantArtistMismatch = (rowTitle, ourArtist) => {
  if (!ourArtist) return false;
  const rowArtist = extractArtist(rowTitle);
  if (!rowArtist) return false;
  return rowArtist !== ourArtist;
};

// Slab/raw mismatch.
//   Our user grade is 'raw' → reject SLAB_RE rows (CGC/CBCS/PGX listings).
//   Our user grade is numeric (CGC) → keep SLAB_RE rows (they're our peers).
//     Optionally tighten: when our grade is CGC and row title parses to a
//     raw letter grade with no slab indicator, we still keep — PC tab
//     pre-binned by grade so the row IS the right grade-class.
const slabMismatch = (rowTitle, userGradeKey) => {
  if (userGradeKey === 'raw') {
    return SLAB_RE.test(String(rowTitle || ''));
  }
  return false;
};

// Grade tab vs listing-title consistency. Both must be present and within
// 0.3 grade points of each other (tighter than active-comp filter's ±1.5
// because the PC tab is already a hard bucket — any drift indicates a
// seller-typo or wrong-bin row). 0.3 catches adjacent-half-grade
// mismatches like 9.4 vs 9.8 (diff 0.4 > 0.3 → reject). When listing
// title has no parseable grade, we trust the PC tab grade.
const gradeTabMismatch = (rowTitle, rowGradeTab) => {
  if (!rowGradeTab || rowGradeTab === 'raw') return false;
  const tabNum = parseFloat(rowGradeTab);
  if (isNaN(tabNum)) return false;
  const titleGrade = parseListingGrade(rowTitle);
  if (titleGrade == null) return false;
  return Math.abs(titleGrade - tabNum) > 0.3;
};

// Stale recency for modern books. Vintage rows are tagged but not rejected.
const isStaleForBookYear = (daysAgo, bookYear) => {
  if (daysAgo == null) return false;
  const y = parseInt(bookYear);
  if (isNaN(y)) return false;
  if (y < MODERN_ERA_CUTOFF_YEAR) return false;
  return daysAgo > MODERN_STALE_DAYS;
};

// ───────────────────────────── main entry ─────────────────────────────

/**
 * Verify sold-comp rows. Pure function.
 *
 * @param {Array} rawRows - Sold rows from fetchPricechartingSales (each
 *                          has price, date, daysAgo, grade, title, url,
 *                          marketplace, source).
 * @param {Object} ctx
 * @param {string} ctx.title         — our book's title
 * @param {string|number} ctx.issue  — our book's issue number
 * @param {string} [ctx.variant]     — our book's variant string
 * @param {string} [ctx.publisher]   — our book's publisher (informational)
 * @param {number|string} [ctx.bookYear] — our book's year (drives staleness)
 * @param {string} [ctx.userGradeKey] — "9.4" / "raw" / null (PC tab key)
 * @returns {{ verified: Array, diagnostics: Object }}
 */
export const verifySoldComps = (rawRows, ctx) => {
  const reasons = {
    titleMismatch: 0,
    issueMismatch: 0,
    annualMismatch: 0,
    printingMismatch: 0,
    variantMismatch: 0,
    slabMismatch: 0,
    signed: 0,
    lot: 0,
    gradeMismatch: 0,
    stale: 0,
    outlier: 0,
  };
  const rejectedSamples = [];
  const pushSample = (row, reason) => {
    if (rejectedSamples.length < 3) {
      rejectedSamples.push({
        title: row.title || null,
        price: row.price ?? null,
        reason,
      });
    }
  };

  const rows = Array.isArray(rawRows) ? rawRows : [];
  const rawCount = rows.length;

  if (rawCount === 0) {
    return {
      verified: [],
      diagnostics: {
        rawCount: 0,
        verifiedCount: 0,
        rejectedCount: 0,
        reasons,
        rejectedSamples,
      },
    };
  }

  const {
    title = '',
    issue = null,
    variant = null,
    bookYear = null,
    userGradeKey = null,
  } = ctx || {};

  const ourTokens = tokenizeTitle(title);
  const ourMarkers = detectSeriesMarkers(title);
  const ourArtist = extractArtist(variant);
  const ourIsLot = isOurBookALot(variant);
  const ourIsSigned = isOurBookSigned(variant);

  // Filter pass — hard rejects first, soft last. Each row is annotated
  // with `recencyBand` regardless of acceptance so the UI / Ship #20b
  // weighting layer can see freshness without recomputing.
  let working = rows.map((r) => ({
    ...r,
    recencyBand: recencyBandFor(r?.daysAgo),
  }));

  // 1. Issue number — must contain `#issue`. Also catches lot listings
  //    (commas, "lot" word, multi-issue compound).
  if (issue) {
    working = working.filter((r) => {
      if (hasIssueNumber(r.title, issue)) return true;
      reasons.issueMismatch++;
      pushSample(r, 'issueMismatch');
      return false;
    });
  }

  // 2. Lot / set / bundle / valid issue range. Skip when our book is itself
  //    a lot.
  if (!ourIsLot) {
    working = working.filter((r) => {
      const t = String(r.title || '');
      if (LOT_RE.test(t) || isValidIssueRange(t)) {
        reasons.lot++;
        pushSample(r, 'lot');
        return false;
      }
      return true;
    });
  }

  // 3. Half-issue / ashcan / promo. Skip when our book itself is one.
  const ourIsHalf =
    String(issue || '').includes('/') ||
    String(issue || '').includes('.') ||
    String(issue || '').includes('½');
  if (!ourIsHalf) {
    working = working.filter((r) => {
      if (HALF_ISSUE_RE.test(String(r.title || ''))) {
        reasons.lot++; // half-issue counts under lot bucket (rare; collapsed)
        pushSample(r, 'lot:half-issue');
        return false;
      }
      return true;
    });
  }

  // 4. Format asymmetry — annual/special/king-size/giant-size/sequel/vol/
  //    Re-/Pre-/Part/Book mismatch.
  working = working.filter((r) => {
    const { mismatch, marker } = hasFormatAsymmetry(r.title, ourMarkers);
    if (mismatch) {
      reasons.annualMismatch++;
      pushSample(r, `annualMismatch:${marker}`);
      return false;
    }
    return true;
  });

  // 5. Title-token overlap (≥50%). Reuses existing helper.
  working = working.filter((r) => {
    if (hasSufficientTitleOverlap(r.title, ourTokens)) return true;
    reasons.titleMismatch++;
    pushSample(r, 'titleMismatch');
    return false;
  });

  // 6. Printing match. Bidirectional.
  working = working.filter((r) => {
    const m = printingMatch(r.title, variant);
    if (m === 'mismatch') {
      reasons.printingMismatch++;
      pushSample(r, 'printingMismatch');
      return false;
    }
    return true;
  });

  // 7. Variant-artist mismatch (when our variant names a known artist).
  working = working.filter((r) => {
    if (variantArtistMismatch(r.title, ourArtist)) {
      reasons.variantMismatch++;
      pushSample(r, 'variantMismatch:artist');
      return false;
    }
    return true;
  });

  // 8. Variant-contamination broad: our book is NOT a variant but row
  //    title flags a variant marker (virgin/foil/ratio/incentive/etc.).
  if (!variant) {
    working = working.filter((r) => {
      if (VARIANT_CONTAM_RE.test(String(r.title || ''))) {
        reasons.variantMismatch++;
        pushSample(r, 'variantMismatch:contam');
        return false;
      }
      return true;
    });
  }

  // 9. Slab / raw. Reject CGC slabs from raw pools.
  working = working.filter((r) => {
    if (slabMismatch(r.title, userGradeKey)) {
      reasons.slabMismatch++;
      pushSample(r, 'slabMismatch');
      return false;
    }
    return true;
  });

  // 10. Signed / autographed. Skip when our book is itself signed.
  if (!ourIsSigned) {
    working = working.filter((r) => {
      if (SIGNED_RE.test(String(r.title || ''))) {
        reasons.signed++;
        pushSample(r, 'signed');
        return false;
      }
      return true;
    });
  }

  // 11. Grade tab vs listing-title consistency.
  working = working.filter((r) => {
    if (gradeTabMismatch(r.title, r.grade)) {
      reasons.gradeMismatch++;
      pushSample(r, 'gradeMismatch');
      return false;
    }
    return true;
  });

  // 12. Stale recency for modern books. Vintage rows tagged via
  //     recencyBand but kept (sold pool naturally thin).
  working = working.filter((r) => {
    if (isStaleForBookYear(r.daysAgo, bookYear)) {
      reasons.stale++;
      pushSample(r, 'stale');
      return false;
    }
    return true;
  });

  // 13. Price outlier (>3× / <0.25× median). Reuses applyPriceSanity.
  //     Requires ≥3 rows; below that, no-op.
  const beforeOutlier = working.length;
  working = applyPriceSanity(working);
  const outlierRemoved = beforeOutlier - working.length;
  if (outlierRemoved > 0) {
    reasons.outlier += outlierRemoved;
    // Outlier rejections don't carry a row reference — push synthetic.
    pushSample({ title: null, price: null }, `outlier×${outlierRemoved}`);
  }

  return {
    verified: working,
    diagnostics: {
      rawCount,
      verifiedCount: working.length,
      rejectedCount: rawCount - working.length,
      reasons,
      rejectedSamples,
    },
  };
};

// Convenience: cap the raw rows surfaced on the response payload.
export const capRawSoldRows = (rows, cap = RAW_CAP) =>
  Array.isArray(rows) ? rows.slice(0, cap) : [];

export const SOLD_VERIFICATION_RAW_CAP = RAW_CAP;
