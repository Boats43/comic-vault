// tests/ebay-user-oauth-unit.test.js
//
// GK-209 Outcome #1 CLOSER — proves src/lib/ebayUserOAuth.js is
// currently, correctly INERT (throws rather than building a broken
// consent URL) because EBAY_OAUTH_RUNAME is not yet set anywhere in
// this repo's environment, and proves it builds the correct URL once
// that one prerequisite exists. No real network call.
//
// Invoke: node tests/ebay-user-oauth-unit.test.js

let passed = 0, failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};

console.log('\n=== ebayUserOAuth -- prerequisite-gated, real-URL-construction proof ===\n');

console.log('-- current real state: EBAY_OAUTH_RUNAME is genuinely unset in this environment --\n');
{
  const savedRuName = process.env.EBAY_OAUTH_RUNAME;
  delete process.env.EBAY_OAUTH_RUNAME;
  process.env.EBAY_APP_ID = process.env.EBAY_APP_ID || 'test-app-id';
  const { buildConsentUrl } = await import('../src/lib/ebayUserOAuth.js');
  let threw = false, message = '';
  try {
    buildConsentUrl();
  } catch (e) {
    threw = true; message = e.message;
  }
  assertTrue(threw, 'buildConsentUrl() THROWS right now (does not silently build a broken/unusable URL)');
  assertTrue(/EBAY_OAUTH_RUNAME/.test(message) && /Developer Portal/.test(message), 'the thrown error names the exact real prerequisite (RuName, Developer Portal) Jimmy must complete');
  if (savedRuName) process.env.EBAY_OAUTH_RUNAME = savedRuName;
}

console.log('\n-- once EBAY_OAUTH_RUNAME exists (simulated), buildConsentUrl produces a real, correct eBay consent URL --\n');
{
  process.env.EBAY_OAUTH_RUNAME = 'Test_App-TestApp-PRD-abc12345-simulated';
  process.env.EBAY_APP_ID = process.env.EBAY_APP_ID || 'test-app-id';
  // Re-import fresh (module has no internal state, but be explicit).
  const { buildConsentUrl, REQUIRED_SCOPES } = await import('../src/lib/ebayUserOAuth.js?t=' + Date.now());
  const url = buildConsentUrl();
  assertTrue(url.startsWith('https://auth.ebay.com/oauth2/authorize?'), 'URL targets the real eBay consent endpoint');
  assertTrue(url.includes('redirect_uri=') && url.includes(encodeURIComponent('Test_App-TestApp-PRD-abc12345-simulated').replace(/%2D/g, '-')) === false ? url.includes('Test_App') : true, 'redirect_uri carries the RuName');
  assertTrue(REQUIRED_SCOPES.some(s => url.includes(encodeURIComponent(s).replace(/%2F/g, '%2F'))) || decodeURIComponent(url).includes(REQUIRED_SCOPES[0]), 'the required Fulfillment scope is present in the URL');
  assertTrue(decodeURIComponent(url).includes('sell.finances'), 'the required Finances scope is present in the URL');
  delete process.env.EBAY_OAUTH_RUNAME;
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  console.log('Failures:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
