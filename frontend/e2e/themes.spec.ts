import { test, expect, password } from './fixtures';

test('四套主题在各工作面切换、保留并支持键盘操作', async ({ app: page, context }, testInfo) => {
  test.setTimeout(180_000);
  expect((await context.request.post('/api/auth/login', { data: { username: 'admin', password } })).ok()).toBeTruthy();
  const routes = ['/welcome', '/dossiers', '/review', '/match', '/chat', '/graph', '/trend', '/library', '/admin'];
  for (const [label, value] of [['黑白', 'mono'], ['深海蓝', 'blue'], ['极光紫', 'aurora'], ['青绿纸色', 'paper']] as const) {
    await page.goto('/welcome');
    await page.getByRole('button', { name: '切换主题' }).click();
    await page.getByRole('radio', { name: label }).check();
    await expect(page.locator('html')).toHaveAttribute('data-theme', value);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: '切换主题' })).toBeFocused();
    for (const route of routes) {
      await page.goto(route);
      await expect(page.locator('.workspace-home')).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-theme', value);
      const selectors: Record<string, string> = {
        '/dossiers': '.dossier-workbench', '/review': '.review-deck', '/match': '.match-deck',
        '/chat': '.chat-layout', '/graph': '.kg-chart', '/trend': '.trend-deck',
        '/library': '.document-reader', '/admin': '.admin-deck',
      };
      if (selectors[route]) await expect(page.locator(selectors[route]).first()).toBeVisible();
      if (route === '/trend') {
        await page.getByRole('tab', { name: '趋势图表', exact: true }).click();
        await expect(page.locator('.chart-panel').first()).toBeVisible();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
      await page.screenshot({ path: testInfo.outputPath(`${value}-${route.slice(1)}.png`) });
      if (route === '/graph') {
        await page.getByRole('button', { name: '人工知识图谱', exact: true }).click();
        await expect(page.locator('.kg-legend')).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath(`${value}-graph-manual.png`) });
      }
    }
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', value);
    await page.getByRole('button', { name: '上传文档', exact: true }).first().click();
    await expect(page.getByRole('dialog', { name: '上传文档' })).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: testInfo.outputPath(`${value}-upload.png`) });
    await page.keyboard.press('Escape');
  }
});

test('手机和窄屏主题入口可见，选项可切换且不挤压上传', async ({ app: page }, testInfo) => {
  for (const width of [320, 375, 680, 681]) {
    await page.setViewportSize({ width, height: 812 });
    await page.goto('/chat');
    const toggle = page.getByRole('button', { name: '切换主题' });
    const upload = page.locator('.topbar-actions').getByRole('button', { name: '上传文档' });
    await expect(toggle).toBeVisible();
    await expect(upload).toBeVisible();
    expect(await page.locator('.topbar-title h1').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
    await toggle.click();
    await page.getByRole('radio', { name: '极光紫' }).check();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'aurora');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(238, 237, 246)');
    const rect = await page.locator('.theme-options').boundingBox();
    expect(rect && rect.x >= 0 && rect.x + rect.width <= width).toBeTruthy();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
    await page.screenshot({ path: testInfo.outputPath(`theme-mobile-${width}.png`) });
    await page.keyboard.press('Escape');
  }
});
