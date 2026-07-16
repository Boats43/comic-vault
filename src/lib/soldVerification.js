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
  MERCH_RE,
  HALF_ISSUE_RE,
  TRADING_CARD_RE,
  TPB_MARKER_RE,
  COVERLESS_RE,
  isValidIssueRange,
  hasIssueNumber,
  hasCrossSeriesSeparator,
  detectSeriesMarkers,
  hasSufficientTitleOverlap,
  tokenizeTitle,
  parseListingGrade,
  getQualitativeGradeCeiling,
  applyPriceSanity,
  extractArtist,
} from "./compHygiene.js";
import { PREMIUM_CREATORS } from "./premiumCreators.js";

// Stale recency thresholds (tiered by era):
//   Modern (bookYear >= 2000): reject rows older than 90 days.
//   Copper (1985-1999): reject rows older than 180 days.
//   Vintage (< 1985): keep all (sold pools naturally thin), tag with
//   recencyBand='stale' for future Ship #20b weighting.
const MODERN_STALE_DAYS = 90;   // 2000+ books
const COPPER_STALE_DAYS = 180;  // 1985-1999
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

// Q109 (greenlit) — bare-surname corroboration check. A surname counts as
// fully trusted (not just "partial") when premiumCreators.js has ALREADY
// registered it as an unambiguous alias for the matching creator (e.g.
// Momoko, Parrillo) — same registry, same ambiguity judgment the rest of
// the codebase already relies on. Does NOT resolve new ambiguity calls
// (e.g. "is bare 'young' safe") — those stay unregistered and fall through
// to the 'partial' outcome below, exactly as scoped.
const isUnambiguousSurnameAlias = (ourArtist, surname) => {
  const entry = PREMIUM_CREATORS.find((c) =>
    c.canonical.toLowerCase() === ourArtist ||
    c.aliases.some((a) => a.toLowerCase() === ourArtist)
  );
  if (!entry) return false;
  return entry.aliases.some((a) => a.toLowerCase() === surname);
};

// Q109 (greenlit) — three-outcome variant-artist classification, replacing
// the binary variantArtistMismatch. The old version's `if (!rowArtist)
// return false` silently trusted ANY comp whose artist wasn't in the
// curated ARTIST_PATTERNS registry, even when OUR artist was confidently
// known — e.g. a Chad Hardin/Hardin sold comp priced a Skottie Young book
// at full trust, no fallback tag, no Tier cap, no divergence check (Edge
// of Spider-Verse #1 casualty). This closes that gap without resolving any
// new registry-ambiguity questions:
//
//   'match'     — full curated ARTIST_PATTERNS match (unchanged), or a
//                 bare-surname match ALREADY registered unambiguous in
//                 premiumCreators.js. Full trust, unchanged from today.
//   'partial'   — bare surname (or the artist's own name text) present in
//                 the comp title, but not a curated/registered match
//                 either way (e.g. "Young" alone — Skottie Young's
//                 registry entry has no bare-surname alias, ambiguous or
//                 not is undetermined). Kept, but demoted — caller sets
//                 variantVerified:false, routing into the same low-trust
//                 tier the fallback path already produces (Tier-2 cap,
//                 divergence cap, Class B self-consistency all already
//                 apply there).
//   'mismatch'  — comp names a DIFFERENT known artist. Reject (unchanged).
//   'no-signal' — our artist is known and the comp corroborates NOTHING,
//                 not even a bare surname. Reject (NEW).
const classifyArtistMatch = (rowTitle, ourArtist) => {
  if (!ourArtist) return 'match'; // nothing to check against — unchanged behavior
  const rowArtist = extractArtist(rowTitle);
  if (rowArtist) {
    return rowArtist === ourArtist ? 'match' : 'mismatch';
  }
  // Row's artist unrecognized by the curated registry — fall back to raw
  // substring corroboration on our artist's surname (last word; the
  // literal full-name case is already covered by extractArtist above,
  // since every multi-word ARTIST_PATTERNS entry is itself a literal
  // substring match).
  const words = ourArtist.split(/\s+/);
  const surname = words[words.length - 1];
  const escaped = surname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const surnameRe = new RegExp(`\\b${escaped}\\b`, 'i');
  if (surnameRe.test(String(rowTitle || ''))) {
    return isUnambiguousSurnameAlias(ourArtist, surname) ? 'match' : 'partial';
  }
  return 'no-signal';
};

