// Ship #20a.6.18 — Variant identity engine (pure helper, no I/O).
//
// Problem: Vision frequently misidentifies modern variants (wrong series,
// generic variant label like "virgin variant"). eBay image search returns
// the CORRECT identity in seller listing titles (e.g. "Crow Dead Time #1
// C2E2 exclusive Mico Suayan LTD 150" vs Vision's "The Crow #1, virgin").
//
// Solution: When Vision confidence is not HIGH AND year >= 2000 AND variant
// detected, extract consensus identity from eBay image search listings.
// Overrides Vision's variant field for comp query when ≥2 eBay listings
// agree on specific tokens (convention, artist, exclusive markers, limitation).
//
// ZERO DISRUPTION: Old books (pre-2000) skip entirely via year gate. Silver
// Age / Bronze Age / Golden Age path unchanged. Modern HIGH-confidence scans
// skip. Graceful fallback when no consensus → keeps Vision result.
//
// Per Ship #15 architectural rule: pure helper, no HTTP handler. Lives in
// src/lib/, imported by api/enrich.js. Vercel bundles transitively. Function
// count stays at 12/12.

import { extractVariantTokens } from './imageSearchIdentity.js';
import { ARTIST_PATTERNS } from './compHygiene.js';

// Helper: find the most frequent item in an array. Returns null when array
// is empty or all items appear only once (no consensus).
const mode = (arr) => {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const freq = {};
  for (const item of arr) {
    freq[item] = (freq[item] || 0) + 1;
  }
  const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
  const top = sorted[0];
  // Only return if the top item appears more than once
  return top && top[1] >= 2 ? top[0] : null;
};

// Helper: count occurrences of a value in an array.
const count = (arr, val) => {
  if (!Array.isArray(arr)) return 0;
  return arr.filter((item) => item === val).length;
};

// Helper: extract artist name from a title using ARTIST_PATTERNS. Returns
// the first matching pattern's captured text (multi-word patterns match
// first via ordering, so "Mico Suayan" wins before bare "Suayan"). Returns
// null when no pattern matches.
const extractArtist = (title) => {
  if (!title) return null;
  const t = String(title);
  for (const pattern of ARTIST_PATTERNS) {
    const m = t.match(pattern);
    if (m) return m[0];  // Return the matched substring
  }
  return null;
};

// Main entry: extract confirmed variant identity from eBay image search
// results. Returns null when gates fail or no consensus. Returns an object
// with confirmed variant string + metadata when consensus fires.
//
// Q109 Class A (greenlit) — TWO paths through the same consensus mechanism:
//
//   OVERRIDE path (visionVariant present): Vision detected a variant but may
//   have gotten the specific wording wrong or missed a more specific eBay
//   signal — this is the original, unchanged Ship #20a.6.18 behavior.
//     Gates: 1, 3, 4 (all must pass)
//
//   BACKFILL path (visionVariant null): Vision's cover-only variant read
//   (api/grade.js STANDARD_PROMPT: "Only populate variant field when you can
//   see EXPLICIT visual evidence... Do NOT infer variant status from art
//   style or artist recognition alone") is deliberately conservative and
//   frequently returns null even when the eBay visual pool's own listing
//   titles independently and repeatedly name a specific variant (e.g.
//   Captain America #25 "Skottie Young Variant" — never printed on the
//   physical cover, but present in the seller-title consensus). Previously
//   nothing backfilled this the way title/year already do via
//   backfillFromComps() (identityCore.js) — variant just stayed null
//   forever. This path fills that gap using the EXACT SAME consensus
//   mechanism below (mode + ≥2-agree per token type), not a separate
//   ratio-based reimplementation — there's nothing here to second-guess
//   (Vision made no variant call at all), so Gate 4's confidence check
//   doesn't apply; only Gates 1 and 3 gate the backfill path.
//     Gates: 1, 3 (Gate 4 skipped — no Vision variant call to distrust)
//
// Gates:
//   1. visualItems exists and is non-empty array
//   2. (override path only) visionVariant exists (Vision detected a variant)
//   3. bookYear must be parseable (any era — see Q109 note: despite this
//      function's original "modern era only" framing, the code has never
//      actually enforced bookYear >= 2000, only that it parses)
//   4. (override path only) visionConfidence is NOT 'high' (uncertainty signal)
//
// When gates pass:
//   1. Extract variant tokens from each eBay rawTitle
//   2. Find consensus on convention, artist, exclusive, limitation (≥2 agree)
//   3. Build confirmed variant string from consensus tokens
//   4. Return { confirmedVariant, consensus, overriddenVision, source }
//      (source is 'ebay_image_consensus' for override,
//      'ebay_image_consensus_backfill' for backfill; overriddenVision is
//      null on the backfill path — there was nothing to override)
//
// Fallback:
//   - No consensus (< threshold) → return null → keep Vision variant (null)
//   - Any gate fails → return null → keep Vision variant (null)

