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
 *
 * Ship #22e: Assembly integrity check (Q54 compounds survive final title)
 */

import { COMPOUND_WHITELIST, REPRINT_RE } from './compHygiene.js';

/**
 * EX-7 — reprint/facsimile dominance in the eBay visual (image-search) pool.
 *
 * Same ratio + threshold Q98 already established for the polybag facsimile
 * signal (api/enrich.js ~line 3966: itemsWithPrice filtered from the raw
 * image-search pool, REPRINT_RE tested against rawTitle, >=0.6 = dominant).
 * Q98 ruled that ratio "informational only, never a pricing veto" for
 * famous-cover confounds (a cover-image search on Giant-Size X-Men #1 /
 * X-Men #1 always comes back facsimile-dominated regardless of what the
 * user is actually holding). The same confound applies to identity: a
 * reprint-dominant pool can carry a DIFFERENT marketing issue number than
 * the original (True Believers reprints always renumber to #1 regardless
 * of source issue) — so it must not be trusted to arbitrate Vision's issue
 * either. Reused (not reinvented) here so the zero-support override can
 * defer to it.
 *
 * @param {Array} items - raw eBay image-search pool (rawTitle, price fields)
 * @param {Object} opts - { minItems = 5 }
 * @returns {number|null} ratio in [0,1], or null when pool is too thin to judge (<minItems priced items)
 */
export const computeReprintDominanceRatio = (items, { minItems = 5 } = {}) => {
  if (!Array.isArray(items)) return null;
  const itemsWithPrice = items.filter((i) => typeof i?.price === 'number' && i.price > 0);
  if (itemsWithPrice.length < minItems) return null;
  const reprintCount = itemsWithPrice.filter((i) => REPRINT_RE.test(String(i?.rawTitle || ''))).length;
  return reprintCount / itemsWithPrice.length;
};

// Same threshold Q98 established for the polybag facsimile signal.
export const REPRINT_DOMINANCE_THRESHOLD = 0.6;

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
 * Q70 FIX — Route through Q54 COMPOUND_WHITELIST FIRST before regex stripping.
 * Vision path was bypassing compound protection, causing "X-Men" → "Men" / "Uncanny X-Men" → "Uncanny Men".
 *
 * @param {string} rawTitle - Vision title with descriptive additions
 * @returns {string} Canonical series name for comp matching
 */
export const sanitizeSeriesTitle = (rawTitle) => {
  if (!rawTitle) return rawTitle;

  // Q70 — Strip leading articles BEFORE compound whitelist check
  const rawLower = rawTitle.toLowerCase().trim();
  const bareTitle = rawLower.replace(/^(?:the|a|an)\s+/i, '');

  // Q70 — Q54 COMPOUND_WHITELIST protection FIRST (before regex stripping)
  // Prevents "X-Men" → "Men", "Marvel Tales" → "Tales" when regex strips "x" or "marvel"
  // Prefix matching: "x-men angel" starts with "x-men " → return "X-Men" verbatim
  const protectedHit = Array.from(COMPOUND_WHITELIST).find(entry =>
    bareTitle === entry || bareTitle.startsWith(entry + ' ')
  );

  if (protectedHit) {
    // Q70 — Extract ONLY the protected compound from the title, drop trailing noise
    // "The X-Men Angel Red Raven #44" → "X-Men" (strips "Angel Red Raven")
    const protectedPortion = rawTitle.slice(
      rawTitle.toLowerCase().indexOf(protectedHit),
      rawTitle.toLowerCase().indexOf(protectedHit) + protectedHit.length
    );
    console.log(`[Q70] compound-protected: "${rawTitle}" → "${protectedPortion}" (matched "${protectedHit}")`);
    return protectedPortion;
  }

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
 * Check if Q54-protected compound tokens survive in final assembled title.
 *
 * Ship #22e: Assembly integrity check. E3 class protection.
 * When Q54 protects ["x", "men"] during tokenization but final assembly
 * drops "x" → "men timeless", this detects the failure and forces Vision
 * title fallback.
 *
 * B1 (22e-LOSS): Combined rule — checks BOTH missing Vision tokens AND
 * excessive token additions from eBay consensus. Evidence: "x men" #2 →
 * assembled="men" (missing "x"); Spawn #6 → "spawn lot and" (2 added tokens
 * not in comps). Forces Vision when (a) ANY Vision token missing OR (b) ≥2
 * tokens added that don't appear in ≥60% of comp titles.
 *
 * @param {string} visionTitle - Original Vision title (most likely to preserve compound)
 * @param {string} assembledTitle - Final confirmedTitle after source assembly
 * @param {Array<string>} compTitles - Array of comp titles for consensus check (optional)
 * @returns {Object} { intact, missing, added, shouldFallback, reason }
 */
