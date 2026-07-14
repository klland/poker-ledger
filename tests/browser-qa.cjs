const { chromium } = require('playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('http://127.0.0.1:4173', { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });

  await page.click('[data-club="malay"]');
  await page.click('[data-open="depositDialog"]');
  await page.fill('#depositForm [name="chips"]', '10000');
  assert.equal(await page.textContent('#depositPreview'), 'NT$80,000');
  await page.click('#depositForm button[type="submit"]');
  assert.equal(await page.textContent('#chipBalance'), '10,000');
  assert.equal(await page.textContent('#totalProfit'), 'NT$0');

  await page.click('[data-open="settleDialog"]');
  assert.equal(await page.textContent('#endingBalanceLabel'), '今天結束後剩餘總籌碼');
  await page.fill('#settleForm [name="chips"]', '12000');
  assert.equal(await page.textContent('#settleResultPreview strong'), '+NT$16,000');
  await page.click('#settleForm button[type="submit"]');
  assert.equal(await page.textContent('#chipBalance'), '12,000');
  assert.equal(await page.textContent('#totalProfit'), '+NT$16,000');

  await page.click('[data-open="withdrawDialog"]');
  await page.fill('#withdrawForm [name="chips"]', '2000');
  assert.equal(await page.textContent('#withdrawPreview'), 'NT$16,000');
  await page.click('#withdrawForm button[type="submit"]');
  assert.equal(await page.textContent('#chipBalance'), '10,000');
  assert.equal(await page.textContent('#totalProfit'), '+NT$16,000');

  await page.click('[data-club="all"]');
  assert.equal(await page.textContent('#chipBalance'), 'NT$80,000');
  assert.equal(await page.textContent('#totalProfit'), '+NT$16,000');
  assert.equal(await page.textContent('#totalDeposits'), 'NT$80,000');
  assert.equal(await page.textContent('#totalWithdrawals'), 'NT$16,000');
  assert.equal(await page.textContent('#combinedMalayValue'), '10,000 籌碼 · NT$80,000');
  await page.waitForTimeout(400);
  await page.screenshot({ path: '/private/tmp/poker-ledger-combined.png', fullPage: false });

  // A forgotten buy-in entered after a historical settlement must recalculate
  // that settlement without adding the same chips twice to the current balance.
  await page.click('[data-club="flush"]');
  await page.click('[data-open="settleDialog"]');
  await page.fill('#settleForm [name="timestamp"]', '2026-06-15');
  await page.fill('#settleForm [name="chips"]', '150');
  await page.click('#settleForm button[type="submit"]');
  assert.equal(await page.textContent('#totalProfit'), '+NT$150');
  await page.click('[data-open="depositDialog"]');
  await page.fill('#depositForm [name="timestamp"]', '2026-06-15');
  await page.fill('#depositForm [name="chips"]', '100');
  await page.click('#depositForm button[type="submit"]');
  assert.equal(await page.textContent('#chipBalance'), '150');
  assert.equal(await page.textContent('#totalProfit'), '+NT$50');
  assert.equal(await page.textContent('#recentList .settlement .ledger-value strong'), '+NT$50');

  await page.click('[data-club="all"]');
  assert.equal(await page.textContent('#chipBalance'), 'NT$80,150');
  assert.equal(await page.textContent('#totalProfit'), '+NT$16,050');
  assert.equal(await page.textContent('#totalDeposits'), 'NT$80,100');

  await page.click('[data-nav="history"]');
  const flushDepositDelete = page.locator('.record-delete[data-club-key="flush"][data-record-type="deposit"]');
  assert.equal(await flushDepositDelete.count(), 1);
  await page.waitForTimeout(400);
  await page.screenshot({ path: '/private/tmp/poker-ledger-delete-record.png', fullPage: false });
  page.once('dialog', (dialog) => dialog.accept());
  await flushDepositDelete.click();
  assert.equal(await page.locator('.record-delete[data-club-key="flush"][data-record-type="deposit"]').count(), 0);
  await page.click('[data-nav="home"]');
  await page.click('[data-club="flush"]');
  assert.equal(await page.textContent('#chipBalance'), '150');
  assert.equal(await page.textContent('#totalProfit'), '+NT$150');

  await page.click('[data-nav="stats"]');
  assert.equal(await page.textContent('#periodProfit'), '+NT$16,000');
  assert.equal(await page.textContent('#winRate'), '100%');
  await page.waitForTimeout(500);
  const layout = await page.evaluate(() => ({
    viewport: innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    metricEdges: [...document.querySelectorAll('.metric')].map((element) => element.getBoundingClientRect().right)
  }));
  assert.ok(layout.documentWidth <= layout.viewport, `page overflows by ${layout.documentWidth - layout.viewport}px`);
  assert.ok(layout.metricEdges.every((edge) => edge <= layout.viewport), 'a statistics card exceeds the viewport');
  await page.click('#settingsButton');
  assert.equal(await page.textContent('#settingsDialog h2'), '帳房設定');
  assert.equal(await page.locator('#exportButton, #importInput').count(), 0);
  await page.click('#settingsDialog .sheet-close');
  assert.deepEqual(errors, []);

  await page.screenshot({ path: '/private/tmp/poker-ledger-mobile.png', fullPage: true });
  await browser.close();
  console.log('PASS: mobile accounting flow and console checks');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
