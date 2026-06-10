const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERR: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
  await p.goto('http://localhost:3737/', { waitUntil: 'load' });
  await p.waitForFunction(() => typeof events !== 'undefined' && events.length > 0, { timeout: 30000 });
  await p.waitForTimeout(400);

  // 1. Report + Day Timeline collapsed by default
  const reportCollapsed = await p.locator('#reportPanel').evaluate(e => e.classList.contains('collapsed'));
  const ganttCollapsed  = await p.locator('#ganttPanel').evaluate(e => e.classList.contains('collapsed'));
  console.log('1. reportPanel collapsed:', reportCollapsed, '| ganttPanel collapsed:', ganttCollapsed);

  // 2. Coverage ~100% and version-reactive
  const cov371 = await p.locator('#statCoverage').textContent();
  const collected371 = await p.locator('#statCollected').textContent();
  await p.evaluate(() => setGlobalOutcome('all'));
  await p.evaluate(() => setGlobalVersion('3.7.0'));
  await p.waitForFunction(() => loadedVersions.has('3.7.0'), { timeout: 60000 });
  await p.waitForTimeout(300);
  const cov370 = await p.locator('#statCoverage').textContent();
  await p.evaluate(() => setGlobalVersion('all'));
  await p.waitForTimeout(300);
  const covAll = await p.locator('#statCoverage').textContent();
  console.log('2. coverage 3.7.1:', cov371, '| 3.7.0:', cov370, '| all:', covAll, '| collected(3.7.1):', collected371);

  // 3. passed / not passed outcome buttons exist + filter works
  await p.evaluate(() => setGlobalVersion('3.7.1'));
  await p.waitForTimeout(300);
  const btns = await p.locator('#globalFilters button').allTextContents();
  const hasPassed = btns.some(t => t.includes('Passed'));
  const hasNP = btns.some(t => t.includes('Not passed'));
  const sessAll = await p.locator('#statSessions').textContent();
  await p.evaluate(() => setGlobalOutcome('passed'));
  await p.waitForTimeout(300);
  const sessPassed = await p.locator('#statSessions').textContent();
  await p.evaluate(() => setGlobalOutcome('notpassed'));
  await p.waitForTimeout(300);
  const sessNP = await p.locator('#statSessions').textContent();
  await p.evaluate(() => setGlobalOutcome('all'));
  await p.waitForTimeout(200);
  console.log('3. buttons passed/notpassed:', hasPassed, hasNP, '| sessions all/passed/notpassed:', sessAll, sessPassed, sessNP);

  // 4 + 5. Timeline: user-based bars (legend Passed/Not passed) + summary bar; download gone
  await p.evaluate(() => { toggleTimeline(); });
  await p.waitForTimeout(300);
  const legend = await p.locator('#tlChartContainer .tl-legend').textContent().catch(() => '');
  const summaryBar = await p.locator('#tlDownloads .flow-outcomes-label').textContent().catch(() => '(none)');
  const dlButtons = await p.locator('#tlDownloads .tl-download-row').count();
  console.log('4/5. legend:', legend.trim(), '| summary:', (summaryBar||'').trim().slice(0,60), '| download-rows:', dlButtons);

  // 6. Report never-passed toggle
  await p.evaluate(() => { toggleReport(); });
  await p.waitForTimeout(200);
  const npBtn = await p.locator('#reportTable .rep-toolbar button').textContent().catch(() => '(none)');
  const rowsBefore = await p.locator('#reportTable tbody tr').count();
  await p.evaluate(() => toggleReportNP());
  await p.waitForTimeout(200);
  const rowsAfter = await p.locator('#reportTable tbody tr').count();
  console.log('6. NP toggle btn:', (npBtn||'').trim(), '| report rows before/after NP-only:', rowsBefore, rowsAfter);

  console.log('errors:', errs.length ? errs.slice(0, 12) : 'none');
  await b.close();
  process.exit(errs.length ? 1 : 0);
})();
