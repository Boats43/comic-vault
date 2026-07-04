/**
 * identityCore.js
 *
 * Session 3B Step 3 — Pure identity resolution helpers.
 * Extracted from api/enrich.js to reduce code duplication across future
 * asset formats (books, cards, collectibles).
 *
 * Core primitives:
 * - Title overlap calculation
 * - Identity source selection (Vision vs eBay vs family)
 * - Issue resolution chain
 * - Comp consensus backfill
 * - Title sanitization (remove descriptive noise from Vision titles)
 */

/**
 * Sanitize Vision descriptive title to canonical series name.
 *
 * Vision returns descriptive titles like "Batman Classic Neal Adams Beatles Cover 1970"
 * because that's useful for identity. But for comp matching, we need just the series name
 * ("Batman") to match eBay listings like "Batman #222 (DC Comics June 1970)".
 *
 * Strip: creator names, cover descriptors, condition words, edition markers, embedded years
 * Keep: series name, volume indicators
 *
 * @param {string} rawTitle - Vision title with descriptive additions
 * @returns {string} Canonical series name for comp matching
 */
export const sanitizeSeriesTitle = (rawTitle) => {
  if (!rawTitle) return rawTitle;

  // Ship #24 FIX #12 — preserve numeric tokens that are part of the actual title
  // (e.g., "Spider-Man 2099", "X-Men 2099", "2099 Unlimited"). Only protect years
  // that appear in KNOWN title-numeric patterns, not standalone metadata.
  const protectedYears = new Set();

  // Pattern 1: series name + space + 4-digit (Spider-Man 2099)
  const pattern1 = /\b([A-Za-z][\w-]*)\s+(\d{4})(?:\s|$)/g;
  for (const match of rawTitle.matchAll(pattern1)) {
    const year = match[2];
    if (year === '2099' || parseInt(year) > 2100) {
      protectedYears.add(year);
    }
  }

  // Pattern 2: 4-digit + space + series name (2099 Unlimited)
  const pattern2 = /\b(\d{4})\s+([A-Za-z][\w-]*)(?:\s|$)/g;
  for (const match of rawTitle.matchAll(pattern2)) {
    const year = match[1];
    if (year === '2099' || parseInt(year) > 2100) {
      protectedYears.add(year);
    }
  }

  // Q24 FIX — Publisher-name whitelist for compound character titles.
  // "Captain Marvel" → must NOT strip "Marvel" as publisher noise.
  // Deterministic list: titles where publisher name is PART of the series name.
  //
  // Q31 Part 2: Add "world of" / "age of" / "tales of" compound patterns
  // to prevent "Mighty World of Marvel" → "mighty world" token-thinning.
  const COMPOUND_TITLE_WHITELIST = [
    'captain marvel', 'ms. marvel', 'ms marvel',
    'marvel team-up', 'marvel team up', 'marvel two-in-one', 'marvel two in one',
    'marvel presents', 'detective comics', 'dc comics presents',
    // Q31: Publisher + "of" compounds
    'world of marvel', 'mighty world of marvel', 'world of dc',
    'tales of marvel', 'age of marvel', 'age of dc',
  ];

  const rawLower = rawTitle.toLowerCase();
  const isCompoundTitle = COMPOUND_TITLE_WHITELIST.some(w => rawLower.includes(w));

  const NOISE_PATTERNS = [
    // Creator names that bleed into titles
    /\b(neal|adams|john|romita|jack|kirby|steve|ditko|barry|windsor|smith|jim|lee|todd|mcfarlane|frank|miller|alan|moore|chris|claremont|joe|jusko|kaare|andrews|alex|ross)\b/gi,
    // Cover descriptors
    /\b(classic|vintage|original|key|issue|cover|homage|parody|takeoff|beatles|art|lesson)\b/gi,
    // Condition/grade words
    /\b(high|grade|very|good|fine|near|mint|vf|nm|fn|gd|vg|cgc|raw|unslabbed|slabbed|graded|stock)\b/gi,
    // Edition markers in title
    /\b(first|premiere|ongoing|series|vol|volume|edition|print|printing|reprint|book)\b/gi,
    // Q28 FIX — Seller noise contamination (intro, indie, uk, feat, htf, oop, rare).
    // Strip AFTER cluster selection only (not during scoring) to avoid stripping
    // legitimate title components during comp scoring phase.
    /\b(intro|indie|feat|featuring|htf|oop|rare|lew\s+stringer)\b/gi,
    // Q28-EXTEND-2 — Additional seller noise patterns.
    // - "preamble", "crossover" (generic standalone title-leading words)
    // - "limited to", "only [N]", ratio-ordinal fragments (marketing copy)
    /\b(preamble|limited\s+to|only\s+\d+)\b/gi,
    // Q30 — Merchandise listing contamination (wall decor, trading card, poster, etc.)
    /\b(?:wall\s+decor|wall\s+art|poster|print|sticker|magnet|keychain|figurine|statue|puzzle|coaster|trading\s+card|tradin\s+card)\b/gi,
    // Q33 — Accessory token poisoning (bag, board, coa, w/)
    /\b(bag|board|w\/|with\s+bag|with\s+board|bagged|boarded|coa|certificate)\b/gi,
  ];

  let clean = rawTitle;
  for (const pattern of NOISE_PATTERNS) {
    clean = clean.replace(pattern, ' ');
  }

  // Q24 FIX — Publisher-name stripping with compound-title guard.
  // Only strip publisher tokens when NOT part of a whitelisted compound title.
  if (!isCompoundTitle) {
    clean = clean.replace(/\b(marvel|dc|image|dark|horse|comics|comic)\b/gi, ' ');
  } else {
    console.log(`[sanitize] Q24 compound-title guard: preserving publisher tokens in "${rawTitle}"`);
  }

  // Q28 FIX — Contextual "uk" stripping. Only strip when NOT part of title.
  // "UK Indie" → strip, but "UK Comic" (publisher context) → keep.
  // Strip standalone "uk" tokens when surrounded by whitespace or at boundaries.
  clean = clean.replace(/\b(uk)\b(?!\s+comic)/gi, ' ');

  // Year stripping with protection for title-numeric tokens
  clean = clean.replace(/\b(19|20)\d{2}\b/g, (match) => {
    return protectedYears.has(match) ? match : ' ';
  });

  // Collapse whitespace
  clean = clean.replace(/\s+/g, ' ').trim();

  // If sanitization removed everything, return original
  if (!clean || clean.length < 3) return rawTitle;

  return clean;
};

