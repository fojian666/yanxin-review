import { test, expect, password } from './fixtures';

test('用户管理工作面占满宽度，底部空间得到利用', async ({ app: page, context }, testInfo) => {
  expect((await context.request.post('/api/auth/login', { data: { username: 'admin', password } })).ok()).toBeTruthy();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/admin');
  await expect(page.locator('.admin-deck')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('admin.png') });
  const dimensions = await page.evaluate(() => {
    const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
    return { stage: rect('.workspace-stage').width, deck: rect('.admin-deck').width, bottom: innerHeight - rect('.welcome-disclaimer').bottom };
  });
  expect(dimensions.deck).toBeGreaterThan(dimensions.stage - 2);
  expect(dimensions.bottom).toBeLessThan(20);
});

test('窄屏分析设置的控件与指标均可访问，2D 图表滚轮缩放', async ({ app: page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/trend');
  await expect(page.getByLabel('分析主题')).toBeVisible();
  const controls = page.locator('.trend-controls-page');
  for (const label of ['相关文献', '年份跨度', '最热主题', '年度变化']) {
    const card = controls.locator('.kpi').filter({ hasText: label });
    await card.scrollIntoViewIfNeeded();
    await expect(card).toBeInViewport();
  }
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.getByRole('tab', { name: '趋势图表', exact: true }).click();
  await page.getByRole('button', { name: '2D', exact: true }).click();
  const chart = page.locator('.chart-2d').first();
  await expect(chart).toBeVisible();
  await chart.hover();
  await page.waitForTimeout(300);
  const before = await chart.screenshot();
  for (let i = 0; i < 5; i += 1) {
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(80);
  }
  await page.waitForTimeout(500);
  expect(await chart.screenshot()).not.toEqual(before);
});
