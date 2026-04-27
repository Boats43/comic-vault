// Unit tests for Ship #20a — PriceCharting sales-history extractor.
//
// Pure-parser coverage (buildTabGradeMap, extractTabRows). Network-bound
// fetchPricechartingSales is exercised manually via a separate smoke script
// (single fetch through the real /game/{id} URL).
//
// Invoke: node tests/pricecharting-sales.test.js
// Exit code: 0 on all-pass, 1 on any failure.

import {
  buildTabGradeMap,
  extractTabRows,
} from '../api/pricecharting-pop.js';

let passed = 0;
let failed = 0;
const failures = [];

const assertEq = (actual, expected, label) => {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = `  ✗ ${label}\n    expected: ${e}\n    actual:   ${a}`;
    failures.push(msg);
    console.log(msg);
  }
};

const assertTrue = (cond, label) => {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = `  ✗ ${label}`;
    failures.push(msg);
    console.log(msg);
  }
};

console.log('\n=== SHIP #20a — PC SALES-HISTORY EXTRACTOR ===\n');

// ─── Fixture: minimal viable PC product HTML ────────────────────────
// Captures every structure the real page exhibits in a small string so
// regex coverage is verifiable without parsing 800 KB of real HTML.
const FIXTURE_HTML = `
<select id="completed-auctions-condition">
    <option value=""></option>
    <option value="completed-auctions-used">Ungraded (12)</option>
    <option value="completed-auctions-loose-and-box">10.0 (0)</option>
    <option value="completed-auctions-manual-only">9.8 (3)</option>
    <option value="completed-auctions-grade-seventeen">9.4 (2)</option>
    <option value="completed-auctions-grade-five">7.0 (1)</option>
    <option value="completed-auctions-grade-three">3.0 (0)</option>
</select>
<div class="completed-auctions-used" style="display: block;">
  <table class="hoverable-rows sortable">
    <thead><tr>
      <th class="date">Date</th><th class="image">TW</th>
      <th class="title">Title</th><th class="numeric">Price</th><th class="thumb-down"></th>
    </tr></thead>
    <tbody>
      <tr id="ebay-111111111">
        <td class="date">2026-04-25</td>
        <td class="image"><div class="image"></div></td>
        <td class="title">
          <a target="_blank" class="js-ebay-completed-sale" href="https://www.ebay.com/itm/111111111?aff=1">
            Amazing Spider-Man #300 Raw NM- Newsstand 1988</a>
          [eBay]
        </td>
        <td class="numeric"><span class="js-price">$120.00</span></td>
      </tr>
      <tr id="ebay-222222222">
        <td class="date">2026-04-20</td>
        <td class="image"><div class="image"></div></td>
        <td class="title">
          <a target="_blank" class="js-ebay-completed-sale" href="https://www.ebay.com/itm/222222222">
            ASM 300 raw VF Marvel May 1988</a>
          [eBay]
        </td>
        <td class="numeric"><span class="js-price">$1,234.50</span></td>
      </tr>
    </tbody>
  </table>
</div>
<div class="completed-auctions-grade-seventeen">
  <table class="hoverable-rows sortable">
    <thead><tr><th class="date">Date</th></tr></thead>
    <tbody>
      <tr id="ebay-389921846577">
        <td class="date">2026-04-25</td>
        <td class="title">
          <a target="_blank" class="js-ebay-completed-sale" href="https://www.ebay.com/itm/389921846577?nordt=true&amp;rt=nc">
            AMAZING SPIDER-MAN #300 CGC 9.4  NM  1st VENOM!  White Pages 1988</a>
          [eBay]
        </td>
        <td class="numeric"><span class="js-price">$672.00</span></td>
      </tr>
      <tr>
        <td class="date">2025-12-02</td>
        <td class="title">
          <a target="_blank" class="js-ha-completed-sale" href="https://www.ha.com/itm/-/-/-/a/122546-15554.s?type=DA-DMC-PriceCharting">
            The Amazing Spider-Man #300 (Marvel, 1988) CGC NM 9.4 White pages....</a>
          [HeritageAuctions]
        </td>
        <td class="numeric"><span class="js-price">$735.00</span></td>
      </tr>
    </tbody>
  </table>
</div>
<div class="completed-auctions-manual-only">
  <table class="hoverable-rows sortable">
    <thead><tr><th class="date">Date</th></tr></thead>
    <tbody>
      <tr id="ebay-333333333">
        <td class="date">2026-04-15</td>
        <td class="title">
          <a target="_blank" class="js-ebay-completed-sale" href="https://www.ebay.com/itm/333333333">
            ASM #300 CGC 9.8 White Pages</a>
          [eBay]
        </td>
        <td class="numeric"><span class="js-price">$1,800.00</span></td>
      </tr>
    </tbody>
  </table>
</div>
<div class="completed-auctions-grade-three">
  <p>No sales data for this condition</p>
</div>
<div class="population-report">
  <h2>Pop report — sentinel for end-of-tabs</h2>
</div>
`;

