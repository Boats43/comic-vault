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

import { COMPOUND_WHITELIST, REPRINT_RE, FAMILY_OVERRIDE_DECISIONS, normalizeAcronyms, NON_GENUINE_COPY_RE, hasContaminatedMember, familyDominatesRunnerUp, hasValidFamilyMembership, tokenizeTitle, extractVariantTokensByAxis, IDENTITY_TPB_MARKER_RE, VARIANT_CONTAM_RE, SLAB_RE, NO_PREMIUM_COVER_DESCRIPTORS } from './compHygiene.js';
import { normalizeOptionalYear } from './yearEvidence.js';
// GrailKey Dispatch 26, Fix 4 (2026-08-08) — zero-support unanimous
// rescue reuses Fix 2's own promotion predicate (evaluateUnanimousConsensusPromotion)
// and adds a new title-text-independence check (evaluateTitleTextIndependence),
// both in issueAuthority.js. No import cycle: issueAuthority.js imports only
// compHygiene.js/responseContract.js/yearEvidence.js, none of which import
// identityCore.js.
import { evaluateUnanimousConsensusPromotion, evaluateUnanimousYearConsensusPromotion, evaluateTitleTextIndependence } from './issueAuthority.js';
import { selectFirstEligibleVisual, extractHashIssueNumber, isMarketingFlavoredRow, countCorroboratingEligibleRows, MINIMUM_CORROBORATING_ROWS, createEvidenceSet, addEvidence, reportConflict, reconcileIssue, reconcileVariant, reconcileTitle, reconcilePhysicalYear, extractFirstEligibleYearCandidate } from './identityReconciler.js';
import { matchCreatorCanonicals } from './premiumCreators.js';

// Q119 dispatch (2026-07-18, Captain Marvel #17 class) — single canonical
// source of truth for "publisher name is legitimately PART of the series
// title, do not strip it." Promoted from the function-local const that
// used to live inside sanitizeSeriesTitle below (Q24 fix) — that copy was
// already the most complete of FOUR independently-drifted duplicates found
// in one pass tonight, all guarding the exact same fact with different
// (and differently incomplete) entries:
//   1. ComicAdapter.js PUBLISHER_IN_TITLE_SERIES — missing Captain Marvel/
//      Ms. Marvel entirely.
//   2. This list (previously function-scoped) — most complete, now the
//      canonical source.
//   3. identityCore.js's OWN extractSeriesName (inside backfillFromComps,
//      same file as #2) — no guard at all, naked regex strip.
//   4. imageSearchIdentity.js's NEUTRAL_ADDITION_TOKENS (Q84/Q85-B family-
//      override gate) — no guard at all.
//   5. imageSearchIdentity.js's OWN separate PUBLISHER_IN_TITLE_SERIES
//      (inside extractMainTitle, a different function in the same file as
//      #4) — a near-verbatim copy-paste of #1's gaps.
// Same "one source of truth, multiple consumers" pattern already proven
// correct twice tonight (ARTIST_PATTERNS consolidation for the Black Cat/
// Skottie Young class; classifyVariantTokens shared between extractConsensus
// and Filter 1c for the printing-edition class). Real production case:
// Captain Marvel #17 (2014, 1st Kamala Khan cover) — Vision's own title
// field came back "Captain" (missing "Marvel"); the eBay visual pool's
// title-family consensus correctly found "captain marvel 1st kamala khan"
// (13/20 members) but the override was blocked because "marvel" was
// treated as content-free noise by site #4, leaving only "kamala"/"khan"
// visible to the override-blocking token-class gate — conflating a
// necessary series-name word with an optional descriptive addition.
export const COMPOUND_TITLE_WHITELIST = [
  'captain marvel', 'ms. marvel', 'ms marvel',
  'marvel team-up', 'marvel team up', 'marvel two-in-one', 'marvel two in one',
  'marvel presents', 'marvel preview', 'marvel spotlight',
  'marvel super action', 'marvel super heroes', 'marvel super-heroes',
  'marvel triple action', 'marvel age', 'marvel chillers', 'marvel feature',
  'marvel fanfare', 'marvel comics presents', 'marvel saga', 'marvel premiere',
  'marvel mystery comics', 'marvel tales',
  'detective comics', 'dc comics presents', 'dc universe presents',
  'dc retroactive', 'dc special',
  'image comics presents', 'image united',
  // Q31: Publisher + "of" compounds
  'world of marvel', 'mighty world of marvel', 'world of dc',
  'tales of marvel', 'age of marvel', 'age of dc',
];

// GrailKey Dispatch 09 (2026-08-07) — extracted from sanitizeSeriesTitle's
// inline NOISE_PATTERNS[0] regex (below) so tests/artist-registry-sync.test.js
// can import the exact live word list for its reverse-direction assertion,
// rather than parsing a regex .source string (shown error-prone by the
// Dispatch 08 'dekal' finding). Pure extraction — the runtime regex is
// built from this array, byte-identical behavior.
//
// Deliberately NOT expected to be a subset of ARTIST_PATTERNS: this list
// mixes bare, individual FIRST names (neal, john, jim, todd, steve,
// barry, alan, chris, joe, kaare) with surnames — its job is "strip any
// name-shaped token that bleeds into a title," not "recognize a specific
// creator," which is why it's broader than the creator registry and not
// expected to trace back to it one-for-one. See CLAUDE.md's "first-name
// split" note for the open question of whether this list should be
// renamed/relocated to make that scope explicit.
export const LEGACY_CREATOR_NOISE_WORDS = [
  'neal', 'adams', 'john', 'romita', 'jack', 'kirby', 'steve', 'ditko',
  'barry', 'windsor', 'smith', 'jim', 'lee', 'todd', 'mcfarlane', 'frank',
  'miller', 'alan', 'moore', 'chris', 'claremont', 'joe', 'jusko', 'kaare',
  'andrews', 'alex', 'ross',
];

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