/**
 * Q115 dispatch (2026-07-18, Batman #608 pool-contamination class) — filter
 * a visual-pool item array to only items whose OWN extracted issue number
 * matches our confirmed issue. Callers MUST apply this before passing items
 * into extractConfirmedVariant (root-mechanism fix, not a downstream flag):
 * an artist-name match can structurally never come from a different issue,
 * so this stops the bad input from ever reaching the artist/exclusive/
 * limitation/year consensus computation, rather than trying to detect and
 * flag a corrupted result after the fact.
 *
 * Confirmed production case: Batman #608 (2002, Jim Lee, Hush) — a 20-item
 * eBay reverse-image-search pool where 0 items were actually issue #608 (a
 * mix of Superman/Batman #657, Absolute Batman #19, Detective Comics #1000,
 * Batman #1 reprints, even unrelated Marvel listings — eBay's own visual-
 * similarity confusion around cover artist Dell'Otto's painted style across
 * his many DIFFERENT DC variant covers, none of them this book). 4/20
 * mentioned "Dell'Otto" — a MINORITY (20%), which the existing artist-
 * consensus ratio gate correctly treats as a genuine distinguishing variant
 * signal when the pool IS the same book (its original, intended purpose —
 * see the Q109-FIX-A comment above). With no issue-level check, it can't
 * tell that shape apart from "these are just different books that happen
 * to share a prolific painter." Backfilled confirmedVariant="exclusive
 * Dell'Otto limited" and, via the artist-year sub-mechanism below,
 * overrode confirmedYear 2002 → 1940 — both wrong, on a book Vision had
 * already correctly identified.
 *
 * A facsimile/artist-variant genuinely mixed into a pool for the SAME
 * issue (the scenario this feature was originally built for — e.g. a
 * Skottie Young facsimile among Captain America #25 originals) is
 * unaffected: those listings still carry "#25," so they survive this
 * filter untouched.
 *
 * Items with no extractable issue number of their own (`.issue == null`)
 * are excluded, not kept — ambiguous is not the same as matching, and an
 * unlabeled item could just as easily be a different issue.
 *
 * @param {Array<{issue?: string|number|null}>} items - parsed visual-pool
 *   rows (extractIdentityFromImageSearch shape — `.issue` already computed)
 * @param {string|number|null} confirmedIssue - our confirmed issue number
 * @returns {Array} filtered items (same shape, subset)
 */
export const filterItemsByIssue = (items, confirmedIssue) => {
  if (!Array.isArray(items)) return items;
  return items.filter(
    (item) => item?.issue != null && String(item.issue) === String(confirmedIssue)
  );
};

