// Comic comp hygiene primitives — shared regex + helper set used by both
// active-comp filtering (api/comps.js) and sold-comp verification
// (src/lib/soldVerification.js). Pure functions, no I/O.
//
// Location note (per Ship #15 architectural learning): this module has no
// HTTP handler so it lives in src/lib/, not api/. api/comps.js and
// api/enrich.js import via `../src/lib/compHygiene.js`. Vercel bundles
// transitively-imported files into each function bundle — no new function
// endpoint added.
//
// Extracted Ship #20a.6 from api/comps.js. Behavior preserved exactly from
// the originals in the same commit; detectSeriesMarkers extended with
// annual-N / special-N / king-size-N / giant-size-N for sold-comp
// format-asymmetry filtering. ARTIST_PATTERNS extended with jeehyung lee /
// alex ross / kaare andrews / fabok for sold-comp variant-artist match.

// ────────────────────────────── REGEXES ──────────────────────────────

// Reprint / facsimile / Nth-print / anniversary edition / Marvel
// Milestones / DC Classics Library / etc. F3 extension entries from Tier-0:
// Millennium Edition, Masterworks, reproduction, replica edition, premiere
// edition, archive edition.
export const REPRINT_RE = /true believers|reprint|facsimile|replica|anniversary edition|2nd\s*p(?:rint|tg)|3rd\s*p(?:rint|tg)|4th\s*p(?:rint|tg)|5th\s*p(?:rint|tg)|second\s*print|third\s*print|fourth\s*print|\bptg\b|millennium edition|dc classics library|marvel milestones|masterworks|reproduction|replica edition|premiere edition|archive edition/i;

// Slab/grading-organization detection. Requires explicit slab indicator
// (CGC/CBCS/PGX/PSA/EGS/HGA/etc) followed by an optional letter tier and
// numeric grade. Bare "9.4" in a raw seller's self-grade does NOT match.
// Middle (?:ss|signature\s+series|...) catches "CGC SS 9.8" / "CBCS SS 7.0".
export const SLAB_RE = /\b(?:cgc|cbcs|pgx|psa|egs|hga|slab|graded|universal|signature\s+series|verified|qualified)\s*(?:ss|signature\s+series|mt|nm\/mt|nm\+|nm-|nm|vf\/nm|vf\+|vf-|vf|fn\/vf|fn\+|fn-|fn|vg\/fn|vg\+|vg-|vg|gd\/vg|gd\+|gd-|gd|fr\/gd|fr|pr)?\s*\d+(?:\.\d+)?/i;

// Graded-only requirement — title MUST mention CGC or CBCS.
export const GRADED_RE = /\bCGC\b|\bCBCS\b/i;

// Variant contamination markers — variant/virgin/foil/ratio/incentive/etc.
// Hard-reject when our book is NOT a variant. Used both as standalone
// filter and as a guard inside creator/artist match.
export const VARIANT_CONTAM_RE = /\bvariant\b|\bvirgin\b|\bfoil\b|\bratio\b|\b1:\d+\b|\bincentive\b|\bnewsstand\b|\bwhitman\b|\bprice\s+variant\b|\btype\s+1|\bexclusive\b|\bsketch\b|\bexcl\.?\b/i;

// Signed / SS / yellow-label / green-label / remarked / autographed.
// Skips bare "SS" (false-positive risk: SS-Squadron, Steel & Soul).
// Multi-word "signature series" catches CGC SS slabs. Blue label omitted
// (= Universal/standard, not signed).
export const SIGNED_RE = /\b(?:signed|signature\s+series|autographed?|yellow\s*label|green\s*label|remarked?)\b/i;

// TPB / collected-edition format markers.
export const TPB_MARKER_RE =
  /\b(?:tpb|trade\s*paperback|hardcover|hc|omnibus|compendium|deluxe(?:\s*edition)?|absolute(?:\s*edition)?|treasury(?:\s*edition)?|collected\s*edition|graphic\s*novel|gn)\b/i;

// Other-cover-letter detector. When our book is Cover A (or has no cover
// letter), this matches Cover B/C/D/E... in listing titles for hard reject.
export const OTHER_COVER_RE = /\bcover\s*[b-z]\b|\bcvr\s*[b-z]\b/i;

