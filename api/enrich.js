// POST /api/enrich
//
// Second-pass enrichment. Fires ComicVine, eBay comps, and the
// Ximilar image fallback in parallel and returns everything together. The
// client displays the Claude /api/grade result immediately and merges this
// payload into the card when it resolves.
//
// Request body: { title, grade, confidence?, images? }
// Response: { comicVine?, comps?, ximilar?, price?, priceLow?,
//             priceHigh?, keyIssue?, identifiedBy? }

import Anthropic from "@anthropic-ai/sdk";
import { fetchComps, getOAuthToken, computeMatchConfidence, cleanPublisher } from "./comps.js";
import { fetchSold } from "./sold.js";
import { lookupCGC } from "./cgc-lookup.js";
import { lookupGoCollect } from "./gocollect.js";
import { fetchPricechartingPop } from "./pricecharting-pop.js";
import {
  MEGA_KEYS_SCHEMA_VERSION,
  getMegaKeyEntry,
  getMegaKeyFloor,
  normalizeTitle,
} from "./mega-keys.js";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Format a number as USD ("$1,234.56") or null. Mirrors the formatter
// used in api/comps.js so the UI gets identically-shaped strings whether
// the stats came from fetchComps or the post-verification recomputation.
const fmtUsd = (n) =>
  n == null || isNaN(n)
    ? null
    : `$${n.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;

// Marvel test-market price-variant allowlists. Vision labels any 35¢ /
// 30¢ price box on a cover as a "test market" variant, but those price
// points are also the standard cover price for a wide era of Marvel
// books (35¢ became standard August 1977; 30¢ was standard from
// September 1976 onward outside the test window). Without this gate
// the variant multiplier (×6 for 35¢, ×4 for 30¢) fires on books like
// Howard the Duck #28 (1978, out of window) that just happen to show
// 35¢ as their normal price.
//
// Title keys go through `normalizeTitle` (lowercase, strip punctuation,
// hyphens → spaces). Aliases included where Vision returns the short
// form some scans and the full form on others (sgt fury, john carter,
// kid colt, doctor strange / dr strange).
//
// 35¢ source: https://recalledcomics.com/Marvel35CentVariants.php
//   (cross-checked vs gocollect.com and sellmycomicbooks.com — 184
//   issues across 52 series, June–October 1977 test-market window).
//
// 30¢ source: https://recalledcomics.com/Marvel30CentVariants.php
//   (cross-checked vs gocollect.com — 182 issues across 57 series,
//   April–August 1976 test-market window). Excludes Ka-Zar #16 and
//   Inhumans #5 — those were printed entirely at 30¢, no variant.
const TEST_MARKET_VARIANTS = {
  '35¢': {
    '2001 a space odyssey': [7, 8, 9, 10],
    'amazing spider man': [169, 170, 171, 172, 173],
    'avengers': [160, 161, 162, 163, 164],
    'black panther': [4, 5],
    'captain america': [210, 211, 212, 213, 214],
    'captain marvel': [51, 52],
    'champions': [14, 15],
    'conan the barbarian': [75, 76, 77, 78, 79],
    'daredevil': [146, 147, 148],
    'defenders': [48, 49, 50, 51, 52],
    // Ship #10: dual-key for Doctor Strange / Dr. Strange (Vision varies).
    'doctor strange': [23, 24, 25],
    'dr strange': [23, 24, 25],
    'eternals': [12, 13, 14, 15, 16],
    'fantastic four': [183, 184, 185, 186, 187],
    'flintstones': [1],
    'ghost rider': [24, 25, 26],
    'godzilla': [1, 2, 3],
    'howard the duck': [13, 14, 15, 16, 17],
    'human fly': [1, 2],
    'incredible hulk': [212, 213, 214, 215, 216],
    'inhumans': [11, 12],
    'invaders': [17, 18, 19, 20, 21],
    'iron fist': [13, 14, 15],
    'iron man': [99, 100, 101, 102, 103],
    'john carter': [1, 2, 3, 4, 5],
    'john carter warlord of mars': [1, 2, 3, 4, 5],
    'kid colt': [218, 219, 220],
    'kid colt outlaw': [218, 219, 220],
    // Ship #10: actual cover title 1977 was "Kull the Destroyer"
    // (RecalledComics' display label "Kull the Conqueror" was a
    // typo — the title flipped to Destroyer in 1973 and stayed
    // there until 1982). Vision reads literal cover text.
    'kull the destroyer': [21, 22, 23],
    'logans run': [6, 7],
    'marvel premiere': [36, 37, 38],
    'marvel presents': [11, 12],
    'marvel super action': [2, 3],
    'marvel super heroes': [65, 66],
    'marvel tales': [80, 81, 82, 83, 84],
    'marvel team up': [58, 59, 60, 61, 62],
    'marvel triple action': [36, 37],
    'marvel two in one': [28, 29, 30, 31, 32],
    'marvels greatest comics': [71, 72, 73],
    'master of kung fu': [53, 54, 55, 56, 57],
    'ms marvel': [6, 7, 8, 9, 10],
    'nova': [10, 11, 12, 13, 14],
    'omega the unknown': [9, 10],
    'power man': [44, 45, 46, 47],
    'rawhide kid': [140, 141],
    'red sonja': [4, 5],
    'scooby doo': [1],
    'sgt fury': [141, 142],
    'sgt fury and his howling commandos': [141, 142],
    'spectacular spider man': [7, 8, 9, 10, 11],
    'star wars': [1, 2, 3, 4],
    'super villain team up': [12, 13, 14],
    'tarzan': [1, 2, 3, 4, 5],
    'thor': [260, 261, 262, 263, 264],
    'tomb of dracula': [57, 58, 59, 60],
    'x men': [105, 106, 107],
  },
  '30¢': {
    'adventures on the planet of the apes': [5, 6, 7],
    'amazing adventures': [36, 37],
    'amazing spider man': [155, 156, 157, 158, 159],
    'astonishing tales': [35, 36],
    'avengers': [146, 147, 148, 149, 150],
    'black goliath': [2, 3, 4],
    'captain america': [196, 197, 198, 199, 200],
    'captain marvel': [44, 45],
    'chamber of chills': [22, 23],
    'champions': [5, 6, 7],
    'conan the barbarian': [61, 62, 63, 64, 65],
    'daredevil': [132, 133, 134, 135, 136],
    'defenders': [34, 35, 36, 37, 38],
    'doctor strange': [13, 14, 15, 16, 17],
    'dr strange': [13, 14, 15, 16, 17],
    'eternals': [1, 2],
    'fantastic four': [169, 170, 171, 172, 173],
    'ghost rider': [17, 18, 19],
    'howard the duck': [3, 4],
    'incredible hulk': [198, 199, 200, 201, 202],
    'invaders': [6, 7],
    'iron fist': [4, 5, 6],
    'iron man': [85, 86, 87, 88, 89],
    'jungle action': [21, 22],
    'kid colt': [205, 206, 207, 208, 209],
    'kid colt outlaw': [205, 206, 207, 208, 209],
    'kull the destroyer': [16],
    'marvel adventure': [3, 4, 5],
    'marvel chillers': [4, 5, 6],
    'marvel double feature': [15, 16, 17],
    'marvel feature': [4, 5],
    'marvel premiere': [29, 30, 31],
    'marvel presents': [4, 5, 6],
    'marvel spotlight': [27, 28, 29],
    'marvel super heroes': [57, 58],
    'marvel tales': [66, 67, 68, 69, 70],
    'marvel team up': [44, 45, 46, 47, 48],
    'marvel triple action': [29, 30],
    'marvel two in one': [15, 16, 17, 18],
    'marvels greatest comics': [63, 64],
    'master of kung fu': [39, 40, 41, 42, 43],
    'mighty marvel western': [45],
    'omega the unknown': [2, 3],
    'power man': [30, 31, 32, 33, 34],
    'rawhide kid': [133, 134],
    'ringo kid': [27, 28],
    'sgt fury': [133, 134],
    'sgt fury and his howling commandos': [133, 134],
    'skull the slayer': [5, 6],
    'son of satan': [3, 4, 5],
    'strange tales': [185, 186],
    'super villain team up': [5, 6, 7],
    'thor': [246, 247, 248, 249, 250],
    'tomb of darkness': [20, 21],
    'tomb of dracula': [43, 44, 45, 46, 47],
    'two gun kid': [129, 130, 131],
    'warlock': [12, 13, 14],
    'weird wonder tales': [15, 16, 17],
    'werewolf by night': [38, 39],
    'x men': [98, 99, 100],
  },
};

// Maps variant-string keys (as appear in Vision-returned variant
// strings) to their TEST_MARKET_VARIANTS bucket key. Extends cleanly
// to future variant types (Whitman, Mark Jewelers, Type 1A/1B) by
// adding new entries here + a new bucket above.
const TEST_MARKET_KEYS = {
  '35 cent': '35¢',
  '35¢': '35¢',
  '30 cent': '30¢',
  '30¢': '30¢',
};

// Resolve whether a (title, issue, variantKey) combo falls within a
// known test-market window. Returns true ONLY for (title, issue) pairs
// listed in TEST_MARKET_VARIANTS[variantKey]. Used to gate the variant
// multiplier — books outside the allowlist fall through to 1.0× even
// when Vision labeled the cover with a test-market price string.
const isTestMarketVariant = (title, issue, variantKey) => {
  const bucket = TEST_MARKET_VARIANTS[variantKey];
  if (!bucket) return false;
  const titleKey = normalizeTitle(title);
  if (!titleKey) return false;
  const issueNum = parseInt(String(issue || '').trim(), 10);
  if (isNaN(issueNum)) return false;
  const allowed = bucket[titleKey];
  return Array.isArray(allowed) && allowed.includes(issueNum);
};

// Median of a numeric array. Used for mixed-print/variant comp fallbacks
// where the mean is meaningless (e.g. 1st prints @ $200 mixed with 4th
// prints @ $3 averages to $100). Median filters outlier prints better.
const median = (arr) => {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
};

// Fast, text-only AI verification pass. Asks Claude whether each eBay
// listing title actually matches the identified comic. Returns an array
// of booleans in the same order as `listings`, or null on any failure so
// the caller can silently fall back to unverified comps.
const verifyCompsTitles = async ({ title, issue, year, publisher, listings }) => {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!Array.isArray(listings) || listings.length === 0) return null;
  try {
    const metaParts = [];
    if (title) metaParts.push(String(title).trim());
    if (issue) metaParts.push(`#${issue}`);
    if (year) metaParts.push(`(${year})`);
    const comicLabel =
      metaParts.filter(Boolean).join(" ").trim() || "this comic";
    const publisherPart = publisher ? ` by ${publisher}` : "";
    const numbered = listings
      .map((t, i) => `${i + 1}. ${String(t || "").trim()}`)
      .join("\n");

    const prompt =
      `I identified this comic: ${comicLabel}${publisherPart}.\n\n` +
      `These are eBay listings returned as price comps:\n${numbered}\n\n` +
      `For each listing reply with MATCH or NO_MATCH. MATCH if the ` +
      `listing is clearly the same comic — same title, same issue number, ` +
      `same era. If the title is a close match (same character, same series ` +
      `name, same issue number) accept it even if the listing title has ` +
      `extra words like "variant", "cover B", "ratio variant", "2nd print", ` +
      `"newsstand", or "facsimile". ` +
      `Year in listing title may differ from our year by 1-2 years due to ` +
      `cover dates vs publication dates — this is NOT a reason to reject. ` +
      `Only reject if it is clearly a different issue number or a different ` +
      `character/series. ` +
      `Reply with only a JSON array like:\n[true, false, true, false]\n` +
      `in the same order as the listings.`;

    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 256,
      messages: [{ role: "user", content: prompt }],
    });

    const text = (message.content || [])
      .filter((b) => b && b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      const m = text.match(/\[[\s\S]*?\]/);
      parsed = m ? JSON.parse(m[0]) : null;
    }
    if (!Array.isArray(parsed)) return null;
    if (parsed.length !== listings.length) {
      console.warn(
        `[enrich] AI verify length mismatch: got ${parsed.length}, expected ${listings.length}`
      );
      return null;
    }
    return parsed.map((v) => v === true);
  } catch (err) {
    console.error(`[enrich] AI verify error: ${err?.message || err}`);
    return null;
  }
};

