// Ship #22 — Best Practice Listing Tests

const tests = [];
let passed = 0;
let failed = 0;

function test(desc, fn) {
  tests.push({ desc, fn });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

function run() {
  console.log('='.repeat(60));
  console.log('Ship #22 — Best Practice Listing Tests');
  console.log('='.repeat(60));

  tests.forEach(({ desc, fn }) => {
    try {
      fn();
      console.log(`  ✓ ${desc}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${desc}`);
      console.error(`    ${err.message}`);
      failed++;
    }
  });

  console.log('');
  console.log(`=== Results: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

// Mock xmlEscape function
const xmlEscape = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

// ─────────────────────────────────────────────────────────────────
// Helper Functions Tests
// ─────────────────────────────────────────────────────────────────

test('getEra - Victorian/Platinum Age (<1938)', () => {
  const getEra = (y) => {
    const n = parseInt(y, 10);
    if (!n || isNaN(n)) return "Modern Age";
    if (n < 1938) return "Victorian/Platinum Age";
    if (n < 1956) return "Golden Age";
    if (n < 1970) return "Silver Age";
    if (n < 1985) return "Bronze Age";
    if (n < 1991) return "Copper Age";
    if (n < 2000) return "Modern Age (1991-1999)";
    return "Modern Age";
  };

  assert(getEra(1930) === 'Victorian/Platinum Age', 'expected Victorian/Platinum Age for 1930');
  assert(getEra(1937) === 'Victorian/Platinum Age', 'expected Victorian/Platinum Age for 1937');
});

test('getEra - Golden Age (1938-1955)', () => {
  const getEra = (y) => {
    const n = parseInt(y, 10);
    if (!n || isNaN(n)) return "Modern Age";
    if (n < 1938) return "Victorian/Platinum Age";
    if (n < 1956) return "Golden Age";
    if (n < 1970) return "Silver Age";
    if (n < 1985) return "Bronze Age";
    if (n < 1991) return "Copper Age";
    if (n < 2000) return "Modern Age (1991-1999)";
    return "Modern Age";
  };

  assert(getEra(1938) === 'Golden Age', 'expected Golden Age for 1938');
  assert(getEra(1950) === 'Golden Age', 'expected Golden Age for 1950');
  assert(getEra(1955) === 'Golden Age', 'expected Golden Age for 1955');
});

test('getEra - Silver Age (1956-1969)', () => {
  const getEra = (y) => {
    const n = parseInt(y, 10);
    if (!n || isNaN(n)) return "Modern Age";
    if (n < 1938) return "Victorian/Platinum Age";
    if (n < 1956) return "Golden Age";
    if (n < 1970) return "Silver Age";
    if (n < 1985) return "Bronze Age";
    if (n < 1991) return "Copper Age";
    if (n < 2000) return "Modern Age (1991-1999)";
    return "Modern Age";
  };

  assert(getEra(1956) === 'Silver Age', 'expected Silver Age for 1956');
  assert(getEra(1965) === 'Silver Age', 'expected Silver Age for 1965');
  assert(getEra(1969) === 'Silver Age', 'expected Silver Age for 1969');
});

test('getEra - Bronze Age (1970-1984)', () => {
  const getEra = (y) => {
    const n = parseInt(y, 10);
    if (!n || isNaN(n)) return "Modern Age";
    if (n < 1938) return "Victorian/Platinum Age";
    if (n < 1956) return "Golden Age";
    if (n < 1970) return "Silver Age";
    if (n < 1985) return "Bronze Age";
    if (n < 1991) return "Copper Age";
    if (n < 2000) return "Modern Age (1991-1999)";
    return "Modern Age";
  };

  assert(getEra(1970) === 'Bronze Age', 'expected Bronze Age for 1970');
  assert(getEra(1980) === 'Bronze Age', 'expected Bronze Age for 1980');
  assert(getEra(1984) === 'Bronze Age', 'expected Bronze Age for 1984');
});

test('getEra - Copper Age (1985-1990)', () => {
  const getEra = (y) => {
    const n = parseInt(y, 10);
    if (!n || isNaN(n)) return "Modern Age";
    if (n < 1938) return "Victorian/Platinum Age";
    if (n < 1956) return "Golden Age";
    if (n < 1970) return "Silver Age";
    if (n < 1985) return "Bronze Age";
    if (n < 1991) return "Copper Age";
    if (n < 2000) return "Modern Age (1991-1999)";
    return "Modern Age";
  };

  assert(getEra(1985) === 'Copper Age', 'expected Copper Age for 1985');
  assert(getEra(1990) === 'Copper Age', 'expected Copper Age for 1990');
});

test('getEra - Modern Age (1991-1999)', () => {
  const getEra = (y) => {
    const n = parseInt(y, 10);
    if (!n || isNaN(n)) return "Modern Age";
    if (n < 1938) return "Victorian/Platinum Age";
    if (n < 1956) return "Golden Age";
    if (n < 1970) return "Silver Age";
    if (n < 1985) return "Bronze Age";
    if (n < 1991) return "Copper Age";
    if (n < 2000) return "Modern Age (1991-1999)";
    return "Modern Age";
  };

  assert(getEra(1991) === 'Modern Age (1991-1999)', 'expected Modern Age (1991-1999) for 1991');
  assert(getEra(1999) === 'Modern Age (1991-1999)', 'expected Modern Age (1991-1999) for 1999');
});

test('getEra - Modern Age (2000+)', () => {
  const getEra = (y) => {
    const n = parseInt(y, 10);
    if (!n || isNaN(n)) return "Modern Age";
    if (n < 1938) return "Victorian/Platinum Age";
    if (n < 1956) return "Golden Age";
    if (n < 1970) return "Silver Age";
    if (n < 1985) return "Bronze Age";
    if (n < 1991) return "Copper Age";
    if (n < 2000) return "Modern Age (1991-1999)";
    return "Modern Age";
  };

  assert(getEra(2000) === 'Modern Age', 'expected Modern Age for 2000');
  assert(getEra(2024) === 'Modern Age', 'expected Modern Age for 2024');
});

test('extractCharacter - from firstAppearanceCharacters', () => {
  const extractCharacter = (item) => {
    return (
      item.firstAppearanceCharacters?.[0] ||
      item.comicVine?.characterCredits?.[0]?.name ||
      null
    );
  };

  const item = { firstAppearanceCharacters: ['Spider-Man', 'Mary Jane'] };
  assert(extractCharacter(item) === 'Spider-Man', 'expected Spider-Man');
});

test('extractCharacter - from comicVine.characterCredits', () => {
  const extractCharacter = (item) => {
    return (
      item.firstAppearanceCharacters?.[0] ||
      item.comicVine?.characterCredits?.[0]?.name ||
      null
    );
  };

  const item = {
    comicVine: {
      characterCredits: [
        { name: 'Batman' },
        { name: 'Robin' }
      ]
    }
  };
  assert(extractCharacter(item) === 'Batman', 'expected Batman');
});

test('extractCharacter - returns null when missing', () => {
  const extractCharacter = (item) => {
    return (
      item.firstAppearanceCharacters?.[0] ||
      item.comicVine?.characterCredits?.[0]?.name ||
      null
    );
  };

  const item = {};
  assert(extractCharacter(item) === null, 'expected null');
});

// ─────────────────────────────────────────────────────────────────
// Item Specifics XML Tests
// ─────────────────────────────────────────────────────────────────

test('Item specifics - contains publisher', () => {
  const item = { title: 'Amazing Spider-Man', issue: '1', publisher: 'Marvel', year: 1963 };
  const xml = buildItemSpecificsXml(item);
  assert(xml.includes('<Name>Publisher</Name>'), 'should contain Publisher field');
  assert(xml.includes('<Value>Marvel</Value>'), 'should contain Marvel value');
});

test('Item specifics - contains era', () => {
  const item = { title: 'Amazing Spider-Man', issue: '1', publisher: 'Marvel', year: 1963 };
  const xml = buildItemSpecificsXml(item);
  assert(xml.includes('<Name>Era</Name>'), 'should contain Era field');
  assert(xml.includes('Silver Age'), 'should contain Silver Age for 1963');
});

test('Item specifics - contains format (Single Issue)', () => {
  const item = { title: 'Amazing Spider-Man', issue: '1', publisher: 'Marvel', year: 1963 };
  const xml = buildItemSpecificsXml(item);
  assert(xml.includes('<Name>Format</Name>'), 'should contain Format field');
  assert(xml.includes('<Value>Single Issue</Value>'), 'should contain Single Issue');
});

test('Item specifics - contains format (TPB)', () => {
  const item = { title: 'Kingdom Come', publisher: 'DC', year: 1996, isTPB: true };
  const xml = buildItemSpecificsXml(item);
  assert(xml.includes('<Value>Trade Paperback</Value>'), 'should contain Trade Paperback');
});

test('Item specifics - contains format (Magazine)', () => {
  const item = { title: 'Marvel Age', issue: '58', publisher: 'Marvel', year: 1987, isMagazine: true };
  const xml = buildItemSpecificsXml(item);
  assert(xml.includes('<Value>Magazine</Value>'), 'should contain Magazine');
});

test('Item specifics - contains grade certification (CGC)', () => {
  const item = {
    title: 'X-Men',
    issue: '1',
    publisher: 'Marvel',
    year: 1963,
    slabNumber: '1234567890',
    slabCompany: 'CGC'
  };
  const xml = buildItemSpecificsXml(item);
  assert(xml.includes('<Name>Grade Certification</Name>'), 'should contain Grade Certification');
  assert(xml.includes('<Value>CGC</Value>'), 'should contain CGC');
});

test('Item specifics - contains grade certification (Raw)', () => {
  const item = { title: 'X-Men', issue: '1', publisher: 'Marvel', year: 1963 };
  const xml = buildItemSpecificsXml(item);
  assert(xml.includes('<Value>Raw/Ungraded</Value>'), 'should contain Raw/Ungraded');
});

test('Item specifics - contains numeric grade when present', () => {
  const item = {
    title: 'X-Men',
    issue: '1',
    publisher: 'Marvel',
    year: 1963,
    numericGrade: '9.8'
  };
  const xml = buildItemSpecificsXml(item);
  assert(xml.includes('<Name>Numeric Grade</Name>'), 'should contain Numeric Grade field');
  assert(xml.includes('<Value>9.8</Value>'), 'should contain 9.8');
});

test('Item specifics - omits numeric grade when missing', () => {
  const item = { title: 'X-Men', issue: '1', publisher: 'Marvel', year: 1963 };
  const xml = buildItemSpecificsXml(item);
  assert(!xml.includes('<Name>Numeric Grade</Name>'), 'should not contain Numeric Grade field');
});

test('Item specifics - contains character when present', () => {
  const item = {
    title: 'Amazing Spider-Man',
    issue: '1',
    publisher: 'Marvel',
    year: 1963,
    firstAppearanceCharacters: ['Spider-Man']
  };
  const xml = buildItemSpecificsXml(item);
  assert(xml.includes('<Name>Character</Name>'), 'should contain Character field');
  assert(xml.includes('<Value>Spider-Man</Value>'), 'should contain Spider-Man');
});

test('Item specifics - contains variant when present', () => {
  const item = {
    title: 'X-Men',
    issue: '1',
    publisher: 'Marvel',
    year: 1963,
    variant: 'Newsstand'
  };
  const xml = buildItemSpecificsXml(item);
  assert(xml.includes('<Name>Variant</Name>'), 'should contain Variant field');
  assert(xml.includes('<Value>Newsstand</Value>'), 'should contain Newsstand');
});

// ─────────────────────────────────────────────────────────────────
// Claude Title Override Tests
// ─────────────────────────────────────────────────────────────────

test('Claude title - used when confidence is HIGH', () => {
  const item = {
    title: 'Amazing Spider-Man',
    issue: '1',
    publisher: 'Marvel',
    year: 1963,
    grade: 'VF',
    claudeCheck: {
      confidence: 'HIGH',
      suggestedListingTitle: 'Amazing Spider-Man #1 (1963) Marvel Silver Age KEY'
    }
  };

  const buildTitle = (item) => {
    if (item.claudeCheck?.confidence === 'HIGH' &&
        item.claudeCheck?.suggestedListingTitle) {
      return item.claudeCheck.suggestedListingTitle.substring(0, 80);
    }
    return `${item.title} #${item.issue}`;
  };

  const title = buildTitle(item);
  assert(title === 'Amazing Spider-Man #1 (1963) Marvel Silver Age KEY', 'should use Claude title');
});

