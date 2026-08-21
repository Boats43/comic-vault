// Ship #16 — FR-CREATOR-CREDITS.
//
// Premium-creator detection in comp listing titles. Mirrors the
// Ship #12a multi-key extraction pattern. Display-only — surfaces
// detected creators on out.creatorFromComps + out.creatorFromCompsSingleton
// for the "DETECTED IN COMPS" UI block. Zero pricing math impact.
//
// Architecture parallels Ship #12a:
//   extractKeyFromComps(titles) → { consensus: hits>=2, singletons: hits===1 }
//   extractCreatorsFromComps(titles) → same shape
//
// Alias policy (Q4):
//   - Unambiguous last names (Wrightson, Aparo, Kirby, Ditko, etc.):
//     bare match allowed via aliases array. No first name needed.
//   - Ambiguous last names (Adams, Lee, Miller, Wood, Davis, Ross, etc.):
//     full canonical match required. Aliases array is empty for these.
//   - When two famous creators share a last name (Buscema brothers,
//     Severin siblings, Romita Sr/Jr): both included as separate entries
//     with empty aliases arrays so listings must use full name.
//
// Tier categories (Q1, Q2):
//   legend         — Silver/Bronze giants (Kirby, Ditko, Wrightson, etc.)
//   premium        — Bronze/Modern stars (McFarlane, Liefeld, Byrne, etc.)
//   modern-premium — 90s+ A-list (Hughes, Cassaday, Quitely, etc.)
//   current        — Active premium (Artgerm, Momoko, Skottie Young, etc.)
//
// Optional role field (Q3): 'writer' | 'artist' | 'cover'. Default
// (omitted) reads as a generic premium credit. Surfaced in UI when
// present so writers and cover-only artists can be visually distinguished.
//
// Location note: lives under src/lib/ (not api/) per Ship #15
// architectural learning — Vercel auto-creates a serverless function
// for every api/*.js file (Hobby plan limit: 12). Server-side import
// from api/enrich.js works fine — Vercel bundles transitively imported
// files, and src/ subdirectories are not auto-routed as functions.

