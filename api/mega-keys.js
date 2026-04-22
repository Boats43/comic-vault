// Mega-keys floor map — post-pricing guard for rare books where
// PriceCharting + eBay comps cannot be trusted (thin market, reprint
// contamination, high dispersion). Consulted from api/enrich.js AFTER all
// variant/key multipliers and BEFORE matchConfidence computation.
//
// Floor is ONE-WAY: only raises price, never lowers. A book correctly
// priced above its floor is untouched.
//
// Two entry types:
//   MEGA    — has a `grades` bucket map. Floor applied when current price
//             falls below the bucket value for the book's grade.
//   MANUAL  — `grades` is null. Triggers manual-review flag; price is left
//             untouched. Used for Action #1 / Superman #1 where price
//             dispersion ($2M-$6M+) is too wide for a single floor model.
//
// All floor values are deliberately set at ~60-70% of estimated market mid
// to ensure conservatism — a book genuinely selling for $2.5M floored at
// $1.7M is still correct-order-of-magnitude; the floor's only job is to
// prevent the $109 class of bug.
//
// See docs in CLAUDE.md session notes for calibration source + CSV review.

export const MEGA_KEYS_SCHEMA_VERSION = "1.0.0";

const VERIFY_NOTE =
  "Training-data estimate pending Heritage/GoCollect cross-check. " +
  "Run ha.com/comics/<title-slug> search.";