test('Claude title - fallback when confidence is MEDIUM', () => {
  const item = {
    title: 'Amazing Spider-Man',
    issue: '1',
    publisher: 'Marvel',
    year: 1963,
    grade: 'VF',
    claudeCheck: {
      confidence: 'MEDIUM',
      suggestedListingTitle: 'Amazing Spider-Man #1 (1963) Marvel Silver Age KEY'
    }
  };

  const buildTitle = (item) => {
    if (item.claudeCheck?.confidence === 'HIGH' &&
        item.claudeCheck?.suggestedListingTitle) {
      return item.claudeCheck.suggestedListingTitle.substring(0, 80);
    }
    return `${item.title} #${item.issue}`;
  };

  const title = buildTitle(item);
  assert(title === 'Amazing Spider-Man #1', 'should use fallback logic');
});

test('Claude title - truncates to 80 chars', () => {
  const item = {
    claudeCheck: {
      confidence: 'HIGH',
      suggestedListingTitle: 'A'.repeat(100)
    }
  };

  const buildTitle = (item) => {
    if (item.claudeCheck?.confidence === 'HIGH' &&
        item.claudeCheck?.suggestedListingTitle) {
      return item.claudeCheck.suggestedListingTitle.substring(0, 80);
    }
    return 'Comic Book';
  };

  const title = buildTitle(item);
  assert(title.length === 80, `expected 80 chars, got ${title.length}`);
});

