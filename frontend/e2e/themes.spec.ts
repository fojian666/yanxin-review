import { test, expect, navigate } from './fixtures';

const SYSTEM_NAME = '江苏省自然资源科研诚信智慧治理平台';

test('平台固定蓝白外壳、统一品牌和无主题简约入口', async ({ app: page }, testInfo) => {
  await page.goto('/welcome');

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'blue');
  await expect(page.locator('.brand-name')).toHaveText(SYSTEM_NAME);
  await expect(page.locator('.brand-mark')).toHaveCount(0);
  await expect(page.locator('.topbar-actions').getByRole('button', { name: '切换主题' })).toHaveCount(0);
  await expect(page.locator('.topbar-actions').getByRole('button', { name: /简约模式/ })).toHaveCount(0);
  await expect(page.locator('.theme-menu, .theme-trigger, .simple-mode-trigger')).toHaveCount(0);
  await expect(page).toHaveTitle(`工作台 · ${SYSTEM_NAME}`);
  await expect(page.locator('.topbar-title, .topbar-title-icon')).toHaveCount(0);

  const nav = page.locator('.nav .nav-item');
  await expect(nav.first()).toContainText('智能问答');
  await expect(nav.nth(1)).toContainText('历史课题');
  await expect(nav.first()).toHaveAttribute('href', '/chat');
  await expect(nav.nth(1)).toHaveAttribute('href', '/dossiers');
  const navWeights = await nav.evaluateAll(items => items.map(item => Number.parseInt(getComputedStyle(item).fontWeight, 10)));
  expect(navWeights.every(weight => weight >= 700)).toBeTruthy();

  await expect(page.locator('.sidebar')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  const shell = await page.evaluate(() => {
    const brand = document.querySelector<HTMLElement>('.brand')!.getBoundingClientRect();
    const topbar = document.querySelector<HTMLElement>('.topbar')!.getBoundingClientRect();
    const toggle = document.querySelector<HTMLElement>('.sidebar-toggle')!.getBoundingClientRect();
    return {
      brandTop: brand.top,
      brandHeight: brand.height,
      topbarHeight: topbar.height,
      toggleCenter: toggle.top + toggle.height / 2,
      brandCenter: brand.top + brand.height / 2,
    };
  });
  expect(Math.abs(shell.brandTop)).toBeLessThanOrEqual(1);
  expect(Math.abs(shell.brandHeight - shell.topbarHeight)).toBeLessThanOrEqual(1);
  expect(Math.abs(shell.toggleCenter - shell.brandCenter)).toBeLessThanOrEqual(3);
  await page.screenshot({ path: testInfo.outputPath('unified-blue-welcome.png') });

  for (const route of ['/dossiers', '/review', '/match', '/trend'] as const) {
    await page.goto(route);
    await expect(page.locator('.work-deck-copy small, .work-deck-head p')).toHaveCount(0);
  }
  await page.goto('/chat');
  await expect(page.locator('.welcome > p, .quick-card small, .sources-panel .panel-head p')).toHaveCount(0);
  await page.goto('/library');
  await expect(page.locator('.document-center-title > div > span')).toHaveCount(0);
});

test('主题与简约模式仍可由持久化状态生效但不再显示入口', async ({ app: page }) => {
  test.setTimeout(120_000);
  for (const theme of ['paper', 'mono', 'blue', 'aurora'] as const) {
    await page.evaluate(value => localStorage.setItem('yanxin.theme', value), theme);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.locator('.topbar-actions').getByRole('button', { name: '切换主题' })).toHaveCount(0);
    await expect(page.locator('.topbar-actions').getByRole('button', { name: /简约模式/ })).toHaveCount(0);
  }

  await page.evaluate(() => {
    localStorage.setItem('yanxin.theme', 'blue');
    localStorage.setItem('yanxin.simple-mode', '1');
  });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'blue');
  await expect(page.locator('html')).toHaveAttribute('data-simple-mode', 'true');
  await expect(page.locator('.nav-item .lucide').first()).toHaveCSS('display', 'none');
  await expect(page.locator('.topbar-title')).toHaveCount(0);

  await page.evaluate(() => localStorage.setItem('yanxin.simple-mode', '0'));
  await page.goto('/chat');
  await expect(page.locator('html')).toHaveAttribute('data-simple-mode', 'false');
  await expect(page.locator('.nav-item .lucide').first()).toBeVisible();
  await expect(page.locator('.theme-menu, .simple-mode-trigger')).toHaveCount(0);
});

test('统一品牌与导航在手机和折叠侧栏保持完整', async ({ app: page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/welcome');
  await page.getByRole('button', { name: '打开导航' }).click();
  await expect(page.locator('.brand-name')).toHaveText(SYSTEM_NAME);
  await expect(page.locator('.brand-name')).toBeVisible();
  const mobileLayout = await page.locator('.brand-name').evaluate(element => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  }));
  expect(mobileLayout.scrollWidth).toBeLessThanOrEqual(mobileLayout.clientWidth + 1);
  expect(mobileLayout.scrollHeight).toBeLessThanOrEqual(mobileLayout.clientHeight + 1);
  await expect(page.locator('.nav .nav-item').first()).toContainText('智能问答');
  await expect(page.locator('.nav .nav-item').nth(1)).toContainText('历史课题');
  await expect(page.locator('.brand-mark')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('unified-blue-mobile-nav.png') });
  await page.keyboard.press('Escape');

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await navigate(page, '历史课题');
  await page.getByRole('button', { name: '收起侧边栏' }).click();
  await expect(page.locator('.app-shell')).toHaveClass(/sidebar-collapsed/);
  await expect(page.locator('.brand-text')).toBeHidden();
  await expect(page.locator('.brand-mark')).toHaveCount(0);
  await expect(page.locator('.sidebar')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  const collapsed = await page.evaluate(() => {
    const brand = document.querySelector<HTMLElement>('.brand')!.getBoundingClientRect();
    const toggle = document.querySelector<HTMLElement>('.sidebar-toggle')!.getBoundingClientRect();
    return {
      brandHeight: brand.height,
      brandCenter: brand.top + brand.height / 2,
      toggleCenter: toggle.top + toggle.height / 2,
    };
  });
  expect(collapsed.brandHeight).toBe(68);
  expect(Math.abs(collapsed.toggleCenter - collapsed.brandCenter)).toBeLessThanOrEqual(3);
  await page.screenshot({ path: testInfo.outputPath('unified-blue-collapsed.png') });
});