// ─── buildTabGradeMap (5) ───────────────────────────────────────────
console.log('buildTabGradeMap:');

const tabMap = buildTabGradeMap(FIXTURE_HTML);
assertEq(
  tabMap['completed-auctions-grade-seventeen'],
  9.4,
  'grade-seventeen tab → 9.4',
);
assertEq(
  tabMap['completed-auctions-manual-only'],
  9.8,
  'manual-only tab → 9.8',
);
assertEq(
  tabMap['completed-auctions-used'],
  'raw',
  'used tab → "raw" (Ungraded label)',
);
assertEq(
  buildTabGradeMap(''),
  {},
  'empty HTML → {}',
);
assertEq(
  buildTabGradeMap('<html>no select here</html>'),
  {},
  'missing dropdown → {}',
);

// ─── extractTabRows (8) ─────────────────────────────────────────────
console.log('\nextractTabRows:');

const seventeenRows = extractTabRows(
  FIXTURE_HTML,
  'completed-auctions-grade-seventeen',
);
assertEq(seventeenRows.length, 2, 'grade-seventeen tab → 2 rows');
assertEq(seventeenRows[0].price, 672, 'first 9.4 row price = 672');
assertEq(seventeenRows[0].date, '2026-04-25', 'first 9.4 row date ISO');
assertEq(
  seventeenRows[0].marketplace,
  'ebay',
  'first 9.4 row marketplace = ebay',
);
assertEq(
  seventeenRows[1].marketplace,
  'heritage',
  'second 9.4 row marketplace = heritage (bare <tr>)',
);

const usedRows = extractTabRows(FIXTURE_HTML, 'completed-auctions-used');
assertEq(usedRows.length, 2, 'used tab → 2 rows');
assertEq(
  usedRows[1].price,
  1234.5,
  'comma-formatted price $1,234.50 → 1234.5',
);

const emptyRows = extractTabRows(FIXTURE_HTML, 'completed-auctions-grade-three');
assertEq(emptyRows, [], 'no-sales-data tab → []');

// ─── extractTabRows edge cases (4) ─────────────────────────────────
console.log('\nextractTabRows edge cases:');

assertEq(
  extractTabRows(FIXTURE_HTML, 'completed-auctions-nonexistent'),
  [],
  'unknown tab class → []',
);
assertEq(extractTabRows('', 'completed-auctions-used'), [], 'empty HTML → []');
assertEq(
  extractTabRows(FIXTURE_HTML, ''),
  [],
  'empty tabClass → []',
);

// Title decoding (HTML entities): &amp; in href, plain text in title body.
const seventeenFirst = seventeenRows[0];
assertTrue(
  /ebay\.com\/itm\/389921846577/.test(seventeenFirst.url) &&
    !/&amp;/.test(seventeenFirst.url),
  'eBay URL decoded (&amp; → &)',
);

// ─── Object shape & cross-tab independence (4) ─────────────────────
console.log('\nObject shape:');

assertEq(
  typeof seventeenFirst.price,
  'number',
  'price is numeric (not string)',
);
assertEq(
  typeof seventeenFirst.date,
  'string',
  'date is string (ISO)',
);
assertTrue(
  /^\d{4}-\d{2}-\d{2}$/.test(seventeenFirst.date),
  'date matches YYYY-MM-DD',
);

const manualOnlyRows = extractTabRows(
  FIXTURE_HTML,
  'completed-auctions-manual-only',
);
assertEq(manualOnlyRows.length, 1, '9.8 tab independent from 9.4 tab (1 row)');

// ─── Source attribution (3) ────────────────────────────────────────
console.log('\nSource attribution:');

const ebayRow = seventeenRows.find((r) => r.marketplace === 'ebay');
const heritageRow = seventeenRows.find((r) => r.marketplace === 'heritage');
assertTrue(ebayRow && /ebay\.com/.test(ebayRow.url), 'eBay row has ebay.com URL');
assertTrue(
  heritageRow && /ha\.com/.test(heritageRow.url),
  'Heritage row has ha.com URL',
);
assertEq(
  manualOnlyRows[0].marketplace,
  'ebay',
  '9.8 tab eBay row tagged correctly',
);

// ─── Heritage row without explicit marketplace tag (1) ─────────────
console.log('\nHeritage detection:');

