// FIX-1 — SOLD_INSIGHTS_DISABLED kill switch.
//
// eBay Marketplace Insights has been dead since launch (gated for indie
// devs); the in-memory insightsScopeUnavailable flag does not survive
// cold starts, so [sold] oauth HTTP 400 fired on every new instance.
// With SOLD_INSIGHTS_DISABLED=1, fetchSold must return [] without any
// network attempt.
//
// Invoke: node tests/sold-insights-killswitch.test.js

process.env.SOLD_INSIGHTS_DISABLED = '1';
// Poison the creds so any accidental OAuth attempt would be observable
// as a fetch call — we also stub fetch to fail loudly.
process.env.EBAY_APP_ID = 'test-app-id';
process.env.EBAY_CERT_ID = 'test-cert-id';

let fetchCalled = false;
globalThis.fetch = async () => {
  fetchCalled = true;
  throw new Error('network attempted despite kill switch');
};

const { fetchSold } = await import('../api/sold.js');

let passed = 0;
let failed = 0;
const fail = (msg) => { failed++; console.log(`  ✗ ${msg}`); };
const pass = (msg) => { passed++; console.log(`  ✓ ${msg}`); };

const rows = await fetchSold({ title: 'Amazing Spider-Man', issue: '300', year: '1988' });

if (Array.isArray(rows) && rows.length === 0) pass('kill switch returns empty array');
else fail(`expected [], got ${JSON.stringify(rows)}`);

if (!fetchCalled) pass('no network attempt made');
else fail('fetch was called despite SOLD_INSIGHTS_DISABLED=1');

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
process.exit(0);