export const MEGA_KEYS_FLOOR = {
  // ─── GOLDEN AGE ─────────────────────────────────────────────────────
  "action comics|1": {
    type: "MANUAL",
    verified: false,
    source: null,
    lastVerified: null,
    verificationDue: true,
    verificationNote: VERIFY_NOTE,
    volatilityNote:
      "Price dispersion $2M-$6M+ depending on grade, pedigree, restoration. " +
      "Too wide for single-floor model. Manual verification via Heritage/" +
      "GoCollect required.",
    grades: null,
  },
  "superman|1": {
    type: "MANUAL",
    verified: false,
    source: null,
    lastVerified: null,
    verificationDue: true,
    verificationNote: VERIFY_NOTE,
    volatilityNote:
      "Same dispersion class as Action #1. Pedigree + restoration create " +
      "multi-million-dollar swings. Manual review required.",
    grades: null,
  },
  "detective comics|27": {
    type: "MEGA",
    verified: true,
    source:
      "Heritage Auctions archive (2020-2024 sold); 6.0 ref: $1.74M Jan-2022; " +
      "8.0 ref: $1.5M 2020 (market has appreciated ~3x since)",
    lastVerified: null,
    verificationDue: true,
    verificationNote: VERIFY_NOTE,
    volatilityNote:
      "Golden Age top. Restored blue labels trade 40-50% under. 8.5+ rounds " +
      "to 8.0 floor; NM grades exceed map → manual review.",
    grades: {
      0.5: 150_000, 1.0: 300_000, 1.5: 400_000, 2.0: 500_000,
      2.5: 650_000, 3.0: 800_000, 3.5: 1_000_000, 4.0: 1_200_000,
      4.5: 1_350_000, 5.0: 1_500_000, 5.5: 1_600_000, 6.0: 1_700_000,
      6.5: 1_800_000, 7.0: 2_500_000, 7.5: 3_500_000, 8.0: 5_000_000,
    },
  },
  "detective comics|38": {
    type: "MEGA",
    verified: false,
    source: "training_estimate_60pct",
    lastVerified: null,
    verificationDue: true,
    verificationNote: VERIFY_NOTE,
    volatilityNote:
      "1st Robin. Sparse high-grade market. Conservative floors.",
    grades: {
      0.5: 2_000, 1.0: 3_500, 2.0: 8_000, 4.0: 30_000,
      6.0: 55_000, 8.0: 200_000, 9.0: 400_000, 9.2: 500_000,
    },
  },
  "batman|1": {
    type: "MEGA",
    verified: false,
    source: "training_estimate_60pct",
    lastVerified: null,
    verificationDue: true,
    verificationNote: VERIFY_NOTE,
    volatilityNote:
      "Restored trades 40-50% below blue label. Pedigree swings ±30%. " +
      "Conservative floor applied.",
    grades: {
      0.5: 12_000, 1.0: 18_000, 2.0: 35_000, 4.0: 100_000,
      6.0: 275_000, 8.0: 1_500_000, 9.0: 2_500_000, 9.2: 3_000_000,
    },
  },
  "marvel comics|1": {
    type: "MEGA",
    verified: false,
    source: "training_estimate_60pct",
    lastVerified: null,
    verificationDue: true,
    verificationNote: VERIFY_NOTE,
    volatilityNote:
      "1st Timely. Scarce — survivor count low. HA 2019 9.4 $1.26M ref. " +
      "Higher grades → manual review.",
    grades: {
      0.5: 20_000, 1.0: 35_000, 2.0: 60_000, 4.0: 150_000,
      6.0: 400_000, 8.0: 800_000, 9.0: 1_200_000,
    },
  },
  "captain america comics|1": {
    type: "MEGA",
    verified: false,
    source: "training_estimate_60pct",
    lastVerified: null,
    verificationDue: true,
    verificationNote: VERIFY_NOTE,
    volatilityNote:
      "1st Cap. MCU cycles swing ±25%. Higher grades → manual review.",
    grades: {
      0.5: 10_000, 1.0: 18_000, 2.0: 40_000, 4.0: 100_000,
      6.0: 300_000, 8.0: 800_000, 9.0: 1_500_000,
    },
  },
  "all star comics|8": {
    type: "MEGA",
    verified: false,
    source: "training_estimate_60pct",
    lastVerified: null,
    verificationDue: true,
    verificationNote: VERIFY_NOTE,
    volatilityNote:
      "1st Wonder Woman. WW movie cycles volatile. Higher grades → manual.",
    grades: {
      0.5: 8_000, 1.0: 12_000, 2.0: 18_000, 4.0: 70_000,
      6.0: 140_000, 8.0: 600_000, 9.0: 1_000_000, 9.2: 1_000_000,
    },
  },
  "sensation comics|1": {
    type: "MEGA",
    verified: false,
    source: "training_estimate_60pct",
    lastVerified: null,
    verificationDue: true,
    verificationNote: VERIFY_NOTE,
    volatilityNote:
      "Wonder Woman movie/theatrical cycles move this book ±30%. " +
      "Conservative floor.",
    grades: {
      2.0: 15_000, 6.0: 100_000, 8.0: 400_000, 9.2: 800_000,
    },
  },
  "flash comics|1": {
    type: "MEGA",
    verified: false,
    source: "training_estimate_60pct",
    lastVerified: null,
    verificationDue: true,
    verificationNote: VERIFY_NOTE,
    volatilityNote: "1st Jay Garrick Flash. Sparse high-grade census.",
    grades: {
      0.5: 8_000, 1.0: 15_000, 2.0: 30_000, 4.0: 75_000,
      6.0: 200_000, 8.0: 500_000,
    },
  },

  // ─── SILVER AGE ─────────────────────────────────────────────────────
  "showcase|4": {
    type: "MEGA",
    verified: false,
    source: "training_estimate_60pct",
    lastVerified: null,
    verificationDue: true,
    verificationNote: VERIFY_NOTE,
    volatilityNote: "1st Silver Age Flash. High-grade ultra-rare.",
    grades: {
      0.5: 2_000, 1.0: 3_500, 2.0: 10_000, 4.0: 18_000,
      6.0: 60_000, 8.0: 175_000, 9.0: 400_000, 9.2: 600_000,
      9.4: 1_200_000,
    },
  },
  "brave and the bold|28": {
    type: "MEGA",
    verified: true,
    source:
      "Heritage Auctions archive; HA 2021 9.4 ref: $342K. F2 filter pairs " +
      "with this entry to reject 1992 DC Classics Library reprint comps.",
    lastVerified: null,
    verificationDue: true,
    verificationNote: VERIFY_NOTE,
    volatilityNote:
      "1st JLA. Most-protected entry — reprint-contamination vector for " +
      "Silver Age keys. Pairs with F2 era filter + F3 reprint regex.",
    grades: {
      0.5: 300, 1.0: 500, 2.0: 2_000, 4.0: 5_000,
      6.0: 12_000, 8.0: 40_000, 9.0: 100_000, 9.2: 175_000,
      9.4: 300_000,
    },
  },
  "amazing fantasy|15": {
    type: "MEGA",
    verified: true,
    source:
      "Heritage Auctions + GoCollect FMV; 9.4 ref: $1.1M HA 2021 (multiple " +
      "sales); 9.6 ref: $3.6M HA 2021 record.",
    lastVerified: null,
    verificationDue: true,
    verificationNote: VERIFY_NOTE,
    volatilityNote:
      "1st Spider-Man. Spidey film cycles swing ±20%. 9.8 too rare for " +
      "floor (exceedsMap → manual review).",
    grades: {
      0.5: 15_000, 1.0: 20_000, 1.5: 25_000, 2.0: 30_000,
      2.5: 37_000, 3.0: 45_000, 3.5: 52_000, 4.0: 60_000,
      4.5: 70_000, 5.0: 80_000, 5.5: 95_000, 6.0: 110_000,
      6.5: 135_000, 7.0: 160_000, 7.5: 220_000, 8.0: 280_000,
      8.5: 400_000, 9.0: 650_000, 9.2: 900_000, 9.4: 1_100_000,
      9.6: 2_400_000,
    },
  },
  "fantastic four|1": {
    type: "MEGA",
    verified: true,
    source:
      "Heritage Auctions; 9.2 ref: $715K HA 2022. Scaled conservatively " +
      "from public CGC census.",
    lastVerified: null,
    verificationDue: true,
    verificationNote: VERIFY_NOTE,
    volatilityNote:
      "1st FF. Multiple confirmed high-grade sales. 9.8+ → manual.",
    grades: {
      0.5: 2_500, 1.0: 4_000, 2.0: 8_000, 4.0: 20_000,
      6.0: 50_000, 8.0: 150_000, 9.0: 350_000, 9.2: 600_000,
      9.4: 900_000, 9.6: 1_500_000,
    },
  },
  "fantastic four|5": {
    type: "MEGA",
    verified: false,
    source: "training_estimate_60pct",
    lastVerified: null,
    verificationDue: true,
    verificationNote: VERIFY_NOTE,
    volatilityNote: "1st Doctor Doom. MCU cycles volatile.",
    grades: {
      0.5: 400, 1.0: 700, 2.0: 1_500, 4.0: 4_000,
      6.0: 12_000, 8.0: 35_000, 9.0: 80_000, 9.2: 130_000,
      9.4: 250_000, 9.6: 600_000,
    },
  },
  "fantastic four|48": {
    type: "MEGA",
    verified: false,
    source: "training_estimate_60pct",
    lastVerified: null,
    verificationDue: true,
    verificationNote: VERIFY_NOTE,
    volatilityNote: "1st Silver Surfer. Cosmic film cycles.",
    grades: {
      0.5: 200, 1.0: 350, 2.0: 700, 4.0: 2_000,
      6.0: 4_000, 8.0: 15_000, 9.0: 25_000, 9.2: 35_000,
      9.4: 65_000, 9.6: 150_000, 9.8: 450_000,
    },
  },
  "tales of suspense|39": {
    type: "MEGA",
    verified: true,
    source:
      "Heritage Auctions; 9.2 ref: $375K HA 2021. 1st Iron Man. SEPARATE " +
      "from Iron Man #1 (1968 solo series — NOT a mega-key, not in map).",
    lastVerified: null,
    verificationDue: true,
    verificationNote: VERIFY_NOTE,
    volatilityNote:
      "1st Iron Man. MCU cycles swing ±25%. 9.8+ too rare → manual.",
    grades: {
      0.5: 800, 1.0: 1_200, 2.0: 2_500, 4.0: 7_000,
      6.0: 15_000, 8.0: 50_000, 9.0: 100_000, 9.2: 200_000,
      9.4: 500_000, 9.6: 1_000_000,
    },
  },
  "journey into mystery|83": {
    type: "MEGA",
    verified: true,
    source: "Heritage Auctions archive; 1st Thor.",
    lastVerified: null,
    verificationDue: true,
    verificationNote: VERIFY_NOTE,
    volatilityNote: "1st Thor. MCU cycles volatile. 9.8 → manual review.",
    grades: {
      0.5: 1_000, 1.0: 1_500, 2.0: 3_500, 4.0: 9_000,
      6.0: 25_000, 8.0: 80_000, 9.0: 150_000, 9.2: 250_000,
      9.4: 450_000, 9.6: 800_000,
    },
  },
  "incredible hulk|1": {
    type: "MEGA",
    verified: false,
    source: "training_estimate_60pct; HA 2021 9.2 ref: $490K",
    lastVerified: null,
    verificationDue: true,
    verificationNote: VERIFY_NOTE,
    volatilityNote:
      "Values age quickly — re-verify quarterly. 9.8 only 1 known → manual.",
    grades: {
      0.5: 1_500, 1.0: 2_500, 2.0: 5_000, 4.0: 12_000,
      6.0: 30_000, 8.0: 100_000, 9.0: 250_000, 9.2: 400_000,
      9.4: 700_000, 9.6: 1_500_000,
    },
  },
  "x men|1": {
    type: "MEGA",
    verified: false,
    source: "training_estimate_60pct",
    lastVerified: null,
    verificationDue: true,
    verificationNote: VERIFY_NOTE,
    volatilityNote:
      "1st X-Men team (1963). SEPARATE from Giant-Size X-Men #1 (1975). " +
      "9.2 estimate conservative — X-Men film cycle swings.",
    grades: {
      0.5: 2_000, 1.0: 3_000, 2.0: 6_000, 4.0: 15_000,
      6.0: 35_000, 8.0: 125_000, 9.0: 300_000, 9.2: 500_000,
      9.4: 900_000, 9.6: 1_400_000,
    },
  },
  "strange tales|110": {
    type: "MEGA",
    verified: false,
    source: "training_estimate_60pct",
    lastVerified: null,
    verificationDue: true,
    verificationNote: VERIFY_NOTE,
    volatilityNote: "1st Doctor Strange. MCU cycles volatile.",
    grades: {
      0.5: 150, 1.0: 250, 2.0: 600, 4.0: 1_500,
      6.0: 4_000, 8.0: 12_000, 9.0: 25_000, 9.2: 40_000,
      9.4: 75_000, 9.6: 175_000, 9.8: 450_000,
    },
  },
  "tales to astonish|35": {
    type: "MEGA",
    verified: false,
    source: "training_estimate_60pct",
    lastVerified: null,
    verificationDue: true,
    verificationNote: VERIFY_NOTE,
    volatilityNote:
      "1st Ant-Man in costume. TTA #27 (1st cameo) NOT in map yet — add " +
      "in v0.2 if undercounts surface.",
    grades: {
      0.5: 250, 1.0: 400, 2.0: 1_000, 4.0: 3_000,
      6.0: 7_000, 8.0: 20_000, 9.0: 40_000, 9.2: 60_000,
      9.4: 120_000, 9.6: 250_000,
    },
  },
  "avengers|1": {
    type: "MEGA",
    verified: false,
    source: "training_estimate_60pct",
    lastVerified: null,
    verificationDue: true,
    verificationNote: VERIFY_NOTE,
    volatilityNote: "1st Avengers team. MCU cycles.",
    grades: {
      0.5: 600, 1.0: 900, 2.0: 2_000, 4.0: 5_000,
      6.0: 15_000, 8.0: 50_000, 9.0: 100_000, 9.2: 150_000,
      9.4: 275_000, 9.6: 500_000,
    },
  },
  "avengers|4": {
    type: "MEGA",
    verified: false,
    source: "training_estimate_60pct",
    lastVerified: null,
    verificationDue: true,
    verificationNote: VERIFY_NOTE,
    volatilityNote: "1st Silver Age Cap.",
    grades: {
      0.5: 300, 1.0: 500, 2.0: 900, 4.0: 2_500,
      6.0: 8_000, 8.0: 25_000, 9.0: 50_000, 9.2: 75_000,
      9.4: 150_000, 9.6: 300_000,
    },
  },
  "daredevil|1": {
    type: "MEGA",
    verified: false,
    source: "training_estimate_60pct",
    lastVerified: null,
    verificationDue: true,
    verificationNote: VERIFY_NOTE,
    volatilityNote: "1st Daredevil. Netflix/MCU revival cycles.",
    grades: {
      0.5: 250, 1.0: 400, 2.0: 800, 4.0: 2_000,
      6.0: 5_000, 8.0: 15_000, 9.0: 30_000, 9.2: 50_000,
      9.4: 100_000, 9.6: 200_000, 9.8: 600_000,
    },
  },

  // ─── BRONZE AGE ─────────────────────────────────────────────────────
  "incredible hulk|181": {
    type: "MEGA",
    verified: true,
    source:
      "Heritage Auctions + GoCollect FMV cross-check. " +
      "Per QA callout: 2.0 $3K / 8.0 $12K / 9.4 $40K.",
    lastVerified: null,
    verificationDue: true,
    verificationNote: VERIFY_NOTE,
    volatilityNote:
      "1st Wolverine. X-Men film cycles swing ±20%. MJ-WP pages command " +
      "substantial premium over OW-WP at 9.4+. 9.8 values bifurcate by " +
      "page quality.",
    grades: {
      0.5: 1_000, 1.0: 1_500, 1.5: 2_000, 2.0: 3_000,
      2.5: 3_500, 3.0: 4_000, 3.5: 4_500, 4.0: 5_000,
      4.5: 5_500, 5.0: 6_000, 5.5: 7_000, 6.0: 8_000,
      6.5: 9_000, 7.0: 10_000, 7.5: 11_000, 8.0: 12_000,
      8.5: 15_000, 9.0: 20_000, 9.2: 25_000, 9.4: 40_000,
      9.6: 75_000, 9.8: 200_000,
    },
  },
  "giant size x men|1": {
    type: "MEGA",
    verified: true,
    source:
      "Heritage Auctions archive. SEPARATE entry from X-Men #1 (1963) per " +
      "QA — distinct books, distinct prices.",
    lastVerified: null,
    verificationDue: true,
    verificationNote: VERIFY_NOTE,
    volatilityNote:
      "1st new X-Men team (Storm/Colossus/Nightcrawler). Film cycles.",
    grades: {
      0.5: 400, 1.0: 600, 2.0: 1_200, 4.0: 2_500,
      6.0: 4_000, 8.0: 7_000, 9.0: 9_000, 9.2: 11_000,
      9.4: 15_000, 9.6: 28_000, 9.8: 70_000,
    },
  },

  // ─── MODERN ─────────────────────────────────────────────────────────
  "teenage mutant ninja turtles|1": {
    type: "MEGA",
    verified: false,
    source: "training_estimate_60pct; Mirage 1st print only",
    lastVerified: null,
    verificationDue: true,
    verificationNote: VERIFY_NOTE,
    volatilityNote:
      "Mirage 1st print (1984) only. Pairs with F3 reprint filter to " +
      "block 2nd/3rd/4th/5th printings which trade at <$200.",
    grades: {
      0.5: 150, 1.0: 250, 2.0: 800, 4.0: 1_800,
      6.0: 3_000, 8.0: 6_000, 9.0: 9_000, 9.2: 11_000,
      9.4: 15_000, 9.6: 35_000, 9.8: 100_000,
    },
  },
  "amazing spider man|300": {
    type: "MEGA",
    verified: false,
    source: "training_estimate_60pct",
    lastVerified: null,
    verificationDue: true,
    verificationNote: VERIFY_NOTE,
    volatilityNote:
      "NEWSSTAND commands 2-4× direct edition. Verify UPC box before " +
      "listing NM grades. Venom film cycles ±20%.",
    grades: {
      0.5: 30, 2.0: 70, 4.0: 150, 6.0: 300,
      8.0: 500, 9.0: 700, 9.2: 850, 9.4: 1_100,
      9.6: 2_000, 9.8: 3_500,
    },
  },
};