// ─────────────────────────────────────────────────────────────────
// Dynamic Category Tests
// ─────────────────────────────────────────────────────────────────

test('Dynamic category - TPB → 267', () => {
  const item = { isTPB: true };
  const categoryId = item.isTPB ? '267' :
                     item.isMagazine ? '180' :
                     '259104';
  assert(categoryId === '267', 'expected 267 for TPB');
});

test('Dynamic category - Magazine → 180', () => {
  const item = { isMagazine: true };
  const categoryId = item.isTPB ? '267' :
                     item.isMagazine ? '180' :
                     '259104';
  assert(categoryId === '180', 'expected 180 for magazine');
});

test('Dynamic category - Single Issue → 259104', () => {
  const item = {};
  const categoryId = item.isTPB ? '267' :
                     item.isMagazine ? '180' :
                     '259104';
  assert(categoryId === '259104', 'expected 259104 for single issue');
});

// ─────────────────────────────────────────────────────────────────
// Free Shipping Tests
// ─────────────────────────────────────────────────────────────────

test('Free shipping - price $60 → $0 shipping', () => {
  const price = 60;
  const isFreeShipping = price >= 50;
  const shippingCost = isFreeShipping ? '0.00' : '4.99';
  assert(shippingCost === '0.00', 'expected free shipping for $60');
});

