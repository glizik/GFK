import { test } from '@playwright/test';

test('example', async ({ page, context }) => {
  await page.goto('https://index.hu');
  console.log(`loaded`);
});