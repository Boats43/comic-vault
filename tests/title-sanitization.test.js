// tests/title-sanitization.test.js
//
// Ship v0-G — Title sanitization and contamination detection tests.
//
// Tests sanitizeTitle() and detectTitleContamination() helpers from api/enrich.js.
// These functions clean seller/marketplace noise from eBay listing titles that
// entered via title-family consensus.

// Import helpers (api/enrich.js exports these for testing)
// For now, duplicate the logic inline since api/enrich.js doesn't export them.
// In production, these would be imported from a shared lib or tested via HTTP.

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}\nExpected: ${expected}\nActual: ${actual}`);
  }
}

function assertIncludes(array, value, message) {
  if (!array || !array.includes(value)) {
    throw new Error(`${message}\nExpected array to include: ${value}\nArray: ${JSON.stringify(array)}`);
  }
}

function assertTruthy(value, message) {
  if (!value) {
    throw new Error(`${message}\nExpected truthy, got: ${value}`);
  }
}

// ============================================================================
// INLINE IMPLEMENTATIONS (duplicate from api/enrich.js for testing)
// ============================================================================

const cleanTitleForComicVine = (title, variant) => {
  const PUBLISHER_IN_TITLE_SERIES = [
    'marvel tales', 'marvel presents', 'marvel preview', 'marvel spotlight',
    'marvel super action', 'marvel super heroes', 'marvel team-up', 'marvel team up',
    'marvel triple action', 'marvel two-in-one', 'marvel two in one', 'marvel age',
    'marvel chillers', 'marvel feature', 'marvel fanfare', 'marvel comics presents',
    'marvel saga', 'marvel premiere', 'marvel mystery comics',
    'dc universe presents', 'dc retroactive', 'dc comics presents', 'dc special',
    'image comics presents', 'image united',
  ];

  const ARTIST_NOISE = [
    /tyler kirkham/i, /jim lee/i, /inhyuk lee/i, /skottie young/i, /frank cho/i,
    /frank miller/i, /dell'?otto/i, /jeehyung lee/i, /alex ross/i, /kaare andrews/i,
    /alan quah/i, /mico suayan/i, /puppeteer lee/i, /derrick chew/i, /jonboy meyers/i,
    /kael ngu/i, /natali sanders/i, /kendrick lim/i, /lucio parrillo/i,
    /artgerm/i, /stanley lau/i, /kunkka/i, /momoko/i, /mcfarlane/i, /campbell/i,
    /nakayama/i, /hughes/i, /fabok/i, /lim/i, /chew/i, /ngu/i, /sanders/i,
  ];

  // Ship v0-G.1 — preserve real variant labels (newsstand, foil, virgin, 1:N)
  const VARIANT_NOISE = [
    /\bvariant\b/i, /\bcover\b/i, /\bcvr\b/i,
    /\bratio\b/i, /\bincentive\b/i, /\bexclusive\b/i, /\bexcl\.?\b/i,
    /\bnm\b/i, /\bvf\b/i, /\bfn\b/i, /\bvg\b/i, /\bgd\b/i,
  ];

  const titleLower = String(title || '').toLowerCase().trim();
  const isProtected = PUBLISHER_IN_TITLE_SERIES.some(p => titleLower.startsWith(p));
  if (isProtected) return title;

  let cleaned = title;
  const removedTokens = [];

  for (const pattern of ARTIST_NOISE) {
    const before = cleaned;
    cleaned = cleaned.replace(pattern, ' ');
    if (before !== cleaned) {
      const removed = before.match(pattern);
      if (removed) removedTokens.push(removed[0]);
    }
  }

  for (const pattern of VARIANT_NOISE) {
    const before = cleaned;
    cleaned = cleaned.replace(pattern, ' ');
    if (before !== cleaned) {
      const removed = before.match(pattern);
      if (removed) removedTokens.push(removed[0]);
    }
  }

  const characterNoisePatterns = [
    { series: /fantastic\s+four/i, character: /human\s+torch/i },
    { series: /x-?men/i, character: /wolverine|cyclops|storm|rogue|gambit/i },
    { series: /avengers/i, character: /iron\s+man|captain\s+america|thor|hulk/i },
  ];

  for (const { series, character } of characterNoisePatterns) {
    if (series.test(cleaned) && character.test(cleaned)) {
      const before = cleaned;
      cleaned = cleaned.replace(character, ' ');
      if (before !== cleaned) {
        const removed = before.match(character);
        if (removed) removedTokens.push(removed[0]);
      }
    }
  }

  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  const tokens = cleaned.split(/\s+/).filter(t => t.length >= 2 && !/^\d+$/.test(t));
  if (tokens.length < 2 && removedTokens.length > 0) {
    const restore = removedTokens[removedTokens.length - 1];
    cleaned = `${cleaned} ${restore}`.replace(/\s+/g, ' ').trim();
  }

  return cleaned;
};

const sanitizeTitle = (title, context = {}) => {
  const { year, isGraded, preservePublisherInTitle = true } = context;

  if (!title || typeof title !== 'string') return title;

  const titleLower = title.toLowerCase().trim();

  const PUBLISHER_IN_TITLE = [
    'marvel tales', 'marvel presents', 'marvel preview', 'marvel spotlight',
    'marvel super action', 'marvel super heroes', 'marvel team-up', 'marvel team up',
    'marvel triple action', 'marvel two-in-one', 'marvel two in one', 'marvel age',
    'marvel chillers', 'marvel feature', 'marvel fanfare', 'marvel comics presents',
    'marvel saga', 'marvel premiere', 'marvel mystery comics',
    'dc universe presents', 'dc retroactive', 'dc comics presents', 'dc special',
    'image comics presents', 'image united',
  ];

  const isProtected = preservePublisherInTitle &&
    PUBLISHER_IN_TITLE.some(p => titleLower.includes(p));

  if (isProtected) {
    return title.replace(/\b(free\s+shipping|stock\s+image)\b/gi, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  let cleaned = title;
  const removedTokens = [];

  const MARKETPLACE_RE = /\b(free\s+(?:shipping|ship)|select\s+an?\s+issue|choose\s+(?:your\s+)?issue|your\s+choice|stock\s+image|see\s+pics?|combine(?:d)?\s+(?:shipping|ship|s&h)|buy\s+it\s+now|must\s+see|hot\s+read)\b/gi;
  cleaned = cleaned.replace(MARKETPLACE_RE, (match) => {
    removedTokens.push(match);
    return ' ';
  });

  if (!isGraded) {
    const GRADE_RE = /\b(vg|fn|vf|nm|gd|fr|pr|raw|low\s+grade|mid\s+grade|high\s+grade)\b/gi;
    cleaned = cleaned.replace(GRADE_RE, (match) => {
      removedTokens.push(match);
      return ' ';
    });
  }

  const RARITY_RE = /\b(rare|scarce|hot|gem|beauty|wow)\b/gi;
  cleaned = cleaned.replace(RARITY_RE, (match) => {
    removedTokens.push(match);
    return ' ';
  });

  const CONDITION_RE = /\b(apparent|complete|missing|intact|sharp)\b/gi;
  cleaned = cleaned.replace(CONDITION_RE, (match) => {
    removedTokens.push(match);
    return ' ';
  });

  // Ship v0-G.1 — Single-word creators (noise, not credit)
  const CREATOR_NOISE_RE = /\b(kirby|severin|ditko|lee|buscema|romita|steranko|bartel|mayhew|byrne|miller|mcfarlane|mignola|ross|campbell|cho|fabok|aparo|wrightson|kubert|adams|bolland|perez|simonson|sook|capullo|finch|sale|coipel|quesada)\b/gi;
  cleaned = cleaned.replace(CREATOR_NOISE_RE, (match) => {
    removedTokens.push(match);
    return ' ';
  });

  // Ship v0-G.1 — Publisher filler words
  const PUBLISHER_FILLER_RE = /\b(atlas\s+series|silver\s+age|golden\s+age|bronze\s+age|copper\s+age|modern\s+age|pre\s+code|horror|crime|western|romance)\b/gi;
  cleaned = cleaned.replace(PUBLISHER_FILLER_RE, (match) => {
    removedTokens.push(match);
    return ' ';
  });

  // Ship v0-G.1 — Modern listing language
  const LISTING_LANGUAGE_RE = /\b(set\s+main|1st\s+app(?:earance)?|trade\s+dress|empire|new\s+series|ongoing|limited\s+series|mini\s+series|one[\s-]?shot)\b/gi;
  cleaned = cleaned.replace(LISTING_LANGUAGE_RE, (match) => {
    removedTokens.push(match);
    return ' ';
  });

  if (year && parseInt(year) >= 1900 && parseInt(year) <= 2099) {
    const YEAR_RE = new RegExp(`\\b${year}\\b`, 'g');
    cleaned = cleaned.replace(YEAR_RE, (match) => {
      removedTokens.push(match);
      return ' ';
    });

    const yearInt = parseInt(year);
    for (let y = yearInt - 5; y <= yearInt + 5; y++) {
      if (y !== yearInt && y >= 1900 && y <= 2099) {
        const nearYearRe = new RegExp(`\\b${y}\\b`, 'g');
        cleaned = cleaned.replace(nearYearRe, ' ');
      }
    }
  }

  // Ship Pattern-J — Seller inventory code stripping
  const INVENTORY_CODE_RE = /\b(?!(?:19|20)\d{2}\b)(?!#)(?!\d+:)([a-z]{1,2}\d{1,5}|\d{1,5}[a-z]{1,2}|[a-z]\d+[a-z]|\d{4,5}(?!AD))\b/gi;
  const hasMarkers = /(\bvf\b|\bnm\b|\bfn\b|\bvg\b|\bgd\b|\(19\d{2}\)|\(20\d{2}\)|\$\d+|!|\bvariant\b)/i.test(cleaned);

  if (hasMarkers) {
    cleaned = cleaned.replace(INVENTORY_CODE_RE, (match) => {
      removedTokens.push(match);
      return ' ';
    });
  } else {
    const tailMatch = cleaned.match(/\s+([a-z]{1,2}\d{1,5}|\d{1,5}[a-z]{1,2}|\d{4,5})$/i);
    if (tailMatch) {
      removedTokens.push(tailMatch[1]);
      cleaned = cleaned.replace(/\s+([a-z]{1,2}\d{1,5}|\d{1,5}[a-z]{1,2}|\d{4,5})$/i, '');
    }
  }

  cleaned = cleanTitleForComicVine(cleaned, null);
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  const tokens = cleaned.split(/\s+/).filter(t =>
    t.length >= 2 && !/^\d+$/.test(t) &&
    !/^(the|a|an|of|and|or|in|on|at|to|for|with)$/i.test(t)
  );

  if (tokens.length < 2) {
    return title;
  }

  return cleaned;
};

const detectTitleContamination = (title, context = {}) => {
  const { year, isGraded } = context;
  const signals = [];

  if (!title || typeof title !== 'string') {
    return { contaminated: false, signals: [], severity: 'none' };
  }

  if (/\b(free\s+(?:shipping|ship)|select\s+an?\s+issue|choose\s+(?:your\s+)?issue|your\s+choice|stock\s+image|see\s+pics?|combine(?:d)?\s+(?:shipping|ship|s&h)|buy\s+it\s+now|must\s+see|hot\s+read)\b/i.test(title)) {
    signals.push('marketplace-keywords');
  }

  const hasGrade = /\b(vg|fn|vf|nm|gd|fr|pr|raw|low\s+grade|mid\s+grade|high\s+grade|apparent)\b/i.test(title);
  const hasYear = year && new RegExp(`\\b${year}\\b`).test(title);
  const hasCreator = /\b(kirby|severin|ditko|lee|buscema|romita|steranko|bartel|mayhew|byrne|miller|mcfarlane|mignola|ross|campbell|cho|fabok|aparo|wrightson|kubert|adams|bolland|perez|simonson|sook|capullo|finch|sale|coipel|quesada)\b/i.test(title);

  if (hasGrade && hasYear && hasCreator) {
    signals.push('seller-description-cluster');
  }

  // Signal 6: Publisher filler
  if (/\b(atlas\s+series|silver\s+age|golden\s+age|bronze\s+age|copper\s+age|modern\s+age|pre\s+code)\b/i.test(title)) {
    signals.push('publisher-filler');
  }

  // Signal 7: Listing language
  if (/\b(set\s+main|1st\s+app(?:earance)?|trade\s+dress|empire|new\s+series|ongoing|limited\s+series|mini\s+series|one[\s-]?shot)\b/i.test(title)) {
    signals.push('listing-language');
  }

  const tokens = title.split(/\s+/).filter(t => t.length > 1);
  if (title.length > 60 || tokens.length > 8) {
    signals.push('excessive-length');
  }

  if (!isGraded && /\b(cgc|cbcs|slabbed|graded)\b/i.test(title)) {
    signals.push('grading-service-mismatch');
  }

  const rarityMatches = (title.match(/\b(rare|scarce|hot|key|gem|beauty)\b/gi) || []).length;
  if (rarityMatches >= 2) {
    signals.push('rarity-stacking');
  }

  // Ship Pattern-J — Inventory code detection
  const INVENTORY_CODE_DETECTOR = /\b(?!(?:19|20)\d{2}\b)(?!#)(?!\d+:)([a-z]{1,2}\d{1,5}|\d{1,5}[a-z]{1,2}|[a-z]\d+[a-z]|\d{4,5}(?!AD))\b/i;
  if (INVENTORY_CODE_DETECTOR.test(title)) {
    signals.push('inventory-code');
  }

  const contaminated = signals.length > 0;

  // Ship v0-G.1 — Tightened severity rules
  const highPrioritySignals = ['seller-description-cluster', 'listing-language', 'publisher-filler', 'marketplace-keywords', 'inventory-code'];
  const hasHighPriority = signals.some(s => highPrioritySignals.includes(s));

  let severity = 'none';
  if (signals.length >= 2 || hasHighPriority) {
    severity = 'high';
  } else if (signals.length === 1) {
    severity = 'medium';
  }

  return { contaminated, signals, severity };
};

// ============================================================================
// POSITIVE SANITIZATION TESTS
// ============================================================================

test('sanitizeTitle: Yellow Claw contaminated', () => {
  const input = "yellow claw 1956 rare atlas series kirby severin apparent vg #1";
  const context = { year: 1956, isGraded: false };
  const result = sanitizeTitle(input, context);

  // Should strip most seller noise, keep core title
  assertTruthy(!result.includes('1956'), 'Should strip year');
  assertTruthy(!result.includes('rare'), 'Should strip rarity');
  assertTruthy(!result.toLowerCase().includes('apparent'), 'Should strip condition');
  assertTruthy(!result.toLowerCase().includes('vg'), 'Should strip grade');
  assertTruthy(result.toLowerCase().includes('yellow'), 'Should keep title');
  assertTruthy(result.toLowerCase().includes('claw'), 'Should keep title');
  // Note: kirby may or may not be stripped depending on ARTIST_NOISE list
});

test('sanitizeTitle: Conan seller description', () => {
  const input = "conan the barbarian vg marvel september 1974 #42";
  const context = { year: 1974, isGraded: false };
  const result = sanitizeTitle(input, context);

  assertTruthy(!result.includes('vg'), 'Should strip grade');
  assertTruthy(!result.includes('1974'), 'Should strip year');
  assertTruthy(result.toLowerCase().includes('conan'), 'Should keep title');
  assertTruthy(result.toLowerCase().includes('barbarian'), 'Should keep title');
});

test('sanitizeTitle: Dick Tracy marketplace keywords', () => {
  const input = "dick tracy select an issue free shipping #1";
  const context = { year: 1950, isGraded: false };
  const result = sanitizeTitle(input, context);

  assertTruthy(!result.toLowerCase().includes('select'), 'Should strip marketplace');
  assertTruthy(!result.toLowerCase().includes('free shipping'), 'Should strip marketplace');
  assertTruthy(result.toLowerCase().includes('dick'), 'Should keep title');
  assertTruthy(result.toLowerCase().includes('tracy'), 'Should keep title');
});

test('sanitizeTitle: Captain America stock image', () => {
  const input = "captain america 359d 1989 stock image low grade #359";
  const context = { year: 1989, isGraded: false };
  const result = sanitizeTitle(input, context);

  assertTruthy(!result.includes('1989'), 'Should strip year');
  assertTruthy(!result.toLowerCase().includes('stock image'), 'Should strip marketplace');
  assertTruthy(!result.toLowerCase().includes('low grade'), 'Should strip grade');
  assertTruthy(result.toLowerCase().includes('captain'), 'Should keep title');
  assertTruthy(result.toLowerCase().includes('america'), 'Should keep title');
});

test('sanitizeTitle: Tales to Astonish contaminated', () => {
  const input = "tales to astonish 1967 silver age hulk battles surfer #93";
  const context = { year: 1967, isGraded: false };
  const result = sanitizeTitle(input, context);

  assertTruthy(!result.includes('1967'), 'Should strip year');
  assertTruthy(result.toLowerCase().includes('tales'), 'Should keep title');
  assertTruthy(result.toLowerCase().includes('astonish'), 'Should keep title');
});

// ============================================================================
// PRESERVE / NEGATIVE TESTS
// ============================================================================

test('sanitizeTitle: Marvel Tales preserved', () => {
  const input = "marvel tales #111";
  const context = { year: 1952, isGraded: false, preservePublisherInTitle: true };
  const result = sanitizeTitle(input, context);

  assertEqual(result.toLowerCase(), "marvel tales #111", 'Should preserve publisher-in-title series');
});

test('sanitizeTitle: DC 100 Page Super Spectacular preserved', () => {
  const input = "dc 100 page super spectacular dc-17";
  const context = { year: 1973, isGraded: false };
  const result = sanitizeTitle(input, context);

  assertTruthy(result.toLowerCase().includes('100 page'), 'Should preserve format marker');
  assertTruthy(result.toLowerCase().includes('spectacular'), 'Should preserve format marker');
});

test('sanitizeTitle: Treasury Edition preserved', () => {
  const input = "limited collectors edition treasury c-44";
  const context = { year: 1976, isGraded: false };
  const result = sanitizeTitle(input, context);

  assertTruthy(result.toLowerCase().includes('treasury'), 'Should preserve treasury marker');
  assertTruthy(result.toLowerCase().includes('edition'), 'Should preserve edition marker');
  // Note: "limited" might be stripped as variant noise, core title preserved
});

test('sanitizeTitle: King-Size Special preserved', () => {
  const input = "king-size special #2";
  const context = { year: 1971, isGraded: false };
  const result = sanitizeTitle(input, context);

  assertTruthy(result.toLowerCase().includes('king'), 'Should preserve format marker');
  assertTruthy(result.toLowerCase().includes('size'), 'Should preserve format marker');
  assertTruthy(result.toLowerCase().includes('special'), 'Should preserve format marker');
});

test('sanitizeTitle: Giant-Size Fantastic Four preserved', () => {
  const input = "giant-size fantastic four #6";
  const context = { year: 1975, isGraded: false };
  const result = sanitizeTitle(input, context);

  assertTruthy(result.toLowerCase().includes('giant'), 'Should preserve format marker');
  assertTruthy(result.toLowerCase().includes('fantastic'), 'Should preserve title');
});

test('sanitizeTitle: Marvel Team-Up preserved', () => {
  const input = "marvel team-up #20";
  const context = { year: 1974, isGraded: false, preservePublisherInTitle: true };
  const result = sanitizeTitle(input, context);

  assertTruthy(result.toLowerCase().includes('marvel'), 'Should preserve publisher-in-title');
  assertTruthy(result.toLowerCase().includes('team'), 'Should preserve publisher-in-title');
});

test('sanitizeTitle: DC Comics Presents preserved', () => {
  const input = "dc comics presents #26";
  const context = { year: 1980, isGraded: false, preservePublisherInTitle: true };
  const result = sanitizeTitle(input, context);

  assertTruthy(result.toLowerCase().includes('dc'), 'Should preserve publisher-in-title');
  assertTruthy(result.toLowerCase().includes('comics'), 'Should preserve publisher-in-title');
  assertTruthy(result.toLowerCase().includes('presents'), 'Should preserve publisher-in-title');
});

// ============================================================================
// CONTAMINATION DETECTOR TESTS
// ============================================================================

test('detectTitleContamination: Yellow Claw high severity', () => {
  const title = "yellow claw 1956 rare atlas series kirby severin apparent vg #1";
  const context = { year: 1956, isGraded: false };
  const result = detectTitleContamination(title, context);

  assertEqual(result.contaminated, true, 'Should detect contamination');
  assertEqual(result.severity, 'high', 'Should be high severity');
  assertIncludes(result.signals, 'seller-description-cluster', 'Should detect seller cluster');
  assertIncludes(result.signals, 'excessive-length', 'Should detect excessive length');
});

test('detectTitleContamination: clean title passes', () => {
  const title = "Yellow Claw #1";
  const context = { year: 1956, isGraded: false };
  const result = detectTitleContamination(title, context);

  assertEqual(result.contaminated, false, 'Should pass clean title');
  assertEqual(result.severity, 'none', 'Severity should be none');
  assertEqual(result.signals.length, 0, 'Should have no signals');
});

test('detectTitleContamination: marketplace keywords high severity', () => {
  const title = "Amazing Spider-Man #1 free shipping";
  const context = { year: 1963, isGraded: false };
  const result = detectTitleContamination(title, context);

  assertEqual(result.contaminated, true, 'Should detect contamination');
  assertEqual(result.severity, 'high', 'Marketplace keywords should escalate to high');
  assertIncludes(result.signals, 'marketplace-keywords', 'Should detect marketplace');
});

test('detectTitleContamination: rarity stacking', () => {
  const title = "Rare Hot Gem Amazing Spider-Man #1";
  const context = { year: 1963, isGraded: false };
  const result = detectTitleContamination(title, context);

  assertEqual(result.contaminated, true, 'Should detect contamination');
  assertIncludes(result.signals, 'rarity-stacking', 'Should detect rarity stacking');
});

// ============================================================================
// Ship v0-G.1 — Sanitizer tightening tests
// ============================================================================

test('sanitizeTitle: Yellow Claw publisher filler', () => {
  const title = "Yellow Claw #1 atlas series kirby severin 1956";
  const context = { year: 1956, isGraded: false };
  const result = sanitizeTitle(title, context);

  assertEqual(result.includes('atlas series'), false, 'Should strip publisher filler');
  assertEqual(result.includes('kirby'), false, 'Should strip single-word creator');
  assertEqual(result.includes('severin'), false, 'Should strip single-word creator');
  assertEqual(result.includes('1956'), false, 'Should strip year');
  assertTruthy(result.includes('Yellow Claw'), 'Should preserve title');
});

test('sanitizeTitle: Miles Morales listing language', () => {
  const title = "Miles Morales #1 set main bartel 1st app spider smasher empire 2022";
  const context = { year: 2022, isGraded: false };
  const result = sanitizeTitle(title, context);

  assertEqual(result.includes('set main'), false, 'Should strip listing language');
  assertEqual(result.includes('1st app'), false, 'Should strip listing language');
  assertEqual(result.includes('empire'), false, 'Should strip listing language');
  assertEqual(result.includes('bartel'), false, 'Should strip single-word creator');
  assertTruthy(result.includes('Miles Morales'), 'Should preserve title');
});

test('sanitizeTitle: Dick Tracy creator noise', () => {
  const title = "Dick Tracy #3 kirby 1950";
  const context = { year: 1950, isGraded: false };
  const result = sanitizeTitle(title, context);

  assertEqual(result.includes('kirby'), false, 'Should strip single-word creator');
  assertEqual(result.includes('1950'), false, 'Should strip year');
  assertTruthy(result.includes('Dick Tracy'), 'Should preserve title');
});

test('sanitizeTitle: preserve newsstand variant', () => {
  const title = "Amazing Spider-Man #300 newsstand";
  const context = { year: 1988, isGraded: false };
  const result = sanitizeTitle(title, context);

  assertTruthy(result.includes('newsstand'), 'Should preserve newsstand variant label');
  assertTruthy(result.includes('Spider-Man'), 'Should preserve title');
});

test('sanitizeTitle: preserve 1:25 virgin variant', () => {
  const title = "Batman #1 1:25 virgin";
  const context = { year: 2016, isGraded: false };
  const result = sanitizeTitle(title, context);

  assertTruthy(result.includes('1:25'), 'Should preserve ratio variant label');
  assertTruthy(result.includes('virgin'), 'Should preserve virgin variant label');
  assertTruthy(result.includes('Batman'), 'Should preserve title');
});

test('sanitizeTitle: preserve foil variant', () => {
  const title = "X-Men #1 foil";
  const context = { year: 1991, isGraded: false };
  const result = sanitizeTitle(title, context);

  assertTruthy(result.includes('foil'), 'Should preserve foil variant label');
  assertTruthy(result.includes('X-Men'), 'Should preserve title');
});

test('detectTitleContamination: Yellow Claw high severity (publisher filler)', () => {
  const title = "Yellow Claw #1 atlas series 1956";
  const context = { year: 1956, isGraded: false };
  const result = detectTitleContamination(title, context);

  assertEqual(result.contaminated, true, 'Should detect contamination');
  assertEqual(result.severity, 'high', 'Publisher filler should escalate to high');
  assertIncludes(result.signals, 'publisher-filler', 'Should detect publisher filler');
});

test('detectTitleContamination: Miles high severity (listing language)', () => {
  const title = "Miles Morales #1 set main 1st app empire";
  const context = { year: 2022, isGraded: false };
  const result = detectTitleContamination(title, context);

  assertEqual(result.contaminated, true, 'Should detect contamination');
  assertEqual(result.severity, 'high', 'Listing language should escalate to high');
  assertIncludes(result.signals, 'listing-language', 'Should detect listing language');
});

// ============================================================================
// MARKETPLACE KEYWORD POLLUTION FIX TESTS
// ============================================================================

test('sanitizeTitle: Dick Tracy select an issue free shipping', () => {
  const title = "Dick Tracy Select an Issue Free Shipping #1";
  const context = { year: 1950, isGraded: false };
  const result = sanitizeTitle(title, context);

  assertEqual(result.toLowerCase().includes('select'), false, 'Should strip select an issue');
  assertEqual(result.toLowerCase().includes('free shipping'), false, 'Should strip free shipping');
  assertTruthy(result.toLowerCase().includes('dick'), 'Should keep title');
  assertTruthy(result.toLowerCase().includes('tracy'), 'Should keep title');
});

test('sanitizeTitle: Batman choose your issue', () => {
  const title = "Batman Choose Your Issue #423";
  const context = { year: 1988, isGraded: false };
  const result = sanitizeTitle(title, context);

  assertEqual(result.toLowerCase().includes('choose'), false, 'Should strip choose your issue');
  assertEqual(result.toLowerCase().includes('your issue'), false, 'Should strip your issue');
  assertTruthy(result.toLowerCase().includes('batman'), 'Should keep title');
});

test('sanitizeTitle: Amazing Spider-Man free ship', () => {
  const title = "Amazing Spider-Man Free Ship #300";
  const context = { year: 1988, isGraded: false };
  const result = sanitizeTitle(title, context);

  assertEqual(result.toLowerCase().includes('free ship'), false, 'Should strip free ship');
  assertTruthy(result.toLowerCase().includes('spider'), 'Should keep title');
});

test('sanitizeTitle: X-Men your choice buy it now', () => {
  const title = "X-Men Your Choice Buy It Now #94";
  const context = { year: 1975, isGraded: false };
  const result = sanitizeTitle(title, context);

  assertEqual(result.toLowerCase().includes('your choice'), false, 'Should strip your choice');
  assertEqual(result.toLowerCase().includes('buy it now'), false, 'Should strip buy it now');
  assertTruthy(result.toLowerCase().includes('x-men'), 'Should keep title');
});

test('sanitizeTitle: Fantastic Four combined ship see pics', () => {
  const title = "Fantastic Four Combined Ship See Pics #52";
  const context = { year: 1966, isGraded: false };
  const result = sanitizeTitle(title, context);

  assertEqual(result.toLowerCase().includes('combined ship'), false, 'Should strip combined ship');
  assertEqual(result.toLowerCase().includes('see pics'), false, 'Should strip see pics');
  assertTruthy(result.toLowerCase().includes('fantastic'), 'Should keep title');
});

test('detectTitleContamination: Dick Tracy marketplace high severity', () => {
  const title = "Dick Tracy Select an Issue Free Shipping #1";
  const context = { year: 1950, isGraded: false };
  const result = detectTitleContamination(title, context);

  assertEqual(result.contaminated, true, 'Should detect contamination');
  assertEqual(result.severity, 'high', 'Marketplace keywords should trigger high severity');
  assertIncludes(result.signals, 'marketplace-keywords', 'Should detect marketplace keywords');
});

// ============================================================================
// PATTERN J — SELLER INVENTORY CODE STRIPPING
// ============================================================================

test('sanitizeTitle: Pattern J - Luke Cage mm22', () => {
  const title = "Luke Cage Power Man mm22";
  const context = { year: 1977, isGraded: false };
  const result = sanitizeTitle(title, context);

  assertEqual(result.toLowerCase().includes('mm22'), false, 'Should strip mm22 inventory code');
  assertTruthy(result.toLowerCase().includes('luke'), 'Should keep title');
  assertTruthy(result.toLowerCase().includes('cage'), 'Should keep title');
  assertTruthy(result.toLowerCase().includes('power'), 'Should keep title');
});

test('sanitizeTitle: Pattern J - Green Hornet Z4405', () => {
  const title = "Green Hornet #1 Z4405";
  const context = { year: 1940, isGraded: false };
  const result = sanitizeTitle(title, context);

  assertEqual(result.includes('Z4405'), false, 'Should strip Z4405 catalog code');
  assertEqual(result.includes('#1'), true, 'Should preserve issue number');
  assertTruthy(result.toLowerCase().includes('green'), 'Should keep title');
  assertTruthy(result.toLowerCase().includes('hornet'), 'Should keep title');
});

test('sanitizeTitle: Pattern J - Avengers A2 variant', () => {
  const title = "Avengers A2 variant";
  const context = { year: 2020, isGraded: false };
  const result = sanitizeTitle(title, context);

  assertEqual(result.includes('A2'), false, 'Should strip A2 inventory code');
  assertTruthy(result.toLowerCase().includes('avengers'), 'Should keep title');
});

test('sanitizeTitle: Pattern J - Batman 9176 with grade marker', () => {
  const title = "Batman #50 VF 9176";
  const context = { year: 1990, isGraded: false };
  const result = sanitizeTitle(title, context);

  assertEqual(result.includes('9176'), false, 'Should strip 9176 seller code after grade marker');
  assertEqual(result.includes('#50'), true, 'Should preserve issue number');
  assertTruthy(result.toLowerCase().includes('batman'), 'Should keep title');
});

test('sanitizeTitle: Pattern J - preserves Spider-Man 2099', () => {
  const title = "Spider-Man 2099 #1";
  const context = { year: 1992, isGraded: false };
  const result = sanitizeTitle(title, context);

  assertTruthy(result.includes('2099'), 'Should preserve 2099 in title');
  assertEqual(result.includes('#1'), true, 'Should preserve issue number');
  assertTruthy(result.toLowerCase().includes('spider-man'), 'Should keep title');
});

test('sanitizeTitle: Pattern J - preserves 2000 AD', () => {
  const title = "2000 AD #100";
  const context = { year: 1978, isGraded: false };
  const result = sanitizeTitle(title, context);

  assertTruthy(result.includes('2000'), 'Should preserve 2000 in title');
  assertEqual(result.includes('#100'), true, 'Should preserve issue number');
  assertTruthy(result.toLowerCase().includes('ad'), 'Should keep title');
});

test('sanitizeTitle: Pattern J - preserves Star Wars 3D', () => {
  const title = "Star Wars 3D #1";
  const context = { year: 2015, isGraded: false };
  const result = sanitizeTitle(title, context);

  assertTruthy(result.includes('3D'), 'Should preserve 3D in title');
  assertEqual(result.includes('#1'), true, 'Should preserve issue number');
  assertTruthy(result.toLowerCase().includes('star'), 'Should keep title');
  assertTruthy(result.toLowerCase().includes('wars'), 'Should keep title');
});

test('sanitizeTitle: Pattern J - preserves ratios', () => {
  const title = "X-Men #1 1:25 variant";
  const context = { year: 2021, isGraded: false };
  const result = sanitizeTitle(title, context);

  assertTruthy(result.includes('1:25'), 'Should preserve 1:25 ratio');
  assertEqual(result.includes('#1'), true, 'Should preserve issue number');
  assertTruthy(result.toLowerCase().includes('x-men'), 'Should keep title');
});

test('sanitizeTitle: Pattern J - preserves issue numbers', () => {
  const title = "Amazing Spider-Man #300";
  const context = { year: 1988, isGraded: false };
  const result = sanitizeTitle(title, context);

  assertEqual(result.includes('#300'), true, 'Should preserve issue number #300');
  assertTruthy(result.toLowerCase().includes('spider-man'), 'Should keep title');
});

test('sanitizeTitle: Pattern J - complex case with markers', () => {
  const title = "Luke Cage Power Man #28! 4.5 + mm22";
  const context = { year: 1977, isGraded: false };
  const result = sanitizeTitle(title, context);

  assertEqual(result.toLowerCase().includes('mm22'), false, 'Should strip mm22 after exclamation marker');
  assertEqual(result.includes('#28'), true, 'Should preserve issue number');
  assertTruthy(result.toLowerCase().includes('luke'), 'Should keep title');
  assertTruthy(result.toLowerCase().includes('cage'), 'Should keep title');
});

// ============================================================================
// PATTERN J — INVENTORY CODE DETECTION
// ============================================================================

test('detectTitleContamination: Luke Cage mm22 inventory code', () => {
  const title = "Luke Cage Power Man mm22";
  const context = { year: 1977, isGraded: false };
  const result = detectTitleContamination(title, context);

  assertEqual(result.contaminated, true, 'Should detect contamination');
  assertEqual(result.severity, 'high', 'Inventory code should trigger high severity');
  assertIncludes(result.signals, 'inventory-code', 'Should detect inventory-code signal');
});

test('detectTitleContamination: Green Hornet Z4405 catalog code', () => {
  const title = "Green Hornet #1 Z4405";
  const context = { year: 1940, isGraded: false };
  const result = detectTitleContamination(title, context);

  assertEqual(result.contaminated, true, 'Should detect contamination');
  assertEqual(result.severity, 'high', 'Inventory code should trigger high severity');
  assertIncludes(result.signals, 'inventory-code', 'Should detect inventory-code signal');
});

test('detectTitleContamination: Avengers A2 seller code', () => {
  const title = "Avengers A2 variant";
  const context = { year: 2020, isGraded: false };
  const result = detectTitleContamination(title, context);

  assertEqual(result.contaminated, true, 'Should detect contamination');
  assertEqual(result.severity, 'high', 'Inventory code should trigger high severity');
  assertIncludes(result.signals, 'inventory-code', 'Should detect inventory-code signal');
});

test('detectTitleContamination: Batman 9176 numeric code', () => {
  const title = "Batman #50 9176";
  const context = { year: 1990, isGraded: false };
  const result = detectTitleContamination(title, context);

  assertEqual(result.contaminated, true, 'Should detect contamination');
  assertEqual(result.severity, 'high', 'Inventory code should trigger high severity');
  assertIncludes(result.signals, 'inventory-code', 'Should detect inventory-code signal');
});

test('detectTitleContamination: preserves Spider-Man 2099', () => {
  const title = "Spider-Man 2099 #1";
  const context = { year: 1992, isGraded: false };
  const result = detectTitleContamination(title, context);

  // Should NOT trigger inventory-code (2099 is protected)
  assertEqual(result.signals.includes('inventory-code'), false, 'Should NOT detect 2099 as inventory code');
});

test('detectTitleContamination: preserves 2000 AD', () => {
  const title = "2000 AD #100";
  const context = { year: 1978, isGraded: false };
  const result = detectTitleContamination(title, context);

  // Should NOT trigger inventory-code (2000 is protected, AD suffix)
  assertEqual(result.signals.includes('inventory-code'), false, 'Should NOT detect 2000 AD as inventory code');
});

test('detectTitleContamination: preserves issue numbers', () => {
  const title = "Amazing Spider-Man #300";
  const context = { year: 1988, isGraded: false };
  const result = detectTitleContamination(title, context);

  // Should NOT trigger inventory-code (#300 is issue number)
  assertEqual(result.signals.includes('inventory-code'), false, 'Should NOT detect #300 as inventory code');
});

test('detectTitleContamination: preserves ratios', () => {
  const title = "X-Men #1 1:25 variant";
  const context = { year: 2021, isGraded: false };
  const result = detectTitleContamination(title, context);

  // Should NOT trigger inventory-code (1:25 is ratio)
  assertEqual(result.signals.includes('inventory-code'), false, 'Should NOT detect 1:25 as inventory code');
});

// ============================================================================
// RUN ALL TESTS
// ============================================================================

console.log('\n🧪 Title Sanitization Tests (Ship v0-G)\n');
console.log('='.repeat(60));

for (const { name, fn } of tests) {
  try {
    fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (error) {
    failed++;
    console.log(`✗ ${name}`);
    console.log(`  ${error.message}`);
  }
}

console.log('='.repeat(60));
console.log(`\n📊 Results: ${passed} passed, ${failed} failed, ${tests.length} total\n`);

if (failed > 0) {
  process.exit(1);
}