// GrailKey Dispatch 15 Fix 2 (2026-08-07) — the vision-zero-support
// OVERRIDE/ESCALATE mechanism (resolveIdentity below, and
// extractConsensus's zeroSupportNoAdoption in imageSearchIdentity.js)
// originally required Vision's own issue to have LITERALLY ZERO
// occurrences anywhere in the raw pool (an equality test) before treating
// it as unsupported. Real production case (Jetsons, GrailKey Dispatch 05
// item 2): Vision's "#10" had 1/19 = 5.3% pool support — not literally
// zero, so the escalation never fired and the book shipped under the
// wrong issue (#10 instead of the correct #32). On any long-running
// series, a large raw pool will contain most issue numbers *somewhere*
// purely by chance, so the exact-zero test can structurally almost never
// fire on the books most likely to need it. Ratio floor: an issue below
// this fraction of pool support counts as zero-support for this purpose
// — covers both the literal-zero case and the near-zero case with one
// change. Scoped to the issue-axis check only (not the sibling
// visionPublisherCount check, not resolveFamilyIssueConsensus's own pure
// aggregate-vote adoption bar — see the Flash #139 standing constraint in
// CLAUDE.md: this ratio floor never weights or ranks candidates, it only
// changes when Vision's OWN claim is treated as unsupported).
export const ISSUE_ZERO_SUPPORT_RATIO_FLOOR = 0.10;
export const isIssueZeroSupport = (count, total) =>
  typeof count === 'number' && typeof total === 'number' && total > 0 && (count / total) < ISSUE_ZERO_SUPPORT_RATIO_FLOOR;

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
  // Q119 dispatch (2026-07-18) — now reads the module-level, canonical
  // COMPOUND_TITLE_WHITELIST (exported above) instead of a function-local
  // copy — this was itself one of four independently-drifted duplicates,
  // now the single promoted source the other three sites consult.
  const isCompoundTitle = COMPOUND_TITLE_WHITELIST.some(w => rawLower.includes(w));

  const NOISE_PATTERNS = [
    // Creator names that bleed into titles — see LEGACY_CREATOR_NOISE_WORDS
    // (module scope, exported) for the source list.
    //
    // GK-143 (2026-08-21): plain `\b...\b` uses JS's ASCII-only \w definition,
    // so a non-ASCII letter (e.g. "é") reads as a word BOUNDARY, not a word
    // character — "jim" (from "Jim Lee") false-positive-matched inside
    // "Jiménez" ("Jim|énez") and got stripped, corrupting "Jorge Jiménez" to
    // "Jorge énez". Unicode-aware lookaround boundaries (\p{L}/\p{N}, 'u' flag)
    // treat "é" as a word character, so "m"→"é" is no longer a boundary and
    // the false match cannot occur, while genuine bare-word matches ("Jim Lee")
    // are unaffected.
    new RegExp(`(?<![\\p{L}\\p{N}_])(${LEGACY_CREATOR_NOISE_WORDS.join('|')})(?![\\p{L}\\p{N}_])`, 'giu'),
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

/**
 * Q131 follow-up (2026-07-19, Eternus #2 / He-Man class) — checkAssemblyIntegrity's
 * zero-support carve-out (above) validates the assembled title against the
 * FULL raw comp pool, which assumes one title dominates the whole pool.
 * That assumption is false by construction for a refused-identity-conflict
 * provisional override (resolveIdentity's own
 * 'title-family-refused-provisional' branch): the pool deliberately
 * fragments into multiple families, and the surfaced title is only ITS OWN
 * family's consensus — already validated by resolveIdentity's count>=2
 * unanimity guard, not by 22e's raw-pool-wide threshold. 22e's job is
 * catching assembly bugs (a compound token accidentally dropped while
 * combining sources, e.g. Captain Marvel truncation / X-Men #44 Angel);
 * this isn't an assembly, it's an intentional, already-justified departure
 * from a Vision guess that has zero pool support by definition of this
 * decision.
 *
 * Keyed on familyCandidate.decision directly (not identitySource string-
 * matching) so it stays correct even if resolveIdentity's separate
 * zero-support issue/publisher logic appends a suffix to identitySource
 * later in the same call. When resolveIdentity's count>=2 guard didn't
 * fire (thin/no topFamily), confirmedTitle still equals Vision's own
 * value, so skipping the check changes nothing there either — this is a
 * true no-op in every case except the one it's meant to fix.
 *
 * Pure predicate, extracted for direct regression-testability (same
 * rationale as Fix 2/3 above and Q111's applyVariantPreferenceFilter).
 *
 * GrailKey Directive AG (GK-98, kill path 3) — 'discriminative-corroboration'
 * added, same reasoning as 'refused-identity-conflict' above, not a new
 * exemption class. Production evidence, Sabrina Anniversary Spectacular #1:
 * a genuinely thin (1-member) discriminative family is corroborated by
 * Vision's OWN variant field (creator name + convention + issue agreement —
 * AF, GK-98) and departs from Vision's TITLE by design (that departure IS
 * the corrected edition, not an assembly bug) — but Rule 1's zero-support
 * carve-out (checkAssemblyIntegrity above) requires compTitles.length >= 3
 * to even evaluate whether the missing Vision tokens are legitimately
 * unsupported, and a 1-member family can never clear that floor. The
 * carve-out mechanism is correct on its own terms; it simply cannot reach
 * a verdict for a family this thin, and 22e's conservative default (force
 * Vision) is exactly wrong for a candidate whose departure from Vision was
 * already independently justified before 22e ever ran. Confirmed via
 * direct trace: for a 1-member family, Rule 2 (excess-non-consensus-tokens,
 * requires the same compTitles.length>=3) and the compound-whitelist rule
 * can never fire either, so skipping this whole check has identical
 * practical effect to skipping Rule 1 alone for this shape — same
 * true-no-op guarantee as the refused-identity-conflict case: when
 * discriminative-corroboration didn't fire (thin/no topFamily), this
 * function is never even reached with that value.
 *
 * @param {string|null|undefined} familyDecision - familyCandidate?.decision
 * @returns {boolean} true when the 22e assembly-integrity check should be skipped
 */
export const shouldSkipAssemblyIntegrityCheck = (familyDecision) =>
  familyDecision === 'refused-identity-conflict' || familyDecision === 'discriminative-corroboration';

/**
 * Q131 systemic-audit follow-up (2026-07-19, Eternus #2 class) — after
 * shipping the resolveIdentity/convergence/fallback-pricing/22e fixes,
 * a fresh production rescan showed the PC cache-key still baking in
 * Vision's rejected year ("2019") and confirmedPublisher still leaking
 * back to "DC Comics" — NOT because those first fixes were wrong, but
 * because several OTHER call sites downstream of resolveIdentity
 * independently re-derive year/publisher from the raw, pre-resolution
 * req.body values (or the local `year`/`publisher` variables destructured
 * from it) instead of trusting the already-resolved confirmedYear/
 * confirmedPublisher: the PC lookup + both PC cache keys (api/enrich.js,
 * bare `year`), resolveYear's first argument (same bare `year` — an
 * UNCONDITIONAL confirmedYear overwrite), and the ComicVine-then-raw
 * publisher fallback chain (bare `publisher`).
 *
 * This is the single shared gate for all of them — deliberately keyed on
 * identitySource (not familyCandidate.decision) because the GENERAL
 * (non-provisional) refused-identity-conflict sub-case must NOT be
 * caught by it: there, Vision's title legitimately stands (per
 * resolveIdentity's own initial-declaration fallthrough), and its year/
 * publisher/variant remain the correct signal to use — only the
 * provisional-override outcome specifically produced a deliberately
 * null/unconfirmed confirmedYear/confirmedPublisher that these raw
 * fallbacks were undoing.
 *
 * Pure predicate, extracted for direct regression-testability (same
 * rationale as every other Q131 fix).
 *
 * Q134 dispatch (2026-07-21, Lozano/Rachta Lin class) — this exact-string
 * check is now KNOWN-FRAGILE: resolveIdentity's own zero-support override/
 * escalate logic (issue and publisher checks, further down this same file)
 * appends a suffix to identitySource (e.g.
 * "title-family-refused-provisional+vision_publisher_zero_support_escalate")
 * on ANY branch, including this one — the moment that happens, this
 * predicate silently returns false for a genuinely-provisional identity,
 * re-admitting Vision's rejected year/publisher/PC-query. api/enrich.js no
 * longer calls this function for that reason — it uses
 * identity.isProvisionalOverride (a boolean captured at the instant the
 * branch below fires, immune to later string mutation) instead. Kept here,
 * unchanged, only because it's still correct for any caller passing an
 * unmutated identitySource string directly (and for the existing
 * regression test) — do not wire a NEW call site to this function; use
 * isProvisionalOverride.
 *
 * @param {string|null|undefined} identitySource - identity.identitySource
 * @returns {boolean} true when raw req.body/vision fallbacks for year/
 *   publisher/PC-query should be skipped in favor of the already-resolved
 *   (possibly null) confirmedYear/confirmedPublisher
 */
export const isProvisionalRefusedIdentity = (identitySource) =>
  identitySource === 'title-family-refused-provisional';

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
 * GrailKey Commit T (T2, 2026-08-03) — Marvel Tales #14 class, corrected.
 * The local `PC_MATCH_COMMON_TOKENS` stoplist this function used to run its
 * own, INDEPENDENT tokenizer against (rather than reusing title-family
 * scoring's shared one) hard-coded "marvel" as always-generic — correct
 * for a book merely PUBLISHED by Marvel, wrong for "Marvel Tales" itself,
 * where "Marvel" is part of the actual two-word series name. Confirmed
 * live: "marvel tales" vs PC anchor "Tales of Asgard #14" computed
 * overlapCount=1 ("tales", the only survivor once "marvel" was stripped)
 * over confirmedTokens.length=1 (same reason) = 100% — a razor-thin,
 * single-shared-word match reported as PERFECT overlap. Now reuses
 * tokenizeTitle (compHygiene.js) — the SAME tokenizer title-family scoring
 * already uses, Q54-compound-protected: "marvel tales" is a real
 * COMPOUND_WHITELIST entry (confirmed: this exact request logged
 * `[Q54] compound-protected="marvel tales" -> [marvel, tales]` 45 times),
 * so "marvel" now correctly survives as a real token rather than being
 * treated as generic publisher noise. With the tokenizer fixed alone, the
 * Marvel Tales case computes 1 shared ("tales") / 2 confirmed tokens
 * ("marvel","tales") = 50% — still a coin-flip at the OLD 0.5 threshold.
 * Threshold raised to 0.6 to actually reject it — reusing, not inventing,
 * a number: 0.6 is this function's OWN doc comment's pre-existing
 * reference point ("the stricter 0.6 pool-consensus bar used elsewhere in
 * this file"), not a new arbitrary value. Verified via direct execution
 * against every pre-existing fixture (tests/q-pc-requery-gate.test.js) —
 * all four hold unchanged: Amazing Spider-Man (100%), Spider-Versity
 * (33%, already below even the old threshold), degenerate "The Comics"
 * (nothing substantive, short-circuits true).
 *
 * @param {string} confirmedTitle - our current, fully-resolved identity
 * @param {string} productName - PriceCharting's matched product name
 * @param {number} threshold - minimum overlap ratio (default 0.6 — see
 *   above; a single-title-vs-single-product comparison now held to the
 *   SAME bar as pool-internal consensus elsewhere in this file, not a
 *   looser one)
 * @returns {boolean} true when productName sufficiently represents confirmedTitle
 */
export const titleOverlapsProduct = (confirmedTitle, productName, threshold = 0.6) => {
  const confirmedTokens = tokenizeTitle(confirmedTitle);
  if (confirmedTokens.length === 0) return true; // nothing substantive to check against

  const productTokens = tokenizeTitle(productName);
  const overlapCount = confirmedTokens.filter((t) => productTokens.includes(t)).length;
  return (overlapCount / confirmedTokens.length) >= threshold;
};

/**
 * GrailKey Commit T (T1, 2026-08-03) — is this confirmedTitle backed by a
 * real title-family clustering consensus (not a bare Vision guess, not a
 * pool-wide visual-consensus override, not an already-uncertain
 * refused-conflict surface)?
 *
 * Reuses FAMILY_OVERRIDE_DECISIONS (compHygiene.js) directly — the exact
 * two decision values identityCore.js's own resolveIdentity (this file)
 * requires a family to have cleared BEFORE ever setting
 * identitySource = 'title-family-' + family.decision (see the
 * FAMILY_OVERRIDE_DECISIONS.includes(family.decision) guard a few hundred
 * lines below). No new source enum invented — "corroborated" here means
 * exactly, and only, what this file's own identity-resolution logic
 * already required to produce that source string.
 *
 * Deliberately excludes 'title-family-refused-provisional' — a REAL
 * pool-corroborated source (2+ unanimous listings), but one the identity
 * layer itself already flags uncertain (isProvisionalOverride=true,
 * surfaced downstream as identityProvisional) precisely because it
 * represents an unresolved CONFLICT with Vision, not agreement. A
 * different epistemic status than the FAMILY_OVERRIDE_DECISIONS sources
 * (GrailKey Directive AF, GK-98, added a third: 'discriminative-corroboration'),
 * which only ever fire when a real consensus bar (count/overlap thresholds
 * inside buildTitleFamilies/scoreTitleFamilies, or — for the third source —
 * corroborated-token + issue-agreement thresholds inside
 * selectTitleFamilyCandidate) was actually cleared. Also excludes 'ebay_visual_override'/'vision_numeric_protection'
 * (a different mechanism — pool-wide title-vote overriding Vision, not
 * title-family clustering) and plain 'vision' (uncorroborated) — q141-a
 * may still correct any of these, unchanged from before this commit.
 *
 * @param {string|null|undefined} identitySource
 * @returns {boolean}
 */
export const isCorroboratedIdentitySource = (identitySource) =>
  FAMILY_OVERRIDE_DECISIONS.some((decision) => identitySource === `title-family-${decision}`);

/**
 * Q141-A — canonical catalog-title projection from a trusted anchor's own
 * product name (e.g. PriceCharting's `productName`, "Batman #15 (1943)").
 *
 * Field-level, not a full-label copy: strips only the trailing issue-number
 * and/or parenthetical-year tokens a catalog anchor name conventionally
 * carries, keeping everything else verbatim as the canonical series/special
 * title — no stopword list, no length heuristic. Works identically for a
 * base ongoing series ("Batman #15 (1943)" -> "Batman") and a one-shot/
 * special whose own official title has no issue number at all
 * ("Adventure Time: The Bubbline College Special (2025)" -> "Adventure
 * Time: The Bubbline College Special") — the anchor's name IS the catalog
 * title in both cases; this only removes the two structural suffix tokens
 * every anchor name appends around it.
 *
 * Commit A2 (2026-07-28, URGENT regression repair) — a modern-relaunch
 * anchor name (e.g. "Absolute Batman [Nick Dragotta Virgin Foil] #1
 * (2024)") carries a THIRD structural pattern the original version never
 * accounted for: a bracketed variant/edition descriptor block, which can
 * sit anywhere in the string, not just trailing. Un-tested against this
 * shape, the original shipped with the bracket content surviving straight
 * into confirmedTitle ("Absolute Batman [Nick Dragotta Virgin Foil]") —
 * exactly the class of contamination this function exists to prevent,
 * just from a bracket instead of an assembled family-cluster string.
 * Bracket content is stripped from the title unconditionally (never
 * enters confirmedTitle under any circumstance) and separately recovered
 * by extractAnchorBracketDescriptor below for the caller to route into an
 * edition-descriptor field instead.
 *
 * Deliberately does NOT touch confirmedIssue/confirmedYear — by the time an
 * anchor is queried it was already looked up WITH the resolved issue/year,
 * so those fields are anchor-consistent by construction; only confirmedTitle
 * itself was vulnerable to absorbing extra assembled text (cover/edition
 * descriptors like "machine gun cover" from title-family clustering) that
 * the anchor's own name never carried.
 *
 * @param {string} anchorProductName - trusted anchor's own product/volume name
 * @returns {string|null} canonical title, or null if nothing usable remains
 */
export const projectCanonicalTitleFromAnchor = (anchorProductName) => {
  let t = String(anchorProductName || '').trim();
  if (!t) return null;
  t = t.replace(/\[[^\]]*\]/g, ' ');                // bracketed descriptor block(s), anywhere — never survives into the title
  t = t.replace(/\s+/g, ' ').trim();
  t = t.replace(/\(\d{4}\)\s*$/, '').trim();       // trailing "(YYYY)"
  t = t.replace(/#\s*[\w.]+\s*$/, '').trim();       // trailing "#N" / "#N.N" / "#NA"
  return t || null;
};

/**
 * Q141-A2 — companion to projectCanonicalTitleFromAnchor: recovers a
 * bracketed descriptor block's own content ("Absolute Batman [Nick
 * Dragotta Virgin Foil] #1 (2024)" -> "Nick Dragotta Virgin Foil") for the
 * caller to route into an edition-descriptor field, per the same I13
 * annotate-don't-drop principle diffEditionDescriptorCandidate already
 * follows below — the content is real signal (printing/variant/material/
 * cover information), just not title signal.
 *
 * @param {string} anchorProductName
 * @returns {string|null} bracket content, or null if no bracket present
 */
export const extractAnchorBracketDescriptor = (anchorProductName) => {
  const m = String(anchorProductName || '').match(/\[([^\]]+)\]/);
  return m ? m[1].trim() || null : null;
};

/**
 * Q141-A — diagnostic-only companion to projectCanonicalTitleFromAnchor:
 * whatever extra text an assembled (family-clustering / vision) title
 * contributed beyond the projected canonical title. Never fed back into
 * confirmedTitle or pricing — informational only (I13: annotate, don't
 * drop), a home for cover/edition descriptor words a future variant-
 * detection pass can consume without them ever having been allowed to
 * pollute the canonical title itself.
 *
 * @param {string} assembledTitle - the pre-projection title (e.g. family-cluster string)
 * @param {string} canonicalTitle - the post-projection canonical title
 * @returns {string|null} extra tokens present in assembledTitle but not canonicalTitle, or null if none
 */
export const diffEditionDescriptorCandidate = (assembledTitle, canonicalTitle) => {
  const assembled = String(assembledTitle || '').toLowerCase();
  const canonical = String(canonicalTitle || '').toLowerCase();
  if (!assembled) return null;
  const canonicalTokens = new Set(canonical.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean));
  const extra = assembled.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter((t) => t.length > 1 && !canonicalTokens.has(t));
  return extra.length > 0 ? extra.join(' ') : null;
};

/**
 * Q-PC-VARIANT-SCORE — how many of confirmedVariant's tokens appear in a
 * PriceCharting product name (its bracket descriptor or elsewhere)?
 *
 * Plain token-count, not a ratio — a two-word variant match ("skottie
 * young") should outrank a one-word match, so a longer confirmedVariant
 * that matches more fully scores higher rather than being normalized away.
 *
 * @param {string} confirmedVariant - the confirmed variant name (e.g. "SKOTTIE YOUNG")
 * @param {string} productName - a PC candidate's product name
 * @returns {number} count of confirmedVariant tokens found in productName (0 = no match)
 */
export const variantTokenOverlapScore = (confirmedVariant, productName) => {
  // G.O.D.S. dispatch — collapse punctuated acronyms before the strip below.
  const tokenize = (s) => normalizeAcronyms(String(s || '')).toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
  const variantTokens = tokenize(confirmedVariant);
  if (variantTokens.length === 0) return 0;
  const productTokens = tokenize(productName);
  return variantTokens.filter((t) => productTokens.includes(t)).length;
};

/**
 * GrailKey Directive 2026-08-16-AL (GK-120, C4) — is `productName` a hard
 * negative against `confirmedVariant`? True only when BOTH sides name a
 * registered creator (premiumCreators.js) AND those creator sets are
 * completely disjoint — e.g. confirmedVariant="Tyler Kirkham variant" vs
 * productName="[Mayhew Virgin] #1 (2024)": two different, both-recognized
 * creators claiming the same variant slot is a contradiction no amount of
 * shared "virgin"/"foil"/year tokens can outweigh. A candidate naming NO
 * recognized creator at all is never vetoed by this check (nothing to
 * contradict) — it still has to clear the plain score floor below.
 */
const hasCreatorConflict = (confirmedVariant, productName) => {
  const variantCreators = matchCreatorCanonicals(confirmedVariant);
  if (variantCreators.length === 0) return false;
  const productCreators = matchCreatorCanonicals(productName);
  if (productCreators.length === 0) return false;
  return !productCreators.some((c) => variantCreators.includes(c));
};

/**
 * Q-PC-VARIANT-SCORE — pick the best bracket-variant PC candidate.
 *
 * When confirmedVariant is populated (Vision's direct read, or Class A's
 * comp-pool backfill), score every candidate by variantTokenOverlapScore
 * and return the highest scorer — inverse of Q108's null-variant
 * preference logic, which instead prefers a plain/unbracketed entry
 * outright (unchanged, handled entirely upstream of this helper; this
 * function only ever sees bracket-variant candidates).
 *
 * When confirmedVariant is null, returns candidates[0] — IDENTICAL to the
 * prior "arbitrary, API order" behavior; this helper changes nothing for
 * that case (nothing to score against).
 *
 * GrailKey Directive 2026-08-16-AL (GK-109/GK-120, C4) — CHANGED: this
 * used to always return a "best" candidate even at a genuine, all-zero
 * non-match ("no refusal on zero score" was the prior, explicit design —
 * see q-pc-variant-score.test.js's original Test 4). Production evidence
 * (Venom Separation Anxiety #1: confirmedVariant="Tyler Kirkham variant"
 * scored 0 against every real deferred candidate, including
 * "[Mayhew Virgin] #1 (2024)", yet still won and anchored pricing/cache
 * keys/comp queries to a hallucinated creator) proved best-of-bad is
 * unsafe once confirmedVariant is populated. Two-stage now: (1) any
 * candidate with a hard creator conflict (hasCreatorConflict, above) is
 * removed from consideration outright, regardless of any other token
 * overlap; (2) among the survivors, the highest variantTokenOverlapScore
 * must be > 0 to be accepted — a genuine zero-signal match returns null
 * (NO_VARIANT_MATCH) instead of an arbitrary candidate. A populated-but-
 * uncorroborated candidate is not authority (C8) — the caller falls back
 * to "no PC anchor" rather than a confidently wrong one.
 *
 * @param {Array<{productName: string}>} candidates - bracket-variant PC candidates, in API order
 * @param {string|null} confirmedVariant - confirmed variant name, or null
 * @returns {object|null} the selected candidate, null if candidates is empty, or null if none clear the floor
 */
export const selectBestVariantCandidate = (candidates, confirmedVariant) => {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  if (!confirmedVariant) return candidates[0];

  const survivors = candidates.filter((c) => !hasCreatorConflict(confirmedVariant, c.productName));
  if (survivors.length === 0) return null;

  let best = survivors[0];
  let bestScore = variantTokenOverlapScore(confirmedVariant, survivors[0].productName);
  for (let i = 1; i < survivors.length; i++) {
    const score = variantTokenOverlapScore(confirmedVariant, survivors[i].productName);
    if (score > bestScore) {
      best = survivors[i];
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : null;
};

// ── GrailKey Directive 2026-08-16-AL continuation, 4a — variant single- ──
// ── writer reconciliation (Venom Kirkham-vs-Mayhew class)              ──
//
// Extends Slice 1's evidence architecture (identityReconciler.js) to the
// variant facet, per the directive's own governing model: first-eligible-
// visual supplies the physical variant candidate; a bare Vision claim is
// evidence only and cannot itself establish canonical standing; only
// independent, applicable corroboration (a second, different source
// agreeing on the same physical attribute) promotes it.
//
// "Applicable" corroboration, concretely: two variant claims are treated
// as describing the SAME attribute when they share a registered creator
// (matchCreatorCanonicals, premiumCreators.js's 80-creator registry) OR
// share at least one SPECIFIC (non-generic) variant-taxonomy token
// (extractVariantTokensByAxis, compHygiene.js — distribution/coverLetter/
// printing/artist axes). Sharing ONLY a GENERIC coverType/finish token
// (foil/virgin/sketch alone) is deliberately NOT sufficient — the same
// "specific beats generic" rule Filter 1c's AND-match already enforces
// (compHygiene.js, Q111) — otherwise "Tyler Kirkham variant" and
// "[Mayhew Virgin]" would wrongly "agree" on the bare word "virgin,"
// exactly the false corroboration this reconciler exists to refuse.
const VARIANT_GENERIC_AXES = new Set(['coverType']);

// GrailKey Directive 2026-08-16-AM (GK-122, partial — B4-4) — four axes
// extractVariantTokensByAxis (compHygiene.js) does not cover at all:
// event/convention, print-run/limitation numbering, color-finish, and
// authentication. Added HERE, identityCore.js-local, deliberately NOT in
// the shared compHygiene.js function — extending that function has other
// consumers (soldVerification.js, evidenceEligibility.js per its own
// header comment) and needs its own scoping/regression pass, per GK-122's
// own existing note. This is a narrow, task-specific extension for THIS
// reconciler's own candidate-extraction, not a general taxonomy expansion.
// Real production row this closes (Directive AM, USM/Dell'Otto class):
// "ULTIMATE SPIDER-MAN #1 CGC 9.8 INHYUK LEE FAN EXPO PHILLY WHITE
// VARIANT LE 800" — pre-fix, only "Inhyuk Lee" survived extraction;
// "Fan Expo Philly," "White," and "LE 800" were silently dropped.
const EVENT_RE = /\b(nycc|sdcc|c2e2|megacon|wondercon|emerald\s*city|fan\s*expo(?:\s+\w+)?|heroes\s*con|awa)\b/i;
const PRINT_RUN_RE = /\ble\s*\d+\b|\b\d+\s*\/\s*\d+\b/i;
// Color-finish: bare color words collide far too broadly on their own
// (character names, unrelated adjectives — "Black Panther," "Red Hood")
// to match standalone. Context-gated to immediately precede "variant" or
// "cover," same discipline this codebase already applies to other
// collision-prone bare words (e.g. compHygiene.js's Q48 cover-letter
// gate, ARTIST_PATTERNS' \b-anchored entries).
const COLOR_FINISH_RE = /\b(white|black|gold|silver|red|blue|green|purple|pink)\s+(?:variant|cover)\b/i;
// Same SIGNED_RE precedent as compHygiene.js (CLAUDE.md): bare "SS"
// deliberately omitted — false-positive risk (SS-Squadron and other
// unrelated acronyms).
const AUTHENTICATION_RE = /\b(signed|remarked|autographed?|signature\s+series)\b/i;

// Event/print-run/authentication are genuinely specific/discriminative
// signals (same standing as distribution/printing/artist) — returned
// separately from color-finish so callers can include the former in
// "specific" comparisons and the latter only in display text.
const extractEventPrintRunAuth = (text) => {
  const s = String(text || '');
  const found = [];
  const eventMatch = s.match(EVENT_RE);
  if (eventMatch) found.push(eventMatch[0].trim().toLowerCase());
  const printRunMatch = s.match(PRINT_RUN_RE);
  if (printRunMatch) found.push(printRunMatch[0].trim().toLowerCase());
  const authMatch = s.match(AUTHENTICATION_RE);
  if (authMatch) found.push(authMatch[0].toLowerCase());
  return found;
};

// Color-finish: display-only, deliberately never "specific" — a bare
// color word is closer to a cosmetic descriptor (same category as
// coverType/foil/virgin) than a discriminative fact, and must not alone
// be able to grant sole-authority standing.
const extractColorFinish = (text) => {
  const m = String(text || '').match(COLOR_FINISH_RE);
  return m ? m[1].toLowerCase() : null;
};

const variantSpecificTokens = (text) => {
  const byAxis = extractVariantTokensByAxis(text || '');
  const tokens = [];
  for (const axis of Object.keys(byAxis)) {
    if (VARIANT_GENERIC_AXES.has(axis)) continue;
    tokens.push(...byAxis[axis]);
  }
  tokens.push(...extractEventPrintRunAuth(text));
  return tokens;
};

const variantValuesAgree = (a, b) => {
  const textA = String(a || '').trim();
  const textB = String(b || '').trim();
  if (!textA || !textB) return false;
  if (textA.toLowerCase() === textB.toLowerCase()) return true;
  const creatorsA = matchCreatorCanonicals(textA);
  const creatorsB = matchCreatorCanonicals(textB);
  if (creatorsA.length && creatorsB.length && creatorsA.some((c) => creatorsB.includes(c))) return true;
  const specificA = variantSpecificTokens(textA);
  const specificB = variantSpecificTokens(textB);
  if (specificA.length && specificB.length && specificA.some((t) => specificB.includes(t))) return true;
  return false;
};

/**
 * extractFirstEligibleVariantCandidate — companion to extractHashIssueNumber
 * (identityReconciler.js), same "extract from the row's own raw text, no
 * ranking/scoring" discipline. Builds a clean, human-readable variant
 * descriptor from whatever recognized creator/variant-taxonomy signal is
 * actually present in the first eligible visual row's own title — never
 * the row's full raw title text (too noisy for a canonical facet value:
 * issue numbers, publisher, condition, price-like tokens).
 *
 * Returns null when nothing recognized is present — a row with no known
 * creator and no known variant-taxonomy token supplies no candidate at
 * all (honest absence, not a fabricated one).
 */
export const extractFirstEligibleVariantCandidate = (rawTitle) => {
  const text = String(rawTitle || '');
  if (!text.trim()) return null;
  const creators = matchCreatorCanonicals(text);
  const specific = variantSpecificTokens(text);
  const byAxis = extractVariantTokensByAxis(text);
  const generic = byAxis.coverType || [];
  const colorFinish = extractColorFinish(text);
  const seen = new Set();
  const parts = [];
  for (const p of [...creators, ...specific, ...generic, ...(colorFinish ? [colorFinish] : [])]) {
    const key = String(p).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(p);
  }
  return parts.length > 0 ? parts.join(' ') : null;
};

// GrailKey Directive 2026-08-20-AW (GK-140) — "the adopted title asks a
// clean question." AV made the rank-1 candidate win; production
// immediately showed the cost of winning VERBATIM: the raw seller row
// ("Venom - Separation Anxiety 1 Virgin Signed/Remarked by Mike Mayhew
// w/Poker Chip") over-narrows the PC/CV/comps queries built from it (no
// catalog product matches a seller's flourish — the SAME physical book
// resolved cleanly to "Venom Separation Anxiety" on a cooperative scan and
// priced normally) and pollutes the card display.
//
// Strip-only, never substitute (C1) — no series-name list, no guessing.
// Each cruft class below is a structural pattern (an attribution clause,
// a "w/" merch clause, a parenthetical, a grade token, a leading issue
// number, a trailing publisher+year suffix) confirmed against the RAW
// row text, which still carries these structural markers — unlike
// `family.topFamily.title` (buildTitleFamilies' own naive token-consensus
// cleaning), which has already destroyed them by the time it reaches this
// function (that gap is exactly why "by mike mayhew poker chip" survived:
// tokenizeTitleFamily's ARTIST_PATTERNS strip, compHygiene.js, has no
// "Mayhew" entry — a real, traceable coverage gap, not a mystery).
//
// Attribution-clause stripping is confirmed via `matchCreatorCanonicals`
// (premiumCreators.js) — the SAME registry that already populates the
// variant facet's evidence (reconcileVariantFacet/
// extractFirstEligibleVariantCandidate) — so what this function strips
// from the title is provably the same set already attributed to variant
// (C2), never an independent guess about what counts as a "creator."
// Reuses compHygiene.js's own already-proven regexes wherever one exists
// (SLAB_RE for grade tokens, VARIANT_CONTAM_RE for generic finish/
// descriptor words like "virgin"/"foil"/"exclusive") rather than a
// second, independently-drifting copy of the pattern itself.
//
// Deliberately NOT built at module top level. Two real bugs found doing
// it that way, both caught by running the full suite before shipping,
// neither hypothetical:
//   (1) TDZ hazard — `new RegExp(SLAB_RE.source, ...)` evaluated at this
//       module's OWN top level depends on compHygiene.js having already
//       finished initializing SLAB_RE by the time this line runs. That
//       held for some test entry points and threw
//       "Cannot access 'SLAB_RE' before initialization" for others,
//       purely as a function of which module a given test file imports
//       first — a real, fragile ordering hazard, not a coincidence.
//   (2) Global-regex statefulness — a shared, global-flagged RegExp
//       object mutates its own `lastIndex` on every `.test()` call; a
//       module-level singleton reused across many `canonicalizeTitleCandidate`
//       calls (many scans, many test fixtures in one process) risks a
//       LATER call silently missing a match at the start of its string
//       because `lastIndex` was left non-zero by an EARLIER call on a
//       different string.
// applyStrip (below) builds a fresh RegExp from a `.source`/string each
// call and uses `.match()` (which the spec resets to lastIndex=0
// regardless) instead of `.test()` + a second `.match()` — both hazards
// closed at once, not patched around.
const applyStrip = (text, sourceOrRegex, className, strippedLog) => {
  const source = typeof sourceOrRegex === 'string' ? sourceOrRegex : sourceOrRegex.source;
  const re = new RegExp(source, 'gi');
  const matches = text.match(re);
  if (!matches || matches.length === 0) return text;
  strippedLog.push({ class: className, text: matches.join(' ') });
  return text.replace(new RegExp(source, 'gi'), ' ');
};

// SLAB_RE requires a grading-COMPANY prefix (cgc/cbcs/...); real eBay
// titles routinely carry a bare condition word with no company at all
// ("NM Marvel Comic Book") or a bare decimal grade-scale number ("9.4"
// with no "CGC" anywhere). Two narrow, additive patterns for exactly
// those two shapes — bare condition abbreviations, and a bare single-
// digit.single-digit number (grade scale; excludes 4-digit years like
// "2099"/"1994" by construction). Plain (non-'g') source strings — the
// 'g' flag is added fresh inside applyStrip, never carried here.
const TITLE_CANON_BARE_CONDITION_SRC = '\\b(?:nm|vf|fn|vg|gd|fr|pr|mt)[+-]?\\b';
const TITLE_CANON_BARE_GRADE_NUMBER_SRC = '\\b\\d\\.\\d\\b';
const TITLE_CANON_SELLER_NOISE_SRC = '\\b(?:check\\s*photos?|ships?\\s*free|hot!*|ltd\\s*\\d+|limited(?:\\s*to)?\\s*\\d+)\\b';
const TITLE_CANON_PAREN_SRC = '\\([^)]*\\)';
const TITLE_CANON_PUBLISHER_YEAR_SUFFIX_RE = /\b(?:marvel|dc)(?:\s+comics)?\s*(?:\d{4})?\s*$/i;

// Strip a trailing/leading attribution clause ("by/signed by/remarked by
// <creator clause>") — only when the clause actually contains a
// registry-recognized creator (matchCreatorCanonicals), so a real title
// phrase that happens to contain the word "by" is never falsely stripped
// (C6). Returns { text, strippedText } or null when no attribution clause
// with a confirmed creator was found.
const stripAttributionClause = (text) => {
  const m = text.match(/\b(?:signed\/?\s*remarked|remarked\/?\s*signed|signed|remarked)?\s*(?:by)\s+.+$/i);
  if (!m) return null;
  const clause = m[0];
  if (matchCreatorCanonicals(clause).length === 0) return null;
  return { text: text.slice(0, m.index).trim(), strippedText: clause.trim() };
};

// Strip a trailing "w/ <object>" merch/packaging clause ("w/Poker Chip",
// "w/COA", "w/ Gemini mailer"). Structural marker only — no object list,
// so it cannot mistake a real title word for merch on its own; it only
// fires on the literal "w/" construction.
const stripMerchClause = (text) => {
  const m = text.match(/\bw\/\s*.+$/i);
  if (!m) return null;
  return { text: text.slice(0, m.index).trim(), strippedText: m[0].trim() };
};

// Strip a standalone bare issue number that duplicates the already-
// adopted issue facet ("1107 Detective Comics..." / "Venom ... 1 Virgin"
// when the issue is #1107 / #1) — the issue already has its own facet/
// display; a duplicate bare number anywhere in the title candidate is
// noise, not part of the series name. Bounded to the SPECIFIC resolved
// issue value only (never strips an arbitrary number) and only the FIRST
// standalone occurrence — a real numeric title word ("2099", "X-Men 2099")
// never collides with this unless the issue itself happens to equal that
// exact number, in which case it genuinely is the same duplicate token.
const stripStandaloneIssueNumber = (text, issueValue) => {
  if (issueValue == null) return null;
  const escaped = String(issueValue).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|\\s)#?${escaped}(?=\\s|$)`, 'i');
  if (!re.test(text)) return null;
  return { text: text.replace(re, '$1').replace(/\s{2,}/g, ' ').trim(), strippedText: String(issueValue) };
};

/**
 * canonicalizeTitleCandidate — pure, strip-only (C1). GrailKey Directive
 * AW (GK-140). Takes the frozen rank-1 row's own VERBATIM raw text and
 * strips known cruft classes (attribution, merch/w-clause, parenthetical
 * noise, grade/condition tokens, seller noise, a leading duplicate issue
 * number, a trailing bare publisher+year suffix) — never adds, guesses,
 * or substitutes. C6 over-strip guard: if stripping collapses the
 * candidate to nothing (or a single stopword), the lightly-whitespace-
 * cleaned ORIGINAL is returned instead — an honest, un-canonicalized
 * question beats no question at all.
 *
 * @param {string} rawTitle - the frozen rank-1 row's own verbatim text
 * @param {{issueValue?: string|number|null}} [opts]
 * @returns {{value: string, overStripped: boolean, strippedLog: Array<{class: string, text: string}>}}
 */
export const canonicalizeTitleCandidate = (rawTitle, opts = {}) => {
  const original = String(rawTitle || '');
  const strippedLog = [];
  let s = original;

  const attribution = stripAttributionClause(s);
  if (attribution) { s = attribution.text; strippedLog.push({ class: 'attribution', text: attribution.strippedText }); }

  const merch = stripMerchClause(s);
  if (merch) { s = merch.text; strippedLog.push({ class: 'merch', text: merch.strippedText }); }

  s = applyStrip(s, TITLE_CANON_PAREN_SRC, 'parenthetical', strippedLog);
  s = applyStrip(s, SLAB_RE.source, 'grade', strippedLog);
  // Generic finish/descriptor words (VARIANT_CONTAM_RE: virgin/foil/
  // exclusive/sketch/ratio/etc.) — reused verbatim from compHygiene.js
  // (C2: the same words the variant/creator machinery already
  // recognizes, never a new independent list).
  s = applyStrip(s, VARIANT_CONTAM_RE.source, 'finish-descriptor', strippedLog);
  // Deliberately NO bare "signed"/"remarked" strip (SIGNED_RE) beyond the
  // attribution clause above — a bare SIGNED_RE match anywhere in the
  // string is indistinguishable from a real title phrase ("Batman: The
  // Signed Edition"), and the attribution-clause stripper above already
  // handles the actual production shape ("Signed/Remarked by <creator>")
  // via the SAME word, in the position it's actually cruft. Found and
  // reverted during fixture testing — the bare version broke exactly the
  // C6 negative control it exists to protect.
  s = applyStrip(s, TITLE_CANON_BARE_CONDITION_SRC, 'grade', strippedLog);
  s = applyStrip(s, TITLE_CANON_BARE_GRADE_NUMBER_SRC, 'grade', strippedLog);
  s = applyStrip(s, TITLE_CANON_SELLER_NOISE_SRC, 'seller-noise', strippedLog);
  // Space-surrounded dash/pipe/colon ("Venom - Separation Anxiety") is
  // listing punctuation, collapsed to a single space — a word-internal
  // hyphen with no surrounding spaces ("Spider-Man", "X-Men") is never
  // touched by this pattern.
  s = s.replace(/\s+[-–—|]+\s+/g, ' ').replace(/[-–—:|]+\s*$/, '').replace(/\s{2,}/g, ' ').trim();

  const standaloneIssue = stripStandaloneIssueNumber(s, opts.issueValue);
  if (standaloneIssue) { s = standaloneIssue.text; strippedLog.push({ class: 'standalone-issue', text: standaloneIssue.strippedText }); }

  if (TITLE_CANON_PUBLISHER_YEAR_SUFFIX_RE.test(s)) {
    strippedLog.push({ class: 'publisher-year-suffix', text: (s.match(TITLE_CANON_PUBLISHER_YEAR_SUFFIX_RE) || []).join(' ') });
    s = s.replace(TITLE_CANON_PUBLISHER_YEAR_SUFFIX_RE, '').trim();
  }

  s = s.replace(/[-–—:|,]+\s*$/, '').replace(/\s{2,}/g, ' ').trim();

  // C6 — over-strip guard. Two different protections are actually in
  // play here, not one: attribution/merch/parenthetical/publisher-year-
  // suffix only match STRUCTURAL positions (trailing "by <creator>",
  // trailing "w/...", a bare trailing "marvel/dc [+ year]") — a real
  // title word in the middle of the string is never a match target for
  // those. Grade/finish-descriptor/signed-leftover (SLAB_RE/
  // VARIANT_CONTAM_RE/SIGNED_RE) match a SPECIFIC, bounded vocabulary
  // anywhere in the string — real title collision risk there is
  // structurally small (none of "virgin/foil/exclusive/sketch/signed/
  // remarked/etc." are real comic series names) but not zero, so this
  // final guard is the actual backstop: if stripping still empties the
  // candidate or leaves a single stopword, the original wins outright.
  const STOP_ONLY = new Set(['the', 'a', 'an', 'of', 'and', 'or']);
  const tokens = s.split(/\s+/).filter(Boolean);
  const overStripped = tokens.length === 0 || (tokens.length === 1 && STOP_ONLY.has(tokens[0].toLowerCase()));
  if (overStripped) {
    return { value: original.replace(/\s{2,}/g, ' ').trim(), overStripped: true, strippedLog: [] };
  }
  return { value: s, overStripped: false, strippedLog };
};

/**
 * deriveSeriesCoreQuery — GK-142 (Phase 0.3, 2026-08-21). A QUERY
 * PROJECTION of the adopted/confirmed title, for PC/CV/comps search
 * strings ONLY — never the display/adopted identity (A5, mandatory:
 * seriesCoreQuery is a query projection, never a second identity; the
 * caller's own `confirmedTitle`/display value is never reassigned from
 * this function's output).
 *
 * Traced cause (GK-142, production request r5v6b): `[reconcile-title]
 * value="Detective Comics Batman Corner Box Jorge Jiménez"` — over-narrow
 * PC/CV/comps queries built directly from the adopted title, because
 * neither the creator name nor the "Corner Box" cover-descriptor got
 * stripped by canonicalizeTitleCandidate (GK-140) before this dispatch.
 * Two additions on top of that function's existing pipeline (reused, not
 * reimplemented):
 *  (1) An UNCONDITIONAL matchCreatorCanonicals-driven creator-name strip.
 *      canonicalizeTitleCandidate's own stripAttributionClause requires
 *      the literal word "by" before a recognized creator name; the r5v6b
 *      row names the creator with no "by" marker, so it survives
 *      untouched. This strips any registry-recognized creator name found
 *      anywhere in the string, regardless of a "by" marker — for QUERY
 *      purposes only; stripAttributionClause itself is not touched.
 *  (2) NO_PREMIUM_COVER_DESCRIPTORS (compHygiene.js) — cover-position
 *      terms ("Corner Box", "Cover A/B/C/D", etc.) VARIANT_CONTAM_RE does
 *      not cover, reused from the already-vetted pricing NO_PREMIUM
 *      vocabulary (see that constant's own header — a separate literal,
 *      not an import, from api/enrich.js's pricing-math array, which
 *      stays untouched; drift between the two is caught mechanically by
 *      tests/grailkey-gk142-no-premium-parity.test.js, not by convention).
 *
 * Same C6-style over-strip guard as canonicalizeTitleCandidate: if the
 * projection empties or collapses to a single stopword, falls back to the
 * UN-PROJECTED input verbatim (A5's mandatory fallback) — a broader query
 * beats an empty or wrong one.
 *
 * @param {string} confirmedTitle - the adopted/display title (read-only; never mutated by this function)
 * @param {string|number|null} [confirmedIssue] - passed through to canonicalizeTitleCandidate's own standalone-issue-number strip
 * @returns {{value: string, overStripped: boolean}}
 */
export const deriveSeriesCoreQuery = (confirmedTitle, confirmedIssue = null) => {
  const original = String(confirmedTitle || '');
  if (!original.trim()) return { value: original, overStripped: false };

  const strippedLog = [];
  let s = original;

  // canonicalizeTitleCandidate's own pipeline FIRST (attribution, merch,
  // parenthetical, grade/condition, seller-noise, standalone-issue,
  // publisher+year-suffix) — reused, not reimplemented. Order matters:
  // this must run BEFORE the unconditional creator strip below, or a real
  // "by <creator> w/<merch>" clause loses its creator name to the strip
  // first and stripAttributionClause's own matchCreatorCanonicals(clause)
  // check (which confirms the clause is worth stripping AT ALL) then finds
  // nothing and leaves an orphaned "by ... poker chip" tail behind —
  // caught by testing this exact case (the AW/GK-140 Venom production
  // shape) before shipping.
  const canon = canonicalizeTitleCandidate(s, { issueValue: confirmedIssue });
  s = canon.overStripped ? s : canon.value;

  // (1) unconditional creator-name strip — same registry
  // stripAttributionClause already trusts, just without requiring "by".
  // Catches whatever creator mention canonicalizeTitleCandidate's own
  // "by"-gated stripper couldn't (the r5v6b shape: no "by" marker at all).
  //
  // GK-143-consistent safety: matchCreatorCanonicals may return a
  // canonical registry form (e.g. "Jorge Jimenez") that is not byte-
  // identical to what the source text actually contains (e.g. "Jorge
  // Jiménez") — searching for the canonical form directly would silently
  // find nothing. NFD-decompose + strip combining marks gives a same-
  // length, position-corresponding ASCII-folded view for ordinary Latin
  // diacritics (one base letter replaces one accented letter, 1:1), so a
  // found index maps directly back onto the original string; the
  // `folded.length === s.length` guard skips the strip entirely (leaves
  // `s` untouched, safe no-op) for any input where that 1:1 correspondence
  // doesn't hold, rather than guessing at an offset the way GK-143's own
  // bug did.
  const foldDiacritics = (str) => str.normalize('NFD').replace(/\p{Mn}/gu, '');
  for (const creator of matchCreatorCanonicals(s)) {
    const folded = foldDiacritics(s).toLowerCase();
    const target = foldDiacritics(creator).toLowerCase();
    if (folded.length !== s.length) continue;
    const idx = folded.indexOf(target);
    if (idx === -1) continue;
    s = (s.slice(0, idx) + ' ' + s.slice(idx + target.length)).replace(/\s{2,}/g, ' ').trim();
    strippedLog.push({ class: 'creator-name', text: creator });
  }

  // (2) cover-position / no-premium descriptor tokens.
  const coverDescSrc = `\\b(?:${NO_PREMIUM_COVER_DESCRIPTORS
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'))
    .join('|')})\\b`;
  s = applyStrip(s, coverDescSrc, 'cover-descriptor', strippedLog);

  s = s.replace(/[-–—:|,]+\s*$/, '').replace(/\s{2,}/g, ' ').trim();

  const STOP_ONLY_QUERY = new Set(['the', 'a', 'an', 'of', 'and', 'or']);
  const tokens = s.split(/\s+/).filter(Boolean);
  const overStripped = tokens.length === 0 || (tokens.length === 1 && STOP_ONLY_QUERY.has(tokens[0].toLowerCase()));
  if (overStripped) {
    return { value: original.replace(/\s{2,}/g, ' ').trim(), overStripped: true };
  }
  return { value: s, overStripped: false };
};

/**
 * reconcileTitleFacet — pure. GrailKey Directive 2026-08-20-AV (GK-133),
 * canonicalization added by Directive AW (GK-140).
 *
 * Builds the title evidence set and calls reconcileTitle
 * (identityReconciler.js). Deliberately narrow, same discipline as
 * reconcileVariantFacet: this does not re-litigate family election's own
 * WIN conditions (Q38's >=3-member floor, Q84's dual-axis gate, AN's
 * physical-corroboration token gate) — those still decide when a family
 * candidate is promoted to confirmedTitle directly, byte-identical. This
 * function only fires in the void those mechanisms leave when they
 * refuse: `family.topFamily` (the same candidate Q38 already scored and
 * blocked from promotion) becomes TITLE EVIDENCE rather than being
 * silently discarded in favor of Vision's bare default.
 *
 * AW correction: the candidate source is now `topFamily.rawTitle` (the
 * frozen row's own VERBATIM text), run through canonicalizeTitleCandidate
 * — not `topFamily.title` (buildTitleFamilies' own naive token-consensus
 * cleaning, which had already destroyed the structural markers
 * canonicalizeTitleCandidate needs and left real cruft like "by mike
 * mayhew poker chip" behind — see that function's own header for the
 * full trace). The verbatim row is preserved as `verbatim` evidence
 * metadata (C3) — never discarded, only no longer the DISPLAY value.
 *
 * @param {string|null} visionTitle - Vision's own raw title
 * @param {object|null} familyCandidate - the title-family clustering result
 *   (imageSearchIdentity.js's selectTitleFamilyCandidate return value)
 * @returns {{reconciled: object, candidate: string|null}}
 */
export const reconcileTitleFacet = (visionTitle, familyCandidate) => {
  const evidence = createEvidenceSet();
  if (visionTitle) {
    addEvidence(evidence, 'title', 'vision', visionTitle);
  }
  const candidateRawTitle = familyCandidate?.topFamily?.rawTitle || null;
  if (candidateRawTitle) {
    // Issue candidate from the SAME row's own text, self-contained (no
    // dependency on the outer resolveIdentity call's own issue-facet
    // timing — that reconciliation runs later in the function) — used
    // only to strip a duplicate standalone issue number from the title
    // candidate, never to establish canonical issue identity itself
    // (AS/GK-132 owns that, unchanged).
    const rowIssueCandidate = extractHashIssueNumber(candidateRawTitle) || extractIssueCandidate(candidateRawTitle);
    const canon = canonicalizeTitleCandidate(candidateRawTitle, { issueValue: rowIssueCandidate?.issue ?? null });
    for (const strip of canon.strippedLog) {
      console.log(`[title-canon] stripped=${strip.class}:"${strip.text}"`);
    }
    if (canon.overStripped) {
      console.log(`[title-canon] over-strip guard fired — falling back to lightly-cleaned original: "${canon.value}"`);
    }
    addEvidence(evidence, 'title', 'first-eligible-visual', canon.value, { verbatim: candidateRawTitle });
  }
  const reconciled = reconcileTitle(evidence);
  return { reconciled, candidate: reconciled.value };
};

/**
 * reconcileVariantFacet — pure. Builds the variant evidence set and calls
 * reconcileVariant (identityReconciler.js) with a creator/taxonomy-aware
 * comparator. Deliberately conservative in scope (regression-safety
 * driven, documented honestly rather than silently narrowed):
 *
 *   - Only intervenes when `pipelineSource` is exactly 'vision' — i.e.
 *     api/enrich.js's existing ~250-line, 7-mechanism confirmedVariant
 *     pipeline (CGC cert, eBay pool consensus, edition-warning printing
 *     text, canonical-projection residue, family/publisher/imprint
 *     routing, manual correction) ran to completion and NONE of those
 *     already-tested, already-gated mechanisms touched Vision's raw init
 *     value. Each of those 6 other mechanisms is left completely
 *     untouched by this function — re-litigating their own, independently
 *     hard-won correctness (Q106, Q116, Commit N1, GrailKey D03, Directive
 *     T Task 4) is explicitly out of this dispatch's scope, and treating
 *     any of them as "just more Vision-tier evidence" would risk nulling
 *     out correct values those mechanisms already verified through their
 *     own gates.
 *   - When first-eligible-visual evidence exists and DISAGREES with the
 *     bare Vision value, first-eligible-visual wins outright (sole
 *     authority) — Vision's claim becomes recorded conflict evidence,
 *     never canonical, never silently dropped (the Venom Kirkham-vs-
 *     Mayhew fix).
 *   - When first-eligible-visual evidence exists and AGREES, the result
 *     is CORROBORATED — same value, stronger standing.
 *   - When NO first-eligible-visual evidence exists at all (nothing
 *     recognized in the row's own text, or no eligible row at all), this
 *     function returns the reconciler's honest NONE/uncorroborated
 *     result for visibility (`reconciled.authority`), but the CALLER
 *     (api/enrich.js) keeps the existing pipeline value rather than
 *     nulling it out — a bare Vision claim with nothing to corroborate OR
 *     contradict it is left exactly as every currently-passing test
 *     already expects, rather than introducing a new null-everything
 *     failure mode with no acceptance criterion actually requiring it.
 *     This is a deliberate scope boundary, not silent narrowing — see the
 *     Pattern Library entry for this dispatch.
 *
 * @param {string|null} pipelineValue - confirmedVariant after the existing pipeline
 * @param {string} pipelineSource - variantIdentitySource after the existing pipeline
 * @param {string|null} firstEligibleRawTitle - the first eligible visual row's own raw title, or null
 * @param {string[]} [otherEligibleRawTitles] - GrailKey Directive AU (GK-136), 4a-ii — raw
 *   titles of the REMAINING eligible pool rows (same population the caller's own
 *   pipeline already scoped to family+issue, EXCLUDING firstEligibleRawTitle —
 *   caller's responsibility, this function does not re-derive eligibility).
 *   Each row is extracted and admitted with its OWN per-row evidence entry —
 *   no ≥2-same-value consensus pre-gate (that aggregate gate, at
 *   variantIdentity.js:972-991, stays exactly where it is and keeps feeding
 *   pipelineValue unchanged; this is an ADDED entry path, not a lowered one).
 *   reconcileVariant's own existing corroboration search (identityReconciler.js)
 *   then does what it already does for every other facet: two or more rows
 *   independently naming the same creator corroborate each other; a lone
 *   dissenting row stands as visible, non-winning conflict evidence, never
 *   silently dropped (same "never hidden, never adopted without standing"
 *   rule the reconciler already applies everywhere else).
 * @returns {{reconciled: object, candidate: string|null}}
 */
export const reconcileVariantFacet = (pipelineValue, pipelineSource, firstEligibleRawTitle, otherEligibleRawTitles = []) => {
  const evidence = createEvidenceSet();
  if (pipelineValue) {
    addEvidence(evidence, 'variant', pipelineSource === 'vision' ? 'vision' : pipelineSource, pipelineValue);
  }
  const candidate = firstEligibleRawTitle ? extractFirstEligibleVariantCandidate(firstEligibleRawTitle) : null;
  // A candidate built from ONLY a generic coverType/finish token (e.g.
  // bare "foil," no creator, no specific-axis token) is too thin to be
  // sole-authority evidence — it must not be able to outrank a richer,
  // more specific pipeline value on the strength of a single generic
  // word alone (found regression-testing the Sabrina shape: Vision's own
  // "Dan Parent NYCC Foil variant" would otherwise be degraded to a bare
  // "foil" candidate, since neither "Dan Parent" nor "NYCC" nor "LTD 50"
  // is recognized by any registry this extractor consults — an honest
  // absence of RECOGNIZED signal, not evidence that the row disagrees).
  // Require at least one recognized creator OR specific-axis token before
  // this candidate is admitted as evidence at all.
  const candidateHasDiscriminativeSignal = candidate != null
    && (matchCreatorCanonicals(candidate).length > 0 || variantSpecificTokens(candidate).length > 0);
  if (candidate && candidateHasDiscriminativeSignal) {
    addEvidence(evidence, 'variant', 'first-eligible-visual', candidate);
  }
  // GrailKey Directive AU (GK-136), 4a-ii — the third entry path. Same
  // extraction + same discriminative-signal gate as the first-eligible row
  // above (reused, not forked), applied per-row to the rest of the eligible
  // pool. Each row gets its OWN uniquely-suffixed source ('ebay-pool-row-N')
  // rather than one shared source string — reconcileVariant's own agreement
  // search requires `e.source !== candidate.source` (identityReconciler.js),
  // so two genuinely corroborating pool rows naming the same creator MUST
  // carry distinct sources to be able to agree with each other at all; a
  // shared source would silently prevent exactly the multi-row corroboration
  // this entry path exists to enable. No de-duplication by candidate TEXT
  // either, for the same reason — two rows independently saying "Gabriele
  // Dell'Otto" is the corroboration signal, not noise to collapse away.
  // Source is deliberately NOT in VARIANT_SOLE_AUTHORITY_PRECEDENCE — a
  // single pool row can never win outright alone, only by independently
  // agreeing with another source (first-eligible-visual, a sibling pool
  // row, or a corroborating pipeline value).
  let poolRowIndex = 0;
  for (const rawTitle of (Array.isArray(otherEligibleRawTitles) ? otherEligibleRawTitles : [])) {
    if (!rawTitle || rawTitle === firstEligibleRawTitle) continue;
    const poolCandidate = extractFirstEligibleVariantCandidate(rawTitle);
    if (poolCandidate == null) continue;
    const hasSignal = matchCreatorCanonicals(poolCandidate).length > 0 || variantSpecificTokens(poolCandidate).length > 0;
    if (!hasSignal) continue;
    addEvidence(evidence, 'variant', `ebay-pool-row-${poolRowIndex}`, poolCandidate);
    poolRowIndex++;
  }
  let reconciled = reconcileVariant(evidence, variantValuesAgree);
  // GrailKey Directive 2026-08-16-AM — on CORROBORATED agreement (the
  // extracted first-eligible-visual candidate and Vision's own claim
  // describe the same physical attribute, per variantValuesAgree), prefer
  // VISION'S own text as the displayed/canonical value, not the extracted
  // candidate. The extractor's job is to VERIFY, not to REPLACE — it is
  // necessarily a subset of recognized tokens (creator/event/print-run/
  // auth/specific-axis registries), while Vision's free text is typically
  // richer and, once corroborated, there is no reason to discard the
  // extra, unrecognized-but-real detail it carries (found regression-
  // testing the Sabrina shape: recognizing "NYCC" as an event token newly
  // let first-eligible-visual corroborate Vision's claim, but naively
  // adopting the WINNER's own thin extracted text — "nycc foil" — would
  // have silently dropped "Dan Parent" and "LTD 50" from a value that was
  // just POSITIVELY VERIFIED as correct, a regression the null-clears
  // fix (F-3) must not create as its own side effect). Only applies on
  // genuine agreement — a CONTESTED result (first-eligible-visual
  // disagreeing with Vision, e.g. Kirkham vs Mayhew) keeps the extracted
  // candidate as the value exactly as before, since in that case Vision's
  // text is the thing being overridden, not corroborated.
  if (reconciled.authority === 'CORROBORATED' && reconciled.source === 'first-eligible-visual') {
    const visionAgrees = reconciled.justifiedBy.find((e) => e.source === 'vision');
    if (visionAgrees) {
      reconciled = { ...reconciled, value: visionAgrees.value };
    }
  }
  console.log(
    `[reconcile-variant] value=${reconciled.value ?? 'null'} source=${reconciled.source ?? 'none'} ` +
    `authority=${reconciled.authority} justifiedBy=${JSON.stringify(reconciled.justifiedBy)} ` +
    `conflicts=${JSON.stringify(reconciled.conflicts)}`
  );
  return { reconciled, candidate: candidateHasDiscriminativeSignal ? candidate : null };
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
    // G.O.D.S. dispatch — collapse punctuated acronyms before the strip below.
    return normalizeAcronyms(String(str))
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

// Ship #24 Q12c — Marketing-copy discriminator, moved here from
// imageSearchIdentity.js so extractIssueCandidate's single implementation
// owns it directly rather than importing back into the module that used
// to define it (identityCore.js has no import of imageSearchIdentity.js —
// keeping the constant here avoids introducing that cycle). Excludes "#1"
// when it appears near marketing keywords (Anniversary Issue #1, Special
// Issue #1, etc.) — unchanged behavior from the original.
export const MARKETING_KEYWORDS_RE = /\b(anniversary|special|collector|limited|exclusive|variant)\b/i;

/**
 * Commit B (2026-07-28) — shared issue-number extractor. Single
 * implementation for both the raw-pool tally (imageSearchIdentity.js's
 * extractIssueFromTitle, which now delegates here) and the family-scoped
 * consensus vote (resolveFamilyIssueConsensus below) — closes the
 * long-queued "Defect B: parser unification" item from the Adventure Time
 * investigation. Patching Q140's own inline regex in isolation would have
 * recreated the exact divergence Defect B named: two independently-evolved
 * extractors, each missing a guard or a signal the other had. Neither
 * previous implementation supported a bare (no "#") issue number at all —
 * confirmed via the real Batman #15 production pool, where 2 of the
 * winning family's 3 members write the issue as bare "Batman 15" (no "#"),
 * so resolveFamilyIssueConsensus's old #-only regex only ever counted 1/3
 * (`[q140] ... ratio=0.33 ... mode=no-consensus`) when all three genuinely
 * name issue 15.
 *
 * Two extraction paths, evaluated in order:
 *  - hash-prefixed "#N" (1-4 digits, capped at 999): always a candidate.
 *    The existing Q12c guard (suspect "#1" near a marketing keyword) is
 *    preserved verbatim.
 *  - bare number, no "#": only a candidate when ALL of the following hold
 *    (this is the literal "Adoption" gate the caller applies when no prior
 *    issue exists — this function supplies the per-row candidate either
 *    way; the corroboration/adoption *consensus* decision itself stays in
 *    the caller, e.g. resolveFamilyIssueConsensus's existing >=3-row/
 *    >=60%/clear-lead bar):
 *      - title-adjacent: a real word (3+ letters) sits within 20 chars
 *        immediately before the number — a proxy for "this number sits
 *        inside actual title text," not an isolated digit token.
 *      - not a 4-digit year (1900-2099).
 *      - not decimal-grade syntax — not immediately preceded or followed
 *        by a "." (excludes "4.5", "0.5" grade fragments).
 *      - not immediately following a CGC/CBCS/PGX grading-service token
 *        within the preceding ~15 chars.
 *      - not lot/quantity/page/volume syntax — no lot/set/bundle/volume/
 *        vol/qty/quantity/page/pg/book/issue/comic vocabulary within the
 *        surrounding ~20 chars on either side ("Lot of 15 comics", "Vol 15",
 *        "15 books", "pg 15").
 *
 * Commit B2 (2026-07-28, URGENT regression repair) — Commit B shipped with
 * the Q12c marketing-keyword check as a HARD, unconditional exclusion
 * inside the extractor itself, same as every other guard. That was wrong:
 * it broke the real, already-certified Adventure Time Summer Special #1
 * fixture in production (build 9c802fb) — all 4 real winning-family
 * members write the issue as "...Special #1...", and 3 of 4 also carry
 * "Exclusive"/"Variant" nearby, so every single one hit the marketing-
 * keyword window and the family-scoped vote saw ZERO candidates
 * (mode=no-consensus, winner=null) instead of the correct unanimous
 * adopt (this book's own OFFICIAL title genuinely contains "Special" —
 * exactly the shape Q12c's global/raw-pool guard was built to distrust,
 * but the FAMILY-SCOPED consensus vote (>=3-row/>=60%/clear-lead) is
 * already sufficient protection against a stray marketing-copy "#1" on
 * its own, and doesn't need — and must not carry — the same suppression).
 *
 * Fix: extraction (raw observation) and suppression (policy) are now
 * separate. This function never returns null purely because of nearby
 * marketing language — it reports `marketingContext: true` on the
 * candidate and lets the caller decide:
 *   - RAW/GLOBAL pool (extractIssueFromTitle, feeding extractConsensus's
 *     pool-wide tally): suppresses on marketingContext, exactly the
 *     pre-Commit-B behavior (single-row, no corroborating structure).
 *   - FAMILY-SCOPED (resolveFamilyIssueConsensus below): does NOT
 *     suppress on marketingContext — counts the candidate, trusting its
 *     own adoption bar.
 *
 * ordinalContext ("2nd Print") and ratioContext ("1:25") are a different
 * kind of signal, not context-dependent policy — a print-ordinal or a
 * ratio numerator is NEVER an issue number, in any caller, in any
 * context (unlike a marketing-adjacent "#1", which genuinely IS the
 * issue number in the Adventure Time case). Both remain hard exclusions
 * inside the extractor itself, same tier as year/decimal-grade/CGC/lot/
 * dimension. Added this pass after direct testing surfaced two more real
 * false positives: "Absolute Batman 2nd Print" -> "2", "Wonder Woman
 * 1:25 Foil Variant" -> "1".
 *
 * Pure function, no console/log side effects — callers decide what to log.
 *
 * @param {string} title
 * @returns {{issue: string, matchType: 'hash'|'bare', marketingContext: boolean, ordinalContext: boolean, ratioContext: boolean, titleAdjacency: boolean}|null}
 */
const ISSUE_CANDIDATE_YEAR_RE = /^(19|20)\d{2}$/;
const ISSUE_CANDIDATE_GRADING_RE = /\b(cgc|cbcs|pgx)\b/i;
// Directional and anchored, not a wide unanchored window: "lot of 15",
// "vol 15" precede the number; "15 comics", "15 books", "3 issues", "pg 15"
// follow it (or precede for "pg"/"pgs"). An earlier unanchored version of
// this check falsely rejected "D.C. Comics Batman 15" — "Comics" (the
// publisher name) sitting anywhere in a wide before-window matched
// "comics?" even though it has nothing to do with a quantity phrase next
// to the number. Anchoring to immediately-before/-after closes that.
const ISSUE_CANDIDATE_LOT_BEFORE_RE = /\b(lot|set|bundle|volume|vol\.?|qty|quantity|pg\.?|pgs?)\s*(of\s+)?$/i;
const ISSUE_CANDIDATE_LOT_AFTER_RE = /^\s*(comics?|books?|issues?|pages?|pgs?|pg\.?)\b/i;
const ISSUE_CANDIDATE_WORD_NEARBY_RE = /[a-z]{3,}/i;
// Commit B2 — ordinal print/edition suffix immediately after the number
// ("2nd Print", "3rd Printing", "4th Edition") and the spelled-out form
// immediately before it ("Second Printing 2" — rare, included for
// symmetry). Never an issue number regardless of caller.
const ISSUE_CANDIDATE_ORDINAL_AFTER_RE = /^(st|nd|rd|th)\b/i;
const ISSUE_CANDIDATE_PRINT_EDITION_AFTER_RE = /^\s*(print|printing|edition|ed\.?)\b/i;
const ISSUE_CANDIDATE_PRINT_EDITION_BEFORE_RE = /\b(print|printing|edition)\s*$/i;

const hasMarketingContext = (titleStr, idx, matchLen) => {
  const window = titleStr.slice(Math.max(0, idx - 30), idx) + titleStr.slice(idx, idx + matchLen + 30);
  return MARKETING_KEYWORDS_RE.test(window);
};

export const extractIssueCandidate = (title) => {
  const titleStr = String(title || '');
  if (!titleStr) return null;

  // Trailing (?!\d), not \b: a lettered sub-issue ("#5C", "#1B") has no
  // word-boundary between the digit and the following letter (both are
  // \w), so a \b-anchored regex silently fails to match at all — a real
  // divergence the two pre-Commit-B implementations had (imageSearchIdentity
  // used (?!\d) and handled "#5C" correctly; identityCore's own inline
  // regex used \b and did not) — unified onto the correct behavior.
  const hashMatch = titleStr.match(/#\s*(\d{1,4})(?!\d)/);
  if (hashMatch && parseInt(hashMatch[1], 10) <= 999) {
    const issueNum = hashMatch[1];
    const idx = hashMatch.index;
    const marketingContext = issueNum === '1' && hasMarketingContext(titleStr, idx, hashMatch[0].length);
    return { issue: issueNum, matchType: 'hash', marketingContext, ordinalContext: false, ratioContext: false, titleAdjacency: true };
  }

  const bareMatches = [...titleStr.matchAll(/\b(\d{1,4})(?!\d)/g)];
  for (const bm of bareMatches) {
    const numStr = bm[1];
    const idx = bm.index;
    const n = parseInt(numStr, 10);
    if (n === 0 || n > 999) continue;
    if (ISSUE_CANDIDATE_YEAR_RE.test(numStr)) continue;

    const charBefore = titleStr[idx - 1];
    const charAfter = titleStr[idx + numStr.length];
    if (charBefore === '.' || charAfter === '.') continue; // decimal-grade syntax
    if (charBefore === ':' || charAfter === ':') continue; // ratio syntax ("1:25", "25:1")

    const before = titleStr.slice(Math.max(0, idx - 20), idx);
    const after = titleStr.slice(idx + numStr.length, idx + numStr.length + 20);
    const gradingWindow = titleStr.slice(Math.max(0, idx - 15), idx);

    // Dimension syntax ("2X3", "11x17", "16x24 inch") — the leading number
    // of a WxH product-size pair is not an issue number. Found via a real
    // Flash #139 pool title, "FLASH COMIC BOOK COVER *2X3 FRIDGE MAGNET*":
    // "2" cleared every other guard (title-adjacent to "FLASH", not a year,
    // not decimal, not CGC/lot) and was wrongly adopted. Checks both
    // directions ("2x3" and "3x2" read from the trailing side).
    if (/^\s*[x×]\s*\d/i.test(after) || /\d\s*[x×]\s*$/i.test(before)) continue;

    // Ordinal print/edition suffix ("2nd Print", "3rd Printing") — never
    // an issue number. Found via direct testing: "Absolute Batman 2nd
    // Print" -> "2" survived every pre-existing guard.
    if (ISSUE_CANDIDATE_ORDINAL_AFTER_RE.test(after)) continue;
    if (ISSUE_CANDIDATE_PRINT_EDITION_AFTER_RE.test(after) || ISSUE_CANDIDATE_PRINT_EDITION_BEFORE_RE.test(before)) continue;

    if (ISSUE_CANDIDATE_GRADING_RE.test(gradingWindow)) continue;
    if (ISSUE_CANDIDATE_LOT_BEFORE_RE.test(before) || ISSUE_CANDIDATE_LOT_AFTER_RE.test(after)) continue;
    if (!ISSUE_CANDIDATE_WORD_NEARBY_RE.test(before)) continue; // title-adjacent

    const marketingContext = numStr === '1' && hasMarketingContext(titleStr, idx, numStr.length);
    return { issue: numStr, matchType: 'bare', marketingContext, ordinalContext: false, ratioContext: false, titleAdjacency: true };
  }

  return null;
};

/**
 * Q140 corrective dispatch (2026-07-23, Flash #139/#128, Adventure Time,
 * Immortal Hulk #44, Wonder Woman #1 class) — issue-consensus contract.
 *
 * The original Q140 dispatch (2026-07-22) fixed the pool-wide-vote leak by
 * reading "#N" off the winning family's OWN topFamily.rawTitle instead of
 * ebay.issue — but that single representative row is still just one
 * listing's text. A single row can misprint, can be a different
 * printing/anniversary reissue sharing the same family, or can simply be
 * the one row eBay happened to rank first. This replaces the single-row
 * read with an aggregate vote across every member row of the winning
 * family, and adds an explicit contract for what "confirmed" means:
 *
 *   - missing issue + >=3 unique family rows + >=60% explicit agreement +
 *     a clear lead over the runner-up -> ADOPT the winner.
 *   - present issue + the family's own aggregate agrees -> CORROBORATE
 *     only (issue is unchanged; agreement is annotated, never treated as
 *     a fresh assignment). "Agrees" means the SAME adoption bar
 *     (>=3-row / >=60% / clear-lead) — a single matching row out of five
 *     is not corroboration, it's noise that happens to match; labeling it
 *     'corroborated' would silently bypass the exact bar this rewrite
 *     exists to enforce. A weak match reports 'no-consensus' (the prior
 *     issue is still preserved — this only affects the CONFIDENCE LABEL
 *     surfaced to callers, never the value).
 *   - present issue + the family's own aggregate disagrees -> NEVER
 *     overwrite. Lock the conflict (issue is unchanged; the disagreement
 *     is annotated so callers can decide whether to escalate).
 *   - a single representative rawTitle can never, by itself, establish an
 *     issue — every candidate must come from a >=3-row aggregate.
 *   - a "disagreement" that itself never clears the adoption bar (a
 *     scattered handful of stray, non-consensus mentions) is NOT a
 *     conflict. Locking requires a genuine COMPETING consensus — the
 *     disagreeing candidate must independently pass the exact same
 *     >=3-row / >=60% / clear-lead bar adoption would require. Otherwise
 *     noise in an inconclusive family could manufacture a conflict flag
 *     against a perfectly good prior issue.
 *
 * Denominator note (2026-07-23 review correction): ratio is computed
 * against ALL unique family rows (uniqueRows), including rows with no
 * extractable "#N" token at all — never just the subset of rows where an
 * issue happened to parse. Matches the established codebase precedent in
 * imageSearchIdentity.js's extractConsensus (Q-ADV397, 2026-07-15): "this
 * function's old tally counted only rows with a parseable issue number...
 * extractConsensus counts the full pool — a real production case cleared
 * the old ad-hoc bar at the wrong denominator." Same lesson, applied here.
 *
 * Dedup note: rows are deduplicated by, in preference order, eBay itemId,
 * legacyItemId, normalized itemWebUrl (query/tracking params stripped —
 * more stable than the raw URL, which can vary by tracking params on
 * otherwise-identical listings), then exact rawTitle text as the final
 * fallback (e.g. hand-built test fixtures with no URL at all). itemId/
 * legacyItemId are not present anywhere in the current pipeline's parsed-
 * row shape (extractIdentityFromImageSearch only preserves itemWebUrl) —
 * checked first anyway so a future field addition is picked up
 * automatically with no change here. Prevents the same listing
 * re-appearing under re-scraped/re-paginated title text from being counted
 * as two independent corroborating rows, and — the more common real case —
 * prevents two rows that happen to share identical title text but are
 * genuinely different listings from being collapsed into one.
 *
 * Tie note: when multiple candidates share the top count (e.g. a 3-3
 * split), `winner` is null and `tiedCandidates` lists every tied
 * candidate with its count — never an arbitrary `ranked[0]` pick, which
 * would misleadingly look like a real winner when it's just an accident
 * of object-key insertion order.
 *
 * A fifth, distinct outcome — `mode: 'no-data'` — covers the case where no
 * per-row family data was even available to consult at all (no indices, no
 * visualItems, or none of the referenced rows carried usable text). This is
 * NOT "the family disagrees" (there's no family signal to disagree WITH) —
 * it returns `issue: null` unconditionally so the caller falls through to
 * its own pre-existing fallback chain (e.g. ebay.issue / vision.issue) —
 * the exact, already-correct behavior for a family whose own text simply
 * carries no issue token at all (X-Men Anniversary Special class, Q12c's
 * original case). Conflating this with "disagreement" would silently lock
 * out a real, independent signal (eBay's separately-computed pool-wide
 * consensus) that was never part of the single-row-extraction problem this
 * dispatch closes.
 *
 * Pure function, no console/log side effects — callers decide what to log.
 *
 * @param {string|null} priorIssue - issue already resolved before this
 *   family was consulted (e.g. vision.issue, or null when Vision has none)
 * @param {Array<Object|string>} visualItems - full visual pool (opts.visualItems)
 * @param {Array<number>} indices - family.topFamily.indices
 * @returns {{issue: string|null, mode: 'adopted'|'corroborated'|'conflict-locked'|'no-consensus'|'no-data', winner: string|null, support: number, ratio: number, uniqueRows: number, runnerUp: string|null, runnerUpSupport: number, tiedCandidates: Array<{issue: string, count: number}>}}
 */
export const resolveFamilyIssueConsensus = (priorIssue, visualItems, indices) => {
  const rows = Array.isArray(indices) ? indices : [];
  const seenKeys = new Set();
  const counts = {};
  let uniqueRows = 0;

  const normalizeUrl = (u) => {
    const s = String(u);
    const qIdx = s.indexOf('?');
    return qIdx === -1 ? s : s.slice(0, qIdx);
  };

  for (const idx of rows) {
    const item = visualItems?.[idx];
    const raw = String(typeof item === 'string' ? item : (item?.rawTitle || item?.title || '')).trim();
    if (!raw) continue;
    // Commit C.1 (Strange Tales dispatch) — a photocopy/USB/digital-
    // archive/scan-disc row must never count toward uniqueRows (the Q140
    // denominator) or cast an issue-candidate vote — same reasoning as
    // buildTitleFamilies' identical exclusion (imageSearchIdentity.js):
    // it's not a genuine physical copy of anything, and has no standing
    // to vote on what issue this family agrees on.
    if (NON_GENUINE_COPY_RE.test(raw)) continue;
    // Dedup key preference: itemId -> legacyItemId -> normalized
    // itemWebUrl -> rawTitle text. See doc comment above.
    let dedupKey;
    if (typeof item !== 'string' && item?.itemId) {
      dedupKey = `id:${item.itemId}`;
    } else if (typeof item !== 'string' && item?.legacyItemId) {
      dedupKey = `legacy:${item.legacyItemId}`;
    } else if (typeof item !== 'string' && item?.itemWebUrl) {
      dedupKey = `url:${normalizeUrl(item.itemWebUrl)}`;
    } else {
      dedupKey = `title:${raw}`;
    }
    if (seenKeys.has(dedupKey)) continue; // same listing (or identical text) — not a second "row"
    seenKeys.add(dedupKey);
    uniqueRows += 1;
    // Commit B — shared extractor (extractIssueCandidate), no longer this
    // function's own inline #-only regex. Now also counts a bare (no "#")
    // issue-adjacent number when it clears the guard list (not a year, not
    // decimal-grade syntax, not a grading-service token, not lot/volume/
    // page vocabulary) — the real gap this dispatch closes (Batman #15:
    // 2 of 3 winning-family rows write the issue as bare "Batman 15").
    //
    // Commit B2 — deliberately does NOT check candidate.marketingContext.
    // The real, already-certified Adventure Time Summer Special #1 fixture
    // writes the issue as "...Special #1..." on every one of its 4
    // winning-family members, 3 of which also carry "Exclusive"/"Variant"
    // nearby — every one is marketingContext:true, and this book's own
    // OFFICIAL title genuinely contains "Special." Q12c's suppression
    // exists to protect the RAW/GLOBAL single-row pool tally (see
    // extractIssueFromTitle, imageSearchIdentity.js, which DOES apply it)
    // from a lone marketing-copy "#1" with nothing corroborating it. A
    // family-scoped vote is a different situation by construction: it
    // already requires >=3 unique rows, >=60% agreement, and a clear lead
    // before adopting anything (the exact bar below) — that bar is
    // itself the protection against marketing fluff, and applying Q12c's
    // suppression ON TOP of it (as Commit B briefly did, unintentionally)
    // doesn't add safety, it just breaks unanimous real agreement on a
    // book whose own official title happens to say "Special."
    const candidate = extractIssueCandidate(raw);
    if (candidate) counts[candidate.issue] = (counts[candidate.issue] || 0) + 1;
  }

  if (uniqueRows === 0) {
    return { issue: null, mode: 'no-data', winner: null, support: 0, ratio: 0, uniqueRows: 0, runnerUp: null, runnerUpSupport: 0, tiedCandidates: [], assertedIssues: [] };
  }

  // Track B Phase 0, Commit 4.3 (Matrix B / rider F, Option A) — the
  // distinct-issue-values-asserted list, additive to this function's
  // return shape. Mirrors resolveFamilyYearConsensus's own pre-existing
  // `assertedYears` field exactly (same purpose, same naming convention)
  // — exposes what `counts` already computed above, no new counting
  // mechanism. Lets a caller answer "does value X have ANY support in
  // this family" (`assertedIssues.includes(String(X))`) without a second,
  // parallel presence-scan. Existing callers destructuring named fields
  // are unaffected; the Commit 4.1/4.2 test suites' own exact-shape
  // assertions were audited (2026-07-30) and one (q-trackB-commit4.2's
  // FIXTURE B full-shape check) was updated to include this field.
  const assertedIssues = Object.keys(counts);
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const topCount = ranked[0]?.[1] ?? 0;
  // How many distinct candidates share the top count — >1 means a genuine
  // tie (e.g. 3-3). `ranked`'s stable sort preserves insertion order among
  // ties, so `ranked[0]` would otherwise arbitrarily "win" a tie purely by
  // which row happened to be processed first — not a real signal. A tie
  // must never be treated as a winner for either corroboration OR
  // conflict-locking, regardless of which side it coincidentally matches.
  const tiedEntries = ranked.filter(([, c]) => c === topCount);
  const tiedForTop = tiedEntries.length;
  const winner = tiedForTop === 1 ? (ranked[0]?.[0] ?? null) : null;
  const winnerCount = tiedForTop === 1 ? topCount : 0;
  const tiedCandidates = tiedForTop > 1 ? tiedEntries.map(([issue, count]) => ({ issue, count })) : [];
  const runnerUp = tiedForTop === 1 ? (ranked[1]?.[0] ?? null) : null;
  const runnerUpCount = tiedForTop === 1 ? (ranked[1]?.[1] ?? 0) : 0;
  // Denominator = ALL unique family rows, not just issue-bearing ones.
  const ratio = uniqueRows > 0 ? winnerCount / uniqueRows : 0;
  // Strictly greater — a tie (including a 3-3 tie) never clears the bar.
  const clearLead = winner != null && winnerCount > runnerUpCount;
  const meetsAdoptionBar = uniqueRows >= 3 && ratio >= 0.6 && clearLead;

  if (priorIssue != null) {
    if (winner == null || !meetsAdoptionBar) {
      // No usable candidate, a genuine tie, or a real-but-weak match/
      // disagreement that never clears the adoption bar (BLOCKER 1 fix,
      // 2026-07-23 review: a single matching row out of five used to be
      // labeled 'corroborated' just because it happened to equal
      // priorIssue, checked BEFORE the adoption bar — silently bypassing
      // the exact bar this whole rewrite exists to enforce). None of
      // these is a real signal either way — the prior issue is still
      // preserved (this only affects the CONFIDENCE LABEL, never the
      // value), reported honestly as 'no-consensus'.
      return { issue: priorIssue, mode: 'no-consensus', winner, support: winnerCount, ratio, uniqueRows, runnerUp, runnerUpSupport: runnerUpCount, tiedCandidates, assertedIssues };
    }
    if (String(winner) === String(priorIssue)) {
      return { issue: priorIssue, mode: 'corroborated', winner, support: winnerCount, ratio, uniqueRows, runnerUp, runnerUpSupport: runnerUpCount, tiedCandidates, assertedIssues };
    }
    // Disagreement that DOES clear the adoption bar — a genuine competing
    // consensus. Locked, never overwritten.
    return { issue: priorIssue, mode: 'conflict-locked', winner, support: winnerCount, ratio, uniqueRows, runnerUp, runnerUpSupport: runnerUpCount, tiedCandidates, assertedIssues };
  }

  if (meetsAdoptionBar) {
    return { issue: winner, mode: 'adopted', winner, support: winnerCount, ratio, uniqueRows, runnerUp, runnerUpSupport: runnerUpCount, tiedCandidates, assertedIssues };
  }
  return { issue: null, mode: 'no-consensus', winner, support: winnerCount, ratio, uniqueRows, runnerUp, runnerUpSupport: runnerUpCount, tiedCandidates, assertedIssues };
};

// GrailKey Dispatch 25, Fix 2c (2026-08-07) — per-row issue tally,
// logging-only helper for resolveIdentity's near-miss axis-check.
// Deliberately a local mirror of resolveFamilyIssueConsensus's own
// row-counting loop (same dedup-key preference, same NON_GENUINE_COPY_RE
// exclusion, same extractIssueCandidate call) rather than a new field
// added to resolveFamilyIssueConsensus's own return shape — that shape is
// spread verbatim (`...issueMeasurement`) into familyIssueConsensusResult
// at multiple call sites, at least one of which (Commit 4.2's Fixture B)
// has an existing exact-full-object-shape regression assertion; adding a
// field there would silently break it. This tally is read-only, used only
// for log detail, and never feeds any decision.
const tallyFamilyIssueCounts = (indices, visualItems) => {
  const rows = Array.isArray(indices) ? indices : [];
  const seenKeys = new Set();
  const counts = {};
  const normalizeUrl = (u) => {
    const s = String(u);
    const qIdx = s.indexOf('?');
    return qIdx === -1 ? s : s.slice(0, qIdx);
  };
  for (const idx of rows) {
    const item = visualItems?.[idx];
    const raw = String(typeof item === 'string' ? item : (item?.rawTitle || item?.title || '')).trim();
    if (!raw) continue;
    if (NON_GENUINE_COPY_RE.test(raw)) continue;
    let dedupKey;
    if (typeof item !== 'string' && item?.itemId) dedupKey = `id:${item.itemId}`;
    else if (typeof item !== 'string' && item?.legacyItemId) dedupKey = `legacy:${item.legacyItemId}`;
    else if (typeof item !== 'string' && item?.itemWebUrl) dedupKey = `url:${normalizeUrl(item.itemWebUrl)}`;
    else dedupKey = `title:${raw}`;
    if (seenKeys.has(dedupKey)) continue;
    seenKeys.add(dedupKey);
    const candidate = extractIssueCandidate(raw);
    if (candidate) counts[candidate.issue] = (counts[candidate.issue] || 0) + 1;
  }
  return counts;
};

// GrailKey Dispatch 26, Fix 4 (2026-08-08) — per-row asserting-title
// extractor for the zero-support unanimous-rescue predicate's title-text-
// independence check (evaluateTitleTextIndependence, issueAuthority.js).
// SAME population as resolveFamilyIssueConsensus/tallyFamilyIssueCounts
// above — identical dedup-key preference, identical NON_GENUINE_COPY_RE
// exclusion, identical extractIssueCandidate gate for "asserting" — this
// is deliberate, not incidental: the title-independence check must
// cluster exactly the rows the issue-tally counted, never a silently
// different population (Fix 2b's "wrong population" lesson, applied on
// the way in this time rather than caught after the fact — see the
// Pattern Library). A silent row (no extractable issue candidate) is
// neutral here exactly as it is in the tally above — it contributes no
// title to cluster and no vote either.
export const getAssertingIssueRows = (indices, visualItems) => {
  const rows = Array.isArray(indices) ? indices : [];
  const seenKeys = new Set();
  const asserting = [];
  const normalizeUrl = (u) => {
    const s = String(u);
    const qIdx = s.indexOf('?');
    return qIdx === -1 ? s : s.slice(0, qIdx);
  };
  for (const idx of rows) {
    const item = visualItems?.[idx];
    const raw = String(typeof item === 'string' ? item : (item?.rawTitle || item?.title || '')).trim();
    if (!raw) continue;
    if (NON_GENUINE_COPY_RE.test(raw)) continue;
    let dedupKey;
    if (typeof item !== 'string' && item?.itemId) dedupKey = `id:${item.itemId}`;
    else if (typeof item !== 'string' && item?.legacyItemId) dedupKey = `legacy:${item.legacyItemId}`;
    else if (typeof item !== 'string' && item?.itemWebUrl) dedupKey = `url:${normalizeUrl(item.itemWebUrl)}`;
    else dedupKey = `title:${raw}`;
    if (seenKeys.has(dedupKey)) continue;
    seenKeys.add(dedupKey);
    const candidate = extractIssueCandidate(raw);
    if (candidate) asserting.push({ idx, rawTitle: raw });
  }
  return asserting;
};

// GrailKey Dispatch 26, Fix 4b (2026-08-08) — year-axis mirror of
// getAssertingIssueRows, above. SAME asserting criterion
// issueAuthority.js's analyzeYearAssertions uses for its own promotion
// predicate (a structured `item.year` field present — never re-parsed
// from rawTitle text, matching resolveFamilyYearConsensus's own field
// source) — required so the year-axis title-independence check clusters
// exactly the rows the year-promotion predicate counted, never a
// silently different population (same population-consistency
// requirement Fix 4's issue-axis rescue was built under). Deliberately
// does NOT apply the dedup-key/NON_GENUINE_COPY_RE screen
// getAssertingIssueRows uses — analyzeYearAssertions itself has no such
// screen either (it dedupes nothing, excludes nothing beyond "does this
// row have a year field") — reusing a stricter population here would
// once again be measuring against the wrong population, the exact
// disease this comment exists to avoid.
export const getAssertingYearRows = (indices, visualItems) => {
  const rows = Array.isArray(indices) ? indices : [];
  const asserting = [];
  for (const idx of rows) {
    const item = visualItems?.[idx];
    if (item == null) continue;
    const rowYear = typeof item !== 'string' ? item?.year : null;
    if (rowYear == null) continue;
    const raw = String(typeof item === 'string' ? item : (item?.rawTitle || item?.title || '')).trim();
    if (!raw) continue;
    asserting.push({ idx, rawTitle: raw });
  }
  return asserting;
};

/**
 * Track B Phase 0, Commit 4.1 — family-scoped year consensus. Mirrors
 * resolveFamilyIssueConsensus's own scoping pattern (family.topFamily.indices
 * only, never the pool-wide visualConsensus/extractConsensus object), for
 * the identical reason: resolveIdentity's family-override branch previously
 * read `ebay?.year` — the POOL-WIDE year consensus (extractConsensus,
 * imageSearchIdentity.js), gated on >=50%-of-the-ENTIRE-pool agreement —
 * which is structurally near-guaranteed null for a family that's a genuine
 * minority within a larger, mixed pool. Confirmed empirically, not assumed:
 * the real Spawn #351 production log shows `[year-ebay] raw="undefined"
 * int=null ratio=0.00 authoritative=null` for a 16-row pool spanning five
 * different Spawn products/years, even though the winning family's own rows
 * unanimously assert "2024".
 *
 * Reads the ALREADY-COMPUTED `.year` field each visualItems row carries
 * (extractYearFromTitle, computed once at parse time by
 * extractIdentityFromImageSearch, imageSearchIdentity.js) rather than
 * recomputing from raw title text the way resolveFamilyIssueConsensus
 * recomputes `.issue` via extractIssueCandidate. Deliberately different, not
 * an inconsistency: extractIssueCandidate's recomputation exists
 * specifically to bypass Q12c's marketing-copy issue-suppression guard (a
 * real, documented upstream field-level gap for issue specifically) — no
 * equivalent suppression exists for year, so reading the cached field is
 * both correct and avoids a new cross-file import (extractYearFromTitle
 * lives in imageSearchIdentity.js, which already imports FROM this file —
 * importing back would create a cycle).
 *
 * Behavior matrix (five cases, one function, per the Commit 4.1 dispatch):
 *   A. priorYear null + >=2 unique rows assert ONE unanimous year (no
 *      other row asserts a DIFFERENT year) -> mode:'adopted', year:winner
 *   B. priorYear null + fewer than 2 rows assert any year at all
 *      -> mode:'no-data', year:null. Absence is not agreement, and is
 *      also not disagreement — no adoption, no conflict.
 *   C. priorYear null + two or more DIFFERENT years are each asserted by
 *      at least one row -> mode:'conflict-locked', year:null. A genuine
 *      internal disagreement — never treated as a clean family regardless
 *      of whether one year has more support than another.
 *   D. priorYear present + every row that asserts a year agrees with it
 *      (or no row asserts a year at all) -> mode:'preserved', year:priorYear
 *   E. priorYear present + at least one row asserts a DIFFERENT year
 *      -> mode:'conflict-locked', year:priorYear (never overwritten)
 *
 * Same dedup discipline as resolveFamilyIssueConsensus (itemId ->
 * legacyItemId -> normalized itemWebUrl -> raw title text) so a literal
 * duplicate/relisted row is never counted twice toward the vote.
 *
 * Commit 4.2 — `priorYear` is normalized via `normalizeOptionalYear`
 * (yearEvidence.js) as the first step, before any branch above runs. A
 * semantic placeholder (e.g. Vision's own literal "Unknown" string) is
 * treated exactly as `null` — every case in the matrix above already
 * describes "priorYear null" behavior; this just ensures a placeholder
 * string reaches that same behavior instead of being trusted as real.
 *
 * @param {string|number|null} priorYear
 * @param {Array} visualItems
 * @param {number[]} indices
 * @returns {{year: string|number|null, mode: 'adopted'|'no-data'|'conflict-locked'|'preserved', assertedYears: string[], uniqueRows: number, support: number}}
 */
export const resolveFamilyYearConsensus = (priorYear, visualItems, indices) => {
  // Track B Phase 0, Commit 4.2 — resolver-entry boundary normalization,
  // the FIRST executable trust-decision step, before any prior-year
  // branch below runs. Confirmed live in production: Vision's own year
  // field can be the literal string "Unknown" — a truthy, non-null value
  // `?? null` at any caller does not intercept — which was being trusted
  // as a real prior year, landing in the conflict-locked branch below
  // against the family's own legitimate asserted year and suppressing
  // adoption. This function defends its own boundary (not the caller,
  // per architectural review — resolveIdentity carries no duplicate
  // placeholder defense, and every future caller of this function
  // inherits the protection automatically). See yearEvidence.js for the
  // canonical placeholder set, shared with buildFingerprintYearToken
  // (issueAuthority.js) so the two never drift.
  const normalizedPriorYear = normalizeOptionalYear(priorYear);
  const rows = Array.isArray(indices) ? indices : [];
  const seenKeys = new Set();
  const assertedYears = new Set();
  let uniqueRows = 0;
  let yearBearingRows = 0;

  const normalizeUrl = (u) => {
    const s = String(u);
    const qIdx = s.indexOf('?');
    return qIdx === -1 ? s : s.slice(0, qIdx);
  };

  for (const idx of rows) {
    const item = visualItems?.[idx];
    if (item == null) continue;
    const raw = String(typeof item === 'string' ? item : (item?.rawTitle || item?.title || '')).trim();
    if (!raw) continue;
    let dedupKey;
    if (typeof item !== 'string' && item?.itemId) {
      dedupKey = `id:${item.itemId}`;
    } else if (typeof item !== 'string' && item?.legacyItemId) {
      dedupKey = `legacy:${item.legacyItemId}`;
    } else if (typeof item !== 'string' && item?.itemWebUrl) {
      dedupKey = `url:${normalizeUrl(item.itemWebUrl)}`;
    } else {
      dedupKey = `title:${raw}`;
    }
    if (seenKeys.has(dedupKey)) continue;
    seenKeys.add(dedupKey);
    uniqueRows += 1;

    const rowYear = typeof item !== 'string' ? item?.year : null;
    if (rowYear != null) {
      yearBearingRows += 1;
      assertedYears.add(String(rowYear));
    }
  }

  const distinctYears = [...assertedYears];

  if (normalizedPriorYear != null) {
    if (distinctYears.length === 0 || (distinctYears.length === 1 && distinctYears[0] === String(normalizedPriorYear))) {
      return { year: normalizedPriorYear, mode: 'preserved', assertedYears: distinctYears, uniqueRows, support: yearBearingRows };
    }
    // At least one row asserts a year different from normalizedPriorYear
    // (whether or not the rest agree with it) — a genuine conflict against
    // trusted data. Never overwritten.
    return { year: normalizedPriorYear, mode: 'conflict-locked', assertedYears: distinctYears, uniqueRows, support: yearBearingRows };
  }

  if (distinctYears.length === 0) {
    return { year: null, mode: 'no-data', assertedYears: distinctYears, uniqueRows, support: yearBearingRows };
  }
  if (distinctYears.length > 1) {
    return { year: null, mode: 'conflict-locked', assertedYears: distinctYears, uniqueRows, support: yearBearingRows };
  }
  // Exactly one distinct year asserted, no prior to conflict with — still
  // needs >=2 unique rows actually ASSERTING it (not just >=2 unique rows
  // total in the family) per case A's explicit wording — a lone assertion
  // inside an otherwise year-silent family is not yet a vote.
  if (yearBearingRows >= 2) {
    return { year: distinctYears[0], mode: 'adopted', assertedYears: distinctYears, uniqueRows, support: yearBearingRows };
  }
  return { year: null, mode: 'no-data', assertedYears: distinctYears, uniqueRows, support: yearBearingRows };
};

/**
 * Commit A.1/A.3 (Strange Tales dispatch, 2026-07-28) — terminal
 * query-issue authority. Same single-writer philosophy as
 * detectVisualIssueDivergence just below (Q140), applied one step
 * earlier: a market-request query's own embedded "#N" text must agree
 * with confirmedIssue, or the request must not fire with an issue term
 * at all.
 *
 * Root cause this closes: `imageSearchTitle` (api/enrich.js) defaults to
 * a raw, PRE-identity-resolution eBay pool title
 * (`visualResult?.items?.[0]?.rawTitle`) that can read "Strange Tales #1
 * ..." regardless of what identity resolution later concludes. It's only
 * rebuilt/nulled inside three specific branches (family-candidate
 * accepted, fallback-vision, variant-scan) — there was no unconditional,
 * terminal check that re-syncs it to the FINAL confirmedIssue once
 * resolveIdentity has actually run, so a genuinely-unresolved
 * (confirmedIssue === null) scan could still fire a comps search
 * attempt embedding a stale "#1" from Vision's original, since-
 * superseded guess. This is called ONCE, at the actual query-construction
 * call site, immediately before fetchComps — not inside any of those
 * three upstream branches — so it can't be bypassed by a fourth branch
 * this dispatch didn't anticipate.
 *
 * Handles both directions: confirmedIssue null -> any embedded issue
 * term is stripped (the request fires with no issue term at all, per
 * item 3's exact wording); confirmedIssue present -> an embedded term
 * that DISAGREES is stripped too (defensive — catches any future class
 * of drift between the query text and the authoritative confirmedIssue,
 * not just the null case this dispatch was filed for). A query with no
 * embedded issue term at all, or one that already agrees, passes through
 * unchanged.
 *
 * @param {string|null} candidateQueryText
 * @param {string|number|null} confirmedIssue
 * @returns {string|null}
 */
export const enforceQueryIssueAuthority = (candidateQueryText, confirmedIssue) => {
  if (!candidateQueryText) return candidateQueryText;
  const m = String(candidateQueryText).match(/#\s*(\d+)/);
  if (confirmedIssue == null) {
    return m ? null : candidateQueryText;
  }
  if (m && m[1] !== String(confirmedIssue)) {
    return null;
  }
  return candidateQueryText;
};

/**
 * Q140 corrective dispatch (2026-07-23) — terminal fingerprint invariant.
 *
 * confirmedIssue (resolved above, pre-pricing — drives comp search and
 * pricing math) and out.issue (pre-response — the field the card actually
 * renders) are two independent writer chains in api/enrich.js. A
 * downstream, pre-response read of the raw visual pool's own issueSource
 * (visualResult.issue) used to be allowed to overwrite out.issue directly,
 * with no check against confirmedIssue — so a card could silently ship an
 * issue number that disagreed with the one its own price was computed
 * against. This makes that disagreement a visible, non-blocking
 * annotation instead of a silent divergence: confirmedIssue always wins:
 * the terminal out.issue write is the single source of truth.
 *
 * @param {string|null} confirmedIssue - the pre-pricing resolved issue
 * @param {string|null} visualIssue - a separately-sourced pre-response read
 * @returns {{confirmedIssue: string, visualIssue: string}|null} non-null only when both are present and disagree
 */
export const detectVisualIssueDivergence = (confirmedIssue, visualIssue) => {
  if (confirmedIssue == null || visualIssue == null) return null;
  if (String(confirmedIssue) === String(visualIssue)) return null;
  return { confirmedIssue: String(confirmedIssue), visualIssue: String(visualIssue) };
};

/**
 * Track B Phase 0, Commit 4.3 (Section A/B, Carry-forward A, 2026-07-30) —
 * the "decide" half of the measure/decide split. MEASURING a family's own
 * independent observation (resolveFamilyIssueConsensus/
 * resolveFamilyYearConsensus, called with a null prior — see the retention
 * branch in resolveIdentity below) never mutates anything; this function
 * is the SEPARATE step that compares that measurement against an existing
 * field's value, its independent trust level, and whether it has any
 * support at all within the family, producing exactly one of five
 * outcomes. Corrects an earlier draft's real error: measuring with a null
 * prior and then unconditionally adopting whatever came back is NOT the
 * same as proving an existing field is never silently overwritten —
 * monotonicity must be an explicit property of THIS step, not an
 * accidental consequence of which parameter happened to be passed to the
 * measurement.
 *
 * Five outcomes (exact enum, consumed directly by the shared custody
 * invariant below — never reconstructed from mode-name string matching).
 * IMPLEMENTATION PACKET HOLD — FINAL AUTHORITY-SOURCE HOLD (2026-07-30):
 * authority (whether a prior can override or resist a qualified family) is
 * granted by PROVENANCE (priorSource / priorIndependentlyTrusted) alone,
 * never by confidence. Confidence measures certainty WITHIN a source — it
 * still legitimately affects ONE thing below (whether a zero-support,
 * untrusted disagreement is safe to silently correct, vs. a genuine
 * conflict), never whether a source is trusted in the first place:
 *   - 'adopted' — priorValue was missing/placeholder, family qualifies
 *     (its own null-prior measurement reached its own adoption bar).
 *     resolvedValue = observedFamilyValue. authoritativeForCustody = true.
 *   - 'corroborated' — priorValue present, family qualifies AND agrees.
 *     resolvedValue = priorValue (unchanged — this is confirmation, not a
 *     new assignment). authoritativeForCustody = true.
 *   - 'provisionally-corrected' — priorValue present, NOT independently
 *     trusted (priorIndependentlyTrusted===false), NOT high-confidence
 *     (priorConfidence !== 'high'), AND has ZERO support anywhere within a
 *     qualified, otherwise-unanimous family. resolvedValue =
 *     observedFamilyValue (the family's own value WINS, replacing the
 *     unsupported prior). authoritativeForCustody = true. This is the
 *     Spawn #351 fixture's own path: Vision's issue "301"/year "2020" are
 *     LOW-confidence, untrusted, and have 0/5 family support; the
 *     qualified family's own 5/5-unanimous "351"/"2024" provisionally
 *     corrects them. A silent correction is only safe here because the
 *     prior was never confident about itself either.
 *   - 'preserved-prior' — EITHER the family doesn't qualify at all
 *     (nothing to compare against — prior stands, unaffected) OR the
 *     family qualifies and disagrees but priorValue is independently
 *     trusted (priorIndependentlyTrusted===true — a validated manual/user
 *     correction, or a corroborated catalog authority record; NEVER Vision
 *     alone, regardless of confidence — see isPriorSourceIndependentlyTrusted).
 *     resolvedValue = priorValue, NEVER silently overwritten.
 *     authoritativeForCustody = true only when the prior's own independent
 *     trust justifies it (i.e., the disagree-but-trusted branch) — false
 *     in the no-family-signal branch, since "nothing established" is not
 *     the same as "trusted."
 *   - 'conflicted' — priorValue present, NOT independently trusted, family
 *     qualifies and disagrees, AND EITHER (a) priorValue itself has SOME
 *     support within the family (a genuine, non-unanimous ambiguity — not
 *     the clean zero-support case 'provisionally-corrected' handles), OR
 *     (b) priorValue has ZERO family support but priorConfidence==='high'
 *     — an ordinary Vision read at its own most confident is still not
 *     independent corroboration, and overriding a CONFIDENT (even if
 *     untrusted) assertion silently is not the same risk as overriding an
 *     admittedly-weak one; the disagreement is recorded, not silently
 *     adjudicated either direction. resolvedValue = priorValue (never
 *     overwritten by the family in either sub-case), but
 *     authoritativeForCustody = false — neither side is trusted enough to
 *     drive exact-cache access, authoritative pricing, or response
 *     finalization.
 *
 * Pure, no console/log side effects — the caller decides what to log.
 *
 * @param {Object} params
 * @param {*} params.priorValue - the existing field value before this measurement (e.g. vision.issue)
 * @param {string} [params.priorSource] - 'manual'|'user'|'catalog'|'vision'|'unknown' — WHERE priorValue came from. IMPLEMENTATION PACKET HOLD — FINAL AUTHORITY-SOURCE HOLD (2026-07-30): provenance, not confidence, is what grants independent authority — see isPriorSourceIndependentlyTrusted below and the LAUNCH-AUDIT.md named finding. Accepted here purely for traceability (echoed nowhere internally; the caller is responsible for having already derived priorIndependentlyTrusted from it) — this function does not re-derive trust from the string itself, to keep "decide what a given trust level implies" and "decide what counts as trusted" as separate, independently-testable steps.
 * @param {boolean} params.priorIndependentlyTrusted - true when priorValue's OWN source is independently authoritative (a validated manual/user correction, or a corroborated catalog authority record) — computed by the caller via isPriorSourceIndependentlyTrusted(priorSource, ...), NEVER from confidence and NEVER from a marketplace/pool-derived signal
 * @param {string} [params.priorConfidence] - the source's OWN self-assessed certainty (e.g. Vision's 'low'/'high'). Confidence measures certainty WITHIN a source, not whether that source has independent standing, and NEVER derives priorIndependentlyTrusted — but it DOES still gate one real branch: a disagreeing, untrusted, zero-family-support prior is silently corrected (rule E, 'provisionally-corrected') only when NOT high-confidence; a high-confidence-but-untrusted disagreement in the same zero-support shape becomes a recorded 'conflicted' state instead (rule D) — never silently overridden in either direction.
 * @param {string} params.familyMode - the null-prior measurement's own mode ('adopted'|'no-consensus'|'no-data'|'corroborated'|'conflict-locked' — only 'adopted' means the family itself reached a clean, unanimous-enough-per-its-own-bar conclusion; a null-prior call can never itself return 'corroborated'/'conflict-locked')
 * @param {*} params.familyValue - the null-prior measurement's own resolved value (its `.issue` or `.year`)
 * @param {boolean} params.priorHasSupportInFamily - whether priorValue appears anywhere among the family's own asserted values (assertedIssues/assertedYears) — distinguishes a clean zero-support correction from a genuine ambiguity
 * @returns {{observedFamilyValue: *, resolvedValue: *, outcome: 'adopted'|'corroborated'|'provisionally-corrected'|'preserved-prior'|'conflicted', authoritativeForCustody: boolean}}
 */
export const decideFieldAuthority = ({ priorValue, priorSource, priorIndependentlyTrusted, priorConfidence, familyMode, familyValue, priorHasSupportInFamily }) => {
  const priorIsPlaceholder = priorValue == null;
  const familyQualifies = familyMode === 'adopted';

  if (priorIsPlaceholder) {
    if (familyQualifies) {
      return { observedFamilyValue: familyValue, resolvedValue: familyValue, outcome: 'adopted', authoritativeForCustody: true };
    }
    // Nothing to adopt (family itself inconclusive) and no prior to
    // preserve either — genuinely no data, not a disagreement. Bucketed
    // under 'conflicted' to stay within the fixed five-outcome enum;
    // callers that need the underlying no-data/no-consensus distinction
    // still have it via the raw measurement object (unchanged, still
    // returned alongside this decision — see resolveIdentity below).
    return { observedFamilyValue: familyValue ?? null, resolvedValue: null, outcome: 'conflicted', authoritativeForCustody: false };
  }

  if (!familyQualifies) {
    // Family has nothing conclusive to say about this field — prior
    // stands, completely unaffected. Not "trusted" in the sense of being
    // independently verified, just genuinely undisturbed.
    return { observedFamilyValue: familyValue ?? null, resolvedValue: priorValue, outcome: 'preserved-prior', authoritativeForCustody: priorIndependentlyTrusted === true };
  }

  if (String(familyValue) === String(priorValue)) {
    return { observedFamilyValue: familyValue, resolvedValue: priorValue, outcome: 'corroborated', authoritativeForCustody: true };
  }

  // Family qualifies AND disagrees with a present prior.
  if (priorIndependentlyTrusted) {
    // Trusted prior (a validated manual/user correction, or a corroborated
    // catalog authority record — see isPriorSourceIndependentlyTrusted;
    // NEVER Vision alone, regardless of confidence) wins outright — the
    // family's disagreement is surfaced as an annotation by the caller,
    // never as a silent overwrite.
    return { observedFamilyValue: familyValue, resolvedValue: priorValue, outcome: 'preserved-prior', authoritativeForCustody: true };
  }
  if (!priorHasSupportInFamily) {
    // Untrusted prior, ZERO support anywhere in a qualified, unanimous
    // family. IMPLEMENTATION PACKET HOLD — FINAL AUTHORITY-SOURCE HOLD,
    // rules D/E (2026-07-30): confidence still matters here — NOT to grant
    // authority (priorIndependentlyTrusted already ruled that out above),
    // but to decide whether a silent family-side correction is safe.
    //   - Rule E (retained, unchanged): a LOW/unknown-confidence prior with
    //     zero support is the Spawn #351 fixture's own class — Vision's
    //     own weak guess, silently and safely corrected by a qualified,
    //     unanimous family. authoritativeForCustody: true.
    //   - Rule D (new): a HIGH-confidence-but-untrusted prior (ordinary
    //     Vision at its own most confident, still never independently
    //     corroborated) disagreeing with a qualified, unanimous family
    //     that has ZERO support for it is a genuine conflict, not a clean
    //     correction — overriding a confident assertion silently is
    //     exactly the risk this hold exists to close. outcome:'conflicted',
    //     authoritativeForCustody: false — resolvedValue stays priorValue
    //     (never silently overwritten by the family either), the
    //     disagreement is recorded, not adjudicated.
    const priorIsHighConfidence = String(priorConfidence || '').toLowerCase() === 'high';
    if (priorIsHighConfidence) {
      return { observedFamilyValue: familyValue, resolvedValue: priorValue, outcome: 'conflicted', authoritativeForCustody: false };
    }
    return { observedFamilyValue: familyValue, resolvedValue: familyValue, outcome: 'provisionally-corrected', authoritativeForCustody: true };
  }
  // Prior has SOME support within the family (a genuine, non-unanimous
  // ambiguity, not a clean zero-support case) — real conflict, neither
  // side clearly wins.
  return { observedFamilyValue: familyValue, resolvedValue: priorValue, outcome: 'conflicted', authoritativeForCustody: false };
};

// Track B Phase 0, Commit 4.3 (IMPLEMENTATION PACKET HOLD — FINAL
// AUTHORITY-SOURCE HOLD, 2026-07-30) — CORRECTED. The first-pass version
// of this function judged a prior's independence by `confidence ===
// 'high'` alone (reusing extractConfirmedVariant's own Gate 2/4 "don't
// second-guess this" signal, variantIdentity.js). That was wrong: a
// high-confidence Vision observation is still Vision-derived — confidence
// measures certainty WITHIN a source (how sure Vision is of its own read),
// not whether that source has independent standing (third-party
// corroboration, or explicit user/catalog authority) to override a
// qualified, disagreeing family. Confidence cannot manufacture provenance.
// It happened to also correctly recognize manually-corrected priors
// (manualCorrection.js's buildManualCorrectionPayload sets
// `confidence:'HIGH'` on its request payload) — but that was a
// coincidence of a SHARED confidence value, not a genuine provenance
// check, and the same bare 'HIGH' string is exactly what an ordinary
// high-confidence Vision read also carries. Named finding — see
// LAUNCH-AUDIT.md.
//
// Corrected to judge trust by PROVENANCE:
//   - 'manual' | 'user' — a server-validated manual/user correction — independently trusted.
//   - 'catalog' — a corroborating external-catalog authority record — independently trusted ONLY when
//     `hasCorroboratingAuthorityRecord` is explicitly true (the bare tag alone proves nothing; no live
//     catalog-authority source exists in this codebase yet, so this currently always evaluates false in
//     practice — a deliberate conflicted-safe default, not a placeholder left to silently pass).
//   - 'vision' (including HIGH confidence), 'unknown', or anything else — NOT independently trusted.
//     Vision's own self-assessed certainty is not third-party corroboration; an unrecognized/absent
//     source defaults to untrusted, never the reverse.
export const isPriorSourceIndependentlyTrusted = (priorSource, hasCorroboratingAuthorityRecord = false) => {
  if (priorSource === 'manual' || priorSource === 'user') return true;
  if (priorSource === 'catalog') return hasCorroboratingAuthorityRecord === true;
  return false;
};

// Track B Phase 0, Commit 4.3 (PRODUCTION AUTHORITY-CONTEXT INTEGRATION
// HOLD, item 1, 2026-07-31) — normalizes a raw Vision confidence string.
// Traced to its actual origin (not a proxy, not grade-confidence): this is
// Vision's own self-reported identification confidence, requested
// explicitly in api/grade.js's STANDARD_PROMPT/WATCH_PROMPT JSON_SHAPE,
// returned in grade.js's response, forwarded by the client as part of the
// /api/enrich request body, and destructured at api/enrich.js's handler
// entry (`const { ..., confidence, ... } = req.body;`) — the exact same
// variable `[ship12]`/`visionConfidenceLower` already read elsewhere in
// that file.
//
// CORRECTED (GrailKey Dispatch 19, 2026-08-07): the claim this comment
// used to make — that STANDARD_PROMPT/WATCH_PROMPT already instructed
// Vision to return exactly one of "low"/"medium"/"high" — was not
// actually true of the prompt text in api/grade.js; confirmed by direct
// read, no such sentence existed there (unlike the separate, correctly-
// specified `buildGradeOnlyPrompt`, which always has). Confirmed by a
// real production failure, not just the prompt-text gap: a genuine
// "not a comic book" scan (Spawn #351, 2026-08-07 20:40:36 UTC) returned
// `confidence: "High that this is NOT a comic book"` — a free-text
// asset-type justification, not one of the three instructed values —
// which flowed unchecked into match-conf's `vision=` log field and every
// downstream confidence-tier comparison in api/enrich.js (`=== 'low'`,
// `=== 'medium'`) as if it were a real tier (silently never matching any
// of them, since none of those checks fail closed on an unrecognized
// value — an asset-type sentence being consumed where a confidence level
// was expected). Fixed at BOTH ends: STANDARD_PROMPT/WATCH_PROMPT now
// carry the explicit instruction this comment always claimed they had,
// AND this function now validates against the fixed set instead of
// trusting it blindly — a model can still deviate from instructions
// under adversarial or unusual imagery (same caution as Q140-CP's
// condition-report containment, grade.js), so the prompt fix and this
// validator are two independent layers, not either/or.
const VALID_VISION_CONFIDENCE_TIERS = new Set(['low', 'medium', 'high']);
export const normalizeVisionConfidence = (rawConfidence) => {
  const normalized = String(rawConfidence || 'medium').toLowerCase().trim();
  if (VALID_VISION_CONFIDENCE_TIERS.has(normalized)) return normalized;
  console.warn(
    `[vision-confidence-invalid] raw="${String(rawConfidence).slice(0, 120)}" — ` +
    `not one of low/medium/high (an asset-type sentence or other free text), defaulting to medium`
  );
  return 'medium';
};

// Track B Phase 0, Commit 4.3 (PRODUCTION AUTHORITY-CONTEXT INTEGRATION
// HOLD, item 1, 2026-07-31) — the SINGLE point that assigns
// priorSource='vision' and priorIndependentlyTrusted=false for the
// standard (non-manual, non-CGC-cert) identity-resolution path, matching
// the single-point-of-truth pattern already established for
// titleAxisOnlyBlock (imageSearchIdentity.js). `source` is hard-coded —
// NEVER derived from req.body.source, req.body.identitySource, a client-
// forwarded vision.source, or any other free-form request value; the only
// input this function accepts is the raw Vision confidence string itself.
// Imported by BOTH the real api/enrich.js call site and this feature's
// tests, so a real "HIGH Vision reaches resolveIdentity as HIGH" proof
// and a real "source is always 'vision' on the automatic path" proof are
// the SAME function call, not two independently-maintained copies.
export const buildStandardVisionAuthorityContext = (rawVisionConfidence) => ({
  source: 'vision',
  confidence: normalizeVisionConfidence(rawVisionConfidence),
  priorIndependentlyTrusted: isPriorSourceIndependentlyTrusted('vision'), // always false — vision is never independently trusted, computed via the real predicate rather than hand-typed
});

/**
 * Resolve identity from multiple sources (Vision, eBay, title-family).
 *
 * @param {Object} vision - Vision result { title, issue, year, publisher }
 * @param {Object} ebay - eBay visual consensus { title, issue, year, publisher }
 * @param {Object} family - Family candidate { selectedTitle, decision }
 * @param {Object} opts - { ebayResultCount, overlapThreshold, issueOperatorConfirmed }
 *   issueOperatorConfirmed (GrailKey Directive AQ, GK-127) — true only when
 *   vision.issue arrives from a validated operator correction of the issue
 *   field specifically (api/enrich.js: manualCorrectionRequest.validation.
 *   acceptedFields.includes('issue')). Tags the issue-facet evidence
 *   source='user' (sole-authority precedence) instead of 'vision' — scoped
 *   to the issue facet only, does not touch vision.source/
 *   priorIndependentlyTrusted or any other facet's gating.
 * @returns {Object} { confirmedTitle, confirmedIssue, confirmedYear, confirmedPublisher, identitySource, reconciledIssue }
 */

/**
 * rescueIssueFromCompsPoolConsensus — GK-152 (Absolute Wonder Woman #16
 * Talavera virgin, 2026-08-22). A NEW, later-stage rescue, deliberately
 * independent of resolveIdentity's own Phase-1 issue-facet logic above
 * (vision-zero-support ESCALATE, Guard 7 / isFamilyIssueConsensusAlready
 * Decided, reconcileIssue's first-eligible-visual entry) — it does not
 * touch, replace, or re-run any of that. Those mechanisms correctly
 * defer to a family-level 'no-consensus' verdict when the RAW, unclustered
 * visual-search pool is genuinely ambiguous (e.g. a mix of different
 * issues' variant covers by different artists, all visually similar
 * enough for eBay's own image search to conflate) — that deferral is by
 * design (AI Fixture 4/Venom, Eternus, Detective/GK-116, Quux CONTROL E)
 * and is NOT the defect this function exists to fix.
 *
 * The real gap: by the time comps are fetched and filtered (api/comps.js's
 * own variant/cover-letter/multi-issue/lot/slab chain — a materially
 * stronger, more specific signal than the raw family clustering, since it
 * is keyed on the actual comp LISTINGS being priced, not a coarse visual-
 * similarity cluster), the SURVIVING pool can be unanimous on a single
 * issue number even when the earlier, coarser pool never was — and that
 * later, stronger evidence never fed back into the issue facet before
 * this fix. Confirmed production case: 5/5 real, price-eligible comps
 * unanimously "#16" while confirmedIssue stayed null; Commit B's own
 * market-evidence gate (api/enrich.js) then discarded a real, already-
 * computed price and hard-locked the card (TARGET_ISSUE_UNRESOLVED /
 * PRICING_REFUSED) despite the unanimous evidence sitting right there in
 * rawComps.
 *
 * Deliberately conservative: unanimity only (no partial-majority credit —
 * matches the dispatch's own "5/5" bar, not a lower ratio), a real row-
 * count floor (MINIMUM_CORROBORATING_ROWS, the same floor this codebase
 * already uses elsewhere for "is this actually corroboration or a single
 * lucky row"), and authority is ALWAYS 'CONTESTED' — never 'CORROBORATED'
 * — from this path, so AR/AT/AV's own deriveMarketStanding per-facet law
 * (extended to issue alongside this fix, src/lib/actionAuthority.js)
 * floors standing to SIMILAR_ONLY, never EXACT_CURRENT/READY. A genuinely
 * empty or non-unanimous comps pool returns null — confirmedIssue stays
 * null and the existing ID_REQUIRED/LOCKED path is completely unchanged
 * (GrailKey Directive AS's own C3: ID_REQUIRED survives when no candidate
 * exists anywhere).
 *
 * @param {string|number|null} confirmedIssue - the issue value resolveIdentity already settled on (null is the only case this function can act on)
 * @param {Object|null} rawComps - the FINAL, filtered pricing-eligible comps pool (api/enrich.js's own `rawComps`, same shape as out.rawComps is built from — { prices: [{ title, ... }, ...] })
 * @param {Object} [opts]
 * @param {boolean} [opts.isGraded] - mirrors vision-zero-support's own carve-out; graded books never route through this rescue
 * @returns {{ issue: string, reconciledIssue: Object } | null}
 */
export function rescueIssueFromCompsPoolConsensus(confirmedIssue, rawComps, opts = {}) {
  if (confirmedIssue != null) return null; // nothing to rescue
  if (opts.isGraded) return null;

  const prices = Array.isArray(rawComps?.prices) ? rawComps.prices : [];
  if (prices.length < MINIMUM_CORROBORATING_ROWS) return null;

  const issues = prices.map((p) => {
    const title = String(p?.title || '');
    const candidate = extractHashIssueNumber(title) || extractIssueCandidate(title);
    return candidate?.issue != null ? String(candidate.issue) : null;
  });
  if (issues.some((i) => i == null)) return null; // every survivor must carry a real issue number — no partial-unanimity credit

  const distinct = new Set(issues);
  if (distinct.size !== 1) return null; // unanimity only, not a majority

  const issue = issues[0];
  const reconciledIssue = {
    value: issue,
    source: 'comps-pool-consensus',
    authority: 'CONTESTED',
    justifiedBy: prices.map((p) => ({ source: 'comps-pool-consensus', value: issue, title: p?.title || null })),
    conflicts: [],
  };
  return { issue, reconciledIssue };
}

export const resolveIdentity = (vision, ebay, family, opts = {}) => {
  const { ebayResultCount = 0, overlapThreshold = 0.2, isGraded = false } = opts;

  let confirmedTitle = vision.title;
  let confirmedIssue = vision.issue;
  let confirmedYear = vision.year;
  let confirmedPublisher = vision.publisher;
  let identitySource = 'vision';
  // Q134 dispatch (2026-07-21, Lozano/Rachta Lin class) — captured the
  // instant the provisional branch below fires, BEFORE the zero-support
  // override/escalate checks further down this same function can append a
  // suffix to identitySource (e.g. "+vision_publisher_zero_support_escalate").
  // isProvisionalRefusedIdentity's string-equality check breaks silently
  // the moment such a suffix lands — this boolean can't, by construction,
  // since nothing after this point ever reassigns it. Same reasoning
  // shouldSkipAssemblyIntegrityCheck already documented for keying on
  // familyCandidate.decision instead of identitySource.
  let isProvisionalOverride = false;
  // Q140 corrective dispatch (2026-07-23, review fix) — hoisted so the
  // family-vs-prior issue-consensus result (adopted/corroborated/
  // conflict-locked/no-consensus/no-data) can be returned to the caller,
  // not just console-logged. Without this, api/enrich.js had no way to
  // surface a genuine family-vs-Vision issue conflict (e.g. Flash #139 vs
  // a #170-leaning family) to out.issueConsensusConflict or the decision
  // engine at all — the conflict was real and correctly computed, but
  // structurally invisible outside this function.
  let familyIssueConsensusResult = null;
  // Track B Phase 0, Commit 4.1 — same hoisting reason as
  // familyIssueConsensusResult just above: resolveFamilyYearConsensus's
  // result must be returned to the caller (api/enrich.js), not just used
  // locally, so out.identityProvisionalFields can include 'year' when its
  // mode is 'adopted', mirroring exactly how 'issue' already gets added.
  let familyYearConsensusResult = null;
  // GrailKey Dispatch 26, Fix 4 (2026-08-08) — hoisted from their original
  // declaration point (just above the vision-zero-support block, further
  // down this function) so the zero-support unanimous-rescue branch
  // (inside the isQualifiedFamilyForRetention block below, which runs
  // BEFORE the original declaration point) can assign matchConfidenceDemote/
  // visionZeroSupport directly on a successful rescue, instead of
  // threading a second, parallel signal back out. identityEscalation
  // moved alongside for the same reason these three have always been
  // declared as one group — no behavior change for any existing reader.
  let identityEscalation = null;
  let matchConfidenceDemote = false;
  let visionZeroSupport = null;
  // GrailKey Directive 2026-08-15-AI — hoisted so the new visual-first
  // gap-fill branch (near the end of this function) can tell whether the
  // zero-support-unanimous-rescue mechanism (Dispatch 26 Fix 4, below)
  // was specifically EVALUATED for this book and explicitly DECLINED
  // (weightSum too thin, title collapsed to one cluster, etc.) — a
  // considered "no" that mechanism already made, which the new branch
  // must respect rather than second-guess (same shape as the
  // isNearMissMarginDecline/isNearMissConflictActive guards it already
  // honors).
  let zeroSupportRescueDeclined = false;

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
  if (family?.selectedTitle && FAMILY_OVERRIDE_DECISIONS.includes(family.decision)) {
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
    // Q140 corrective dispatch (2026-07-23, Flash #139/#128, Adventure Time,
    // Immortal Hulk #44, Wonder Woman #1 class) — family-scoped issue
    // adoption, aggregated across every member row of the winning family
    // (resolveFamilyIssueConsensus), never a single representative
    // rawTitle. Supersedes the 2026-07-22 Q140 dispatch's single-row
    // topFamily.rawTitle read, which was itself a real improvement over the
    // pool-wide ebay.issue vote but still vulnerable to one mis-scanned or
    // differently-printed row. vision.issue is the only legitimate "prior"
    // here — ebay.issue (pool-wide) is a weaker, potentially-wrong-family
    // signal, the exact thing this whole chain exists to stop leaking in.
    // When the family aggregate has NO per-row data to consult at all
    // (mode 'no-data' — no indices, no visualItems, or nothing readable),
    // resolveFamilyIssueConsensus returns null and this falls through to
    // the pre-existing ebay.issue/vision.issue chain, ebay first (X-Men
    // Anniversary Special class, Q12c's original case — a real family
    // whose own rows carry no issue number at all, only the pool-wide
    // consensus does). That fallback is untouched by this dispatch — only
    // the single-row extraction it used to sit behind was removed.
    const familyIssueConsensus = resolveFamilyIssueConsensus(
      vision.issue ?? null, opts.visualItems, family.topFamily?.indices
    );
    familyIssueConsensusResult = familyIssueConsensus;
    confirmedIssue = familyIssueConsensus.issue ?? (ebay?.issue || vision.issue || null);
    // Track B Phase 0, Commit 4.1 — family-scoped year, same reasoning and
    // scoping pattern as the issue vote directly above (resolveFamilyYearConsensus,
    // this file). Replaces the prior `ebay?.year || vision.year` — the
    // pool-WIDE year consensus, near-guaranteed null for a family that's a
    // minority within a larger mixed pool (confirmed empirically on the
    // Spawn #351 fixture: pool-wide year agreement was 0% even though the
    // winning family's own 5 rows unanimously asserted "2024"). vision.year
    // is the only legitimate "prior" here, same as vision.issue above —
    // ebay.year (pool-wide) is the weaker, potentially-wrong-family signal
    // this dispatch exists to stop leaking in.
    const familyYearConsensus = resolveFamilyYearConsensus(
      vision.year ?? null, opts.visualItems, family.topFamily?.indices
    );
    familyYearConsensusResult = familyYearConsensus;
    confirmedYear = familyYearConsensus.year ?? (ebay?.year || vision.year || null);
    // Track B Phase 0, Commit 4.1 (dispatch item 3), NARROWED in review
    // round (item 3) — publisher caution applies ONLY to the merged-
    // fragment path, gated by the explicit mergedFromFragments marker
    // mergeFragmentedTitleFamilies itself sets (imageSearchIdentity.js).
    // The real recovered Spawn #351 title text ("...Image Comics Malibu
    // Comics March 2024") proves marketplace publisher-adjacent tokens can
    // carry store/seller-boilerplate noise ("Malibu Comics" is a seller's
    // store name here, not a real publisher imprint) — adopting it the
    // same way issue/year are adopted would risk confidently promoting a
    // wrong or noisy publisher string for a MERGED family specifically,
    // whose member rows were never vetted as mutually consistent on
    // anything beyond issue/cover/year (the merge's own condition 3).
    // An ORDINARY (unmerged) top-rank-protection/weighted-consensus family
    // is unaffected — this dispatch does not globally replace publisher
    // behavior for every family-override decision; it retains the
    // pre-Commit-4.1 `ebay?.publisher || vision.publisher` read, unchanged.
    // A broader publisher-authority mechanism (mirroring issue/year's
    // family-scoped consensus, with its own noise-filtering, for ALL
    // family-override paths) is queued as future work, not built here.
    if (family.topFamily?.mergedFromFragments === true) {
      confirmedPublisher = vision.publisher || null;
    } else {
      confirmedPublisher = ebay?.publisher || vision.publisher;
    }
    identitySource = 'title-family-' + family.decision;
    console.log(`[phase1] family candidate OVERRIDE: using "${confirmedTitle}" (source: ${identitySource})`);
    if (rawFamilyTitle !== sanitizedFamilyTitle) {
      console.log(`[q40] family title sanitized: "${rawFamilyTitle}" → "${sanitizedFamilyTitle}"`);
    }
    console.log(
      `[q140] family issue consensus: mode=${familyIssueConsensus.mode} winner=${familyIssueConsensus.winner ?? 'none'} ` +
      `ratio=${familyIssueConsensus.ratio.toFixed(2)} uniqueRows=${familyIssueConsensus.uniqueRows} ` +
      `runnerUp=${familyIssueConsensus.runnerUp ?? 'none'} -> issue=#${confirmedIssue ?? 'null'}`
    );
    if (familyIssueConsensus.mode === 'conflict-locked') {
      console.log(
        `[q140] ISSUE CONFLICT LOCKED: vision="#${vision.issue}" vs family consensus="#${familyIssueConsensus.winner}" ` +
        `(ratio=${familyIssueConsensus.ratio.toFixed(2)}, uniqueRows=${familyIssueConsensus.uniqueRows}) ` +
        `— keeping vision's issue, never silently overwritten`
      );
    } else if (familyIssueConsensus.mode === 'no-consensus' && !familyIssueConsensus.issue && ebay?.issue) {
      console.log(`[q12c-fix] family had no issue-token consensus — fell back to pool-wide eBay issue="${ebay.issue}"`);
    }
  } else if (family?.decision === 'refused-identity-conflict' && family?.topFamily?.rawTitle && family.topFamily.count >= 2) {
    // Q131 (2026-07-19, Eternus #2 / He-Man class) — title-family clustering
    // already proved Vision's title has ZERO token overlap with the visual
    // pool AND explicitly refused rather than silently picking a side. The
    // prior behavior fell through to the generic "insufficient data" branch
    // below and blindly trusted Vision anyway — discarding a real,
    // corroborated pool signal (here: 2/2 unanimous "Eternus #2 ... Virgin
    // Variant Cover" listings, real $150 comps) in favor of a guess the
    // pipeline's own logic had just disproven. Vision is not infallible
    // (confirmed on this exact photo: two rescans produced two different
    // wrong titles) — when the pool is small but UNANIMOUS and Vision has
    // zero overlap with it, the pool is the stronger signal.
    //
    // Provisional, not a silent confidence upgrade: identitySource carries
    // 'refused-provisional' so every consumer (convergence scoring, card
    // display, decision engine) can tell this was surfaced under conflict,
    // not resolved normally. Requires topFamily.count >= 2 — a single
    // listing is not corroboration, and stays out of this branch (falls
    // through to the Vision fallback below, same as before).
    const rawFamilyTitle = family.topFamily.rawTitle;
    const sanitizedFamilyTitle = sanitizeSeriesTitle(rawFamilyTitle);
    // Q140 corrective dispatch (2026-07-23) — aggregate across every member
    // row of the winning family, never the single rawTitle regex match.
    // priorIssue is always null here (not vision.issue) — Vision has zero
    // pool overlap and is disproven for this identity, same reasoning the
    // Q131 follow-up below already applies to year/publisher.
    const familyIssueConsensus = resolveFamilyIssueConsensus(
      null, opts.visualItems, family.topFamily?.indices
    );
    familyIssueConsensusResult = familyIssueConsensus;

    // Q131 follow-up (2026-07-19, Eternus #2 / Scout Comics class) —
    // year/publisher/issue must NOT fall back to vision.* here the way the
    // top-rank-protection/weighted-consensus branch above does. That
    // branch's vision.* fallback is legitimate because Vision's overall
    // read WAS trustworthy enough to win the family match there. Here,
    // Vision has ZERO pool overlap and has already been proven wrong for
    // this exact identity (that's the definition of this decision) — its
    // year/publisher/issue guesses come from the same disproven read as
    // the rejected title, not independent corroboration. Confirmed via
    // real production log: title correctly resolved to "Eternus #2...",
    // but confirmedPublisher silently stayed "DC Comics" (Vision's He-Man
    // guess) because this exact `|| vision.X` pattern was copy-pasted from
    // the branch above without re-examining whether it still applied.
    // topFamily carries no publisher signal (only title/rawTitle) and no
    // other source exists at this stage — honest null (renders "—" per
    // I13) rather than silently keeping stale, rejected data is the same
    // principle as the title fix itself, not a new one.
    confirmedTitle = sanitizedFamilyTitle;
    confirmedIssue = familyIssueConsensus.issue ?? (ebay?.issue || null);
    confirmedYear = ebay?.year || null;
    confirmedPublisher = ebay?.publisher || null;
    identitySource = 'title-family-refused-provisional';
    isProvisionalOverride = true;
    console.log(
      `[phase1] REFUSED-CONFLICT PROVISIONAL: pool's own top family "${rawFamilyTitle}" ` +
      `(weight ${family.topFamily.weightSum?.toFixed?.(1)}, ${family.topFamily.count} members) ` +
      `conflicts with Vision "${vision.title}" (0 token overlap) — surfacing pool signal as ` +
      `provisional "${confirmedTitle}" #${confirmedIssue}, flagged for verification ` +
      `(year=${confirmedYear || 'unconfirmed'}, publisher=${confirmedPublisher || 'unconfirmed'})`
    );
    console.log(
      `[q140] refused-conflict issue consensus: mode=${familyIssueConsensus.mode} ` +
      `winner=${familyIssueConsensus.winner ?? 'none'} ratio=${familyIssueConsensus.ratio.toFixed(2)} ` +
      `uniqueRows=${familyIssueConsensus.uniqueRows} -> issue=#${confirmedIssue ?? 'null'}`
    );
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

  // ── Title facet (GrailKey Directive 2026-08-20-AV, GK-133) ────────────
  // "The candidate always enters" — last identity facet without candidate
  // custody, given the same law issue (AS/GK-132), variant (AM/AU), and
  // year (AT/GK-135) already have. Fires ONLY in the genuine void: family
  // election refused promotion (decision==='fallback-vision') AND nothing
  // above (a family-override branch, or the eBay-visual-consensus branch)
  // already assigned a real title — confirmedTitle/identitySource are
  // still exactly Vision's own bare default at this point. topFamily is
  // the SAME family-clustering candidate the Q38 floor
  // (imageSearchIdentity.js, "need >=3 for consensus override") already
  // scored and blocked from promotion — reused here as title EVIDENCE,
  // never re-derived. Adopted CONTESTED, never CORROBORATED-by-fiat
  // (reconcileTitle demotes any disagreement with Vision to CONTESTED by
  // construction — see that function, identityReconciler.js). C3's
  // downstream floor (out.titleAuthority==='CONTESTED' -> SIMILAR_ONLY,
  // src/lib/actionAuthority.js) is what keeps this from ever reading as a
  // clean, confirmed identity. Q38/Q84/AN's own token/discriminative-
  // corroboration gates are completely untouched by this block — it does
  // not change when family election WINS; it only stops the title from
  // silently defaulting to Vision's bare guess when election refuses and
  // a real candidate was sitting right there the whole time.
  // Q84-dual-axis-blocked exclusion (found regression-testing this
  // dispatch against tests/q140-coherent-content-token-lane.test.js's own
  // Adventure Time Summer Special/SDCC control) — family.titleAxisOnlyBlock
  // is set at EXACTLY ONE return site (imageSearchIdentity.js's Q84 dual-
  // axis gate) and means something structurally different from every other
  // fallback-vision cause this block targets: a family that DID clear the
  // >=3-member/overlap floor, where Vision+eBay already AGREE on a bare
  // stem title, and Q84 deliberately rejected only the family's own
  // NON-CONSENSUS additions ("Summer Special"/"SDCC") — confirmedTitle is
  // already the correct, deliberately-agreed value by the time this block
  // runs. topFamily.title there is the family's full cleaned cluster text
  // (INCLUDING the rejected additions) — adopting it here would silently
  // reintroduce exactly the pollution Q84/Q142/AG were built to keep out.
  // This mechanism exists only for the genuine void (Q38's <3-member
  // floor, weak pool-overlap, <5-item pool) — never for a qualified
  // family whose own content was deliberately, correctly trimmed.
  let reconciledTitle = null;
  let titleAdoptedContested = false;
  if (family?.decision === 'fallback-vision' && !family?.titleAxisOnlyBlock && identitySource === 'vision' && family?.topFamily?.title) {
    const titleFacet = reconcileTitleFacet(vision.title, family);
    reconciledTitle = titleFacet.reconciled;
    if (reconciledTitle.source === 'first-eligible-visual' && reconciledTitle.value) {
      confirmedTitle = reconciledTitle.value;
      titleAdoptedContested = reconciledTitle.authority === 'CONTESTED';
      identitySource = `${identitySource}+title_first_eligible_visual_${titleAdoptedContested ? 'contested' : 'corroborated'}`;
      console.log(
        `[reconcile-title] value="${reconciledTitle.value}" source=${reconciledTitle.source} ` +
        `authority=${reconciledTitle.authority} justifiedBy=${JSON.stringify(reconciledTitle.justifiedBy)} ` +
        `conflicts=${JSON.stringify(reconciledTitle.conflicts)}`
      );
      console.log(
        `[title-first-eligible-visual] adopting title="${confirmedTitle}" from the family's own top ` +
        `cluster ("${family.topFamily.rawTitle}") — Vision title was "${vision.title || 'null'}" — ` +
        `${titleAdoptedContested ? 'CONTESTED, not confirmed' : 'CORROBORATED'}`
      );
    }
  }

  // Track B Phase 0, Commit 4.3 (Section A/B/C, revised 2026-07-30) —
  // family issue/year authority, decoupled from the title-projection
  // decision above. Q84's title-safety gate (which can leave the branches
  // above at decision='fallback-vision', keeping Vision's own title)
  // speaks ONLY to the canonical/display TITLE — it must never also
  // discard a coherent winning family's own independently-valid issue/
  // year consensus.
  //
  // Confirmed live (2026-07-30 23:16:50 production dispatch): a coherent
  // 5-member Spawn #351 family (5/5 internal issue support, correctly
  // Q84-blocked from replacing the "Spawn" title with a marketplace label)
  // was silently discarded — familyIssueConsensusResult stayed null for
  // any decision outside FAMILY_OVERRIDE_DECISIONS/'refused-identity-
  // conflict', so vision-zero-support (below) fell through to the RAW
  // POOL's unrelated #300 plurality (9/18) instead of the family's own
  // coherent #351 consensus (5/5) — pricing and caching an entirely
  // different book under the family's own reference evidence.
  //
  // QUALIFIED-FAMILY PREDICATE (Matrix A, revised — the original draft's
  // bare `topFamily.count >= 3` gate was too permissive: it could not
  // distinguish a genuine title-axis-only block from a family that merely
  // shares WEAK token overlap with Vision's own title — imageSearchIdentity.js's
  // selectTitleFamilyCandidate returns decision='fallback-vision' with a
  // populated, possibly >=3-member topFamily for BOTH shapes, and only the
  // former is a safe retention candidate). One precondition, then four
  // evidence-quality conditions, all required:
  //
  //   PRECONDITION — hasValidFamilyMembership(...): the family's
  //   topFamily.indices must genuinely belong to the CURRENT request's
  //   visualItems (array, unique in-bounds integer indices, count
  //   agreement, every referenced row actually exists). IMPLEMENTATION
  //   PACKET HOLD — FINAL NARROW HOLD, item 1 (2026-07-30): added after
  //   review found the first-pass predicate had no membership check at
  //   all — a stale/foreign family (indices from a different/prior scan)
  //   could reach the MEASURE step, relying on resolveFamilyIssueConsensus
  //   to degrade to no-data rather than being rejected up front. This is a
  //   precondition of current-request membership, not a fifth evidence-
  //   quality signal — it runs FIRST (short-circuits the whole predicate)
  //   and a failure here means the family never reaches measurement at
  //   all: no consensus objects, no [commit4.3] log, no structured
  //   [family-evidence] event, no provisional override — silent-safe,
  //   exactly as if no family had been supplied.
  //
  //   1. family.titleAxisOnlyBlock === true — set at the SINGLE Q84-dual-
  //      axis-blocked return site (imageSearchIdentity.js), the only path
  //      where topFamily already cleared count>=3 AND >=40% Vision-title
  //      overlap AND is not a LOT listing, and the ONLY reason no title
  //      override happened is Q84 vetoing the TITLE content specifically.
  //   2. topFamily.count >= FAMILY_AUTHORITY_COHERENCE_FLOOR (3, unchanged
  //      — the same floor Ship 26.3B / identityRefusedPromotionEligible,
  //      api/enrich.js, already uses for family-pool promotion).
  //   3. !hasContaminatedMember(...) — a NATURALLY-occurring (non-merged)
  //      >=3-member family never passes through mergeFragmentedTitleFamilies'
  //      own contamination screen (that function is a pure no-op once
  //      scored[0].count>=3 already) — this re-applies the identical,
  //      shared LOT/REPRINT/SLAB/GRADED/SIGNED/TPB check independently
  //      here so a naturally-large-but-contaminated family can't qualify
  //      either.
  //   4. familyDominatesRunnerUp(...) — CORRECTED, IMPLEMENTATION PACKET
  //      HOLD — FINAL NARROW HOLD, item 2 (2026-07-30). The first-pass
  //      implementation reused isCompetingFamilyTooStrong(top, [runner])
  //      verbatim (inverted) here — WRONG and, worse, VACUOUS in this
  //      context: at this call site topFamily/runnerUp are literally
  //      scored[0]/scored[1] (top.weightSum >= runner.weightSum ALWAYS
  //      holds by construction), under which isCompetingFamilyTooStrong
  //      can only ever return true in a degenerate zero-weight case — it
  //      could never actually block retention in production. The correct
  //      rule is the INVERSE relationship: the SELECTED family must
  //      dominate the runner-up by the reused 3x margin (top >=
  //      runner*3), not "the runner-up must outweigh the selected family
  //      by 3x." familyDominatesRunnerUp (src/lib/compHygiene.js) is a
  //      separately-named function implementing this — NOT a mutation of
  //      isCompetingFamilyTooStrong's own meaning, which stays exactly as-
  //      is for its original top-rank-protection call site (a genuinely
  //      different weight-ordering context; see that function's own
  //      updated doc comment). See LAUNCH-AUDIT.md for the full named
  //      finding — the first-pass margin condition was vacuous, masked by
  //      an impossible (top<runner) test fixture, not a deliberate design.
  const FAMILY_AUTHORITY_COHERENCE_FLOOR = 3;
  // Track B Phase 0, Commit 4.3.1 (Section A, 2026-07-31) — split the
  // original single-expression predicate into a shared base (the four
  // non-margin conditions) and the margin condition on its own, so a
  // "near miss" — every condition holds except margin — can be detected
  // as its own distinct shape rather than falling through to the
  // catch-all "not qualified" case. isQualifiedFamilyForRetention's own
  // truth table is unchanged: it is still exactly
  // (all four base conditions) AND (margin).
  const familyAuthorityBaseConditions = !!(hasValidFamilyMembership(opts.visualItems, family?.topFamily?.indices, family?.topFamily?.count)
    && family?.titleAxisOnlyBlock === true
    && family?.topFamily?.count >= FAMILY_AUTHORITY_COHERENCE_FLOOR
    && !hasContaminatedMember(opts.visualItems, family.topFamily.indices));
  const familyAuthorityMarginQualifies = familyAuthorityBaseConditions
    && familyDominatesRunnerUp(family.topFamily.weightSum, family.runnerUp?.weightSum);
  const isQualifiedFamilyForRetention = familyAuthorityBaseConditions && familyAuthorityMarginQualifies;
  // Commit 4.3.1 (Section A) — the near-miss shape this commit closes:
  // every base condition holds (genuine title-axis-only block, coherence
  // floor, no contamination) but the family does NOT dominate its
  // runner-up by the required 3x margin — margin is the SOLE failed
  // qualification condition. familyDominatesRunnerUp returns true
  // whenever there is no real competing runner-up at all, so this can
  // only be true when a genuine, non-trivial runner-up is actually
  // present and simply isn't dominated.
  const isNearMissMarginDecline = familyAuthorityBaseConditions && !familyAuthorityMarginQualifies;

  // Only runs when neither branch above already populated
  // familyIssueConsensusResult (those are strictly stronger signals — an
  // accepted title override, or a proven Vision-vs-pool conflict — and are
  // left completely untouched here) AND the family clears the qualified
  // predicate above. confirmedTitle is deliberately NEVER touched here —
  // the title decision made above stands, unchanged.
  if (familyIssueConsensusResult == null && isQualifiedFamilyForRetention) {
    // MEASURE — the family's own independent observation, prior=null,
    // never mutates confirmedIssue/confirmedYear by itself. Mirrors the
    // refused-identity-conflict branch's own null-prior reasoning above:
    // this measures the family's internal coherence, independent of
    // whether Vision's per-field guesses agree with it.
    const issueMeasurement = resolveFamilyIssueConsensus(null, opts.visualItems, family.topFamily.indices);
    const yearMeasurement = resolveFamilyYearConsensus(null, opts.visualItems, family.topFamily.indices);

    // DECIDE — compares the measurement against the existing field's
    // value, source, and support. IMPLEMENTATION PACKET HOLD — PRODUCTION
    // AUTHORITY-CONTEXT INTEGRATION HOLD (2026-07-31), corrected again:
    // this function no longer derives trust from a free-form
    // `vision.source` string at all — that was itself a residual "free-
    // form manual trust path" (a bare 'manual'/'user' tag reaching this
    // function proves nothing about whether the Commit 3 four-condition
    // manual-authority contract was ever actually validated; validated
    // manual corrections bypass resolveIdentity entirely and always will
    // — see manualCorrection.js). `priorIndependentlyTrusted` is now
    // consumed DIRECTLY from `vision.priorIndependentlyTrusted` — a
    // boolean the CALLER must have already computed (via
    // buildStandardVisionAuthorityContext for the real production path,
    // which hard-codes it to `false`) — this function never re-interprets
    // a source string into a trust decision itself. `vision.source` is
    // read ONLY for diagnostics/traceability (the [commit4.3] log line,
    // and threaded into decideFieldAuthority's own accepted-but-not-
    // branched-on priorSource param) — it can no longer grant authority no
    // matter what string a caller supplies, since authority is driven
    // exclusively by the pre-computed boolean. A vision object that omits
    // both fields (every existing test fixture that predates this hold)
    // safely defaults to `source:'unknown'`/`priorIndependentlyTrusted:false` —
    // never trusted.
    const priorSource = vision.source ?? 'unknown';
    const priorTrusted = vision.priorIndependentlyTrusted === true;
    const issueHasSupport = vision.issue != null && (issueMeasurement.assertedIssues || []).includes(String(vision.issue));
    const yearHasSupport = vision.year != null && (yearMeasurement.assertedYears || []).includes(String(vision.year));

    const issueDecision = decideFieldAuthority({
      priorValue: vision.issue, priorSource, priorIndependentlyTrusted: priorTrusted, priorConfidence: vision.confidence,
      familyMode: issueMeasurement.mode, familyValue: issueMeasurement.issue,
      priorHasSupportInFamily: issueHasSupport,
    });
    const yearDecision = decideFieldAuthority({
      priorValue: vision.year, priorSource, priorIndependentlyTrusted: priorTrusted, priorConfidence: vision.confidence,
      familyMode: yearMeasurement.mode, familyValue: yearMeasurement.year,
      priorHasSupportInFamily: yearHasSupport,
    });

    // Legacy-mode mapping — every EXISTING downstream consumer
    // (deriveIssueAuthorityFromAdoption, out.issueConsensusConflict,
    // issueAuthority.js, api/enrich.js) reads `.mode` using the ORIGINAL
    // five-value vocabulary each function already documented
    // ('adopted'|'corroborated'/'preserved'|'conflict-locked'|'no-consensus'/
    // 'no-data') — never the new outcome enum directly (per the approved
    // custody-invariant design, the new outcome/authoritativeForCustody
    // fields are what the SHARED CUSTODY INVARIANT consumes; this mapping
    // is purely for backward compatibility with pre-4.3 consumers that
    // were never rebuilt). Whenever the family itself wasn't conclusive
    // (familyMode !== 'adopted'), the honest legacy mode is simply
    // familyMode's own value ('no-data'/'no-consensus') — never guessed.
    const legacyModeFor = (fieldType, familyMode, decision) => {
      if (decision.outcome === 'adopted' || decision.outcome === 'provisionally-corrected') return 'adopted';
      if (decision.outcome === 'corroborated') return fieldType === 'year' ? 'preserved' : 'corroborated';
      if (familyMode !== 'adopted') return familyMode;
      return 'conflict-locked'; // familyMode==='adopted' + outcome is preserved-prior/conflicted -> genuine disagreement
    };

    familyIssueConsensusResult = {
      ...issueMeasurement,
      issue: issueDecision.resolvedValue,
      mode: legacyModeFor('issue', issueMeasurement.mode, issueDecision),
      observedFamilyValue: issueDecision.observedFamilyValue,
      resolvedValue: issueDecision.resolvedValue,
      outcome: issueDecision.outcome,
      authoritativeForCustody: issueDecision.authoritativeForCustody,
    };
    familyYearConsensusResult = {
      ...yearMeasurement,
      year: yearDecision.resolvedValue,
      mode: legacyModeFor('year', yearMeasurement.mode, yearDecision),
      observedFamilyValue: yearDecision.observedFamilyValue,
      resolvedValue: yearDecision.resolvedValue,
      outcome: yearDecision.outcome,
      authoritativeForCustody: yearDecision.authoritativeForCustody,
    };

    if (issueDecision.authoritativeForCustody) confirmedIssue = issueDecision.resolvedValue;
    if (yearDecision.authoritativeForCustody) confirmedYear = yearDecision.resolvedValue;

    // A qualifying retention branch entry ALWAYS gets exactly one summary
    // log line — never zero (a silent, unauditable authority decision),
    // never duplicated — reporting both fields' outcomes regardless of
    // which specific outcome each landed on.
    isProvisionalOverride = issueDecision.outcome === 'adopted' || issueDecision.outcome === 'provisionally-corrected'
      || yearDecision.outcome === 'adopted' || yearDecision.outcome === 'provisionally-corrected';
    if (isProvisionalOverride) {
      identitySource = `${identitySource}+family_issue_year_authority_retained`;
    }
    console.log(
      `[commit4.3] family authority retained despite title decision="${family.decision}": ` +
      `priorSource=${priorSource} priorIndependentlyTrusted=${priorTrusted} ` +
      `issue outcome=${issueDecision.outcome} resolved=${issueDecision.resolvedValue ?? 'null'} authoritative=${issueDecision.authoritativeForCustody} ` +
      `support=${issueMeasurement.support}/${issueMeasurement.uniqueRows}; ` +
      `year outcome=${yearDecision.outcome} resolved=${yearDecision.resolvedValue ?? 'null'} authoritative=${yearDecision.authoritativeForCustody} ` +
      `support=${yearMeasurement.support}/${yearMeasurement.uniqueRows}`
    );

    // GrailKey Dispatch 26, Fix 4 (2026-08-08) — zero-support unanimous
    // rescue. decideFieldAuthority's Rule D (just above) correctly
    // refuses to let a qualified family silently overwrite a CONFIDENT
    // Vision assertion — that protection is untouched (see
    // decideFieldAuthority's own doc comment). But Rule D's confidence
    // check has no visibility into the RAW, unclustered pool: a Vision
    // issue that is not just unsupported inside this one family but has
    // ZERO support anywhere in the raw pool either is not "confident
    // with weak corroboration" — it is confident with NO corroboration
    // at all, exactly the "confident and wrong" shape the standing
    // product principle exists to prevent (see the vision-zero-support
    // block below, whose ESCALATE branch this rescue preempts for this
    // one narrow shape). Six required conditions, ALL of, none optional
    // (GrailKey Dispatch 26):
    //   1. Rule D actually produced the conflicted/non-authoritative
    //      outcome this fires on top of — never touches 'adopted'/
    //      'corroborated'/'preserved-prior', which already resolved.
    //   2. vision.priorIndependentlyTrusted === false — a user
    //      correction or barcode read must never be overridden. RE-VERIFIED
    //      (P0 review, GrailKey Dispatch 26, 2026-08-08) after the initial
    //      Step A finding alone was correctly challenged as insufficient —
    //      two independent structural facts, not one, close this off
    //      completely:
    //      (a) api/enrich.js's identity resolution is a plain
    //      if(barcodeIdentity){}else if(manualIdentity){}else
    //      if(cgcIdentityConfirmed){}else{identity=resolveIdentity(...)} —
    //      a genuine mutually-exclusive chain, not a fallthrough (confirmed
    //      by direct read, ~api/enrich.js:2860-2896). Only the final `else`
    //      calls resolveIdentity at all.
    //      (b) The one remaining question was whether a POST-scan
    //      correction request (manualAuthority, Commit 3) could somehow
    //      reach the resolveIdentity branch without also tripping (a) —
    //      it cannot: manualCorrection.js's isValidManualAuthorityRequestContract
    //      (manualCorrection.js:195-199) requires body.manualIdentity===true
    //      as one of its four hard conditions before prepareManualCorrectionRequest
    //      will ever return valid:true. Any request that successfully
    //      supplies a manual correction therefore ALSO satisfies (a)'s
    //      `manualIdentity` branch on that exact same request — there is no
    //      shape where a correction lands but (a)'s bypass doesn't fire.
    //      Combined with (a), a trusted prior structurally cannot reach
    //      this function today via ANY known route — checked here anyway
    //      as defense in depth against a future second call site that
    //      doesn't share this structure.
    //   3. Raw-pool zero support — isIssueZeroSupport, the SAME helper
    //      and floor the vision-zero-support block below already uses,
    //      not recomputed.
    //   4/5. evaluateUnanimousConsensusPromotion (issueAuthority.js) —
    //      the SAME predicate Fix 2 uses, reused verbatim, never a
    //      second parallel implementation: uniqueRows>=4, exact
    //      unanimity, no issue-tally runner-up, weightSum>=8, distinct
    //      itemId AND distinct sellerUsername.
    //   6. evaluateTitleTextIndependence (issueAuthority.js) — >=3
    //      distinct title-wording clusters (Jaccard >=0.7) among the
    //      asserting rows only (getAssertingIssueRows, above — same
    //      population evaluateUnanimousConsensusPromotion's own asserting
    //      rows come from). Closes the gap distinct-seller/distinct-
    //      itemId alone cannot: those prove independent POSTING, not
    //      independent IDENTIFICATION — marketplace title-copy
    //      propagation produces N distinct sellers carrying ONE
    //      propagated error (see Pattern Library, "independent posting
    //      is not independent identification"). Threshold fixed before
    //      being run against real data; no margin requirement — see the
    //      Pattern Library entry for why a margin was deliberately NOT
    //      added.
    // Any single condition failing leaves Rule D's outcome untouched —
    // ESCALATE stands, current behavior. [commit4.3-zero-support-rescue]
    // logs every input on BOTH the fire and decline path — never silent.
    if (
      issueDecision.outcome === 'conflicted'
      && issueDecision.authoritativeForCustody === false
      && priorTrusted === false
      && vision.issue != null
      && isIssueZeroSupport(ebay?.agreement?.visionIssueCount, ebay?.agreement?.total)
    ) {
      const promotion = evaluateUnanimousConsensusPromotion(issueMeasurement, family, opts.visualItems);
      const assertingRows = getAssertingIssueRows(family.topFamily.indices, opts.visualItems);
      const independence = evaluateTitleTextIndependence(assertingRows.map((r) => r.rawTitle));
      const rescueEligible = promotion.promote && independence.pass;
      console.log(
        `[commit4.3-zero-support-rescue] ${rescueEligible ? 'FIRE' : 'DECLINE'} ` +
        `visionIssue="${vision.issue}" familyIssue=#${issueMeasurement.winner ?? 'null'} ` +
        `rawPoolSupport=${ebay?.agreement?.visionIssueCount ?? 'null'}/${ebay?.agreement?.total ?? 'null'} ` +
        `promotion.promote=${promotion.promote} promotion.declineReason=${promotion.declineReason ?? 'none'} ` +
        `uniqueRows=${promotion.inputs.uniqueRows} support=${promotion.inputs.support} runnerUp=${promotion.inputs.runnerUp} weightSum=${promotion.inputs.weightSum} ` +
        `uniqueItemIdCount=${promotion.inputs.uniqueItemIdCount ?? 'n/a'}/${promotion.inputs.itemIdCount ?? 'n/a'} ` +
        `uniqueSellerCount=${promotion.inputs.uniqueSellerCount ?? 'n/a'}/${promotion.inputs.sellerCount ?? 'n/a'} ` +
        `independence.pass=${independence.pass} assertingRows=${independence.assertingRows} ` +
        `distinctClusters=${independence.distinctClusters} largestClusterSize=${independence.largestClusterSize} ` +
        `maxPairwiseJaccard=${independence.maxPairwiseJaccard ?? 'n/a'} minPairwiseJaccard=${independence.minPairwiseJaccard ?? 'n/a'} ` +
        `clusters=${JSON.stringify(independence.clusters)}`
      );
      if (rescueEligible) {
        confirmedIssue = issueMeasurement.issue ?? issueMeasurement.winner;
        familyIssueConsensusResult = {
          ...familyIssueConsensusResult,
          issue: confirmedIssue,
          mode: 'unanimous-zero-support-rescue',
          resolvedValue: confirmedIssue,
          outcome: 'rescued',
          authoritativeForCustody: true,
        };
        matchConfidenceDemote = true;
        visionZeroSupport = {
          mode: 'rescue',
          visionIssue: vision.issue,
          adoptedIssue: confirmedIssue,
          poolTotal: ebay?.agreement?.total ?? null,
        };
        identitySource = `${identitySource}+zero_support_unanimous_rescue`;
      } else {
        zeroSupportRescueDeclined = true;
      }
    }

    // GrailKey Dispatch 26, Fix 4b (2026-08-08) — year-axis mirror of the
    // rescue above. Fix 4 alone left a real gap: confirmedYear stays at
    // Rule D's preserved, unverified Vision value even after the issue is
    // rescued — reported and confirmed by trace (Fix 4b scoping): the
    // book would go from an honest ID_REQUIRED block to a confident-and-
    // wrong price against a fabricated year, poisoning five separate
    // downstream consumers (getEraYearTolerance's three call sites,
    // ComicVine's ±4y strict filter, PriceCharting's own product-match
    // gate AND query construction). Fix 4 and Fix 4b ship together for
    // exactly this reason — Fix 4 without this is a net regression on
    // this book's own axis (an honest block becoming a wrong price is
    // worse than the block, per the standing "honest and locked, never
    // confident and wrong" principle), not merely incomplete.
    //
    // Four conditions (not six) — deliberately narrower than the issue
    // axis. Conditions 1/2 mirror the issue rescue exactly (Rule D fired
    // for THIS axis; untrusted prior, same `priorTrusted` local already
    // computed above — reused, not recomputed). Conditions 3/4 reuse
    // Fix 2b's own year predicate and condition 6's title-independence
    // check, both verbatim, both required (GrailKey Dispatch 26, Fix 4b
    // Q1/Q2 — condition 6 is NOT optional here: a copy-pasted listing
    // title carries a copy-pasted year exactly as it carries a
    // copy-pasted issue number, and a wrong year gates five downstream
    // consumers versus mislabeling one card). There is NO raw-pool
    // zero-support condition on this axis (unlike the issue axis's
    // condition 3) — no equivalent primitive exists anywhere in this
    // codebase (no `ebay.agreement.visionYearCount`, no
    // isYearZeroSupport) and none is built here; inventing one would be
    // new functionality, not verbatim reuse, and was not part of what
    // was scoped or approved.
    if (
      yearDecision.outcome === 'conflicted'
      && yearDecision.authoritativeForCustody === false
      && priorTrusted === false
    ) {
      const yearPromotion = evaluateUnanimousYearConsensusPromotion(family, opts.visualItems, yearMeasurement);
      const assertingYearRows = getAssertingYearRows(family.topFamily.indices, opts.visualItems);
      const yearIndependence = evaluateTitleTextIndependence(assertingYearRows.map((r) => r.rawTitle));
      const yearRescueEligible = yearPromotion.promote && yearIndependence.pass;
      console.log(
        `[commit4.3-year-zero-support-rescue] ${yearRescueEligible ? 'FIRE' : 'DECLINE'} ` +
        `visionYear="${vision.year}" familyYear=${yearPromotion.year ?? 'null'} ` +
        `promotion.promote=${yearPromotion.promote} promotion.declineReason=${yearPromotion.declineReason ?? 'none'} ` +
        `assertingRows=${yearPromotion.inputs.assertingRows} silentRows=${yearPromotion.inputs.silentRows} dissentingRows=${yearPromotion.inputs.dissentingRows} ` +
        `uniqueItemIdCount=${yearPromotion.inputs.uniqueItemIdCount ?? 'n/a'}/${yearPromotion.inputs.itemIdCount ?? 'n/a'} ` +
        `uniqueSellerCount=${yearPromotion.inputs.uniqueSellerCount ?? 'n/a'}/${yearPromotion.inputs.sellerCount ?? 'n/a'} ` +
        `independence.pass=${yearIndependence.pass} assertingTitleRows=${yearIndependence.assertingRows} ` +
        `distinctClusters=${yearIndependence.distinctClusters} largestClusterSize=${yearIndependence.largestClusterSize} ` +
        `maxPairwiseJaccard=${yearIndependence.maxPairwiseJaccard ?? 'n/a'} minPairwiseJaccard=${yearIndependence.minPairwiseJaccard ?? 'n/a'} ` +
        `clusters=${JSON.stringify(yearIndependence.clusters)}`
      );
      if (yearRescueEligible) {
        confirmedYear = yearPromotion.year;
        familyYearConsensusResult = {
          ...familyYearConsensusResult,
          year: confirmedYear,
          mode: 'unanimous-year-zero-support-rescue',
          resolvedValue: confirmedYear,
          outcome: 'rescued',
          authoritativeForCustody: true,
        };
        identitySource = `${identitySource}+year_zero_support_unanimous_rescue`;
      }
      // DECLINE is deliberately a no-op here — familyYearConsensusResult
      // stays at whatever legacyModeFor already produced ('conflict-locked'
      // for this exact shape, since Rule D's 'conflicted' outcome is only
      // reachable when familyMode==='adopted'). api/enrich.js reads that
      // mode directly to decide whether to mark 'year' provisional (HARD
      // CONSTRAINT: an unresolved year must keep the book blocked, not
      // price against the unverified value) — no separate signal needed
      // from this function.
    }
  } else if (familyIssueConsensusResult == null && isNearMissMarginDecline) {
    // Track B Phase 0, Commit 4.3.1 (Section A, 2026-07-31) —
    // RETENTION-DECLINE FAIL-CLOSED CONTAINMENT. All four Commit 4.3
    // qualification conditions hold except margin. Left alone, this
    // near-miss would fall through with familyIssueConsensusResult still
    // null — one condition short of the qualified branch above instead
    // of absent entirely — straight into the raw-pool vision-zero-support
    // override/escalate check below, which would adopt whatever the RAW
    // POOL's own unrelated plurality happens to be. That is the exact
    // Commit 4.3 failure mode this containment closes: record a genuine,
    // UNRESOLVED conflict instead, never adopt the family's value, and
    // never let raw-pool override/escalate run for this field either
    // (see familyAuthoritySkip below, extended to recognize this shape).
    //
    // MEASURE ONLY — same null-prior measurement as the qualified branch
    // (the family's own internal coherence is unaffected by whether it
    // clears the margin bar against a competing family). DECIDE is
    // skipped deliberately: decideFieldAuthority's rule D/E branches are
    // for a family that WON custody eligibility; this family did not, so
    // there is nothing to decide between "corrected" and "conflicted" —
    // it is unconditionally a recorded conflict, resolvedValue always the
    // untouched prior (Control T1's convention: preserved unresolved,
    // never adopted, never overwritten).
    const issueMeasurement = resolveFamilyIssueConsensus(null, opts.visualItems, family.topFamily.indices);
    const priorSource = vision.source ?? 'unknown';
    const priorTrusted = vision.priorIndependentlyTrusted === true;

    // GrailKey Dispatch 25, Fix 2c (2026-08-07, Batman #213 class) — AXIS
    // CHECK. The margin test above (familyDominatesRunnerUp) is measured
    // entirely on TITLE-FAMILY WEIGHT (topFamily.weightSum vs
    // runnerUp.weightSum) — it has no awareness of what issue number
    // either family's rows actually assert. Two title-string clusters can
    // legitimately disagree on wording ("Batman Giant 30th Anniversary
    // Issue Origin Robin" vs "Batman DC") while every row in BOTH
    // clusters names the identical issue — a title-axis ambiguity, not an
    // issue-axis one. Before this fix, that shape was unconditionally
    // written up as outcome:'conflicted', which api/enrich.js then
    // surfaces verbatim to the card as "Marketplace listings disagree on
    // this book's issue number" — false when every row agrees. Checked
    // against the runner-up specifically (not a broader all-families
    // sweep): the margin predicate itself is only ever computed against
    // scored[1] (runnerUp) — no other family enters this branch's
    // decision at all, so it is the only competing family whose issue
    // agreement is relevant to the conflict this branch is about to
    // record.
    // CORRECTED (2026-08-07, review before push) — the first-shipped
    // version of this check used `.winner` (raw per-row PLURALITY —
    // populated the instant a single non-tied top candidate exists,
    // regardless of whether every row agrees). That is not what
    // "agreement" means here: a 3-row runner-up with two rows asserting
    // #213 and one asserting #300 has `.winner === '213'` — plurality —
    // while a real dissenting row sits in the pool. Shipping that would
    // have suppressed a genuine conflict on live dissent, the same
    // disease class as Fix 2b's denominator bug, inverted: there, silence
    // was wrongly counted as dissent; here, dissent would have been
    // wrongly absorbed by plurality. Fixed to require UNANIMITY —
    // `.assertedIssues` (the distinct SET of issue values a family's rows
    // assert, from `resolveFamilyIssueConsensus`'s own `Object.keys(counts)`,
    // entirely unfloored — unlike `.issue`/`.winner`, its size is exactly
    // 1 if and only if every asserting row in the family names the same
    // value): a family "agrees" only when its own asserted-issue set has
    // size exactly 1, and the two families' single values match. A row
    // that asserts nothing (silent) never enters `assertedIssues` at all
    // — neutral, consistent with Fix 2b's "silence is not dissent" rule.
    // A family with 2+ distinct asserted values — real internal dissent —
    // fails unanimity regardless of which value is more common.
    const runnerUpIssueMeasurement = family.runnerUp?.indices
      ? resolveFamilyIssueConsensus(null, opts.visualItems, family.runnerUp.indices)
      : null;
    const topAssertedIssues = issueMeasurement.assertedIssues || [];
    const runnerUpAssertedIssues = runnerUpIssueMeasurement?.assertedIssues || [];
    const topUnanimous = topAssertedIssues.length === 1;
    const runnerUpUnanimous = runnerUpAssertedIssues.length === 1;
    // GrailKey Directive 2026-08-16-AQ (GK-127) — INVESTIGATED, NOT
    // CHANGED. A plurality-only comparison (topWinner/runnerUpWinner) was
    // drafted here and then reverted before push: Fix 2c (Dispatch 25,
    // this exact file, comment above) already tried and explicitly
    // REJECTED that approach mid-dispatch, for a real, documented reason —
    // "a 3-row runner-up with two rows asserting #213 and one asserting
    // #300 has .winner==='213', which would have suppressed a GENUINE
    // conflict on live dissent." Confirmed by direct execution
    // (tests/grailkey-dispatch-25-fix2c-axis-check.test.js Section 5,
    // "P0 hole closed") that a plurality-only rewrite regresses exactly
    // that fixture. Wolverine #90's own false-conflict bug (GK-127) does
    // NOT require changing this unanimity test at all: the evidence-set
    // feed a few hundred lines below (familyIssueEvidenceSource) already
    // adds preReconcileConfirmedIssue as 'family-corroborated' evidence
    // whenever familyIssueConsensusResult.mode is 'conflict-locked' —
    // independent of WHY axisAgreement went false — so reconcileIssue
    // (identityReconciler.js) already computes the correct CORROBORATED
    // verdict for Wolverine #90's real shape today (confirmed against the
    // real production log: "[reconcile-issue] value=90 ... authority=
    // CORROBORATED"), unaffected by this test either way. The actual bug
    // was entirely in a SEPARATE, now-removed mechanism (api/enrich.js's
    // former commit4.3 writer) that derived out.issueAuthority from this
    // mode/outcome flag directly instead of from reconcileIssue's own
    // verdict — see src/lib/issueAuthority.js's projectIssueAuthority and
    // api/enrich.js's q140-terminal same-value-agreement validator, both
    // of which correctly suppress the false DISPLAY/authority write
    // without touching this unanimity-based conflict TEST.
    const axisAgreement = topUnanimous && runnerUpUnanimous
      && topAssertedIssues[0] === runnerUpAssertedIssues[0];
    // Per-family dissent tally for the log — mirrors resolveFamilyIssueConsensus's
    // own row-counting loop exactly (same dedup keys, same NON_GENUINE_COPY_RE
    // exclusion, same extractIssueCandidate call) so these counts are
    // guaranteed consistent with assertedIssues itself, not a second,
    // independently-drifting reimplementation. Local and read-only —
    // logging only, never feeds the axisAgreement decision above.
    const topIssueCounts = tallyFamilyIssueCounts(family.topFamily.indices, opts.visualItems);
    const runnerUpIssueCounts = tallyFamilyIssueCounts(family.runnerUp?.indices, opts.visualItems);
    console.log(
      `[commit4.3.1-axis-check] topFamilyAssertedIssues=${JSON.stringify(topAssertedIssues)} ` +
      `topFamilyIssueCounts=${JSON.stringify(topIssueCounts)} ` +
      `runnerUpAssertedIssues=${JSON.stringify(runnerUpAssertedIssues)} ` +
      `runnerUpIssueCounts=${JSON.stringify(runnerUpIssueCounts)} ` +
      `topUnanimous=${topUnanimous} runnerUpUnanimous=${runnerUpUnanimous} agreement=${axisAgreement} ` +
      `decision=${axisAgreement ? 'title-axis-only-no-issue-conflict' : 'genuine-issue-conflict'}`
    );

    if (axisAgreement) {
      // Every family the margin check concerns agrees on the issue — the
      // ambiguity is confined to the TITLE axis. familyIssueConsensusResult
      // is deliberately left null (not populated with a 'conflicted'
      // outcome): this lets every downstream consumer — the
      // vision-zero-support raw-pool check below, and
      // api/enrich.js's out.issueConsensusConflict construction, gated on
      // familyIssueConsensus?.mode==='conflict-locked' — evaluate this
      // field exactly as if no near-miss had occurred at all, rather than
      // inventing a second, parallel "agreed" state. Advisory recorded on
      // identitySource (the existing provenance-string convention used
      // throughout this function) rather than a new field.
      identitySource = `${identitySource}+title_axis_ambiguous_issue_agreed`;
    } else {
      familyIssueConsensusResult = {
        ...issueMeasurement,
        issue: vision.issue,
        // legacyModeFor's own rule: outcome 'conflicted' + familyMode
        // 'adopted' (the family WAS internally coherent, just didn't clear
        // the margin bar) maps to 'conflict-locked' — routes this through
        // the SAME pre-existing containment api/enrich.js already applies
        // to any mode==='conflict-locked' result (out.issueConsensusConflict),
        // rather than inventing a parallel mechanism.
        mode: issueMeasurement.mode === 'adopted' ? 'conflict-locked' : issueMeasurement.mode,
        observedFamilyValue: issueMeasurement.issue,
        resolvedValue: vision.issue,
        outcome: 'conflicted',
        authoritativeForCustody: false,
        reason: 'retention-margin-decline-conflict',
        // GrailKey Directive AQ-follow-up (GK-128) — the runner-up TITLE
        // FAMILY's own full asserted-issue set (distinct from `runnerUp`/
        // `runnerUpSupport` above, which are the TOP family's own internal
        // runner-up-candidate-value fields via the `...issueMeasurement`
        // spread — a different thing). Carried so the evidence-set builder
        // below can compute the runner-up's genuinely DISSENTING values
        // (every asserted value that does not match the value actually
        // being preserved/adopted) and report them as real conflict
        // evidence. Every materially asserted issue value in an eligible
        // conflicting family must reach the issue evidence set — a
        // family's plurality winner is not a substitute for its
        // dissenting evidence (the exact gap GK-128 proved live: a
        // runner-up split 213/213/300 let reconcileIssue compute
        // CORROBORATED, because "300" never reached it).
        runnerUpAssertedIssues,
      };
      identitySource = `${identitySource}+family_margin_decline_conflict`;

      // N1 instrumentation — exactly one structured containment line per
      // qualifying near-miss, never silent. Format required verbatim by the
      // implementation-approval addendum: "family=<issue>@<count>/<weight>
      // runnerUp=<weight> margin=<ratio> prior=<vision issue>" — additional
      // fields (raw-pool proposed issue, required margin, runner-up count,
      // final authority status) appended after, per Section E.
      const runnerUpWeight = family.runnerUp?.weightSum ?? null;
      const REQUIRED_MARGIN = 3;
      const measuredMargin = (runnerUpWeight != null && runnerUpWeight > 0)
        ? Number((family.topFamily.weightSum / runnerUpWeight).toFixed(2))
        : null;
      console.log(
        `[commit4.3.1] near-miss family conflict: ` +
        `family=${issueMeasurement.issue}@${family.topFamily.count}/${family.topFamily.weightSum} ` +
        `runnerUp=${runnerUpWeight ?? 'none'} margin=${measuredMargin ?? 'n/a'} prior=${vision.issue ?? 'null'} ` +
        `requiredMargin=${REQUIRED_MARGIN} runnerUpCount=${family.runnerUp?.count ?? 0} ` +
        `rawPoolProposed=${ebay?.issue ?? 'null'} priorSource=${priorSource} priorIndependentlyTrusted=${priorTrusted} ` +
        `reason=retention-margin-decline-conflict status=conflicted`
      );
    }
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
  // (identityEscalation/matchConfidenceDemote/visionZeroSupport are
  // declared earlier in this function now — GrailKey Dispatch 26, Fix 4 —
  // so the zero-support unanimous-rescue branch above can assign them.)
  const reprintRatio = computeReprintDominanceRatio(opts.visualItems);
  const poolReprintDominant = reprintRatio != null && reprintRatio >= REPRINT_DOMINANCE_THRESHOLD;

  // Q140-AT dispatch (2026-07-24, Adventure Time Summer Special #1 class) —
  // the raw-pool visionIssueCount tally this block checks below is computed
  // BEFORE title-family clustering runs (imageSearchIdentity.js's
  // extractConsensus, fed by each row's own extractIssueFromTitle) and can
  // be independently poisoned by the Q12c marketing-keyword guard (nulls
  // "#1" near words like "Special"/"Exclusive" at pool-BUILD time) even
  // when the winning family's own membership — resolveFamilyIssueConsensus,
  // scoped to family.topFamily.indices, computed above — is in full
  // agreement. familyIssueConsensusResult is only ever set inside the
  // three family-authority branches above (never carried over between
  // calls), so checking it non-null already proves the authority is FROM
  // THE CURRENT family selection, not a stale/previous one — re-checked
  // explicitly here anyway against family.decision so a future refactor
  // that starts reusing this variable across branches can't silently
  // widen the skip. Commit 4.3 (Section B) — third allowed condition
  // mirrors exactly the retained-family-authority branch's own gate
  // (family?.topFamily?.count >= FAMILY_AUTHORITY_COHERENCE_FLOOR) so this
  // stays a precise, explicit list rather than a blanket `!= null`.
  const familyAuthorityCurrent = familyIssueConsensusResult != null
    && (FAMILY_OVERRIDE_DECISIONS.includes(family?.decision)
      || family?.decision === 'refused-identity-conflict'
      || family?.topFamily?.count >= FAMILY_AUTHORITY_COHERENCE_FLOOR);
  // Only a genuine ADOPTED/CORROBORATED result for the SAME issue the check
  // below is about to evaluate counts as authority — 'conflict-locked' and
  // 'no-consensus'/'no-data' must still reach the raw-pool check unshortcut
  // (a real family-vs-Vision conflict, or a family with nothing to say, is
  // not a reason to skip the pool's own independent zero-support signal).
  // Track B Phase 0, Commit 4.3.1 (Section A) — the near-miss margin-
  // decline conflict is NEVER a reason to skip on "authority" (there IS
  // none — authoritativeForCustody is false by construction), but it
  // still must skip: "do not run raw-pool OVERRIDE / do not run raw-pool
  // ESCALATE" for this exact shape. A separate, explicitly-named check
  // rather than folding into familyAuthoritySkip's own adopted/corroborated
  // condition — that condition means something different ("the family IS
  // custody-authoritative for this value"), which is specifically false
  // here.
  const isNearMissConflictActive = familyIssueConsensusResult?.reason === 'retention-margin-decline-conflict';
  // GrailKey Dispatch 26, Fix 4 — the zero-support unanimous-rescue branch
  // above already overwrote confirmedIssue/familyIssueConsensusResult
  // directly when it fires; without this check, the raw-pool zero-support
  // block just below would run RIGHT ON TOP of that decision (raw-pool
  // support is unchanged — still zero — so its own condition would still
  // be true) and immediately null confirmedIssue right back out via
  // ESCALATE, silently undoing the rescue. Mirrors isNearMissConflictActive's
  // exact shape just above (derived from the already-set mode/reason, not
  // a separately-threaded flag).
  const isZeroSupportRescueActive = familyIssueConsensusResult?.mode === 'unanimous-zero-support-rescue';
  const familyAuthoritySkip = isNearMissConflictActive || isZeroSupportRescueActive || (familyAuthorityCurrent
    && (familyIssueConsensusResult.mode === 'adopted' || familyIssueConsensusResult.mode === 'corroborated')
    && familyIssueConsensusResult.issue != null
    && String(familyIssueConsensusResult.issue) === String(confirmedIssue));

  if (poolReprintDominant) {
    // EX-7 — pool is not an eligible witness (facsimile/reprint dominance
    // confound). Vision's value stands untouched; if Vision itself lacks
    // confidence, the existing identity-gate / Q83 rescue chain (which
    // reads visionConfidence independently of this function) still
    // escalates to ID_REQUIRED on its own — no new code needed here.
    console.log(`[vision-zero-support] SKIPPED — pool is reprint/facsimile-dominant (ratio=${reprintRatio.toFixed(2)} >= ${REPRINT_DOMINANCE_THRESHOLD}), Vision's issue stands`);
  } else if (isNearMissConflictActive) {
    console.log(
      `[vision-zero-support] SKIPPED reason=retention-margin-decline-conflict ` +
      `— a near-miss family conflict is already recorded for this field; raw-pool override/escalate must not run on top of it`
    );
  } else if (isZeroSupportRescueActive) {
    console.log(
      `[vision-zero-support] SKIPPED reason=zero-support-unanimous-rescue ` +
      `— confirmedIssue already rescued to #${confirmedIssue} by the qualified-family zero-support predicate; raw-pool override/escalate must not run on top of it`
    );
  } else if (familyAuthoritySkip) {
    console.log(
      `[vision-zero-support] SKIPPED reason=winning-family-authority ` +
      `mode=${familyIssueConsensusResult.mode} issue=${familyIssueConsensusResult.issue} ` +
      `population=${familyIssueConsensusResult.uniqueRows} support=${familyIssueConsensusResult.support} ` +
      `ratio=${familyIssueConsensusResult.ratio.toFixed(2)} rawPoolVisionSupport=${ebay?.agreement?.visionIssueCount ?? 'null'}`
    );
  } else if (!isGraded && vision.issue != null && isIssueZeroSupport(ebay?.agreement?.visionIssueCount, ebay?.agreement?.total)) {
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
      console.log(`[vision-zero-support] OVERRIDE: Vision issue="${vision.issue}" has ${ebay.agreement.visionIssueCount}/${ebay.agreement.total} pool support (< ${(ISSUE_ZERO_SUPPORT_RATIO_FLOOR * 100).toFixed(0)}%) — adopting pool #${ebay.issue}`);
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
      console.log(`[vision-zero-support] ESCALATE: Vision issue="${vision.issue}" has ${ebay.agreement.visionIssueCount}/${ebay.agreement.total} pool support (< ${(ISSUE_ZERO_SUPPORT_RATIO_FLOOR * 100).toFixed(0)}%) and no adoptable alternate — forcing ID_REQUIRED`);
    }
  }

  // P0 (Q-FIX-B) — same zero-support treatment for publisher as issue
  // gets above. Every branch that can set confirmedPublisher (title-family
  // override, eBay overlap-override, or the vision default itself) does a
  // bare `ebay?.publisher || vision.publisher` — publisher was never
  // cross-checked against the pool the way issue is. Runs uniformly AFTER
  // the issue check, same reprint-dominance carve-out (a reprint/
  // facsimile-contaminated pool isn't a trustworthy publisher witness
  // either).
  //
  // Composes with api/enrich.js's founding-year plausibility gate
  // (isPublisherYearPlausible, Finding 2) as defense-in-depth rather than
  // duplicate coverage: this check catches zero-pool-support cases
  // regardless of chronology; the founding-year gate catches
  // chronologically-impossible values this check deliberately leaves
  // alone (nonzero-but-thin Vision-side pool support is NOT "zero
  // support" here, same conservative posture as the issue check above —
  // it falls through un-overridden for the founding-year gate to judge on
  // its own terms).
  //
  // AUDIT NOTE (Q140-AT dispatch, 2026-07-24) — this block shares the
  // identical wrong-population defect the issue check above was just fixed
  // for (visionPublisherCount is tallied from the same raw, unclustered
  // pool, pre-family-clustering) and is deliberately left untouched here.
  // Per instruction: do not suppress by issue-authority; the eventual fix
  // is a family-scoped re-tally of visionPublisherCount itself (mirroring
  // resolveFamilyIssueConsensus's own scoping to family.topFamily.indices),
  // not a second copy of the familyAuthoritySkip gate above. Queued, not
  // implemented this pass.
  let visionPublisherZeroSupport = null;
  if (poolReprintDominant) {
    console.log(`[vision-zero-support] publisher check SKIPPED — pool is reprint/facsimile-dominant (ratio=${reprintRatio.toFixed(2)} >= ${REPRINT_DOMINANCE_THRESHOLD}), Vision's publisher stands`);
  } else if (!isGraded && vision.publisher != null && ebay?.agreement?.visionPublisherCount === 0) {
    if (ebay.publisher != null) {
      // Coherent alternate publisher exists in the pool — adopt it, loudly.
      confirmedPublisher = ebay.publisher;
      identitySource = `${identitySource}+vision_publisher_zero_support_override`;
      matchConfidenceDemote = true;
      visionPublisherZeroSupport = {
        mode: 'override',
        visionPublisher: vision.publisher,
        adoptedPublisher: ebay.publisher,
        poolTotal: ebay.agreement.total,
      };
      console.log(`[vision-zero-support] PUBLISHER OVERRIDE: Vision publisher="${vision.publisher}" has 0/${ebay.agreement.total} pool support — adopting pool "${ebay.publisher}"`);
    } else if (ebay.noPublisherConsensus) {
      // Vision's publisher is unsupported AND the pool doesn't converge on
      // any replacement either — don't silently keep an unsupported value
      // via the bare `||` fallback. Clear it and let cde6935's founding-
      // year plausibility gate / ComicVine backfill (api/enrich.js) act as
      // the last line of defense, same as a null confirmedPublisher from
      // any other source.
      confirmedPublisher = null;
      identitySource = `${identitySource}+vision_publisher_zero_support_escalate`;
      matchConfidenceDemote = true;
      visionPublisherZeroSupport = {
        mode: 'escalate',
        visionPublisher: vision.publisher,
        poolTotal: ebay.agreement.total,
      };
      console.log(`[vision-zero-support] PUBLISHER ESCALATE: Vision publisher="${vision.publisher}" has 0/${ebay.agreement.total} pool support and no adoptable alternate — clearing for downstream plausibility/backfill gates`);
    }
  }

  // GrailKey Directive 2026-08-15-AJ (Proof 1) — CORRECTIVE. The AI
  // dispatch's original branch here only ran when `confirmedIssue` was
  // already null — a rescue path, not visual-first authority. It never
  // examined firstEligibleVisual when Vision confidently (even if
  // wrongly) kept a non-null value with merely WEAK, non-zero pool
  // support (the zero-support block above requires the ratio to fall
  // below ISSUE_ZERO_SUPPORT_RATIO_FLOOR to even run) — the exact
  // "confidently wrong value the evidence system never gets to examine"
  // shape AJ's Proof 1 names. Fixed: the evidence set below is built and
  // `reconcileIssue` is called UNCONDITIONALLY, on every issue
  // resolution, not gated on `confirmedIssue == null`. Upstream
  // resolvers (family-consensus, zero-support override/escalate, the
  // retention/rescue branches above) keep running exactly as before —
  // their outputs become EVIDENCE, at the precedence identityReconciler.js
  // already defines ('family-consensus' > 'first-eligible-visual' >
  // 'vision'), rather than pre-empting the reconciler by never letting it
  // run. Flash #139 safety is now a PRECEDENCE property (family-consensus
  // evidence outranks a disagreeing first-eligible-visual candidate), not
  // an unreachability property.
  //
  // The five guards from the AI dispatch are preserved as gates on
  // WHETHER first-eligible-visual evidence enters the set at all — per
  // AJ's own instruction, "precedence rules inside the reconciler, not
  // reasons to skip it." reconcileIssue still runs even when every guard
  // suppresses the candidate (producing authority 'NONE' from whatever
  // evidence remains) — this is what makes the reconciler's execution
  // provable independent of the outcome value (AJ Proof 1, Fixture P1).
  //
  //   Guard 1 (echo of an upstream-rejected value) — the candidate's own
  //   issue equals Vision's value AND the pipeline already explicitly
  //   rejected that value (confirmedIssue is null here despite Vision
  //   having supplied one — i.e. zero-support ESCALATE, or a
  //   title-family branch that refused to trust Vision for this field).
  //   Adopting it back is not new evidence, it's the same rejected
  //   number restated (tests/q140-at-vision-zero-support-skip.test.js,
  //   "Test 5b").
  //   Guard 2 (isNearMissMarginDecline / isNearMissConflictActive) — a
  //   family WAS evaluated against the real adoption bar and explicitly
  //   fell short — the Adventure Time Summer Special/SDCC "honest null"
  //   precedent (tests/q140-coherent-content-token-lane.test.js).
  //   Guard 3 (isMarketingFlavoredRow) / Guard 4 (countCorroboratingEligibleRows
  //   < MINIMUM_CORROBORATING_ROWS) — properties of the candidate itself;
  //   see each helper's own doc comment (identityReconciler.js) for the
  //   fixtures that required them (Adventure Time SDCC; Eternus #2).
  //   Guard 5 (zeroSupportRescueDeclined) — Dispatch 26 Fix 4's own
  //   unanimous-zero-support-rescue mechanism evaluated this family and
  //   explicitly declined (tests/grailkey-dispatch-26-fix4-zero-support-
  //   rescue.test.js's two control fixtures).
  //
  // The adopted value is a CANDIDATE, not confirmed identity (D3): it may
  // drive further research (comp search, catalog lookup) but must not
  // read as strong identity downstream. Demotion
  // (`identityProvisionalFromVisualFirst`, consumed by api/enrich.js to
  // set the SAME out.identityProvisional + out.listingHardLocked
  // mechanism Q133 Slice 2 already established) fires precisely when the
  // WINNING evidence is 'first-eligible-visual' AND it differs from
  // Vision's own value (present or absent) — never merely because
  // first-eligible-visual happened to win precedence while agreeing with
  // Vision (an ordinary book where the top visual match simply confirms
  // Vision must not be flagged provisional — Fixture 7 / no-over-fire).
  const preReconcileConfirmedIssue = confirmedIssue;
  const visionIssuePresent = vision.issue != null;
  // Vision's own value was explicitly rejected by an upstream mechanism
  // when it supplied one but confirmedIssue is null here anyway (zero-
  // support ESCALATE, or a title-family branch that refused to trust it
  // for this field) — recorded as CONFLICT evidence (visible, never
  // fallback-worthy), not corroboration.
  const visionIssueRejectedUpstream = visionIssuePresent && preReconcileConfirmedIssue == null;
  // GrailKey Directive 2026-08-15-AK — a genuine upstream RESOLUTION (not
  // a bare Vision passthrough) is tagged with ONE of two DIFFERENT-
  // PRECEDENCE evidence sources, never a single unified "family-
  // consensus" tier (see identityReconciler.js's own doc comment on
  // ISSUE_SOURCE_PRECEDENCE for the full rationale — a real Sabrina-
  // shaped fixture proved a unified tier let a large generic population
  // outrank a specific, corroborated firstEligibleVisual candidate on
  // member count alone):
  //   'family-population'    resolveFamilyIssueConsensus's 'adopted' mode
  //                           SPECIFICALLY — no prior existed, a raw
  //                           member-count vote filled the gap. Demoted
  //                           below first-eligible-visual: population
  //                           alone corroborates or contradicts, it does
  //                           not replace a specific candidate.
  //   'family-corroborated'  every OTHER genuine resolution — a family
  //                           mode that reached a real verdict IN
  //                           RELATION TO AN EXISTING PRIOR
  //                           ('corroborated' agrees with it,
  //                           'conflict-locked' preserves it verbatim
  //                           despite disagreement — Flash #139 — and
  //                           'unanimous-zero-support-rescue' clears a
  //                           materially higher independence bar than
  //                           plain population, Dispatch 26 Fix 4) — or
  //                           confirmedIssue was changed by a mechanism
  //                           outside resolveFamilyIssueConsensus
  //                           entirely (the raw-pool zero-support
  //                           OVERRIDE, ebay.issue adopted — a separate,
  //                           already load-bearing, already-tested
  //                           mechanism this split does not touch or
  //                           reclassify). Keeps top precedence,
  //                           unconditionally outranking a disagreeing
  //                           visual cluster.
  // 'adopted' mode is ALSO the legacy-compatibility label the retention
  // branch's own legacyModeFor (~line 2211) maps BOTH its 'adopted' and
  // 'provisionally-corrected' decideFieldAuthority outcomes onto — a
  // CONFIDENCE-AWARE correction of a low-confidence prior (Spawn #351:
  // Vision's own low-confidence "301" corrected by a 5/5-unanimous,
  // dominance-verified family), not a bare population vote filling an
  // empty gap. That branch's familyIssueConsensusResult carries `outcome`/
  // `authoritativeForCustody` fields the raw resolveFamilyIssueConsensus
  // output (from the title-family override / refused-identity-conflict
  // branches, where Sabrina's real population-only case actually
  // originates) never does — `outcome == null` is the reliable signal
  // that 'adopted' here means a bare vote with nothing to correct or
  // confirm against, not a verified correction.
  const isRawPopulationAdoption = familyIssueConsensusResult?.mode === 'adopted' && familyIssueConsensusResult?.outcome == null;
  let familyIssueEvidenceSource = null;
  if (preReconcileConfirmedIssue != null) {
    if (isRawPopulationAdoption) {
      familyIssueEvidenceSource = 'family-population';
    } else if (
      familyIssueConsensusResult != null
      && ['adopted', 'corroborated', 'conflict-locked', 'unanimous-zero-support-rescue'].includes(familyIssueConsensusResult.mode)
    ) {
      familyIssueEvidenceSource = 'family-corroborated';
    } else if (String(preReconcileConfirmedIssue) !== String(vision.issue ?? '')) {
      familyIssueEvidenceSource = 'family-corroborated';
    }
  }

  const issueEvidence = createEvidenceSet();
  // GrailKey Directive 2026-08-16-AQ (GK-127) — an operator correction of
  // the issue field (opts.issueOperatorConfirmed, set by api/enrich.js only
  // when manualCorrectionRequest.validation.acceptedFields includes
  // 'issue') is genuine, independent, maximum-weight evidence — tagged
  // 'user', matching this project's existing variant-facet convention
  // (writeConfirmed(..., 'user', ...) at the manual-correction call site).
  // Scoped to the issue facet ONLY (C6) — vision.source/priorIndependently
  // Trusted, which drive title/year/near-miss/rescue gating far more
  // broadly, are deliberately left untouched.
  const issueEvidenceSource = opts.issueOperatorConfirmed ? 'user' : 'vision';
  if (visionIssuePresent) {
    if (visionIssueRejectedUpstream) {
      reportConflict(issueEvidence, 'issue', issueEvidenceSource, vision.issue);
    } else {
      addEvidence(issueEvidence, 'issue', issueEvidenceSource, vision.issue);
    }
  }
  if (familyIssueEvidenceSource) {
    addEvidence(issueEvidence, 'issue', familyIssueEvidenceSource, preReconcileConfirmedIssue);
  }
  // GrailKey Directive AQ-follow-up (GK-128 FIX) — every materially
  // asserted issue value in an eligible CONFLICTING family must reach the
  // issue evidence set; a family's plurality winner is not a substitute
  // for its dissenting evidence. Proven live via a real end-to-end
  // assembleContract run (Batman #213 class, runner-up split
  // 213/213/300): the "300" dissent never reached issueEvidence,
  // reconcileIssue computed CORROBORATED instead of CONTESTED, and the
  // false trust propagated all the way to actionAuthority=READY/
  // contract.listable=true — the fifth false-READY sibling.
  //
  // Scoped to the RUNNER-UP's own internal dissent only, deliberately
  // NOT the top family's own internal minority. The "eligible conflicting
  // family" this rule is about is the runner-up — the family competing
  // against (never becoming) the adopted value; the top family's own
  // minority noise is not itself in conflict with anything, it is the
  // ordinary texture of a real population that still produced a genuine
  // majority. Verified this asymmetry is required, not a convenience:
  // Wolverine #90's own real shape has TOP-family dissent (a lone "91"
  // among four "90" rows) with a completely clean, unanimous runner-up —
  // feeding top-family dissent here would reintroduce GK-127's exact
  // false conflict on the book that fix was built to close. A prior
  // attempt in this same campaign fed the runner-up's own PLURALITY
  // (winner) as the "conflict" value instead of its dissent — wrong for
  // this exact shape (plurality "213" agrees with top; the real dissent
  // is the minority "300", which plurality discards by construction) —
  // logged as GK-128 and reverted before landing. This fix feeds the
  // ACTUAL non-winning value(s), not the winner.
  if (isNearMissConflictActive && Array.isArray(familyIssueConsensusResult?.runnerUpAssertedIssues)) {
    const runnerUpDissentingValues = familyIssueConsensusResult.runnerUpAssertedIssues
      .filter((v) => String(v) !== String(preReconcileConfirmedIssue));
    for (const dissentingValue of runnerUpDissentingValues) {
      reportConflict(issueEvidence, 'issue', 'family-runnerup-dissent', dissentingValue);
    }
    if (runnerUpDissentingValues.length > 0) {
      console.log(
        `[gk128-fix] runner-up dissenting value(s) fed as real conflict evidence: ${JSON.stringify(runnerUpDissentingValues)} ` +
        `(runnerUpAssertedIssues=${JSON.stringify(familyIssueConsensusResult.runnerUpAssertedIssues)}, preserved=${preReconcileConfirmedIssue})`
      );
    }
  }

  // Guard 6 (contaminated family) — found on the full regression sweep
  // (tests/q-trackB-commit4.3-winning-family-authority.test.js "CONTROL
  // C": a naturally-formed family mixing a raw listing with a slabbed
  // "CGC 9.8" member). hasContaminatedMember is the SAME signal
  // familyAuthorityBaseConditions already gates retention/rescue on
  // (LOT_RE/REPRINT_RE/SLAB_RE/GRADED_RE/SIGNED_RE/IDENTITY_TPB_MARKER_RE
  // membership) — a contaminated cluster is unreliable for ANY adoption,
  // not merely the family-consensus/rescue paths that already checked it.
  //
  // GrailKey Directive 2026-08-17-AS (GK-132) — REFINED, not replaced.
  // Production evidence, Venom Separation Anxiety #1, Mike Mayhew signed/
  // remarked w/Poker Chip (2026-08-17 19:40, build ee03e5a): the frozen
  // rank-1 row IS the family here (family.topFamily.count===1, the same
  // row hasContaminatedMember would check), and it is genuinely "Signed/
  // Remarked" — a real attribute of the physical book. hasContaminatedMember's
  // ANY-match semantics (unchanged, correct, and STILL APPLIED VERBATIM
  // whenever the family has >=2 members — CONTROL C's genuine RAW+GRADED
  // *mixture*, re-verified passing) flagged this SINGLE, coherent row as
  // "contaminated" purely for being signed — a category error: with one
  // member there is no mixture to detect, "mixture" being structurally
  // impossible at n=1. Below 2 members, this guard now evaluates false
  // (nothing to mix) rather than running the same any-match check on a
  // lone row — the second of two independent gates that were blocking
  // GK-132's production case (the first, MINIMUM_CORROBORATING_ROWS as an
  // entry floor, is fixed just below). The shared hasContaminatedMember
  // function itself is completely unchanged, and every other call site
  // (the qualified-family-authority retention gate just below,
  // issueAuthority.js's P1 predicate, imageSearchIdentity.js's
  // mergeFragmentedTitleFamilies) is untouched (C7).
  //
  // This does NOT reach True Believers-class reprints: that shape has no
  // family at all (family=null in the real fixture) and is caught by the
  // NEW, separate own-row isReprintOrTpbFlavored check below instead —
  // family-mixture contamination and single-row reprint/TPB unreliability
  // are two different concerns, and conflating them into one check (an
  // earlier draft of this fix did exactly that, tried and reverted before
  // landing) broke both the CONTROL C regression AND left the reprint case
  // unguarded, since REPRINT_RE genuinely needs to run against the
  // CANDIDATE'S OWN row, not the family cluster.
  const familyMemberCount = Array.isArray(family?.topFamily?.indices) ? family.topFamily.indices.length : 0;
  const isFamilyContaminated = familyMemberCount >= 2
    ? hasContaminatedMember(opts.visualItems, family?.topFamily?.indices)
    : false;
  // Guard 7 (a family-level "no-consensus" verdict already examined this
  // exact pool and explicitly declined) — GrailKey Directive 2026-08-17-AS
  // (GK-132/GK-126), found regression-testing against tests/q131-refused-
  // identity-conflict-provisional.test.js's Eternus #2 fixture (Q140
  // corrective dispatch, 2026-07-23). The 'refused-identity-conflict'
  // decision branch (~line 2244 above) already runs
  // resolveFamilyIssueConsensus — a MORE SOPHISTICATED, family-aware
  // consensus mechanism (60%+ agreement, clear-lead-over-runner-up, its
  // OWN >=3-unique-row floor) — against this exact visual pool, and for
  // Eternus's real 2-row, 100%-agreeing-but-still-below-that-floor shape
  // reaches mode='no-consensus' (with its own winner='2' recorded purely
  // for diagnostics, per that dispatch's own explicit ruling: 2 unique
  // rows is not enough even at full agreement). Without this guard the
  // simpler first-eligible-visual mechanism below re-derives the SAME "2"
  // from the SAME 2 rows via a cruder, count-only path and silently
  // overrides that considered refusal.
  //
  // Scoped to 'no-consensus' SPECIFICALLY, not "any non-null verdict" — an
  // earlier draft of this guard blocked on bare non-null
  // familyIssueConsensusResult and broke Directive AK's own population-
  // precedence fixture (tests/grailkey-directive-ak-population-precedence.
  // test.js): a bare 'adopted' (population-only, outcome==null) vote is
  // NOT a refusal — it is a weak, demotable-by-design corroboration
  // (identityReconciler.js's ISSUE_SOURCE_PRECEDENCE already ranks
  // 'family-population' below 'first-eligible-visual' for exactly this
  // reason, "population corroborates or contradicts, never replaces") and
  // must still be allowed to ENTER so the reconciler's own precedence
  // logic can correctly demote it under a specific, corroborated candidate
  // — blocking entry entirely would have defeated AK's whole mechanism.
  // 'no-consensus' is different in kind: it means the family-level
  // mechanism could not even clear ITS OWN adoption floor on this pool at
  // all — a genuine, considered "not enough evidence" verdict, not a weak
  // corroboration waiting to be out-ranked.
  //
  // Confirmed via direct trace (not assumed) this does NOT reintroduce
  // GK-132's own production gap: the real Venom shape's family.decision is
  // 'fallback-vision' (imageSearchIdentity.js's Q38 branch, topFamily.count
  // 1-2), which never calls resolveFamilyIssueConsensus at all —
  // familyIssueConsensusResult stays null there (confirmed by direct
  // execution against the real production fixture), so this guard never
  // fires for the case this dispatch exists to fix.
  //
  // CORRECTED (found running tests/grailkey-directive-aj-http-handler.
  // test.js — the real /api/enrich handler, not a hand-built unit fixture
  // — the same "AG lesson" this campaign keeps re-learning: a unit-level
  // fix silently broken by a downstream consumer the fix wasn't traced
  // against): `mode==='no-consensus'` is NOT unique to the 'refused-
  // identity-conflict' branch's own considered refusal. `resolveFamilyIssueConsensus`
  // is ALSO called for a genuinely SUCCESSFUL title-family adoption (the
  // top-rank-protection/weighted-consensus branch, ~line 2158) — checking
  // issue agreement AMONG the winning family's OWN members, a completely
  // different question ("does this already-won family agree on an issue
  // number") than Eternus's ("is this thin, refused family strong enough
  // to win AT ALL"). AI's own Fixture 4 (Venom, real handler pool: 4
  // different issue numbers split across the winning "venom separation
  // anxiety" family's 5 members, none reaching 60% — genuinely
  // mode='no-consensus' too) needs the SAME first-eligible-visual rescue
  // this whole dispatch exists to unblock, and the bare mode check wrongly
  // deferred to it, leaving Vision's own unchallenged, weakly-corroborated
  // "3" standing (out.issue='3' instead of '1', identityProvisional never
  // set). Scoped now to the ACTUAL branch this guard was built for:
  // family?.decision === 'refused-identity-conflict' AND mode==='no-consensus'
  // together — the 'refused-identity-conflict' branch is the one that
  // computed its OWN considered refusal on a family that never won
  // anything at all; a successfully-adopted family's internal issue split
  // is a different question this guard was never meant to touch.
  //
  // GENERALIZED (found running tests/q-trackB-commit4.3-winning-family-
  // authority.test.js's own CONTROL 3 — a THIRD branch, Commit 4.3's
  // qualified-family-authority RETENTION gate, also computes a considered
  // 'no-consensus'-shaped verdict for a family.decision==='fallback-vision'
  // request when its own coherence-floor/retention conditions qualify,
  // completely independent of 'refused-identity-conflict'). Rather than
  // enumerate every branch that can produce a considered "not enough
  // evidence" verdict one at a time (a drifted-duplicate-constant risk this
  // codebase has been burned by before), gate on the one thing that
  // actually distinguishes "a family ALREADY WON and this is asking about
  // ITS OWN internal issue split" (AI Fixture 4 / Venom, decision=
  // 'weighted-consensus', must NOT defer) from "a family did NOT win and
  // something already examined its issue evidence" (Eternus, CONTROL 3,
  // both decision != a real win, must defer): FAMILY_OVERRIDE_DECISIONS
  // (compHygiene.js, already imported — the SAME closed set
  // imageSearchIdentity.js's own override gate and identityCore.js's own
  // qualified-family-authority predicate already treat as "a real title
  // win"). Not in that set + a 'no-consensus' verdict already exists =
  // defer.
  //
  // CORRECTED again (found running the SAME AJ http-handler file's own
  // Detective case — a THIRD, more subtle interaction with the exact same
  // root cause GK-116 already named): resolveFamilyIssueConsensus's own
  // issue extractor is capped at 999 (identityReconciler.js's
  // extractIssueCandidate, the shared, OLDER extractor — NOT the uncapped
  // extractHashIssueNumber this dispatch's own mechanism uses first,
  // specifically because of legacy numbering like #1107). For Detective's
  // real 4-row, 100%-unanimous "#1107" family, resolveFamilyIssueConsensus
  // genuinely cannot SEE "1107" at all (>999) — it reports mode=
  // 'no-consensus' with assertedIssues=[] (empty — nothing parsed, not
  // "parsed but disagreed"), a false negative caused by the same 999-cap
  // gap GK-116 already logged, not a genuine "not enough evidence"
  // verdict like Eternus's real assertedIssues=['2','2']. Deferring here
  // would have silently reintroduced the exact split-brain Directive AI
  // was built to close (Detective Comics #1107 itself — the ORIGINAL named
  // fixture this whole mechanism exists for). Guard 7 now additionally
  // requires assertedIssues to be genuinely non-empty — the family-level
  // mechanism must have actually SEEN and weighed real values before its
  // refusal to adopt counts as a considered verdict this guard defers to.
  const isFamilyIssueConsensusAlreadyDecided = !FAMILY_OVERRIDE_DECISIONS.includes(family?.decision)
    && familyIssueConsensusResult?.mode === 'no-consensus'
    && Array.isArray(familyIssueConsensusResult?.assertedIssues)
    && familyIssueConsensusResult.assertedIssues.length > 0;
  // Guard 8 (a real, eligible, non-contaminated family exists but was
  // refused for TITLE-OVERLAP weakness, not merely a thin member count) —
  // GrailKey Directive 2026-08-17-AS, found regression-testing against
  // tests/q-trackB-commit4.3-winning-family-authority.test.js's own
  // CONTROL E ("Quux Anthology #9" pool, Vision title "Something Else
  // Entirely" — zero relationship to the pool at all). Q38
  // (imageSearchIdentity.js, "Top family has only N members (need >=3 for
  // consensus override) — preserve Vision") and a weak-title-overlap
  // refusal ("Top family weak overlap") both produce family.decision===
  // 'fallback-vision' with a real, non-null topFamily — count alone
  // (familyMemberCount, used above for the contamination guard) cannot
  // distinguish "a thin cluster of the SAME book" (Venom: 1 member, still
  // genuinely "Venom") from "a real cluster of a DIFFERENT book Vision's
  // own title shares nothing with" (Quux: 3 members, unrelated to
  // "Something Else Entirely"). Trusting the frozen row's own issue number
  // in the second case risks adopting evidence from the wrong book
  // entirely — a materially different risk than a thin-but-genuine match.
  // family.reason's own wording already distinguishes the two (Q38's
  // literal "members (need" substring, stable and independently pinned by
  // tests/q132-variant-year-family-corroboration.test.js:90's own fixture)
  // — matched here rather than re-deriving the distinction from scratch.
  // Detective's own fixture (topFamily===null, no family found at all —
  // familyMemberCount===0) is unaffected: this guard requires a REAL
  // family to exist before it can distrust it for overlap reasons.
  //
  // CORRECTED (found running tests/grailkey-directive-aj-http-handler.
  // test.js's real /api/enrich pipeline — the SAME "AG lesson" as Guard
  // 7's own correction above): Detective's REAL pool, through the real
  // handler, does NOT have topFamily===null the way AI's own hand-built
  // unit fixture assumed — a genuine 4-member "Detective Comics #1107..."
  // cluster forms and gets refused for weak/zero overlap with Vision's
  // "Batman" (zero shared TOKENS — "Batman" the character never appears
  // in "Detective Comics" the series title) — structurally identical to
  // CONTROL E's shape by the reason-string check alone. Blocking on
  // family.reason wording this way silently regressed the very Fixture 1
  // this whole campaign is built around. The real, principled difference:
  // Detective's raw POOL (not just the winning cluster) also contains
  // "Batman Funko Pop Figure" / "Batman T-Shirt Large" / "Batman Beyond
  // Compendium TPB" — Vision's own word "Batman" genuinely appears
  // SOMEWHERE in this pool, even though not in the winning cluster's own
  // title. Quux's pool contains nothing resembling "Something", "Else", or
  // "Entirely" ANYWHERE. hasAnyPoolWideVisionTitleOverlap checks the WHOLE
  // raw pool, not just the winning family — a much weaker, more permissive
  // bar than family-level overlap, but enough to separate "this pool is
  // plausibly about the right subject, just not via the winning cluster's
  // own exact title" from "this pool shares literally nothing with what
  // Vision read."
  const hasAnyPoolWideVisionTitleOverlap = (visionTitle, visualItems) => {
    const stop = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'in', 'on', 'at', 'to', 'for', 'with', 'comic', 'comics']);
    const visionTokens = String(visionTitle || '')
      .toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter((t) => t.length >= 3 && !stop.has(t));
    if (visionTokens.length === 0) return true; // nothing to check against — don't distrust on an empty/generic title
    const poolText = (Array.isArray(visualItems) ? visualItems : [])
      .map((it) => String(typeof it === 'string' ? it : (it?.rawTitle || it?.title || '')))
      .join(' ').toLowerCase();
    return visionTokens.some((t) => poolText.includes(t));
  };
  const familyRefusedForMemberCountOnly = typeof family?.reason === 'string' && /members\s*\(need/i.test(family.reason);
  const isFamilyOverlapRefused = familyMemberCount > 0
    && family?.decision === 'fallback-vision'
    && !familyRefusedForMemberCountOnly
    && !hasAnyPoolWideVisionTitleOverlap(vision.title, opts.visualItems);
  let firstEligible = null;
  let candidate = null;
  let candidateCorroboratingRows = 0;
  if (!isGraded && !isNearMissMarginDecline && !isNearMissConflictActive && !zeroSupportRescueDeclined && !isFamilyContaminated && !isFamilyIssueConsensusAlreadyDecided && !isFamilyOverlapRefused) {
    firstEligible = selectFirstEligibleVisual(opts.visualItems);
    // extractHashIssueNumber first (GK-116 — uncapped, handles legacy
    // numbering like Detective Comics #1107 that extractIssueCandidate's
    // shared 999 cap would silently drop); extractIssueCandidate as a
    // fallback for the rare eligible row with no "#N" token at all.
    candidate = firstEligible
      ? (extractHashIssueNumber(firstEligible.rawTitle) || extractIssueCandidate(firstEligible.rawTitle))
      : null;
    const isMarketingFlavored = firstEligible ? isMarketingFlavoredRow(firstEligible.rawTitle) : false;
    // GrailKey Directive 2026-08-17-AS (GK-132) — True Believers class.
    // isEligibleVisualRow (identityReconciler.js) filters lot/variation-
    // group/companion-product rows but NEVER checked REPRINT_RE or
    // IDENTITY_TPB_MARKER_RE — a facsimile reprint (which routinely
    // renumbers to "#1" regardless of the original issue) or a TPB
    // (collects multiple issues, no single issue number applies) can
    // legitimately become `firstEligible`. Found regression-testing this
    // exact dispatch's own MINIMUM_CORROBORATING_ROWS removal against
    // tests/q-vision-zero-support.test.js's own pre-existing "True
    // Believers" control (Test 7) — removing the row-count floor let a
    // reprint's own repeatedly-relisted "#1" claim through where the old
    // floor had accidentally also caught it (every row shared one
    // identical rawTitle with no itemId, so countCorroboratingEligibleRows'
    // dedup collapsed the whole 20-row pool to corroboratingRows=1, which
    // was <3 by coincidence, not by REPRINT_RE ever having been checked).
    // A per-row property check, not a count — a single genuine reprint
    // listing is exactly as disqualifying as twenty identical ones.
    const isReprintOrTpbFlavored = firstEligible
      ? (REPRINT_RE.test(firstEligible.rawTitle) || IDENTITY_TPB_MARKER_RE.test(firstEligible.rawTitle))
      : false;
    // GrailKey Directive 2026-08-17-AS (GK-132/GK-126) — this count is no
    // longer an ENTRY gate (see the removed `corroboratingRows >=
    // MINIMUM_CORROBORATING_ROWS` condition below) — MINIMUM_CORROBORATING_
    // ROWS/countCorroboratingEligibleRows themselves are UNCHANGED and stay
    // fully load-bearing everywhere else (resolveFamilyIssueConsensus's own
    // uniqueRows>=3 bar, the retention/rescue branches above, the title-
    // family Q38 "need >=3 for consensus override" floor in
    // imageSearchIdentity.js) — this is the ONE consumer where the floor
    // used to also gate whether a LONE physical candidate could enter the
    // evidence set at all, which is a different question from whether it
    // can win a CONSENSUS vote against competing values (C4). Kept computed
    // for diagnostic visibility (threaded into visionZeroSupport below,
    // I13) — a thin-corroboration candidate is still visibly thin, it is
    // simply no longer invisible.
    const corroboratingRows = candidate?.issue != null
      ? countCorroboratingEligibleRows(
          opts.visualItems,
          candidate.issue,
          (rawTitle) => extractHashIssueNumber(rawTitle) || extractIssueCandidate(rawTitle)
        )
      : 0;
    candidateCorroboratingRows = corroboratingRows;
    const isEchoOfRejectedVision = visionIssueRejectedUpstream
      && candidate?.issue != null
      && String(candidate.issue) === String(vision.issue);
    // GrailKey Directive 2026-08-17-AS (GK-132) — "the candidate always
    // enters." Production evidence, Venom Separation Anxiety #1, Mike
    // Mayhew (2026-08-17 19:40, build ee03e5a): the frozen rank-1 row was
    // the ONLY eligible row in a 20-row pool asserting issue "1"
    // (corroboratingRows=1 < MINIMUM_CORROBORATING_ROWS=3) — the candidate
    // never entered issueEvidence at all, reconcileIssue saw only Vision's
    // own rejected "150" as conflict evidence with nothing to corroborate
    // against, authority=NONE, value=null, and vision-zero-support's
    // earlier ESCALATE (confirmedIssue=null, identityEscalation=
    // 'ID_REQUIRED', ~line 3024-3033) was never cleared because the
    // line-3363 clear only fires when reconcileIssue's own winning source
    // is 'first-eligible-visual' — which required entry first. Safe to
    // remove the row-count floor from ENTRY specifically because of what
    // shipped between here and Fix 6 (AI, this dispatch's own precedent)
    // and AR (2026-08-17, earlier today): a first-eligible-visual-sourced
    // winner disagreeing with Vision always computes CONTESTED authority
    // (reconcileIssue's own isContested logic) or, on a genuine Vision-
    // absent scan, still demotes via justifiedBy.length===1 below — and
    // AR's actionAuthority/deriveMarketStanding gates already guarantee
    // CONTESTED can never reach EXACT_CURRENT/READY (VARIANT_CONTESTED_
    // EDITION and GK-128's issue-authority gate). A lone-row candidate is
    // no longer a false-confidence risk; it is an honest REVIEW card
    // instead of a wall. isEchoOfRejectedVision, isMarketingFlavored, and
    // isReprintOrTpbFlavored (properties of the candidate's own row, not a
    // count) are unchanged/new-but-still-per-row, not per-count.
    if (
      candidate?.issue != null
      && !isEchoOfRejectedVision
      && !isMarketingFlavored
      && !isReprintOrTpbFlavored
    ) {
      addEvidence(issueEvidence, 'issue', 'first-eligible-visual', candidate.issue);
    }
  }

  const reconciledIssue = reconcileIssue(issueEvidence);
  console.log(
    `[reconcile-issue] value=${reconciledIssue.value ?? 'null'} source=${reconciledIssue.source ?? 'none'} ` +
    `authority=${reconciledIssue.authority} justifiedBy=${JSON.stringify(reconciledIssue.justifiedBy)} ` +
    `conflicts=${JSON.stringify(reconciledIssue.conflicts)}`
  );

  // GrailKey Directive AK (found while fixing GK-119) — demotion must ask
  // "does the winning value have ANY independent corroboration at all,"
  // not merely "does it match Vision." The original check
  // (`vision.issue !== reconciled.value`) missed a real case: a
  // genuinely agreeing 'family-population' vote (e.g. Spawn #351, 5/5
  // unanimous, Vision supplied no issue) still demoted the result purely
  // because Vision itself was absent — even though the value was
  // independently corroborated by the family. `justifiedBy.length === 1`
  // means the winner has EXACTLY ONE supporting entry (itself) and
  // nothing else — vision, family-population, or otherwise — agrees
  // with it; that is the honest "single unverified source" shape
  // Detective's own fixture requires demotion for. Any second agreeing
  // entry (Fixture 7: vision agrees; Spawn #351: family-population
  // agrees) means real, independent corroboration exists and demotion
  // must not fire.
  let identityProvisionalFromVisualFirst = false;
  confirmedIssue = reconciledIssue.value;
  if (
    reconciledIssue.source === 'first-eligible-visual'
    && reconciledIssue.justifiedBy.length === 1
  ) {
    identitySource = `${identitySource}+first_eligible_visual_contested`;
    matchConfidenceDemote = true;
    identityEscalation = null;
    identityProvisionalFromVisualFirst = true;
    visionZeroSupport = {
      mode: 'visual-first-contested',
      visionIssue: vision.issue ?? null,
      adoptedIssue: reconciledIssue.value,
      poolTotal: opts.ebayResultCount || null,
      // GrailKey Directive AS (GK-132) — diagnostic only, not a gate (I13):
      // how many independent eligible rows corroborated this issue number
      // in the raw pool. A thin candidate (< MINIMUM_CORROBORATING_ROWS,
      // identityReconciler.js) is visible on the card now, not withheld.
      corroboratingRows: candidateCorroboratingRows,
    };
    console.log(
      `[first-eligible-visual] adopting issue="${reconciledIssue.value}" from first eligible visual row ` +
      `("${firstEligible?.rawTitle}") — Vision issue was ${vision.issue == null ? 'absent' : `"${vision.issue}" (rejected upstream)`} — CONTESTED, not confirmed`
    );
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
    visionPublisherZeroSupport,
    isProvisionalOverride,
    identityProvisionalFromVisualFirst,
    familyIssueConsensus: familyIssueConsensusResult,
    // Track B Phase 0, Commit 4.1
    familyYearConsensus: familyYearConsensusResult,
    // GrailKey Directive 2026-08-16-AQ (GK-127) — the Slice-1 reconciler's
    // own, single, canonical verdict for the issue facet (value/source/
    // authority/justifiedBy/conflicts). api/enrich.js's projectIssueAuthority
    // (src/lib/issueAuthority.js) is the normal visual-resolution path's
    // out.issueAuthority writer, deriving it as a pure projection of this
    // value — never independent reinterpretation of familyIssueConsensus/
    // familyYearConsensus's own mode/outcome flags. CORRECTED (AQ-follow-up,
    // same day): not the ONLY writer of out.issueAuthority overall — three
    // separately-scoped exceptional mutation paths (escalateIssueAuthorityOnConflict,
    // manual-correction provenance, checkCrossPopulationPromotionGuard)
    // still write it independently; see docs/PATTERN-LIBRARY.md's
    // AQ-follow-up section for the full accounting and their Slice-2
    // destinations. GK-128 (proven live): this reconciler's own evidence
    // set does not yet see a genuine near-miss runner-up's dissenting
    // value, so a real conflict can compute CORROBORATED here — fix
    // traced, not built, awaiting greenlight.
    reconciledIssue,
    // GrailKey Directive 2026-08-20-AV (GK-133) — the title facet's own
    // reconciler verdict, same shape/contract as reconciledIssue above.
    // null when the fallback-vision void never applied (family won
    // outright, or no candidate existed at all) — api/enrich.js only
    // reads this inside the same branch that produced it.
    reconciledTitle,
    titleAdoptedContested,
  };
};

/**
 * Q131 (2026-07-19, Eternus #2 / He-Man class) — Ship 11's identity-refused
 * fallback price (api/enrich.js) used to blend EVERY raw visual-pool item
 * together regardless of whether the pool coherently split into families —
 * an "honest refusal" price built from Eternus $150 comps averaged in with
 * Lobo #1, Conan, and random art-print listings isn't honest, it's just a
 * differently-fabricated number with a lower-confidence label. When
 * familyCandidate.topFamily exists with >=2 members (genuine corroboration,
 * matches the same threshold Fix 1/resolveIdentity uses), isolate the
 * fallback pool to just that family's own comps instead of the full mixed
 * pool. A coherent single-product pool doesn't need the raw pool's >=5
 * statistical floor — 2 genuine comps for one product beats 17 comps for
 * six unrelated products.
 *
 * Pure function, extracted for direct regression-testability (same
 * rationale as Q111's applyVariantPreferenceFilter extraction).
 *
 * @param {Array<Object>} visualItems - visualResult.items (the same array
 *   passed to selectTitleFamilyCandidate)
 * @param {Object|null} familyCandidate - selectTitleFamilyCandidate() result
 * @returns {{fallbackPrice: number|null, fallbackLow: number|null, fallbackHigh: number|null, fallbackPoolSize: number, isolatedToFamily: boolean, familyTitle: string|null}}
 */
export const buildIdentityRefusedFallbackPool = (visualItems, familyCandidate) => {
  const familyIndices = familyCandidate?.topFamily?.indices;
  const isolatedPrices = Array.isArray(familyIndices) && familyIndices.length >= 2
    ? familyIndices
        .map((idx) => Number(visualItems?.[idx]?.price))
        .filter((p) => Number.isFinite(p) && p > 0 && p < 10000)
        .sort((a, b) => a - b)
    : null;

  const useIsolatedPool = !!(isolatedPrices && isolatedPrices.length >= 2);
  const poolPrices = useIsolatedPool
    ? isolatedPrices
    : (visualItems || [])
        .map((i) => Number(i?.price))
        .filter((p) => Number.isFinite(p) && p > 0 && p < 10000)
        .sort((a, b) => a - b);

  // Isolated family pool is coherent (one product) — a 2-item minimum is
  // enough for an honest range. The raw mixed-pool path is still noisy and
  // keeps the original >=5 statistical floor.
  const threshold = useIsolatedPool ? 2 : 5;
  if (poolPrices.length < threshold) {
    return {
      fallbackPrice: null, fallbackLow: null, fallbackHigh: null,
      fallbackPoolSize: 0, isolatedToFamily: false, familyTitle: null,
    };
  }

  const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
  return {
    fallbackPrice: Math.round(pct(poolPrices, 0.5) * 100) / 100,
    fallbackLow: Math.round(pct(poolPrices, 0.25) * 100) / 100,
    fallbackHigh: Math.round(pct(poolPrices, 0.75) * 100) / 100,
    fallbackPoolSize: poolPrices.length,
    isolatedToFamily: useIsolatedPool,
    familyTitle: useIsolatedPool ? familyCandidate.topFamily.title : null,
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
      // Q119 dispatch (2026-07-18, Captain Marvel #17 class) — this was a
      // naked publisher strip with NO compound-title guard, a separate,
      // unprotected duplicate of the exact job sanitizeSeriesTitle already
      // guards two functions away in this same file (Q24 fix). Real
      // production case: "Captain Marvel Comics #17 CGC 9.6 1977" →
      // publisher-strip regex matched "Marvel Comics" (word immediately
      // followed by "comics") → "Captain #17..." — Marvel already gone
      // before sanitizeSeriesTitle(topSeries) runs on the result below,
      // too late for its whitelist to recover it. Now masks a matched
      // COMPOUND_TITLE_WHITELIST phrase BEFORE stripping (rather than
      // skipping the whole publisher-strip step) — a comp title routinely
      // carries other genuine noise alongside a compound title ("Captain
      // Marvel Comics #17 CGC 9.6 1977": the trailing "Comics" IS
      // boilerplate even though "Captain Marvel" isn't), so blanket-
      // skipping the strip would leave "Comics" stuck to the result.
      // Masking protects only the matched phrase itself; everything else
      // still gets cleaned normally.
      const extractSeriesName = (rawTitle) => {
        const str = String(rawTitle || '');
        const rawLower = str.toLowerCase();

        let masked = str;
        let restoreToken = null;
        let restoreOriginal = null;
        for (const entry of COMPOUND_TITLE_WHITELIST) {
          const idx = rawLower.indexOf(entry);
          if (idx === -1) continue;
          restoreOriginal = str.slice(idx, idx + entry.length);
          restoreToken = '__CVPROTECT__';
          masked = masked.slice(0, idx) + restoreToken + masked.slice(idx + entry.length);
          break; // protect the first match found — compound entries don't meaningfully overlap
        }

        let cleaned = masked
          .replace(/#\s*\d+/g, ' ')                    // strip issue number
          .replace(/\b(19[3-9]\d|20[0-2]\d)\b/g, ' ')  // strip years
          .replace(/\b(cgc|cbcs|pgx|graded)\s*[\d.]+/gi, ' ')  // strip slab grades
          .replace(/\b(nm|vf|fn|vg|gd|fr|pr)\b/gi, ' ')  // strip raw grades
          .replace(/\b(marvel|dc|image|dark horse|idw|boom|dynamite|valiant|archie)\s*comics?\b/gi, ' ')  // strip publishers
          // Bare leftover "comics"/"comic" (e.g. the masked-out "Marvel"
          // in "Marvel Comics" leaves "Comics" orphaned, no longer
          // preceded by a publisher word for the regex above to catch).
          // Safe unconditionally — anything meaningful containing "comics"
          // as part of a real title (Marvel Comics Presents, DC Comics
          // Presents, Image Comics Presents) is a whitelist entry and
          // already fully protected inside the placeholder token above.
          .replace(/\bcomics?\b/gi, ' ')
          .replace(/[()[\]{}]/g, ' ')                  // strip brackets
          .replace(/\s+/g, ' ')
          .trim();

        if (restoreToken) {
          cleaned = cleaned.replace(restoreToken, restoreOriginal);
        }

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
    // G.O.D.S. dispatch — collapse punctuated acronyms before the strip
    // below, which otherwise fragments "G.O.D.S." into single letters that
    // this function's own length>=3 floor then drops entirely.
    const coreTokens = normalizeAcronyms(String(result.title || ''))
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
 * Q112 dispatch (2026-07-18, Batman #608 class) — derive a ComicVine YEAR
 * for year-resolution purposes from the matched ISSUE's own `cover_date`,
 * never the matched VOLUME's `start_year`. Batman vol. 1 started 1940;
 * issue #608 (Hush, 2002) is 62 years later — a `comicVine` object built
 * from `startYear` (the series launch year, from a separate ComicVine
 * volume-endpoint call) is correct for nothing except "when did this
 * SERIES launch," and `resolveYear` has no independent plausibility check
 * to catch it once fed in as if it were the issue's own year. `coverDate`
 * IS the issue-level field, format "YYYY-MM-DD" (ComicVine's issue-search
 * response) — same parse pattern already used for the equivalent
 * local candidate-scoring filter in api/enrich.js ("Strict year filter...
 * Uses issue cover_date, NOT volume start_year"). No startYear fallback
 * here deliberately: a wrong-but-present value is worse than falling
 * through to resolveYear's other sources (PC year, then user/Vision year)
 * when coverDate is unavailable. Structural — applies to every
 * long-running ongoing series (Detective, Action, Superman, ASM v1,
 * FF v1, X-Men v1, etc.), not Batman-specific.
 *
 * @param {{coverDate?: string|null}|null} comicVine - lookupComicVine's return object
 * @returns {number|null}
 */
export const deriveCvYear = (comicVine) => {
  if (!comicVine?.coverDate) return null;
  const year = parseInt(String(comicVine.coverDate).split('-')[0], 10);
  return Number.isFinite(year) ? year : null;
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
