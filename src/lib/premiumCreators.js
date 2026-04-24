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
  { canonical: 'Phil Jimenez',       aliases: ['jimenez'],          tier: 'modern-premium', role: 'artist' },
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
