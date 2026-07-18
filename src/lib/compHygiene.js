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
//
// Ship #22f: Artist/publisher/signature strip extracted to titleHygiene.js
// (single normalize helper for all identity layers).

import { stripMetadataTokens, stripArtistWords } from './titleHygiene.js';

// ────────────────────────────── REGEXES ──────────────────────────────

// Reprint / facsimile / Nth-print / anniversary edition / Marvel
// Milestones / DC Classics Library / etc. F3 extension entries from Tier-0:
// Millennium Edition, Masterworks, reproduction, replica edition, premiere
// edition, archive edition.
// Ship #20a.6.12 — subscription box / promotional edition extensions (12
// patterns): loot crate, funko, previews exclusive, comic block, nerd block,
// geek fuel, box set, collector's box, subscription box, promotional edition,
// convention exclusive, con exclusive. Closes B&B #28 Loot Crate class.
export const REPRINT_RE = /true believers|reprint|facsimile|replica|anniversary edition|2nd\s*p(?:rint|tg)|3rd\s*p(?:rint|tg)|4th\s*p(?:rint|tg)|5th\s*p(?:rint|tg)|second\s*print|third\s*print|fourth\s*print|\bptg\b|millennium edition|dc classics library|marvel milestones|masterworks|reproduction|replica edition|premiere edition|archive edition|loot.?crate|\bfunko\b|previews\s+exclusive|comic\s+block|nerd\s+block|geek\s+fuel|box\s+set|collector'?s?\s+box|subscription\s+box|promotional\s+edition|convention\s+exclusive|con\s+exclusive|^sealed\b/i;

// Slab/grading-organization detection. Requires explicit slab indicator
// (CGC/CBCS/PGX/PSA/EGS/HGA/etc) followed by an optional letter tier and
// numeric grade. Bare "9.4" in a raw seller's self-grade does NOT match.
// Middle (?:ss|signature\s+series|...) catches "CGC SS 9.8" / "CBCS SS 7.0".
// Ship #20a.6.11 — extended to catch CGC-NG / CBCS-NG / no-grade slabs.
export const SLAB_RE = /\b(?:cgc|cbcs|pgx|psa|egs|hga|slab|graded|universal|signature\s+series|verified|qualified)\s*(?:ss|signature\s+series|mt|nm\/mt|nm\+|nm-|nm|vf\/nm|vf\+|vf-|vf|fn\/vf|fn\+|fn-|fn|vg\/fn|vg\+|vg-|vg|gd\/vg|gd\+|gd-|gd|fr\/gd|fr|pr)?\s*(?:\d+(?:\.\d+)?|(?:-\s*)?(?:ng|no\s*grade))/i;

// Graded-only requirement — title MUST mention CGC or CBCS.
export const GRADED_RE = /\bCGC\b|\bCBCS\b/i;

// Variant contamination markers — variant/virgin/foil/ratio/incentive/etc.
// Hard-reject when our book is NOT a variant. Used both as standalone
// filter and as a guard inside creator/artist match.
export const VARIANT_CONTAM_RE = /\bvariant\b|\bvirgin\b|\bfoil\b|\bratio\b|\b1:\d+\b|\bincentive\b|\bnewsstand\b|\bwhitman\b|\bprice\s+variant\b|\btype\s+1|\bexclusive\b|\bsketch\b|\bexcl\.?\b/i;

// Signed / SS / yellow-label / green-label / remarked / autographed.
// Skips bare "SS" (false-positive risk: SS-Squadron, Steel & Soul).
// Multi-word "signature series" catches CGC SS slabs. Blue label omitted
// (= Universal/standard, not signed). COA = Certificate of Authenticity.
export const SIGNED_RE = /\b(?:signed|signature\s+series|autographed?|yellow\s*label|green\s*label|remarked?|COA)\b/i;

// TPB / collected-edition format markers.
export const TPB_MARKER_RE =
  /\b(?:tpb|trade\s*paperback|hardcover|hc|omnibus|compendium|deluxe(?:\s*edition)?|absolute(?:\s*edition)?|treasury(?:\s*edition)?|collected\s*edition|graphic\s*novel|gn)\b/i;