// Extract variant tokens from string. Returns array of normalized tokens.
// Used to detect variant type mismatches (foil vs ratio, newsstand vs
// exclusive, etc.). Covers the main variant types that should NOT mix.
const extractVariantTokens = (str) => {
  const tokens = [];
  const s = String(str).toLowerCase();
  if (/foil/.test(s)) tokens.push('foil');
  if (/virgin/.test(s)) tokens.push('virgin');
  if (/newsstand/.test(s)) tokens.push('newsstand');
  if (/exclusive|excl\./.test(s)) tokens.push('exclusive');
  if (/1:\d+|ratio|incentive/.test(s)) tokens.push('ratio');
  if (/sketch/.test(s)) tokens.push('sketch');

  // Q48: "Cover B/C/D" detection — must NOT match artist-name + "cover" descriptors.
  // Q48-FIX: Remove adjective blocklist. Trailing \b alone fixes "Cover Key"
  // class (word boundary prevents "cover k" match). Blocklist suppresses
  // genuine "Rare Cover B" variants.
  //
  // Pattern: /\bcover\s*[b-z]\b/ requires letter IMMEDIATELY after "cover"
  // (optional whitespace only). Prevents matches on:
  // - "todd mcfarlane cover" (no b-z after "cover")
  // - "iconic cover" (no b-z after "cover")
  // - "cover key" (k not in [b-z])
  //
  // Keeps matches on:
  // - "cover b" / "cover-b" → variant ✓
  // - "rare cover b" → variant ✓ (b-z present)
  if (/\bcover\s*[b-z]\b/.test(s)) {
    tokens.push('altcover');
  }
  // Ship 18 — Add reprint-class tokens. Without these, first-print sold
  // comps leaked into reprint pricing pools (B&B #28 Loot Crate, Detective
  // #27 facsimile, etc.). Active comps had VARIANT_CONTAM_RE protection
  // but sold comps did not.
  if (/\breprint(?!\s+series)\b/.test(s)) tokens.push('reprint');
  if (/facsimile/.test(s)) tokens.push('reprint'); // facsimile = reprint family
  if (/loot.?crate/.test(s)) tokens.push('reprint');
  if (/\b(?:2nd|3rd|second|third)\s*print(?:ing)?\b/.test(s)) tokens.push('reprint');
  if (/millennium\s+edition/.test(s)) tokens.push('reprint');
  if (/famous\s+first\s+edition/.test(s)) tokens.push('reprint');
  return tokens;
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

// Stale recency for modern/copper books. Vintage rows are tagged but not rejected.
const isStaleForBookYear = (daysAgo, bookYear) => {
  if (daysAgo == null) return false;
  const y = parseInt(bookYear);
  if (isNaN(y)) return false;
  if (y < MODERN_ERA_CUTOFF_YEAR) return false;
  const cutoff = y >= 2000 ? MODERN_STALE_DAYS : COPPER_STALE_DAYS;
  return daysAgo > cutoff;
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
 * @param {string} [ctx.assessedGrade] — Vision/AI grade string ("FN 6.0") for raw scans
 * @param {Object} [ctx.priceLadder] — PC per-grade price ladder ({"4.0": 279.70, ...}).
 *        Raw scans only: cross-checks sold-comp price against PC's own grade
 *        value, independent of title text. See Q109-LADDER below.
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
    format: 0,
    yearMismatch: 0,
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

  // Q52: Thor #235 investigation — log entry conditions
  if (ctx.title && ctx.issue) {
    const bookKey = `${ctx.title} #${ctx.issue}`;
    if (rawCount === 0) {
      console.log(`[Q52-investigate] ${bookKey}: zero sold rows from PriceCharting`);
    } else {
      console.log(`[Q52-investigate] ${bookKey}: ${rawCount} raw sold rows entering filter chain`);
    }
  }

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
    assessedGrade = null,
    priceLadder = null,
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
    // EX-A (Q109 greenlight): rows surviving the normal chain (incl. filters
    // 7-8 variant-artist/variant-token below) are genuinely variant-verified.
    // Fallback-admitted rows below are stamped false — see per-row marker there.
    variantVerified: true,
  }));

  // 1. Issue number — must contain `#issue`. Also catches lot listings
  //    (commas, "lot" word, multi-issue compound).
  // P0-A DIAGNOSTIC: log all rejections to find actual filter.
  // Q37: Pass series title for adjacency-aware dual-number parsing
  if (issue) {
    working = working.filter((r) => {
      if (hasIssueNumber(r.title, issue, title)) return true;
      console.log('[sold-reject] issueMismatch |', r.title?.slice(0, 80), '| issue:', issue);
      reasons.issueMismatch++;
      pushSample(r, 'issueMismatch');
      return false;
    });
  }

  // 2. Lot / set / bundle / valid issue range / cross-series separator.
  //    Skip when our book is itself a lot. Ship #20a.6.20 — added
  //    hasCrossSeriesSeparator (parity with active Filter 1e).
  if (!ourIsLot) {
    working = working.filter((r) => {
      const t = String(r.title || '');
      if (LOT_RE.test(t) || isValidIssueRange(t) || hasCrossSeriesSeparator(t)) {
        reasons.lot++;
        pushSample(r, hasCrossSeriesSeparator(t) ? 'cross-series' : 'lot');
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

  // 3b. Trading card / non-comic format. Ship #20a.6.13 — Avengers #20 case
  //     where PriceCharting returned a trading card product instead of the
  //     comic product. PC sales-history table scraped trading card sales into
  //     sold pool, contaminating sold avg ($1.74 vs $3.19 active avg).
  working = working.filter((r) => {
    if (TRADING_CARD_RE.test(String(r.title || ''))) {
      reasons.format++;
      pushSample(r, 'format:trading-card');
      return false;
    }
    return true;
  });

  // 3b2. Merchandise (GL-4, EX-1b) — parity with active Filter 1e2. Prints,
  //      posters, tin signs, figures pass title/issue checks but are not
  //      comics ("ACTION COMICS #33 COVER PRINT" class).
  working = working.filter((r) => {
    if (MERCH_RE.test(String(r.title || ''))) {
      reasons.format++;
      pushSample(r, 'format:merch');
      return false;
    }
    return true;
  });

  // 3c. TPB / collected edition format. Ship #20a.6.20 parity with active
  //     Filter 1g. Reject TPB sales from floppy pools.
  working = working.filter((r) => {
    if (TPB_MARKER_RE.test(String(r.title || ''))) {
      reasons.format++;
      pushSample(r, 'format:tpb');
      return false;
    }
    return true;
  });

  // 3d. Coverless / incomplete. Ship #20a.6.20 parity with active Filter 2c.
  //     Sensation #1 Crowley 9.4 case — coverless sales poison floor.
  working = working.filter((r) => {
    if (COVERLESS_RE.test(String(r.title || ''))) {
      reasons.format++;
      pushSample(r, 'format:coverless');
      return false;
    }
    return true;
  });

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
  // P0-A DIAGNOSTIC: log actual rejection to trace titleMismatch mystery.
  // Production shows titleMismatch=22 but test proves 100% overlap. Measure both.
  working = working.filter((r) => {
    const compTokens = tokenizeTitle(r.title);
    let matches = 0;
    for (const tok of ourTokens) {
      if (compTokens.includes(tok)) matches++;
    }
    const overlap = ourTokens.length > 0 ? matches / ourTokens.length : 0;
    const passes = hasSufficientTitleOverlap(r.title, ourTokens);

    if (passes) return true;

    // REJECTED — log diagnostic
    console.log('[sold-reject] titleMismatch |',
      r.title?.slice(0, 80),
      '| overlap:', overlap.toFixed(2),
      '(' + matches + '/' + ourTokens.length + ')',
      '| ourTokens:', ourTokens.slice(0, 5).join(','));
    reasons.titleMismatch++;
    pushSample(r, 'titleMismatch');
    return false;
  });

  // 6. Printing match. Bidirectional.
  working = working.filter((r) => {
    const m = printingMatch(r.title, variant);
    if (m === 'mismatch') {
      console.log('[sold-reject] printingMismatch |', r.title?.slice(0, 80), '| variant:', variant);
      reasons.printingMismatch++;
      pushSample(r, 'printingMismatch');
      return false;
    }
    return true;
  });

  // 7. Variant-artist mismatch (when our variant names a known artist).
  // Q109 (greenlit) — three-outcome classification. 'partial' rows are
  // KEPT but demoted to variantVerified:false in place (same object the
  // rest of the chain continues to filter/transform).
  working = working.filter((r) => {
    const outcome = classifyArtistMatch(r.title, ourArtist);
    if (outcome === 'mismatch') {
      reasons.variantMismatch++;
      pushSample(r, 'variantMismatch:artist');
      return false;
    }
    if (outcome === 'no-signal') {
      reasons.variantMismatch++;
      pushSample(r, 'variantMismatch:artist-unverifiable');
      return false;
    }
    if (outcome === 'partial') {
      r.variantVerified = false;
    }
    return true;
  });

  // 8. Variant token mismatch. Three cases:
  //    (a) User has NO variant → reject comps with variant tokens
  //    (b) User HAS variant → reject comps with DIFFERENT variant tokens
  //    (c) Both have variant tokens that overlap → keep
  working = working.filter((r) => {
    const userVariantTokens = variant
      ? extractVariantTokens(String(variant).toLowerCase())
      : [];
    const compVariantTokens = extractVariantTokens(String(r.title || '').toLowerCase());

    // Case (a): comp has variant tokens, user has none → reject
    if (compVariantTokens.length > 0 && userVariantTokens.length === 0) {
      console.log('[sold-reject] variantMismatch:comp_has_user_none |', r.title?.slice(0, 80),
        '| userVariant:', variant, '| compTokens:', compVariantTokens.join(','));
      reasons.variantMismatch++;
      pushSample(r, 'variantMismatch:comp_has_user_none');
      return false;
    }

    // Case (a-inverse) — Ship 18 — user has variant tokens, comp has none → reject
    // When subject is virgin/foil/etc. and comp title shows no variant signals,
    // the comp is likely a different (typically standard) variant of the same
    // issue. Production cases:
    //   One World Under Doom #1 virgin → MegaCon Secret Drop comps leaked
    //   Mega Man X Timelines #1 virgin → Cvr B Steinbach comps leaked
    // Sold pool contamination caused 100-300% overpricing.
    if (compVariantTokens.length === 0 && userVariantTokens.length > 0) {
      console.log('[sold-reject] variantMismatch:user_has_comp_none |', r.title?.slice(0, 80),
        '| userVariant:', variant, '| userTokens:', userVariantTokens.join(','));
      reasons.variantMismatch++;
      pushSample(r, 'variantMismatch:user_has_comp_none');
      return false;
    }

    // Case (b): both have tokens but NO overlap → reject
    if (compVariantTokens.length > 0 && userVariantTokens.length > 0) {
      const overlap = compVariantTokens.some((t) =>
        userVariantTokens.some((u) => u === t || u.includes(t) || t.includes(u))
      );
      if (!overlap) {
        console.log('[sold-reject] variantMismatch:different_tokens |', r.title?.slice(0, 80),
          '| userTokens:', userVariantTokens.join(','), '| compTokens:', compVariantTokens.join(','));
        reasons.variantMismatch++;
        pushSample(r, 'variantMismatch:different_tokens');
        return false;
      }
    }

    // Case (c): overlap exists OR neither has tokens → keep
    return true;
  });

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

  // Q47: User-grade proximity filter (±1.5 parity with active comps.js:1241).
  //      Batman #423 FN 6.0 sold avg $159 (4× real $25-45) — high-grade solds
  //      ($159 = 9.0+ mix) flow into blend while [price-bands] asserts
  //      "already at-grade" (false for sold pool). Fix: reject solds outside
  //      ±1.5 grades from user's book, same as active chain does.
  //
  //      Slab filtering already handled by filter 9 (lines 520-528). This
  //      block ONLY handles grade proximity.
  //
  //      Q47-FIX4: Raw scans need grade-proximity filter too. When userGradeKey='raw',
  //      'raw'.match(/\d+/) returns null → filter skipped → high-grade solds contaminate
  //      low-grade pricing. FIX: derive numericTarget from assessedGrade (Vision/AI
  //      grade string "FN 6.0") via parseListingGrade when userGradeKey='raw'.
  if (userGradeKey) {
    const beforeProximity = working.length;
    // Extract numeric grade from userGradeKey (CGC scans: "6.0" / "9.4")
    let numericTarget = null;
    const gradeMatch = String(userGradeKey).match(/(\d+(?:\.\d+)?)/);
    if (gradeMatch) {
      numericTarget = parseFloat(gradeMatch[1]);
    } else if (userGradeKey === 'raw' && assessedGrade) {
      // Raw scans: derive from Vision/AI assessed grade via parseListingGrade
      numericTarget = parseListingGrade(assessedGrade);
      if (numericTarget != null) {
        console.log(`[sold-verify] raw scan grade-proximity: derived ${numericTarget} from assessedGrade="${assessedGrade}"`);
      }
    }

    if (numericTarget != null && !isNaN(numericTarget)) {
      // Q109-LADDER (2026-07-16, ASM #17 raw-scan class): price-plausibility
      // cross-check against PriceCharting's own price ladder — independent
      // of title text entirely. Title-based filters (numeric grade parse,
      // Fair/Poor, qualitative phrases) only catch contamination a listing
      // happens to describe in recognizable language; a mislabeled or
      // scraper-garbled row with no such language still slips through. The
      // ladder is PC's own data for what THIS book sells for at OUR target
      // grade — a sold price far below it is evidence independent of
      // whatever the title does or doesn't say.
      //
      // Scope ruling (2026-07-16), narrow first pass:
      //   - raw scans only (userGradeKey === 'raw') — CGC-graded comps have
      //     a much stronger signal already (the slab's own certified grade,
      //     not inferred from title text); this problem is specific to
      //     text-inferred grade on raw books.
      //   - asymmetric, low-price only — the class with confirmed real-world
      //     evidence tonight. A symmetric high-price check is a different
      //     failure mode (rare variant, bidding war, genuine outlier) with
      //     different risk characteristics, deliberately out of scope here.
      //   - deliberately conservative (0.15x): only catches extreme
      //     divergence, never a legitimate distressed sale at the correct
      //     grade.
      //   - graceful no-op when the ladder has no value for this exact grade
      //     (thin-market books) — absence of ladder data is not evidence of
      //     anything, same principle as every fallback tonight.
      const ladderGradeKey = Number.isInteger(numericTarget)
        ? `${numericTarget}.0`
        : String(numericTarget);
      const ladderValueForGrade =
        userGradeKey === 'raw' && priceLadder && typeof priceLadder === 'object'
          ? priceLadder[ladderGradeKey]
          : null;
      const priceLadderFloor =
        typeof ladderValueForGrade === 'number' && ladderValueForGrade > 0
          ? ladderValueForGrade * 0.15
          : null;
      if (priceLadderFloor != null) {
        console.log(`[sold-verify] price-ladder floor active: grade=${ladderGradeKey} ladder=$${ladderValueForGrade} floor=$${priceLadderFloor.toFixed(2)} (15%)`);
      }

      working = working.filter((r) => {
        // Grade proximity ±1.5
        const listingGrade = parseListingGrade(r.title);

        // Fair/Poor label filter (same as active comps.js:1258-1265)
        if (listingGrade === null) {
          const titleStr = String(r.title || '');
          if (/\b(FR|PR|Fair|Poor)\b/i.test(titleStr)) {
            console.log('[sold-reject] Fair/Poor label |', titleStr.slice(0, 60));
            reasons.gradeMismatch++;
            pushSample(r, 'gradeMismatch');
            return false;
          }
          // Q47-QUAL: qualitative low-grade phrases ("reading copy", "low
          // grade", "coverless", etc.) — positive evidence only. No match
          // falls through to the price-ladder check below, then the
          // unchanged keep-by-default.
          const qualCeiling = getQualitativeGradeCeiling(titleStr);
          if (qualCeiling != null && Math.abs(numericTarget - qualCeiling) > 1.5) {
            console.log('[sold-reject] qualitative grade phrase |', titleStr.slice(0, 60),
              'implied ceiling:', qualCeiling, 'vs our:', numericTarget);
            reasons.gradeMismatch++;
            pushSample(r, 'gradeMismatch');
            return false;
          }
          // no parseable grade, no conflicting phrase — falls through to the
          // price-ladder check below, then keep-by-default.
        } else {
          const diff = Math.abs(listingGrade - numericTarget);
          if (diff > 1.5) {
            console.log('[sold-reject] grade-proximity |', r.title?.slice(0, 60), 'grade:', listingGrade, 'vs our:', numericTarget);
            reasons.gradeMismatch++;
            pushSample(r, 'gradeMismatch');
            return false;
          }
        }

        // Q109-LADDER: universal price-plausibility check — runs regardless
        // of whether the title had a parseable/matching grade, since a
        // contaminated row's price can be implausible even when its title
        // text passed every other check.
        if (priceLadderFloor != null && typeof r.price === 'number' && r.price > 0 &&
            r.price < priceLadderFloor) {
          console.log('[sold-reject] price-ladder implausible |', r.title?.slice(0, 60),
            'price:', r.price, '< 15% of ladder $' + ladderValueForGrade, 'for grade', numericTarget);
          reasons.gradeMismatch++;
          pushSample(r, 'gradeMismatch');
          return false;
        }

        return true;
      });
      console.log(`[sold-verify] grade-proximity filter: before=${beforeProximity} after=${working.length} removed=${beforeProximity - working.length} (±1.5 from ${numericTarget})`);
    }
  }

  // 11.5. Era year tolerance (Ship #20a.6.20 parity with active Filter 0c).
  //       Vintage books: reject sold rows from wrong era (±5y Golden/Silver,
  //       ±3y Bronze, ±2y Modern). Skips when r.year missing (PC rows often
  //       lack year; don't reject on missing data).
  if (bookYear) {
    working = working.filter((r) => {
      // Extract year from row if present (PC rows may have year in metadata
      // or parseable from title). Skip check if no year available.
      const rowYear = r.year || null;
      if (!rowYear) return true; // no data = no reject

      const ourYear = parseInt(bookYear, 10);
      const theirYear = parseInt(rowYear, 10);
      if (isNaN(ourYear) || isNaN(theirYear)) return true;

      // Era-based tolerance (mirrors active Filter 0c)
      const tolerance =
        ourYear < 1956 ? 5  // Golden Age
        : ourYear < 1970 ? 5  // Silver Age
        : ourYear < 1985 ? 3  // Bronze Age
        : 2;                 // Modern

      if (Math.abs(theirYear - ourYear) > tolerance) {
        reasons.yearMismatch++;
        pushSample(r, 'yearMismatch');
        return false;
      }
      return true;
    });
  }

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

  // VARIANT FALLBACK — thin-market variants use grade-matched any-variant comps.
  // When ALL comps rejected for variant mismatch only (foil/virgin/newsstand
  // with zero exact-match sold data), re-run WITHOUT variant filters (7-8) to
  // get grade-matched fallback pool. Flags result with variantAdjusted so
  // pricing layer can warn user that variant premium is estimated.
  if (working.length === 0 && reasons.variantMismatch > 0 && rawCount > 0) {
    console.log('[sold-verify] variant fallback triggered — variantMismatch rejected all',
      rawCount, 'comps, retrying without variant filters');

    // Re-run filters WITHOUT variant checks (filters 7-8).
    // Keep all other filters: issue, lot, printing, slab, signed, grade, year, stale, outlier.
    let fallbackPool = rows.map((r) => ({
      ...r,
      recencyBand: recencyBandFor(r?.daysAgo),
      // EX-A (Q109 greenlight): per-row marker (not just the whole-result
      // `variantAdjusted` flag) so downstream tier selection (priceBands.js)
      // can exclude these wrong-variant-admitted rows from fresh/recent
      // tier-threshold counts instead of trusting them at full weight.
      variantVerified: false,
    }));

    // Apply filters 1-6 (issue, lot, format, title, printing) — no variant filters
    // Q37: Pass series title for adjacency-aware dual-number parsing
    if (issue) {
      fallbackPool = fallbackPool.filter((r) => hasIssueNumber(r.title, issue, title));
    }
    if (!ourIsLot) {
      fallbackPool = fallbackPool.filter((r) => {
        const t = String(r.title || '');
        return !LOT_RE.test(t) && !isValidIssueRange(t) && !hasCrossSeriesSeparator(t);
      });
    }
    if (!ourIsHalf) {
      fallbackPool = fallbackPool.filter((r) => !HALF_ISSUE_RE.test(String(r.title || '')));
    }
    fallbackPool = fallbackPool.filter((r) => !TRADING_CARD_RE.test(String(r.title || '')));
    fallbackPool = fallbackPool.filter((r) => !TPB_MARKER_RE.test(String(r.title || '')));
    fallbackPool = fallbackPool.filter((r) => !COVERLESS_RE.test(String(r.title || '')));
    fallbackPool = fallbackPool.filter((r) => {
      const { mismatch } = hasFormatAsymmetry(r.title, ourMarkers);
      return !mismatch;
    });
    fallbackPool = fallbackPool.filter((r) => hasSufficientTitleOverlap(r.title, ourTokens));
    fallbackPool = fallbackPool.filter((r) => {
      const m = printingMatch(r.title, variant);
      return m !== 'mismatch';
    });

    // SKIP filters 7-8 (variant-artist + variant-token) — this is the fallback

    // Apply filters 9-13 (slab, signed, grade, year, stale, outlier)
    fallbackPool = fallbackPool.filter((r) => !slabMismatch(r.title, userGradeKey));
    if (!ourIsSigned) {
      fallbackPool = fallbackPool.filter((r) => !SIGNED_RE.test(String(r.title || '')));
    }
    fallbackPool = fallbackPool.filter((r) => !gradeTabMismatch(r.title, r.grade));
    if (bookYear) {
      fallbackPool = fallbackPool.filter((r) => {
        const rowYear = r.year || null;
        if (!rowYear) return true;
        const ourYear = parseInt(bookYear, 10);
        const theirYear = parseInt(rowYear, 10);
        if (isNaN(ourYear) || isNaN(theirYear)) return true;
        const tolerance =
          ourYear < 1956 ? 5 : ourYear < 1970 ? 5 : ourYear < 1985 ? 3 : 2;
        return Math.abs(theirYear - ourYear) <= tolerance;
      });
    }
    fallbackPool = fallbackPool.filter((r) => !isStaleForBookYear(r.daysAgo, bookYear));
    const beforeOutlierFallback = fallbackPool.length;
    fallbackPool = applyPriceSanity(fallbackPool);

    // Q109 Class B (greenlit) — self-consistency check on the fallback pool.
    // Skipping filters 7-8 above admits ANY variant-mismatched row,
    // including rows that structurally conflict with EACH OTHER (not just
    // with our variant) — e.g. Camuncoli 1:50 Virgin ($2-10) blended with
    // Skottie Young Baby Variant ($20-55) as if fungible. This distinguishes
    // "no exact match, but the fallback pool agrees with itself" (safe to
    // blend — existing EX-A Tier-2 cap still applies downstream) from "the
    // fallback pool doesn't even agree with itself" (refuse — averaging two
    // different named products produces a number that describes neither).
    //
    // Reuses extractArtist + extractVariantTokens — the same primitives
    // filters 7-8 already use — no new registries. A row's "identity" is
    // its recognized artist name, or (when no artist is recognized) its
    // recognized generic variant-token set (foil/virgin/ratio/etc). Rows
    // where NEITHER primitive recognizes anything are individually
    // uncertain and are NOT merged into one shared "undetected" bucket
    // (Option 2) — that would let an arbitrary number of different but
    // unrecognized-artist variants hide behind a single false consistency
    // signal. They simply don't count toward the recognized-distinct tally
    // either way — refusal is driven only by CONFIRMED disagreement.
    const identitySignatures = fallbackPool.map((r) => {
      const rowArtist = extractArtist(r.title);
      if (rowArtist) return rowArtist;
      const tokens = extractVariantTokens(String(r.title || '').toLowerCase());
      return tokens.length > 0 ? tokens.slice().sort().join(',') : null; // null = undetected, uncounted
    });
    const recognizedDistinct = new Set(identitySignatures.filter(Boolean));

    if (recognizedDistinct.size >= 2) {
      console.log('[sold-verify] variant fallback INCOHERENT —', recognizedDistinct.size,
        'distinct recognized variant identities in fallback pool:', [...recognizedDistinct].join(' | '),
        '— refusing to blend, falling through to next pricing tier');
      return {
        verified: [],
        diagnostics: {
          rawCount,
          verifiedCount: 0,
          rejectedCount: rawCount,
          reasons,
          rejectedSamples,
        },
        variantAdjusted: true,
        variantFallbackIncoherent: true,
      };
    }

    // Q34 Part 1: Relax threshold ≥2 → ≥1 (thin-market variants need anchor).
    // FF Artgerm Invisible Woman: 0 exact-variant matches, fallback gets 1 comp
    // → previously rejected, now accepted with variantAdjusted flag.
    if (fallbackPool.length >= 1) {
      console.log('[sold-verify] variant fallback —', fallbackPool.length,
        'any-variant grade-matched comps (was 0 exact-variant)');
      return {
        verified: fallbackPool,
        diagnostics: {
          rawCount,
          verifiedCount: fallbackPool.length,
          rejectedCount: rawCount - fallbackPool.length,
          reasons,
          rejectedSamples,
        },
        variantAdjusted: true,
      };
    } else {
      console.log('[sold-verify] variant fallback insufficient —',
        fallbackPool.length, 'comps (need ≥1), falling through');
    }
  }

  // Q52: Thor #235 investigation — log exit conditions
  if (ctx.title && ctx.issue) {
    const bookKey = `${ctx.title} #${ctx.issue}`;
    const verifiedCount = working.length;
    const rejectedCount = rawCount - verifiedCount;
    if (verifiedCount === 0 && rawCount > 0) {
      const topReasons = Object.entries(reasons)
        .filter(([_, count]) => count > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([reason, count]) => `${reason}:${count}`)
        .join(', ');
      console.log(`[Q52-investigate] ${bookKey}: 100% rejected (${rejectedCount} total) — top reasons: ${topReasons}`);
    } else if (verifiedCount > 0) {
      console.log(`[Q52-investigate] ${bookKey}: ${verifiedCount}/${rawCount} verified (${rejectedCount} rejected)`);
    }
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