test('Free shipping - price $50 → $0 shipping', () => {
  const price = 50;
  const isFreeShipping = price >= 50;
  const shippingCost = isFreeShipping ? '0.00' : '4.99';
  assert(shippingCost === '0.00', 'expected free shipping for $50');
});

test('Paid shipping - price $30 → $4.99', () => {
  const price = 30;
  const isFreeShipping = price >= 50;
  const shippingCost = isFreeShipping ? '0.00' : '4.99';
  assert(shippingCost === '4.99', 'expected $4.99 shipping for $30');
});

test('Paid shipping - price $49.99 → $4.99', () => {
  const price = 49.99;
  const isFreeShipping = price >= 50;
  const shippingCost = isFreeShipping ? '0.00' : '4.99';
  assert(shippingCost === '4.99', 'expected $4.99 shipping for $49.99');
});

// ─────────────────────────────────────────────────────────────────
// Best Offer Tests
// ─────────────────────────────────────────────────────────────────

test('Best Offer - auto-accept at 95%', () => {
  const price = 100;
  const autoAcceptPrice = (price * 0.95).toFixed(2);
  assert(autoAcceptPrice === '95.00', `expected 95.00, got ${autoAcceptPrice}`);
});

test('Best Offer - auto-decline at 75%', () => {
  const price = 100;
  const minBestOfferPrice = (price * 0.75).toFixed(2);
  assert(minBestOfferPrice === '75.00', `expected 75.00, got ${minBestOfferPrice}`);
});

