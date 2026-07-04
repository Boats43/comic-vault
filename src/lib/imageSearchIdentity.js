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
import { sanitizeSeriesTitle } from './identityCore.js';

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

const CATEGORY_BLOCKS = [
  { kind: 'convention',     patterns: CONVENTION_PATTERNS },
  { kind: 'ratio',          patterns: RATIO_PATTERNS      },
  { kind: 'retailer',       patterns: RETAILER_PATTERNS   },
  { kind: 'exclusive',      patterns: EXCLUSIVE_PATTERNS  },
  { kind: 'limitation',     patterns: LIMITATION_PATTERNS },
  { kind: 'authentication', patterns: AUTH_PATTERNS       },
  { kind: 'finish',         patterns: FINISH_PATTERNS     },
];

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

// Extract issue # from a title. Re-uses the existing /#(\d{1,3})(?!\d)/
// pattern from api/enrich.js lookupEbayVisual so behavior is identical
// — issue # in 1-999 only, no trailing digits.
const ISSUE_RE = /#\s*(\d{1,3})(?!\d)/;

// Ship #24 Q12c — Marketing-copy discriminator for title-family path.
// Same logic as Q12b (identityAlignment.js), applied to title-family
// weighted-consensus issue extraction. Excludes "#1" when it appears
// near marketing keywords (Anniversary Issue #1, Special Issue #1, etc.)
const MARKETING_KEYWORDS_RE = /\b(anniversary|special|collector|limited|exclusive|variant)\b/i;