// Lot / set / bundle / multi-book markers. Excludes bare issue-number
// ranges (e.g. "#1-5") which are validated separately by isValidIssueRange
// to avoid false positives on year ranges ("1961-10 Cents") or grade
// fractions in titles ("9.5/10").
export const LOT_RE =
  /\b(?:lot|bundle|complete\s*set|full\s*run|comic\s*library|comic\s*collection)\b|\bset\s*of\s*\d+\b|\b\d+\s*(?:book|issue|comic)s?\s*(?:lot|set)\b/i;

// Half-issue / ashcan / promo markers. Tightened: `#` prefix REQUIRED on
// the `#N/M` and `#N.M` alternations — otherwise grade strings like "9.4"
// or date strings like "9/2026" would falsely match.
export const HALF_ISSUE_RE =
  /#\s*\d+\s*\/\s*\d+\b|#\s*\d+\.\d+\b|\b½\b|\bhalf[-\s]*issue\b|\b1\/2\s*issue\b|\bashcan\b|\bpromo(?:tional)?\b/i;

// Cover artist patterns — used both for active-comp creator filter
// (api/comps.js Filter 3b) and sold-row variant-artist matching
// (Ship #20a.6 soldVerification). Multi-word patterns FIRST so first-
// match-wins via break captures the longer name before generic single-
// word fallbacks (e.g. /jim lee/ wins over /lee/).
//
// Ship #20a.6 added 4 patterns at the END (after the original 36) so
// first-match-wins ordering is preserved for all original entries:
// jeehyung lee, alex ross, kaare andrews (multi-word, but appended
// after the original multi-word block — they only fire when no original
// pattern matches), fabok (single-word). Active-comp callers will pick
// these up when scanning cover-credit variant strings; the same array
// drives sold-comp variant-artist mismatch detection.
export const ARTIST_PATTERNS = [
  // Multi-word patterns — longest-first wins via break in callers, so
  // multi-word entries MUST come before single-word fallbacks (e.g.
  // /alex ross/ before /ross/, /jeehyung lee/ before /lee/).
  // Original 8 multi-word + Ship #20a.6 added /jeehyung lee/, /alex ross/,
  // /kaare andrews/.
  /tyler kirkham/i, /jim lee/i, /inhyuk lee/i, /skottie young/i,
  /frank cho/i, /frank miller/i, /windsor.?smith/i, /dell'?otto/i,
  /jeehyung lee/i, /alex ross/i, /kaare andrews/i,
  // Single-word — original 28 + Ship #20a.6 /fabok/.
  /skan/i, /rapoza/i, /quash/i, /momoko/i, /ross/i, /adams/i,
  /kirkham/i, /bean/i, /andolfo/i, /browne/i, /forstner/i,
  /howard/i, /corona/i, /stegman/i, /ottley/i,
  /jimenez/i, /mcfarlane/i, /campbell/i, /artgerm/i, /nakayama/i,
  /hughes/i, /byrne/i, /perez/i, /kirby/i, /ditko/i, /mele/i,
  /albuquerque/i, /hama/i, /fabok/i,
];

// ───────────────────────── TOKEN-BASED HELPERS ─────────────────────────

// Stop-words excluded from title-similarity tokens. These appear so
// commonly across comic listings (publisher names, format words, common
// English particles) that matching on them produces noise. Stay in the
// eBay search query — only similarity-match step ignores them.
export const STOP_WORDS = new Set([
  'the', 'a', 'an', 'of', 'and', 'or',
  'in', 'on', 'at', 'to', 'for', 'with',
  'comic', 'comics', 'comicbook', 'issue', 'volume', 'vol',
  'marvel', 'dc', 'image', 'dark', 'horse', 'idw',
]);
export const MIN_TOKEN_LEN = 2;

// Tokenize a title for similarity matching. Lowercases, strips the issue#
// hash, splits on non-alphanumerics, drops stop-words and pure-digit
// tokens (years, raw numbers carry no series-name signal).
export const tokenizeTitle = (title) => {
  const words = String(title || "")
    .toLowerCase()
    .replace(/#\s*\d+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((w) =>
      w.length >= MIN_TOKEN_LEN &&
      !STOP_WORDS.has(w) &&
      !/^\d+$/.test(w)
    );
  return words;
};

// Require ≥50% of our non-stop-word tokens to appear in the listing's
// non-stop-word tokens. When all our tokens are stop-words, returns true
// (no signal to gate on — let other filters handle it).
export const hasSufficientTitleOverlap = (listingTitle, searchTokens) => {
  if (!searchTokens || searchTokens.length === 0) return true;
  const listingSet = new Set(tokenizeTitle(listingTitle));
  if (listingSet.size === 0) return false;
  let matches = 0;
  for (const t of searchTokens) {
    if (listingSet.has(t)) matches++;
  }
  return matches / searchTokens.length >= 0.5;
};

