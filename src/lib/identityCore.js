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

import { COMPOUND_WHITELIST, REPRINT_RE, FAMILY_OVERRIDE_DECISIONS, normalizeAcronyms, NON_GENUINE_COPY_RE, hasContaminatedMember, familyDominatesRunnerUp, hasValidFamilyMembership, tokenizeTitle } from './compHygiene.js';
import { normalizeOptionalYear } from './yearEvidence.js';

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
    new RegExp(`\\b(${LEGACY_CREATOR_NOISE_WORDS.join('|')})\\b`, 'gi'),
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
 * @param {string|null|undefined} familyDecision - familyCandidate?.decision
 * @returns {boolean} true when the 22e assembly-integrity check should be skipped
 */
export const shouldSkipAssemblyIntegrityCheck = (familyDecision) =>
  familyDecision === 'refused-identity-conflict';

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
 * different epistemic status than the two FAMILY_OVERRIDE_DECISIONS
 * sources, which only ever fire when a real consensus bar (count/overlap
 * thresholds inside buildTitleFamilies/scoreTitleFamilies) was actually
 * cleared. Also excludes 'ebay_visual_override'/'vision_numeric_protection'
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
 * that case.
 *
 * Ties (including all-zero, i.e. no candidate matches confirmedVariant at
 * all) keep the first-encountered candidate — same graceful degradation
 * as today's single-candidate fallback.
 *
 * @param {Array<{productName: string}>} candidates - bracket-variant PC candidates, in API order
 * @param {string|null} confirmedVariant - confirmed variant name, or null
 * @returns {object|null} the selected candidate, or null if candidates is empty
 */
export const selectBestVariantCandidate = (candidates, confirmedVariant) => {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  if (!confirmedVariant) return candidates[0];

  let best = candidates[0];
  let bestScore = variantTokenOverlapScore(confirmedVariant, candidates[0].productName);
  for (let i = 1; i < candidates.length; i++) {
    const score = variantTokenOverlapScore(confirmedVariant, candidates[i].productName);
    if (score > bestScore) {
      best = candidates[i];
      bestScore = score;
    }
  }
  return best;
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
  const familyAuthoritySkip = isNearMissConflictActive || (familyAuthorityCurrent
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
    familyIssueConsensus: familyIssueConsensusResult,
    // Track B Phase 0, Commit 4.1
    familyYearConsensus: familyYearConsensusResult,
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