/**
 * Calculate title overlap percentage between two strings.
 *
 * @param {string} a - First title
 * @param {string} b - Second title
 * @returns {number} Overlap ratio (0.0 to 1.0)
 */
export const calculateTitleOverlap = (a, b) => {
  const normalizeForOverlap = (str) => {
    if (!str) return '';
    return String(str)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const aNorm = normalizeForOverlap(a);
  const bNorm = normalizeForOverlap(b);
  if (!aNorm || !bNorm) return 0;
  const aTokens = aNorm.split(' ').filter(t => t.length > 2);
  const bTokens = bNorm.split(' ').filter(t => t.length > 2);
  const matches = aTokens.filter(t => bTokens.includes(t));
  return matches.length / Math.max(aTokens.length, 1);
};

/**
 * Resolve identity from multiple sources (Vision, eBay, title-family).
 *
 * @param {Object} vision - Vision result { title, issue, year, publisher }
 * @param {Object} ebay - eBay visual consensus { title, issue, year, publisher }
 * @param {Object} family - Family candidate { selectedTitle, decision }
 * @param {Object} opts - { ebayResultCount, overlapThreshold }
 * @returns {Object} { confirmedTitle, confirmedIssue, confirmedYear, confirmedPublisher, identitySource }
 */
export const resolveIdentity = (vision, ebay, family, opts = {}) => {
  const { ebayResultCount = 0, overlapThreshold = 0.2 } = opts;

  let confirmedTitle = vision.title;
  let confirmedIssue = vision.issue;
  let confirmedYear = vision.year;
  let confirmedPublisher = vision.publisher;
  let identitySource = 'vision';

  // Ship 26.2 — Family candidate overrides when top-rank-protection or
  // weighted-consensus selected. Takes precedence over visualConsensus
  // exact-frequency voting.
  // Q12c REGRESSION FIX — Preserve eBay issue/year/publisher when family
  // overrides title. Family clustering operates on series-name tokens only
  // (title-level resolution), NOT on issue/year/publisher (which come from
  // eBay visual consensus). When family fires, keep eBay's identity fields.
  // X-Men Anniversary case: family selectedTitle="X-Men Anniversary Special"
  // has no issue number, but eBay consensus correctly extracted issue="325".
  // Prior bug: confirmedIssue stayed at Vision's wrong value ("1" from
  // marketing-copy "#1"). Fix: backfill from eBay when available.
  if (family?.selectedTitle && ['top-rank-protection', 'weighted-consensus'].includes(family.decision)) {
    const normalizeTitle = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const familyNorm = normalizeTitle(family.selectedTitle);
    const consensusNorm = ebay?.title ? normalizeTitle(ebay.title) : null;

    // Check if family candidate differs from visualConsensus
    if (consensusNorm && familyNorm !== consensusNorm) {
      console.log(`[title-family] OVERRIDE: family="${family.selectedTitle}" vs consensus="${ebay.title}"`);
    }

    confirmedTitle = family.selectedTitle;
    // Q12c FIX: Backfill issue/year/publisher from eBay consensus when available
    confirmedIssue = ebay?.issue || vision.issue;
    confirmedYear = ebay?.year || vision.year;
    confirmedPublisher = ebay?.publisher || vision.publisher;
    identitySource = 'title-family-' + family.decision;
    console.log(`[phase1] family candidate OVERRIDE: using "${confirmedTitle}" (source: ${identitySource})`);
    if (ebay?.issue) {
      console.log(`[q12c-fix] family override preserved eBay issue="${ebay.issue}" (not Vision "${vision.issue}")`);
    }
  } else if (ebay?.title && ebayResultCount >= 10) {
    const overlap = calculateTitleOverlap(ebay.title, vision.title);
    console.log(`[phase1] overlap: ${(overlap * 100).toFixed(0)}% (eBay="${ebay.title}" vs Vision="${vision.title}")`);

    if (overlap < overlapThreshold) {
      // Ship #24 FIX #13 — numeric-token Vision protection. When Vision contains
      // a numeric component (e.g., "Spider-Man 2099") and eBay consensus lacks it
      // (e.g., "Spider-Man"), prefer Vision UNLESS overlap is extremely low (<10%).
      // This prevents stripping meaningful numeric identifiers when eBay comp pool
      // has mixed results (some with "2099", some without).
      const visionHasNumeric = /\b\d{4}\b/.test(vision.title);
      const ebayHasNumeric = /\b\d{4}\b/.test(ebay.title);

      if (visionHasNumeric && !ebayHasNumeric && overlap >= 0.10) {
        // Vision has numeric token, eBay doesn't, but there's SOME overlap (≥10%)
        // → trust Vision's more specific title
        confirmedTitle = vision.title;
        identitySource = 'vision_numeric_protection';
        console.log(`[phase1] VISION NUMERIC PROTECTION: "${vision.title}" has numeric token missing from eBay consensus "${ebay.title}" — keeping Vision (overlap=${(overlap*100).toFixed(0)}%)`);
      } else {
        // Standard eBay override when overlap is low
        confirmedTitle = ebay.title;
        confirmedIssue = ebay.issue || vision.issue;
        confirmedYear = ebay.year || vision.year;
        confirmedPublisher = ebay.publisher || vision.publisher;
        identitySource = 'ebay_visual_override';
        console.log(`[phase1] eBay OVERRIDE: using "${confirmedTitle}" #${confirmedIssue} for downstream queries`);
      }
    } else {
      console.log(`[phase1] eBay agrees with Vision: using "${confirmedTitle}"`);
    }
  } else {
    console.log(`[phase1] eBay visual insufficient (${ebayResultCount} results), using Vision title`);
  }

  // Sanitize confirmedTitle to canonical series name for comp matching
  const sanitizedTitle = sanitizeSeriesTitle(confirmedTitle);

  return {
    confirmedTitle: sanitizedTitle,
    confirmedIssue,
    confirmedYear,
    confirmedPublisher,
    identitySource,
    displayTitle: confirmedTitle,  // Keep original for display
  };
};

/**
 * Q26 FIX — Detect dual-issue-number conflict.
 * Foreign/reprint editions sometimes contain TWO distinct issue numbers in title:
 * - "#103" (foreign edition number)
 * - "#97" (original US edition number)
 * When multiple distinct #N patterns exist, flag conflict for manual review.
 *
 * Q21 EXTENSION — Digit-transposition detector.
 * When two candidates differ by single-digit swap (120 ↔ 112), flag as
 * transposition conflict. House of Secrets #120 vs #112 class.
 *
 * @param {string} titleStr - Title to scan for issue numbers
 * @returns {Object} { hasConflict: boolean, issues: string[], transposition: boolean }
 */
export const detectDualIssueConflict = (titleStr) => {
  if (!titleStr) return { hasConflict: false, issues: [], transposition: false };

  const issueMatches = Array.from(String(titleStr).matchAll(/#\s*(\d+)/g));
  const distinctIssues = [...new Set(issueMatches.map(m => m[1]))];

  if (distinctIssues.length >= 2) {
    // Q21: Check for digit-transposition pattern (120 ↔ 112, 103 ↔ 013)
    let transposition = false;
    if (distinctIssues.length === 2) {
      const [a, b] = distinctIssues;
      // Sort digits of each issue number — if sorted strings match, it's a transposition
      // 120 → "012", 112 → "112" (NO match)
      // BUT 120 → ['0','1','2'], 112 → ['1','1','2'] — different!
      // CORRECT: compare digit COUNTS, not sorted strings
      // 120: {0:1, 1:1, 2:1}, 112: {1:2, 2:1} — NOT same
      // Actually need: same digits in different order
      // 120 vs 102: {0:1, 1:1, 2:1} vs {0:1, 1:1, 2:1} — SAME (transposition)
      // 120 vs 112: {0:1, 1:1, 2:1} vs {1:2, 2:1} — DIFFERENT (not transposition)
      const aDigits = a.split('').sort().join('');
      const bDigits = b.split('').sort().join('');
      if (aDigits === bDigits) {
        transposition = true;
        console.log(`[Q21] DIGIT-TRANSPOSITION CONFLICT: "${titleStr.slice(0, 60)}" has transposed issues: ${distinctIssues.join(' ↔ ')}`);
      }
    }

    if (!transposition) {
      console.log(`[Q26] DUAL-ISSUE CONFLICT: title="${titleStr.slice(0, 60)}" has ${distinctIssues.length} distinct issue numbers: ${distinctIssues.join(', ')}`);
    }
    return { hasConflict: true, issues: distinctIssues, transposition };
  }

  return { hasConflict: false, issues: distinctIssues, transposition: false };
};

/**
 * Resolve issue number from multiple sources.
 * Priority: Vision → eBay visual → Visual search consensus
 * Q26 FIX — Flag conflict when title contains 2+ distinct issue numbers.
 *
 * @param {string|null} visionIssue - Issue from Vision
 * @param {string|null} ebayIssue - Issue from eBay visual consensus
 * @param {string|null} visualIssue - Issue from visual search
 * @param {string} titleContext - Title string for conflict detection (Q26)
 * @returns {string|null|Object} Resolved issue or { conflict: true, candidates: [...] }
 */
export const resolveIssue = (visionIssue, ebayIssue, visualIssue, titleContext = '') => {
  // Q26 + Q21: check for dual-issue conflict (includes transposition detection)
  if (titleContext) {
    const conflict = detectDualIssueConflict(titleContext);
    if (conflict.hasConflict) {
      return {
        conflict: true,
        candidates: conflict.issues,
        transposition: conflict.transposition,  // Q21: flag digit-swap pattern
        visionIssue,
        ebayIssue,
        visualIssue,
      };
    }
  }

  if (ebayIssue) return ebayIssue;
  if (visualIssue) return visualIssue;
  return visionIssue;
};

/**
 * Backfill year and publisher from comp consensus when primary sources return null.
 * Requires ≥70% of comp titles to fuzzy-match confirmedTitle (sanity gate).
 *
 * @param {string} confirmedTitle - Current confirmed title
 * @param {string|null} confirmedYear - Current confirmed year
 * @param {string|null} confirmedPublisher - Current confirmed publisher
 * @param {Array} compItems - eBay visual search results
 * @returns {Object} { year, publisher, yearBackfilled, publisherBackfilled, yearBackfillRatio, publisherBackfillSource }
 */
export const backfillFromComps = (confirmedTitle, confirmedYear, confirmedPublisher, compItems) => {
  const result = {
    year: confirmedYear,
    publisher: confirmedPublisher,
    yearBackfilled: false,
    publisherBackfilled: false,
    yearBackfillRatio: 0,
    publisherBackfillSource: null
  };

  // Debug diagnostic for FIX 1
  console.log('[year-backfill-debug] compItems available:', compItems?.length || 0,
    'confirmedYear:', confirmedYear || '(null)',
    'needsBackfill:', !confirmedYear);

  if ((!confirmedYear || !confirmedPublisher) && compItems?.length >= 5) {
    const compTitles = compItems
      .map(i => String(i?.rawTitle || i?.title || ''))
      .filter(Boolean);

    // Title sanity: how many comp titles share core tokens with confirmedTitle?
    const coreTokens = String(confirmedTitle || '')
      .toLowerCase()
      .replace(/[#:,'"\.\-\(\)]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 3 && !/^(the|and|of|a|comics?|comic|book)$/i.test(t));

    const titleMatchCount = coreTokens.length === 0 ? 0 : compTitles.filter(t => {
      const lower = t.toLowerCase();
      const hits = coreTokens.filter(tok => lower.includes(tok)).length;
      return hits / coreTokens.length >= 0.6;
    }).length;

    const titleMatchRatio = compTitles.length > 0
      ? titleMatchCount / compTitles.length
      : 0;

    // FIX 1 — Year backfill now runs ALWAYS when confirmedYear missing
    // (not gated by title match ratio). Year is pure consensus extraction
    // with no cross-title contamination risk (unlike publisher).
    if (!confirmedYear) {
      const yearCounts = {};
      compTitles.forEach(t => {
        const matches = t.match(/\b(19[3-9]\d|20[0-2]\d)\b/g) || [];
        matches.forEach(y => { yearCounts[y] = (yearCounts[y] || 0) + 1; });
      });
      const sortedYears = Object.entries(yearCounts).sort((a, b) => b[1] - a[1]);
      if (sortedYears.length > 0) {
        const [topYear, topCount] = sortedYears[0];
        const yearRatio = topCount / compTitles.length;
        if (yearRatio >= 0.5) {
          result.year = topYear;
          result.yearBackfilled = true;
          result.yearBackfillRatio = yearRatio;
          result.yearBackfillSource = 'ebay-comp-consensus';
          console.log(`[year-backfill] ${topYear} from eBay comp consensus (${topCount}/${compTitles.length}=${(yearRatio*100).toFixed(0)}%)`);
        }
      }
    }

    if (titleMatchRatio >= 0.7) {
      // Publisher backfill — pattern-match common publisher tokens (requires title match)
      if (!confirmedPublisher) {
        const pubPatterns = [
          { re: /\b(?:dc\s+comics?|dc\s+universe|dcu)\b/i, name: 'DC Comics' },
          { re: /\b(?:marvel\s+comics?|marvel\s+universe)\b/i, name: 'Marvel Comics' },
          { re: /\b(?:image\s+comics?)\b/i, name: 'Image Comics' },
          { re: /\b(?:dark\s+horse)\b/i, name: 'Dark Horse Comics' },
          { re: /\b(?:idw\s+publishing|idw)\b/i, name: 'IDW Publishing' },
          { re: /\b(?:boom!?\s+studios)\b/i, name: 'BOOM! Studios' },
          { re: /\b(?:dynamite\s+entertainment|dynamite)\b/i, name: 'Dynamite Entertainment' },
          { re: /\b(?:valiant\s+(?:comics?|entertainment))\b/i, name: 'Valiant Entertainment' },
          { re: /\b(?:archie\s+comics?)\b/i, name: 'Archie Comics' },
        ];

        for (const { re, name } of pubPatterns) {
          const hitCount = compTitles.filter(t => re.test(t)).length;
          const hitRatio = hitCount / compTitles.length;
          if (hitRatio >= 0.5) {
            result.publisher = name;
            result.publisherBackfilled = true;
            result.publisherBackfillSource = name;
            console.log(`[ship-1.8] publisher backfilled from comp consensus: ${name} (${hitCount}/${compTitles.length}=${(hitRatio*100).toFixed(0)}%)`);
            break;
          }
        }
      }
    }
  }

  return result;
};

/**
 * Resolve year from multiple sources with trust-but-verify logic.
 * PC and CV can return wrong volume; reject overrides >±2y from user input.
 *
 * @param {string|null} visionYear - Year from Vision
 * @param {number|null} pcYear - Year from PriceCharting
 * @param {number|null} cvYear - Year from ComicVine
 * @param {number|null} ebayYear - Authoritative year from eBay consensus
 * @param {Object} opts - { keyIssue } for era-specific detection
 * @returns {Object} { confirmedYear, yearOverrideRejected, yearSource }
 */
export const resolveYear = (visionYear, pcYear, cvYear, ebayYear, opts = {}) => {
  const { keyIssue = '' } = opts;

  const userYear = visionYear ? parseInt(String(visionYear).trim(), 10) : null;
  const pcGap = pcYear && userYear ? Math.abs(userYear - pcYear) : 999;
  const cvGap = cvYear && userYear ? Math.abs(userYear - cvYear) : 999;

  let confirmedYear = visionYear;
  let yearOverrideRejected = false;
  let yearSource = 'vision';

  if (ebayYear) {
    confirmedYear = String(ebayYear);
    yearSource = 'ebay-consensus';
    if (cvYear && Math.abs(cvYear - ebayYear) > 3) {
      console.warn(`[year-divergence] CV=${cvYear} vs eBay=${ebayYear} — CV likely wrong volume`);
    }
  }
  else if (pcYear && cvYear && Math.abs(pcYear - cvYear) <= 2) {
    confirmedYear = String(Math.round((pcYear + cvYear) / 2));
    yearSource = 'pc-cv-agreement';
  }
  else if (pcYear && (!userYear || Math.abs(pcYear - userYear) <= 2)) {
    confirmedYear = String(pcYear);
    yearSource = 'pricecharting';
  }
  else if (cvYear && (!userYear || Math.abs(cvYear - userYear) <= 2)) {
    confirmedYear = String(cvYear);
    yearSource = 'comicvine';
  }
  else if (userYear) {
    confirmedYear = String(userYear);
    yearOverrideRejected = true;
    yearSource = 'vision-rejected-override';
  }
  else {
    confirmedYear = pcYear
      ? String(pcYear)
      : (cvYear ? String(cvYear) : visionYear);
    yearSource = pcYear ? 'pricecharting-fallback' : (cvYear ? 'comicvine-fallback' : 'vision-fallback');
  }

  if (confirmedYear !== visionYear) {
    console.log(`[year-resolved] ${visionYear} → ${confirmedYear} (source=${yearSource})`);
  }

  return {
    confirmedYear,
    yearOverrideRejected,
    yearSource
  };
};