// 2026-07-18 (Uncanny X-Men #27 / Ultimate X-Men #1 Momoko class) — stricter
// sibling of TPB_MARKER_RE for use BEFORE a title is known (identity
// determination), not after (comp-pricing pool). TPB_MARKER_RE's "absolute"/
// "deluxe"/"treasury" are deliberately bare-word-optional-suffix so a
// confirmed book's pricing pool catches "Batman Absolute Edition" reprints —
// safe there because the title is already resolved. Applied to an
// UNRESOLVED identity pool, that same looseness collides with real ongoing
// single-issue titles ("Absolute Batman", DC's 2024+ line) and would filter
// out every genuine comp for that book. Requires the edition suffix on all
// three ambiguous terms; tpb/trade paperback/hardcover/hc/omnibus/compendium/
// collected edition/graphic novel/gn have no such collision risk and are
// unchanged.
export const IDENTITY_TPB_MARKER_RE =
  /\b(?:tpb|trade\s*paperback|hardcover|hc|omnibus|compendium|deluxe\s*edition|absolute\s*edition|treasury\s*edition|collected\s*edition|graphic\s*novel|gn)\b/i;

// Premium-variant isolation markers (2026-07-18, Magik #1 / Silk #1 class) —
// convention-exclusive, retailer-exclusive, virgin, and numbered/limited
// print runs are a distinct, often significantly more valuable market
// segment than a generic variant cover. Used by comps.js Filter 1c to
// isolate a thin matching pool rather than blending it with generic
// variant comps (the app already handles thin pools gracefully elsewhere —
// Ship #13.1 thin-pool anchor — so isolating is preferred over blending).
export const PREMIUM_VARIANT_RE =
  /\b(nycc|sdcc|c2e2|megacon|fan\s*expo|eccc|wondercon|emerald\s*city|exclusive|virgin|limited|numbered|ltd)\b/i;

// Other-cover-letter detector. When our book is Cover A (or has no cover
// letter), this matches Cover B/C/D/E... in listing titles for hard reject.
export const OTHER_COVER_RE = /\bcover\s*[b-z]\b|\bcvr\s*[b-z]\b/i;

// Q108 CHANGE 3 — named non-letter variant descriptors. OTHER_COVER_RE only
// catches LETTERED covers (Cover B/C/D); many modern variants (card stock,
// foil, sketch, virgin, trade dress, or a named artist's card-stock cover)
// carry no letter at all and slip straight through it (Wonder Woman #75 /
// Flash #75 class: Frison/Manapul card-stock listings priced against a
// Cover A scan). Applied the same way as OTHER_COVER_RE — hard reject when
// our own confirmedVariant is null/Cover-A/1st-print.
//
// STOPGAP, not a permanent design: artist names ("frison") can't live in a
// static regex forever — new named variants ship every week. Extend this
// list as new patterns emerge in production (see CLAUDE.md); the long-term
// fix is a variant-type classifier, not a name list.
export const OTHER_VARIANT_DESCRIPTOR_RE =
  /\bcard\s*stock\b|\bcardstock\b|\bfrison\b|\bfoil\s*cover\b|\bsketch\s*cover\b|\bvirgin\s*cover\b|\btrade\s*dress\b|\bblank\s*cover\b/i;

// GL-4 (EX-1b) — Merchandise hard filter. eBay Browse returns non-comic
// items ("ACTION COMICS #33 COVER PRINT", "Metal Tin Sign") that pass
// title-overlap (publisher words are stop-words) and issue-number checks —
// two merch actives averaging $18.23 capped a 10-sold tier-2.5 price at
// $24.62 (vfjpp-1783797090560). Explicit phrases where a bare word would
// collide with comic vocabulary: "art/cover print" (never bare \bprint\b —
// collides with 1st/2nd print).
//
// Q89 (2026-07-12): short merch tokens with compound comic-vocabulary
// collisions get context guards. \bpin\b's (?!-?up) lookahead missed the
// SPACE-separated forms — "pin up cover"/"pin ups" matched and rejected
// 4 real Evil Ernie #1 comps (pool starved → tier-4 $234.49 on an $8
// book). Audit of the same class: "mug" collides with "mug shot" covers;
// "sticker" collides with defect descriptions ("price sticker", "sticker
// residue"). "patch" is a homonym (Wolverine alias), not a compound —
// no adjacent-word guard can separate it; residual risk stands per the
// 2026-07-11 ruling.
export const MERCH_RE =
  /\b(?:art\s+print|cover\s+print|poster|tin\s+sign|metal\s+sign|plaque|magnet|statue|figur(?:e|ine)s?|funko|t-?shirts?|canvas|postcard|lithograph|keychain|patch|bookmark)\b|\bmugs?\b(?!\s*shot)|(?<!price\s)\bstickers?\b(?!\s*(?:residue|damage))|\bpins?\b(?!\s*-?\s*ups?\b)/i;

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