export const extractConfirmedVariant = (
  visualItems,
  visionVariant,
  bookYear,
  visionConfidence
) => {
  // Gate 1: visualItems must exist
  if (!Array.isArray(visualItems) || visualItems.length === 0) {
    return null;
  }

  // Gate 3: bookYear must exist (any era)
  const y = parseInt(bookYear, 10);
  if (!y) {
    return null;
  }

  const isBackfill = !visionVariant;

  // Q109-FIX-C (2026-07-16, ASM #17 Ditko / ASM #300 McFarlane): the
  // backfill path exists to catch modern marketed variants Vision's
  // conservative cover-only read misses (Skottie Young on Captain America
  // #25 — a real, separately-SKU'd incentive cover). Marketed variant
  // covers (convention exclusives, numbered/limited editions, artist
  // incentive covers) are a direct-market-era concept — they don't exist
  // on books from before the direct market's speculator boom. Below this
  // boundary, an artist name surfacing in a MINORITY of pool titles isn't
  // evidence of a distinguishing subset (Fix A's ratio-gate assumption) —
  // it's just inconsistent seller SEO on a book with exactly one cover.
  // Production evidence: Ditko backfilled at 5/18=28% of the ASM #17 pool,
  // McFarlane at 6/20=30% of the ASM #300 pool — both comfortably under
  // Fix A's 70% threshold despite neither naming a real distinguishing
  // variant, both collapsing their downstream comp pools by 65-84% via
  // Filter 1c / classifyArtistMatch. 1990 marks the pre-direct-market /
  // post-speculator-boom line — comfortably below every genuine modern
  // variant case (Skottie Young 2019, Mico Suayan 2024-2025) and at/above
  // both false-positive cases (Ditko 1964, McFarlane 1988). Override path
  // untouched: Vision already saw a real variant on the physical cover
  // there, this gate only stops the backfill mechanism from inventing one.
  const BACKFILL_MIN_YEAR = 1990;
  if (isBackfill && y < BACKFILL_MIN_YEAR) {
    console.log(`[variant-identity] backfill skipped: year=${y} < ${BACKFILL_MIN_YEAR} (pre-direct-market — no marketed variant covers to backfill)`);
    return null;
  }

  // Gate 2/4 (override path only): visionVariant must exist, and when it
  // does, Vision confidence must NOT be HIGH (uncertainty signal — only
  // second-guess Vision's own variant call when Vision itself signals low
  // confidence). Neither applies to the backfill path: there is no Vision
  // variant call to distrust, only a gap to fill.
  if (!isBackfill) {
    const conf = String(visionConfidence || 'medium').toLowerCase().trim();
    if (conf === 'high') {
      return null;
    }
  }

  console.log(`[variant-identity] gates passed: year=${y}, variant="${visionVariant || '(null)'}", mode=${isBackfill ? 'backfill' : 'override'}`);

  // Extract variant tokens from each eBay rawTitle
  const allConventions = [];
  const allArtists = [];
  const allExclusives = [];
  const allLimitations = [];
  // Q99-B: retain per-item artist + years so an artist-facsimile pool's own
  // publication year can be resolved separately from the generic comp pool
  // (a Skottie Young 2023 facsimile mixed in the same nominal-title pool as
  // 1981 originals must not inherit either CV's or the undifferentiated
  // pool's year — its own listings carry the true year).
  const itemRecords = [];
  const YEAR_RE = /\b(19[3-9]\d|20[0-3]\d)\b/g;
  // Q109-FIX-A (2026-07-16, ASM #300 McFarlane): denominator for the
  // artist distinguishing-ratio check below — count of pool items that
  // actually had a title to extract tokens from.
  let consideredCount = 0;

  for (const item of visualItems) {
    const rawTitle = item?.rawTitle || '';
    if (!rawTitle) continue;
    consideredCount++;

    // Extract tokens using imageSearchIdentity helper
    const tokens = extractVariantTokens(rawTitle);

    // Convention tokens (c2e2, sdcc, nycc, fanexpo, etc.)
    const convention = tokens.find((t) =>
      ['megacon', 'nycc', 'c2e2', 'sdcc', 'fanexpo', 'emerald city', 'eccc', 'wondercon'].includes(t)
    );
    if (convention) allConventions.push(convention);

    // Exclusive tokens
    const exclusive = tokens.find((t) =>
      ['exclusive', 'convention exclusive', 'con exclusive', 'store exclusive',
       'shop exclusive', 'web exclusive', 'online exclusive', 'secret drop'].includes(t)
    );
    if (exclusive) allExclusives.push(exclusive);

    // Limitation tokens
    const limitation = tokens.find((t) =>
      ['numbered', 'limited'].includes(t)
    );
    if (limitation) allLimitations.push(limitation);

    // Artist extraction (from rawTitle using ARTIST_PATTERNS)
    const artist = extractArtist(rawTitle);
    if (artist) allArtists.push(artist);

    const years = [...new Set((rawTitle.match(YEAR_RE) || []).map((y2) => parseInt(y2, 10)))];
    itemRecords.push({ artist: artist ? artist.toLowerCase() : null, years });
  }

  console.log(`[variant-identity] extracted tokens: conventions=${JSON.stringify(allConventions)}, artists=${JSON.stringify(allArtists)}, exclusives=${allExclusives.length}, limitations=${allLimitations.length}`);

  // Build consensus: each token type requires ≥2 agree
  const consensus = {};

  const topConvention = mode(allConventions);
  if (topConvention && count(allConventions, topConvention) >= 2) {
    consensus.convention = topConvention;
  }

  // Artist consensus: case-insensitive comparison (artists appear in
  // mixed case: "Mico Suayan", "MICO SUAYAN", "mico suayan").
  //
  // Q109-FIX-A (2026-07-16, ASM #300): raw ≥2-agree alone can't tell
  // "genuine distinguishing variant" (Skottie Young credited on a MINORITY
  // of a mixed pool of covers) from "this is just who drew the book's one
  // and only cover" (McFarlane named in nearly every listing, because
  // sellers cite the famous artist for SEO regardless of edition — not
  // because a distinguishing subset of comps carries his name). An artist
  // consensus is only treated as distinguishing when it covers a MINORITY
  // of the considered pool — 70% is the threshold, matching the general
  // shape of this session's other consensus gates (issue 50%, title 30%):
  // above it, "most sellers happen to mention this" has tipped into
  // "this is the standard cover, not a variant," and using it as a
  // filtering criterion (classifyArtistMatch / Filter 7 in
  // soldVerification.js) would reject correct comps for the crime of
  // omitting a non-distinguishing artist name. Below-threshold artist
  // mentions are excluded from consensus.artist entirely, so they never
  // reach confirmedVariant and never gate Filter 7 — no separate flag
  // needed downstream.
  //
  // Floor added after this exact change broke the module's own canonical
  // test (Crow Dead Time / Mico Suayan, Captain America #25 / Skottie
  // Young — both 2-item stub pools): with only 2 items, 2/2 agreement is
  // unavoidably 100% whether or not the artist is genuinely distinguishing
  // — the ratio carries no information below a minimum sample size. Pools
  // under MIN_POOL_FOR_RATIO_GATE skip the ratio check entirely and fall
  // back to the original ≥2-agree behavior, unchanged from before Fix A.
  const ARTIST_DISTINGUISHING_RATIO = 0.7;
  const MIN_POOL_FOR_RATIO_GATE = 4;
  const artistsNormalized = allArtists.map((a) => String(a).toLowerCase());
  const topArtistLower = mode(artistsNormalized);
  if (topArtistLower && count(artistsNormalized, topArtistLower) >= 2) {
    const topArtistCount = count(artistsNormalized, topArtistLower);
    const artistRatio = consideredCount > 0 ? topArtistCount / consideredCount : 0;
    const ratioGateApplies = consideredCount >= MIN_POOL_FOR_RATIO_GATE;
    if (!ratioGateApplies || artistRatio < ARTIST_DISTINGUISHING_RATIO) {
      // Find the original-case artist name (prefer first occurrence)
      const idx = artistsNormalized.indexOf(topArtistLower);
      consensus.artist = allArtists[idx];
    } else {
      const idx = artistsNormalized.indexOf(topArtistLower);
      console.log(
        `[variant-identity] artist "${allArtists[idx]}" appears in ` +
        `${topArtistCount}/${consideredCount} (${Math.round(artistRatio * 100)}%) of pool — ` +
        `NOT distinguishing (>= ${Math.round(ARTIST_DISTINGUISHING_RATIO * 100)}% threshold), ` +
        `informational only, excluded from filtering`
      );
    }
  }

  // Exclusive: just need ≥2 listings with ANY exclusive marker
  if (allExclusives.length >= 2) {
    // Pick the most specific exclusive marker
    const topExclusive = mode(allExclusives);
    consensus.exclusive = topExclusive || 'exclusive';
  }

  // Limitation: need ≥2 agree (same type)
  const topLimitation = mode(allLimitations);
  if (topLimitation && count(allLimitations, topLimitation) >= 2) {
    consensus.limitation = topLimitation;
  }

  // If no consensus on ANY token, return null (keep Vision variant — null
  // stays null on the backfill path, nothing to fill in)
  if (Object.keys(consensus).length === 0) {
    console.log(`[variant-identity] no consensus — ${isBackfill ? 'nothing to backfill, variant stays null' : 'keeping Vision variant'}`);
    return null;
  }

  console.log(`[variant-identity] consensus:`, JSON.stringify(consensus));

  // Q99-B: when an artist consensus fires (artist facsimile / signed
  // exclusive), resolve publication year from THAT artist's own listings
  // only — not the generic pool, which mixes original-print and facsimile
  // comps under the same nominal title/issue. Requires ≥50% of the
  // artist-matching listings to agree on a single year.
  let variantYear = null;
  let variantYearRatio = 0;
  if (consensus.artist) {
    const artistItems = itemRecords.filter((r) => r.artist === topArtistLower);
    const yearCounts = {};
    artistItems.forEach((r) => {
      r.years.forEach((yr) => { yearCounts[yr] = (yearCounts[yr] || 0) + 1; });
    });
    const sortedYears = Object.entries(yearCounts).sort((a, b) => b[1] - a[1]);
    if (sortedYears.length > 0 && artistItems.length > 0) {
      const [topYear, topCount] = sortedYears[0];
      const ratio = topCount / artistItems.length;
      if (ratio >= 0.5) {
        variantYear = parseInt(topYear, 10);
        variantYearRatio = ratio;
        console.log(
          `[variant-year] resolved ${topYear} from ${consensus.artist} pool ` +
          `(${topCount}/${artistItems.length}=${Math.round(ratio * 100)}%)`
        );
      }
    }
  }

  // Build confirmed variant string from consensus tokens
  // Order: Vision's own variant (override path only) → convention →
  // exclusive → artist → limitation
  //
  // Q109-FIX-B (2026-07-16): the override path used to DISCARD Vision's
  // own variant call outright, replacing it with whatever consensus
  // tokens fired. That's correct when consensus is CORRECTING a wrong or
  // vague Vision read (the mechanism's original purpose), but wrong when
  // Vision supplied a real signal from a different axis than the
  // consensus found — e.g. Vision's reason-text newsstand fallback
  // populates variant="newsstand" (an edition-type signal Vision can only
  // get from the physical cover), and a same-book artist consensus then
  // fires on "mcfarlane" (a cover-credit signal from eBay titles) — the
  // two aren't in conflict, they're both true at once. Appending instead
  // of replacing preserves Vision's edition-type read while still adding
  // whatever the eBay pool corroborates. Backfill path (visionVariant
  // falsy) is unaffected — nothing to prepend, identical to prior output.
  const parts = [];
  if (!isBackfill && visionVariant) parts.push(String(visionVariant).trim());
  if (consensus.convention) parts.push(consensus.convention);
  if (consensus.exclusive) parts.push(consensus.exclusive);
  if (consensus.artist) parts.push(consensus.artist);
  if (consensus.limitation) parts.push(consensus.limitation);

  const confirmedVariant = parts.join(' ');

  console.log(`[variant-identity] confirmed: "${confirmedVariant}" (${isBackfill ? 'backfilled — Vision had no variant call' : `Vision was: "${visionVariant}"`})`);

  return {
    confirmedVariant,
    consensus,
    overriddenVision: isBackfill ? null : visionVariant,
    source: isBackfill ? 'ebay_image_consensus_backfill' : 'ebay_image_consensus',
    variantYear,
    variantYearRatio,
  };
};