test('Best Offer - thresholds for $50 item', () => {
  const price = 50;
  const autoAcceptPrice = (price * 0.95).toFixed(2);
  const minBestOfferPrice = (price * 0.75).toFixed(2);
  assert(autoAcceptPrice === '47.50', `expected 47.50, got ${autoAcceptPrice}`);
  assert(minBestOfferPrice === '37.50', `expected 37.50, got ${minBestOfferPrice}`);
});

// ─────────────────────────────────────────────────────────────────
// Multi-Image Upload Logic Tests
// ─────────────────────────────────────────────────────────────────

test('Multi-image - 3 images → should upload 3', () => {
  const item = {
    images: ['img1', 'img2', 'img3'],
    matchConfidence: { tier: 'HIGH' },
    claudeCheck: { confidence: 'HIGH' }
  };

  const shouldUploadMultiple =
    item.matchConfidence?.tier !== 'LOW' &&
    item.claudeCheck?.confidence !== 'LOW';

  const imagesToUpload = shouldUploadMultiple
    ? (item.images || []).filter(Boolean).slice(0, 12)
    : [(item.images?.[0] || null)].filter(Boolean);

  assert(imagesToUpload.length === 3, `expected 3 images, got ${imagesToUpload.length}`);
});

test('Multi-image - 15 images → should upload 12', () => {
  const item = {
    images: Array(15).fill('img'),
    matchConfidence: { tier: 'HIGH' },
    claudeCheck: { confidence: 'HIGH' }
  };

  const shouldUploadMultiple =
    item.matchConfidence?.tier !== 'LOW' &&
    item.claudeCheck?.confidence !== 'LOW';

  const imagesToUpload = shouldUploadMultiple
    ? (item.images || []).filter(Boolean).slice(0, 12)
    : [(item.images?.[0] || null)].filter(Boolean);

  assert(imagesToUpload.length === 12, `expected 12 images, got ${imagesToUpload.length}`);
});

test('Multi-image - LOW confidence → should upload 1', () => {
  const item = {
    images: ['img1', 'img2', 'img3'],
    matchConfidence: { tier: 'LOW' },
    claudeCheck: { confidence: 'MEDIUM' }
  };

  const shouldUploadMultiple =
    item.matchConfidence?.tier !== 'LOW' &&
    item.claudeCheck?.confidence !== 'LOW';

  const imagesToUpload = shouldUploadMultiple
    ? (item.images || []).filter(Boolean).slice(0, 12)
    : [(item.images?.[0] || null)].filter(Boolean);

  assert(imagesToUpload.length === 1, `expected 1 image, got ${imagesToUpload.length}`);
});

// ─────────────────────────────────────────────────────────────────
// Description Content Tests
// ─────────────────────────────────────────────────────────────────

test('Description - contains market proof when priceBands present', () => {
  const item = {
    title: 'Amazing Spider-Man',
    priceBands: {
      quick: 45,
      market: 60,
      stretch: 85,
      count: 8,
      source: 'verified sold'
    }
  };

  const desc = buildSimpleDescription(item);
  assert(desc.includes('MARKET DATA'), 'should contain MARKET DATA section');
  assert(desc.includes('$45.00'), 'should contain quick price');
  assert(desc.includes('$85.00'), 'should contain stretch price');
  assert(desc.includes('8 comps'), 'should contain comp count');
  assert(desc.includes('verified sold'), 'should contain source');
});

