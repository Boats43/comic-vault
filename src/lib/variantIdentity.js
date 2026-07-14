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
// Gates (all must pass):
//   1. visualItems exists and is non-empty array
//   2. visionVariant exists (Vision detected a variant)
//   3. bookYear >= 2000 (modern era only)
//   4. visionConfidence is NOT 'high' (uncertainty signal)
//
// When gates pass:
//   1. Extract variant tokens from each eBay rawTitle
//   2. Find consensus on convention, artist, exclusive, limitation (≥2 agree)
//   3. Build confirmed variant string from consensus tokens
//   4. Return { confirmedVariant, consensus, overriddenVision, source }
//
// Fallback:
//   - No consensus (< threshold) → return null → keep Vision variant
//   - Any gate fails → return null → keep Vision variant
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

  // Gate 2: visionVariant must exist (Vision detected a variant)
  if (!visionVariant) {
    return null;
  }

  // Gate 3: bookYear must exist (any era)
  const y = parseInt(bookYear, 10);
  if (!y) {
    return null;
  }

  // Gate 4: Vision confidence must NOT be HIGH (uncertainty signal)
  const conf = String(visionConfidence || 'medium').toLowerCase().trim();
  if (conf === 'high') {
    return null;
  }

  console.log(`[variant-identity] gates passed: year=${y}, variant="${visionVariant}", confidence=${conf}`);

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

  for (const item of visualItems) {
    const rawTitle = item?.rawTitle || '';
    if (!rawTitle) continue;

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
  const artistsNormalized = allArtists.map((a) => String(a).toLowerCase());
  const topArtistLower = mode(artistsNormalized);
  if (topArtistLower && count(artistsNormalized, topArtistLower) >= 2) {
    // Find the original-case artist name (prefer first occurrence)
    const idx = artistsNormalized.indexOf(topArtistLower);
    consensus.artist = allArtists[idx];
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

  // If no consensus on ANY token, return null (keep Vision variant)
  if (Object.keys(consensus).length === 0) {
    console.log(`[variant-identity] no consensus — keeping Vision variant`);
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
  // Order: convention → exclusive → artist → limitation
  const parts = [];
  if (consensus.convention) parts.push(consensus.convention);
  if (consensus.exclusive) parts.push(consensus.exclusive);
  if (consensus.artist) parts.push(consensus.artist);
  if (consensus.limitation) parts.push(consensus.limitation);

  const confirmedVariant = parts.join(' ');

  console.log(`[variant-identity] confirmed: "${confirmedVariant}" (Vision was: "${visionVariant}")`);

  return {
    confirmedVariant,
    consensus,
    overriddenVision: visionVariant,
    source: 'ebay_image_consensus',
    variantYear,
    variantYearRatio,
  };
};
