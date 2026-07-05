import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: false }); // Visual for debugging
const page = await browser.newPage();

// Capture ALL errors
const errors = [];
const consoleMessages = [];

page.on('console', msg => {
  const text = msg.text();
  consoleMessages.push({ type: msg.type(), text });
});

page.on('pageerror', err => {
  errors.push({
    type: 'pageerror',
    message: err.message,
    stack: err.stack
  });
});

// Monitor network
const apiRequests = [];
page.on('request', req => {
  const url = req.url();
  if (url.includes('/api/')) {
    apiRequests.push({
      timestamp: Date.now(),
      method: req.method(),
      url: url.replace('https://comic-vault-rouge.vercel.app', '')
    });
  }
});

console.log('Navigating to production app...');
await page.goto('https://comic-vault-rouge.vercel.app', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);

console.log('Injecting MWOM #198 data into localStorage...');

// Inject the problematic book data
await page.evaluate(() => {
  const mwomData = {
    id: 'test-mwom-198',
    title: 'Mighty World of Marvel',
    issue: '198',
    publisher: 'Marvel',
    year: '1976',
    grade: '7.5',
    price: '5.00',
    timestamp: Date.now(),
    // Critical: include the problematic claudeCheck structure from Fix 2/3
    claudeCheck: {
      confidence: 'high',
      flags: ['vintage', 'uk-pence']
    },
    // Missing claudeCheckBlocker - this might be the issue
  };

  // Get existing collection or create new
  const existing = localStorage.getItem('cv_scanned_comics');
  const collection = existing ? JSON.parse(existing) : [];

  // Add MWOM to front
  collection.unshift(mwomData);

  localStorage.setItem('cv_scanned_comics', JSON.stringify(collection));

  console.log('Injected MWOM #198 with claudeCheck structure');
});

console.log('Reloading to trigger render...');
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

console.log('Clicking Collection tab...');
await page.click('button:has-text("Collection")');
await page.waitForTimeout(1000);

console.log('Looking for injected MWOM card...');
const cards = await page.locator('[class*="result-card"]').all();
console.log(`Found ${cards.length} cards`);

if (cards.length > 0) {
  console.log('Clicking first card (should be MWOM #198)...');
  await cards[0].click();

  console.log('Waiting 10 seconds to observe crash loop...');
  const startTime = Date.now();
  await page.waitForTimeout(10000);

  // Analyze
  console.log('\n=== CRASH ANALYSIS ===\n');

  console.log('ERRORS CAPTURED:');
  if (errors.length === 0) {
    console.log('  None');
  } else {
    errors.forEach((err, i) => {
      console.log(`\nError ${i + 1}:`);
      console.log(`  Type: ${err.type}`);
      console.log(`  Message: ${err.message}`);
      if (err.stack) {
        const stackLines = err.stack.split('\n');
        console.log(`  Stack (first 15 lines):`);
        stackLines.slice(0, 15).forEach(line => console.log(`    ${line}`));
      }
    });
  }

  console.log('\n\nAPI CALLS:');
  console.log(`Total: ${apiRequests.length}`);

  // Group by endpoint
  const byEndpoint = {};
  apiRequests.forEach(req => {
    const endpoint = req.url.split('?')[0];
    if (!byEndpoint[endpoint]) byEndpoint[endpoint] = [];
    byEndpoint[endpoint].push(req);
  });

  Object.entries(byEndpoint).forEach(([endpoint, calls]) => {
    console.log(`\n${endpoint}: ${calls.length} calls`);
    if (calls.length > 1) {
      const timings = [];
      for (let i = 1; i < calls.length; i++) {
        timings.push(calls[i].timestamp - calls[i-1].timestamp);
      }
      console.log(`  Gaps: ${timings.join('ms, ')}ms`);

      // Check for triplicate pattern (3 calls within 1 second)
      if (calls.length >= 3) {
        const first3 = calls.slice(0, 3);
        const span = first3[2].timestamp - first3[0].timestamp;
        if (span < 1000) {
          console.log(`  ⚠️  TRIPLICATE PATTERN: 3 calls in ${span}ms`);
        }
      }

      // Check for repeating pattern
      if (calls.length >= 6) {
        console.log(`  ⚠️  LOOP DETECTED: ${calls.length} calls`);
      }
    }
  });

  console.log('\n\nRELEVANT CONSOLE MESSAGES:');
  const relevant = consoleMessages.filter(m =>
    m.text.toLowerCase().includes('error') ||
    m.text.includes('undefined') ||
    m.text.includes('null') ||
    m.text.includes('claudeCheck') ||
    m.text.includes('claudeCheckBlocker')
  );

  if (relevant.length === 0) {
    console.log('  None');
  } else {
    relevant.slice(-20).forEach(msg => {
      console.log(`  [${msg.type}] ${msg.text}`);
    });
  }
}

await browser.close();
console.log('\n=== END ANALYSIS ===\n');