export const extractIssueFromTitle = (title) => {
  const titleStr = String(title || '');
  const m = titleStr.match(ISSUE_RE);
  if (!m) return null;

  const issueNum = m[1];
  const n = parseInt(issueNum, 10);
  if (n > 999) return null;

  // Q12c discriminator: flag "#1" as suspect when near marketing keywords
  if (issueNum === '1') {
    const matchIndex = m.index;
    const beforeMatch = titleStr.slice(Math.max(0, matchIndex - 30), matchIndex);
    const afterMatch = titleStr.slice(matchIndex, matchIndex + 30);
    const window = beforeMatch + afterMatch;

    if (MARKETING_KEYWORDS_RE.test(window)) {
      return null; // Exclude marketing-copy "#1" from title-family issue extraction
    }
  }

  return issueNum;
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
// Confidence calculation: average agreement across title+issue+year fields.
// Only fields with ≥50% agreement are returned (null otherwise).
// Minimum 5 listings required for consensus (returns null if < 5).
export const extractConsensus = (parsedRows) => {
  if (!Array.isArray(parsedRows) || parsedRows.length < 5) {
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
      .replace(/\b(alan\s+quah|inhyuk\s+lee|jeehyung\s+lee|raymond\s+gay|peach\s+momoko|artgerm|stanley\s+lau)\b/gi, '')
      .replace(/\b(david\s+nakayama|alex\s+ross|jim\s+lee|todd\s+mcfarlane|frank\s+miller)\b/gi, '')
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
    // Whitelist preserves known publisher-in-title series. New series not
    // on this list will still be incorrectly stripped — extend list as
    // production data surfaces them.
    const PUBLISHER_IN_TITLE_SERIES = [
      'marvel tales',
      'marvel presents',
      'marvel preview',
      'marvel spotlight',
      'marvel super action',
      'marvel super heroes',
      'marvel team-up',
      'marvel team up',
      'marvel triple action',
      'marvel two-in-one',
      'marvel two in one',
      'marvel age',
      'marvel chillers',
      'marvel feature',
      'marvel fanfare',
      'marvel comics presents',
      'marvel saga',
      'marvel premiere',
      'marvel mystery comics',
      'dc universe presents',
      'dc retroactive',
      'dc comics presents',
      'dc special',
      'image comics presents',
      'image united',
    ];
    const titleLower = s.toLowerCase().trim();
    const isPublisherSeries = PUBLISHER_IN_TITLE_SERIES.some((p) =>
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

  if (!titleOk || !issueOk) {
    // Can't establish consensus on basic identity
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

  // Extract most common variant token
  const allVariantTokens = parsedRows
    .flatMap((r) => r.variantTokens || [])
    .filter(Boolean);
  const variantResult = getMostCommon(allVariantTokens);
  const variant = variantResult.count >= 2 ? variantResult.value : null;

  // Calculate confidence: average agreement across title+issue+year
  const confidenceScore = yearOk
    ? (titleResult.count + issueResult.count + yearResult.count) / (total * 3)
    : (titleResult.count + issueResult.count) / (total * 2);

  return {
    title: titleResult.value,
    issue: issueResult.value,
    year: yearOk ? yearResult.value : null,
    publisher,
    variant,
    confidence: Math.round(confidenceScore * 100) / 100,
    agreement: {
      title: titleResult.count,
      issue: issueResult.count,
      year: yearResult.count,
      total,
    },
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
 * @param {string} title - raw eBay title
 * @returns {string[]} - lowercase token array, filtered, deduped
 */
export const tokenizeTitleFamily = (title) => {
  if (!title) return [];
  // extractSeriesTitle strips variant noise, slab markers, years, prices,
  // ratio, noise words. Returns null when result <2 chars.
  const cleaned = extractSeriesTitle(title);
  if (!cleaned) return [];

  const tokens = String(cleaned)
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
  }).filter(e => e.tokens.length > 0);

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
        assigned = true;
        break;
      }
    }
    if (!assigned) {
      // Start new family
      families.push({
        title: entry.tokens.join(' '), // normalized canonical
        tokens: entry.tokens,
        indices: [entry.idx],
      });
    }
  }

  return families;
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
    };
  });

  // Sort by weightSum descending
  scored.sort((a, b) => b.weightSum - a.weightSum);

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
export const selectTitleFamilyCandidate = (items, visionTitle, visionIssue, visionYear = null) => {
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
  const scored = scoreTitleFamilies(families, items);

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

  // Extract issue from items[0]
  const item0 = items[0];
  const item0Title = typeof item0 === 'string' ? item0 : (item0?.rawTitle || item0?.title || '');
  const item0Issue = extractIssueFromTitle(item0Title);
  const item0Tokens = tokenizeTitleFamily(item0Title);

  // Tokenize Vision title for overlap check
  const visionTokens = tokenizeTitleFamily(visionTitle || '');

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
        const competingFamilyTooStrong = strongestCompetitor && strongestCompetitor.weightSum >= (item0Family.weightSum * 3);

        // GREENLIGHT: Drop hasEnoughTokens from gate chain.
        // Token count anti-correlates with quality (clean titles: 1-3 tokens,
        // junk listings: 5-10+ tokens). Overlap guards (50%/40%) + LOT_RE
        // already reject junk. Removing token threshold unblocks clean canonical
        // titles (Batman, Avengers, The Mighty Thor) from top-rank-protection.
        if (issueMatch && familyWeightOk && hasVisionOverlap && !competingFamilyTooStrong) {
          // A1.a: Route through sanitizeSeriesTitle to remove creator names,
          // cover descriptors, condition words, embedded years, seller noise.
          // Then apply post-selection boilerplate sanitization.
          const cleaned = sanitizeSeriesTitle(item0Family.title);
          const sanitizedTitle = sanitizeSelectedTitle(dedupeIssueToken(cleaned, visionIssue));
          return {
            decision: 'top-rank-protection',
            selectedTitle: sanitizedTitle,
            rawTitle: item0Family.rawTitle,
            reason: `Top-ranked result protected (${item0Tokens.length} tokens, weight ${item0Family.weightSum.toFixed(1)}, forward ${Math.round(forwardRatio * 100)}% / reverse ${Math.round(reverseRatio * 100)}%)`,
            topFamily: item0Family,
            runnerUp: strongestCompetitor,
            families: scored,
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
  const overlapRatio = shorterTokenCount > 0 ? topFamilyOverlap.length / shorterTokenCount : 0;
  const OVERLAP_THRESHOLD = 0.4; // 40% of shorter token set

  // Q38: Require ≥3 members for weighted-consensus override
  if (topFamily.count >= 3 && overlapRatio >= OVERLAP_THRESHOLD) {
    // Q43 A1.a: Apply same sanitizeSeriesTitle treatment as top-rank-protection
    // for consistency — removes creator names, descriptors, noise before final title.
    const cleaned = sanitizeSeriesTitle(topFamily.title);
    const sanitizedTitle = sanitizeSelectedTitle(dedupeIssueToken(cleaned, visionIssue));
    return {
      decision: 'weighted-consensus',
      selectedTitle: sanitizedTitle,
      rawTitle: topFamily.rawTitle,
      reason: `Weighted consensus (${topFamily.count} members, weight ${topFamily.weightSum.toFixed(1)}, ${topFamilyOverlap.length}/${shorterTokenCount} tokens = ${Math.round(overlapRatio * 100)}% overlap)`,
      topFamily,
      runnerUp,
      families: scored,
    };
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