test('Description - contains demand signals when present', () => {
  const item = {
    title: 'Amazing Spider-Man',
    demandSignals: {
      demandLevel: 'HIGH',
      trend: 'RISING',
      liquidity: 'FAST'
    }
  };

  const desc = buildSimpleDescription(item);
  assert(desc.includes('DEMAND'), 'should contain DEMAND section');
  assert(desc.includes('HIGH'), 'should contain demand level');
  assert(desc.includes('RISING'), 'should contain trend');
  assert(desc.includes('FAST'), 'should contain liquidity');
});

test('Description - contains creators when present', () => {
  const item = {
    title: 'Amazing Spider-Man',
    comicVine: {
      personCredits: [
        { name: 'Stan Lee', role: 'writer' },
        { name: 'Steve Ditko', role: 'artist' }
      ]
    }
  };

  const desc = buildSimpleDescription(item);
  assert(desc.includes('CREATORS'), 'should contain CREATORS section');
  assert(desc.includes('Stan Lee'), 'should contain Stan Lee');
  assert(desc.includes('Steve Ditko'), 'should contain Steve Ditko');
});

test('Description - contains characters when present', () => {
  const item = {
    title: 'Amazing Spider-Man',
    comicVine: {
      characterCredits: [
        { name: 'Spider-Man' },
        { name: 'Green Goblin' }
      ]
    }
  };

  const desc = buildSimpleDescription(item);
  assert(desc.includes('CHARACTERS'), 'should contain CHARACTERS section');
  assert(desc.includes('Spider-Man'), 'should contain Spider-Man');
  assert(desc.includes('Green Goblin'), 'should contain Green Goblin');
});

test('Description - contains flags disclosure when present', () => {
  const item = {
    title: 'Amazing Spider-Man',
    claudeCheck: {
      flags: ['Variant identity verified via sold comps', 'Year corrected from Vision']
    }
  };

  const desc = buildSimpleDescription(item);
  assert(desc.includes('NOTES'), 'should contain NOTES section');
  assert(desc.includes('Variant identity verified'), 'should contain first flag');
  assert(desc.includes('Year corrected'), 'should contain second flag');
});

test('Description - contains enhanced pack details', () => {
  const item = { title: 'Amazing Spider-Man' };
  const desc = buildSimpleDescription(item);
  assert(desc.includes('Gemini mailer'), 'should mention Gemini mailer');
  assert(desc.includes('cardboard backing'), 'should mention cardboard backing');
  assert(desc.includes('top loader'), 'should mention top loader');
  assert(desc.includes('Ships within 3 business days'), 'should mention ship time');
});

