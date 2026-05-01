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
export const extractIssueFromTitle = (title) => {
  const m = String(title || '').match(ISSUE_RE);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (n > 999) return null;
  return m[1];
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
  if (!Array.isArray(items)) return [];
  return items.map((it) => {
    const rawTitle = (it && typeof it.title === 'string') ? it.title : null;
    return {
      rawTitle,
      title: extractSeriesTitle(rawTitle),
      issue: extractIssueFromTitle(rawTitle),
      year: extractYearFromTitle(rawTitle),
      variantTokens: extractVariantTokens(rawTitle),
    };
  });
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
    // Strip publisher/slab markers
    s = s.replace(/\b(marvel|dc|image|cgc|cbcs|pgx|psa)\b/gi, '');
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

  // Find consensus for each field
  const titleResult = getMostCommon(mainTitles);
  const issueResult = getMostCommon(issues);
  const yearResult = getMostCommon(years);

  // Require ≥50% agreement for each field
  const titleOk = titleResult.count / total >= 0.5;
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
    { re: /\bboom\b/i, name: 'Boom' },
    { re: /\bvaliant\b/i, name: 'Valiant' },
    { re: /\bdynamite\b/i, name: 'Dynamite' },
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
