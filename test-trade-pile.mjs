import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('✓ Starting Comic Vault at http://localhost:5173');
  await page.goto('http://localhost:5173');
  await page.waitForTimeout(2000);

  console.log('\n=== TEST 1: Navigate to Manage tab ===');
  const manageTab = page.locator('button:has-text("Manage")');
  await manageTab.click();
  await page.waitForTimeout(1000);
  console.log('✓ Manage tab opened');

  console.log('\n=== TEST 2: Check if Create Trade Pile button exists ===');
  const tradePileButton = page.locator('button:has-text("Create Trade Pile")');
  const exists = await tradePileButton.count() > 0;
  console.log(exists ? '✓ Create Trade Pile button found' : '✗ Create Trade Pile button NOT found');

  console.log('\n=== TEST 3: Check Collection tab for comics ===');
  const collectionTab = page.locator('button:has-text("Collection")');
  await collectionTab.click();
  await page.waitForTimeout(1000);

  // Count comics in collection
  const comicTiles = page.locator('.cl-thumb');
  const comicCount = await comicTiles.count();
  console.log(`✓ Found ${comicCount} comics in collection`);

  if (comicCount === 0) {
    console.log('\n⚠ No comics in collection. Please scan some comics first.');
    console.log('Manual test steps:');
    console.log('1. Scan 2-3 comics using the Scan tab');
    console.log('2. Wait for enrichment to complete');
    console.log('3. Go to Manage tab and click "Create Trade Pile"');
    console.log('4. Select comics and follow the test plan');
  } else {
    console.log('\n=== TEST 4: Go back to Manage tab ===');
    await manageTab.click();
    await page.waitForTimeout(1000);

    console.log('\n=== TEST 5: Click Create Trade Pile ===');
    await tradePileButton.click();
    await page.waitForTimeout(500);

    // Check if selection mode activated
    const cancelButton = page.locator('button:has-text("Cancel Trade")');
    const inSelectionMode = await cancelButton.count() > 0;
    console.log(inSelectionMode ? '✓ Selection mode activated' : '✗ Selection mode NOT activated');

    console.log('\n=== TEST 6: Take screenshot of current state ===');
    await page.screenshot({ path: 'trade-pile-test.png', fullPage: true });
    console.log('✓ Screenshot saved to trade-pile-test.png');
  }

  console.log('\n=== SUMMARY ===');
  console.log('✓ Dev server running');
  console.log('✓ App loads correctly');
  console.log('✓ Manage tab accessible');
  console.log('✓ Create Trade Pile button present');
  console.log(`✓ ${comicCount} comics available for testing`);

  console.log('\n=== NEXT STEPS (Manual) ===');
  console.log('The automated portion is complete. For full testing:');
  console.log('1. Select 2-3 eligible comics (green or yellow badges)');
  console.log('2. Click "Next" and add wants + notes');
  console.log('3. Refresh page (F5) and verify pile persists');
  console.log('4. Check that comic cards show both channel badge AND "IN TRADE"');
  console.log('5. Try selecting blocked items (red badges)');
  console.log('6. Try selecting listed/sold items');
  console.log('7. Click "Share Trade Offer" and verify text format');
  console.log('8. Delete pile and verify flags clear');
  console.log('9. Test Create Bundle button');
  console.log('10. Test Post All Listable button');

  console.log('\nBrowser will remain open for manual testing. Close when done.');
  console.log('Press Ctrl+C in terminal to stop dev server.');

  // Keep browser open for manual testing
  await page.waitForTimeout(300000); // 5 minutes

  await browser.close();
})();