// ──────────────────────────── GRADE PARSING ────────────────────────────

// Parse a numeric grade from a listing title. Recognizes CGC X.X slab
// grades and raw letter grades (NM, VF+, GD-, etc). Returns null when no
// grade is detectable — caller should keep those listings (can't prove
// mismatch).
export const parseListingGrade = (title) => {
  const t = String(title || '');
  const cgc = t.match(/CGC\s*([\d.]+)/i);
  if (cgc) return parseFloat(cgc[1]);
  const gradeMap = [
    ['nm/mt', 9.8], ['nm+', 9.6], ['nm-', 9.2],
    ['nm', 9.4], ['vf/nm', 9.0], ['vf+', 8.5],
    ['vf-', 7.5], ['vf', 8.0], ['fn/vf', 7.0],
    ['fn+', 6.5], ['fn-', 5.5], ['fn', 6.0],
    ['vg/fn', 5.0], ['vg+', 4.5], ['vg-', 3.5],
    ['vg', 4.0], ['gd/vg', 3.0], ['gd+', 2.5],
    ['gd-', 1.8], ['gd', 2.0], ['fr/gd', 1.5],
    ['fr', 1.0], ['pr', 0.5]
  ];
  for (const [abbr, val] of gradeMap) {
    const re = new RegExp(
      '(?:^|[\\s#(])' +
      abbr.replace('/', '\\/') +
      '(?:[\\s)$]|\\d)', 'i');
    if (re.test(t)) return val;
  }
  return null;
};

// ─────────────────────── PRICE / OUTLIER HELPERS ───────────────────────

// Drop price outliers: above 3× median or below 25% of median. Requires
// at least 3 items to be meaningful — below that, returns input unchanged.
// Items shape: array of { price: number, ... }.
export const applyPriceSanity = (items) => {
  if (!Array.isArray(items) || items.length < 3) return items;
  const sorted = items.map((p) => p.price).slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  if (!median || median <= 0) return items;
  const lo = median * 0.25;
  const hi = median * 3;
  return items.filter((p) => p.price >= lo && p.price <= hi);
};

// ──────────────────────── ISSUE NUMBER HELPERS ─────────────────────────

// Extract issue number from a title like "Comic Reader #171" → "171".
export const extractIssueNumber = (title) => {
  const m = String(title || "").match(/#\s*(\d+)/);
  return m ? m[1] : null;
};

// Listing must contain the issue number as "#N" with a word boundary
// after (so "#1710" and "#21" don't match "#1"). Also rejects lot
// listings with commas-between-digits, "lot" keyword, or multiple
// distinct #N patterns (multi-issue compound listings like
// "#1 + #4 variant set").
export const hasIssueNumber = (listingTitle, issueNum) => {
  if (!issueNum) return true;
  const t = String(listingTitle || "");
  if (/\blot\b/i.test(t) || /\d+\s*,\s*\d+/.test(t)) return false;
  const escaped = String(issueNum).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!new RegExp(`#\\s*${escaped}\\b`, "i").test(t)) return false;
  return !hasMultipleDistinctIssues(t);
};

