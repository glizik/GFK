const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

  // Count log requests — the old path fired one per event; JSON path should fire ~0.
  let logReqs = 0, jsonReqs = 0;
  page.on('request', r => {
    const u = r.url();
    if (/\/data\/logs\/.*\.log/.test(u)) logReqs++;
    if (/\/data\/events_.*\.json/.test(u)) jsonReqs++;
  });

  const t0 = Date.now();
  await page.goto('http://localhost:3737/', { waitUntil: 'load' });
  await page.waitForSelector('#reportTable table.report-table, #reportTable .empty', { timeout: 30000 });
  const loadMs = Date.now() - t0;

  // Switch to Events / Analytics view and count rendered cards vs show-more.
  const cardCount = await page.locator('#analyticsGrid .event-card').count().catch(() => -1);
  const showMore  = await page.locator('#analyticsGrid .show-more-btn').count().catch(() => 0);
  const reportRows = await page.locator('#reportTable tr').count().catch(() => -1);

  console.log('load_ms:', loadMs);
  console.log('log_requests:', logReqs, '(expect ~0 with JSON path)');
  console.log('json_requests:', jsonReqs);
  console.log('analytics_cards_rendered:', cardCount, 'show_more_buttons:', showMore);
  console.log('report_rows:', reportRows);
  console.log('errors:', errors.length ? errors.slice(0, 10) : 'none');

  // Click show-more if present and re-count.
  if (showMore > 0) {
    const before = cardCount;
    await page.locator('#analyticsGrid .show-more-btn').click();
    await page.waitForTimeout(500);
    const after = await page.locator('#analyticsGrid .event-card').count();
    console.log('show_more_click: cards', before, '->', after);
  }

  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