export const PREMIUM_CREATORS = [
  // ─── LEGEND tier (Silver/Bronze giants) ──────────────────────────
  { canonical: 'Jack Kirby',         aliases: ['kirby'],            tier: 'legend', role: 'artist' },
  { canonical: 'Steve Ditko',        aliases: ['ditko'],            tier: 'legend', role: 'artist' },
  { canonical: 'Bernie Wrightson',   aliases: ['wrightson', 'berni wrightson'], tier: 'legend', role: 'artist' },
  { canonical: 'Neal Adams',         aliases: [],                   tier: 'legend', role: 'artist' },
  { canonical: 'Carmine Infantino',  aliases: ['infantino'],        tier: 'legend', role: 'artist' },
  { canonical: 'Jim Aparo',          aliases: ['aparo'],            tier: 'legend', role: 'artist' },
  { canonical: 'Nick Cardy',         aliases: ['cardy'],            tier: 'legend', role: 'artist' },
  { canonical: 'Wally Wood',         aliases: [],                   tier: 'legend', role: 'artist' },
  { canonical: 'Frank Frazetta',     aliases: ['frazetta'],         tier: 'legend', role: 'artist' },
  { canonical: 'Jim Steranko',       aliases: ['steranko'],         tier: 'legend', role: 'artist' },
  { canonical: 'John Buscema',       aliases: [],                   tier: 'legend', role: 'artist' },
  { canonical: 'Sal Buscema',        aliases: [],                   tier: 'legend', role: 'artist' },
  { canonical: 'John Romita Sr',     aliases: [],                   tier: 'legend', role: 'artist' },
  { canonical: 'Gene Colan',         aliases: ['colan'],            tier: 'legend', role: 'artist' },
  { canonical: 'Russ Heath',         aliases: [],                   tier: 'legend', role: 'artist' },
  { canonical: 'Will Eisner',        aliases: ['eisner'],           tier: 'legend', role: 'artist' },
  { canonical: 'Joe Kubert',         aliases: [],                   tier: 'legend', role: 'artist' },
  { canonical: 'Alex Toth',          aliases: ['toth'],             tier: 'legend', role: 'artist' },
  { canonical: 'John Severin',       aliases: [],                   tier: 'legend', role: 'artist' },
  { canonical: 'Marie Severin',      aliases: [],                   tier: 'legend', role: 'artist' },

  // ─── PREMIUM tier (Bronze/Modern stars, late 70s–90s) ────────────
  { canonical: 'Todd McFarlane',     aliases: ['mcfarlane'],        tier: 'premium', role: 'artist' },
  { canonical: 'Rob Liefeld',        aliases: ['liefeld'],          tier: 'premium', role: 'artist' },
  { canonical: 'Jim Lee',            aliases: [],                   tier: 'premium', role: 'artist' },
  { canonical: 'Marc Silvestri',     aliases: ['silvestri'],        tier: 'premium', role: 'artist' },
  { canonical: 'John Byrne',         aliases: ['byrne'],            tier: 'premium', role: 'artist' },
  { canonical: 'George Perez',       aliases: ['perez'],            tier: 'premium', role: 'artist' },
  { canonical: 'Frank Miller',       aliases: [],                   tier: 'premium', role: 'artist' },
  { canonical: 'Walt Simonson',      aliases: [],                   tier: 'premium', role: 'artist' },
  { canonical: 'Bill Sienkiewicz',   aliases: ['sienkiewicz'],      tier: 'premium', role: 'artist' },
  { canonical: 'Brian Bolland',      aliases: ['bolland'],          tier: 'premium', role: 'artist' },
  { canonical: 'John Bolton',        aliases: ['bolton'],           tier: 'premium', role: 'artist' },
  { canonical: 'Simon Bisley',       aliases: ['bisley'],           tier: 'premium', role: 'artist' },
  { canonical: 'Arthur Suydam',      aliases: ['suydam'],           tier: 'premium', role: 'artist' },
  { canonical: 'Erik Larsen',        aliases: ['larsen'],           tier: 'premium', role: 'artist' },
  { canonical: 'Whilce Portacio',    aliases: ['portacio'],         tier: 'premium', role: 'artist' },
  { canonical: 'Joe Madureira',      aliases: ['madureira', 'joe mad'], tier: 'premium', role: 'artist' },
  { canonical: 'Mike Mignola',       aliases: ['mignola'],          tier: 'premium', role: 'artist' },
  { canonical: 'Mike Zeck',          aliases: [],                   tier: 'premium', role: 'artist' },
  { canonical: 'Klaus Janson',       aliases: ['janson'],           tier: 'premium', role: 'artist' },
  { canonical: 'Alan Davis',         aliases: [],                   tier: 'premium', role: 'artist' },
  { canonical: 'Alan Moore',         aliases: [],                   tier: 'premium', role: 'writer' },
  { canonical: 'Neil Gaiman',        aliases: ['gaiman'],           tier: 'premium', role: 'writer' },
  { canonical: 'Grant Morrison',     aliases: [],                   tier: 'premium', role: 'writer' },
  { canonical: 'John Broome',        aliases: ['broome'],           tier: 'premium', role: 'writer' },
  { canonical: 'Gardner Fox',        aliases: [],                   tier: 'premium', role: 'writer' },

  // ─── MODERN-PREMIUM tier (90s+ A-list) ───────────────────────────
  { canonical: 'Adam Hughes',        aliases: [],                   tier: 'modern-premium', role: 'artist' },
  { canonical: 'J. Scott Campbell',  aliases: ['j scott campbell', 'j. scott campbell'], tier: 'modern-premium', role: 'artist' },
  { canonical: 'John Cassaday',      aliases: ['cassaday'],         tier: 'modern-premium', role: 'artist' },
  { canonical: 'Frank Quitely',      aliases: ['quitely'],          tier: 'modern-premium', role: 'artist' },
  { canonical: 'Chris Bachalo',      aliases: ['bachalo'],          tier: 'modern-premium', role: 'artist' },
  { canonical: 'Greg Capullo',       aliases: ['capullo'],          tier: 'modern-premium', role: 'artist' },
  { canonical: 'Steve McNiven',      aliases: ['mcniven'],          tier: 'modern-premium', role: 'artist' },
  { canonical: 'Olivier Coipel',     aliases: ['coipel'],           tier: 'modern-premium', role: 'artist' },
  { canonical: "Gabriele Dell'Otto", aliases: ["dell'otto", 'dellotto'], tier: 'modern-premium', role: 'artist' },
  { canonical: 'Alex Ross',          aliases: [],                   tier: 'modern-premium', role: 'artist' },
  { canonical: 'Travis Charest',     aliases: ['charest'],          tier: 'modern-premium', role: 'artist' },
  { canonical: 'Doug Mahnke',        aliases: ['mahnke'],           tier: 'modern-premium', role: 'artist' },
  { canonical: 'Jim Cheung',         aliases: ['cheung'],           tier: 'modern-premium', role: 'artist' },
  // GrailKey Directive 2026-08-15-AI (Detective Comics #1107 class) —
  // 'jimenez' was previously a bare, unambiguous alias resolving only to
  // Phil Jimenez, despite Jorge Jimenez (current Batman/Detective Comics
  // artist) being a comparably prominent DC creator sharing the same bare
  // surname — a real production case had Vision/visual evidence say
  // "Jorge Jimenez" and this registry silently overwrote it with "Phil
  // Jimenez" via the surname-only alias match. Moved into the documented
  // ambiguous-surname policy (see file header) alongside Adams/Lee/Miller:
  // both entries now require full-name match, empty aliases.
  { canonical: 'Phil Jimenez',       aliases: [],                   tier: 'modern-premium', role: 'artist' },
  { canonical: 'Jorge Jimenez',      aliases: [],                   tier: 'modern-premium', role: 'artist' },
  { canonical: 'Bryan Hitch',        aliases: ['hitch'],            tier: 'modern-premium', role: 'artist' },
  { canonical: 'David Finch',        aliases: ['finch'],            tier: 'modern-premium', role: 'artist' },
  { canonical: 'Esad Ribic',         aliases: ['ribic'],            tier: 'modern-premium', role: 'artist' },
  { canonical: 'Alex Maleev',        aliases: ['maleev'],           tier: 'modern-premium', role: 'artist' },
  { canonical: 'Frank Cho',          aliases: ['frank cho'],        tier: 'modern-premium', role: 'artist' },
  { canonical: 'Stuart Immonen',     aliases: ['immonen'],          tier: 'modern-premium', role: 'artist' },

  // ─── CURRENT tier (active premium covers) ────────────────────────
  { canonical: 'Artgerm',            aliases: ['artgerm', 'stanley lau'], tier: 'current', role: 'cover' },
  { canonical: 'Skottie Young',      aliases: ['skottie young'],    tier: 'current', role: 'artist' },
  { canonical: 'Inhyuk Lee',         aliases: ['inhyuk lee'],       tier: 'current', role: 'artist' },
  { canonical: 'Tula Lotay',         aliases: ['tula lotay'],       tier: 'current', role: 'artist' },
  { canonical: 'Mahmud Asrar',       aliases: ['asrar'],            tier: 'current', role: 'artist' },
  { canonical: 'Peach Momoko',       aliases: ['momoko', 'peach momoko'], tier: 'current', role: 'artist' },
  { canonical: 'Tyler Kirkham',      aliases: ['tyler kirkham'],    tier: 'current', role: 'artist' },
  { canonical: 'Skan Srisuwan',      aliases: ['skan'],             tier: 'current', role: 'artist' },
  { canonical: 'Mike Mayhew',        aliases: ['mayhew'],           tier: 'current', role: 'artist' },
  { canonical: 'Kaare Andrews',      aliases: ['kaare andrews'],    tier: 'current', role: 'artist' },
  { canonical: 'Lucio Parrillo',     aliases: ['parrillo'],         tier: 'current', role: 'artist' },
  { canonical: 'David Nakayama',     aliases: ['nakayama'],         tier: 'current', role: 'artist' },
  { canonical: 'Junggeun Yoon',      aliases: ['junggeun yoon'],    tier: 'current', role: 'artist' },
  { canonical: 'Jeehyung Lee',       aliases: ['jeehyung lee'],     tier: 'current', role: 'artist' },
  { canonical: 'Stanley Artgerm Lau',aliases: [],                   tier: 'current', role: 'cover' },
  { canonical: 'John Giang',         aliases: ['john giang', 'giang'], tier: 'current', role: 'artist' },  // Q130
  { canonical: 'Kyuyong Eom',        aliases: ['kyuyong eom', 'eom'], tier: 'current', role: 'artist' },  // Q133 Slice 1b
  { canonical: 'Alexander Lozano',   aliases: ['alexander lozano', 'lozano'], tier: 'current', role: 'artist' },  // Q136 Slice A
];