// Coverless / incomplete / no-cover markers. Ship #20a.6.11 — Sensation #1
// Crowley 9.4 case where "Sensation Comics #11 CGC-NG COVERLESS" passed all
// filters and poisoned the floor. Hard-reject unless our book is also
// coverless (which it never is in the standard grading flow).
export const COVERLESS_RE =
  /\b(?:coverless|no\s*cover|cover\s*missing|incomplete|damaged\s*cover)\b/i;

// Trading card / non-comic format markers. Ship #20a.6.13 — Avengers #20
// (2025) sold pool contaminated by "Marvel Fleer Ultra Avengers 2022 Base
// Card #20 Elektra" trading card sales. PriceCharting API includes
// `&type=comic` parameter but still returns trading card products for some
// queries. Downstream filter required. Closes Avengers #20 trading-card class.
// Extended to include Impel, Marvel Universe, Series I/II/III, Score, Leaf, etc.
export const TRADING_CARD_RE =
  /\b(?:fleer|upper\s*deck|topps|panini|skybox|impel|score|leaf|pro\s*set|press\s*pass|stadium\s*club|finest|chrome|marvel\s*universe|base\s*card|trading\s*card|insert\s*card|parallel|chase\s*card|series\s*[ivx]+|card\s*#\d+)\b/i;

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
//
// Ship #20a.6.18 added 9 patterns: mico suayan (Crow Dead Time class),
// puppeteer lee, derrick chew, jonboy meyers, kael ngu, natali sanders,
// kendrick lim, lucio parrillo (multi-word); ejikure (single-word).
export const ARTIST_PATTERNS = [
  // Multi-word patterns — longest-first wins via break in callers, so
  // multi-word entries MUST come before single-word fallbacks (e.g.
  // /alex ross/ before /ross/, /jeehyung lee/ before /lee/).
  // Original 8 multi-word + Ship #20a.6 added /jeehyung lee/, /alex ross/,
  // /kaare andrews/. Ship #20a.6.7c added /alan quah/.
  // Ship #20a.6.18 added 8 multi-word below.
  /tyler kirkham/i, /jim lee/i, /inhyuk lee/i, /skottie young/i,
  /frank cho/i, /frank miller/i, /windsor.?smith/i, /dell'?otto/i,
  /jeehyung lee/i, /alex ross/i, /kaare andrews/i, /alan quah/i,
  /mico suayan/i, /puppeteer lee/i, /derrick chew/i, /jonboy meyers/i,
  /kael ngu/i, /natali sanders/i, /kendrick lim/i, /lucio parrillo/i,
  /jenny frison/i,  // Q84 — WW #75 cover artist (unambiguous, alias policy)
  // Single-word — original 28 + Ship #20a.6 /fabok/ + Ship #20a.6.18 /ejikure/ + Ship #20a.6.21 modern variant artists.
  /skan/i, /rapoza/i, /quash/i, /momoko/i, /ross/i, /adams/i,
  /kirkham/i, /bean/i, /andolfo/i, /browne/i, /forstner/i,
  /howard/i, /corona/i, /stegman/i, /ottley/i,
  /jimenez/i, /mcfarlane/i, /campbell/i, /artgerm/i, /nakayama/i,
  /hughes/i, /byrne/i, /perez/i, /kirby/i, /ditko/i, /mele/i,
  /albuquerque/i, /hama/i, /fabok/i, /ejikure/i,
  /gleason/i, /quah/i, /parrillo/i, /maer/i, /lim/i, /chew/i, /ngu/i, /sanders/i,
  /frison/i,  // Q84 — unambiguous last name (alias policy)
];

// Q89-CACHE — Comp-filter version. Bump whenever a comp-admission filter
// (MERCH_RE, LOT_RE, SLAB_RE, …) changes behavior: cached ACTIVE pools are
// FILTERED results, and a fix must not replay pools built by the old
// regex (Evil Ernie #1: pre-Q89 MERCH_RE rejected 4 real comps; the
// starved pool sat in ac:/book-record caches). Salts the ac: KV key and
// gates the book-record cache in api/enrich.js.
// v2 = Q89 MERCH_RE pin/mug/sticker guards (2026-07-12).
export const COMP_FILTER_VERSION = 2;

// Q85 — Compact title key: lowercase, strip everything non-alphanumeric.
// Equality fallback for compound/spacing/hyphen variants that token-level
// matching can never reconcile ("Funnybook" vs "Funny Book" vs
// "Funny-Book" all → "funnybook"). Used by title-family overlap and PC
// product matching.
export const compactTitleKey = (s) =>
  String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

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

// Q54: Compound whitelist + single-letter guard. Certain hyphenated titles
// (X-Men, Marvel Tales/Age/Premiere/Team-Up/Two-in-One/Spotlight/Feature/Fanfare,
// TaleSpin, Walt Disney) reduce to single-letter or stop-word tokens after
// normalization. Preserve them as canonical forms BEFORE tokenization splits.
// X-Men #44 class: "x-men" → ["x", "men"] → "x" stripped by MIN_TOKEN_LEN=2
// → ["men"] → cross-series contamination (Men of War, X-Men Adventures).
export const COMPOUND_WHITELIST = new Set([
  'x-men', 'x-force', 'x-factor',  // single-letter lead
  'marvel tales', 'marvel age', 'marvel premiere', 'marvel team-up',
  'marvel two-in-one', 'marvel spotlight', 'marvel feature', 'marvel fanfare',
  'talespin', 'walt disney',  // thin-token titles
]);

// Q42 C-A3: Abbreviation expansion map (single source of truth).
// Applied BEFORE tokenization in comp verification path (compHygiene →
// soldVerification issueMismatch) AND conflict detection (conflictDetector).
//
// TMNT failure: Vision "Teenage Mutant Ninja Turtles Adventures" vs comps
// "TMNT Adventures #4" → tokens ["teenage", "mutant", "ninja", "turtles"]
// vs ["tmnt"] → 0% overlap → 0/30 kept (100% issueMismatch rejection).
export const ABBREV_MAP = {
  'tmnt': 'teenage mutant ninja turtles',
  'asm': 'amazing spider man',
  'ff': 'fantastic four',
  'jla': 'justice league',
  'mwom': 'mighty world of marvel',
  'gsx': 'giant size x men',
  'dd': 'daredevil',
  'xm': 'x men',
};

// Tokenize a title for similarity matching. Lowercases, strips the issue#
// hash, splits on non-alphanumerics, drops stop-words and pure-digit
// tokens (years, raw numbers carry no series-name signal).
// Q22 FIX — Normalize hyphens before tokenization to match "Spider-Man" vs "Spiderman"
// Q42 C-A3 — Expand abbreviations BEFORE tokenization (TMNT → teenage mutant ninja turtles)
export const tokenizeTitle = (title) => {
  let normalized = String(title || "").toLowerCase();

  // Q54: Compound whitelist check FIRST (before abbreviation expansion).
  // When title matches a protected compound (prefix or exact), return the
  // canonical split form to preserve single-letter tokens.
  // X-Men #44 → ["x", "men"], The X-Men #44 Angel → ["x", "men"] (trailing stripped).
  let bareTitle = normalized
    .replace(/#\s*\d+/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Q54-FIX: Strip leading articles (the/a/an) before whitelist check.
  // "The X-Men" → "x-men" to match whitelist entry.
  bareTitle = bareTitle.replace(/^(?:the|a|an)\s+/i, '');

  // Q54-FIX: Prefix matching instead of exact match. "x-men angel red raven"
  // starts with "x-men " → match. Protects compound, allows trailing strip.
  const hit = Array.from(COMPOUND_WHITELIST).find(entry =>
    bareTitle === entry || bareTitle.startsWith(entry + ' ')
  );

  if (hit) {
    // Return canonical split of MATCHED compound only (trailing words stripped)
    const tokens = hit.replace(/-/g, " ").split(/\s+/).filter(Boolean);
    console.log(`[Q54] compound-protected="${hit}" → [${tokens.join(', ')}]`);
    return tokens;
  }

  // C-A3: Expand abbreviations (word-boundary anchored)
  for (const [abbrev, expanded] of Object.entries(ABBREV_MAP)) {
    const pattern = new RegExp(`\\b${abbrev}\\b`, 'gi');
    normalized = normalized.replace(pattern, expanded);
  }

  // Ship #22f: String-level metadata strip BEFORE tokenization
  // (publishers, artist bigrams, signatures, ordinals). Extracted to
  // titleHygiene.js for use across all identity layers.
  // Q55+55-B+Q55-C+Q55-D: Strip artist/signature/ordinal-key tokens BEFORE tokenization
  // to prevent "Amazing Spider-Man #1 Signed McFarlane" → family=["mcfarlane"]
  // matching "Spawn #1 McFarlane" (different series). E4/E5 class protection.
  const beforeStrip = normalized;
  normalized = stripMetadataTokens(normalized);
  console.log(`[22f] metadata-stripped: "${beforeStrip}" → "${normalized}"`);

  // Q55-C: Full sync with ARTIST_PATTERNS single-word entries (lines 117-123).
  // Extracts single-word last names from both multi-word patterns (kirkham from
  // /tyler kirkham/, lee from /jim lee/, etc.) AND single-word patterns.
  // COMPLETE LIST — 60+ artists from ARTIST_PATTERNS regex catalog.
  const artistWords = new Set([
    // From single-word patterns (lines 117-123)
    'skan', 'rapoza', 'quash', 'momoko', 'ross', 'adams',
    'kirkham', 'bean', 'andolfo', 'browne', 'forstner',
    'howard', 'corona', 'stegman', 'ottley',
    'jimenez', 'mcfarlane', 'campbell', 'artgerm', 'nakayama',
    'hughes', 'byrne', 'perez', 'kirby', 'ditko', 'mele',
    'albuquerque', 'hama', 'fabok', 'ejikure',
    'gleason', 'quah', 'parrillo', 'maer', 'lim', 'chew', 'ngu', 'sanders',
    // From multi-word patterns (lines 111-115) — extract last-name tokens
    // /tyler kirkham/ → kirkham (already above), /jim lee/ → lee,
    // /inhyuk lee/ → lee, /skottie young/ → young, /frank cho/ → cho,
    // /frank miller/ → miller, /windsor.?smith/ → smith, /dell'?otto/ → otto/dekal,
    // /jeehyung lee/ → lee, /alex ross/ → ross (already above),
    // /kaare andrews/ → andrews, /alan quah/ → quah (already above),
    // /mico suayan/ → suayan, /puppeteer lee/ → lee, /derrick chew/ → chew (already above),
    // /jonboy meyers/ → meyers, /kael ngu/ → ngu (already above),
    // /natali sanders/ → sanders (already above), /kendrick lim/ → lim (already above),
    // /lucio parrillo/ → parrillo (already above)
    'lee', 'young', 'cho', 'miller', 'smith', 'otto', 'dekal', 'andrews',
    'suayan', 'meyers', 'spears',  // Q55-C: add missing 'dekal', 'spears'
  ]);
  // Signature markers: signed, sig, auto, autographed (do NOT strip "ss" —
  // false positive risk: "Secret Six", "Space Squadron", etc.)
  const signatureWords = new Set(['signed', 'sig', 'auto', 'autographed']);
  // Ordinal-key phrases: 1st, 2nd, first, second, appearance, origin, key, intro
  const ordinalKeyWords = new Set([
    '1st', '2nd', '3rd', 'first', 'second', 'third',
    'appearance', 'origin', 'key', 'intro', 'debut',
  ]);
  const stripSet = new Set([...artistWords, ...signatureWords, ...ordinalKeyWords]);

  const words = normalized
    // FIX-2 (jrcrp-17838110): hyphen family → SPACE on both sides, replacing
    // Q22's strip-to-join. Enrich passes pre-normalized titles ("Giant Size
    // X Men" → [giant,size,men]) while comp rows tokenized raw hyphens
    // ("Giant-Size X-Men" → [giantsize,xmen]) → overlap 0.00, 17 sold rows
    // rejected on-grade. Space-split makes both forms canonical. The Q22
    // compact-form case ("Spiderman") is preserved by the bigram-join check
    // in hasSufficientTitleOverlap below. Covers -, ‐, ‑, ‒, –, —, ―.
    .replace(/[-‐-―]/g, " ")
    .replace(/#\s*\d+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((w) =>
      w.length >= MIN_TOKEN_LEN &&
      !STOP_WORDS.has(w) &&
      !/^\d+$/.test(w) &&
      !stripSet.has(w)  // Q55+55-B: strip artist/signature/ordinal tokens
    );
  return words;
};

// Require ≥50% of our non-stop-word tokens to appear in the listing's
// non-stop-word tokens. When all our tokens are stop-words, returns true
// (no signal to gate on — let other filters handle it).
//
// Q31 Part 1: Adaptive threshold — when our title reduces to ≤2 tokens
// (e.g., "Groo in the Wild" → ["groo", "wild"]), require ≥75% overlap
// to prevent cross-series contamination (MWOM/Mighty Samson, Groo/Groo:
// The Prophecy class bugs). Thin titles have higher false-positive risk.
export const hasSufficientTitleOverlap = (listingTitle, searchTokens, threshold = 0.5) => {
  if (!searchTokens || searchTokens.length === 0) return true;
  const listingArr = tokenizeTitle(listingTitle);
  const listingSet = new Set(listingArr);
  if (listingSet.size === 0) return false;

  // FIX-2: bigram-join set — with hyphens now splitting to spaces, compact
  // seller spellings ("Spiderman") must still match split forms ("spider",
  // "man") in BOTH directions.
  const joinedSet = new Set();
  for (let i = 0; i < listingArr.length - 1; i++) {
    joinedSet.add(listingArr[i] + listingArr[i + 1]);
  }

  // Q31: Adaptive threshold for thin titles (≤2 tokens after sanitization)
  const adaptiveThreshold = searchTokens.length <= 2 ? 0.75 : threshold;

  let matches = 0;
  for (let i = 0; i < searchTokens.length; i++) {
    const t = searchTokens[i];
    if (listingSet.has(t)) { matches++; continue; }
    // our compact token ↔ listing split pair ("spiderman" vs "spider man")
    if (joinedSet.has(t)) { matches++; continue; }
    // our split pair ↔ listing compact token ("spider","man" vs "spiderman")
    if (i + 1 < searchTokens.length && listingSet.has(t + searchTokens[i + 1])) {
      matches += 2;
      i++;
    }
  }
  return matches / searchTokens.length >= adaptiveThreshold;
};

// ──────────────────────────── GRADE PARSING ────────────────────────────

// Parse a numeric grade from a listing title. Recognizes CGC X.X slab
// grades and raw letter grades (NM, VF+, GD-, etc). Returns null when no
// grade is detectable — caller should keep those listings (can't prove
// mismatch).
export const parseListingGrade = (title) => {
  const t = String(title || '');
  // Q50: Numeric token extraction FIRST (prevents "FN 6.0" → 6.0 label-midpoint skew).
  // CGC prefix (highest priority): "CGC 9.4" → 9.4
  const cgc = t.match(/CGC\s*([\d.]+)/i);
  if (cgc) return parseFloat(cgc[1]);
  // Q51 HOTFIX: Strip issue tokens BEFORE numeric extraction (Venom #1: "1" → grade 1.0 regression).
  // Remove: "#1", "No. 133", "Issue 8" → prevents bare integers from matching as grades.
  const t2 = t.replace(/#\s*\d+/g, ' ')
               .replace(/\bno\.?\s*\d+/gi, ' ')
               .replace(/\bissue\s*\d+/gi, ' ');
  // Q50b: matchAll numeric tokens, prefer decimal format, range 0.5–10.0
  // Pattern: \b(\d{1,2}\.\d)\b matches "6.0", "9.4", "10.0" (1-2 digits before decimal, 1 digit after)
  const numericTokens = [...t2.matchAll(/\b(\d{1,2}\.\d)\b/g)].map(m => parseFloat(m[1]));
  const validGrades = numericTokens.filter(val => val >= 0.5 && val <= 10.0);

  if (validGrades.length > 0) {
    // Q50b: Decimal preference — if multiple matches, prefer highest (likely the grade, not year/issue)
    // Grades cluster 0.5-10.0; years/issues are 1900+ or single-digit, filtered out by range check
    return Math.max(...validGrades);
  }
  // Label midpoint fallback: "FN", "VF+", "nm/mt" → canonical grade
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

// Q47-QUAL (2026-07-16, ASM #17 "low grade reading copy" class) — the
// grade-proximity filter's Fair/Poor check (soldVerification.js and
// comps.js, both call sites below) only recognizes bare "Fair"/"Poor"
// words when parseListingGrade finds no structured token. It misses the
// much more common collector shorthand sellers actually write: "reading
// copy", "coverless", "detached cover", "missing pages", "well worn",
// "heavily read" — all reliable, unambiguous signals that a listing is
// well below mid-grade, none of which parseListingGrade's numeric/
// letter-abbreviation scan can see. A $61 "low grade reading copy" comp
// with no parseable grade token was passing the null-grade fallback
// unfiltered and anchoring the low end of a 24-comp pool for a VG 4.0
// target book (real market $700-1,100, engine landed at $188.36).
//
// Positive-evidence dictionary ONLY — deliberately does not attempt to
// infer anything from the ABSENCE of grade language. A listing that says
// nothing about condition at all must keep passing through untouched;
// only an explicit, known low-grade phrase counts as evidence. Same
// safety property as tonight's newsstand reason-text fallback.
//
// Each phrase maps to a conservative ceiling — the highest grade that
// phrase could plausibly describe. getQualitativeGradeCeiling returns
// the STRICTEST (lowest) ceiling among every phrase that matches, so a
// title matching multiple low-grade signals doesn't get diluted toward
// the weaker one. Callers apply the SAME ±1.5 tolerance already used for
// parsed numeric grades — no new threshold invented, just a second way
// to arrive at a comparable number.
const QUALITATIVE_GRADE_CEILINGS = [
  ['reading copy', 1.8],
  ['low grade', 2.0],
  ['coverless', 1.0],
  ['detached cover', 1.0],
  ['cover detached', 1.0],
  ['missing pages', 1.0],
  ['well worn', 2.0],
  ['well-worn', 2.0],
  ['heavily read', 1.8],
];

export const getQualitativeGradeCeiling = (title) => {
  const t = String(title || '').toLowerCase();
  if (!t) return null;
  let strictest = null;
  for (const [phrase, ceiling] of QUALITATIVE_GRADE_CEILINGS) {
    if (t.includes(phrase) && (strictest === null || ceiling < strictest)) {
      strictest = ceiling;
    }
  }
  return strictest;
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

// Q23 FIX — Normalize issue-format strings (Annual 14 → 14 + format=annual).
// Vision and eBay sometimes return "Annual 14", "Special", "King-Size 3" as
// the issue field. Comp filters expect numeric issue strings, so non-numeric
// formats kill all matches. Extract the numeric portion and flag the format.
export const normalizeIssueFormat = (issueStr) => {
  if (!issueStr) return { issue: null, format: null };

  const str = String(issueStr).trim();

  // Pure numeric — no format marker
  if (/^\d+$/.test(str)) return { issue: str, format: null };

  // Annual #14 or Annual 14 → 14 + format=annual
  const annualMatch = str.match(/^Annual\s*#?\s*(\d+)$/i);
  if (annualMatch) return { issue: annualMatch[1], format: 'annual' };

  // Special #3 or Special 3 → 3 + format=special
  const specialMatch = str.match(/^Special\s*#?\s*(\d+)$/i);
  if (specialMatch) return { issue: specialMatch[1], format: 'special' };

  // Giant-Size #7 or King-Size #5 → N + format=giant-size/king-size
  const giantMatch = str.match(/^Giant[-\s]?Size\s*#?\s*(\d+)$/i);
  if (giantMatch) return { issue: giantMatch[1], format: 'giant-size' };

  const kingMatch = str.match(/^King[-\s]?Size\s*#?\s*(\d+)$/i);
  if (kingMatch) return { issue: kingMatch[1], format: 'king-size' };

  // Bare format words without numbers → flag format, null issue
  if (/^(Annual|Special|Giant[-\s]?Size|King[-\s]?Size)$/i.test(str)) {
    const format = str.toLowerCase().replace(/\s+/g, '-');
    return { issue: null, format };
  }

  // Unrecognized format → return as-is
  return { issue: str, format: null };
};

// Listing must contain the issue number as "#N" with a word boundary
// after (so "#1710" and "#21" don't match "#1"). Also rejects lot
// listings with commas-between-digits, "lot" keyword.
//
// Q37: Adjacency-aware dual-number parsing. When title contains multiple
// issue numbers (UK weeklies: "MWOM #198 feat. Hulk #181"), prefer the
// number nearest series-title tokens. Falls back to first-number for UK
// weeklies when no adjacency match (weekly issue comes before reprint issue).
export const hasIssueNumber = (listingTitle, issueNum, seriesTitle = null) => {
  if (!issueNum) return true;
  const tRaw = String(listingTitle || "");
  if (/\blot\b/i.test(tRaw) || /\d+\s*,\s*\d+/.test(tRaw)) return false;

  // Q46: Apply ABBREV expansion to comp title BEFORE adjacency scan.
  // TMNT failure: Vision tokens expanded ("teenage", "mutant", "ninja", "turtles"),
  // but comp title "TMNT Adventures #4" left raw → adjacency window search finds
  // "tmnt" (unexpanded) → no anchor match → 0/30 kept.
  //
  // Fix: normalize BOTH sides identically. Comp title gets same ABBREV expansion
  // as seriesTitle tokenization below.
  let t = tRaw.toLowerCase();
  for (const [abbrev, expanded] of Object.entries(ABBREV_MAP)) {
    const pattern = new RegExp(`\\b${abbrev}\\b`, 'gi');
    t = t.replace(pattern, expanded);
  }

  const escaped = String(issueNum).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Q37: UK weeklies use "no." instead of "#" (e.g., "MWOM no.198")
  // Accept both "#N" and "no.N" patterns
  const hasHashOrNo = new RegExp(`(?:#|\\bno\\.?)\\s*${escaped}\\b`, "i").test(t);
  if (!hasHashOrNo) return false;

  // Q37: Multi-number adjacency logic (matches both "#N" and "no.N")
  const issueMatches = [...t.matchAll(/(?:#|\bno\.?)\s*(\d+)\b/gi)];
  if (issueMatches.length === 0) return false;
  if (issueMatches.length === 1) {
    // Single issue — standard check
    return hasHashOrNo;
  }

  // Multiple issues — adjacency-aware resolution
  if (seriesTitle) {
    // Q46: seriesTitle tokenization already expands abbreviations via tokenizeTitle
    // (which calls ABBREV_MAP internally). Both sides now normalized identically.
    const seriesTokens = tokenizeTitle(seriesTitle);
    for (const match of issueMatches) {
      if (match[1] === String(issueNum)) {
        // Extract 15-char window around this match (from EXPANDED comp title)
        const start = Math.max(0, match.index - 15);
        const end = Math.min(t.length, match.index + 20);
        const window = t.slice(start, end);

        // Check if any series token appears in window
        const hasSeriesToken = seriesTokens.some(token =>
          window.includes(token.toLowerCase())
        );
        if (hasSeriesToken) return true; // Adjacency match
      }
    }
  }

  // No adjacency — use first-number heuristic for UK weeklies
  // (weekly issue comes before featured issue: "MWOM #198 feat. Hulk #181")
  return issueMatches[0][1] === String(issueNum);
};

// Helper: count distinct #N or no.N patterns in a title. Returns true when ≥2
// different issue numbers are present.
// Q37: Updated to match UK "no." format
export const hasMultipleDistinctIssues = (listingTitle) => {
  const distinct = new Set();
  for (const m of String(listingTitle || "").matchAll(/(?:#|\bno\.?)\s*(\d+)\b/gi)) {
    distinct.add(m[1]);
    if (distinct.size > 1) return true;
  }
  return false;
};

// Helper: detect cross-series separator patterns. Returns true when listing
// contains both an issue number (#N) AND a separator (+/&) followed by likely
// second book (series name + bare issue number). Catches "Brave and Bold #28
// + Titans 34" class where bare issue number lacks "#" prefix. Ship #20a.6.19.
export const hasCrossSeriesSeparator = (title) => {
  const t = String(title || '');
  // Requires: issue number present (#N pattern)
  if (!/#\s*\d+/.test(t)) return false;
  // Separator pattern: + or & followed by likely series name (word starting
  // with capital) and bare issue number (1-4 digits)
  return /[+&]\s+[A-Z][a-z]+\s+\d{1,4}\b/i.test(t);
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
  // Ship #24 — crossover-X guard: "X" between two capitalized words
  // (e.g., "Street Fighter X G.I. Joe") is a crossover symbol, NOT
  // a sequel marker. Bidirectional check: requires BOTH (a) preceding
  // capitalized word AND (b) following capitalized word/abbreviation.
  for (const m of t.matchAll(/(?<![\w-])(III|II|IV|VI{0,3}|IX|X)(?![\w-])/g)) {
    const numeral = m[1];
    // Crossover-X filter: if "X" has capitalized words on BOTH sides, it's a crossover.
    if (numeral === 'X') {
      const beforeMatch = t.slice(0, m.index);
      const afterMatch = t.slice(m.index + m[0].length);

      // Pattern: preceding word contains letters (any case, incl. all-caps "FIGHTER")
      const hasPrecedingWord = /[A-Za-z]\s*$/.test(beforeMatch);
      // Pattern: following starts with optional whitespace/punctuation + letter
      // Catches: "X G.I.", "X GIJOE", "X GI JOE", "X Joe"
      const hasFollowingWord = /^[\s.]*[A-Za-z]/.test(afterMatch);

      if (hasPrecedingWord && hasFollowingWord) {
        continue; // Skip this "X" — crossover symbol between two franchise names
      }
    }
    markers.push(`roman-${numeral.toLowerCase()}`);
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
