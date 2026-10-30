import { test, expect, navigate } from './fixtures';

test('单页工作区切换功能时保留卷宗上下文', async ({ app: page }) => {
  const ledger = await page.locator('.workspace-ledger').elementHandle();
  expect(ledger).not.toBeNull();
  await page.locator('.welcome-entries').getByRole('link', { name: '智能问答', exact: true }).click();
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.locator('.workspace-tab[aria-current="page"]')).toContainText('智能问答');
  expect(await ledger!.evaluate(element => element.isConnected)).toBeTruthy();
  await page.locator('.welcome-entries').getByRole('link', { name: '文档中心', exact: true }).click();
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.locator('.workspace-tab[aria-current="page"]')).toContainText('文档中心');
  expect(await ledger!.evaluate(element => element.isConnected)).toBeTruthy();
  await navigate(page, '本子预审');
  const runTab = page.getByRole('tab', { name: '运行预审', exact: true });
  await runTab.focus();
  await runTab.press('ArrowRight');
  await expect(page.getByRole('tab', { name: '结论概览', exact: true })).toBeFocused();
  await expect(page.getByRole('tab', { name: '结论概览', exact: true })).toHaveAttribute('aria-selected', 'true');
});

test('长桌面工作区卷宗栏文字与操作不重叠', async ({ app: page }, testInfo) => {
  for (const [width, height] of [[1440, 900], [1920, 1080], [2560, 1440]] as const) {
    await page.setViewportSize({ width, height });
    await page.goto('/welcome');
    const ledger = page.locator('.workspace-ledger');
    const main = page.locator('.workspace-ledger-main');
    const register = page.locator('.workspace-register');
    const documentLabel = page.locator('.workspace-document-row label');
    const documentSelect = page.locator('#workspace-document');
    await expect(ledger).toBeVisible();
    const [ledgerBox, mainBox, registerBox, labelBox, selectBox] = await Promise.all([
      ledger.boundingBox(),
      main.boundingBox(),
      register.boundingBox(),
      documentLabel.boundingBox(),
      documentSelect.boundingBox(),
    ]);
    expect(ledgerBox && mainBox && registerBox && labelBox && selectBox).toBeTruthy();
    expect(mainBox!.x + mainBox!.width, `${width}px 卷宗主栏与统计栏重叠`).toBeLessThanOrEqual(registerBox!.x);
    expect(selectBox!.x - labelBox!.x - labelBox!.width, `${width}px 卷宗标签与下拉框间距异常`).toBeLessThanOrEqual(24);
    expect(await page.locator('.workspace-document-row, .welcome-actions, .workspace-register').evaluateAll(
      elements => elements.every(element => element.scrollWidth <= element.clientWidth)
    )).toBeTruthy();
    if (width === 1920) {
      await page.screenshot({ path: testInfo.outputPath('workspace-1920.png'), fullPage: true });
    }
  }
});

for (const [label, width, height] of [['桌面', 1440, 900], ['手机', 375, 812]] as const) {
  test(`${label}路由标题保持简洁，工作面切换尊重动态偏好`, async ({ app: page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await navigate(page, '智能问答');
    await expect(page.locator('.topbar-title p, .route-arrival, .mobile-model-status, .topbar .mode-chip')).toHaveCount(0);
    await navigate(page, '文档中心');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('文档中心');
    await expect(page.locator('.route-arrival')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`route-header-${width}.png`) });

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect.poll(() => page.evaluate(() => matchMedia('(prefers-reduced-motion: no-preference)').matches)).toBeTruthy();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await navigate(page, '本子预审');
    await page.getByRole('tab', { name: '结论概览', exact: true }).click();
    await expect(page.locator('.review-deck .work-deck-panel').last()).toHaveAttribute('data-direction', 'next');
    const entering = await page.locator('.review-deck .work-deck-panel').last().evaluate(async element => {
      const samples: Array<{ animations: number; transform: string; opacity: number }> = [];
      for (let index = 0; index < 5; index += 1) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        const style = getComputedStyle(element);
        samples.push({ animations: element.getAnimations({ subtree: false }).length, transform: style.transform, opacity: Number(style.opacity) });
      }
      return samples;
    });
    expect(entering.some(sample => sample.animations > 0 || sample.transform !== 'none')).toBeTruthy();
    expect(entering.every(sample => sample.opacity > 0)).toBeTruthy();
    await expect.poll(() => page.locator('.review-deck .work-deck-panel').last().evaluate(element => element.getAnimations({ subtree: false }).filter(animation => animation.playState === 'running').length)).toBe(0);
    await page.getByRole('tab', { name: '运行预审', exact: true }).click();
    await expect(page.locator('.review-deck .work-deck-panel').last()).toHaveAttribute('data-direction', 'prev');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.getByRole('tab', { name: '结论概览', exact: true }).click();
    await expect.poll(() => page.locator('.review-deck .work-deck-panel').last().evaluate(element => element.getAnimations({ subtree: false }).filter(animation => animation.playState === 'running').length)).toBe(0);
  });
}