// Pre-compute case-insensitive search forms once at module load. Each
// entry expands to one or more search strings (canonical + aliases),
// each compiled as a word-boundary regex. Matching against the lowered
// title handles case-insensitivity; word-boundary handles substrings
// like "Wrightsoncover" (no match) vs "Wrightson cover" (match).
const SEARCH_INDEX = PREMIUM_CREATORS.map((c) => {
  const names = [c.canonical, ...(Array.isArray(c.aliases) ? c.aliases : [])]
    .filter((n) => typeof n === 'string' && n.trim().length >= 3);
  const patterns = names.map((n) => {
    // Escape regex meta-chars; apostrophes pass through (not meta in JS).
    const esc = n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${esc}\\b`, 'i');
  });
  return { creator: c, patterns };
});

// GrailKey Directive 2026-08-18-AU (GK-136), 4a-i — bounded, explicit
// spelling/truncation tolerance for creator-name matching. Fallback ONLY:
// the exact SEARCH_INDEX regex pass above stays the primary, unchanged
// path, byte-identical for every case it already covers. This layer never
// adds a new creator or alias (C1/C2: no registry expansion) — it only
// widens HOW an existing alias may be spelled in seller-written listing
// text, for the same fixed set of canonicals already in PREMIUM_CREATORS.
//
// Production evidence (Directive AU, ghmn7): a single artist's name
// appeared in the SAME pool spelled five different ways — "Dellotto",
// "Dell'Otto", "DELL'OTTO" (all three already matched the old regex),
// "DELL OTTO" (space where the regex expected an optional apostrophe —
// did not match) and "DEL O'TT" (single L, truncated/mangled suffix,
// space AND misplaced apostrophe — did not match). Two of five real
// spellings in one production pool were invisible to exact matching.
//
// Rules, stated explicitly (per C2):
//   1. NORMALIZE by stripping every character that is not a-z0-9,
//      lowercased. "Dell'Otto" / "Dellotto" / "DELL OTTO" all collapse to
//      the identical string "dellotto" under this rule ALONE — zero
//      fuzziness needed for the apostrophe/space class.
//   2. For an alias whose normalized form is >= MIN_FUZZY_ALIAS_LEN (6)
//      characters, ALSO accept a bounded Levenshtein edit-distance match
//      (<= FUZZY_MAX_DISTANCE, 2) against any contiguous 1-to-3-word
//      window of the candidate text (each window normalized the same
//      way) — this is what additionally covers "Del'Otto" (distance 1:
//      one missing L) and "DEL O'TT" (distance 2: one missing L, one
//      missing trailing O).
//   3. The length floor is the B2 safety boundary: a short alias (e.g.
//      "lee", "cho", 3-5 chars) never reaches the 6-char floor, so it can
//      NEVER be fuzzy-matched — only the already-long, already-
//      distinctive aliases get truncation tolerance, and only within 2
//      edits of THEIR OWN specific spelling, not a general similarity
//      search across all creators. See
//      tests/grailkey-directive-au-fuzzy-creator-match.test.js for the
//      exhaustive pairwise-distance proof that no two distinct
//      PREMIUM_CREATORS aliases fall within FUZZY_MAX_DISTANCE of each
//      other (the actual no-false-merge guarantee, not just hand-picked
//      examples).
const MIN_FUZZY_ALIAS_LEN = 6;
const FUZZY_MAX_DISTANCE = 2;
const MAX_FUZZY_WINDOW_WORDS = 3;

const normalizeCreatorText = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// GK-148 (2026-08-21) — non-creator stop-list, fuzzy-fallback ONLY.
//
// Production evidence: Creepy #1, "Creepy #1 CGC 7.0 (Warren 1964)..." —
// the publisher parenthetical "Warren" (Warren Publishing, the book's
// REAL publisher) fuzzy-matched Erik Larsen's registered alias "larsen"
// at Levenshtein distance 2 (w->l, r->s), both exactly 6 chars — clears
// MIN_FUZZY_ALIAS_LEN with zero margin, lands exactly at
// FUZZY_MAX_DISTANCE, not a near-miss. AU's own B2 pairwise proof
// (tests/grailkey-directive-au-dellotto-1963.test.js) only checks
// registry-alias-vs-registry-alias collisions — it has no way to catch a
// PUBLISHER name (or any other cross-domain token) landing inside the
// same distance/length window as a real creator alias, because the
// fuzzy fallback tests every word/phrase window in an ENTIRE pool-row
// title (extractFirstEligibleVariantCandidate passes the whole raw
// title, identityCore.js) with zero awareness of what kind of word it's
// looking at.
//
// Fix shape: a bounded, explicit stop-list of comic publisher/imprint
// names (normalized the same way as everything else in this file) that
// can NEVER win a fuzzy match, checked before the Levenshtein distance
// is even computed. This does NOT touch the exact SEARCH_INDEX regex
// pass (AU's own C1 guarantee: byte-identical for every case it already
// covers) and does NOT touch fuzzy matching for any window that isn't
// itself a stop-listed token — the Dell'Otto class (a genuine creator
// alias mangled by a seller, e.g. "DEL O'TT") is unaffected, since
// neither "del" nor "ott" is a publisher name.
//
// Scope: publisher/imprint names only, not a general "common words"
// filter — a broader stop-list is a different, unscoped change. If the
// creator roster ever grows to include someone whose surname legitimately
// collides with one of these publisher tokens, that would need its own
// resolution (this list wins outright today; there is no such collision
// in the current PREMIUM_CREATORS roster, checked by hand against every
// entry below at the time this list was written).
const PUBLISHER_STOP_LIST = new Set(
  [
    'warren', 'marvel', 'marvelcomics', 'image', 'imagecomics', 'darkhorse',
    'dc', 'dccomics', 'archie', 'archiecomics', 'fawcett', 'charlton',
    'goldkey', 'harvey', 'harveycomics', 'atlas', 'ec', 'eccomics',
    'quality', 'idw', 'boom', 'boomstudios', 'dynamite', 'valiant', 'dell',
    'kingcomics', 'skybound', 'avatar', 'awa', 'aftershock', 'vertigo',
    'wildstorm', 'homage', 'topcow', 'timely', 'nationalcomics',
    'nationalperiodical', 'acg', 'prizecomics', 'standard', 'centaur',
    'novelty', 'hillman', 'ace', 'levgleason', 'tower', 'milestone',
    'malibu', 'defiant', 'continuity', 'eternity', 'now', 'eclipse',
    'first', 'comico', 'pacific', 'americomics', 'renegade', 'caliber',
    'antarctic', 'aircel', 'innovation', 'gladstone', 'whitman', 'western',
    'kingfeatures', 'disney', 'seaboard', 'atlasseaboard', 'zenith',
  ].map(normalizeCreatorText)
);

// Standard DP Levenshtein — single-insertion/deletion/substitution edit
// distance. Bounded by short inputs (creator surnames / 1-3 word windows,
// never a whole title) so this is always cheap.
const levenshteinDistance = (a, b) => {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j - 1], prev[j], cur[j - 1]);
    }
    prev = cur;
  }
  return prev[n];
};

// Word-tokenize the same way rawWordTokenize (imageSearchIdentity.js,
// GrailKey Directive AN) already does — strip punctuation to whitespace,
// lowercase, split. Reusing that established shape rather than inventing
// a second tokenizer, per C2's "extend it, don't fork it."
const wordTokenize = (text) => String(text || '')
  .toLowerCase()
  .replace(/[^a-z0-9\s]/g, ' ')
  .split(/\s+/)
  .filter(Boolean);

const fuzzyAliasMatches = (candidateText, alias) => {
  const normalizedAlias = normalizeCreatorText(alias);
  if (normalizedAlias.length < MIN_FUZZY_ALIAS_LEN) return false;
  const words = wordTokenize(candidateText);
  for (let start = 0; start < words.length; start++) {
    for (let span = 1; span <= MAX_FUZZY_WINDOW_WORDS && start + span <= words.length; span++) {
      const window = normalizeCreatorText(words.slice(start, start + span).join(''));
      if (!window) continue;
      // GK-148 — a window that IS a recognized publisher/imprint token
      // can never win a fuzzy match, regardless of edit distance. Checked
      // before the length pre-filter/Levenshtein so it applies uniformly.
      if (PUBLISHER_STOP_LIST.has(window)) continue;
      // Cheap pre-filter before paying for full Levenshtein: a window
      // whose length differs from the alias by more than the max distance
      // can never be within that distance.
      if (Math.abs(window.length - normalizedAlias.length) > FUZZY_MAX_DISTANCE) continue;
      if (levenshteinDistance(window, normalizedAlias) <= FUZZY_MAX_DISTANCE) return true;
    }
  }
  return false;
};

// GrailKey Directive 2026-08-16-AL (GK-120) — single-text creator lookup,
// reusing the SAME precomputed SEARCH_INDEX extractCreatorsFromComps
// already builds (no second registry, no duplicated regex work). Returns
// the set of canonical creator names matched anywhere in one string —
// used by identityCore.js's selectBestVariantCandidate to detect a
// contradictory-creator hard negative (e.g. confirmedVariant says "Tyler
// Kirkham" but a PC candidate's own product name says "[Mayhew Virgin]" —
// two different, both-registered creators naming the SAME variant slot is
// a hard veto, not a token-overlap tiebreak).
//
// GrailKey Directive AU, 4a-i — exact SEARCH_INDEX pass runs first,
// unchanged. Only when it finds nothing for a given creator does the
// bounded fuzzy fallback (above) get a chance, tested against that same
// creator's own canonical + aliases. Byte-identical output for every
// text where the exact pass already matched.
export const matchCreatorCanonicals = (text) => {
  const lower = String(text || '').toLowerCase();
  if (!lower) return [];
  const out = [];
  for (const { creator, patterns } of SEARCH_INDEX) {
    if (patterns.some((re) => re.test(lower))) {
      out.push(creator.canonical);
      continue;
    }
    const names = [creator.canonical, ...(Array.isArray(creator.aliases) ? creator.aliases : [])];
    if (names.some((n) => fuzzyAliasMatches(text, n))) {
      out.push(creator.canonical);
    }
  }
  return out;
};

// Scan an array of comp listing titles and return consensus + singleton
// detections. Same shape as Ship #12a's extractKeyFromComps.
//
//   { consensus: [{ canonical, tier, role?, hits, sources[] }],
//     singletons: [...] }
//
// consensus = hits >= 2. singletons = hits === 1. Sorted by hits desc.
// Sources capped at 3 per entry. Multiple aliases for the same canonical
// dedupe to one entry; hits accumulate across all alias matches.
//
// Within a single title, each canonical is counted at most once even if
// multiple aliases match — a title that says "Bernie Wrightson cover by
// Wrightson" still increments Wrightson by 1.
export const extractCreatorsFromComps = (titles) => {
  if (!Array.isArray(titles) || titles.length === 0) {
    return { consensus: [], singletons: [] };
  }
  const map = new Map();
  for (const rawTitle of titles) {
    if (!rawTitle || typeof rawTitle !== 'string') continue;
    const titleLower = rawTitle.toLowerCase();
    const matchedThisTitle = new Set();
    for (const { creator, patterns } of SEARCH_INDEX) {
      if (matchedThisTitle.has(creator.canonical)) continue;
      const hit = patterns.some((re) => re.test(titleLower));
      if (!hit) continue;
      matchedThisTitle.add(creator.canonical);
      const existing = map.get(creator.canonical);
      if (existing) {
        existing.hits += 1;
        if (existing.sources.length < 3) existing.sources.push(rawTitle);
      } else {
        const entry = {
          canonical: creator.canonical,
          tier: creator.tier,
          hits: 1,
          sources: [rawTitle],
        };
        if (creator.role) entry.role = creator.role;
        map.set(creator.canonical, entry);
      }
    }
  }
  const all = Array.from(map.values()).sort((a, b) => b.hits - a.hits);
  return {
    consensus: all.filter((e) => e.hits >= 2),
    singletons: all.filter((e) => e.hits === 1),
  };
};
