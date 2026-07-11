// Ship #24a-1 — Response Contract Tests

import {
  parsePriceNumber,
  deriveLocks,
  assembleContract,
  validateContract,
  finalizeResponse,
} from '../src/lib/responseContract.js';

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
  console.log('Ship #24a-1 — Response Contract Tests');
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

// ─────────────────────────────────────────────────────────────────
// Fixture builders
// ─────────────────────────────────────────────────────────────────

function cleanOut(overrides = {}) {
  return {
    price: '$123.45',
    priceLow: '$98.00',
    priceHigh: '$142.00',
    pricingSource: 'verified_sold_recency',
    priceBands: { quick: 98, market: 123.45, stretch: 142, tier: 1, source: 'tier1_recency_weighted' },
    soldComps: [{ price: 120 }, { price: 125 }, { price: 130 }],
    rawComps: { count: 4, average: 122, lowest: 98, highest: 150 },
    soldCompDiagnostics: { rawCount: 5, verifiedCount: 3, rejectedCount: 2, reasons: {} },
    matchConfidence: { score: 90, tier: 'HIGH' },
    identityConfident: true,
    refusedToPrice: false,
    decision: {
      action: 'LIST_NOW',
      confidence: 'high',
      price: NaN,
      blockers: [],
      warnings: [],
      nextStep: 'List at market band',
      bestChannel: 'cash_sale',
    },
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────
// parsePriceNumber
// ─────────────────────────────────────────────────────────────────

test('parsePriceNumber - fmtUsd string with comma', () => {
  assert(parsePriceNumber('$1,234.56') === 1234.56, 'should parse "$1,234.56"');
});

test('parsePriceNumber - raw number (visual-pool writer)', () => {
  assert(parsePriceNumber(9.71) === 9.71, 'should pass through numbers');
});

test('parsePriceNumber - null / NaN / garbage', () => {
  assert(parsePriceNumber(null) === null, 'null → null');
  assert(parsePriceNumber(undefined) === null, 'undefined → null');
  assert(parsePriceNumber(NaN) === null, 'NaN → null');
  assert(parsePriceNumber('refused') === null, 'non-price string → null');
  assert(parsePriceNumber({}) === null, 'object → null');
});

// ─────────────────────────────────────────────────────────────────
// State machine — clean paths
// ─────────────────────────────────────────────────────────────────

test('state PRICED - tier 1 verified sold (control: Punisher #1 class)', () => {
  const c = assembleContract(cleanOut());
  assert(c.state === 'PRICED', `expected PRICED, got ${c.state}`);
  assert(c.price === 123.45, `price should be 123.45, got ${c.price}`);
  assert(c.listable === true, 'clean LIST_NOW should be listable');
  assert(c.locks.length === 0, 'no locks on clean book');
  assert(c.verifiedCount === 3, 'verifiedCount from soldCompDiagnostics');
  assert(c.tier === 1, 'tier from priceBands');
});

test('state PRICED - tier 2 blend and tier 2.5 stale (ruling 2)', () => {
  for (const src of ['sold_active_blend_30', 'verified_sold', 'verified_sold_stale', 'verified_sold_active_blend']) {
    const c = assembleContract(cleanOut({ pricingSource: src }));
    assert(c.state === 'PRICED', `${src} should be PRICED, got ${c.state}`);
  }
});

test('state ESTIMATED - four fallback sources (ruling 2)', () => {
  for (const src of ['active_ask_derived', 'ebay-polybag-active', 'visual_pool_fallback', 'pc_estimate']) {
    const c = assembleContract(cleanOut({ pricingSource: src }));
    assert(c.state === 'ESTIMATED', `${src} should be ESTIMATED, got ${c.state}`);
  }
});

test('state ESTIMATED - web/ai fallbacks and unknown source (conservative)', () => {
  for (const src of ['web_search_fallback', 'ai_estimate', 'some_future_source']) {
    const c = assembleContract(cleanOut({ pricingSource: src }));
    assert(c.state === 'ESTIMATED', `${src} should be ESTIMATED, got ${c.state}`);
  }
});

// ─────────────────────────────────────────────────────────────────
// REFUSED (Atlas AA #5 / Sweethearts exhibit)
// ─────────────────────────────────────────────────────────────────

test('state REFUSED - price null, not listable, bands null (ruling 3)', () => {
  const c = assembleContract(cleanOut({
    price: null,
    priceLow: null,
    priceHigh: null,
    priceBands: null,
    pricingSource: 'refused-no-data-sources',
    refusedToPrice: true,
    decision: { action: 'DO_NOT_LIST', confidence: 'low', blockers: ['no-data'], warnings: [], nextStep: '' },
  }));
  assert(c.state === 'REFUSED', `expected REFUSED, got ${c.state}`);
  assert(c.price === null, 'REFUSED price must be null');
  assert(c.bands === null, 'REFUSED bands must be null');
  assert(c.listable === false, 'REFUSED never listable');
  assert(c.source === 'refused', `refused-* collapses to refused, got ${c.source}`);
  assert(c.locks.some(l => l.code === 'refused'), 'refused lock present');
});

test('state REFUSED - price nulled even if a writer left a price behind', () => {
  // Belt-and-braces: refusedToPrice true but stale out.price survived
  const c = assembleContract(cleanOut({ refusedToPrice: true, pricingSource: 'refused' }));
  assert(c.state === 'REFUSED', `expected REFUSED, got ${c.state}`);
  assert(c.price === null, 'contract price must be null when refused');
});

// ─────────────────────────────────────────────────────────────────
// ID_REQUIRED (precedence over everything)
// ─────────────────────────────────────────────────────────────────

test('state ID_REQUIRED - identityConfident false wins over price + locks', () => {
  const c = assembleContract(cleanOut({
    identityConfident: false,
    identityReasons: ['Vision could not read the issue number'],
    manualReviewRequired: true,
  }));
  assert(c.state === 'ID_REQUIRED', `expected ID_REQUIRED, got ${c.state}`);
  assert(c.price === null, 'ID_REQUIRED price must be null');
  assert(c.listable === false, 'ID_REQUIRED never listable');
  assert(c.locks[0].code === 'id-required', 'id-required lock ordered first');
  assert(c.locks[0].reason === 'Vision could not read the issue number', 'lock reason from identityReasons');
});

// ─────────────────────────────────────────────────────────────────
// LOCKED (X-Men #1 exhibit — price stays visible)
// ─────────────────────────────────────────────────────────────────

test('state LOCKED - X-Men #1 mega-key floor contamination, price visible', () => {
  const c = assembleContract(cleanOut({
    price: '$4,081.00',
    pricingSource: 'verified_sold_stale',
    listingHardLocked: true,
    listingHardLockReason: 'mega-key-floor-contamination',
    floorContaminationSuspect: true,
    floorContaminationReason: 'Verified solds far below key floor — pool may contain reprints (soldAvg $4,081 vs floor $14,000)',
    decision: { action: 'RESEARCH', confidence: 'low', blockers: [], warnings: ['floor-contamination'], nextStep: 'Verify printing', bestChannel: 'research' },
  }));
  assert(c.state === 'LOCKED', `expected LOCKED, got ${c.state}`);
  assert(c.price === 4081, `LOCKED keeps price visible (XMEN1), got ${c.price}`);
  assert(c.listable === false, 'LOCKED never listable');
  const lock = c.locks.find(l => l.code === 'mega-key-floor-contamination');
  assert(lock, 'contamination lock present with code from listingHardLockReason');
  assert(lock.reason.includes('reprints'), 'banner reason is the contamination copy (Amendment B)');
  assert(c.decision.action === 'RESEARCH', 'decision stays RESEARCH');
});

test('state LOCKED - manual review mega-key (Action #1 class)', () => {
  const c = assembleContract(cleanOut({
    manualReviewRequired: true,
    manualReviewReason: 'Action Comics #1 — manual review only',
    decision: { action: 'DO_NOT_LIST', confidence: 'low', blockers: ['mega-key-manual-review'], warnings: [], nextStep: '' },
  }));
  assert(c.state === 'LOCKED', `expected LOCKED, got ${c.state}`);
  assert(c.listable === false, 'manual review never listable');
  assert(c.locks.some(l => l.code === 'manual-review'), 'manual-review lock present');
});

test('state LOCKED - grade exceeds map', () => {
  const c = assembleContract(cleanOut({ gradeExceedsMap: true, gradeExceedsMapReason: 'Grade 9.8 exceeds floor map' }));
  assert(c.state === 'LOCKED', `expected LOCKED, got ${c.state}`);
  assert(c.locks.some(l => l.code === 'grade-exceeds-map'), 'grade-exceeds-map lock present');
});

test('state LOCKED - tier-0 convergence lock (22d)', () => {
  const c = assembleContract(cleanOut({ tier0Locked: true }));
  assert(c.state === 'LOCKED', `expected LOCKED, got ${c.state}`);
  assert(c.locks.some(l => l.code === 'tier0-convergence'), 'tier0-convergence lock present');
});

test('state LOCKED - decision DO_NOT_LIST with no specific flag (merchandise class)', () => {
  const c = assembleContract(cleanOut({
    decision: { action: 'DO_NOT_LIST', confidence: 'high', blockers: ['Non-comic asset detected — verify item type before listing'], warnings: [], nextStep: '' },
  }));
  assert(c.state === 'LOCKED', `expected LOCKED, got ${c.state}`);
  assert(c.locks.some(l => l.code === 'decision-blocked'), 'generic decision-blocked lock');
  assert(c.locks[0].reason.includes('Non-comic'), 'banner carries the blocker text');
});

// ─────────────────────────────────────────────────────────────────
// Soft lock — low-tier thin pool (formerly App.jsx inline rule)
// ─────────────────────────────────────────────────────────────────

test('soft lock low-tier-thin-pool - gates button, state stays ESTIMATED', () => {
  const c = assembleContract(cleanOut({
    pricingSource: 'pc_estimate',
    matchConfidence: { score: 20, tier: 'LOW' },
    soldComps: [],
    rawComps: { count: 1, average: 10, lowest: 8, highest: 12 },
    soldCompDiagnostics: { rawCount: 0, verifiedCount: 0, rejectedCount: 0, reasons: {} },
  }));
  assert(c.state === 'ESTIMATED', `soft lock must not flip state, got ${c.state}`);
  assert(c.listable === false, 'soft lock still gates listing');
  const lock = c.locks.find(l => l.code === 'low-tier-thin-pool');
  assert(lock && lock.hard === false, 'thin-pool lock is soft');
});

test('LOW tier with 3+ comps - no thin-pool lock', () => {
  const c = assembleContract(cleanOut({ matchConfidence: { score: 40, tier: 'LOW' } }));
  assert(!c.locks.some(l => l.code === 'low-tier-thin-pool'), '3 sold + 4 active comps → no thin-pool lock');
});

// ─────────────────────────────────────────────────────────────────
// INCOMPLETE
// ─────────────────────────────────────────────────────────────────

test('state INCOMPLETE - no price, no refuse flag (Q73 class)', () => {
  const c = assembleContract(cleanOut({
    price: null, priceLow: null, priceHigh: null, priceBands: null,
    pricingSource: null,
    decision: { action: 'LIST_NOW', confidence: 'high', blockers: [], warnings: [], nextStep: '' },
  }));
  assert(c.state === 'INCOMPLETE', `expected INCOMPLETE, got ${c.state}`);
  assert(c.listable === false, 'INCOMPLETE never listable');
});

// ─────────────────────────────────────────────────────────────────
// Bands
// ─────────────────────────────────────────────────────────────────

test('bands from priceBands tier engine', () => {
  const c = assembleContract(cleanOut());
  assert(c.bands.quick === 98 && c.bands.market === 123.45 && c.bands.stretch === 142,
    `bands should mirror priceBands, got ${JSON.stringify(c.bands)}`);
});

test('bands fallback from priceLow/High when priceBands missing (web fallback class)', () => {
  const c = assembleContract(cleanOut({
    priceBands: null,
    pricingSource: 'web_search_fallback',
    price: '$50.00', priceLow: '$40.00', priceHigh: '$60.00',
  }));
  assert(c.bands.quick === 40 && c.bands.market === 50 && c.bands.stretch === 60,
    `bands from priceLow/High, got ${JSON.stringify(c.bands)}`);
});

test('bands degenerate when only price exists — price stays inside bands (I5 pre-req)', () => {
  const c = assembleContract(cleanOut({
    priceBands: null, priceLow: null, priceHigh: null,
    pricingSource: 'ai_estimate', price: '$25.00',
  }));
  assert(c.bands.quick <= c.price && c.price <= c.bands.stretch,
    `price must sit within bands, got ${JSON.stringify(c.bands)} price ${c.price}`);
});

test('bands clamp - inverted priceLow/High never puts price outside bands', () => {
  const c = assembleContract(cleanOut({
    priceBands: null,
    pricingSource: 'ai_estimate',
    price: '$25.00', priceLow: '$30.00', priceHigh: '$20.00',
  }));
  assert(c.bands.quick <= c.price && c.price <= c.bands.stretch,
    `inverted low/high must clamp, got ${JSON.stringify(c.bands)}`);
});

// ─────────────────────────────────────────────────────────────────
// B&B Loot Crate exhibit — one number everywhere (I7)
// ─────────────────────────────────────────────────────────────────

test('finalizeResponse - decision.price overwritten to contract.price (I7)', () => {
  const out = cleanOut({ price: '$8.50', priceBands: { quick: 7, market: 8.5, stretch: 10, tier: 2 }, pricingSource: 'verified_sold' });
  finalizeResponse(out);
  assert(out.contract.price === 8.5, 'contract price 8.50');
  assert(out.decision.price === 8.5, 'decision.price synced to contract (was NaN)');
});

test('finalizeResponse - attaches contract, refused decision.price null', () => {
  const out = cleanOut({
    price: null, priceBands: null, priceLow: null, priceHigh: null,
    refusedToPrice: true, pricingSource: 'refused',
    decision: { action: 'DO_NOT_LIST', confidence: 'low', price: 12, blockers: ['x'], warnings: [], nextStep: '' },
  });
  finalizeResponse(out);
  assert(out.contract.state === 'REFUSED', 'refused state');
  assert(out.decision.price === null, 'phantom decision.price nulled on refuse');
});

// ─────────────────────────────────────────────────────────────────
// Missing-decision synthesis (early-exit paths, conservative)
// ─────────────────────────────────────────────────────────────────

test('missing out.decision - synthesized conservative, never listable', () => {
  const c = assembleContract(cleanOut({ decision: undefined, refusedToPrice: true, pricingSource: 'refused-identity-conflict', price: null, priceBands: null }));
  assert(c.decision.action === 'DO_NOT_LIST', 'synthesized DO_NOT_LIST');
  assert(c.decision.confidence === 'LOW', 'synthesized LOW confidence');
  assert(c.listable === false, 'never listable without a real decision');
});

test('missing out.decision + identity gate - synthesized ID_REQUIRED', () => {
  const c = assembleContract(cleanOut({ decision: undefined, identityConfident: false, price: null, priceBands: null }));
  assert(c.state === 'ID_REQUIRED', 'state ID_REQUIRED');
  assert(c.decision.action === 'ID_REQUIRED', 'synthesized ID_REQUIRED action');
});

// ─────────────────────────────────────────────────────────────────
// Confidence normalization + bestChannel passthrough
// ─────────────────────────────────────────────────────────────────

test('decision confidence uppercased in contract', () => {
  const c = assembleContract(cleanOut());
  assert(c.decision.confidence === 'HIGH', `lowercase 'high' → 'HIGH', got ${c.decision.confidence}`);
});

test('bestChannel passthrough from computeDecision', () => {
  const c = assembleContract(cleanOut());
  assert(c.bestChannel === 'cash_sale', `bestChannel passthrough, got ${c.bestChannel}`);
});

test('GRADE_CANDIDATE action - not listable (grade instead of list)', () => {
  const c = assembleContract(cleanOut({
    decision: { action: 'GRADE_CANDIDATE', confidence: 'high', blockers: [], warnings: [], nextStep: '', bestChannel: 'grade' },
  }));
  assert(c.listable === false, 'GRADE_CANDIDATE is not a LIST action');
  assert(c.state === 'PRICED', 'still PRICED — lockless, just not listable');
});

// ─────────────────────────────────────────────────────────────────
// deriveLocks ordering (Amendment B — locks[0].reason is the banner)
// ─────────────────────────────────────────────────────────────────

test('locks ordering - contamination before manual-review before soft', () => {
  const locks = deriveLocks(cleanOut({
    listingHardLocked: true,
    listingHardLockReason: 'mega-key-floor-contamination',
    floorContaminationReason: 'Solds far below floor',
    manualReviewRequired: true,
    matchConfidence: { tier: 'LOW' },
    soldComps: [],
    rawComps: { count: 0 },
  }));
  const codes = locks.map(l => l.code);
  assert(codes.indexOf('mega-key-floor-contamination') < codes.indexOf('manual-review'),
    `contamination first, got ${codes.join(',')}`);
  assert(codes.indexOf('low-tier-thin-pool') === codes.length - 1, 'soft lock last');
});

// ─────────────────────────────────────────────────────────────────
// Ship 24b — Invariant validator
// ─────────────────────────────────────────────────────────────────

test('24b clean assembly - zero violations on every state', () => {
  const scenarios = [
    cleanOut(),                                                          // PRICED
    cleanOut({ pricingSource: 'pc_estimate' }),                          // ESTIMATED
    cleanOut({ price: null, priceBands: null, priceLow: null, priceHigh: null, refusedToPrice: true, pricingSource: 'refused', decision: { action: 'DO_NOT_LIST', confidence: 'low', blockers: ['x'], warnings: [], nextStep: '' } }), // REFUSED
    cleanOut({ identityConfident: false, price: null, priceBands: null }), // ID_REQUIRED
    cleanOut({ listingHardLocked: true, listingHardLockReason: 'mega-key-floor-contamination', decision: { action: 'RESEARCH', confidence: 'low', blockers: [], warnings: [], nextStep: '' } }), // LOCKED
  ];
  scenarios.forEach((out, i) => {
    finalizeResponse(out);
    assert(out.contract.violations.length === 0,
      `scenario ${i} should be clean, got: ${out.contract.violations.join(' | ')}`);
    assert(out.contract.state !== 'INCOMPLETE' || i === 99,
      `scenario ${i} must not demote, got ${out.contract.state}`);
  });
});

test('24b I1 - REFUSED with a price demotes to INCOMPLETE + lock', () => {
  const out = cleanOut();
  const c = assembleContract(out);
  c.state = 'REFUSED'; // hand-corrupt: refused but price survived
  validateContract(c, out);
  assert(c.violations.some(v => v.startsWith('I1')), `expected I1, got ${c.violations.join(' | ')}`);
  assert(c.state === 'INCOMPLETE', 'demoted to INCOMPLETE');
  assert(c.listable === false, 'listing locked');
  assert(c.locks.some(l => l.code === 'contract-violation'), 'contract-violation lock added');
});

test('24b I3 - listable with locks demotes', () => {
  const out = cleanOut();
  const c = assembleContract(out);
  c.locks.push({ code: 'manual-review', reason: 'x', hard: true });
  c.listable = true; // hand-corrupt
  validateContract(c, out);
  assert(c.violations.some(v => v.startsWith('I3')), `expected I3, got ${c.violations.join(' | ')}`);
});

test('24b I4 - LOCKED with empty locks demotes', () => {
  const out = cleanOut();
  const c = assembleContract(out);
  c.state = 'LOCKED';
  c.locks = [];
  validateContract(c, out);
  assert(c.violations.some(v => v.startsWith('I4')), `expected I4, got ${c.violations.join(' | ')}`);
});

test('24b I5 - price outside its own bands demotes', () => {
  const out = cleanOut();
  const c = assembleContract(out);
  c.price = 500; // hand-corrupt: bands are 98/123.45/142
  validateContract(c, out);
  assert(c.violations.some(v => v.startsWith('I5')), `expected I5, got ${c.violations.join(' | ')}`);
});

test('24b I5 assembly guard - post-band writer (mega-key floor class) gets honest bands, no violation', () => {
  // priceBands stale at $123 but floor writer moved price to $2,000
  // with paired priceLow/High — assembly must not trust stale bands.
  const out = cleanOut({
    price: '$2,000.00', priceLow: '$2,000.00', priceHigh: '$2,300.00',
    megaKeyFloorApplied: true,
  });
  finalizeResponse(out);
  assert(out.contract.violations.length === 0,
    `mega-key floor must not violate, got: ${out.contract.violations.join(' | ')}`);
  assert(out.contract.bands.quick <= 2000 && out.contract.bands.stretch >= 2000,
    `bands must contain floor price, got ${JSON.stringify(out.contract.bands)}`);
});

test('24b I6 - verifiedCount drift demotes', () => {
  const out = cleanOut();
  const c = assembleContract(out);
  c.verifiedCount = 99; // hand-corrupt
  validateContract(c, out);
  assert(c.violations.some(v => v.startsWith('I6')), `expected I6, got ${c.violations.join(' | ')}`);
});

test('24b I7 - decision.price drifting from contract.price demotes', () => {
  const out = cleanOut();
  const c = assembleContract(out);
  out.decision.price = 999; // a later writer touched decision.price
  validateContract(c, out);
  assert(c.violations.some(v => v.startsWith('I7')), `expected I7, got ${c.violations.join(' | ')}`);
});

test('24b I8 - PRICED with estimate source demotes', () => {
  const out = cleanOut();
  const c = assembleContract(out);
  c.source = 'pc_estimate'; // hand-corrupt: state PRICED
  validateContract(c, out);
  assert(c.violations.some(v => v.startsWith('I8')), `expected I8, got ${c.violations.join(' | ')}`);
});

test('24b I9 - LIST action >100% over own sold pool avg demotes (customer-grade)', () => {
  // The $300 book with comps averaging $18 class
  const out = cleanOut({
    price: '$300.00', priceLow: '$280.00', priceHigh: '$320.00',
    priceBands: { quick: 280, market: 300, stretch: 320, tier: 2 },
    pricingSource: 'verified_sold',
    soldCompsAvg: 18,
  });
  finalizeResponse(out);
  assert(out.contract.violations.some(v => v.startsWith('I9')),
    `expected I9, got: ${out.contract.violations.join(' | ') || '(none)'}`);
  assert(out.contract.state === 'INCOMPLETE', 'demoted');
  assert(out.contract.listable === false, 'locked');
});

test('24b I9 skip - mega-key floor legitimately above pool avg, no violation', () => {
  const out = cleanOut({
    price: '$2,000.00', priceLow: '$2,000.00', priceHigh: '$2,300.00',
    pricingSource: 'verified_sold',
    soldCompsAvg: 400,
    megaKeyFloorApplied: true,
  });
  finalizeResponse(out);
  assert(!out.contract.violations.some(v => v.startsWith('I9')),
    `mega-key floor exempt from I9, got: ${out.contract.violations.join(' | ')}`);
});

test('24b I9 skip - RESEARCH action over pool avg is coherent, no violation', () => {
  const out = cleanOut({
    price: '$291.00', priceLow: '$280.00', priceHigh: '$320.00',
    priceBands: { quick: 280, market: 291, stretch: 320, tier: 2.5 },
    pricingSource: 'verified_sold_stale',
    soldCompsAvg: 18,
    decision: { action: 'RESEARCH', confidence: 'low', blockers: [], warnings: [], nextStep: '' },
  });
  finalizeResponse(out);
  assert(!out.contract.violations.some(v => v.startsWith('I9')),
    `RESEARCH exempt from I9 (Action #33 class), got: ${out.contract.violations.join(' | ')}`);
});

test('24b I10 - listable with DO_NOT_LIST demotes', () => {
  const out = cleanOut();
  const c = assembleContract(out);
  c.decision.action = 'DO_NOT_LIST'; // hand-corrupt
  validateContract(c, out);
  assert(c.violations.some(v => v.startsWith('I10')), `expected I10, got ${c.violations.join(' | ')}`);
});

test('24b validator never throws on malformed input', () => {
  const c = assembleContract(cleanOut());
  validateContract(c, {}); // out with nothing on it
  validateContract(assembleContract({}), undefined);
  assert(true, 'no throw');
});

// Run all tests
run();