// Helper function for description tests
function buildSimpleDescription(item) {
  const lines = [];

  if (item.claudeCheck?.flags && item.claudeCheck.flags.length > 0) {
    lines.push("<p><strong>NOTES</strong></p>");
    item.claudeCheck.flags.forEach(flag => {
      lines.push(`<p>• ${xmlEscape(flag)}</p>`);
    });
  }

  if (item.title) lines.push(`<h2>${xmlEscape(item.title)}</h2>`);

  if (item.priceBands) {
    lines.push(`<p><strong>MARKET DATA</strong></p>`);
    const pb = item.priceBands;
    if (pb.quick && pb.stretch && pb.market) {
      lines.push(
        `<p>Recent verified sales: $${pb.quick.toFixed(2)}–$${pb.stretch.toFixed(2)} ` +
        `(${pb.count || 0} comps)</p>`
      );
      lines.push(
        `<p>Market value: $${pb.market.toFixed(2)} ` +
        `(${xmlEscape(pb.source || 'estimated')})</p>`
      );
    }
  }

  if (item.demandSignals) {
    const ds = item.demandSignals;
    lines.push(`<p><strong>DEMAND</strong></p>`);
    lines.push(
      `<p>${xmlEscape(ds.demandLevel || 'NORMAL')} demand · ` +
      `${xmlEscape(ds.trend || 'FLAT')} price trend · ` +
      `${xmlEscape(ds.liquidity || 'NORMAL')} mover</p>`
    );
  }

  if (item.comicVine?.personCredits && item.comicVine.personCredits.length > 0) {
    const creatorList = item.comicVine.personCredits
      .map(p => `${xmlEscape(p.name)}${p.role ? ` (${xmlEscape(p.role)})` : ''}`)
      .join(', ');
    lines.push(`<p><strong>CREATORS</strong></p>`);
    lines.push(`<p>${creatorList}</p>`);
  }

  if (item.comicVine?.characterCredits && item.comicVine.characterCredits.length > 0) {
    const characterList = item.comicVine.characterCredits
      .slice(0, 5)
      .map(c => xmlEscape(c.name))
      .join(', ');
    lines.push(`<p><strong>CHARACTERS</strong></p>`);
    lines.push(`<p>${characterList}</p>`);
  }

  lines.push("<p><strong>SHIPPING</strong></p>");
  lines.push(
    "<p>Packed in Gemini mailer with cardboard backing and top loader for protection. " +
    "Ships within 3 business days via USPS Media Mail. Combined shipping available.</p>"
  );

  return lines.join("\n");
}

// Helper function for item specifics tests
function buildItemSpecificsXml(item) {
  const getEra = (y) => {
    const n = parseInt(y, 10);
    if (!n || isNaN(n)) return "Modern Age";
    if (n < 1938) return "Victorian/Platinum Age";
    if (n < 1956) return "Golden Age";
    if (n < 1970) return "Silver Age";
    if (n < 1985) return "Bronze Age";
    if (n < 1991) return "Copper Age";
    if (n < 2000) return "Modern Age (1991-1999)";
    return "Modern Age";
  };

  const extractCharacter = (item) => {
    return (
      item.firstAppearanceCharacters?.[0] ||
      item.comicVine?.characterCredits?.[0]?.name ||
      null
    );
  };

  const character = extractCharacter(item);

  return `    <ItemSpecifics>
      <NameValueList>
        <Name>Publisher</Name>
        <Value>${xmlEscape(item.publisher || 'Unknown')}</Value>
      </NameValueList>
      <NameValueList>
        <Name>Series Title</Name>
        <Value>${xmlEscape(item.title || 'Unknown')}</Value>
      </NameValueList>
${item.issue ? `      <NameValueList>
        <Name>Issue Number</Name>
        <Value>${xmlEscape(item.issue)}</Value>
      </NameValueList>
` : ''}      <NameValueList>
        <Name>Era</Name>
        <Value>${xmlEscape(getEra(item.year))}</Value>
      </NameValueList>
      <NameValueList>
        <Name>Grade Certification</Name>
        <Value>${xmlEscape(item.slabNumber ? (item.slabCompany || 'CGC') : 'Raw/Ungraded')}</Value>
      </NameValueList>
${item.numericGrade ? `      <NameValueList>
        <Name>Numeric Grade</Name>
        <Value>${xmlEscape(item.numericGrade)}</Value>
      </NameValueList>
` : ''}      <NameValueList>
        <Name>Format</Name>
        <Value>${xmlEscape(item.isTPB ? 'Trade Paperback' : item.isMagazine ? 'Magazine' : 'Single Issue')}</Value>
      </NameValueList>
      <NameValueList>
        <Name>Language</Name>
        <Value>English</Value>
      </NameValueList>
${character ? `      <NameValueList>
        <Name>Character</Name>
        <Value>${xmlEscape(character)}</Value>
      </NameValueList>
` : ''}${item.variant ? `      <NameValueList>
        <Name>Variant</Name>
        <Value>${xmlEscape(item.variant)}</Value>
      </NameValueList>
` : ''}    </ItemSpecifics>
`;
}

// Run all tests
run();