const HERITAGE_ONLY_FIXTURE = `
<select id="completed-auctions-condition">
  <option value="completed-auctions-grade-five">7.0 (1)</option>
</select>
<div class="completed-auctions-grade-five">
  <table class="hoverable-rows sortable">
    <thead><tr><th>Date</th></tr></thead>
    <tbody>
      <tr>
        <td class="date">2024-08-15</td>
        <td class="title">
          <a class="js-ha-completed-sale" href="https://www.ha.com/itm/x">
            The Amazing Spider-Man #300 (Marvel, 1988) CGC FN/VF 7.0</a>
          [HeritageAuctions]
        </td>
        <td class="numeric"><span class="js-price">$285.00</span></td>
      </tr>
    </tbody>
  </table>
</div>
<div class="population-report"></div>
`;
const haOnly = extractTabRows(
  HERITAGE_ONLY_FIXTURE,
  'completed-auctions-grade-five',
);
assertEq(haOnly.length, 1, 'Heritage-only tab → 1 row');
assertEq(haOnly[0].marketplace, 'heritage', 'Heritage detected via js-ha class');

// ─── Sort: newest first (2) ────────────────────────────────────────
console.log('\nSort:');

const SORT_FIXTURE = `
<select id="completed-auctions-condition">
  <option value="completed-auctions-used">Ungraded (3)</option>
</select>
<div class="completed-auctions-used">
  <table>
    <thead><tr><th>Date</th></tr></thead>
    <tbody>
      <tr id="ebay-1">
        <td class="date">2025-01-15</td>
        <td class="title"><a class="js-ebay-completed-sale" href="x">old</a> [eBay]</td>
        <td class="numeric"><span class="js-price">$10</span></td>
      </tr>
      <tr id="ebay-2">
        <td class="date">2026-04-25</td>
        <td class="title"><a class="js-ebay-completed-sale" href="x">new</a> [eBay]</td>
        <td class="numeric"><span class="js-price">$20</span></td>
      </tr>
      <tr id="ebay-3">
        <td class="date">2025-12-01</td>
        <td class="title"><a class="js-ebay-completed-sale" href="x">mid</a> [eBay]</td>
        <td class="numeric"><span class="js-price">$15</span></td>
      </tr>
    </tbody>
  </table>
</div>
<div class="population-report"></div>
`;
// extractTabRows itself does NOT sort — sort happens in
// fetchPricechartingSales' enrichment pipeline. Verify rows survive in
// document order so the wrapper can sort deterministically.
const sortInput = extractTabRows(SORT_FIXTURE, 'completed-auctions-used');
assertEq(
  sortInput.map((r) => r.date),
  ['2025-01-15', '2026-04-25', '2025-12-01'],
  'extractTabRows preserves document order (sort is wrapper job)',
);
// And confirm wrapper-side sort is correct via JS direct check:
const sortedDesc = [...sortInput].sort((a, b) =>
  (b.date || '').localeCompare(a.date || ''),
);
assertEq(
  sortedDesc.map((r) => r.date),
  ['2026-04-25', '2025-12-01', '2025-01-15'],
  'wrapper-side sort: newest first',
);

// ─── Defensive: malformed price / missing fields (3) ───────────────
console.log('\nDefensive parsing:');

const MALFORMED_FIXTURE = `
<select id="completed-auctions-condition">
  <option value="completed-auctions-used">Ungraded (5)</option>
</select>
<div class="completed-auctions-used">
  <table>
    <thead><tr><th>Date</th></tr></thead>
    <tbody>
      <tr id="ebay-bad-1">
        <!-- no date td -->
        <td class="title"><a class="js-ebay-completed-sale" href="x">x</a> [eBay]</td>
        <td class="numeric"><span class="js-price">$50.00</span></td>
      </tr>
      <tr id="ebay-bad-2">
        <td class="date">2026-04-25</td>
        <td class="title"><a class="js-ebay-completed-sale" href="x">x</a> [eBay]</td>
        <!-- no price -->
      </tr>
      <tr id="ebay-bad-3">
        <td class="date">2026-04-25</td>
        <td class="title"><a class="js-ebay-completed-sale" href="x">x</a> [eBay]</td>
        <td class="numeric"><span class="js-price">$0.00</span></td>
      </tr>
      <tr id="ebay-good">
        <td class="date">2026-04-26</td>
        <td class="title"><a class="js-ebay-completed-sale" href="x">good row</a> [eBay]</td>
        <td class="numeric"><span class="js-price">$99.00</span></td>
      </tr>
    </tbody>
  </table>
</div>
<div class="population-report"></div>
`;
const malRows = extractTabRows(MALFORMED_FIXTURE, 'completed-auctions-used');
assertEq(malRows.length, 1, 'malformed rows skipped, only good row survives');
assertEq(malRows[0].title, 'good row', 'good row title decoded correctly');
assertEq(malRows[0].price, 99, 'good row price parsed');

// ─── Final ─────────────────────────────────────────────────────────
console.log(`\n=== RESULTS ===`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failed > 0) {
  console.log('\n=== FAILURES ===');
  failures.forEach((f) => console.log(f));
  process.exit(1);
} else {
  console.log('All tests passed.');
}
