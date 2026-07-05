import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

// Capture ALL errors
const errors = [];
const consoleMessages = [];

page.on('console', msg => {
  const text = msg.text();
  consoleMessages.push({ type: msg.type(), text });
  if (msg.type() === 'error') {
    errors.push({ type: 'console-error', text });
  }
});

page.on('pageerror', err => {
  errors.push({
    type: 'pageerror',
    message: err.message,
    stack: err.stack
  });
});

// Monitor network - focus on enrich calls
const apiRequests = [];
page.on('request', req => {
  const url = req.url();
  if (url.includes('/api/')) {
    apiRequests.push({
      timestamp: new Date().toISOString(),
      method: req.method(),
      url: url.replace('https://comic-vault-rouge.vercel.app', '')
    });
  }
});

console.log('Navigating to production app...');
await page.goto('https://comic-vault-rouge.vercel.app', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);

console.log('Navigating to Collection tab...');
await page.click('button:has-text("Collection")');
await page.waitForTimeout(1500);

console.log('Looking for MWOM #198 card...');
// Try multiple selectors
const cardSelectors = [
  'text=/Mighty World.*198/',
  'text=/MWOM.*198/',
  'div:has-text("Mighty World of Marvel") >> text=/198/'
];

let clicked = false;
for (const selector of cardSelectors) {
  try {
    const element = await page.locator(selector).first();
    if (await element.isVisible()) {
      console.log(`Found card with selector: ${selector}`);
      await element.click();
      clicked = true;
      break;
    }
  } catch (e) {
    // Try next selector
  }
}

if (!clicked) {
  console.log('Card not found, dumping visible collection items...');
  const items = await page.locator('.collection-item, [class*="result-card"]').all();
  for (let i = 0; i < Math.min(items.length, 10); i++) {
    const text = await items[i].textContent();
    console.log(`Item ${i}: ${text?.substring(0, 80)}`);
  }
}

// Wait and observe the crash pattern
console.log('Waiting 8 seconds to observe crash behavior...');
const startTime = Date.now();
await page.waitForTimeout(8000);
const endTime = Date.now();

// Analyze results
console.log('\n=== CRASH ANALYSIS ===\n');

console.log('ERRORS CAPTURED:');
if (errors.length === 0) {
  console.log('  None');
} else {
  errors.forEach((err, i) => {
    console.log(`\nError ${i + 1}:`);
    console.log(`  Type: ${err.type}`);
    console.log(`  Message: ${err.message || err.text}`);
    if (err.stack) {
      console.log(`  Stack:\n${err.stack.split('\n').slice(0, 10).join('\n')}`);
    }
  });
}

console.log('\n\nAPI REQUEST PATTERN:');
const enrichCalls = apiRequests.filter(r => r.url.includes('/enrich'));
console.log(`Total /api/enrich calls: ${enrichCalls.length}`);
if (enrichCalls.length > 0) {
  console.log('Timing:');
  enrichCalls.forEach((call, i) => {
    console.log(`  ${i + 1}. ${call.timestamp} - ${call.url}`);
  });

  // Check for triplicate pattern
  if (enrichCalls.length >= 3) {
    const first = new Date(enrichCalls[0].timestamp);
    const second = new Date(enrichCalls[1].timestamp);
    const third = new Date(enrichCalls[2].timestamp);
    const gap1 = second - first;
    const gap2 = third - second;
    console.log(`\nTriplicate timing: ${gap1}ms, ${gap2}ms`);
    if (gap1 < 500 && gap2 < 500) {
      console.log('⚠️  TRIPLICATE PATTERN CONFIRMED (3 calls within 500ms)');
    }
  }
}

console.log(`\n\nAll API calls (${apiRequests.length} total):`);
apiRequests.forEach(req => {
  console.log(`  ${req.method} ${req.url}`);
});

console.log('\n\nRELEVANT CONSOLE MESSAGES:');
const relevantMessages = consoleMessages.filter(m =>
  m.text.includes('error') ||
  m.text.includes('undefined') ||
  m.text.includes('null') ||
  m.text.includes('claudeCheck')
);
relevantMessages.forEach(msg => {
  console.log(`  [${msg.type}] ${msg.text}`);
});

await browser.close();
console.log('\n=== END ANALYSIS ===\n');
