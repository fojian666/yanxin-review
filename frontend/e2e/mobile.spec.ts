import { test, expect, navigate, downloadText, loginUI } from './fixtures';

test('@smoke 手机导航遍历、焦点与页面宽度', async ({ app: page }) => {
  for (const label of ['智能问答', '文献趋势', '查重匹配', '本子预审', '文档库']) {
    await navigate(page, label);
    await expect(page.locator('.app-shell')).not.toHaveClass(/nav-open/);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  }
  const open = page.getByRole('button', { name: '打开导航' });
  await open.click(); await expect(page.locator('.nav a').first()).toBeFocused();
  await page.keyboard.press('Escape'); await expect(open).toBeFocused();
  await expect(page.locator('.app-shell')).not.toHaveClass(/nav-open/);
});

test('手机上传弹窗焦点不逃出，关闭恢复焦点', async ({ app: page }) => {
  const open = page.locator('.topbar-actions').getByRole('button', { name: '上传文档', exact: true }); await open.click();
  const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('Tab');
    await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBeTruthy();
  }
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(open).toBeFocused();
});

test('手机匹配证据换行与实际报告下载', async ({ app: page, documents }, testInfo) => {
  await navigate(page, '查重匹配'); await page.getByLabel('待查本子').selectOption(documents[0].id);
  await page.getByRole('button', { name: '运行一体化检查' }).click();
  await page.locator('.excluded-box summary').click(); await expect(page.locator('.excluded-list')).toContainText('原名一致');
  await expect(page.locator('.expert-card').last()).toHaveCSS('opacity', '1');
  await page.screenshot({ path: testInfo.outputPath('mobile-evidence.png'), fullPage: true });
  expect(await page.locator('.exclusion-evidence').evaluateAll(elements => elements.every(element => element.scrollWidth <= element.clientWidth))).toBeTruthy();
  const text = await downloadText(page, () => page.getByRole('button', { name: '导出结果' }).click(), testInfo); expect(text).toContain(documents[0].name);
});

test('正常动效登录撤幕与运行时减少动态效果', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await loginUI(page); await navigate(page, '文献趋势');
  if (await page.getByRole('button', { name: '3D', exact: true }).isEnabled()) {
    await page.getByRole('button', { name: '3D', exact: true }).click();
    const rotation = page.getByRole('button', { name: '自动旋转', exact: true });
    await expect(rotation).toBeEnabled(); await rotation.click(); await expect(rotation).toContainText('继续旋转');
    await page.emulateMedia({ reducedMotion: 'reduce' }); await expect(rotation).toBeDisabled(); await expect(rotation).toContainText('旋转已关闭');
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBeTruthy();
});
