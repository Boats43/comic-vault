// Ship #20a.6.7a — pure parser for eBay image-search itemSummaries.
//
// Input: array of `{ title }` rows from the eBay Browse API
// /buy/browse/v1/item_summary/search_by_image response.
//
// Output: structured identity rows
//   { rawTitle, title, issue, year, variantTokens }
//
// Variant token catalog is static (leverage-first per the Ship #20a.6.7
// investigation). Categories: convention, ratio, retailer, authentication,
// finish. Tokens are deduped, lowercased, and emitted in stable order
// (convention → ratio → retailer → auth → finish) so consumers can rely
// on positional intent.
//
// Phase 1 scope: descriptive metadata only. The variant tokens are NOT
// fed into the pricing-multiplier table (api/enrich.js variantMultipliers).
// Phase 2 (Ship #20a.6.7b) layers cross-reference confidence on top.
// Phase 3 (Ship #20a.6.7c) requires explicit pricing-math greenlight before
// routing tokens into the multiplier chain.
//
// Per Ship #15 architectural rule: pure helper has no HTTP handler; lives
// in src/lib/, imported by api/enrich.js. Vercel bundles transitively.
// Function count stays at 12/12.

// Q43 A1.a — Import sanitizeSeriesTitle for top-rank identity cleanup
import { sanitizeSeriesTitle, COMPOUND_TITLE_WHITELIST, extractIssueCandidate, resolveFamilyYearConsensus } from './identityCore.js';
import { ARTIST_PATTERNS, ARTIST_FAMILY_STRIP_EXCEPTIONS, compactTitleKey, IDENTITY_TPB_MARKER_RE, normalizeAcronyms, NON_GENUINE_COPY_RE, LOT_RE, REPRINT_RE, SLAB_RE, GRADED_RE, SIGNED_RE, TPB_MARKER_RE, extractArtist, hasContaminatedMember, isCompetingFamilyTooStrong, FAMILY_OVERRIDE_DECISIONS } from './compHygiene.js';

// ─────────────────────────── token catalogs ───────────────────────────
//
// Each entry is `{ re, token }`. `re` is matched against the listing title;
// when it fires the canonical `token` is added. Categories appended in
// order so the output array stays stable across runs.

const CONVENTION_PATTERNS = [
  { re: /\bmegacon\b/i,            token: 'megacon' },
  { re: /\bnycc\b/i,               token: 'nycc' },
  { re: /\bc2e2\b/i,               token: 'c2e2' },
  { re: /\bsdcc\b/i,               token: 'sdcc' },
  { re: /\bfan[\s-]?expo\b/i,      token: 'fanexpo' },
  { re: /\bemerald\s+city\b/i,     token: 'emerald city' },
  { re: /\beccc\b/i,               token: 'eccc' },
  { re: /\bwondercon\b/i,          token: 'wondercon' },
];

// Ratio variants (1:N). Sorted descending so /\b1:1000\b/ tries before
// /\b1:100\b/ — word boundaries already prevent false matches but keeping
// the order avoids relying on regex ordering quirks.
const RATIO_PATTERNS = [
  { re: /\b1:1000\b/, token: '1:1000' },
  { re: /\b1:500\b/,  token: '1:500'  },
  { re: /\b1:250\b/,  token: '1:250'  },
  { re: /\b1:200\b/,  token: '1:200'  },
  { re: /\b1:150\b/,  token: '1:150'  },
  { re: /\b1:100\b/,  token: '1:100'  },
  { re: /\b1:75\b/,   token: '1:75'   },
  { re: /\b1:50\b/,   token: '1:50'   },
  { re: /\b1:40\b/,   token: '1:40'   },
  { re: /\b1:25\b/,   token: '1:25'   },
  { re: /\b1:20\b/,   token: '1:20'   },
  { re: /\b1:15\b/,   token: '1:15'   },
  { re: /\b1:10\b/,   token: '1:10'   },
];