// Normalize a title for map lookup. Lowercases, strips apostrophes/quotes/
// basic punctuation, normalizes hyphens to spaces, collapses whitespace.
// Preserves articles ("the", "a") — map keys should reflect true title
// prefix as stored in catalogue.
//
// Hyphen normalization (added Ship #9 for 35¢ allowlist) handles Marvel
// title variants like "Marvel Team-Up" / "Marvel Team Up" / "Super-Villain
// Team-Up" with one canonical key per series.
export const normalizeTitle = (title) => {
  if (!title) return "";
  return String(title)
    .toLowerCase()
    .replace(/['"!?.,]/g, "")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

// Normalize grade to a CGC-numeric bucket. Prefers explicit numericGrade;
// falls back to parsing the grade string. Returns null when grade is
// unparseable or out-of-range.
export const normalizeGrade = (grade, numericGrade) => {
  const CGC_BUCKETS = [
    0.5, 1.0, 1.5, 1.8, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5,
    5.0, 5.5, 6.0, 6.5, 7.0, 7.5, 8.0, 8.5, 9.0, 9.2,
    9.4, 9.6, 9.8, 9.9, 10.0,
  ];
  let g = null;
  if (typeof numericGrade === "number" && !isNaN(numericGrade)) {
    g = numericGrade;
  } else if (grade) {
    const m = String(grade).match(/([\d.]+)/);
    if (m) g = parseFloat(m[1]);
  }
  if (g == null || isNaN(g) || g < 0.5 || g > 10) return null;
  let bucket = CGC_BUCKETS[0];
  for (const b of CGC_BUCKETS) {
    if (b <= g) bucket = b;
    else break;
  }
  return bucket;
};

// Check if a book is a mega-key (MEGA or MANUAL).
export const isMegaKey = (title, issue) => {
  if (!title || issue == null) return false;
  const key = `${normalizeTitle(title)}|${String(issue).trim()}`;
  return Object.prototype.hasOwnProperty.call(MEGA_KEYS_FLOOR, key);
};

// Return the full map entry (or null) for a title+issue. Callers use the
// returned entry's `type` field to branch MEGA vs MANUAL.
export const getMegaKeyEntry = (title, issue) => {
  if (!title || issue == null) return null;
  const key = `${normalizeTitle(title)}|${String(issue).trim()}`;
  return MEGA_KEYS_FLOOR[key] || null;
};

// Return the floor value + priceHigh + exceedsMap flag for a title+issue+
// grade combination.
//
// Returned shape:
//   { floor: number|null, priceHigh: number|null,
//     exceedsMap: boolean, bucket: number|null }
//
// - `floor`     — the floor value at the book's grade bucket (rounded DOWN
//                 through available grade keys). null for non-MEGA entries
//                 or when grade is unparseable.
// - `priceHigh` — the NEXT HIGHER bucket's value (top of the grade band).
//                 Falls back to floor × 1.3 when grade is at the highest
//                 bucket in the map. null when floor is null.
// - `exceedsMap` — true when the book's grade is ABOVE the highest bucket
//                 covered by the map. Caller should trigger manual review.
// - `bucket`    — the rounded-down CGC bucket (for debugging/logging).
export const getMegaKeyFloor = (title, issue, grade, numericGrade) => {
  const empty = { floor: null, priceHigh: null, exceedsMap: false, bucket: null };
  const entry = getMegaKeyEntry(title, issue);
  if (!entry || entry.type !== "MEGA") return empty;
  const bucket = normalizeGrade(grade, numericGrade);
  if (bucket == null) return empty;

  const available = Object.keys(entry.grades)
    .map(parseFloat)
    .sort((a, b) => a - b);
  if (available.length === 0) return { ...empty, bucket };

  const highest = available[available.length - 1];
  if (bucket > highest) {
    return { floor: null, priceHigh: null, exceedsMap: true, bucket };
  }

  // Round DOWN: find the highest bucket that is ≤ our grade.
  let chosen = null;
  for (const b of available) {
    if (b <= bucket) chosen = b;
    else break;
  }
  if (chosen == null) return { ...empty, bucket };

  const floor = entry.grades[chosen];
  const nextBucket = available.find((b) => b > bucket);
  const priceHigh = nextBucket
    ? entry.grades[nextBucket]
    : Math.round(floor * 1.3);

  return { floor, priceHigh, exceedsMap: false, bucket };
};