export const checkAssemblyIntegrity = (visionTitle, assembledTitle, compTitles = []) => {
  if (!visionTitle || !assembledTitle) {
    return { intact: true, missing: [], added: [], shouldFallback: false, reason: null };
  }

  const normalizeForIntegrity = (str) => String(str || '').toLowerCase()
    .replace(/#\s*\d+/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:the|a|an)\s+/i, '');

  const visionNorm = normalizeForIntegrity(visionTitle);
  const assembledNorm = normalizeForIntegrity(assembledTitle);

  const visionTokens = visionNorm.split(/\s+/).filter(Boolean);
  const assembledTokens = assembledNorm.split(/\s+/).filter(Boolean);

  // Rule 1: Check for missing Vision tokens (original 22e logic)
  const missing = visionTokens.filter(t => !assembledTokens.includes(t));

  if (missing.length > 0) {
    // Q-TITLE-ZERO-SUPPORT — same principle as the issue-number zero-support
    // fix (resolveIdentity): a missing token forces Vision back UNLESS every
    // missing token is itself unsupported anywhere in the pool AND the
    // assembled title is independently pool-corroborated. Distinguishes an
    // assembly bug dropping a real, pool-attested compound (X-Men #44 Angel
    // class — "x-men" IS attested in the pool, force Vision as before) from
    // Vision's own unsupported token being correctly replaced by a coherent
    // pool consensus (Spider-Versity class — "spider-verse" has ZERO pool
    // support, defer to pool instead of forcing Vision's wrong read back).
    let zeroSupportDefer = false;
    if (compTitles.length >= 3) {
      const compTokenSets = compTitles.map((ct) =>
        new Set(normalizeForIntegrity(ct).split(/\s+/).filter(Boolean))
      );
      const allMissingZeroSupport = missing.every(
        (tok) => compTokenSets.filter((set) => set.has(tok)).length === 0
      );

      if (allMissingZeroSupport) {
        // Reuse Rule 2's exact consensus bar (>=60% of compTitles) applied
        // to assembled's OWN substantive tokens — proves assembled isn't a
        // random artifact, just a title the pool independently backs.
        const substantiveAssembled = assembledTokens.filter((t) => t.length >= 3);
        const assembledSupported =
          substantiveAssembled.length > 0 &&
          substantiveAssembled.every((tok) => {
            const count = compTokenSets.filter((set) => set.has(tok)).length;
            return count / compTitles.length >= 0.60;
          });

        if (assembledSupported) {
          zeroSupportDefer = true;
          console.log(
            `[22e-ZERO-SUPPORT] missing Vision token(s) [${missing.join(',')}] have ZERO pool support ` +
            `(${compTitles.length} comps) — assembled="${assembledTitle}" IS pool-corroborated — ` +
            `deferring to pool, not forcing Vision`
          );
        }
      }
    }

    if (!zeroSupportDefer) {
      console.log(
        `[22e-LOSS] FAIL: missing Vision tokens — ` +
        `vision=[${visionTokens.join(',')}] ` +
        `assembled=[${assembledTokens.join(',')}] ` +
        `missing=[${missing.join(',')}]`
      );
      return { intact: false, missing, added: [], shouldFallback: true, reason: 'missing-vision-tokens' };
    }
  }

  // Rule 2: Check for excessive token additions (B1 new logic)
  // Only run when comp titles available for consensus validation
  if (compTitles.length >= 3) {
    const added = assembledTokens.filter(t => !visionTokens.includes(t));

    if (added.length >= 2) {
      // Check if added tokens appear in ≥60% of comp titles
      const compConsensusMap = new Map();
      compTitles.forEach(ct => {
        const ctTokens = normalizeForIntegrity(ct).split(/\s+/).filter(Boolean);
        added.forEach(token => {
          if (ctTokens.includes(token)) {
            compConsensusMap.set(token, (compConsensusMap.get(token) || 0) + 1);
          }
        });
      });

      const nonConsensusTokens = added.filter(token => {
        const count = compConsensusMap.get(token) || 0;
        const ratio = count / compTitles.length;
        return ratio < 0.60; // Not in ≥60% of comps
      });

      if (nonConsensusTokens.length >= 2) {
        console.log(
          `[22e-LOSS] FAIL: excess non-consensus tokens — ` +
          `vision="${visionTitle}" assembled="${assembledTitle}" ` +
          `added=[${added.join(',')}] non-consensus=[${nonConsensusTokens.join(',')}]`
        );
        return {
          intact: false,
          missing: [],
          added: nonConsensusTokens,
          shouldFallback: true,
          reason: 'excess-non-consensus-tokens'
        };
      }
    }
  }

  // Original compound whitelist protection (preserved for backward compat)
  const protectedCompound = Array.from(COMPOUND_WHITELIST).find(entry =>
    visionNorm === entry || visionNorm.startsWith(entry + ' ')
  );

  if (protectedCompound) {
    const protectedTokens = protectedCompound.replace(/-/g, ' ').split(/\s+/).filter(Boolean);
    const compoundMissing = protectedTokens.filter(t => !assembledTokens.includes(t));

    if (compoundMissing.length > 0) {
      console.log(
        `[assembly-integrity] FAIL: compound="${protectedCompound}" ` +
        `protected=[${protectedTokens.join(',')}] ` +
        `final=[${assembledTokens.join(',')}] ` +
        `missing=[${compoundMissing.join(',')}]`
      );
      return {
        intact: false,
        missing: compoundMissing,
        added: [],
        shouldFallback: true,
        reason: 'compound-protection'
      };
    }
    console.log(`[assembly-integrity] PASS: compound="${protectedCompound}" intact`);
  }

  return { intact: true, missing: [], added: [], shouldFallback: false, reason: null };
};

// Generic publisher/franchise words that pass on nearly every comic and
// don't discriminate between products — filtered out of the PC-match
// overlap check below so e.g. "comics"/"the" don't inflate the ratio.
const PC_MATCH_COMMON_TOKENS = new Set([
  'marvel', 'dc', 'image', 'idw', 'comics', 'comic',
  'book', 'the', 'a', 'an', 'of', 'and', 'in', 'for',
  'dark', 'horse', 'boom', 'archie', 'dynamite',
]);

/**
 * Q-PC-REQUERY-GATE — does a PriceCharting product name still adequately
 * represent our confirmed identity?
 *
 * Replaces a prior "shares one token" heuristic that only checked whether
 * confirmedTitle's FIRST tokenized word appeared anywhere in productName.
 * Franchise titles sharing a common lead word (Spider-Man / Spider-Verse /
 * Spider-Versity / Spider-Woman / Spider-Gwen all start with "spider")
 * always passed that check regardless of which product PC actually
 * matched — Spider-Versity class: confirmedTitle "Amazing Spider Versity"
 * vs PC match "Spider-Verse ... Camuncoli Variant" shared "spider" and
 * wrongly passed. This checks the MAJORITY of confirmedTitle's substantive
 * tokens, not just the first.
 *
 * @param {string} confirmedTitle - our current, fully-resolved identity
 * @param {string} productName - PriceCharting's matched product name
 * @param {number} threshold - minimum overlap ratio (default 0.5 — this is
 *   a single-title-vs-single-product comparison, not pool-internal
 *   consensus, so it uses the existing top-rank-guard forwardRatio
 *   convention rather than the stricter 0.6 pool-consensus bar used
 *   elsewhere in this file)
 * @returns {boolean} true when productName sufficiently represents confirmedTitle
 */
export const titleOverlapsProduct = (confirmedTitle, productName, threshold = 0.5) => {
  const tokenize = (s) => String(s || '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !PC_MATCH_COMMON_TOKENS.has(t));

  const confirmedTokens = tokenize(confirmedTitle);
  if (confirmedTokens.length === 0) return true; // nothing substantive to check against

  const productTokens = tokenize(productName);
  const overlapCount = confirmedTokens.filter((t) => productTokens.includes(t)).length;
  return (overlapCount / confirmedTokens.length) >= threshold;
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
  const { ebayResultCount = 0, overlapThreshold = 0.2, isGraded = false } = opts;

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

    // Q40: Sanitize family.selectedTitle before storage to prevent RAW eBay listing
    // contamination ("avengers henry pym last stand egghead she thor disney" etc.)
    const rawFamilyTitle = family.selectedTitle;
    const sanitizedFamilyTitle = sanitizeSeriesTitle(rawFamilyTitle);

    confirmedTitle = sanitizedFamilyTitle;
    // Q12c FIX: Backfill issue/year/publisher from eBay consensus when available
    confirmedIssue = ebay?.issue || vision.issue;
    confirmedYear = ebay?.year || vision.year;
    confirmedPublisher = ebay?.publisher || vision.publisher;
    identitySource = 'title-family-' + family.decision;
    console.log(`[phase1] family candidate OVERRIDE: using "${confirmedTitle}" (source: ${identitySource})`);
    if (rawFamilyTitle !== sanitizedFamilyTitle) {
      console.log(`[q40] family title sanitized: "${rawFamilyTitle}" → "${sanitizedFamilyTitle}"`);
    }
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

  // P0 (Q-VISION-ZERO-SUPPORT) — Vision "confidently wrong" issue override.
  // None of the branches above cross-check Vision's own ISSUE against the
  // pool when title already agrees (or the pool is <10 items) —
  // confirmedIssue silently keeps Vision's initial value in those paths,
  // with no check against the pool at all. Runs uniformly AFTER title
  // resolution, regardless of which branch fired above, so it composes
  // with every title-decision path instead of patching each one.
  //
  // Slabs excluded: Q106 established the visual pool is a confirmed-
  // unreliable witness for graded books (CGC cert page is authoritative
  // there, not the image-search pool) — isGraded books never reach here.
  let identityEscalation = null;
  let matchConfidenceDemote = false;
  let visionZeroSupport = null;
  const reprintRatio = computeReprintDominanceRatio(opts.visualItems);
  const poolReprintDominant = reprintRatio != null && reprintRatio >= REPRINT_DOMINANCE_THRESHOLD;
  if (poolReprintDominant) {
    // EX-7 — pool is not an eligible witness (facsimile/reprint dominance
    // confound). Vision's value stands untouched; if Vision itself lacks
    // confidence, the existing identity-gate / Q83 rescue chain (which
    // reads visionConfidence independently of this function) still
    // escalates to ID_REQUIRED on its own — no new code needed here.
    console.log(`[vision-zero-support] SKIPPED — pool is reprint/facsimile-dominant (ratio=${reprintRatio.toFixed(2)} >= ${REPRINT_DOMINANCE_THRESHOLD}), Vision's issue stands`);
  } else if (!isGraded && vision.issue != null && ebay?.agreement?.visionIssueCount === 0) {
    if (ebay.issue != null) {
      // Coherent alternate issue exists in the pool — adopt it, loudly.
      confirmedIssue = ebay.issue;
      identitySource = `${identitySource}+vision_zero_support_override`;
      matchConfidenceDemote = true;
      visionZeroSupport = {
        mode: 'override',
        visionIssue: vision.issue,
        adoptedIssue: ebay.issue,
        poolTotal: ebay.agreement.total,
      };
      console.log(`[vision-zero-support] OVERRIDE: Vision issue="${vision.issue}" has 0/${ebay.agreement.total} pool support — adopting pool #${ebay.issue}`);
    } else if (ebay.noIssueConsensus) {
      // Vision's issue is unsupported AND the pool doesn't converge on any
      // replacement — Q78's resurrected intent: escalate to ID_REQUIRED
      // rather than silently keeping Vision's unsupported number. Nulling
      // confirmedIssue routes through the existing identity-gate
      // (assessIdentityConfidence sees issue missing) and Q83 rescue
      // (tries the active/sold comp pool before standing on ID_REQUIRED) —
      // no new blocking mechanism needed.
      confirmedIssue = null;
      identitySource = `${identitySource}+vision_zero_support_escalate`;
      identityEscalation = 'ID_REQUIRED';
      matchConfidenceDemote = true;
      visionZeroSupport = {
        mode: 'escalate',
        visionIssue: vision.issue,
        poolTotal: ebay.agreement.total,
      };
      console.log(`[vision-zero-support] ESCALATE: Vision issue="${vision.issue}" has 0/${ebay.agreement.total} pool support and no adoptable alternate — forcing ID_REQUIRED`);
    }
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
    identityEscalation,
    matchConfidenceDemote,
    visionZeroSupport,
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

// Publisher consensus pattern table — shared by backfillFromComps (eBay
// visual pool) and backfillPublisherFromTitles (Q94 active-comp second path).
export const PUBLISHER_CONSENSUS_PATTERNS = [
  { re: /\b(?:dc\s+comics?|dc\s+universe|dcu)\b/i, name: 'DC Comics' },
  { re: /\b(?:marvel\s+comics?|marvel\s+universe)\b/i, name: 'Marvel Comics' },
  { re: /\b(?:image\s+comics?)\b/i, name: 'Image Comics' },
  { re: /\b(?:dark\s+horse)\b/i, name: 'Dark Horse Comics' },
  { re: /\b(?:idw\s+publishing|idw)\b/i, name: 'IDW Publishing' },
  { re: /\b(?:boom!?\s+studios)\b/i, name: 'BOOM! Studios' },
  { re: /\b(?:dynamite\s+entertainment|dynamite)\b/i, name: 'Dynamite Entertainment' },
  { re: /\b(?:valiant\s+(?:comics?|entertainment))\b/i, name: 'Valiant Entertainment' },
  { re: /\b(?:archie\s+comics?)\b/i, name: 'Archie Comics' },
  // Q96 — Charlton was missing from the WARP-FIX vintage-indie additions;
  // one of the most common vintage indies (Flash Gordon #13 1969 class).
  // Bare word is distinctive enough under the consensus gate.
  { re: /\b(?:charlton\s+comics?|charlton)\b/i, name: 'Charlton Comics' },
  // WARP-FIX (2026-07-12) — indie/underground publishers. Warp #9
  // (First Comics 1983): publisher unrecognized by every backfill
  // source → identityComplete=false → ID_REQUIRED → BLOCKED.
  // Phrase-anchored where the bare word collides with comic
  // vocabulary ("first print", "pacific"); bare eclipse/warren
  // acceptable under the ≥50% consensus gate.
  { re: /\b(?:first\s+comics?)\b/i, name: 'First Comics' },
  { re: /\b(?:eclipse\s+comics?|eclipse)\b/i, name: 'Eclipse Comics' },
  { re: /\b(?:pacific\s+comics?)\b/i, name: 'Pacific Comics' },
  { re: /\b(?:kitchen\s+sink)\b/i, name: 'Kitchen Sink Press' },
  { re: /\b(?:warren\s+(?:publishing|magazines?)|warren)\b/i, name: 'Warren Publishing' },
  { re: /\b(?:fantagraphics)\b/i, name: 'Fantagraphics' },
  { re: /\b(?:last\s+gasp)\b/i, name: 'Last Gasp' },
  { re: /\b(?:apex\s+novelt(?:y|ies))\b/i, name: 'Apex Novelties' },
];

// Q96 — Normalize a publisher string to a comparison key so "DC" ≡
// "DC Comics", "Dark Horse" ≡ "Dark Horse Comics", "BOOM! Studios" ≡
// "Boom". Strips corporate/format suffix words, takes the first remaining
// token, then collapses known imprints/lineage to the parent key (same
// families as conflictDetector IMPRINT_PARENTS + mega-keys Timely/Atlas).
const PUBLISHER_KEY_PARENTS = {
  timely: 'marvel',
  atlas: 'marvel',
  max: 'marvel',
  vertigo: 'dc',
  wildstorm: 'dc',
};

export const normalizePublisherKey = (p) => {
  const cleaned = String(p || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(?:comics?|comic\s+book|publishing|publications?|entertainment|studios?|press|group|inc|llc|the)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const key = cleaned.split(' ')[0] || '';
  return PUBLISHER_KEY_PARENTS[key] || key;
};

/**
 * Q94 — Publisher backfill from an arbitrary title pool (second path).
 *
 * backfillFromComps runs the pattern table against the eBay VISUAL pool
 * only; when that pool is empty/thin the publisher stays null even when
 * the Phase-2 ACTIVE comp pool overwhelmingly names one (Warp #9: 0 visual
 * results, 35 active comps naming "First Comics"). This helper runs the
 * same table + same ≥50% consensus gate against any list of titles.
 *
 * No title-match gate: active/sold comps have already passed the comps.js
 * filter chain against OUR title, unlike raw visual-search rows.
 *
 * @param {Array<string>} titles - comp listing titles
 * @param {Object} opts - { minTitles = 4, minRatio = 0.5 }
 * @returns {Object|null} { publisher, hitCount, total, ratio } or null
 */
export const backfillPublisherFromTitles = (titles, { minTitles = 4, minRatio = 0.5 } = {}) => {
  const pool = (titles || []).map((t) => String(t || '')).filter(Boolean);
  if (pool.length < minTitles) return null;

  for (const { re, name } of PUBLISHER_CONSENSUS_PATTERNS) {
    const hitCount = pool.filter((t) => re.test(t)).length;
    const ratio = hitCount / pool.length;
    if (ratio >= minRatio) {
      return { publisher: name, hitCount, total: pool.length, ratio };
    }
  }
  return null;
};

/**
 * Backfill title, year, and publisher from comp consensus when primary sources return null.
 * Q58-TITLE: Title backfill requires ≥4 comps with ≥80% consensus on series name.
 * Year backfill runs always (≥50% consensus).
 * Publisher backfill requires ≥70% title-match gate (≥50% pattern consensus).
 *
 * @param {string|null} confirmedTitle - Current confirmed title (null triggers title backfill)
 * @param {string|null} confirmedYear - Current confirmed year
 * @param {string|null} confirmedPublisher - Current confirmed publisher
 * @param {Array} compItems - eBay visual search results
 * @returns {Object} { title, year, publisher, titleBackfilled, yearBackfilled, publisherBackfilled, titleBackfillRatio, yearBackfillRatio, publisherBackfillSource }
 */
export const backfillFromComps = (confirmedTitle, confirmedYear, confirmedPublisher, compItems) => {
  const result = {
    title: confirmedTitle,
    year: confirmedYear,
    publisher: confirmedPublisher,
    titleBackfilled: false,
    yearBackfilled: false,
    publisherBackfilled: false,
    titleBackfillRatio: 0,
    yearBackfillRatio: 0,
    publisherBackfillSource: null
  };

  // Debug diagnostic for FIX 1
  console.log('[backfill-debug] compItems:', compItems?.length || 0,
    'confirmedTitle:', confirmedTitle || '(null)',
    'confirmedYear:', confirmedYear || '(null)',
    'confirmedPublisher:', confirmedPublisher || '(null)');

  if ((!confirmedTitle || !confirmedYear || !confirmedPublisher) && compItems?.length >= 4) {
    const compTitles = compItems
      .map(i => String(i?.rawTitle || i?.title || ''))
      .filter(Boolean);

    // Q58-TITLE — Title backfill from comp series-name consensus (≥4 comps, ≥80% consensus)
    if (!confirmedTitle && compTitles.length >= 4) {
      // Extract series name from each comp title (strip issue#, publisher, year, grade)
      const extractSeriesName = (rawTitle) => {
        let cleaned = String(rawTitle || '')
          .replace(/#\s*\d+/g, ' ')                    // strip issue number
          .replace(/\b(19[3-9]\d|20[0-2]\d)\b/g, ' ')  // strip years
          .replace(/\b(cgc|cbcs|pgx|graded)\s*[\d.]+/gi, ' ')  // strip slab grades
          .replace(/\b(nm|vf|fn|vg|gd|fr|pr)\b/gi, ' ')  // strip raw grades
          .replace(/\b(marvel|dc|image|dark horse|idw|boom|dynamite|valiant|archie)\s*comics?\b/gi, ' ')  // strip publishers
          .replace(/[()[\]{}]/g, ' ')                  // strip brackets
          .replace(/\s+/g, ' ')
          .trim();

        // Take first 2-4 meaningful tokens (series name is usually 1-3 words)
        const tokens = cleaned.toLowerCase().split(/\s+/)
          .filter(t => t.length >= 3 && !/^(the|and|of|a|with|for|from)$/i.test(t));
        return tokens.slice(0, 4).join(' ');
      };

      const seriesNames = compTitles.map(t => extractSeriesName(t)).filter(Boolean);
      const seriesCounts = {};
      seriesNames.forEach(s => { seriesCounts[s] = (seriesCounts[s] || 0) + 1; });
      const sortedSeries = Object.entries(seriesCounts).sort((a, b) => b[1] - a[1]);

      if (sortedSeries.length > 0) {
        const [topSeries, topCount] = sortedSeries[0];
        const seriesRatio = topCount / seriesNames.length;
        if (seriesRatio >= 0.80 && topSeries.length >= 3) {
          // Sanitize through sanitizeSeriesTitle for canonical form
          const sanitized = sanitizeSeriesTitle(topSeries);
          result.title = sanitized;
          result.titleBackfilled = true;
          result.titleBackfillRatio = seriesRatio;
          console.log(`[Q58-title-backfill] "${sanitized}" from eBay comp consensus (${topCount}/${seriesNames.length}=${(seriesRatio*100).toFixed(0)}%)`);
        }
      }
    }

    // Title sanity: how many comp titles share core tokens with confirmedTitle?
    // (used for publisher backfill gate below)
    const coreTokens = String(result.title || '')
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
        for (const { re, name } of PUBLISHER_CONSENSUS_PATTERNS) {
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

  // Q86 — year confidence. 'proven' when an independent anchor corroborates
  // (eBay pool ratio, PC product, CV volume); 'unproven' when the only
  // source is Vision (which guesses from art style when the cover-read
  // fails). Consumers treat unproven-year PC mismatches as a rank penalty,
  // never a rejection.
  const PROVEN_SOURCES = new Set([
    'ebay-consensus', 'pc-cv-agreement', 'pricecharting', 'comicvine',
    'pricecharting-fallback', 'comicvine-fallback',
  ]);
  const yearConfidence = confirmedYear && PROVEN_SOURCES.has(yearSource)
    ? 'proven'
    : 'unproven';

  return {
    confirmedYear,
    yearOverrideRejected,
    yearSource,
    yearConfidence
  };
};

// Q83 — Consensus series title from comp/sold listing titles.
// Robust against format-word variance that splinters the Q58-TITLE
// first-N-token extractor ("Treasury" / "Crossover" / "Limited Collectors"
// suffixes): the series name is the text BEFORE the issue marker (#N).
// Strips years / slab / grade tokens from the prefix, normalizes for
// counting, returns the dominant prefix when >= minRatio of prefix-bearing
// titles agree AND at least minCount titles carry an issue marker.
// Returns { title, ratio, agreeing, total } or null.
export const extractTitleConsensus = (items, { minCount = 10, minRatio = 0.8 } = {}) => {
  const counts = new Map();
  let total = 0;
  for (const it of items || []) {
    const raw = String(it?.rawTitle || it?.title || '');
    const idx = raw.search(/#\s*\d/);
    if (idx < 3) continue; // no issue marker, or nothing before it
    const prefix = raw.slice(0, idx)
      .replace(/\b(19[3-9]\d|20[0-2]\d)\b/g, ' ')
      .replace(/\b(cgc|cbcs|pgx)\s*[\d.]*\b/gi, ' ')
      .replace(/\b(nm|vf|fn|vg|gd|fr|pr)[+\-]?\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .replace(/[.,:;\-–—\s]+$/, '')
      .trim();
    if (prefix.length < 3) continue;
    const norm = prefix.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!norm) continue;
    total++;
    const cur = counts.get(norm) || { count: 0, display: prefix };
    cur.count += 1;
    counts.set(norm, cur);
  }
  if (total < minCount) return null;
  let top = null;
  for (const v of counts.values()) {
    if (!top || v.count > top.count) top = v;
  }
  if (!top || top.count / total < minRatio) return null;
  return {
    title: top.display,
    ratio: top.count / total,
    agreeing: top.count,
    total,
  };
};