const lookupComicVine = async ({ title, issue, year, publisher }) => {
  if (!process.env.COMICVINE_API_KEY || !title) return null;
  try {
    // Prefer explicit issue param, fall back to parsing from title.
    const issueFromTitle = String(title).match(/#\s*(\d+)/);
    const issueNumber = issue ? String(issue).trim() : (issueFromTitle ? issueFromTitle[1] : null);
    // Strip #N from title for the base series name.
    const seriesName = String(title).replace(/#\s*\d+/, "").trim();
    // Include issue number in query — ComicVine search ranks it much higher.
    const searchQuery = issueNumber ? `${seriesName} ${issueNumber}` : seriesName;

    const url =
      `https://comicvine.gamespot.com/api/search/?api_key=${encodeURIComponent(process.env.COMICVINE_API_KEY)}` +
      `&format=json&resources=issue&query=${encodeURIComponent(searchQuery)}` +
      `&field_list=id,name,issue_number,cover_date,description,deck,first_appearance_characters,character_credits,story_arc_credits,volume` +
      `&limit=20`;
    const res = await fetch(url, {
      headers: { "User-Agent": "ComicVault/1.0" },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const results = Array.isArray(json?.results) ? json.results : [];

    // Filter to issue number matches first.
    const issueMatches = issueNumber
      ? results.filter((r) => String(r?.issue_number ?? "").trim() === String(issueNumber))
      : [];

    // Score each issue match: prefer volume name closest to our series name,
    // then use volume id as a tiebreaker (lower id = older/original volume).
    const seriesLower = seriesName.toLowerCase().replace(/^(the|a|an)\s+/i, "").trim();
    const comicYear = year ? parseInt(String(year).trim(), 10) : null;
    const pubLower = publisher ? String(publisher).toLowerCase().trim() : null;
    const scoreMatch = (r) => {
      const volName = String(r?.volume?.name || "").toLowerCase().replace(/^(the|a|an)\s+/i, "").trim();
      // Exact or near-exact volume name match gets highest priority.
      const nameScore = volName === seriesLower ? 100
        : volName.includes(seriesLower) || seriesLower.includes(volName) ? 50
        : 0;
      // Year proximity scoring: prefer volumes from the same era.
      const startYear = r?.volume?.start_year ? parseInt(r.volume.start_year, 10) : null;
      const yearDiff = comicYear && startYear ? Math.abs(startYear - comicYear) : 999;
      const yearScore = yearDiff < 10 ? 2 : yearDiff < 20 ? 1 : 0;
      // Publisher scoring: prefer matching publisher.
      const volPublisher = String(r?.volume?.publisher?.name || "").toLowerCase().trim();
      const publisherScore = pubLower && volPublisher && volPublisher.includes(pubLower) ? 2 : 0;
      // Lower volume id = older/more likely original series.
      const volId = parseInt(r?.volume?.id, 10) || 999999;
      return { r, nameScore, yearScore, publisherScore, volId,
        total: nameScore + yearScore + publisherScore };
    };

    // For all issue matches (even single), fetch volume details for the
    // unique volumes so we can score on start_year and publisher.
    const candidates = issueMatches.length > 0 ? issueMatches : [];
    const uniqueVolIds = [...new Set(candidates.map((r) => r?.volume?.id).filter(Boolean))];
    const volDetails = {};
    // Fetch up to 5 volume details sequentially (ComicVine rate-limits parallel).
    for (const vid of uniqueVolIds.slice(0, 5)) {
      try {
        const vUrl =
          `https://comicvine.gamespot.com/api/volume/4050-${vid}/?api_key=${encodeURIComponent(process.env.COMICVINE_API_KEY)}` +
          `&format=json&field_list=id,name,start_year,publisher`;
        const vRes = await fetch(vUrl, { headers: { "User-Agent": "ComicVault/1.0" } });
        if (vRes.ok) {
          const vJson = await vRes.json();
          if (vJson?.results) volDetails[vid] = vJson.results;
        }
      } catch { /* skip */ }
    }
    console.log(`[comicvine] volDetails fetched: ${Object.keys(volDetails).length}/${uniqueVolIds.length} — ${
      Object.entries(volDetails).map(([id, v]) => `${id}:${v.name}(${v.start_year},${v.publisher?.name || "?"})`).join(", ")}`);

    // Re-score with volume detail data (start_year, publisher).
    const scoreWithDetails = (r) => {
      const base = scoreMatch(r);
      const vid = r?.volume?.id;
      const vol = volDetails[vid];
      if (!vol) return base;
      const startYear = vol.start_year ? parseInt(vol.start_year, 10) : null;
      const yearDiff = comicYear && startYear ? Math.abs(startYear - comicYear) : 999;
      const detailYearScore = yearDiff < 10 ? 2 : yearDiff < 20 ? 1 : 0;
      const volPub = String(vol.publisher?.name || "").toLowerCase().trim();
      const detailPubScore = pubLower && volPub && volPub.includes(pubLower) ? 2 : 0;
      const total = base.nameScore + detailYearScore + detailPubScore;
      return { ...base, yearScore: detailYearScore, publisherScore: detailPubScore, total };
    };

    let match = null;
    if (candidates.length === 1) {
      // Single match — still validate year/publisher if we have details.
      const scored = scoreWithDetails(candidates[0]);
      // Reject if we know both year and publisher and neither matched.
      if (comicYear && pubLower && scored.yearScore === 0 && scored.publisherScore === 0 && volDetails[candidates[0]?.volume?.id]) {
        match = null; // wrong era + wrong publisher — skip
      } else {
        match = candidates[0];
      }
    } else if (candidates.length > 1) {
      // Pick best: highest combined score, then lowest volume id (oldest series).
      const scored = candidates.map(scoreWithDetails);
      scored.sort((a, b) => b.total - a.total || a.volId - b.volId);
      console.log(`[comicvine] top scores: ${scored.slice(0, 3).map((s) =>
        `${s.r.volume?.name}(name=${s.nameScore} yr=${s.yearScore} pub=${s.publisherScore} total=${s.total} vid=${s.volId})`
      ).join(" | ")}`);
      match = scored[0].r;
    }
    // No match — don't fall through to results[0].

    console.log(
      `[comicvine] query="${searchQuery}" issue=${issueNumber} year=${year || "?"}` +
      ` results=${results.length} issueMatches=${candidates.length}` +
      ` matched=${match ? `${match.volume?.name} #${match.issue_number} (vol_id=${match.volume?.id})` : "none"}`
    );

    if (!match) return null;
    const firstApps = match.first_appearance_characters;
    const hasFirstApps = Array.isArray(firstApps) && firstApps.length > 0;

    // Parse description + deck for key-issue signals when structured
    // first_appearance_characters is empty (common for origin issues,
    // deaths, #1 issues, classic-artist-significance keys).
    const descText = `${match.deck || ""} ${match.description || ""}`
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    let derivedKey = null;
    if (!hasFirstApps && descText) {
      const d = descText.toLowerCase();
      const faMatch = descText.match(/first appearance of ([^.!?;\n]{3,80})/i);
      const originMatch = descText.match(/origin of ([^.!?;\n]{3,80})/i);
      const deathMatch = descText.match(/death of ([^.!?;\n]{3,80})/i);
      if (faMatch) {
        derivedKey = `1st appearance of ${faMatch[1].trim().replace(/[,.]$/, "")}`;
      } else if (originMatch) {
        derivedKey = `Origin of ${originMatch[1].trim().replace(/[,.]$/, "")}`;
      } else if (deathMatch) {
        derivedKey = `Death of ${deathMatch[1].trim().replace(/[,.]$/, "")}`;
      } else if (/\bfirst appearance\b/.test(d)) {
        derivedKey = "1st appearance";
      } else if (/\borigin\b/.test(d) && /\bissue\b/.test(d)) {
        derivedKey = "Origin issue";
      }
      if (derivedKey) console.log("[comicvine] key derived from description:", derivedKey);
    }

    return {
      id: match.id,
      name: match.name,
      issueNumber: match.issue_number,
      volume: match.volume?.name,
      description: match.description,
      deck: match.deck,
      coverDate: match.cover_date || null,
      firstAppearanceCharacters: hasFirstApps
        ? firstApps.map((c) => c?.name).filter(Boolean)
        : [],
      derivedKeyIssue: derivedKey,
    };
  } catch (err) {
    console.error(`[enrich] comicvine error: ${err?.message || err}`);
    return null;
  }
};

const CGC_MULTIPLIERS = {
  10: 12.0, 9.9: 8.0, 9.8: 5.0, 9.6: 3.0, 9.4: 2.2, 9.2: 1.8,
  9.0: 1.5, 8.5: 1.3, 8.0: 1.15, 7.5: 1.05, 7.0: 1.0, 6.5: 0.9,
  6.0: 0.85, 5.5: 0.8, 5.0: 0.75, 4.5: 0.7, 4.0: 0.65, 3.5: 0.6,
  3.0: 0.55, 2.5: 0.5, 2.0: 0.45, 1.8: 0.4, 1.5: 0.35, 1.0: 0.3,
  0.5: 0.2,
};

const RAW_MULTIPLIERS = {
  "NM": 1.0, "NM/M": 1.0,
  "VF/NM": 0.85, "VF": 0.75,
  "VF/F": 0.70, "FN/VF": 0.65,
  "FN": 0.55, "VG/FN": 0.50,
  "VG": 0.45, "VG/G": 0.40,
  "GD/VG": 0.35, "GD": 0.30,
  "FR/GD": 0.25, "FR": 0.20,
  "PR": 0.15,
};
const CGC_GRADES = Object.keys(CGC_MULTIPLIERS).map(Number).sort((a, b) => a - b);

const getGradeMultiplier = (grade) => {
  const g = Number(grade);
  if (isNaN(g)) return null;
  if (CGC_MULTIPLIERS[g] != null) return { multiplier: CGC_MULTIPLIERS[g], grade: g };
  let closest = CGC_GRADES[0];
  let minDist = Math.abs(g - closest);
  for (const k of CGC_GRADES) {
    const d = Math.abs(g - k);
    if (d < minDist) { closest = k; minDist = d; }
  }
  return { multiplier: CGC_MULTIPLIERS[closest], grade: closest };
};

// Parse a raw grade string like "VG 4.0" or "FR 1.0" into a multiplier.
// Step 1: extract numeric → find nearest CGC_MULTIPLIERS entry.
// Step 2: extract text abbreviation → look up RAW_MULTIPLIERS.
// Step 3: default 0.75.
const getRawGradeMultiplier = (gradeStr) => {
  if (!gradeStr) return { multiplier: 0.75, label: "RAW" };
  const s = String(gradeStr).trim();

  // Step 1: numeric portion
  const numMatch = s.match(/([\d.]+)/);
  if (numMatch) {
    const g = parseFloat(numMatch[1]);
    if (!isNaN(g) && g >= 0.5 && g <= 10) {
      const info = getGradeMultiplier(g);
      if (info) return { multiplier: info.multiplier, label: s };
    }
  }

  // Step 2: text abbreviation
  const textMatch = s.match(/^([A-Z][A-Z/]*)/i);
  if (textMatch) {
    const abbrev = textMatch[1].toUpperCase().replace(/\s+/g, "");
    if (RAW_MULTIPLIERS[abbrev] != null) {
      return { multiplier: RAW_MULTIPLIERS[abbrev], label: s };
    }
  }

  // Step 3: default
  return { multiplier: 0.75, label: s || "RAW" };
};

const PRICECHARTING_EXCLUDE =
  /facsimile|reprint|homage|variant|walmart|newsstand|mexican|authentix/i;

const lookupPriceCharting = async ({ title, issue, year }) => {
  if (!issue) {
    console.log("[pt] no issue number — skipping");
    return null;
  }
  const token = process.env.PRICECHARTING_TOKEN;
  if (!token || !title) return null;
  try {
    const seriesName = String(title).replace(/#\s*\d+/, "").trim();
    const query = issue ? `${seriesName} ${issue}` : seriesName;
    const url =
      `https://www.pricecharting.com/api/products` +
      `?q=${encodeURIComponent(query)}&type=comic&t=${encodeURIComponent(token)}`;
    console.log(`[pricecharting] query="${query}"`);
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`[pricecharting] HTTP ${res.status}`);
      return null;
    }
    const json = await res.json();
    const products = Array.isArray(json?.products) ? json.products : [];
    if (products.length === 0) return null;

    const issueStr = issue ? String(issue).trim() : null;
    const issueRe = issueStr
      ? new RegExp(`#${issueStr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`)
      : null;

    const comicYear = year ? parseInt(String(year).trim(), 10) : null;

    for (const p of products) {
      const name = p["product-name"] || "";
      if (PRICECHARTING_EXCLUDE.test(name)) continue;
      if (issueRe && !issueRe.test(name)) continue;

      // Year validation: reject products from the wrong era.
      if (comicYear) {
        const yearMatch = name.match(/\((\d{4})\)/);
        const productYear = yearMatch ? parseInt(yearMatch[1], 10) : null;
        if (productYear && Math.abs(productYear - comicYear) > 5) {
          console.log(`[pricecharting] skipping "${name}" — year ${productYear} vs ${comicYear}`);
          continue;
        }
      }

      const cents = p["loose-price"];
      if (cents == null || isNaN(cents) || cents <= 0) continue;
      const price = cents / 100;
      const yearMatch2 = name.match(/\((\d{4})\)/);
      const productYear = yearMatch2 ? parseInt(yearMatch2[1], 10) : null;
      console.log(`[pt] matched: "${name}" year: ${productYear} comic year: ${comicYear}`);
      // Stricter era check: skip if year gap > 5
      if (comicYear && productYear && Math.abs(productYear - comicYear) > 5) {
        console.log(`[pt] year mismatch — skipping`);
        continue;
      }
      return { price, productName: name, id: p.id, year: productYear, source: "pricecharting" };
    }
    console.log(`[pricecharting] no valid match in ${products.length} results`);
    return null;
  } catch (err) {
    console.error(`[pricecharting] error: ${err?.message || err}`);
    return null;
  }
};

const lookupXimilar = async ({ images, title, confidence }) => {
  if (!process.env.XIMILAR_API_TOKEN) return null;
  const rawConfidence = parseFloat(
    String(confidence ?? "").replace(/[^\d.]/g, "")
  );
  const lowConfidence = !isNaN(rawConfidence) && rawConfidence < 75;
  const weakTitle = !title || String(title).trim().length < 3;
  if (!lowConfidence && !weakTitle) return null;
  if (!Array.isArray(images) || images.length === 0) return null;

  try {
    const firstImg = String(images[0] || "");
    const m = firstImg.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/);
    const b64 = m ? m[2] : firstImg.replace(/^data:[^;]+;base64,/, "");

    const res = await fetch(
      "https://api.ximilar.com/collectibles/v2/comics_id",
      {
        method: "POST",
        headers: {
          Authorization: `Token ${process.env.XIMILAR_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ records: [{ _base64: b64 }] }),
      }
    );
    if (!res.ok) {
      console.error(`[enrich] ximilar HTTP ${res.status}`);
      return null;
    }
    const json = await res.json();
    const rec = Array.isArray(json?.records) ? json.records[0] : null;
    const idBlock =
      rec?._identification?.best_match ||
      rec?.best_match ||
      rec?._objects?.[0]?._identification?.best_match ||
      null;
    if (!idBlock) return null;
    const name = idBlock.name || idBlock.full_name || idBlock.title || null;
    const issueNumber =
      idBlock.issue_number || idBlock.issue || idBlock.number || null;
    const publisher = idBlock.publisher || null;
    const year =
      idBlock.year ||
      idBlock.publication_year ||
      (idBlock.publication_date
        ? String(idBlock.publication_date).slice(0, 4)
        : null);
    return {
      name,
      issueNumber,
      publisher,
      year: year ? String(year) : null,
      weakTitle,
    };
  } catch (err) {
    console.error(`[enrich] ximilar error: ${err?.message || err}`);
    return null;
  }
};

const BROWSE_SCOPE = "https://api.ebay.com/oauth/api_scope";

const lookupEbayVisual = async ({ imageBase64, claudeIssue, year }) => {
  // Modern books (1985+): Claude Vision reads issue numbers accurately.
  if (year && parseInt(year, 10) >= 1985) {
    console.log('[visual] modern book — trusting Claude Vision');
    return null;
  }
  const appId = process.env.EBAY_APP_ID;
  const certId = process.env.EBAY_CERT_ID;
  if (!appId || !certId || !imageBase64) return null;
  try {
    const token = await getOAuthToken(appId, certId, BROWSE_SCOPE);
    const url =
      "https://api.ebay.com/buy/browse/v1/item_summary/search_by_image" +
      "?category_ids=63&limit=5";
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
      },
      body: JSON.stringify({ image: imageBase64 }),
    });
    if (!res.ok) {
      console.error(`[visual] eBay image search HTTP ${res.status}`);
      return null;
    }
    const json = await res.json();
    const items = Array.isArray(json?.itemSummaries) ? json.itemSummaries : [];
    if (items.length === 0) return null;

    // Extract issue numbers from titles (1-3 digits only, skip years)
    console.log('[visual] titles:', items.map((r) => r.title));
    const issueNumbers = [];
    for (const item of items) {
      const title = item.title || "";
      const m = title.match(/#(\d{1,3})(?!\d)/);
      if (m && parseInt(m[1], 10) <= 999) issueNumbers.push(m[1]);
    }
    console.log('[visual] extracted issues:', issueNumbers);
    if (issueNumbers.length === 0) return null;

    // Find most common issue number (majority wins)
    const freq = {};
    for (const n of issueNumbers) {
      freq[n] = (freq[n] || 0) + 1;
    }
    let mostCommon = null;
    let maxCount = 0;
    for (const [num, count] of Object.entries(freq)) {
      if (count > maxCount) { mostCommon = num; maxCount = count; }
    }
    console.log('[visual] winner:', mostCommon, `(${maxCount}/${issueNumbers.length})`);

    const claudeStr = claudeIssue ? String(claudeIssue).trim() : null;
    if (maxCount < 3) {
      console.log('[visual] only', maxCount, 'matches — keeping Claude issue:', claudeStr);
      return null;
    }
    if (mostCommon && claudeStr && mostCommon !== claudeStr) {
      console.log(`[visual] Claude=#${claudeStr} eBay=#${mostCommon} → using #${mostCommon}`);
      return { issue: mostCommon, issueSource: "ebay_visual", claudeIssue: claudeStr };
    }
    console.log(`[visual] Claude=#${claudeStr} matches eBay=#${mostCommon || "none"} — keeping Claude`);
    return { issue: claudeStr, issueSource: "claude_vision" };
  } catch (err) {
    console.error(`[visual] eBay image search error: ${err?.message || err}`);
    return null;
  }
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (req.body?.warmup === true) {
    res.status(200).json({ warmed: true });
    return;
  }

  try {
    // Phase timing instrumentation — Buyer mode speed measurement.
    // All offsets are ms relative to handler entry. Logged to Vercel
    // function logs and mirrored onto out.timings for client inspection.
    const startTime = Date.now();
    const t = {};
    const mark = (label) => {
      const ms = Date.now() - startTime;
      t[label] = ms;
      console.log(`[timing] ${label}: ${ms}ms`);
    };
    mark('handler_entry');

    const {
      title,
      issue,
      grade,
      confidence,
      images,
      isGraded,
      numericGrade,
      year,
      publisher: rawPublisher,
      certNumber,
    } = req.body || {};
    // Strip brackets/quotes/slashes before anything downstream sees the
    // publisher — parens in "Hollywood Comics (Walt Disney)" break eBay's
    // query parser and cause ComicVine's substring scoring to miss.
    const publisher = cleanPublisher(rawPublisher) || null;
    const titleLower = (title || "").toLowerCase();
    if (!title || titleLower.includes("not a comic") || titleLower === "unknown") {
      console.log("[enrich] rejected non-comic:", title);
      res.status(400).json({ error: "Not a comic book" });
      return;
    }

    // Prefer explicit issue param, fall back to parsing from title.
    const issueMatch = String(title).match(/#\s*(\d+)/);
    const issueNum = issue || (issueMatch ? issueMatch[1] : null);

    // Step 1: visual issue correction — runs before comps so the
    // corrected issue number flows into all downstream lookups.
    let visualBase64 = null;
    if (Array.isArray(images) && images.length > 0) {
      const firstImg = String(images[0] || "");
      const m = firstImg.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/);
      visualBase64 = m ? m[2] : firstImg.replace(/^data:[^;]+;base64,/, "");
    }
    const visualResult = visualBase64
      ? await lookupEbayVisual({ imageBase64: visualBase64, claudeIssue: issueNum, year }).catch(() => null)
      : null;
    const correctedIssue = (visualResult?.issueSource === "ebay_visual" && visualResult.issue)
      ? visualResult.issue
      : issueNum;

    // Step 2a: run year-independent lookups first so we can derive the
    // confirmed publication year before firing the comps/sold/goCollect
    // queries that use year as a query parameter.
    mark('phase1_start');
    const [comicVine, ximilar, priceCharting, cgcResult] = await Promise.all([
      lookupComicVine({ title, issue: correctedIssue, year, publisher }),
      lookupXimilar({ images, title, confidence }),
      lookupPriceCharting({ title, issue: correctedIssue, year }).catch(() => null),
      certNumber ? lookupCGC(certNumber).catch(() => null) : Promise.resolve(null),
    ]);
    mark('phase1_complete');

    // Derive the confirmed year — trust but verify. PC and CV can return
    // the wrong volume (e.g. ComicVine matched Marvel Super-Heroes vol 2
    // (1980) when user passed 1966 for the King-Size Special). Reject any
    // override that disagrees with the user year by more than ±2y, and
    // never override on era-specific keys (King-Size, Annual, Giant-Size).
    const userYear = year ? parseInt(String(year).trim(), 10) : null;
    const pcYear = priceCharting?.year ? parseInt(priceCharting.year, 10) : null;
    const cvYear = comicVine?.coverDate
      ? parseInt(String(comicVine.coverDate).slice(0, 4), 10)
      : null;
    const pcGap = pcYear && userYear ? Math.abs(userYear - pcYear) : 999;
    const cvGap = cvYear && userYear ? Math.abs(userYear - cvYear) : 999;
    const keyIssueStr = req.body?.keyIssue ? String(req.body.keyIssue) : "";
    const isEraSpecific =
      /silver age|bronze age|king[-\s]?size|giant[-\s]?size|annual|spectacular|first issue/i.test(
        keyIssueStr
      );

    let confirmedYear;
    let yearOverrideRejected = false;
    if (isEraSpecific && userYear) {
      confirmedYear = String(userYear);
      console.log(
        '[enrich] era-specific key — trusting user year:',
        userYear,
        'keyIssue:', keyIssueStr,
        'pc:', pcYear, 'cv:', cvYear
      );
    } else if (pcYear && cvYear && Math.abs(pcYear - cvYear) <= 2) {
      // PC and CV agree (within ±2y) — trust them even if user year differs.
      confirmedYear = String(Math.round((pcYear + cvYear) / 2));
    } else if (pcYear && (!userYear || pcGap <= 2)) {
      confirmedYear = String(pcYear);
    } else if (cvYear && (!userYear || cvGap <= 2)) {
      confirmedYear = String(cvYear);
    } else if (userYear) {
      confirmedYear = String(userYear);
      yearOverrideRejected = true;
      console.log(
        '[enrich] year override REJECTED:',
        'user:', userYear,
        'pc:', pcYear,
        'cv:', cvYear,
        'keeping user year'
      );
    } else {
      confirmedYear = pcYear ? String(pcYear) : (cvYear ? String(cvYear) : year);
    }
    if (confirmedYear && String(confirmedYear) !== String(year || "")) {
      console.log('[enrich] year corrected:', year, '→', confirmedYear);
    }

    // Step 2b: year-dependent lookups using confirmedYear.
    mark('phase2_start');
    const compsPromise =
      process.env.EBAY_APP_ID && process.env.EBAY_CERT_ID
        ? fetchComps({
            title,
            issue: correctedIssue,
            grade,
            isGraded,
            numericGrade,
            year: confirmedYear,
            variant: req.body.variant || null,
            creator: req.body.creator || null,
            publisher: publisher || null,
            appId: process.env.EBAY_APP_ID,
            certId: process.env.EBAY_CERT_ID,
          }).catch((err) => {
            console.error(`[enrich] comps error: ${err?.message || err}`);
            return null;
          })
        : Promise.resolve(null);

    const [compsFromEbay, soldResult, goCollectResult, pcPop] = await Promise.all([
      compsPromise,
      fetchSold({ title, issue: correctedIssue, year: confirmedYear }).catch(() => []),
      lookupGoCollect({ title, issue: correctedIssue, year: confirmedYear, publisher }).catch(() => null),
      priceCharting?.id
        ? fetchPricechartingPop(priceCharting.id, req.body?.grade).catch(() => null)
        : Promise.resolve(null),
    ]);
    mark('comps_fetched');

    // AI verification pass on the comps that will be displayed. Verifies
    // each listing title from rawComps.prices (which carries titles in the
    // same order as recentSales) and filters recentSales by the returned
    // boolean array. Silent fallback: any failure leaves comps unchanged.
    let rawComps = compsFromEbay;
    // Tracks the "AI verify nuked everything" case so the sanity
    // check downstream can skip rather than read compsFromEbay.average
    // (which still holds the contaminated pre-verify mean).
    let compsExhausted = false;
    if (
      rawComps &&
      Array.isArray(rawComps.recentSales) &&
      rawComps.recentSales.length > 0 &&
      Array.isArray(rawComps.prices)
    ) {
      const verifyCount = rawComps.recentSales.length;
      const titlesToVerify = rawComps.prices
        .slice(0, verifyCount)
        .map((p) => p.title || "");
      const issueMatch = String(title).match(/#\s*(\d+)/);
      const issueNum = issueMatch ? issueMatch[1] : null;
      const seriesTitle = issueMatch
        ? String(title).replace(issueMatch[0], "").trim()
        : title;
      mark('ai_verify_start');
      const keepFlags = await verifyCompsTitles({
        title: seriesTitle,
        issue: issueNum,
        year: confirmedYear,
        publisher,
        listings: titlesToVerify,
      });
      mark('ai_verify_complete');
      if (Array.isArray(keepFlags)) {
        const verifiedSales = rawComps.recentSales.filter(
          (_, i) => keepFlags[i]
        );
        const removed = verifyCount - verifiedSales.length;

        // Recompute stats from the verified subset so count, averages,
        // and low/high all reflect the AI-approved comps — no more
        // "count=3 but only 2 rows shown" inconsistency in the UI.
        const verifiedPrices = verifiedSales
          .map((s) => s.price)
          .filter(Boolean);
        const verifiedCount = verifiedPrices.length;
        const verifiedAvg = verifiedCount
          ? verifiedPrices.reduce((a, b) => a + b, 0) / verifiedCount
          : null;
        const verifiedLow = verifiedCount
          ? Math.min(...verifiedPrices)
          : null;
        const verifiedHigh = verifiedCount
          ? Math.max(...verifiedPrices)
          : null;

        // When AI verify partially rejects (>0% but <100%), flag
        // aiVerifyFallback so the sanity check can price against the
        // median of the raw prices. When AI verify rejects 100% of
        // comps, do NOT fall back — those rejected listings are
        // exactly the ones we don't trust (e.g. wrong-book Superman
        // facsimiles surfacing in an Action Comics #1 query). Their
        // median produces high-confidence wrong answers (the $109 /
        // $147,250 class of bug). When 100% rejected, compsExhausted
        // gates the entire sanity block off below.
        const aiVerifyFallback =
          verifiedCount === 0 &&
          Array.isArray(rawComps.prices) &&
          rawComps.prices.length > 0 &&
          verifyCount > 0 &&
          (verifyCount - verifiedCount) / verifyCount < 1.0;

        rawComps = {
          ...rawComps,
          recentSales: verifiedSales,
          count: verifiedCount,
          average: verifiedAvg,
          averageFormatted: fmtUsd(verifiedAvg),
          lowest: verifiedLow,
          lowestFormatted: fmtUsd(verifiedLow),
          highest: verifiedHigh,
          highestFormatted: fmtUsd(verifiedHigh),
          verifiedByAI: true,
          verificationRemoved: removed,
          aiVerifyFallback,
        };
        console.log(
          `[enrich] AI verify: kept ${verifiedCount}/${verifyCount} (removed ${removed})`
        );
        if (removed > 0) {
          const rejectedTitles = titlesToVerify.filter((_, i) => !keepFlags[i]).slice(0, 3);
          console.log('[verify] removed titles:', rejectedTitles);
        }
        if (aiVerifyFallback) {
          console.log('[verify] fallback — 0 verified of', verifyCount,
            ', will use median of', rawComps.prices.length, 'raw comps');
        }
        if (verifiedCount === 0 && verifyCount > 0) {
          compsExhausted = true;
          console.log('[verify] all comps rejected — no comp-based sanity applied');
        }
      }
    }

    // Filter sold comps by issue number before blending — sold results
    // have no title verification, so wrong-issue listings can corrupt the avg.
    let filteredSold = Array.isArray(soldResult) ? soldResult : [];
    if (filteredSold.length > 0 && correctedIssue) {
      const issueRe = new RegExp(
        '#\\s*' + String(correctedIssue).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i'
      );
      const before = filteredSold.length;
      filteredSold = filteredSold.filter(s => issueRe.test(s.title || ''));
      if (filteredSold.length < before) {
        console.log('[sold-filter] kept', filteredSold.length, 'of', before, 'sold comps');
      }
    }

    // Blended average: weight sold comps (60%) + active comps (40%).
    const soldPrices = filteredSold
      .map(s => typeof s.price === 'number' ? s.price : parseFloat(String(s.price || '0').replace(/[$,]/g, '')))
      .filter(p => p > 0);
    const soldAvg = soldPrices.length > 0
      ? soldPrices.reduce((a, b) => a + b, 0) / soldPrices.length
      : null;
    const activeAvg = rawComps?.average || null;
    let blendedAvg = null;
    if (soldAvg && activeAvg) {
      blendedAvg = (soldAvg * 0.6) + (activeAvg * 0.4);
      console.log('[blend] sold:', soldAvg, 'active:', activeAvg, 'blended:', blendedAvg.toFixed(2));
    } else if (soldAvg) {
      blendedAvg = soldAvg * 1.1;
    } else if (activeAvg) {
      blendedAvg = activeAvg;
    }

    const out = {};

    if (comicVine) {
      out.comicVine = comicVine;
    }

    // Key issue: prefer ComicVine structured data, then description-derived,
    // then Claude's keyIssue from /api/grade.
    const cvChars = comicVine?.firstAppearanceCharacters;
    if (Array.isArray(cvChars) && cvChars.length > 0) {
      out.keyIssue = `1st appearance of ${cvChars.join(", ")}`;
    } else if (comicVine?.derivedKeyIssue) {
      out.keyIssue = comicVine.derivedKeyIssue;
    } else if (
      req.body?.keyIssue &&
      req.body.keyIssue !== "N/A" &&
      String(req.body.keyIssue).length > 3
    ) {
      out.keyIssue = req.body.keyIssue;
    } else {
      out.keyIssue = null;
    }

    // Primary price source: PriceCharting (aggregated sold data).
    // For graded comics, apply a CGC multiplier against the raw base price.
    let sanityFired = false;
    // For raw comics, apply a raw grade multiplier against the base price.
    // Fallback: Browse API comps (active listings).
    if (priceCharting) {
      let pc = priceCharting.price;
      if (isGraded === true && numericGrade != null) {
        const gradeInfo = getGradeMultiplier(numericGrade);
        if (gradeInfo) {
          const adjusted = pc * gradeInfo.multiplier;
          out.price = fmtUsd(adjusted);
          out.priceLow = fmtUsd(adjusted * 0.85);
          out.priceHigh = fmtUsd(adjusted * 1.15);
          out.gradeMultiplier = gradeInfo.multiplier;
          out.priceNote = `CGC ${numericGrade} estimate`;
          console.log(
            `[enrich] pricecharting base=$${pc} × ${gradeInfo.multiplier} (CGC ${numericGrade}) = $${adjusted.toFixed(2)}`
          );
        }
      } else {
        // Raw comic: apply grade multiplier from grade string.
        const rawInfo = getRawGradeMultiplier(grade);
        const adjusted = pc * rawInfo.multiplier;
        out.price = fmtUsd(adjusted);
        out.priceLow = fmtUsd(adjusted * 0.75);
        out.priceHigh = fmtUsd(adjusted * 1.25);
        out.gradeMultiplier = rawInfo.multiplier;
        out.priceNote = `${rawInfo.label} estimate`;
        console.log(
          `[enrich] pricecharting base=$${pc} × ${rawInfo.multiplier} (${rawInfo.label}) = $${adjusted.toFixed(2)}`
        );
      }
      out.pricingSource = "pricecharting";

      // Sanity check: compare PC price against blended/eBay comps average.
      // Two skip conditions, both close upstream-of-floor leaks:
      //   1. Mega-keys (MEGA or MANUAL): the floor map is the source
      //      of truth for these books. eBay comps for Golden/Silver
      //      mega-keys are dominated by reprints, facsimiles, and
      //      wrong-book entries (the real books trade at Heritage).
      //      The floor block downstream handles the price decision.
      //   2. compsExhausted: AI verify rejected 100% of comps. Their
      //      median (and `compsFromEbay.average`, which still holds
      //      the pre-verify contaminated mean) is exactly what we
      //      don't trust — using either lets wrong-book prices win.
      //
      // When skipped, PC × grade multiplier remains as `out.price`.
      const isMegaKeyBook = !!getMegaKeyEntry(title, correctedIssue);
      if (isMegaKeyBook) {
        console.log('[sanity] skipped — mega-key uses floor map');
      } else if (compsExhausted) {
        console.log('[sanity] skipped — all comps rejected by AI verify');
      } else {
      // When comps fell back to mixed reprints/variants, OR when AI verify
      // rejected every checked listing, the mean is meaningless — use
      // the median of raw comp prices instead.
      const isMixedFallback = !!(
        rawComps?.reprintFallback ||
        rawComps?.variantFallback ||
        rawComps?.aiVerifyFallback
      );
      const fallbackMedian = isMixedFallback && Array.isArray(rawComps?.prices)
        ? median(rawComps.prices.map((p) => p.price).filter((p) => p > 0))
        : null;
      if (fallbackMedian) {
        console.log('[sanity] mixed fallback — using median',
          fallbackMedian.toFixed(2), 'instead of mean',
          (blendedAvg || compsFromEbay?.average || 0).toFixed(2));
      }
      const compsAvg = fallbackMedian || blendedAvg || compsFromEbay?.average;
      if (compsAvg && compsAvg > 5) {
        const pcNum = parseFloat(
          String(out.price || '0').replace(/[$,]/g, '')
        );

        // Sanity comparison base: raw compsAvg in EVERY case. eBay listings
        // already reflect market grade (sellers grade in the title), so
        // multiplying by out.gradeMultiplier double-counts the grade
        // adjustment — both pcNum (grade-adjusted PC base) and compsAvg
        // (at-grade market) are already at the target grade.
        // CLAUDE.md: "Sanity fallback uses raw compsAvg, not adjAvg."
        const sanityCompsAvg = compsAvg;

        // PC way too high vs market.
        //  - Low comp count (<3 verified): 1.25x — can't trust PC with
        //    only 1-2 comps to validate against.
        //  - Mixed-print / variant / AI-verify fallback: 1.25x.
        //  - Golden (<1970): 3x (volatile, thin markets).
        //  - Silver/Bronze (<1985): 1.75x.
        //  - Modern (1985+): 1.5x — tight, deep eBay markets.
        const bookYear = parseInt(year) || 0;
        const lowCompsCount = (rawComps?.count || 0) < 3;
        const sanityHighMult =
          lowCompsCount ? 1.25 :
          isMixedFallback ? 1.25 :
          bookYear < 1970 ? 3 :
          bookYear < 1985 ? 1.75 :
          1.5;
        if (pcNum > sanityCompsAvg * sanityHighMult) {
          sanityFired = true;
          // Use raw compsAvg — eBay listings already reflect market grade.
          out.price = fmtUsd(compsAvg * 1.15);
          out.priceLow = fmtUsd(compsAvg * 0.75);
          out.priceHigh = fmtUsd(compsAvg * 1.5);
          out.pricingSource = "browse_api";
          out.priceNote = "PC outlier — eBay avg used";
          console.log('[sanity] PC', pcNum,
            '> sanityCompsAvg*' + sanityHighMult, (sanityCompsAvg * sanityHighMult).toFixed(2),
            '→ fallback compsAvg', compsAvg.toFixed(2));
        }

        // PC way too low vs market floor.
        if (!sanityFired && pcNum < sanityCompsAvg * 0.5) {
          sanityFired = true;
          // Use raw compsAvg — eBay listings already reflect market grade.
          out.price = fmtUsd(compsAvg);
          out.priceLow = fmtUsd(compsAvg * 0.75);
          out.priceHigh = fmtUsd(compsAvg * 1.5);
          out.pricingSource = "browse_api";
          out.priceNote = "PC too low — eBay avg used";
          console.log('[sanity] PC', pcNum,
            '< sanityCompsAvg*0.5', (sanityCompsAvg * 0.5).toFixed(2),
            '→ fallback compsAvg', compsAvg.toFixed(2));
        }
      }
      }

      // If sanity check switched to browse_api but comps are actually empty,
      // the priceNote is misleading — clear it.
      if (out.pricingSource === "browse_api" && !(compsFromEbay?.average > 0)) {
        out.priceNote = null;
      }

      // Annotate when the comps set contained only reprints, only variants,
      // or was wiped by AI verify — signals that the avg is imperfect.
      if (out.pricingSource === "browse_api") {
        if (rawComps?.reprintFallback) {
          out.priceNote = "eBay avg (mixed prints)";
        } else if (rawComps?.variantFallback) {
          out.priceNote = "eBay avg (mixed variants)";
        } else if (rawComps?.aiVerifyFallback) {
          out.priceNote = "eBay median (no verified comps)";
        }
      }
      if (rawComps?.reprintFallback) out.reprintFallback = true;
      if (rawComps?.variantFallback) out.variantFallback = true;
      if (rawComps?.aiVerifyFallback) out.aiVerifyFallback = true;
      if (rawComps?.artistFallback) {
        out.artistFallback = true;
        out.compBasis = rawComps.compBasis || 'generic-variant-fallback';
      }

      // Defect penalty: reduce price if Claude detected a significant defect.
      if (req.body.defectPenalty) {
        const pen = parseFloat(req.body.defectPenalty);
        if (pen > 0 && pen < 1) {
          const curPrice = parseFloat(String(out.price || '0').replace(/[$,]/g, ''));
          out.price = fmtUsd(curPrice * pen);
          out.priceLow = fmtUsd(parseFloat(String(out.priceLow || '0').replace(/[$,]/g, '')) * pen);
          out.priceHigh = fmtUsd(parseFloat(String(out.priceHigh || '0').replace(/[$,]/g, '')) * pen);
          out.defectPenalty = pen;
          out.priceNote = (out.priceNote || '') + ' · defect adj';
          console.log(`[enrich] defect penalty ×${pen} applied`);
        }
      }
    } else if (rawComps && rawComps.count > 0) {
      // eBay listings already reflect market grade — do not multiply again.
      const browseBase = rawComps.average || 0;
      let browsePrice = browseBase;

      // Still record gradeMultiplier for downstream (floor guard, etc.)
      // but do NOT apply it to the browse price.
      if (isGraded === true && numericGrade != null) {
        const gInfo = getGradeMultiplier(numericGrade);
        if (gInfo) {
          out.gradeMultiplier = gInfo.multiplier;
          out.priceNote = `CGC ${numericGrade} estimate`;
        }
      } else if (grade) {
        const rawInfo = getRawGradeMultiplier(grade);
        out.gradeMultiplier = rawInfo.multiplier;
        out.priceNote = `${rawInfo.label} estimate`;
      }

      out.price = fmtUsd(browsePrice);
      out.priceLow = fmtUsd(browsePrice * 0.75);
      out.priceHigh = fmtUsd(browsePrice * 1.25);
      out.pricingSource = "browse_api";
    }

    // Surface artistFallback / compBasis for browse_api-only books too
    // (the priceCharting branch already sets these, but not the
    // browse-only branch). Safe to set unconditionally — no-op when the
    // flag is already true.
    if (rawComps?.artistFallback && !out.artistFallback) {
      out.artistFallback = true;
      out.compBasis = rawComps.compBasis || 'generic-variant-fallback';
    }

    // Era-filter bypass flag — set in both pricing branches (PC + browse).
    // Surfaces to UI via out.compEraFilterBypassed so user can be warned
    // that era filter wiped the pool and was skipped as graceful fallback.
    if (rawComps?.eraFilterBypassed) out.compEraFilterBypassed = true;

    // Snapshot pricing source BEFORE floor guard / variant / key blocks.
    // Variant and key multipliers should only apply when the base price
    // came from PriceCharting (not from browse_api or sanity fallback).
    const isFromPC = !!(priceCharting?.price) && !sanityFired && out.pricingSource === 'pricecharting';

    // Floor guard: never price below the lowest eBay comp.
    // eBay comps already reflect market grade — no grade multiplier on floor.
    // Floor is capped at compsAvg to prevent exceeding market.
    //
    // Same skip conditions as the sanity block above (Ship #1 Surface B):
    //   1. Mega-keys: floor map at api/mega-keys.js is the source of
    //      truth. The eBay-comps floor here would override clean PC × mult
    //      with `compsFromEbay.lowest` — for Golden/Silver mega-keys this
    //      is dominated by reprints/facsimiles/wrong-book entries (the
    //      $145K Action #1 from Superman #1 comps class of bug).
    //   2. compsExhausted: AI verify rejected 100% of comps. `rawComps.lowest`
    //      is null but `compsFromEbay.lowest` still holds the pre-verify
    //      contaminated lowest — same untrusted data the sanity block skips.
    let floorNum = 0;
    let floorFired = false;
    const isMegaKeyForFloor = !!getMegaKeyEntry(title, correctedIssue);
    if (isMegaKeyForFloor) {
      console.log('[floor] skipped — mega-key uses floor map');
    } else if (compsExhausted) {
      console.log('[floor] skipped — all comps rejected by AI verify');
    } else {
      const finalNum = parseFloat(
        String(out.price || '0').replace(/[$,]/g, '')
      );
      const rawFloor = rawComps?.lowest || compsFromEbay?.lowest || 0;
      const compsAvgForCap = blendedAvg || compsFromEbay?.average || 0;
      floorNum = rawFloor;
      if (floorNum > compsAvgForCap && compsAvgForCap > 0) {
        floorNum = compsAvgForCap;
        console.log('[floor] capped at comps avg', compsAvgForCap.toFixed(2));
      }

      if (floorNum > 0 && finalNum < floorNum) {
        floorFired = true;
        console.log('[floor] price', finalNum,
          '< floor', floorNum, `(raw ${rawFloor}, cap ${compsAvgForCap})`, '— enforcing');
        out.price = fmtUsd(floorNum);
        out.priceLow = fmtUsd(floorNum * 0.85);
        out.priceHigh = fmtUsd(floorNum * 1.25);
        out.priceNote = (out.priceNote || '') + ' · floor enforced';
      }
    }

    console.log('[price-trace]',
      'pcBase:', priceCharting?.price,
      'multiplier:', out.gradeMultiplier,
      'afterMult:', parseFloat(String(out.price || '0').replace(/[$,]/g, '')),
      'compsAvg:', compsFromEbay?.average,
      'rawFloor:', rawComps?.lowest || 0,
      'floor:', floorNum,
      'floorFired:', floorFired,
      'finalPrice:', out.price,
      'source:', out.pricingSource
    );

    // Variant multiplier: adjust price for known variant types.
    // Only apply when PriceCharting is the pricing source — browse_api/ebay_avg
    // already reflect market for this specific variant.
    const variant = req.body.variant ? String(req.body.variant).trim() : null;
    if (variant && out.price && isFromPC) {
      const NO_PREMIUM = [
        'corner box', 'masterpieces', 'design variant', 'headshot',
        'trading card', 'cover a', 'cover b', 'cover c', 'cover d',
        'marvel legacy', 'legacy',
      ];
      const vLower = variant.toLowerCase();
      const isNoPremium = NO_PREMIUM.some((v) => vLower.includes(v));
      if (isNoPremium) {
        out.variantNote = variant;
        console.log('[variant] no premium — skipping mult');
      } else {
        // Ordered by descending multiplier so the higher-premium match wins
        // when a variant string contains multiple keywords (e.g.
        // "canadian price variant" must hit `canadian price` before
        // `price variant`).
        const variantMultipliers = {
          'triple cover': 10.0,
          'double cover': 8.0,
          '35¢': 6.0,
          '35 cent': 6.0,
          '30¢': 4.0,
          '30 cent': 4.0,
          'inverted': 4.0,
          'gold': 3.0,
          'printing error': 3.0,
          'miscut': 3.0,
          'mark jewelers': 2.5,
          'canadian price': 2.0,
          'price variant': 2.0,
          'type 1a': 2.0,
          'type 1b': 2.0,
          'canadian': 1.8,
          'whitman': 1.8,
          '2nd print': 1.5,
          'second print': 1.5,
          'pence': 1.5,
          'dc universe logo': 1.5,
          'newsstand': 1.3,
        };
        let vMult = null;
        for (const [key, mult] of Object.entries(variantMultipliers)) {
          if (vLower.includes(key)) {
            // Test-market price-variant gate (Ship #9 + #10). Vision
            // labels any 35¢ / 30¢ price box as a test-market variant,
            // but those are also standard cover prices outside the
            // 1976-1977 windows. Only honor the multiplier when
            // (title, issue) is in the canonical allowlist; otherwise
            // fall through and try the next variant key. Pattern
            // extends trivially to Whitman, Mark Jewelers, etc. by
            // adding entries to TEST_MARKET_KEYS + TEST_MARKET_VARIANTS.
            if (key in TEST_MARKET_KEYS) {
              const variantType = TEST_MARKET_KEYS[key];
              if (!isTestMarketVariant(title, correctedIssue, variantType)) {
                console.log(
                  `[variant] ${variantType} allowlist miss — skipping mult`,
                  `title="${normalizeTitle(title)}" issue=${correctedIssue}`
                );
                continue;
              }
              console.log(
                `[variant] ${variantType} test-market match`,
                `title="${normalizeTitle(title)}" issue=${correctedIssue}`
              );
            }
            vMult = mult;
            break;
          }
        }
        if (vMult) {
          const curPrice = parseFloat(String(out.price || '0').replace(/[$,]/g, ''));
          out.price = fmtUsd(curPrice * vMult);
          out.priceLow = fmtUsd(curPrice * vMult * 0.75);
          out.priceHigh = fmtUsd(curPrice * vMult * 1.25);
          out.variantNote = variant;
          out.variantMultiplier = vMult;
          console.log('[variant]', variant, '×', vMult);
        }
      }
    }

    // Key issue multiplier: tiered — major keys ×1.5, minor keys ×1.2.
    // Only apply when PriceCharting is the pricing source — browse_api/ebay_avg
    // already reflect market premium for the key.
    const keyStr = String(out.keyIssue || '').toLowerCase();
    const isMajorKey = keyStr.includes('1st appearance') ||
      keyStr.includes('first appearance') ||
      keyStr.includes('origin') ||
      keyStr.includes('death') ||
      keyStr.includes('first issue');
    const isMinorKey = !isMajorKey && (
      keyStr.includes('2nd appearance') ||
      keyStr.includes('second appearance') ||
      keyStr.includes('2nd') ||
      keyStr.includes('second app') ||
      keyStr.includes('first cover') ||
      keyStr.includes('cameo') ||
      keyStr.includes('iconic') ||
      keyStr.includes('classic')
    );
    const keyMult = isMajorKey ? 1.5 : isMinorKey ? 1.2 : 1.0;
    console.log('[key] keyIssue:', out.keyIssue, 'major:', isMajorKey, 'minor:', isMinorKey, 'mult:', keyMult, 'isFromPC:', isFromPC);
    if (keyMult > 1.0 && out.price && isFromPC && blendedAvg) {
      const curPrice = parseFloat(String(out.price || '0').replace(/[$,]/g, ''));
      if (curPrice > 0) {
        out.price = fmtUsd(curPrice * keyMult);
        out.priceLow = fmtUsd(curPrice * keyMult * 0.75);
        out.priceHigh = fmtUsd(curPrice * keyMult * 1.25);
        out.keyMultiplier = keyMult;
        console.log('[key]', isMajorKey ? 'major' : 'minor', '×' + keyMult, '→', out.price);
      }
    }

    // ═══ MEGA-KEY FLOOR — post-pricing guard (E2) ═══
    // Consulted AFTER all variant/key multipliers. One-way: only raises
    // price, never lowers. Two branches:
    //   MANUAL → flag for manual review; price untouched; listing blocked.
    //   MEGA   → apply floor when current price < floor bucket for grade.
    //   exceedsMap → grade above map coverage; flag for manual review.
    // Schema version stamped on response for K2 rules-version tracking.
    out.megaKeysSchemaVersion = MEGA_KEYS_SCHEMA_VERSION;
    {
      const megaKeyEntry = getMegaKeyEntry(title, correctedIssue);
      if (megaKeyEntry) {
        if (megaKeyEntry.type === 'MANUAL') {
          out.manualReviewRequired = true;
          out.manualReviewReason = megaKeyEntry.volatilityNote ||
            'Mega-key with price dispersion too wide for automated floor';
          out.priceNote = (out.priceNote || '') + ' · manual review required';
          console.log('[mega-key-floor] MANUAL REVIEW:',
            `${title} #${correctedIssue}`, '— no floor applied');
        } else {
          const floorResult = getMegaKeyFloor(
            title, correctedIssue, grade, numericGrade
          );
          if (floorResult.exceedsMap) {
            // Distinct from type=MANUAL: the map simply doesn't cover
            // this grade. Book could be floored if the map were
            // extended. UI surfaces an amber GRADE EXCEEDS MAP badge
            // and suppresses the engine-computed price (same safety
            // gate as MANUAL) so users don't anchor on an unfloored
            // PC/comp number that's typically orders of magnitude
            // below market.
            out.gradeExceedsMap = true;
            out.gradeExceedsMapReason =
              'Grade exceeds floor map coverage — manual review required';
            out.priceNote = (out.priceNote || '') + ' · grade exceeds floor map';
            console.log('[mega-key-floor] EXCEEDS MAP:',
              `${title} #${correctedIssue} grade=${grade}`, '— manual review');
          } else if (floorResult.floor) {
            const currentPriceNum = parseFloat(
              String(out.price || '0').replace(/[$,]/g, '')
            );
            if (currentPriceNum < floorResult.floor) {
              out.preFloorPrice = out.price;
              out.preFloorSource = out.pricingSource || 'fallback';
              out.price = fmtUsd(floorResult.floor);
              out.priceLow = fmtUsd(floorResult.floor);
              out.priceHigh = fmtUsd(floorResult.priceHigh);
              out.megaKeyFloorApplied = true;
              out.megaKeyFloorVerified = megaKeyEntry.verified;
              out.megaKeyFloorSource = megaKeyEntry.source;
              out.megaKeyFloorNote = megaKeyEntry.volatilityNote;
              out.priceNote = (out.priceNote || '') + ' · mega-key floor';
              console.log('[mega-key-floor] enforced:',
                `${title} #${correctedIssue} grade=${grade} bucket=${floorResult.bucket}`,
                `${out.preFloorPrice} → $${floorResult.floor}`,
                megaKeyEntry.verified ? 'VERIFIED' : 'ESTIMATED');
            }
          }
        }
      }
    }

    if (rawComps && rawComps.count > 0) {
      out.comps = {
        count: rawComps.count,
        average: rawComps.averageFormatted,
        averageNum: rawComps.average,
        lowest: rawComps.lowestFormatted,
        lowestNum: rawComps.lowest,
        highest: rawComps.highestFormatted,
        highestNum: rawComps.highest,
        lastSoldDate: rawComps.lastSoldDateFormatted,
        recentSales: rawComps.recentSales,
        query: rawComps.query,
        fellBack: rawComps.fellBack,
        source: rawComps.source,
        verifiedByAI: rawComps.verifiedByAI === true,
        verificationRemoved:
          typeof rawComps.verificationRemoved === "number"
            ? rawComps.verificationRemoved
            : 0,
      };
    }

    // matchConfidence — DISPLAY-only signal scoring how exact our final
    // (post-AI-verify) comp set matches the book. Does NOT influence the
    // pricing math chain. Sourced from the same prices array the UI shows.
    // Falls back to {0, LOW} when comps is empty so the client can render
    // an "AI estimate" badge without special-casing nulls.
    {
      const compTitlesForScore =
        Array.isArray(rawComps?.recentSales) && rawComps.recentSales.length > 0
          ? rawComps.recentSales
          : Array.isArray(rawComps?.prices)
          ? rawComps.prices
          : [];
      const mc = computeMatchConfidence(compTitlesForScore, {
        title: req.body.title || title,
        issue: correctedIssue,
        year: confirmedYear,
        variant: req.body.variant || null,
        creator: req.body.creator || null,
      });
      const fallbackMessage =
        mc.tier === 'HIGH'
          ? 'Verified exact match'
          : mc.tier === 'MEDIUM'
          ? 'Similar matches found'
          : 'Exact match not found — AI estimate';
      const finalMc = {
        ...mc,
        displayMessage: mc.displayMessage || fallbackMessage,
      };

      // Vision-confidence cap. matchConfidence scores how well the comps
      // match the IDENTIFIED book — it can't detect a misidentification
      // (wrong book → matching comps still scores HIGH). Cap the tier and
      // score by Claude Vision's own confidence so a LOW-confidence ID
      // can never surface as "✓ Verified".
      const visionConfidence = String(confidence || 'medium').toLowerCase();
      out.visionConfidence = visionConfidence;

      if (visionConfidence === 'low') {
        if (finalMc.tier === 'HIGH') {
          const originalScore = finalMc.score;
          finalMc.tier = 'MEDIUM';
          finalMc.score = Math.min(finalMc.score, 75);
          finalMc.displayMessage = 'Vision confidence low — verify identification';
          finalMc.visionCapped = true;
          finalMc.originalScore = originalScore;
        } else if (finalMc.tier === 'MEDIUM') {
          finalMc.displayMessage = 'Vision confidence low — verify identification';
          finalMc.visionCapped = true;
        }
      } else if (visionConfidence === 'medium' && finalMc.tier === 'HIGH') {
        finalMc.visionModerate = true;
      }

      out.matchConfidence = finalMc;
      console.log(`[match-conf] score=${finalMc.score} tier=${finalMc.tier} comps=${compTitlesForScore.length} vision=${visionConfidence}${finalMc.visionCapped ? ' CAPPED' : ''}`);
    }

    // Sold comps from eBay completed listings (filtered by issue#)
    out.soldComps = filteredSold;

    // Confidence level — PC data guarantees at least MEDIUM.
    const verifiedCount = rawComps?.count || 0;
    const soldCount = filteredSold.length;
    const hasPCData = out.pricingSource === "pricecharting";
    let confidenceLevel = "LOW";
    if (soldCount >= 2 && verifiedCount >= 2) confidenceLevel = "HIGH";
    else if (verifiedCount >= 2 || soldCount >= 1 || hasPCData) confidenceLevel = "MEDIUM";
    out.confidenceLevel = confidenceLevel;

    // Surface confirmedYear so the client can heal an incorrectly-stored
    // year on the catalogue item (e.g. Claude vision read 2025 but PC /
    // ComicVine agree on 2026). Only flag yearCorrected when the new
    // value actually differs from what the client sent in.
    if (confirmedYear) {
      out.confirmedYear = String(confirmedYear);
      out.yearCorrected = String(confirmedYear) !== String(year || "");
    }
    if (yearOverrideRejected) {
      out.yearOverrideRejected = true;
    }

    // Recommended price
    const recommendedPrice =
      rawComps?.average != null
        ? Math.round(rawComps.average * 1.15)
        : null;

    // [verify] log line
    const seriesTitle = issueMatch
      ? String(title).replace(issueMatch[0], "").trim()
      : title;
    console.log(
      `[verify] ${seriesTitle} #${correctedIssue || "?"} | ` +
      `grade: ${grade || "unknown"} | ` +
      `comps: ${verifiedCount} verified / ${rawComps?.prices?.length || 0} checked | ` +
      `sold: ${soldCount} found | ` +
      `confidence: ${confidenceLevel} | ` +
      `recommended: ${recommendedPrice != null ? "$" + recommendedPrice : "AI est"}`
    );

    if (ximilar) {
      out.ximilar = {
        name: ximilar.name,
        issueNumber: ximilar.issueNumber,
        publisher: ximilar.publisher,
        year: ximilar.year,
      };
      // Only override title if Claude's was weak; never stomp a good title.
      if (ximilar.weakTitle && ximilar.name) {
        out.title = ximilar.issueNumber
          ? `${ximilar.name} #${ximilar.issueNumber}`
          : ximilar.name;
        out.identifiedBy = "ximilar";
      }
    }

    // eBay visual issue cross-validation
    if (visualResult) {
      out.issueSource = visualResult.issueSource;
      if (visualResult.issueSource === "ebay_visual") {
        out.issue = visualResult.issue;
        out.claudeIssue = visualResult.claudeIssue;
      }
    }

    // CGC cert verification override — authoritative data.
    if (cgcResult) {
      if (cgcResult.title) out.title = cgcResult.title;
      if (cgcResult.issue) out.issue = cgcResult.issue;
      if (cgcResult.grade != null) out.grade = cgcResult.grade;
      out.cgcVerified = true;
      out.cgcLabel = cgcResult.labelType || null;
      out.certNumber = cgcResult.certNumber;
    }

    // GoCollect CGC FMV data (null when API key not set)
    if (goCollectResult) {
      out.goCollect = goCollectResult;
    }

    // PriceCharting CGC pop data (Phase 5a.1 — backend only, no UI
    // and no pricing math changes. Null when PC has no product match
    // or the pop_data HTML scrape fails.)
    if (pcPop) {
      out.pop = pcPop;
    }

    // AI verify exhausted all comps — surface so client/UI can
    // indicate "no comp validation" without inventing a number.
    if (compsExhausted) {
      out.compsExhausted = true;
    }

    mark('final_response');
    out.timings = {
      total_ms: Date.now() - startTime,
      phase1_ms: (t.phase1_complete != null && t.phase1_start != null) ? t.phase1_complete - t.phase1_start : null,
      comps_ms: (t.comps_fetched != null && t.phase2_start != null) ? t.comps_fetched - t.phase2_start : null,
      verify_ms: (t.ai_verify_complete != null && t.ai_verify_start != null) ? t.ai_verify_complete - t.ai_verify_start : null,
      marks: t,
    };
    console.log('[timing] summary:', JSON.stringify(out.timings));

    res.status(200).json(out);
  } catch (err) {
    res.status(500).json({ error: err?.message || "Server error" });
  }
}