// Helper: count distinct #N patterns in a title. Returns true when ≥2
// different issue numbers are present.
export const hasMultipleDistinctIssues = (listingTitle) => {
  const distinct = new Set();
  for (const m of String(listingTitle || "").matchAll(/#\s*(\d+)\b/gi)) {
    distinct.add(m[1]);
    if (distinct.size > 1) return true;
  }
  return false;
};

// Issue range validator — returns true for ascending whole-number ranges
// like "#1-5" or "#100-150"; false for years, decimal grades, descending
// pairs, or pairs spanning >=1000 (likely year/issue mix).
export const isValidIssueRange = (title) => {
  const re = /#?(\d+(?:\.\d+)?)\s*[-–—]\s*#?(\d+(?:\.\d+)?)/g;
  for (const m of title.matchAll(re)) {
    const firstStr = m[1];
    const secondStr = m[2];
    const first = parseFloat(firstStr);
    const second = parseFloat(secondStr);
    if (second >= 1800 && second <= 2050) continue; // year
    if (second <= 10 && secondStr.includes('.')) continue; // grade
    if (first >= second) continue; // not ascending
    if (
      Number.isInteger(first) &&
      Number.isInteger(second) &&
      second < 1000
    ) {
      return true;
    }
  }
  return false;
};

// ──────────────────────── SERIES / FORMAT MARKERS ──────────────────────

// Detect series-extension markers in a title — Roman numerals II-X, Vol
// or Volume N, Re-/Pre- prefix words, Part N, Book N. Ship #20a.6
// extended with annual-N, special-N, king-size-N, giant-size-N for
// sold-comp format-asymmetry filtering. Returns an array of normalized
// marker strings.
//
// Used by both Ship #13 sequel-asymmetry filter (active comps,
// api/comps.js) and Ship #20a.6 sold-comp format check. Rejection logic
// in callers: "listing has marker our title lacks → reject", with
// graceful wipe-out fallback so a too-strict filter doesn't kill thin
// sold pools.
//
// `?` placeholder: when format word appears without a number (e.g.
// "Annual" alone, "King-Size Special" alone), the marker becomes
// `annual-?` so callers can still detect the format presence even when
// no specific issue number is given.
export const detectSeriesMarkers = (title) => {
  const t = String(title || '');
  const markers = [];
  // Roman numerals II-X — `(?<![\w-])` and `(?![\w-])` exclude
  // hyphenated adjacency (X-Men / V-Wars don't false-positive).
  for (const m of t.matchAll(/(?<![\w-])(III|II|IV|VI{0,3}|IX|X)(?![\w-])/g)) {
    markers.push(`roman-${m[1].toLowerCase()}`);
  }
  // Vol / Volume N
  const volMatch = t.match(/\bVol(?:\.|ume)?\s*(\d+)\b/i);
  if (volMatch) markers.push(`vol-${volMatch[1]}`);
  // Re- / Pre- prefix followed by a capitalized word
  const reMatch = t.match(/\b(Re|Pre)[-\s]([A-Z][a-z]+)\b/);
  if (reMatch) markers.push(`${reMatch[1].toLowerCase()}-${reMatch[2].toLowerCase()}`);
  // Part N
  const partMatch = t.match(/\bPart\s+(\d+)\b/i);
  if (partMatch) markers.push(`part-${partMatch[1]}`);
  // Book N
  const bookMatch = t.match(/\bBook\s+(\d+)\b/i);
  if (bookMatch) markers.push(`book-${bookMatch[1]}`);
  // Ship #20a.6 — issue-format markers (Annual / Special / King-Size /
  // Giant-Size). Annual #N → annual-N; bare Annual → annual-?. Same
  // pattern for the others. King-Size Special is detected as BOTH
  // 'king-size-N' AND 'special-N' (two markers from one title).
  const annualMatch = t.match(/\bAnnual\s*#?\s*(\d+)?\b/i);
  if (annualMatch) markers.push(`annual-${annualMatch[1] || '?'}`);
  const specialMatch = t.match(/\bSpecial\s*#?\s*(\d+)?\b/i);
  if (specialMatch) markers.push(`special-${specialMatch[1] || '?'}`);
  const kingMatch = t.match(/\bKing[-\s]?Size\s*(?:Special)?\s*#?\s*(\d+)?\b/i);
  if (kingMatch) markers.push(`king-size-${kingMatch[1] || '?'}`);
  const giantMatch = t.match(/\bGiant[-\s]?Size\s*#?\s*(\d+)?\b/i);
  if (giantMatch) markers.push(`giant-size-${giantMatch[1] || '?'}`);
  return markers;
};

// Extract a known artist name from a variant string. Returns the matched
// artist (lowercased) or null. First-match-wins via break — multi-word
// patterns listed first in ARTIST_PATTERNS so longer names capture before
// generic single-word fallbacks.
export const extractArtist = (variantOrTitle) => {
  if (!variantOrTitle) return null;
  const s = String(variantOrTitle);
  for (const pattern of ARTIST_PATTERNS) {
    const m = s.match(pattern);
    if (m) return m[0].toLowerCase();
  }
  return null;
};

// ───────────────────────────── PUBLISHER ───────────────────────────────

// Normalize a publisher string for search queries. Brackets/quotes/
// slashes/ampersands/question marks break eBay's query parser or
// truncate the match, so they're replaced with spaces and collapsed.
// Preserves all word tokens — "Hollywood Comics (Walt Disney)" →
// "Hollywood Comics Walt Disney".
export const cleanPublisher = (p) => {
  if (!p) return "";
  return String(p)
    .replace(/[()[\]{}"'\/\\&?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};