const RETAILER_PATTERNS = [
  { re: /\bsilverbax\b/i,                  token: 'silverbax' },
  { re: /\bcomic\s*tom\b/i,                token: 'comictom' },
  { re: /\bscorpion\s+comics?\b/i,         token: 'scorpion' },
  { re: /\bfrankie'?s\b/i,                 token: 'frankies' },
  { re: /\bunknown\s+comics?\b/i,          token: 'unknown comics' },
  { re: /\bwalmart\b/i,                    token: 'walmart' },
  { re: /\btarget\s+exclusive\b/i,         token: 'target' },
  { re: /\bhot\s+topic\b/i,                token: 'hot topic' },
];

// Authentication / signature markers. NB: bare `\bss\b` carries a known
// false-positive risk on series names like SS-Squadron. In practice eBay
// listing titles use SS overwhelmingly to mean "signature series" (CGC SS).
// Phase 1 surfaces this as descriptive metadata only — no pricing impact —
// so the false-positive surface is acceptable. Phase 2/3 cross-reference
// can ignore the SS token when other authentication signals are absent.
const AUTH_PATTERNS = [
  { re: /\bsignature\s+series\b/i,         token: 'signature series' },
  { re: /\bautographed?\b/i,               token: 'autographed' },
  { re: /\bcoa\b/i,                        token: 'coa' },
  { re: /\bsigned\b/i,                     token: 'signed' },
  { re: /\bcertified\b/i,                  token: 'certified' },
  { re: /\bremarked?\b/i,                  token: 'remark' },
  { re: /\bss\b/i,                         token: 'ss' },
];

// Cover / print finish.
const FINISH_PATTERNS = [
  { re: /\bgold\s+foil\b/i,                token: 'gold foil' },
  { re: /\bsilver\s+foil\b/i,              token: 'silver foil' },
  { re: /\bholofoil\b/i,                   token: 'holofoil' },
  { re: /\bholo(?:gram|graphic)?\b/i,      token: 'holographic' },
  { re: /\bglow[-\s]?in[-\s]?(?:the[-\s]?)?dark\b/i, token: 'glow-in-dark' },
  { re: /\bembossed\b/i,                   token: 'embossed' },
  { re: /\bmetallic\b/i,                   token: 'metallic' },
  { re: /\bvirgin\b/i,                     token: 'virgin' },
  { re: /\bsketch\b/i,                     token: 'sketch' },
  { re: /\bfoil\b/i,                       token: 'foil' },
];

// Ship #20a.6.18 — Exclusive markers (convention exclusives, store exclusives,
// secret drops). Captures the descriptor but not the quantity/limitation
// (that's handled by LIMITATION_PATTERNS below). Sorted from most-specific
// to least-specific so multi-word patterns match before bare "exclusive".
const EXCLUSIVE_PATTERNS = [
  { re: /\bconvention\s+exclusive\b/i,     token: 'convention exclusive' },
  { re: /\bcon\s+exclusive\b/i,            token: 'con exclusive' },
  { re: /\bstore\s+exclusive\b/i,          token: 'store exclusive' },
  { re: /\bshop\s+exclusive\b/i,           token: 'shop exclusive' },
  { re: /\bweb\s+exclusive\b/i,            token: 'web exclusive' },
  { re: /\bonline\s+exclusive\b/i,         token: 'online exclusive' },
  { re: /\bsecret\s+drop\b/i,              token: 'secret drop' },
  { re: /\bexclusive\b/i,                  token: 'exclusive' },
  { re: /\bexcl\.?\b/i,                    token: 'exclusive' },
];

// Ship #20a.6.18 — Limitation markers. Captures print-run limitation strings
// ("LTD 150", "limited to 200", "#47/150"). The captured token is the
// CANONICAL form (lowercased, normalized). eBay sellers use many variations:
// "LTD 150", "Ltd. 150", "Limited to 150", "Limited 150", "#/150", etc.
// Pattern order: most-specific (numbered copies) → abbreviated (LTD N) →
// spelled-out (limited to N / limited N).
const LIMITATION_PATTERNS = [
  { re: /\b#\s*\d+\s*\/\s*(\d+)\b/i,               token: 'numbered' },  // "#47/150"
  { re: /\b#\s*\d+\s+of\s+(\d+)\b/i,               token: 'numbered' },  // "#47 of 150"
  { re: /\bltd\.?\s*(\d+)\b/i,                     token: 'limited' },   // "LTD 150"
  { re: /\blimited\s+to\s+(\d+)\b/i,               token: 'limited' },   // "limited to 150"
  { re: /\blimited\s+(\d+)\b/i,                    token: 'limited' },   // "limited 150"
  { re: /\b(\d+)\s+copies?\b/i,                    token: 'limited' },   // "150 copies"
];

// Q116 dispatch (2026-07-18, Incredible Hulk #377 class) — printing/edition
// markers (1st/2nd/3rd/.../Nth printing, facsimile). A printing-edition
// premium is exactly as load-bearing as an SDCC-exclusive or ratio-incentive
// claim — a 3rd printing and a 1st printing are different products with
// different market values, same as two different variant covers — so this
// is a SPECIFIC (distinguishing) category, not generic, matching the
// dispatch's explicit ruling. Mirrors REPRINT_RE's (compHygiene.js) numeric
// coverage (1st-5th + spelled-out forms) plus facsimile, which REPRINT_RE
// already treats as a hard-reject signal but no CATEGORY_BLOCKS entry
// previously recognized as a token at all. Descending order (5th->1st),
// matching RATIO_PATTERNS' established convention in this file. A 6th+
// printing is extremely rare in practice; the trailing generic pattern
// covers that tail without needing per-number dynamic tokens (this file's
// token model is static strings, same as LIMITATION_PATTERNS above, which
// also collapses a captured number into one canonical token).
const PRINTING_PATTERNS = [
  { re: /\b5th\s*p(?:rint|tg|rinting)\b|\bfifth\s*print(?:ing)?\b/i,  token: '5th print' },
  { re: /\b4th\s*p(?:rint|tg|rinting)\b|\bfourth\s*print(?:ing)?\b/i, token: '4th print' },
  { re: /\b3rd\s*p(?:rint|tg|rinting)\b|\bthird\s*print(?:ing)?\b/i,  token: '3rd print' },
  { re: /\b2nd\s*p(?:rint|tg|rinting)\b|\bsecond\s*print(?:ing)?\b/i, token: '2nd print' },
  { re: /\b1st\s*p(?:rint|tg|rinting)\b|\bfirst\s*print(?:ing)?\b/i,  token: '1st print' },
  { re: /\bfacsimile\b/i,                                            token: 'facsimile' },
  { re: /\b[6-9]th\s*p(?:rint|tg|rinting)\b|\b\d{2,}(?:st|nd|rd|th)\s*p(?:rint|tg|rinting)\b/i, token: 'nth print' },
];

const CATEGORY_BLOCKS = [
  { kind: 'convention',     patterns: CONVENTION_PATTERNS },
  { kind: 'ratio',          patterns: RATIO_PATTERNS      },
  { kind: 'retailer',       patterns: RETAILER_PATTERNS   },
  { kind: 'exclusive',      patterns: EXCLUSIVE_PATTERNS  },
  { kind: 'limitation',     patterns: LIMITATION_PATTERNS },
  { kind: 'authentication', patterns: AUTH_PATTERNS       },
  { kind: 'printing',       patterns: PRINTING_PATTERNS   },
  { kind: 'finish',         patterns: FINISH_PATTERNS     },
];

// Q111 dispatch (2026-07-18, Venomverse #1 class) — 'finish' is the only
// category that's inherently generic (foil/virgin/sketch/holographic/etc
// describe a cover TREATMENT, not a distinguishing PRODUCT). The other
// seven (convention/ratio/retailer/exclusive/limitation/authentication/
// printing — 'printing' added Q116 dispatch, Incredible Hulk #377 class)
// each name a specific, distinguishing fact about the printing. Single
// source of truth for "specific vs generic" — used by extractConsensus
// (below, per-category variant consensus) AND api/comps.js Filter 1c
// (AND-match on specific tokens) so the two call sites can never drift on
// the taxonomy.
const GENERIC_VARIANT_KINDS = new Set(['finish']);

let _tokenToCategory = null;
const tokenToVariantCategory = () => {
  if (_tokenToCategory) return _tokenToCategory;
  _tokenToCategory = {};
  for (const { kind, patterns } of CATEGORY_BLOCKS) {
    for (const { token } of patterns) {
      if (!(token in _tokenToCategory)) _tokenToCategory[token] = kind;
    }
  }
  return _tokenToCategory;
};

const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let _sortedTokens = null;
const sortedVariantTokens = () => {
  if (_sortedTokens) return _sortedTokens;
  _sortedTokens = Object.keys(tokenToVariantCategory()).sort((a, b) => b.length - a.length);
  return _sortedTokens;
};

/**
 * Q111 — classify a variant token string (or space-joined multi-token
 * string) into { specific: string[], generic: string[] }, using the same
 * CATEGORY_BLOCKS taxonomy extractVariantTokens draws from. Unrecognized
 * words (not a known variant token at all — e.g. "mcfarlane", an artist
 * name, or "mexican", a regional descriptor neither has a category yet)
 * are NOT classified as either — callers should treat them as neutral,
 * not as a match requirement, since there's no registry to confirm they
 * mean what they look like they mean.
 *
 * Q116 dispatch (2026-07-18, Incredible Hulk #377 class) — rewritten from a
 * naive whitespace word-split to a longest-token-first substring match
 * against the full known-token registry (mirrors extractVariantTokens' own
 * convention). The word-split version silently dropped any token whose
 * words don't ALSO exist as standalone tokens elsewhere — it worked "by
 * luck" for "gold foil" (bare "foil" is separately a valid token) and
 * "convention exclusive" (bare "exclusive" is separately valid), but
 * totally missed inherently-multi-word-only tokens: "signature series"
 * classified as { specific: [], generic: [] } even pre-Q116 (confirmed via
 * direct testing, not a new regression), and the new printing tokens ("3rd
 * print", "2nd print") have no standalone-word fallback at all ("3rd" and
 * "print" are not valid tokens on their own). Longest-first + a
 * skip-if-already-covered-by-a-longer-match guard (mirrors
 * extractVariantTokens' bare-"foil"-vs-"gold foil" suppression) prevents
 * double-counting a multi-word token AND its own substring separately.
 *
 * @param {string} variant - our confirmed variant string, e.g. "sdcc 1:1000 foil"
 * @returns {{specific: string[], generic: string[]}}
 */
export const classifyVariantTokens = (variant) => {
  const lookup = tokenToVariantCategory();
  const v = String(variant || '').toLowerCase();
  const specific = [];
  const generic = [];
  if (!v) return { specific, generic };
  const matched = [];
  for (const token of sortedVariantTokens()) {
    if (matched.some((m) => m.includes(token))) continue;
    const re = new RegExp(`\\b${escapeRegExp(token)}\\b`, 'i');
    if (!re.test(v)) continue;
    matched.push(token);
    const kind = lookup[token];
    if (GENERIC_VARIANT_KINDS.has(kind)) generic.push(token);
    else specific.push(token);
  }
  return { specific, generic };
};

// ───────────────────────── exported helpers ─────────────────────────

// Extract variant tokens from a single title. Returns deduped, lowercase
// strings in stable category order. Empty array when no patterns fire.
//
// Multi-word finish tokens (e.g. "gold foil") match before bare "foil"
// because FINISH_PATTERNS lists them first; the dedup Set then prevents
// "foil" being added on its own when "gold foil" already fired.
export const extractVariantTokens = (title) => {
  const t = String(title || '');
  if (!t) return [];
  const seen = new Set();
  const tokens = [];
  for (const { patterns } of CATEGORY_BLOCKS) {
    for (const { re, token } of patterns) {
      if (seen.has(token)) continue;
      if (re.test(t)) {
        seen.add(token);
        tokens.push(token);
      }
    }
  }
  // Suppress bare 'foil' when 'gold foil' / 'silver foil' / 'holofoil'
  // already fired — same physical attribute, the more specific token wins.
  if (tokens.includes('foil') && (tokens.includes('gold foil') || tokens.includes('silver foil') || tokens.includes('holofoil'))) {
    return tokens.filter((t) => t !== 'foil');
  }
  return tokens;
};

// Commit B (2026-07-28) — delegates to the shared extractIssueCandidate
// (identityCore.js) instead of this module's own independent #-only regex.
// Defect B ("parser unification"): this function and
// resolveFamilyIssueConsensus's inline regex had drifted into two
// independent implementations, each missing what the other had — this one
// never supported a bare (no "#") issue number at all, the same real gap
// the Batman #15 production pool exposed for the other one. Kept as a
// named export (not inlined at call sites) since callers below and in
// api/enrich.js already import it by this name — a signature-compatible
// wrapper, not a behavior change to its own public contract (still
// returns a bare issue-number string or null, not the {issue, matchType,
// ...context flags} shape extractIssueCandidate itself returns).
//
// Commit B2 (2026-07-28, URGENT regression repair) — this is the RAW/
// GLOBAL pool consumer (feeds extractConsensus's pool-wide tally, a
// single-row read with no corroborating structure), so it applies the
// marketingContext suppression itself — exactly the pre-Commit-B
// behavior. resolveFamilyIssueConsensus (identityCore.js) is the OTHER
// consumer of extractIssueCandidate and deliberately does NOT apply this
// suppression — see that function's own doc comment for why (its own
// >=3-row/>=60%/clear-lead bar is the authority there instead).
export const extractIssueFromTitle = (title) => {
  const candidate = extractIssueCandidate(title);
  if (!candidate || candidate.marketingContext) return null;
  return candidate.issue;
};

// Extract a 4-digit year from a title. Range: 1900-2099. Prefers a
// parenthesized year `(1985)` (the canonical eBay form) over a bare
// year, which can appear inside variant strings or grade contexts.
const PAREN_YEAR_RE = /\((19\d{2}|20\d{2})\)/;
const BARE_YEAR_RE  = /\b(19\d{2}|20\d{2})\b/;
export const extractYearFromTitle = (title) => {
  const t = String(title || '');
  const p = t.match(PAREN_YEAR_RE);
  if (p) return p[1];
  const b = t.match(BARE_YEAR_RE);
  return b ? b[1] : null;
};

// Best-effort series name extraction. Strips slab markers, paren blocks
// (year + extras), #issue, prices, ratio markers, all variant tokens, and
// noise words. Whatever remains is the candidate series name. Returns
// null when the strip leaves nothing meaningful (length < 2).
//
// Imperfect by design — modern variant titles are noisy. Phase 2 cross-
// reference uses tokenized comparison against Vision/PC/CV titles, so
// exact equality is not required. Returning null on uncertainty is safer
// than guessing.
const SLAB_STRIP_RE = /\b(?:cgc|cbcs|pgx|psa|egs|hga)\s*(?:ss|signature\s+series|mt|nm[+/-]?(?:mt)?|vf[+/-]?(?:nm)?|fn[+/-]?(?:vf)?|vg[+/-]?(?:fn)?|gd[+/-]?(?:vg)?|fr|pr)?\s*\d+(?:\.\d+)?/i;
const NOISE_WORDS_RE = /\b(?:exclusive|excl|variant|edition|cover\s+[a-z]\b|cvr\s+[a-z]\b|comics?|comic\s+book|near\s+mint|nm|vf|fn|ltd\s*\d*|limited|first\s+print|1st\s+print|2nd\s+print|3rd\s+print)\b/gi;
const PRICE_BLOCK_RE = /\$\d+(?:\.\d{1,2})?/g;
const RATIO_STRIP_RE = /\b1:\d+\b/g;
const HASH_ISSUE_RE = /#\s*\d{1,3}\b/g;
const PAREN_BLOCK_RE = /\([^)]*\)/g;

export const extractSeriesTitle = (rawTitle) => {
  if (!rawTitle) return null;
  let s = String(rawTitle);
  s = s.replace(SLAB_STRIP_RE, ' ');
  s = s.replace(PAREN_BLOCK_RE, ' ');     // strips (year), (variant), (signed), …
  s = s.replace(HASH_ISSUE_RE, ' ');
  s = s.replace(PRICE_BLOCK_RE, ' ');
  s = s.replace(RATIO_STRIP_RE, ' ');
  // Strip every variant token's regex match — flatten CATEGORY_BLOCKS.
  for (const { patterns } of CATEGORY_BLOCKS) {
    for (const { re } of patterns) {
      const flagSet = new Set([...re.flags, 'g']);
      s = s.replace(new RegExp(re.source, [...flagSet].join('')), ' ');
    }
  }
  s = s.replace(NOISE_WORDS_RE, ' ');
  s = s.replace(/[#:&|/\\\[\]]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  if (!s || s.length < 2) return null;
  return s;
};

// Main entry — parse a list of eBay itemSummaries items into structured
// identity rows. Each row carries rawTitle / title / issue / year /
// variantTokens. Items without a string title are kept with all-null
// fields so callers can correlate index-aligned with the original items.
export const extractIdentityFromImageSearch = (items) => {
  if (!Array.isArray(items)) {
    console.log(`[extractIdentity] NOT AN ARRAY:`, typeof items);
    return [];
  }
  console.log(`[extractIdentity] processing ${items.length} items, first item:`, items[0]);
  // Track B Phase 0, Commit 4.1 review round (item 3) — the original
  // permanent instrumentation here (a `[extractIdentity] full pool:` dump
  // of every one of the pool's items on EVERY request) was narrowed after
  // the mandated full-suite A/B showed it altering two failing suites'
  // captured output (harmlessly, but real log-volume noise nonetheless)
  // and after review flagged it as an unbounded per-request Vercel log-
  // volume cost with no corresponding need — the actual approved ask was
  // recovering a SELECTED family's own member itemIds, not the entire raw
  // pool on every single scan regardless of outcome. That narrower,
  // family-scoped log now lives in selectTitleFamilyCandidate (this file,
  // below), which fires exactly once per request and only for the two
  // decisions where a family is genuinely selected (top-rank-protection /
  // weighted-consensus) — never for fallback-vision/refused-identity-
  // conflict, where there is no selected family to log. itemId/legacyItemId
  // are still carried on every parsed row below (their presence there is
  // what makes the family-scoped log possible) — just no longer dumped in
  // bulk here.
  const results = items.map((it, idx) => {
    const rawTitle = (it && typeof it.title === 'string') ? it.title : null;
    // Ship 6 prep — preserve commerce fields per item so downstream pricing
    // logic can use eBay image-search results directly as a polybag comp
    // pool. When ≥60% of titles match REPRINT_RE (Ship 6), use these items'
    // prices as the polybag pool instead of refusing-to-price.
    //
    // NOTE: These are ACTIVE listing prices from search_by_image (Browse API),
    // NOT sold comps. Ship 6 must apply ask-to-sold haircut (~0.75x) and label
    // pricingSource accordingly. Field name `endTime` is raw eBay `itemEndDate`
    // and differs from rawComps.recentSales.date — Ship 6 build will need a
    // mapVisualToRecentSale() helper for plumbing into existing comp pool.
    const priceVal = (it?.price?.value != null) ? parseFloat(it.price.value) : NaN;
    const parsed = {
      rawTitle,
      title: extractSeriesTitle(rawTitle),
      issue: extractIssueFromTitle(rawTitle),
      year: extractYearFromTitle(rawTitle),
      variantTokens: extractVariantTokens(rawTitle),
      price: !isNaN(priceVal) && priceVal > 0 ? priceVal : null,
      itemWebUrl: it?.itemWebUrl || null,
      endTime: it?.itemEndDate || null,
      // Track B Phase 0, Commit 4.1 review round (item 3) — carried
      // through so the family-scoped log in selectTitleFamilyCandidate
      // (this file) can report a selected family member's real eBay
      // itemId/legacyItemId without a second, separate raw-item lookup.
      itemId: it?.itemId || null,
      legacyItemId: it?.legacyItemId || null,
      // Ship #28a: Preserve eBay metadata for conflict detection
      leafCategoryIds: Array.isArray(it?.leafCategoryIds) ? it.leafCategoryIds : [],
      buyingOptions: Array.isArray(it?.buyingOptions) ? it.buyingOptions : [],
      sellerUsername: it?.seller?.username || null,
    };
    return parsed;
  });
  console.log(`[extractIdentity] extracted ${results.filter(r => r.issue).length} issues from ${results.length} items`);
  return results;
};

// ═════════════════════════════════════════════════════════════════════════
// Q32 — Non-comic asset gating (merchandise detection via eBay category tree)
// ═════════════════════════════════════════════════════════════════════════
//
// eBay comics category tree (authoritative allowlist):
//   259104 — Comic Books & Graphic Novels (parent)
//   63     — Comic Books, Modern Age (1992-Now)
//   64     — Comic Books, Copper Age (1984-1991)
//   65     — Comic Books, Bronze Age (1970-83)
//   66     — Comic Books, Silver Age (1956-69)
//   67     — Comic Books, Golden Age (1938-55)
//   259111 — Graphic Novels, TPBs
//
// Items outside this tree (e.g., metal signs category 31587) are flagged
// as merchandise. Majority-vote consensus (≥50%) forces assetType=merchandise,
// which hard-blocks pricing pipeline and sets RESEARCH forced decision.

const COMICS_CATEGORY_TREE = new Set([
  '259104', // Comic Books & Graphic Novels (parent)
  '63',     // Modern Age
  '64',     // Copper Age
  '65',     // Bronze Age
  '66',     // Silver Age
  '67',     // Golden Age
  '259111', // Graphic Novels, TPBs
]);

/**
 * Infer assetType from eBay leafCategoryIds.
 *
 * @param {string[]} leafCategoryIds - eBay Browse API category IDs
 * @returns {'comic' | 'merchandise' | null} - assetType or null when no inference possible
 */
export const inferAssetTypeFromCategories = (leafCategoryIds) => {
  if (!Array.isArray(leafCategoryIds) || leafCategoryIds.length === 0) {
    return null; // no inference possible — missing category data
  }
  const hasComicCategory = leafCategoryIds.some(id => COMICS_CATEGORY_TREE.has(String(id)));
  return hasComicCategory ? 'comic' : 'merchandise';
};

// Ship #EBAY-FIRST — consensus extraction from eBay image search results.
// Takes parsed identity rows and returns majority-vote consensus for each field.
//
// Returns:
//   {
//     title: "Amazing Spider-Man",
//     issue: "300",
//     year: "1988",
//     publisher: "Marvel",        // extracted from titles
//     variant: "newsstand",        // most common variant token
//     confidence: 0.85,            // 0-1 score (% agreement)
//     agreement: {
//       title: 17,      // how many listings agreed
//       issue: 19,
//       year: 18,
//       total: 20       // total listings processed
//     },
//     source: "ebay_image_search"
//   }
//
// GrailKey Dispatch 09 (2026-08-07) — extracted from stripVariantNoise's
// two inline creator-name regexes (below) so tests/artist-registry-sync.test.js
// can import the exact live word lists for its reverse-direction
// assertion (does every creator-shaped name stripped here also exist in
// the canonical ARTIST_PATTERNS registry, or is it a documented
// exception?) rather than parsing a regex .source string — the Dispatch
// 08 investigation found that error-prone (the 'dekal' artifact in
// compHygiene.js's artistWords). Pure extraction, split across two
// arrays only because the original code was two separate .replace()
// calls — kept split to minimize diff risk, not a behavior change.
export const STRIP_VARIANT_NOISE_CREATOR_NAMES_1 = ['alan quah', 'inhyuk lee', 'jeehyung lee', 'raymond gay', 'peach momoko', 'artgerm', 'stanley lau'];
export const STRIP_VARIANT_NOISE_CREATOR_NAMES_2 = ['david nakayama', 'alex ross', 'jim lee', 'todd mcfarlane', 'frank miller'];
const buildNameNoiseRe = (names) => new RegExp(`\\b(${names.map((n) => n.replace(/\s+/g, '\\s+')).join('|')})\\b`, 'gi');
const VARIANT_NOISE_CREATOR_RE_1 = buildNameNoiseRe(STRIP_VARIANT_NOISE_CREATOR_NAMES_1);
const VARIANT_NOISE_CREATOR_RE_2 = buildNameNoiseRe(STRIP_VARIANT_NOISE_CREATOR_NAMES_2);

// Confidence calculation: average agreement across title+issue+year fields.
// Only fields with ≥50% agreement are returned (null otherwise).
// Minimum 5 listings required for consensus (returns null if < 5).
export const extractConsensus = (parsedRows, visionIssue = null, visionPublisher = null) => {
  if (!Array.isArray(parsedRows)) {
    return null;
  }

  // 2026-07-18 (Uncanny X-Men #27 / Ultimate X-Men #1 Momoko class) — TPB/
  // collected-edition listings must never influence single-issue IDENTITY
  // consensus (title/issue/year majority vote). A TPB frequently reuses the
  // same cover art as an issue in the same run, so it visually matches the
  // same eBay image search and can inflate title/issue agreement toward
  // whichever single issue the collection reprints, even though it's a
  // different product entirely. TPB_MARKER_RE already existed and gated the
  // LATER comp-pricing pool (api/comps.js Filter 1g, src/lib/soldVerification.js)
  // but was never applied here, at the earlier identity-determination stage
  // shared by grade.js's eBay-first path, enrich.js's phase1, and
  // identityAlignment.js. Uses IDENTITY_TPB_MARKER_RE (stricter sibling of
  // TPB_MARKER_RE, requires the edition suffix on absolute/deluxe/treasury)
  // — the plain TPB_MARKER_RE false-positived on "Absolute Batman" (a real
  // DC single-issue title, not a collected edition) when tried here.
  parsedRows = parsedRows.filter((r) => !IDENTITY_TPB_MARKER_RE.test(String(r?.rawTitle || '')));

  if (parsedRows.length < 5) {
    return null;
  }

  const total = parsedRows.length;

  // Ship #EBAY-FIRST FIX — strip variant noise before consensus.
  // Problem: 20 correct results but all have different variant suffixes
  // (Alan Quah, FanExpo, Virgin, Foil, Ltd 300, etc.) so consensus fails.
  // Solution: strip variant keywords BEFORE comparing titles.
  const stripVariantNoise = (title) => {
    if (!title) return title;
    return String(title)
      .replace(/\b(virgin|virgins?|foil|exclusive|exclusives?|signed|autographed?|ltd|limited|coa|w\/coa|with\s+coa)\b/gi, '')
      .replace(/\b(fanexpo|fan[\s-]?expo|megacon|nycc|sdcc|c2e2|eccc|wondercon|emerald\s+city)\b/gi, '')
      .replace(VARIANT_NOISE_CREATOR_RE_1, '')
      .replace(VARIANT_NOISE_CREATOR_RE_2, '')
      .replace(/\b(\d+\s*copies?)\b/gi, '')
      .replace(/\b(ltd\s*\d+|ltd\s*to\s*\d+|limited\s*\d+|limited\s*to\s*\d+)\b/gi, '')
      .replace(/\b(1:\d+)\b/gi, '') // ratio variants
      .replace(/\b(spot\s+foil|gold\s+foil|silver\s+foil|metallic|embossed)\b/gi, '')
      .replace(/\b(sketch|remark|remarked?|blank|trade\s+dress)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  };

  // Helper: find most common non-null value + count
  const getMostCommon = (values) => {
    const freq = {};
    let maxCount = 0;
    let winner = null;

    for (const v of values) {
      if (!v) continue;
      const key = String(v).toLowerCase().trim();
      if (!key) continue;
      freq[key] = (freq[key] || 0) + 1;
      if (freq[key] > maxCount) {
        maxCount = freq[key];
        winner = v; // preserve original casing
      }
    }

    return { value: winner, count: maxCount };
  };

  // For title consensus, extract series name from RAW titles (more consistent)
  // CRITICAL: strip variant noise FIRST, then extract main title.
  const extractMainTitle = (rawTitle) => {
    if (!rawTitle) return null;
    let s = stripVariantNoise(rawTitle); // <-- STRIP VARIANT NOISE
    // Strip everything after #issue or (year)
    s = s.replace(/#\s*\d{1,3}\b.*$/i, '');
    s = s.replace(/\(\d{4}\).*$/i, '');
    // Ship 22 — Preserve publisher names in series titles.
    //
    // Production case 2026-05-06: Marvel Tales #111 (1952) priced wrong
    // because "Marvel Tales" → "Tales" via this strip. eBay visual override
    // fired with corrupted title, identity stored as "tales", comp pool
    // matched arbitrary "tales" series (Tales of Suspense, Astonishing
    // Tales, Strange Tales, etc.). Era-filter bypass warning fired but
    // pricing proceeded against wrong pool.
    //
    // The strip was added to remove standalone publisher/slab markers like
    // "Amazing Spider-Man #129 Marvel CGC 9.8" → "Amazing Spider-Man #129 9.8".
    // But it also stripped publisher names that are LEGITIMATE PARTS of
    // series titles. Affects every series starting with publisher name.
    //
    // Whitelist preserves known publisher-in-title series.
    //
    // Q119 dispatch (2026-07-18, Captain Marvel #17 class) — this was a
    // standalone local copy, independently drifted from ComicAdapter.js's
    // near-identical PUBLISHER_IN_TITLE_SERIES (both missing "Captain
    // Marvel"/"Ms. Marvel" — one of four independently-drifted duplicates
    // found in one pass tonight). Now reads identityCore.js's promoted
    // canonical COMPOUND_TITLE_WHITELIST.
    const titleLower = s.toLowerCase().trim();
    const isPublisherSeries = COMPOUND_TITLE_WHITELIST.some((p) =>
      titleLower.startsWith(p)
    );
    if (!isPublisherSeries) {
      // Original behavior preserved for non-publisher-series titles
      s = s.replace(/\b(marvel|dc|image|cgc|cbcs|pgx|psa)\b/gi, '');
    } else {
      // Strip ONLY slab markers when title starts with publisher series name
      s = s.replace(/\b(cgc|cbcs|pgx|psa)\b/gi, '');
    }
    // Strip year at end
    s = s.replace(/\b(19\d{2}|20\d{2})\b.*$/i, '');
    // Normalize whitespace
    s = s.replace(/\s+/g, ' ').trim();
    if (!s || s.length < 3) return null;
    return s;
  };

  // Extract values for each field
  const mainTitles = parsedRows.map((r) => extractMainTitle(r.rawTitle)).filter(Boolean);
  const issues = parsedRows.map((r) => r.issue).filter(Boolean);
  const years = parsedRows.map((r) => r.year).filter(Boolean);

  // Normalize titles before consensus (extra normalization beyond extractMainTitle)
  const normalizedTitles = mainTitles.map(t =>
    String(t).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
  );

  // Find consensus for each field
  const titleResult = getMostCommon(normalizedTitles);
  const issueResult = getMostCommon(issues);
  const yearResult = getMostCommon(years);

  // Lower threshold: 30% for title (when issue passes at 60%, title at 30% is sufficient)
  // Issue still requires 50% agreement as critical field
  const titleOk = titleResult.count / total >= 0.3;
  const issueOk = issueResult.count / total >= 0.5;
  const yearOk = yearResult.count / total >= 0.5;

  // P0 (Q-VISION-ZERO-SUPPORT) — tally how many pool rows explicitly name
  // Vision's own issue number (same zero-strip normalization Q78 uses in
  // enrich.js). null when no visionIssue supplied — existing callers that
  // don't pass one see identical behavior to before this change.
  const normIssue = (v) => String(v ?? '').trim().replace(/^0+(?=\d)/, '');
  const visionIssueNorm = visionIssue != null ? normIssue(visionIssue) : null;
  const visionIssueCount = visionIssueNorm
    ? issues.filter((i) => normIssue(i) === visionIssueNorm).length
    : null;

  // Escalation carve-out (Q78's resurrected intent): title consensus IS
  // coherent (>=30%) but no single issue reaches the >=50% adoption bar —
  // normally that's "not enough information," discard everything. When
  // Vision's own issue ALSO has zero occurrences anywhere in the pool,
  // that's not a lack of information — it's an unsupported claim with
  // nothing to adopt in its place. Surface it instead of silently
  // discarding so the caller can escalate rather than default to Vision.
  const zeroSupportNoAdoption = titleOk && !issueOk && visionIssueNorm != null && visionIssueCount === 0;

  if (!titleOk || (!issueOk && !zeroSupportNoAdoption)) {
    // Can't establish consensus on basic identity
    // Q54 (GrailKey Dispatch 04) — !titleOk short-circuits this return
    // before zeroSupportNoAdoption is ever consulted, which silently
    // disables resolveIdentity's vision-zero-support OVERRIDE/ESCALATE
    // check downstream (ebay collapses to null, so its
    // `agreement.visionIssueCount === 0` guard never evaluates true).
    // No prior signal distinguished this from any other null-return
    // reason — log it specifically so a title-agreement collapse is an
    // observable event, not a silent gap.
    if (!titleOk) {
      console.log(`[extractConsensus] returning null — titleOk failed (${titleResult.count}/${total} = ${(titleResult.count / total).toFixed(2)}, need >=0.30), suppressing vision-zero-support check downstream`);
    }
    return null;
  }

  // Extract publisher from titles (Marvel, DC, Image, etc.)
  const publisherPatterns = [
    { re: /\bmarvel\b/i, name: 'Marvel' },
    { re: /\bdc\b/i, name: 'DC' },
    { re: /\bimage\b/i, name: 'Image' },
    { re: /\bdark\s+horse\b/i, name: 'Dark Horse' },
    { re: /\bidw\b/i, name: 'IDW' },
    { re: /\bboom\b/i, name: 'Boom Studios' },
    { re: /\bvaliant\b/i, name: 'Valiant' },
    { re: /\bdynamite\b/i, name: 'Dynamite' },
    { re: /\bsumerian\b/i, name: 'Sumerian' },
    { re: /\bbad\s*kitty\b/i, name: 'Bad Kitty Studios' },
    { re: /\bkitchen\s*sink\b/i, name: 'Kitchen Sink' },
    { re: /\baftershock\b/i, name: 'Aftershock' },
    { re: /\bvault\b/i, name: 'Vault Comics' },
    { re: /\bscout\b/i, name: 'Scout Comics' },
    { re: /\bAWA\b/i, name: 'AWA Studios' },
    { re: /\bstudios?\s*awa\b/i, name: 'AWA Studios' },
    { re: /\bablaze\b/i, name: 'Ablaze' },
    { re: /\bnbm\b/i, name: 'NBM' },
    { re: /\bonlyfans\b/i, name: 'Onlyfans Comics' },
    { re: /\btitan\b/i, name: 'Titan Comics' },
    { re: /\bambush\b/i, name: 'Ambush Comics' },
    { re: /\bblack\s*mask\b/i, name: 'Black Mask' },
    { re: /\bfantagraphics\b/i, name: 'Fantagraphics' },
    { re: /\bdrawn\s*&?\s*quarterly\b/i, name: 'Drawn & Quarterly' },
    { re: /\btokyopop\b/i, name: 'Tokyopop' },
    { re: /\bviz\b/i, name: 'Viz Media' },
    { re: /\bchapterhouse\b/i, name: 'Chapterhouse' },
    { re: /\bstrange\s*academy\b/i, name: 'Strange Academy' },
    { re: /\bredacted\b/i, name: 'Redacted Comics' },
    // WARP-FIX (2026-07-12) — indie/underground publishers (First Comics
    // era + undergrounds). "first"/"pacific" phrase-anchored: bare tokens
    // collide with "first print" / splash text. kitchen sink +
    // fantagraphics already present above.
    { re: /\bfirst\s+comics?\b/i, name: 'First Comics' },
    { re: /\beclipse\b/i, name: 'Eclipse Comics' },
    { re: /\bpacific\s+comics?\b/i, name: 'Pacific Comics' },
    { re: /\bwarren\b/i, name: 'Warren Publishing' },
    { re: /\blast\s+gasp\b/i, name: 'Last Gasp' },
    { re: /\bapex\s+novelt(?:y|ies)\b/i, name: 'Apex Novelties' },
    // Q-FIX-B (2026-07-15) -- Charlton was missing from this file's table
    // even though identityCore.js's separate PUBLISHER_CONSENSUS_PATTERNS
    // added it under Q96. Two independently-maintained copies of the same
    // list -- this collision (every "Charlton" pool mention producing zero
    // pattern hits, leaving a single "Stock Image" boilerplate false-
    // positive on the bare \bimage\b pattern above as the sole entry) is
    // the direct cause of the real Flash Gordon #13 mispublisher bug this
    // fix addresses. Full reconciliation into one shared constant is still
    // a follow-up -- this stops the immediate recurrence. Residual note:
    // because \bimage\b is earlier in this array and matching breaks on
    // first hit, a title containing BOTH "charlton" and boilerplate "stock
    // image" still votes for Image, not Charlton, on that one row -- not
    // fixed here, doesn't block the consensus outcome when Charlton has a
    // real majority, but worth folding into the same reconciliation pass.
    { re: /\bcharlton\b/i, name: 'Charlton Comics' },
  ];

  const publisherCounts = {};
  for (const row of parsedRows) {
    if (!row.rawTitle) continue;
    for (const { re, name } of publisherPatterns) {
      if (re.test(row.rawTitle)) {
        publisherCounts[name] = (publisherCounts[name] || 0) + 1;
        break; // first match wins
      }
    }
  }

  let publisher = null;
  let maxPubCount = 0;
  for (const [name, count] of Object.entries(publisherCounts)) {
    if (count > maxPubCount) {
      maxPubCount = count;
      publisher = name;
    }
  }

  // P0 (Q-FIX-B) -- publisher gets the same confidence bar as issue (>=50%
  // of the pool), not title's lower 30% bar: both issue and publisher are
  // asked to OVERRIDE Vision, not just corroborate it. Previously a single
  // coincidental match (count=1, zero competitors) won outright -- exactly
  // what shipped "Image" for Flash Gordon #13 (1969, Charlton) before this
  // fix, when Charlton wasn't even in the pattern table above.
  const publisherOk = total > 0 && maxPubCount / total >= 0.5;
  if (!publisherOk) {
    publisher = null;
  }

  // P0 (Q-FIX-B) -- same zero-support tally as issue's visionIssueCount
  // above: canonicalize Vision's own publisher string against this same
  // table so resolveIdentity can check "does Vision's publisher have ANY
  // pool support at all," independent of whether the pool clears the 50%
  // adoption bar. null when no visionPublisher supplied -- existing
  // callers that don't pass one see identical behavior to before this
  // change.
  let visionPublisherCanonical = null;
  if (visionPublisher) {
    const visionPublisherStr = String(visionPublisher).trim();
    for (const { re, name } of publisherPatterns) {
      if (re.test(visionPublisherStr)) {
        visionPublisherCanonical = name;
        break;
      }
    }
  }
  const visionPublisherCount = visionPublisherCanonical != null
    ? (publisherCounts[visionPublisherCanonical] || 0)
    : null;

  // Q111 dispatch (2026-07-18, Venomverse #1 class) — per-category variant
  // consensus. Was: flatten every category (convention/ratio/retailer/
  // exclusive/limitation/authentication/finish) into ONE array and pick the
  // single most-frequent token pool-wide. A generic finish token ("foil")
  // is the most common category in a foil-heavy pool and always won the
  // flat vote, discarding co-occurring SPECIFIC tokens ("sdcc", "1:1000")
  // that `extractVariantTokens` correctly extracted per-listing one line
  // earlier (Ship #20a.6.7a) — those tokens existed, they just never
  // reached `variant`. Now: compute the most-common token WITHIN each
  // category independently (same >=2 adoption threshold as before), join
  // every category that reaches consensus, in stable CATEGORY_BLOCKS
  // order. "SDCC ... 1:1000 ... Foil" across the pool now survives as
  // "sdcc 1:1000 foil", not just "foil".
  const tokenToCategory = tokenToVariantCategory();
  const categoryTokenCounts = {}; // kind -> { token -> count }
  for (const row of parsedRows) {
    for (const token of row?.variantTokens || []) {
      const kind = tokenToCategory[token];
      if (!kind) continue;
      categoryTokenCounts[kind] = categoryTokenCounts[kind] || {};
      categoryTokenCounts[kind][token] = (categoryTokenCounts[kind][token] || 0) + 1;
    }
  }
  const winningVariantTokens = [];
  for (const { kind } of CATEGORY_BLOCKS) {
    const counts = categoryTokenCounts[kind];
    if (!counts) continue;
    const winner = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (winner && winner[1] >= 2) winningVariantTokens.push(winner[0]);
  }
  const variant = winningVariantTokens.length > 0 ? winningVariantTokens.join(' ') : null;

  // Calculate confidence: average agreement across title+issue+year
  const confidenceScore = yearOk
    ? (titleResult.count + issueResult.count + yearResult.count) / (total * 3)
    : (titleResult.count + issueResult.count) / (total * 2);

  return {
    title: titleResult.value,
    issue: issueOk ? issueResult.value : null,
    year: yearOk ? yearResult.value : null,
    publisher,
    variant,
    confidence: Math.round(confidenceScore * 100) / 100,
    agreement: {
      title: titleResult.count,
      issue: issueResult.count,
      year: yearResult.count,
      total,
      visionIssueCount,
      publisher: maxPubCount,
      visionPublisherCount,
    },
    // true only in the Q-VISION-ZERO-SUPPORT escalation carve-out above —
    // title agreed, but no single issue reached the adoption bar.
    noIssueConsensus: !issueOk,
    // Q-FIX-B — mirrors noIssueConsensus: true when no publisher pattern
    // reached the 50% adoption bar (publisher is null as a result).
    noPublisherConsensus: !publisherOk,
    source: 'ebay_image_search',
  };
};

// ═════════════════════════════════════════════════════════════════════════
// Ship 26.1 — Title-family clustering helpers
// ═════════════════════════════════════════════════════════════════════════
//
// Pure helpers for rank-weighted visual title-family consensus. Used to
// resolve wrong-family pricing (Catwoman/Gotham War class bugs where
// frequency voting picks larger unrelated family over correct top-ranked
// result). No production integration yet — Ship 26.2 wires into enrich.js.
//
// Architecture: Pure functions, no API calls, no pricing logic. Accept
// title arrays, return candidate selection decision. Four decision types:
//
// 1. 'top-rank-protection' — items[0] family selected by rank override
// 2. 'weighted-consensus' — family selected by rank-weighted voting
// 3. 'fallback-vision' — no safe family, preserve Vision identity
// 4. 'refused-identity-conflict' — visual pool unrelated, refuse pricing
//
// Top-rank protection rule: If items[0] has exact issue match, ≥5 tokens,
// family weight ≥5, ≥1 token overlap with Vision, AND no competing family
// has ≥2× weight, select items[0] family. Protects against majority-vote
// bias when correct result ranks first but has lower inventory than wrong
// family (Catwoman Uncovered has more eBay listings than Gotham War).
//
// Vision-overlap requirement prevents top-rank protection from firing on
// completely unrelated visual pools (Hunt for Wolverine / Sinful Suzi
// cases where items[0] is noise).

/**
 * Ship 26.1 — Tokenize title for family clustering.
 *
 * Uses extractSeriesTitle (not extractMainTitle) to preserve publisher-
 * bearing identity titles like "Marvel Tales", "DC Pride", "Marvel Boy".
 * extractMainTitle strips "marvel"/"dc" globally except via whitelist;
 * extractSeriesTitle has no publisher-strip logic (line 230 NOISE_WORDS_RE).
 *
 * Filters tokens <3 chars AFTER splitting to preserve two-letter identity
 * tokens like "dc" (DC Pride) when they appear as series initials.
 *
 * Q-BC (Black Cat #1 / Skottie Young class, 2026-07-18) — strip
 * ARTIST_PATTERNS matches BEFORE tokenizing. extractSeriesTitle has no
 * artist-name awareness, so a variant artist mentioned in nearly every pool
 * listing (Skottie Young, Artgerm, etc.) was surviving into every member's
 * token set. That let Jaccard clustering AND the buildTitleFamilies ≥60%-
 * of-members consensus vote treat the artist name as a core title token,
 * fusing it into the family string ("black cat young skottie") — which then
 * failed every downstream comp-title match. Reuses the same registry
 * api/comps.js already trusts for creator identification (compHygiene.js)
 * rather than forking a third artist-name list (identityCore.js's
 * sanitizeSeriesTitle and this file's extractMainTitle each already
 * maintain their own, independently incomplete, hardcoded list — this is
 * the token-extraction choke point shared by clustering AND the dual-axis
 * ebayConsensusTitle comparison, so fixing here closes both). Falls back to
 * the unstripped tokens if stripping empties the title (defensive — avoids
 * losing an entry from clustering entirely).
 *
 * @param {string} title - raw eBay title
 * @returns {string[]} - lowercase token array, filtered, deduped
 */
export const tokenizeTitleFamily = (title) => {
  if (!title) return [];
  // G.O.D.S. dispatch — collapse punctuated acronyms BEFORE extractSeriesTitle
  // runs. extractSeriesTitle itself never touches periods (its own strip
  // list is `[#:&|/\[]]`), so the acronym would otherwise survive intact
  // all the way to this function's own final `[^a-z0-9\s]` strip below —
  // the actual point where "G.O.D.S." fragments into single letters that
  // then fall below the length>=2 floor a few lines down.
  const acronymNormalized = normalizeAcronyms(title);
  // extractSeriesTitle strips variant noise, slab markers, years, prices,
  // ratio, noise words. Returns null when result <2 chars.
  const cleaned = extractSeriesTitle(acronymNormalized);
  if (!cleaned) return [];

  // Track B Phase 0, Commit 4.1 review round (items 2/3 investigation) —
  // ARTIST_FAMILY_STRIP_EXCEPTIONS (compHygiene.js) is the single, explicit
  // opt-out from this destructive strip. A pattern's match text is checked
  // against the set BEFORE replacing — an excepted artist (e.g. "brett
  // booth") is still recognized (every OTHER ARTIST_PATTERNS consumer is
  // unaffected and untouched by this change) but survives into the family
  // token stream, exactly as every token did before this commit ever added
  // an entry here. Every pre-existing pattern is absent from the exception
  // set, so this loop's behavior for all of them is byte-identical to
  // before — only a newly-added, explicitly-excepted entry can ever change
  // what tokenizeTitleFamily produces.
  let artistStripped = cleaned;
  for (const pattern of ARTIST_PATTERNS) {
    const flags = new Set([...pattern.flags, 'g']);
    const re = new RegExp(pattern.source, [...flags].join(''));
    const m = artistStripped.match(re);
    if (!m) continue;
    if (ARTIST_FAMILY_STRIP_EXCEPTIONS.has(m[0].toLowerCase())) continue;
    artistStripped = artistStripped.replace(re, ' ');
  }
  artistStripped = artistStripped.replace(/\s+/g, ' ').trim();
  const source = artistStripped.length >= 2 ? artistStripped : cleaned;

  const tokens = String(source)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2); // preserve "dc" but drop single chars

  // Dedupe via Set, preserving order
  return [...new Set(tokens)];
};

/**
 * Ship 26.1 — Build title families via Jaccard clustering.
 *
 * Accepts raw title strings or item objects with .rawTitle or .title field.
 * Preserves rank index (eBay search_by_image returns bestMatch order).
 * Clusters titles by Jaccard similarity ≥0.4. Returns families array with
 * member indices, tokens, and representative title.
 *
 * @param {Array<string|object>} itemsOrTitles - raw titles or item objects
 * @returns {Array<{title: string, tokens: string[], indices: number[]}>}
 */
export const buildTitleFamilies = (itemsOrTitles) => {
  if (!Array.isArray(itemsOrTitles) || itemsOrTitles.length === 0) {
    return [];
  }

  // Extract titles, preserving index
  const entries = itemsOrTitles.map((item, idx) => {
    const title = typeof item === 'string'
      ? item
      : (item?.rawTitle || item?.title || '');
    const tokens = tokenizeTitleFamily(title);
    return { idx, title, tokens };
  }).filter(e => e.tokens.length > 0)
    // Commit C.1 (Strange Tales dispatch) — a photocopy/USB/digital-
    // archive/scan-disc listing must never enter identity clustering at
    // all (rank weighting, title-family membership, Jaccard similarity) —
    // it's not a genuine physical copy of any printing, and has no
    // business voting on what book this is. Excluded here, before Jaccard
    // clustering runs, not merely token-stripped (which would still let
    // it join a family on its surviving series-name tokens).
    .filter(e => !NON_GENUINE_COPY_RE.test(e.title));

  if (entries.length === 0) return [];

  // Jaccard similarity helper
  const jaccard = (tokensA, tokensB) => {
    const setA = new Set(tokensA);
    const setB = new Set(tokensB);
    const intersection = [...setA].filter(t => setB.has(t)).length;
    const union = new Set([...setA, ...setB]).size;
    return union > 0 ? intersection / union : 0;
  };

  // Greedy clustering: first entry starts first family, subsequent entries
  // join first family with Jaccard ≥0.4 or start new family.
  const families = [];
  const JACCARD_THRESHOLD = 0.4;

  for (const entry of entries) {
    let assigned = false;
    for (const family of families) {
      // Check similarity against family representative (first member)
      const sim = jaccard(entry.tokens, family.tokens);
      if (sim >= JACCARD_THRESHOLD) {
        family.indices.push(entry.idx);
        // Q45: Accumulate all member token sets for consensus title construction
        family.memberTokens = family.memberTokens || [family.tokens];
        family.memberTokens.push(entry.tokens);
        assigned = true;
        break;
      }
    }
    if (!assigned) {
      // Start new family
      families.push({
        title: entry.tokens.join(' '), // temporary, will be replaced with consensus
        tokens: entry.tokens,
        indices: [entry.idx],
        memberTokens: [entry.tokens], // Q45: track all members for consensus
      });
    }
  }

  // Q45: Build consensus title from tokens present in ≥60% of family members.
  // Prevents month names, "no.", "vol", years from first member bleeding into
  // canonical title. Evidence: "the eternals no april" regression (Eternals
  // #10 kept 10→4/30, price $5.89→$3.63).
  for (const family of families) {
    const memberCount = family.memberTokens.length;
    const tokenFreq = {};

    // Count token occurrences across all members
    for (const memberTokens of family.memberTokens) {
      for (const token of memberTokens) {
        tokenFreq[token] = (tokenFreq[token] || 0) + 1;
      }
    }

    // Keep tokens present in ≥60% of members
    const threshold = memberCount * 0.6;
    const consensusTokens = Object.entries(tokenFreq)
      .filter(([_, count]) => count >= threshold)
      .map(([token]) => token);

    // Q45: Strip month names, "no", "vol", standalone years from consensus
    const NOISE_TOKENS = new Set([
      'jan', 'january', 'feb', 'february', 'mar', 'march', 'apr', 'april',
      'may', 'jun', 'june', 'jul', 'july', 'aug', 'august', 'sep', 'sept',
      'september', 'oct', 'october', 'nov', 'november', 'dec', 'december',
      'no', 'vol', 'volume',
    ]);

    const cleaned = consensusTokens.filter(t => {
      // Remove month names, "no", "vol"
      if (NOISE_TOKENS.has(t.toLowerCase())) return false;
      // Remove standalone 4-digit years (1900-2099)
      if (/^\d{4}$/.test(t)) {
        const y = parseInt(t, 10);
        if (y >= 1900 && y <= 2099) return false;
      }
      return true;
    });

    // Q45-GUARD: Empty-consensus fallback. When divergent members cause
    // cleaned=[] after noise stripping, fall back to top-2 highest-frequency
    // non-noise tokens to preserve identity. If still empty, drop family
    // (better than emitting "" as title → downstream identity on empty string).
    if (cleaned.length === 0) {
      console.log(`[family-consensus] empty after cleaning — attempting fallback`);
      const fallbackTokens = Object.entries(tokenFreq)
        .filter(([token]) => {
          // Exclude noise tokens
          if (NOISE_TOKENS.has(token.toLowerCase())) return false;
          // Exclude standalone years
          if (/^\d{4}$/.test(token)) {
            const y = parseInt(token, 10);
            if (y >= 1900 && y <= 2099) return false;
          }
          return true;
        })
        .sort((a, b) => b[1] - a[1]) // sort by frequency descending
        .slice(0, 2) // top 2
        .map(([token]) => token);

      if (fallbackTokens.length > 0) {
        family.title = fallbackTokens.join(' ');
        family.tokens = fallbackTokens;
        console.log(`[family-consensus] fallback: "${family.title}" (${fallbackTokens.length} tokens)`);
      } else {
        // Mark for removal (will be filtered out below)
        family.title = null;
        family.tokens = [];
        console.log(`[family-consensus] family dropped — no valid tokens after noise filter`);
      }
    } else {
      // Rebuild family title and tokens from consensus
      family.title = cleaned.join(' ');
      family.tokens = cleaned;
    }
  }

  // Filter out families marked for removal (title=null from empty-consensus guard)
  return families.filter(f => f.title !== null && f.title.length > 0);
};

/**
 * Ship 26.1 — Score title families by rank-weighted voting.
 *
 * Rank weights: index 0=5, 1=4, 2=3, 3-9=1, 10-19=0.5, ≥20=0.
 * Returns scored families with count, weightSum, topRank, canonicalTitle,
 * rawTitle (from top-ranked member), tokens.
 *
 * @param {Array<{title: string, tokens: string[], indices: number[]}>} families
 * @param {Array<string|object>} itemsOrTitles - original items for rawTitle lookup
 * @returns {Array<{title: string, tokens: string[], count: number, weightSum: number, topRank: number, rawTitle: string}>}
 */
export const scoreTitleFamilies = (families, itemsOrTitles) => {
  if (!Array.isArray(families)) return [];

  const getRankWeight = (idx) => {
    if (idx === 0) return 5;
    if (idx === 1) return 4;
    if (idx === 2) return 3;
    if (idx >= 3 && idx <= 9) return 1;
    if (idx >= 10 && idx <= 19) return 0.5;
    return 0;
  };

  const scored = families.map(family => {
    const count = family.indices.length;
    const weightSum = family.indices.reduce((sum, idx) => sum + getRankWeight(idx), 0);
    const topRank = Math.min(...family.indices);

    // Extract rawTitle from top-ranked member
    const topIdx = topRank;
    const topItem = itemsOrTitles[topIdx];
    const rawTitle = typeof topItem === 'string'
      ? topItem
      : (topItem?.rawTitle || topItem?.title || family.title);

    return {
      title: family.title,
      tokens: family.tokens,
      indices: family.indices,
      count,
      weightSum,
      topRank,
      rawTitle,
      // Q140 — per-member token arrays, propagated for the coherent-
      // content-token lane (applyDualAxisGate). Not used by any pre-Q140
      // consumer of this object.
      memberTokens: family.memberTokens || null,
    };
  });

  // Sort by weightSum descending.
  // Q84-AMENDED TIEBREAK: equal weight → MORE members wins. The stable
  // sort previously kept discovery order on ties, letting a 3-member arc
  // family ("flash year one") beat a 7-member series family ("the flash")
  // at equal weightSum (Flash #75, 02:17:19.953).
  scored.sort((a, b) => (b.weightSum - a.weightSum) || (b.count - a.count));

  return scored;
};

/**
 * Pattern K — Dedupe embedded issue-number token from family title.
 *
 * Removes bare issue-number token when it duplicates the accepted issue,
 * preventing title pollution like "luke cage 34 power man" + #34.
 *
 * Protects series-name numbers (2099, 2000, 3D, 1984, 2001) via safelist.
 * Only removes if exactly one token matches accepted issue (safety check).
 *
 * @param {string} familyTitle - normalized family title (space-separated tokens)
 * @param {string|number} acceptedIssue - the accepted issue number
 * @returns {string} - deduplicated title
 */
const dedupeIssueToken = (familyTitle, acceptedIssue) => {
  if (!acceptedIssue || !familyTitle) return familyTitle;

  // Series-name number safelist
  const SERIES_NUMBER_SAFELIST = ['2099', '2000', '3d', '1984', '2001'];
  const issueStr = String(acceptedIssue).toLowerCase();

  // Skip when issue number is a protected series identifier
  if (SERIES_NUMBER_SAFELIST.includes(issueStr)) {
    return familyTitle;
  }

  const tokens = familyTitle.split(' ');
  const filtered = tokens.filter(t => t.toLowerCase() !== issueStr);

  // Only apply if exactly one token removed (safety check)
  // Prevents over-stripping when number appears multiple times
  return (tokens.length - filtered.length === 1)
    ? filtered.join(' ')
    : familyTitle;
};

/**
 * FIX A4 — Sanitize selected title to remove seller boilerplate.
 *
 * Applied AFTER family selection (not during token extraction) to avoid
 * over-stripping legitimate content during clustering. Removes only KNOWN
 * seller noise patterns that contaminate merged family titles.
 *
 * House of Mystery #157 case: family title was "dc batman house of mystery 161
 * dial for hero read description" - "read description" is seller boilerplate,
 * "batman" is character cross-contamination, "161" is wrong issue.
 *
 * Q30 EXTENSION (merchandise contamination):
 * "Captain America and the Falcon 3D Wooden Wall Decor #201" → "Captain America and the Falcon #201"
 * "Daredevil Legacy Tradin[g Card]" → "Daredevil Legacy"
 *
 * @param {string} title - normalized family title
 * @returns {string} - sanitized title
 */
const sanitizeSelectedTitle = (title) => {
  if (!title) return title;

  // Conservative boilerplate removal: only strip KNOWN seller noise.
  // Character cross-contamination (batman/superman in wrong series) is a real
  // problem BUT auto-removal risks stripping legitimate series names (Black
  // Panther, Captain America, etc.). The clustering + overlap logic should
  // already prevent cross-series contamination. This sanitizer only handles
  // seller filler that clustering can't detect.
  //
  // Q30: merchandise-listing contamination (wall decor, trading card, poster, etc.)
  return String(title)
    .replace(/\b(?:read|description|free|ship|shipping|combine|discount|pics|photos|wow|nice|hot|deal|sale|offer|check|out|must|see|look)\b/gi, '')
    .replace(/\b(?:wall\s+decor|wall\s+art|poster|print|sticker|magnet|keychain|figurine|statue|puzzle|coaster|trading\s+card|tradin\s+card)\b/gi, '')
    .replace(/\b(?:3d\s+wooden)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
};

// ═════════════════════════════════════════════════════════════════════════
// Q84-AMENDED (2026-07-12) — Dual-axis token-class gate
// ═════════════════════════════════════════════════════════════════════════
//
// Flash #75 (2019): Vision="the flash" AND eBay consensus="the flash" (63%)
// agreed, yet the family override fired "flash year one" (3-member story-ARC
// cluster) and PC + comps queried the arc name → starved → refused a $5 book.
// Wonder Woman #75 counter-case: the SAME override correctly selected
// "wonder woman jenny frison" (creator-variant family) — a blanket dual-axis
// lock would have broken it. Resolution: when the two independent axes agree,
// the family may only ADD tokens that are CREATOR-class (validated against
// the pool's artist consensus, same extraction class as [variant-identity]).
// Arc-class additions are contents, not titles (22f metadata class).

export const ARC_RE =
  /\b(?:year\s+one|year\s+of\s+the\s+villain|knightfall|finale|part\s+\d+|tie[\s-]?in|the\s+offer|age\s+of|war\s+of|rebirth)\b/i;

const ARTICLE_TOKENS = new Set(['the', 'a', 'an']);

// Q84 — neutral additions: publisher and format tokens that survive
// tokenizeTitleFamily (deliberately, for "DC Pride"-class identities) but
// do not change WHICH book a family names. Ignored by the token-class
// gate on both sides — they are neither identity-changing nor creator.
const NEUTRAL_ADDITION_TOKENS = new Set([
  'dc', 'marvel', 'comics', 'comic', 'image', 'idw', 'boom', 'dynamite',
  'valiant', 'archie', 'dark', 'horse', 'variant', 'cover', 'edition',
  'print', 'first', '1st',
]);

// Q119 dispatch (2026-07-18, Captain Marvel #17 class) — a NEUTRAL_ADDITION
// token being dropped from BOTH sides of the Q84 comparison (by design,
// see comment above) means it can never be RECOVERED either, even when
// it's exactly the correct missing word. Real production case: Vision's
// own title came back "Captain" (missing "Marvel"); the pool's title-
// family consensus correctly found "captain marvel 1st kamala khan" (13/20
// members), but the override was blocked because "kamala"/"khan" are
// genuine non-creator additions the gate is right to reject — and
// "marvel," being neutral-dropped from the comparison entirely, had no
// path back into the final title even though recovering it is safe and
// correct. This does NOT touch applyDualAxisGate's blocking logic (that
// protection against genuinely-unrelated additions stays exactly as
// designed) — it only asks, on a BLOCKED override, whether Vision's title
// plus ONE neutral-tagged word the family confirms happens to complete a
// known real title (COMPOUND_TITLE_WHITELIST). "Captain" + family's
// "marvel" → "captain marvel" matches the whitelist → recovered. "Kamala"/
// "khan" are never candidates here (not NEUTRAL_ADDITION_TOKENS members)
// and are never adopted — the completion is strictly narrower than
// accepting the family's full title.
const completeCompoundTitle = (visionTitle, visionTokens, familyTokens) => {
  if (!visionTitle) return null;
  const visionLower = String(visionTitle).toLowerCase().trim();
  if (!visionLower) return null;
  const candidates = (familyTokens || []).filter(
    (t) => NEUTRAL_ADDITION_TOKENS.has(t) && !(visionTokens || []).includes(t)
  );
  for (const candidate of candidates) {
    const completed = `${visionLower} ${candidate}`;
    if (COMPOUND_TITLE_WHITELIST.includes(completed)) {
      return completed.replace(/\b\w/g, (c) => c.toUpperCase());
    }
  }
  return null;
};

// Pool artist consensus: creator names matching ARTIST_PATTERNS in ≥2 pool
// titles. Returns a Set of lowercase word tokens for creator-class checks.
export const extractPoolArtistTokens = (items) => {
  const counts = {};
  for (const it of items || []) {
    const raw = String(typeof it === 'string' ? it : (it?.rawTitle || it?.title || ''));
    for (const pattern of ARTIST_PATTERNS) {
      const m = raw.match(pattern);
      if (m) {
        const key = m[0].toLowerCase();
        counts[key] = (counts[key] || 0) + 1;
        break; // multi-word patterns ordered first; one artist per title
      }
    }
  }
  const tokens = new Set();
  for (const [name, c] of Object.entries(counts)) {
    if (c >= 2) name.split(/\s+/).forEach((w) => { if (w) tokens.add(w); });
  }
  return tokens;
};

// Q132 dispatch (2026-07-20, GrailKey / ASM #26 "David Nakayama" class) —
// bounded creator-pair recovery. tokenizeTitleFamily strips every
// ARTIST_PATTERNS match out of the token stream BEFORE the family-consensus
// vote ever runs (see tokenizeTitleFamily above, and the Black Cat/Skottie
// Young "variant-artist token fusion" class this was built to close) — so a
// recognized surname like "nakayama" can never survive into familyTokens,
// even when a first name sitting directly next to it in the RAW listing
// text (e.g. "David Nakayama") does survive as an unrecognized stray token.
// applyDualAxisGate's poolArtistTokens check (below) can only ever see the
// stray first name, never the surname it was paired with, so it always
// misclassifies it as "non-creator" — this is a structural gap in the
// classifier, not a missing registry entry (nakayama is already in
// ARTIST_PATTERNS/artistWords).
//
// This checks the ORIGINAL, unstripped raw title text (topFamily.rawTitle —
// the representative top-ranked member's actual listing title, same field
// LOT_RE already checks against a few lines below in this file) for a
// candidate non-creator token immediately PRECEDING a token already present
// in poolArtistTokens (an ARTIST_PATTERNS surname corroborated by ≥2 pool
// listings) — i.e. "<candidate> <surname>" word order specifically, not
// "<surname> <candidate>". Every multi-word ARTIST_PATTERNS entry in this
// codebase is first-name-then-surname (/jim lee/, /alex ross/, /jenny
// frison/, /john giang/, ...) and real sellers follow the same convention,
// so this is a bounded, evidence-grounded direction, not an arbitrary
// restriction — the opposite direction ("<surname> <candidate>") just as
// often means a trailing descriptor word ("Nakayama Color Variant" — the
// real GrailKey case), which is exactly the false-positive this narrower
// check exists to avoid. Deliberately narrow / bounded, per Q130 policy:
// this recovers a PAIR only when the adjacency is real in the source text
// — it never adds a bare first-name pattern to any registry, and a first
// name with no adjacent recognized surname (or appearing elsewhere in the
// pool unpaired) is never recovered.
const recoverAdjacentCreatorTokens = (nonCreatorTokens, poolArtistTokens, familyRawText) => {
  if (!familyRawText || !poolArtistTokens || poolArtistTokens.size === 0) return [];
  const words = String(familyRawText)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const recovered = [];
  for (const t of nonCreatorTokens) {
    const precedesRecognizedSurname = words.some((w, i) => w === t && words[i + 1] && poolArtistTokens.has(words[i + 1]));
    if (precedesRecognizedSurname) recovered.push(t);
  }
  return recovered;
};

// Q140 dispatch (2026-07-22, Adventure Time SDCC / Invincible Returns class)
// — the coherent-content-token lane. A blocked non-creator addition is
// scattered/incidental when only 1-2 pool members happen to mention it (a
// single seller's own phrasing); it is genuine SHARED CONTENT the dominant
// family itself established when EVERY still-blocked token is independently
// corroborated by >=3 distinct family members — the same >=3-member floor
// Q38/Q133-Slice-2 already trust elsewhere in this file as "this family is
// real, not noise" (not a new, independently-tuned number). Real production
// case: "Adventure Time Summer Special #1 SDCC Convention Exclusive 2013" —
// Vision+eBay dual-axis agreed on "Adventure Time," and every one of
// summer/special/sdcc/convention/exclusive was named by 4+ of a coherent
// pool (a 4th corroborating listing appeared on rescan, strengthening, not
// weakening, the signal) — yet the gate blocked the addition wholesale
// because none of those words are creator names, sending PC/comps
// downstream on the bare stem and anchoring to an unrelated "Adventure
// Time" product. Requires per-member token data (familyMemberTokens) —
// scoreTitleFamilies must have propagated `memberTokens` for this to
// engage; omitting it (existing <=4-arg callers) simply disables the lane,
// falling through to the original block, byte-identical.
const countMemberSupport = (token, familyMemberTokens) =>
  (familyMemberTokens || []).filter((memberTokens) => (memberTokens || []).includes(token)).length;

// Token-class gate. familyTokens/agreedTokens are tokenizeTitleFamily
// output; articles are ignored on both sides ("the flash" ≡ "flash").
// familyRawText (Q132) is the family's representative unstripped listing
// title, used only for the bounded creator-pair recovery above — optional,
// omitting it simply disables recovery (existing 3-arg callers unaffected).
// familyMemberTokens (Q140) is the family's full per-member token arrays
// (buildTitleFamilies' `memberTokens`), used only for the coherent-content-
// token lane above — optional, omitting it disables that lane only.
// Returns { allowed, reason }.
// GrailKey Dispatch 03 (2026-08-06) — narrow-scope fallback, adopted after
// the broader "Vision-assertion" discriminator was tested and falsified.
// Reconstruction of the real Q109-C incident (commit a558f9d, "Replacement
// God and Other Stories" #1, 1997, Image) confirmed Vision's OWN read was
// the SHORT, truncated title ("Replacement God") — the family/pool
// supplied the correct, complete title. Routing "not Vision-asserted"
// tokens to confirmedVariant would have moved "and other stories" OUT of
// confirmedTitle, reproducing the exact bug a558f9d fixed (truncated title
// -> wrong ComicVine volume -> wrong year). Vision-assertion cannot
// distinguish genuine title continuation from noise; no existing
// classifier in this codebase can either (classifyVariantTokens, tested
// directly, returns {specific:[],generic:[]} for all four: "and other
// stories", "cartoon books", "local shop day", "joker iconic" — it's
// scoped to variant-descriptor specificity, not this question).
//
// Fallback, explicitly authorized as narrower-but-provably-safe: only
// route a Q140-admitted token subsequence when it's an EXACT, known
// publisher/imprint/event name — never a general noise/content
// classifier. Same STOPGAP-not-permanent posture as
// OTHER_VARIANT_DESCRIPTOR_RE (compHygiene.js) and NO_TITLE_VARIANTS
// (list-ebay.js) — a static name list, extend as new cases surface, not a
// substitute for the real classifier this problem eventually needs.
// Phrases only (no bare single generic words like "gold" alone — too
// ambiguous, "Iron Man Gold" is a real comic) except where the name is
// itself unambiguous as a single token ("wildstorm").
const KNOWN_PUBLISHER_IMPRINT_EVENT_PHRASES = [
  ['cartoon', 'books'],       // Bone's publisher (Cartoon Books)
  ['local', 'shop', 'day'],   // LCSD (Local Comic Shop Day) event
  ['wildstorm'],              // DC imprint
  ['hanna', 'barbera'],       // Hanna-Barbera studio/imprint
  ['gold', 'key'],            // Gold Key publisher
];

// Splits `tokens` into { matched, remaining } — matched is every token that
// participates in a contiguous, in-order match against one of the known
// phrases above; remaining is everything else, in original order. A phrase
// only matches as a complete, contiguous run (partial phrase overlap does
// not count) so "gold" alone (elsewhere, unrelated) is never mistaken for
// the "gold key" entry.
const matchKnownPublisherImprintEventTokens = (tokens) => {
  const matched = new Set();
  for (const phrase of KNOWN_PUBLISHER_IMPRINT_EVENT_PHRASES) {
    for (let i = 0; i + phrase.length <= tokens.length; i++) {
      if (phrase.every((word, j) => tokens[i + j] === word)) {
        phrase.forEach((_, j) => matched.add(i + j));
      }
    }
  }
  const matchedTokens = tokens.filter((_, i) => matched.has(i));
  const remaining = tokens.filter((_, i) => !matched.has(i));
  return { matchedTokens, remaining };
};

// GrailKey Dispatch 03 (2026-08-06) — universal admittedTokens + provenance.
// Every allow-branch now returns admittedTitleTokens (stays in
// confirmedTitle, via sanitizeSeriesTitle) and admittedVariantTokens
// (routes to confirmedVariant instead) alongside the existing
// allowed/reason shape — additive, not a breaking change to callers that
// only read allowed/reason. provenance is the new explicit field 22c and
// isBareCreatorTokensOnly read directly, retiring their reason-string
// parses (see CLAUDE.md "applyDualAxisGate reason-string coupling").
export const applyDualAxisGate = (familyTokens, agreedTokens, poolArtistTokens, familyRawText = null, familyMemberTokens = null) => {
  const drop = (t) => ARTICLE_TOKENS.has(t) || NEUTRAL_ADDITION_TOKENS.has(t);
  const fam = (familyTokens || []).filter((t) => !drop(t));
  const agreed = (agreedTokens || []).filter((t) => !drop(t));
  if (agreed.length === 0) {
    return {
      allowed: true, reason: 'no agreed tokens to protect', provenance: 'no-agreement',
      admittedTitleTokens: [], admittedVariantTokens: [], agreedTokens: agreed,
    };
  }

  // GrailKey Commit S (S1, 2026-08-03) — Marvel Tales #14 class. This
  // branch used to block whenever ANY agreed (Vision+eBay) token was
  // absent from the family — requiring the family to cover 100% of
  // agreed's content. That direction is backwards when the "agreed"
  // title is itself wrong: Vision misread the cover as "Tales of
  // Asgard," eBay's real, 4-row, 100%-internal-overlap "Marvel Tales"
  // family was blocked from correcting it because "asgard" (a genuine
  // word, on no stopword list, simply wrong) was absent from the
  // family's own tokens — confirmed live via direct execution:
  // applyDualAxisGate(['marvel','tales'], ['tales','of','asgard'], ...)
  // returned `family drops agreed tokens [of,asgard]` even though
  // "tales" — the one word that actually IS shared — never entered the
  // computation at all.
  //
  // Fix: only block on this axis when the family shares ZERO tokens
  // with agreed (complete disagreement — "family shares no agreed
  // tokens" is the correct question; "does family contain literally
  // every agreed token" is not). A single genuinely shared token (here,
  // "tales") is treated as sufficient coverage — the family isn't
  // required to also absorb whatever ELSE Vision's title claims.
  //
  // Verified this does NOT admit the exact case this check exists to
  // catch (tests/q84-dual-axis.test.js's own header comment: Flash #75,
  // Vision+eBay agreed "the flash," a story-arc-labeled "flash year one"
  // cluster tried to override with zero relation to "flash" once its own
  // tokens are extracted). Confirmed via direct execution on the fixture
  // that test already exercises (`applyDualAxisGate(['year','one'],
  // ['the','flash'], ...)`): agreed=['flash'] shares NO tokens with
  // fam=['year','one'] — still blocked below, reason string unchanged
  // ("family drops agreed tokens [flash]"), so the pre-existing
  // tests/q84-dual-axis.test.js assertion (`/drops agreed/.test(reason)`)
  // continues to pass byte-identically. Independently, even if this
  // branch were removed entirely, the SAME fixture is separately caught
  // by the arc-token check a few lines below (ARC_RE.test('year one')
  // === true) — two independent protections existed for this one case;
  // only the one fixed here was broken.
  const missing = agreed.filter((t) => !fam.includes(t));
  const overlapping = agreed.filter((t) => fam.includes(t));
  if (missing.length > 0 && overlapping.length === 0) {
    return {
      allowed: false, reason: `family drops agreed tokens [${missing.join(',')}]`, provenance: 'blocked',
      admittedTitleTokens: [], admittedVariantTokens: [], agreedTokens: agreed,
    };
  }
  const added = fam.filter((t) => !agreed.includes(t));
  if (added.length === 0) {
    return {
      allowed: true, reason: 'same title, nothing added', provenance: 'no-addition',
      admittedTitleTokens: [], admittedVariantTokens: [], agreedTokens: agreed,
    };
  }

  const addedStr = added.join(' ');
  if (ARC_RE.test(addedStr)) {
    return {
      allowed: false, reason: `arc-token "${addedStr}"`, provenance: 'blocked',
      admittedTitleTokens: [], admittedVariantTokens: [], agreedTokens: agreed,
    };
  }
  const nonCreator = added.filter((t) => !(poolArtistTokens && poolArtistTokens.has(t)));
  if (nonCreator.length > 0) {
    // Q132 — bounded recovery: a non-creator token immediately PRECEDING a
    // recognized surname in the family's own raw listing text (e.g. "david"
    // directly before "nakayama") is a stranded first name, not noise. Once
    // that real, adjacency-confirmed creator pairing is found, the REST of
    // `added` is treated as that same confirmed variant's own descriptors
    // (e.g. "color") rather than gated token-by-token — ARC_RE above has
    // already ruled out story/arc-content additions, so what's left here is
    // either a creator name or a descriptor of the artist's own variant,
    // not unrelated noise. Recovering only the paired first name while
    // still blocking on its own variant's descriptor words would leave the
    // gate blocking the exact family this recovery exists to unblock.
    //
    // GrailKey Dispatch 03 Strip 2 (2026-08-06) — admittedTitleTokens is
    // `recovered` ONLY, not the full `added`/`nonCreator` set. Before this,
    // the reason string said "adjacent-pair recovered: [neal]" but the
    // ALLOWED verdict let the whole addedStr ("neal joker iconic") through
    // to the title via topFamily.title — "joker"/"iconic" rode along as
    // passengers on "neal"'s recovery (Batman #251 class). Callers must
    // build selectedTitle from admittedTitleTokens now, not topFamily.title
    // wholesale, for this fix to take effect (see selectTitleFamilyCandidate
    // call sites below).
    const recovered = recoverAdjacentCreatorTokens(nonCreator, poolArtistTokens, familyRawText);
    if (recovered.length > 0) {
      return {
        allowed: true, reason: `creator-tokens [${addedStr}] (adjacent-pair recovered: [${recovered.join(',')}])`,
        // 'creator-lane-adjacent-recovery', not the bare 'creator-lane-direct'
        // sibling below — Commit B1's isBareCreatorTokensOnly needs this
        // distinction (adjacent-pair recovery carries its own independent
        // adjacency evidence, exempting it from B1's extra issue-corroboration
        // check). Both are still 'creator-lane' at the broad level any other
        // consumer (buildGatedTitleSource, 22c) should check with a prefix
        // match — see their own comments.
        provenance: 'creator-lane-adjacent-recovery', admittedTitleTokens: recovered, admittedVariantTokens: [], agreedTokens: agreed,
      };
    }
    // Q140 coherent-content-token lane — see comment above countMemberSupport.
    // Every still-blocked token must independently clear the >=3-member
    // floor; a single scattered/single-member token anywhere in the set
    // keeps the WHOLE addition blocked, byte-identical to pre-Q140 behavior.
    if (familyMemberTokens && familyMemberTokens.length > 0) {
      const supportCounts = nonCreator.map((t) => countMemberSupport(t, familyMemberTokens));
      if (supportCounts.every((c) => c >= 3)) {
        // GrailKey Dispatch 03 Strip 1 (2026-08-06) — narrow-scope
        // publisher/imprint/event routing (see
        // matchKnownPublisherImprintEventTokens / KNOWN_PUBLISHER_IMPRINT_
        // EVENT_PHRASES above for the full rationale: the broader
        // "Vision-assertion" discriminator was tested and falsified against
        // the real Q109-C incident — "and other stories" is ALSO
        // not-Vision-asserted, so that rule would have routed genuine title
        // content to confirmedVariant, reproducing the bug a558f9d fixed).
        // Only tokens matching a KNOWN name move to admittedVariantTokens;
        // everything else stays in admittedTitleTokens, byte-identical to
        // pre-Dispatch-03 behavior for anything not on the narrow list.
        const { matchedTokens, remaining } = matchKnownPublisherImprintEventTokens(nonCreator);
        return {
          allowed: true,
          reason: `coherent-content tokens [${nonCreator.join(',')}] (>=3 member support each: [${supportCounts.join(',')}])` +
            (matchedTokens.length > 0 ? ` [publisher/imprint/event routed to variant: ${matchedTokens.join(',')}]` : ''),
          provenance: 'q140-coherent-content',
          admittedTitleTokens: remaining,
          admittedVariantTokens: matchedTokens,
          agreedTokens: agreed,
        };
      }
    }
    return {
      allowed: false, reason: `non-creator additions [${nonCreator.join(',')}]`, provenance: 'blocked',
      admittedTitleTokens: [], admittedVariantTokens: [], agreedTokens: agreed,
    };
  }
  return {
    // 'creator-lane-direct' — every added token is a directly-recognized
    // creator name (nonCreator.length===0), no adjacency inference needed.
    // The bare-vs-adjacent-recovery split is Commit B1's own distinction
    // (isBareCreatorTokensOnly); see the sibling branch's comment above.
    allowed: true, reason: `creator-tokens [${addedStr}]`, provenance: 'creator-lane-direct',
    admittedTitleTokens: added, admittedVariantTokens: [], agreedTokens: agreed,
  };
};

// GrailKey Dispatch 03 Strips 1+2 (2026-08-06) — shared title-source
// construction for both selectTitleFamilyCandidate call sites (top-rank-
// protection and weighted-consensus). Only overrides the fallback
// (today's family.title, used wholesale) for the two provenances that
// carry a real admittedTitleTokens filter — 'creator-lane' (Strip 2: only
// recovered/creator tokens, not the whole addedStr) and
// 'q140-coherent-content' (Strip 1: publisher/imprint/event tokens
// excluded, routed to admittedVariantTokens instead). Every other
// provenance ('no-addition', 'no-agreement', 'blocked', or the q84Gate
// wrapper's own 'no dual-axis agreement' fallback which carries no
// provenance field at all) falls through to `fallbackTitle` — byte-
// identical to pre-Dispatch-03 behavior. The `agreedTokens.length > 0`
// check is defense-in-depth (applyDualAxisGate's own early return already
// guarantees this whenever these two provenances are reached) — required
// per explicit instruction: an empty selectedTitle is a worse failure
// than any corruption this change fixes, so this path never fires on an
// empty agreedTokens even if that invariant is ever violated upstream.
const buildGatedTitleSource = (gate, fallbackTitle) => {
  if (
    gate &&
    (String(gate.provenance || '').startsWith('creator-lane') || gate.provenance === 'q140-coherent-content') &&
    Array.isArray(gate.agreedTokens) && gate.agreedTokens.length > 0
  ) {
    return [...gate.agreedTokens, ...(gate.admittedTitleTokens || [])].join(' ');
  }
  return fallbackTitle;
};

/**
 * Ship 26.1 — Select title-family candidate.
 *
 * Pure function. No API calls, no pricing logic. Returns decision object
 * with four possible outcomes:
 *
 * 1. 'top-rank-protection' — items[0] family selected by rank override
 * 2. 'weighted-consensus' — family selected by rank-weighted voting
 * 3. 'fallback-vision' — no safe family, preserve Vision
 * 4. 'refused-identity-conflict' — visual pool unrelated, refuse pricing
 *
 * Top-rank protection fires when:
 * - items[0] has exact issue match to visionIssue
 * - items[0] has ≥5 meaningful tokens
 * - items[0] is in a family with weightSum ≥5
 * - that family shares ≥1 token with Vision title
 * - no competing family has weightSum ≥2× this family's weightSum
 *
 * Vision-overlap requirement prevents noise cases (Hunt for Wolverine /
 * Sinful Suzi) where items[0] is completely unrelated.
 *
 * @param {Array<string|object>} items - eBay search_by_image results
 * @param {string} visionTitle - Vision-identified title
 * @param {string|number} visionIssue - Vision-identified issue
 * @param {string|number} visionYear - Vision-identified year (optional, for era-aware gates)
 * @returns {{decision: string, selectedTitle: string|null, rawTitle: string|null, reason: string, topFamily: object|null, runnerUp: object|null, families: array}}
 */
// Small, locally-scoped cover-letter extractor — compHygiene.js's
// OTHER_COVER_RE only detects the PRESENCE of a non-A cover letter, it
// never extracts WHICH letter, which mergeFragmentedTitleFamilies' own
// contradiction check needs (agreeing on "Cover C" across rows is fine;
// "Cover C" vs "Cover D" is a real contradiction). Deliberately narrow —
// this is not meant to replace OTHER_COVER_RE's broader detection use
// elsewhere, only to serve this one contradiction check.
const extractCoverLetter = (title) => {
  const m = String(title || '').match(/\b(?:cover|cvr)\s*([a-z])\b/i);
  return m ? m[1].toUpperCase() : null;
};

/**
 * Track B Phase 0, Commit 4.1 — controlled family-fragment merge.
 *
 * A single physical product's listings can fragment into more than one
 * Jaccard-clustered family purely because of listing-title verbosity
 * differences. Confirmed live on the Spawn #351 Cover C Brett Booth Virgin
 * fixture: a 2-member family ("...cameo of lyra htf scarce") and a
 * 3-member family ("spawn brett booth") whose ENTIRE token vocabulary is a
 * strict subset of the first, at Jaccard(0.375) — just under the 0.4
 * single-pass clustering threshold buildTitleFamilies already uses. This
 * is fragmentation of ONE identity, not two competing ones.
 *
 * MERGE-DIRECTION PIN (explicit, tested — see the founding fixture in this
 * function's own test coverage): the subset relation is on TOKEN SETS,
 * independent of member counts. Whichever family's tokens are the subset
 * merges INTO the token-superset (more specific) family, regardless of
 * which family happens to have more members. The founding fixture is
 * exactly the case a naive "bigger family wins" rule would get backwards:
 * the count-LARGER family (3 members, 3 tokens) is the token-subset; the
 * count-SMALLER family (2 members, 8 tokens) is the token-superset and
 * becomes the canonical/representative identity.
 *
 * Does NOT lower or touch the existing >=3-member promotion floor
 * (this file's weighted-consensus branch, selectTitleFamilyCandidate) —
 * this only combines already-sub-floor families (each individually < 3)
 * into one family that may then clear that same, unmodified floor. A
 * family that already clears the floor alone is never a merge candidate.
 *
 * Merge conditions (ALL required). Final attribute taxonomy (corrected,
 * review round 3, item 1 — issue was originally documented as
 * absence-never-blocks, the same standard as year; it is now its own,
 * stricter class, reflecting that issue is the single most load-bearing
 * attribute in this merge — the merged family is the thing that CAUSES
 * issue adoption downstream (resolveFamilyIssueConsensus), so it cannot be
 * held to a weaker agreement standard than the attributes that merely
 * gate whether the merge is allowed to happen at all):
 *  1. tokens(subset family) is a full, strict subset of tokens(superset
 *     family) — full containment, not partial Jaccard overlap.
 *  2. Combined DEDUPLICATED member count >= 3 — a pairing that still
 *     couldn't clear the floor is never evaluated further.
 *  3. ISSUE — MANDATORY POSITIVE PER-FRAGMENT AGREEMENT (upgraded, review
 *     round 3, item 1). Both fragments must POSITIVELY assert the SAME
 *     issue number — reuses the exact same fragmentAssertion machinery
 *     condition 5 below uses, with extractIssueFromTitle as the extractor
 *     (no second issue parser). Internal disagreement within one fragment
 *     blocks (same "contradiction" semantics as everywhere else in this
 *     function); a genuine different-asserted-issue mismatch between the
 *     two fragments blocks; asserted-by-one/silent-on-the-other blocks
 *     (unlike condition 5's conditional attributes, silence is NOT treated
 *     as "not applicable" here — issue has no "doesn't apply to this book"
 *     case, every real listing names an issue or it doesn't); BOTH
 *     fragments silent also blocks, for the same reason. Only both
 *     fragments positively asserting and agreeing passes.
 *  4. YEAR — absence never blocks, only a genuine asserted conflict does
 *     (UNCHANGED from the first review round, and deliberately NOT
 *     upgraded to issue's mandatory-agreement standard — a book can
 *     legitimately have zero year-bearing rows in a fragment without that
 *     meaning anything is wrong). No member of either family may assert a
 *     different, conflicting year than another. Reuses the real, exported
 *     resolveFamilyYearConsensus (identityCore.js) rather than a second,
 *     ad-hoc check, so this gate and the later year-adoption vote
 *     (resolveIdentity) can never disagree about what counts as a
 *     conflict.
 *  5. No member of either family trips LOT_RE/REPRINT_RE/SLAB_RE/
 *     GRADED_RE/SIGNED_RE/TPB_MARKER_RE (compHygiene.js — the same
 *     detectors the formal comp-pricing filter chain already trusts).
 *  6. POSITIVE PRODUCT-AGREEMENT GATE, CONDITIONAL FORM (review round 2,
 *     item 2) — token containment + no-contradiction (conditions 1/3) is
 *     necessary but not sufficient to prove two fragments describe the
 *     SAME visual product; this condition proves it, per attribute, in
 *     {cover designation, artist, presentation/finish marker (e.g.
 *     Virgin)}. Conditional form, NOT a blanket require-both-present rule
 *     — this is what distinguishes it from issue's mandatory standard
 *     (condition 3) above:
 *       - A fragment ASSERTS an attribute when >=1 of its own member rows
 *         assert a value and no member row asserts a DIFFERENT value
 *         (internal disagreement within one fragment is itself a block,
 *         same "contradiction" semantics as condition 3).
 *       - If EITHER fragment asserts an attribute, the OTHER fragment
 *         must positively assert the SAME value — asserted-by-one,
 *         absent-from-the-other, blocks the merge (absence is not
 *         positive support, mirroring this codebase's standing "absence
 *         of evidence is not evidence of correctness" doctrine — see
 *         TARGET_ISSUE_UNRESOLVED's own reasoning, evidenceEligibility.js).
 *       - If NEITHER fragment asserts an attribute, it is NOT APPLICABLE
 *         and does not block — an ordinary, non-variant book (no artist,
 *         no presentation tokens anywhere in either fragment) still
 *         merges on the remaining gates. Without this branch, the gate
 *         would silently neuter the whole feature for the common case.
 *         Issue has no equivalent "not applicable" case (condition 3) —
 *         every real listing either names an issue or doesn't, and a
 *         silent fragment is never treated as agreeing.
 *     This gate still NEVER confers variant authority (see the IMPORTANT
 *     note below) — these three attributes exist only to establish
 *     same-product before
 *     membership combines, not to resolve or confirm what the variant is.
 *
 * IMPORTANT — what this merge does NOT confer: agreement on issue number
 * (condition 3) produces IDENTITY consensus (fed to
 * resolveFamilyIssueConsensus downstream, in resolveIdentity), but never
 * VARIANT confirmation. Even the full attribute set this merge checks
 * (issue, year, cover designation, artist, presentation/finish marker —
 * conditions 3/4/6) only establishes that both fragments plausibly
 * describe the same physical product; it is not itself variant
 * resolution — variant resolution runs through its own, entirely
 * separate, already-issue-scoped mechanism (filterItemsByIssue/
 * extractConfirmedVariant, api/enrich.js) after this merge and its
 * consequent issue adoption complete, with its own segregation gates
 * unchanged by anything here.
 *
 * Deduplication: mirrors (does not import — resolveFamilyIssueConsensus
 * itself is explicitly unmodified by this dispatch) the same key-priority
 * chain resolveFamilyIssueConsensus already applies — itemId ->
 * legacyItemId -> normalized itemWebUrl -> title text — so a literal
 * duplicate/relisted row never inflates the merged count.
 *
 * Only ever considers `scored[0]` — the single family
 * selectTitleFamilyCandidate would actually promote — as the side that
 * NEEDS a merge (corrected, review round: a real regression, found via
 * the mandated full-suite A/B against tests/q85-compact-key.test.js's
 * Funnybook fixture, in an earlier version that instead paired ANY
 * below-floor family, at any rank, against every other family — which
 * wrongly disturbed an already-independently-qualifying `scored[0]`
 * ("funny book," 4 members) by merging it into a lower-ranked, noise-
 * bearing singleton that happened to be its token-superset, replacing a
 * clean title with one carrying unexplained extra tokens and tripping an
 * unrelated downstream gate). If `scored[0].count >= 3` already, this
 * function is a pure no-op — nothing needs merging, and nothing already
 * fine is ever pulled into one. Only ever merges the FIRST qualifying
 * partner found for `scored[0]`, trying candidates in the order `scored`
 * is already sorted in (weightSum-descending). A pool that fragments into
 * more than 2 pieces of the same product is a real possibility not
 * exercised by the founding fixture — left as a documented limitation,
 * not silently generalized to N-way merging without a test proving it.
 *
 * @param {Array<Object>} scored - scoreTitleFamilies' own output
 * @param {Array} itemsOrTitles - the same array passed to buildTitleFamilies
 * @returns {Array<Object>} scored, unchanged, if scored[0] already
 *   clears the floor or no qualifying partner is found; otherwise a new
 *   array with scored[0] and its merge partner replaced by their merge
 */
export const mergeFragmentedTitleFamilies = (scored, itemsOrTitles) => {
  if (!Array.isArray(scored) || scored.length < 2) return scored;

  const getRawTitle = (idx) => {
    const it = itemsOrTitles?.[idx];
    return String(typeof it === 'string' ? it : (it?.rawTitle || it?.title || ''));
  };

  const dedupKeyFor = (idx) => {
    const item = itemsOrTitles?.[idx];
    if (typeof item !== 'string' && item?.itemId) return `id:${item.itemId}`;
    if (typeof item !== 'string' && item?.legacyItemId) return `legacy:${item.legacyItemId}`;
    if (typeof item !== 'string' && item?.itemWebUrl) {
      const s = String(item.itemWebUrl);
      const q = s.indexOf('?');
      return `url:${q === -1 ? s : s.slice(0, q)}`;
    }
    return `title:${getRawTitle(idx).trim()}`;
  };

  const tokenSubsetOf = (small, large) => {
    const bigSet = new Set(large);
    return small.length > 0 && small.every((t) => bigSet.has(t));
  };

  // Track B Phase 0, Commit 4.3 — delegates to the shared, exported
  // hasContaminatedMember (compHygiene.js — a true leaf module both this
  // file and identityCore.js already import from with no circularity
  // risk, unlike importing it from this file) instead of maintaining its
  // own copy of the same six-regex check. Single-index call, byte-
  // identical behavior.
  const isContaminated = (idx) => hasContaminatedMember(itemsOrTitles, [idx]);

  // Review round, item 2 — positive product-agreement gate. Extracts a
  // single canonical value for one attribute from one title, or null when
  // the attribute isn't present at all. extractCoverLetter/extractArtist
  // already return a single scalar (letter / matched artist string) or
  // null — used as-is. Presentation/finish markers (Virgin, foil, sketch,
  // etc — extractVariantTokens' own 'finish' category, the only
  // inherently-generic category per the Q111 dispatch's taxonomy) can
  // appear multiple-per-title ("Virgin Foil"), so they're canonicalized
  // into one sorted, comma-joined string for exact scalar comparison,
  // reusing extractVariantTokens/tokenToVariantCategory (compHygiene.js/
  // this file's own existing registries) rather than a new parser.
  const extractPresentationValue = (title) => {
    const cat = tokenToVariantCategory();
    const finishTokens = extractVariantTokens(title).filter((t) => cat[t] === 'finish');
    return finishTokens.length > 0 ? finishTokens.slice().sort().join(',') : null;
  };

  // Per-FRAGMENT (not combined-set) assertion status for one attribute:
  // 'not-asserted' (no row in this fragment carries a value — attribute
  // is not applicable for this fragment), 'contradiction' (>=2 rows in
  // this SAME fragment assert different values — an internal
  // disagreement, same semantics as the issue/year contradiction checks
  // above), or 'asserted' (every row that carries a value agrees on one).
  const fragmentAssertion = (indices, extractFn) => {
    const values = new Set();
    for (const idx of indices) {
      const v = extractFn(getRawTitle(idx));
      if (v != null) values.add(v);
    }
    if (values.size === 0) return { status: 'not-asserted', value: null };
    if (values.size > 1) return { status: 'contradiction', value: null };
    return { status: 'asserted', value: [...values][0] };
  };

  // The conditional rule itself, applied per attribute across the TWO
  // fragments being considered for merge (famA/famB, before combining):
  //  - either fragment internally contradicts itself on this attribute -> blocked
  //  - neither fragment asserts anything -> NOT APPLICABLE, not blocked
  //    (an ordinary, non-variant book must still merge on the remaining
  //    gates — without this branch the gate would neuter the whole
  //    feature for the common case)
  //  - both assert and agree -> not blocked
  //  - both assert but disagree, OR one asserts and the other is silent
  //    (absence is not positive support) -> blocked
  const checkAttributeAgreement = (fragA, fragB, extractFn, label) => {
    const a = fragmentAssertion(fragA.indices, extractFn);
    const b = fragmentAssertion(fragB.indices, extractFn);
    if (a.status === 'contradiction' || b.status === 'contradiction') {
      return { ok: false, reason: `${label} internal contradiction within one fragment` };
    }
    if (a.status === 'not-asserted' && b.status === 'not-asserted') {
      return { ok: true, reason: `${label} not applicable (neither fragment asserts it)` };
    }
    if (a.status === 'asserted' && b.status === 'asserted') {
      return a.value === b.value
        ? { ok: true, reason: `${label} agrees ("${a.value}")` }
        : { ok: false, reason: `${label} mismatch ("${a.value}" vs "${b.value}")` };
    }
    const assertedSide = a.status === 'asserted' ? a : b;
    return { ok: false, reason: `${label} asserted by one fragment ("${assertedSide.value}"), absent from the other` };
  };

  // Review round 3, item 1 — issue is upgraded to a MANDATORY positive
  // per-fragment agreement, stricter than checkAttributeAgreement's
  // conditional form above: unlike cover/artist/presentation, issue has no
  // "not applicable" case (every real listing either names an issue or it
  // doesn't — there's no such thing as a book the issue-number question
  // doesn't apply to), so silence on EITHER side — one fragment asserting
  // and the other silent, or both fragments silent — blocks the merge,
  // never passes as "not applicable." Reuses the exact same
  // fragmentAssertion machinery checkAttributeAgreement uses (no second
  // issue parser) — only the not-asserted branch's verdict differs.
  //  - both fragments assert the SAME issue -> pass
  //  - one asserts, the other is entirely silent -> block
  //  - both silent -> block
  //  - both assert but different issues -> block
  //  - internal disagreement within either fragment -> block
  const checkMandatoryAttributeAgreement = (fragA, fragB, extractFn, label) => {
    const a = fragmentAssertion(fragA.indices, extractFn);
    const b = fragmentAssertion(fragB.indices, extractFn);
    if (a.status === 'contradiction' || b.status === 'contradiction') {
      return { ok: false, reason: `${label} internal contradiction within one fragment` };
    }
    if (a.status !== 'asserted' || b.status !== 'asserted') {
      return { ok: false, reason: `${label} not positively asserted by both fragments (asserted-by-one/absent-from-other, or both silent, is not sufficient — ${label} has no "not applicable" case)` };
    }
    return a.value === b.value
      ? { ok: true, reason: `${label} agrees ("${a.value}")` }
      : { ok: false, reason: `${label} mismatch ("${a.value}" vs "${b.value}")` };
  };

  const PRODUCT_AGREEMENT_ATTRIBUTES = [
    { label: 'cover designation', extract: extractCoverLetter },
    { label: 'artist', extract: extractArtist },
    { label: 'presentation/finish marker', extract: extractPresentationValue },
  ];

  // A merge is only ever worth evaluating when `scored[0]` — the SINGLE
  // family selectTitleFamilyCandidate would actually promote — is itself
  // below the floor. A family ranked #2+ that already independently
  // clears >=3 has nothing to gain from being a merge TARGET (it was
  // never going to be promoted on its own regardless), and — the real bug
  // this restriction fixes, found via the mandated full-suite A/B
  // (tests/q85-compact-key.test.js's Funnybook fixture) — a family
  // ranked #1 that ALREADY independently clears >=3 must never be
  // disturbed by a merge either, even when a lower-ranked, noise-bearing
  // singleton happens to be its token-superset. Pre-fix, this function
  // paired ANY below-floor family (not just scored[0]) against every
  // other family regardless of rank — on the Funnybook fixture, that
  // wrongly merged the already-fine, already-promotable 4-member "funny
  // book" family (scored[0], count>=3 on its own) into a 1-member "funny
  // book nice copy" singleton (ranked #2, below floor), replacing a clean
  // title with one carrying two extra unexplained tokens ("nice"/"copy")
  // that then tripped the pre-existing Q85-B compact-bigram gate and
  // flipped the decision to 'refused-identity-conflict'. Restricting the
  // below-floor side to `scored[0]` specifically preserves the real Spawn
  // #351 fixture (its 2-member top family, weightSum 8.0, WAS scored[0]
  // and below floor) while correctly leaving the Funnybook fixture's
  // already-qualifying scored[0] untouched — mirrors this function's own
  // documented intent ("a below-floor TOP family needs to merge with a
  // partner") exactly: "top family" means scored[0], not any below-floor
  // family at any rank.
  if (scored[0].count >= 3) return scored;
  const famA = scored[0];

  for (let j = 0; j < scored.length; j++) {
    const famB = scored[j];
    if (famA === famB) continue;

    let superset, subset;
    if (tokenSubsetOf(famA.tokens, famB.tokens)) {
      superset = famB; subset = famA;
    } else if (tokenSubsetOf(famB.tokens, famA.tokens)) {
      superset = famA; subset = famB;
    } else {
      continue; // neither is a subset of the other — not a fragmentation candidate
    }

    const combinedIndices = [...superset.indices, ...subset.indices];
    const seen = new Set();
    const dedupedIndices = [];
    for (const idx of combinedIndices) {
      const key = dedupKeyFor(idx);
      if (seen.has(key)) continue;
      seen.add(key);
      dedupedIndices.push(idx);
    }

    if (dedupedIndices.length < 3) continue; // wouldn't newly clear the floor

    if (dedupedIndices.some((idx) => isContaminated(idx))) {
      console.log(`[commit4.1-merge] REFUSED (contamination): "${superset.title}" + "${subset.title}"`);
      continue;
    }

    const issueAgreement = checkMandatoryAttributeAgreement(famA, famB, extractIssueFromTitle, 'issue');
    if (!issueAgreement.ok) {
      console.log(`[commit4.1-merge] REFUSED (${issueAgreement.reason}): "${superset.title}" + "${subset.title}"`);
      continue;
    }
    const yearCheck = resolveFamilyYearConsensus(null, itemsOrTitles, dedupedIndices);
    if (yearCheck.mode === 'conflict-locked') {
      console.log(`[commit4.1-merge] REFUSED (year contradiction ${yearCheck.assertedYears.join(' vs ')}): "${superset.title}" + "${subset.title}"`);
      continue;
    }

    // Positive product-agreement gate (review round, item 2) — token
    // containment + no-contradiction above is necessary but not
    // sufficient; prove the two FRAGMENTS (famA/famB, not the combined
    // set) describe the same visual product on cover designation, artist,
    // and presentation/finish marker, per the conditional rule documented
    // on this function itself. Replaces the old cover-letter-only,
    // combined-set, contradiction-only check (which only caught two
    // DIFFERENT asserted letters somewhere in the merged pool — it never
    // caught one fragment asserting a specific cover/artist/presentation
    // with the other fragment silent on it entirely, which this gate now
    // also blocks).
    let agreementBlocked = false;
    for (const { label, extract } of PRODUCT_AGREEMENT_ATTRIBUTES) {
      const agreement = checkAttributeAgreement(famA, famB, extract, label);
      if (!agreement.ok) {
        console.log(`[commit4.1-merge] REFUSED (${agreement.reason}): "${superset.title}" + "${subset.title}"`);
        agreementBlocked = true;
        break;
      }
    }
    if (agreementBlocked) continue;

    // Clean merge — canonical identity (title/tokens/rawTitle/
    // memberTokens) comes from the token-SUPERSET family (the merge-
    // direction pin), recomputed via the existing scoreTitleFamilies
    // (not a duplicated weight-sum calculation) so weightSum/topRank/
    // count stay consistent with every other family this file produces.
    const mergedRaw = {
      title: superset.title,
      tokens: superset.tokens,
      indices: dedupedIndices,
      memberTokens: [...(superset.memberTokens || []), ...(subset.memberTokens || [])],
    };
    const [mergedScored] = scoreTitleFamilies([mergedRaw], itemsOrTitles);
    // Review round, item 3 — explicit marker so identityCore.js's
    // resolveIdentity can narrow its publisher-caution behavior to ONLY
    // this merged-fragment path, never to an ordinary (unmerged)
    // top-rank-protection/weighted-consensus family. Set here, at the
    // single point of truth for "this family is a Commit 4.1 merge
    // result," rather than inferred downstream from indirect signals.
    mergedScored.mergedFromFragments = true;
    console.log(
      `[commit4.1-merge] ACCEPTED: "${subset.title}" (${subset.count} members) merges into ` +
      `"${superset.title}" (${superset.count} members) -> ${mergedScored.count} members, ` +
      `weightSum=${mergedScored.weightSum.toFixed(1)}`
    );

    const remaining = scored.filter((f) => f !== superset && f !== subset);
    const result = [mergedScored, ...remaining];
    result.sort((a, b) => (b.weightSum - a.weightSum) || (b.count - a.count));
    return result;
  }

  return scored; // no qualifying pair found — unchanged, byte-identical to today
};

// Track B Phase 0, Commit 4.3 (Rider E, 2026-07-30) — the shared
// family-evidence row serializer. Extracted from selectTitleFamilyCandidate's
// own logFamilyEvidence closure (below) — same row shape
// (idx/itemId/legacyItemId/title/price) that closure has used since
// Commit 4.1 — so BOTH the pre-existing [family-evidence] call sites
// (top-rank-protection/weighted-consensus, unchanged) and the new
// retention-path structured event (api/enrich.js, at the point issue/
// year support and the final familyKey are known) build rows from ONE
// implementation rather than two independently-maintained copies.
export const buildFamilyEvidenceRows = (indices, items) => {
  return (indices || []).map((idx) => {
    const it = items?.[idx];
    return {
      idx,
      itemId: (it && typeof it !== 'string' && it.itemId) || null,
      legacyItemId: (it && typeof it !== 'string' && it.legacyItemId) || null,
      title: (typeof it === 'string' ? it : it?.rawTitle || it?.title) || null,
      price: (it && typeof it !== 'string' && typeof it.price === 'number') ? it.price : null,
    };
  });
};

// Track B Phase 0, Commit 4.3 (IMPLEMENTATION PACKET HOLD, Section 4) —
// pure extraction of the retention-path [family-evidence] event, so it is
// directly testable against the real api/enrich.js call site's inputs
// without needing to simulate the log line or import the whole handler.
// Deliberately returns the computed isRetentionPath + logLine rather than
// calling console.log itself, so a test can assert on the exact string
// this function produces AND independently confirm api/enrich.js's real
// call site logs that identical string (not a re-derived copy). Mirrors
// the gate api/enrich.js used inline before this extraction — moved here
// verbatim, not redesigned.
export const buildRetentionFamilyEvidenceLog = (familyCandidate, familyIssueConsensus, familyYearConsensus, familyKey, visualItems, observedFamilyFingerprint) => {
  const isRetentionPath = !FAMILY_OVERRIDE_DECISIONS.includes(familyCandidate?.decision)
    && familyCandidate?.decision !== 'refused-identity-conflict'
    && familyCandidate?.titleAxisOnlyBlock === true;
  if (!isRetentionPath) return { isRetentionPath: false, logLine: null, rows: null };
  // Track B Phase 0, Commit 4.3.1 — a near-miss margin-decline conflict
  // (identityCore.js's own reason marker on familyIssueConsensus) still
  // reaches this same retention path (titleAxisOnlyBlock===true), but was
  // NOT granted authority — familyEvidenceQualified must say so honestly
  // rather than claim the generic qualified-retention reason.
  //
  // COMMIT 4.3.1 HOLD (R1) — a first-shipped version of this near-miss
  // branch passed the PRIOR issue (the untouched, preserved Vision value)
  // as the SAME `familyKey` argument the qualified-retention branch uses
  // for the family's OWN adopted value — producing a familyKey like
  // "spawn|1" while the event's own `rows` field lists five #351 listings.
  // The whole point of this event is documenting a three-way disagreement
  // (prior vs. family vs. raw pool) — collapsing two of those identities
  // into one field misrepresents which issue the evidence rows actually
  // describe. Fixed per explicit reviewer preference (R1): emit BOTH
  // fingerprints, named, rather than relabeling one. `familyKey` (5th
  // positional arg) is reinterpreted as `priorFingerprint` ONLY for the
  // near-miss branch specifically (the qualified-retention call site is
  // untouched — it never disagrees with itself, so a single familyKey
  // remains correct and sufficient there); `observedFamilyFingerprint`
  // (new, optional 6th arg) is only ever populated by the near-miss call
  // site. Omitting it is a safe no-op for every pre-existing caller.
  const isNearMissDecline = familyIssueConsensus?.reason === 'retention-margin-decline-conflict';
  const rows = buildFamilyEvidenceRows(familyCandidate?.topFamily?.indices, visualItems);
  const identityField = (isNearMissDecline && observedFamilyFingerprint)
    ? `priorFingerprint="${familyKey}" observedFamilyFingerprint="${observedFamilyFingerprint}"`
    : `familyKey="${familyKey}"`;
  const logLine =
    `[family-evidence] decision=${familyCandidate?.decision} ` +
    `merged=${familyCandidate?.topFamily?.mergedFromFragments === true} ` +
    `familyEvidenceQualified=${!isNearMissDecline} qualificationReason=${isNearMissDecline ? 'retention-margin-decline-conflict' : 'title-axis-only-block-retained'} ` +
    `issueSupport=${familyIssueConsensus?.support ?? 'null'}/${familyIssueConsensus?.uniqueRows ?? 'null'} ` +
    `yearSupport=${familyYearConsensus?.support ?? 'null'}/${familyYearConsensus?.uniqueRows ?? 'null'} ` +
    `${identityField} rows=${JSON.stringify(rows)}`;
  return { isRetentionPath: true, logLine, rows };
};

export const selectTitleFamilyCandidate = (items, visionTitle, visionIssue, visionYear = null, opts = {}) => {
  // Guard clauses
  if (!Array.isArray(items) || items.length === 0) {
    return {
      decision: 'refused-identity-conflict',
      selectedTitle: null,
      rawTitle: null,
      reason: 'No visual results from eBay',
      topFamily: null,
      runnerUp: null,
      families: [],
    };
  }

  if (items.length < 5) {
    return {
      decision: 'fallback-vision',
      selectedTitle: null,
      rawTitle: null,
      reason: `Only ${items.length} visual results (minimum 5 required)`,
      topFamily: null,
      runnerUp: null,
      families: [],
    };
  }

  // Build and score families
  const families = buildTitleFamilies(items);
  const scoredRaw = scoreTitleFamilies(families, items);
  // Track B Phase 0, Commit 4.1 — controlled fragment merge. Runs BEFORE
  // the existing floor checks below, so a merge that clears the floor is
  // indistinguishable, from this point on, from any other family that
  // arrived at >=3 members on its own — no new decision branch, no
  // touched existing branch. A pool with no qualifying fragmentation
  // returns `scoredRaw` completely unchanged (see the function's own
  // no-op guarantee).
  const scored = mergeFragmentedTitleFamilies(scoredRaw, items);

  if (scored.length === 0) {
    return {
      decision: 'refused-identity-conflict',
      selectedTitle: null,
      rawTitle: null,
      reason: 'No valid title families extracted',
      topFamily: null,
      runnerUp: null,
      families: [],
    };
  }

  const topFamily = scored[0];
  const runnerUp = scored[1] || null;

  // Track B Phase 0, Commit 4.1 review round (item 3) — narrowed,
  // permanent, family-scoped instrumentation. Fires exactly once per
  // request, ONLY at the point a family is genuinely selected (the two
  // decisions below where a real identity gets adopted:
  // top-rank-protection / weighted-consensus) — never for
  // fallback-vision/refused-identity-conflict, where nothing was
  // selected and there is nothing to prove an itemId for. Replaces the
  // prior unconditional `[extractIdentity] full pool:` dump (removed —
  // see that function's own comment) which logged the ENTIRE visual pool
  // on every request regardless of outcome.
  //
  // Track B Phase 0, Commit 4.3 — row-building logic extracted to the
  // module-level, exported buildFamilyEvidenceRows (below), a deliberate
  // amendment (not drift) to this instrumentation contract: the event's
  // real purpose was always "fires wherever family rows DRIVE AUTHORITY,"
  // and Commit 4.3's retention path (identityCore.js) is a newly-
  // recognized authority path that needed the SAME row payload shape,
  // computed at a later point in the pipeline (api/enrich.js, after
  // issue/year support and the final familyKey are known) than this
  // function ever has access to. Byte-identical output for these two
  // pre-existing call sites — this is a pure extraction, not a behavior
  // change.
  const logFamilyEvidence = (decision, family) => {
    const rows = buildFamilyEvidenceRows(family?.indices, items);
    console.log(`[family-evidence] decision=${decision} merged=${family?.mergedFromFragments === true} rows=${JSON.stringify(rows)}`);
  };

  // Extract issue from items[0]
  const item0 = items[0];
  const item0Title = typeof item0 === 'string' ? item0 : (item0?.rawTitle || item0?.title || '');
  const item0Issue = extractIssueFromTitle(item0Title);
  const item0Tokens = tokenizeTitleFamily(item0Title);

  // Tokenize Vision title for overlap check
  const visionTokens = tokenizeTitleFamily(visionTitle || '');

  // Q84-AMENDED — dual-axis agreement detection: sanitized Vision title
  // equals the eBay image consensus title (articles ignored). When true,
  // family overrides pass through the token-class gate.
  const ebayConsensusTitle = opts.ebayConsensusTitle || null;
  const dualAxisAgreed = (() => {
    if (!ebayConsensusTitle || !visionTitle) return false;
    const a = visionTokens.filter((t) => !ARTICLE_TOKENS.has(t));
    const b = tokenizeTitleFamily(ebayConsensusTitle).filter((t) => !ARTICLE_TOKENS.has(t));
    if (a.length > 0 && a.length === b.length && a.every((t) => b.includes(t))) return true;
    // Q85: compact-key equality fallback ("Funnybook" ≡ "Funny Book")
    const ka = compactTitleKey(a.join(''));
    const kb = compactTitleKey(b.join(''));
    return ka.length >= 4 && ka === kb;
  })();
  const poolArtistTokens = dualAxisAgreed ? extractPoolArtistTokens(items) : null;
  const q84Gate = (familyTokens, familyRawText = null, familyMemberTokens = null) => {
    if (!dualAxisAgreed) return { allowed: true, reason: 'no dual-axis agreement' };
    const gate = applyDualAxisGate(familyTokens, visionTokens, poolArtistTokens, familyRawText, familyMemberTokens);
    if (gate.allowed) {
      console.log(`[Q84] override-allowed reason=${gate.reason}`);
    } else {
      console.log(`[Q84] override-blocked reason=${gate.reason} — agreed title stands: "${visionTitle}"`);
    }
    return gate;
  };

  // Q43 A1: Top-rank-protection identity guard — three-layer filter prevents
  // lot/run/collection listings, subtitle junk, and low-overlap contamination
  // from becoming the identity source.
  //
  // Evidence: Batman #423 stored "batman 125 lot huge run", Venom #1 stored
  // "venom the madness lot last dance men 97 juggernaut mcu", Avengers #63
  // stored "the avengers hawkeye becomes new goliath" — Vision had correct
  // canonical titles on ALL. Top-rank must not override when consensus is junk.
  const item0Family = scored.find(f => f.indices?.includes(0));

  if (item0Family) {
    // A1.c: LOT_RE guard — never accept listings containing lot/run/collection
    // tokens as identity source. Catches bulk-listing class contamination.
    const LOT_RE = /\b(?:lot|bundle|complete\s*set|full\s*run|comic\s*library|comic\s*collection|huge\s*run)\b|\bset\s*of\s*\d+\b|\b\d+\s*(?:book|issue|comic)s?\s*(?:lot|set)\b/i;
    const item0RawTitle = item0Family.rawTitle || '';
    const isLotListing = LOT_RE.test(item0RawTitle);

    if (isLotListing) {
      console.log(`[top-rank-guard] LOT/RUN listing REJECTED as identity source: "${item0RawTitle}"`);
      // Fall through to weighted-consensus path
    } else {
      const issueMatch = item0Issue && visionIssue && String(item0Issue) === String(visionIssue);
      const familyWeightOk = item0Family.weightSum >= 5;

      // Vision-overlap: require ≥1 shared token between item0 and Vision
      const sharedTokens = item0Tokens.filter(t => visionTokens.includes(t));
      const hasVisionOverlap = sharedTokens.length >= 1;

      // A1.b: Bidirectional overlap guards — prevent both thin-Vision and
      // subtitle-junk contamination.
      //
      // Forward ratio: sharedTokens / visionTokens — protects against
      // top-rank having FEWER overlapping tokens than Vision expects
      // (Vision "batman" vs top-rank "batman 125 lot" → 1/1 = 100% forward,
      // but junk still caught by LOT_RE).
      //
      // Reverse ratio: sharedTokens / item0Tokens — protects against
      // subtitle-junk class where top-rank has MANY non-overlapping tokens
      // that Vision doesn't recognize. Example: "the avengers hawkeye becomes
      // new goliath" (6 tokens) vs Vision "avengers" (1 token) → 1/6 = 17%
      // reverse overlap → REJECT, preserve Vision.
      const forwardRatio = visionTokens.length > 0 ? sharedTokens.length / visionTokens.length : 0;
      const reverseRatio = item0Tokens.length > 0 ? sharedTokens.length / item0Tokens.length : 0;

      const sufficientForward = forwardRatio >= 0.5;  // ≥50% of Vision tokens matched
      const sufficientReverse = reverseRatio >= 0.4;  // ≥40% of top-rank tokens matched

      if (!sufficientForward) {
        console.log(`[top-rank-guard] insufficient forward overlap (${sharedTokens.length}/${visionTokens.length} = ${Math.round(forwardRatio * 100)}% < 50%) — fallback to Vision`);
        // Fall through to weighted-consensus path
      } else if (!sufficientReverse) {
        console.log(`[top-rank-guard] subtitle-junk detected (${sharedTokens.length}/${item0Tokens.length} = ${Math.round(reverseRatio * 100)}% < 40%) — fallback to Vision`);
        // Fall through to weighted-consensus path
      } else {
        // FIX A1: Stricter competing family threshold (3x instead of 2x) to prevent
        // top-ranked correct result from being overridden by high-volume wrong family.
        // Black Panther #1 case: item[0] weight 5.0 (correct) vs competing weight 6.5 (wrong).
        // Old threshold (2x): 6.5 >= 10.0? NO → protection fires → wrong answer.
        // New threshold (3x): 6.5 >= 15.0? NO → protection fires → correct.
        const competingFamilies = scored.filter(f => f !== item0Family);
        const strongestCompetitor = competingFamilies[0]; // already sorted by weight descending
        // Track B Phase 0, Commit 4.3 — delegates to the shared, exported
        // isCompetingFamilyTooStrong (above) instead of an inline copy of
        // the same 3x-margin arithmetic, so identityCore.js's qualified-
        // family-authority predicate can reuse this exact bar.
        const competingFamilyTooStrong = isCompetingFamilyTooStrong(item0Family.weightSum, competingFamilies);

        // GREENLIGHT: Drop hasEnoughTokens from gate chain.
        // Token count anti-correlates with quality (clean titles: 1-3 tokens,
        // junk listings: 5-10+ tokens). Overlap guards (50%/40%) + LOT_RE
        // already reject junk. Removing token threshold unblocks clean canonical
        // titles (Batman, Avengers, The Mighty Thor) from top-rank-protection.
        // Q84-AMENDED: dual-axis token-class gate on top-rank-protection.
        const q84TopRank = q84Gate(item0Family.tokens, item0Family.rawTitle, item0Family.memberTokens);
        if (issueMatch && familyWeightOk && hasVisionOverlap && !competingFamilyTooStrong && q84TopRank.allowed) {
          // A1.a: Route through sanitizeSeriesTitle to remove creator names,
          // cover descriptors, condition words, embedded years, seller noise.
          // Then apply post-selection boilerplate sanitization.
          // GrailKey Dispatch 03 Strips 1+2 — titleSource is item0Family.title
          // (unchanged) UNLESS the gate carries a real admittedTitleTokens
          // filter (creator-lane/q140-coherent-content), see
          // buildGatedTitleSource's own doc comment.
          const titleSource = buildGatedTitleSource(q84TopRank, item0Family.title);
          const cleaned = sanitizeSeriesTitle(titleSource);
          const sanitizedTitle = sanitizeSelectedTitle(dedupeIssueToken(cleaned, visionIssue));
          logFamilyEvidence('top-rank-protection', item0Family);
          return {
            decision: 'top-rank-protection',
            selectedTitle: sanitizedTitle,
            rawTitle: item0Family.rawTitle,
            reason: `Top-ranked result protected (${item0Tokens.length} tokens, weight ${item0Family.weightSum.toFixed(1)}, forward ${Math.round(forwardRatio * 100)}% / reverse ${Math.round(reverseRatio * 100)}%)`,
            topFamily: item0Family,
            runnerUp: strongestCompetitor,
            families: scored,
            // GrailKey Dispatch 03 Strip 1 — tokens routed out of the title
            // (publisher/imprint/event names) for the caller to thread into
            // confirmedVariant. Empty except on the q140-coherent-content
            // provenance with a real match.
            admittedVariantTokens: q84TopRank.admittedVariantTokens || [],
          };
        }
      }
    }
  }

  // FIX A2: Weighted-consensus with percentage-based overlap (40% of shorter token set).
  // Catwoman #5 case: "catwoman 2018 stanley artgerm lau" (5 tokens) vs Vision "catwoman" (1 token).
  // Old logic: 1 shared / min(5,1) = 100% → but threshold was absolute count (2 tokens).
  // New logic: 1 shared / 1 Vision token = 100% ≥ 40% → ACCEPT.
  const topFamilyOverlap = topFamily.tokens.filter(t => visionTokens.includes(t));
  const shorterTokenCount = Math.min(topFamily.tokens.length, visionTokens.length);
  const rawOverlapRatio = shorterTokenCount > 0 ? topFamilyOverlap.length / shorterTokenCount : 0;
  const OVERLAP_THRESHOLD = 0.4; // 40% of shorter token set

  // Q85: compact-key EQUALITY fallback — "Funnybook" (Vision) vs
  // "Funny Book" (family) has ZERO token overlap yet names the same book.
  // Articles + neutral publisher/format tokens are excluded from the key.
  // Strict equality only ("flash" must never match "flashpoint").
  const q85VisionKey = compactTitleKey(
    visionTokens.filter((t) => !ARTICLE_TOKENS.has(t) && !NEUTRAL_ADDITION_TOKENS.has(t)).join('')
  );
  const q85FamilyKey = compactTitleKey(
    topFamily.tokens.filter((t) => !ARTICLE_TOKENS.has(t) && !NEUTRAL_ADDITION_TOKENS.has(t)).join('')
  );
  const q85CompactMatch = q85VisionKey.length >= 4 && q85VisionKey === q85FamilyKey;

  // Q85-B: FAMILY-SIDE adjacent-bigram compact join. Whole-key equality
  // above fails when the family carries ANY extra token ("funny book comix"
  // → "funnybookcomix" ≠ "funnybook"), and per-token overlap can never
  // reconcile "funny"+"book" against Vision "funnybook" (06:53 2026-07-12:
  // family overlap 0/1 → refused-identity-conflict → phase2 skipped, while
  // [Q85] had already fired on the PC path). Test each single family token
  // and each adjacent-bigram join against the compact Vision key.
  //
  // Q109-C [2026-07-17]: cap tolerated extra tokens beyond the matched
  // window at 1 — the exact "comix" precedent above that justified this
  // override. A family with 2+ tokens left over is carrying real title
  // content (a co-title/subtitle suffix — "Replacement God AND OTHER
  // STORIES" class), not disposable seller noise, and must not be
  // collapsed back to Vision's shorter spelling.
  let q85BigramMatch = false;
  if (!q85CompactMatch && q85VisionKey.length >= 4) {
    const famToks = topFamily.tokens.filter(
      (t) => !ARTICLE_TOKENS.has(t) && !NEUTRAL_ADDITION_TOKENS.has(t)
    );
    for (let i = 0; i < famToks.length && !q85BigramMatch; i++) {
      if (compactTitleKey(famToks[i]) === q85VisionKey) {
        const extra = famToks.length - 1;
        if (extra <= 1) {
          q85BigramMatch = true;
          console.log(`[Q85-B] family token "${famToks[i]}" equals compact Vision key "${q85VisionKey}"`);
        } else {
          console.log(`[Q85-B] family token "${famToks[i]}" compact-matches but ${extra} extra tokens remain — real content, not noise, override blocked`);
        }
      } else if (i + 1 < famToks.length && compactTitleKey(famToks[i] + famToks[i + 1]) === q85VisionKey) {
        const extra = famToks.length - 2;
        if (extra <= 1) {
          q85BigramMatch = true;
          console.log(`[Q85-B] family bigram "${famToks[i]} ${famToks[i + 1]}" compact-joins to Vision key "${q85VisionKey}"`);
        } else {
          console.log(`[Q85-B] family bigram "${famToks[i]} ${famToks[i + 1]}" compact-joins but ${extra} extra tokens remain — real content, not noise, override blocked`);
        }
      }
    }
  }

  const overlapRatio = (q85CompactMatch || q85BigramMatch) ? 1 : rawOverlapRatio;
  if ((q85CompactMatch || q85BigramMatch) && rawOverlapRatio < OVERLAP_THRESHOLD) {
    console.log(`[Q85] compact-key match "${q85VisionKey}" — token overlap ${Math.round(rawOverlapRatio * 100)}% treated as 100%`);
  }

  // B2 (LOT-CONSENSUS): LOT_RE guard on weighted-consensus path (same pattern as top-rank).
  // Evidence: "spawn lot and" #6 → family construction included LOT listing in consensus pool.
  const LOT_RE = /\b(?:lot|bundle|complete\s*set|full\s*run|comic\s*library|comic\s*collection|huge\s*run)\b|\bset\s*of\s*\d+\b|\b\d+\s*(?:book|issue|comic)s?\s*(?:lot|set)\b/i;
  const isLotFamily = LOT_RE.test(topFamily.rawTitle || '');

  // Q84-AMENDED: dual-axis token-class gate on weighted-consensus. A
  // blocked override returns fallback-vision — the agreed title stands.
  //
  // Q140 dispatch (2026-07-22) — evaluated STRICT first (no
  // familyMemberTokens, coherent-content lane disabled) specifically so
  // Q119's narrower, whitelist-verified compound completion below keeps
  // first priority over the broader coherent-content lane. Captain Marvel
  // #17 class: "kamala"/"khan" clear the coherent-content lane's >=3-member
  // floor by a wide margin (12+/20), but adopting them into the TITLE is
  // wrong — they describe story CONTENT (Kamala Khan's first appearance,
  // true of every copy of this issue, any seller's phrasing), not which
  // physical PRODUCT this is, and appending them would corrupt the PC/CV
  // title query for a book whose real product name is just "Captain
  // Marvel." Q119's compound completion already has the correct, narrow
  // answer for this shape (whitelist-verified single-word recovery). The
  // coherent-content lane is retried further below, strictly as a fallback
  // for when compound completion can't resolve it either (Adventure Time
  // Summer Special class: "sdcc"/"summer"/"special"/"exclusive" together
  // are not a 2-word COMPOUND_TITLE_WHITELIST entry, so completion returns
  // null, and the broader lane is what's actually needed there).
  const q84ConsensusStrict = (topFamily.count >= 3 && overlapRatio >= OVERLAP_THRESHOLD && !isLotFamily)
    ? q84Gate(topFamily.tokens, topFamily.rawTitle)
    : { allowed: true, reason: 'gate not reached' };
  if (topFamily.count >= 3 && overlapRatio >= OVERLAP_THRESHOLD && !isLotFamily && !q84ConsensusStrict.allowed) {
    // Q119 — before falling all the way back to bare Vision, check whether
    // Vision's title plus a single family-confirmed neutral word completes
    // a known real title (see completeCompoundTitle above). Does NOT adopt
    // any of the tokens that actually triggered the block.
    const compoundCompletion = completeCompoundTitle(visionTitle, visionTokens, topFamily.tokens);
    if (compoundCompletion) {
      console.log(`[Q119] compound-title completion: "${visionTitle}" → "${compoundCompletion}" (blocked additions [${q84ConsensusStrict.reason}] still excluded)`);
      logFamilyEvidence('weighted-consensus', topFamily);
      return {
        decision: 'weighted-consensus',
        selectedTitle: compoundCompletion,
        rawTitle: topFamily.rawTitle,
        reason: `[Q119] compound-title completion from "${visionTitle}" — family confirms "${compoundCompletion}" (blocked additions excluded: ${q84ConsensusStrict.reason})`,
        topFamily,
        runnerUp,
        families: scored,
      };
    }
  }
  // Q140 — retry WITH member-token data now that compound completion has
  // had its chance and declined. A still-blocked addition that's genuinely
  // coherent content (not a scattered/single-seller phrase) gets the full
  // family override instead of falling all the way back to bare Vision.
  const q84Consensus = (topFamily.count >= 3 && overlapRatio >= OVERLAP_THRESHOLD && !isLotFamily && !q84ConsensusStrict.allowed)
    ? q84Gate(topFamily.tokens, topFamily.rawTitle, topFamily.memberTokens)
    : q84ConsensusStrict;

  // GrailKey Commit B1 (2026-08-02, Spawn #351 virgin-variant dispatch) —
  // confirmed live (22:53:21 UTC, build af32d21): applyDualAxisGate's bare
  // "creator-tokens" fallthrough (added tokens are ALL recognized creator/
  // artist names, nonCreator.length===0) returns allowed:true unconditionally
  // — a verdict correctly designed for TITLE-TEXT AUGMENTATION onto an
  // already-agreed identity (the Wonder Woman #75 / Jenny Frison precedent,
  // tests/q84-dual-axis.test.js). At THIS call site the same verdict also
  // authorizes selecting an entire DIFFERENT winning title family for
  // FAMILY/IDENTITY SELECTION, not mere title augmentation.
  //
  // CORRECTED (same dispatch, review round): the real production trace's
  // visionIssue was NOT absent — it was "1", present and truthy
  // (`[visual] no coherent consensus — keeping Claude issue as-is: 1`). An
  // earlier version of this fix gated on `!visionIssue` (issue absent) and
  // would NOT have fired for this exact request. The real distinguishing
  // signal, also confirmed live in the same trace
  // (`[visual] consensus: issue=none (8/20) visionIssueCount=0`), is that
  // the winning family's OWN members carry ZERO support for Vision's
  // issue — every one of "spawn brett booth"'s 3 members is a #351 listing,
  // none is "#1". WW#75's real fixture (tests/q84-dual-axis.test.js,
  // visionIssue='75') has full family-member support (the pool is
  // "Wonder Woman #75 Jenny Frison..." throughout) — the correct
  // discriminator is family-member issue agreement, not mere presence of
  // a Vision issue number. Reuses extractIssueFromTitle (already imported/
  // used one block above, item0Issue) rather than a new extractor — no new
  // subsystem. Scoped narrowly: only fires when (a) creator-tokens is the
  // SOLE reason for allowance (not adjacent-pair recovery or the coherent-
  // content lane, both of which carry independent additional evidence) and
  // (b) visionIssue is present AND not a single one of the winning family's
  // own members' own extracted issue agrees with it. When visionIssue is
  // itself absent, there is nothing to corroborate against and this gate
  // does not fire — that case is unaffected, same as before.
  // GrailKey Dispatch 03 (2026-08-06) — converted from a reason-string
  // regex pair to the explicit provenance field (see CLAUDE.md
  // "applyDualAxisGate reason-string coupling"). 'creator-lane-direct' is
  // exactly the bare-creator-tokens branch this check always meant;
  // 'creator-lane-adjacent-recovery' (previously excluded via the
  // "adjacent-pair recovered" substring) is now excluded by simply not
  // being 'creator-lane-direct'.
  const isBareCreatorTokensOnly = q84Consensus.allowed === true
    && q84Consensus.provenance === 'creator-lane-direct';
  const familyMemberIssueSupport = !isBareCreatorTokensOnly || !visionIssue
    ? null
    : (topFamily.indices || []).some((idx) => {
        const memberItem = items[idx];
        const memberTitle = typeof memberItem === 'string' ? memberItem : (memberItem?.rawTitle || memberItem?.title || '');
        const memberIssue = extractIssueFromTitle(memberTitle);
        return memberIssue != null && String(memberIssue) === String(visionIssue);
      });
  const creatorTokensLackIssueCorroboration = isBareCreatorTokensOnly
    && visionIssue
    && familyMemberIssueSupport === false;

  if (topFamily.count >= 3 && overlapRatio >= OVERLAP_THRESHOLD && !isLotFamily
      && (!q84Consensus.allowed || creatorTokensLackIssueCorroboration)) {
    const blockReason = creatorTokensLackIssueCorroboration
      ? `creator-tokens-without-issue-corroboration [${q84Consensus.reason}] — Vision's issue #${visionIssue} has zero support among the winning family's own members`
      : q84Consensus.reason;
    return {
      decision: 'fallback-vision',
      selectedTitle: null,
      rawTitle: null,
      reason: `[Q84-dual-axis] ${blockReason} — Vision+eBay agree, family override blocked`,
      topFamily,
      runnerUp,
      families: scored,
      // Track B Phase 0, Commit 4.3 (Matrix A, 2026-07-30) — set ONLY at
      // this single return site, the single point of truth for "this
      // fallback-vision decision is a genuine title-axis-only block": the
      // family already independently cleared the >=3-member floor AND the
      // >=40% Vision-overlap bar AND is not a LOT listing — the ONLY
      // reason title projection didn't happen is Q84's dual-axis gate
      // vetoing the TITLE content specifically. Every other fallback-
      // vision/refused-identity-conflict return path in this function
      // (weak overlap, below-floor count, zero overlap, insufficient
      // pool) leaves this field absent/undefined — a falsy default,
      // mirroring mergedFromFragments' own "set here, at the single point
      // of truth, rather than inferred downstream from indirect signals"
      // convention (this file, Commit 4.1). identityCore.js's qualified-
      // family-authority predicate gates on this field being exactly
      // `true`, never on `family.decision` or `family.reason` string
      // content.
      titleAxisOnlyBlock: true,
    };
  }

  // Q38: Require ≥3 members for weighted-consensus override
  if (topFamily.count >= 3 && overlapRatio >= OVERLAP_THRESHOLD && !isLotFamily) {
    // Q43 A1.a: Apply same sanitizeSeriesTitle treatment as top-rank-protection
    // for consistency — removes creator names, descriptors, noise before final title.
    // GrailKey Dispatch 03 Strips 1+2 — titleSource is topFamily.title
    // (unchanged) UNLESS q84Consensus carries a real admittedTitleTokens
    // filter (creator-lane/q140-coherent-content); see
    // buildGatedTitleSource's own doc comment.
    const titleSource = buildGatedTitleSource(q84Consensus, topFamily.title);
    const cleaned = sanitizeSeriesTitle(titleSource);
    let sanitizedTitle = sanitizeSelectedTitle(dedupeIssueToken(cleaned, visionIssue));
    // Q85-B: compact-key acceptance means family ≡ Vision — prefer Vision's
    // compact spelling. The generic sanitizer treats "book" as noise and
    // mangles compound-spaced families ("funny book" → "funny"), which would
    // poison downstream PC/comp queries with a junk token.
    if ((q85CompactMatch || q85BigramMatch) && visionTitle && String(visionTitle).trim()) {
      sanitizedTitle = String(visionTitle).trim();
      console.log(`[Q85-B] compact-key acceptance — selectedTitle uses Vision spelling "${sanitizedTitle}"`);
    }
    logFamilyEvidence('weighted-consensus', topFamily);
    return {
      decision: 'weighted-consensus',
      selectedTitle: sanitizedTitle,
      rawTitle: topFamily.rawTitle,
      reason: `Weighted consensus (${topFamily.count} members, weight ${topFamily.weightSum.toFixed(1)}, ${topFamilyOverlap.length}/${shorterTokenCount} tokens = ${Math.round(overlapRatio * 100)}% overlap)`,
      topFamily,
      runnerUp,
      families: scored,
      // GrailKey Commit P — overlapRatio was already computed above (used
      // only to build the `reason` string and gate this same branch) but
      // never returned on the object itself. issueAuthority.js's
      // high-confidence marketplace-consensus predicate (P1) needs the
      // exact ratio, not just confirmation it cleared the >=40% floor —
      // additive field, no change to the decision this function reaches.
      overlapRatio,
      // GrailKey Dispatch 03 Strip 1 — see top-rank-protection's identical
      // field for the full rationale.
      admittedVariantTokens: q84Consensus.admittedVariantTokens || [],
    };
  }

  // B2 (LOT-CONSENSUS): When LOT_RE blocks weighted-consensus, log and fall through
  if (isLotFamily && topFamily.count >= 3 && overlapRatio >= OVERLAP_THRESHOLD) {
    console.log(`[lot-consensus] LOT/RUN family REJECTED from weighted-consensus: "${topFamily.rawTitle}"`);
  }

  // Q38: 1-2 member case with sufficient overlap → fallback-vision (insufficient consensus)
  if (topFamily.count >= 1 && topFamily.count < 3 && overlapRatio >= OVERLAP_THRESHOLD) {
    return {
      decision: 'fallback-vision',
      selectedTitle: null,
      rawTitle: null,
      reason: `Top family has only ${topFamily.count} members (need ≥3 for consensus override) — preserve Vision`,
      topFamily,
      runnerUp,
      families: scored,
    };
  }

  // Fallback-vision: top family exists but lacks sufficient overlap
  // FIX A2: Updated condition - now checking overlap ratio instead of absolute count
  if (overlapRatio < OVERLAP_THRESHOLD && topFamilyOverlap.length > 0) {
    return {
      decision: 'fallback-vision',
      selectedTitle: null,
      rawTitle: null,
      reason: `Top family weak overlap (${topFamilyOverlap.length}/${shorterTokenCount} tokens = ${Math.round(overlapRatio * 100)}% < 40%) — preserve Vision`,
      topFamily,
      runnerUp,
      families: scored,
    };
  }

  // Refused-identity-conflict: no overlap, visual pool unrelated
  return {
    decision: 'refused-identity-conflict',
    selectedTitle: null,
    rawTitle: null,
    reason: `Visual pool families lack overlap with Vision (best: ${topFamilyOverlap.length}/${shorterTokenCount} tokens)`,
    topFamily,
    runnerUp,
    families: scored,
  };
};
