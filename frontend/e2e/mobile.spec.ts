import { test, expect, navigate, downloadText, loginUI } from './fixtures';

test('@smoke 手机导航遍历、焦点与页面宽度', async ({ app: page }, testInfo) => {
  await page.goto('/welcome');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBeTruthy();
  for (const label of ['智能问答', '知识图谱', '文献趋势', '查重匹配', '课题卷宗', '项目预审', '文档中心']) {
    await navigate(page, label);
    await expect(page.locator('.app-shell')).not.toHaveClass(/nav-open/);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1), `${label} 页面纵向溢出`).toBeTruthy();
    await expect(page.locator('.page-skeleton')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`mobile-${label}.png`) });
  }
  const open = page.getByRole('button', { name: '打开导航' });
  await open.click(); await expect(page.locator('.nav a').first()).toBeFocused();
  await page.keyboard.press('Escape'); await expect(open).toBeFocused();
  await expect(page.locator('.app-shell')).not.toHaveClass(/nav-open/);
});

test('手机上传弹窗焦点不逃出，关闭恢复焦点', async ({ app: page }) => {
  const open = page.locator('.topbar-actions').getByRole('button', { name: '上传文档', exact: true });
  for (const width of [320, 375, 420, 421, 500, 680, 681, 900]) {
    await page.setViewportSize({ width, height: 812 });
    const label = open.locator('.btn-label');
    if (width <= 680) {
      await expect(label, `${width}px 应为纯图标按钮`).toBeHidden();
      await expect(open).toHaveCSS('width', '44px');
    } else {
      await expect(label).toBeVisible();
    }
    expect(await open.locator('svg').evaluate(element => element.getBoundingClientRect().width), `${width}px 上传图标不可被文字挤扁`).toBeGreaterThanOrEqual(16);
    expect(await open.evaluate(element => element.scrollWidth <= element.clientWidth), `${width}px 按钮不可溢出`).toBeTruthy();
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await open.click();
  const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('Tab');
    await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBeTruthy();
  }
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(open).toBeFocused();
});

test('手机匹配证据换行与实际报告下载', async ({ app: page, documents }, testInfo) => {
  await navigate(page, '查重匹配'); await page.getByLabel('当前卷宗').selectOption(documents[0].id);
  await page.getByRole('button', { name: '运行一体化检查' }).click();
  await page.getByRole('tab', { name: '专家候选', exact: true }).click();
  await expect(page.locator('.expert-card').last()).toHaveCSS('opacity', '1');
  await page.getByRole('tab', { name: '回避边界', exact: true }).click(); await expect(page.locator('.match-deck-excluded')).toContainText('原名一致');
  await page.screenshot({ path: testInfo.outputPath('mobile-evidence.png'), fullPage: true });
  expect(await page.locator('.exclusion-evidence').evaluateAll(elements => elements.every(element => element.scrollWidth <= element.clientWidth))).toBeTruthy();
  const text = await downloadText(page, () => page.getByRole('button', { name: '导出结果' }).click(), testInfo); expect(text).toContain(documents[0].name);
});

test('正常动效登录撤幕与运行时减少动态效果', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await loginUI(page); await navigate(page, '文献趋势');
  await page.getByRole('tab', { name: '趋势图表', exact: true }).click();
  if (await page.getByRole('button', { name: '3D', exact: true }).isEnabled()) {
    await page.getByRole('button', { name: '3D', exact: true }).click();
    const rotation = page.getByRole('button', { name: '自动旋转', exact: true });
    await expect(rotation).toBeEnabled(); await rotation.click(); await expect(rotation).toContainText('继续旋转');
    await page.emulateMedia({ reducedMotion: 'reduce' }); await expect(rotation).toBeDisabled(); await expect(rotation).toContainText('旋转已关闭');
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBeTruthy();
});

test('手机顶栏不展示模型标识且上传按钮不挤压', async ({ app: page, context }, testInfo) => {
  const health = await (await context.request.get('/api/health')).json();
  await page.route('**/api/health', route => route.fulfill({ json: health }));
  for (const [provider, label, model] of [['deepseek', 'DeepSeek', 'deepseek-flash'], ['qwen', '千问 / DashScope', 'qwen-plus']]) {
    health.llm = { configured: true, provider, label, model, base_url: '' };
    for (const width of [320, 375, 680]) {
      await page.setViewportSize({ width, height: 812 });
      await page.reload();
      await expect(page.getByLabel('当前模型配置')).toHaveCount(0);
      await expect(page.locator('.topbar .mode-chip')).toHaveCount(0);
      await expect(page.locator('.topbar-actions').getByRole('button', { name: '上传文档', exact: true })).toHaveCSS('width', '44px');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
    }
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.locator('.welcome-home')).toBeVisible(); await page.screenshot({ path: testInfo.outputPath('generation-mobile.png'), fullPage: true });
});

test('手机问答模型选择靠近输入框且面板可操作', async ({ app: page }, testInfo) => {
  await page.route('**/api/chat/options', route => route.fulfill({ json: { models: [
    { id: 'default', label: 'DeepSeek', model: 'deepseek-flash', available: true, reason: '', strengths: ['default', 'quick', 'low', 'high', 'max'] },
    { id: 'offline', label: '离线摘录', model: '', available: true, reason: '', strengths: ['default'] },
    { id: 'qwen-plus', label: '千问 / DashScope', model: 'qwen-plus', available: false, reason: '未配置该供应商密钥', strengths: ['default'] },
  ] } }));
  await page.goto('/chat');
  for (const width of [320, 375, 680]) {
    await page.setViewportSize({ width, height: 812 });
    const toolbar = page.locator('.chat-model-controls');
    await toolbar.getByRole('button', { name: /模型：/ }).click();
    await expect(page.getByRole('checkbox', { name: /离线摘录/ })).toBeVisible();
    const bounds = await page.locator('.chat-model-panel').boundingBox();
    expect(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width).toBeTruthy();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
    if (width === 375) await page.screenshot({ path: testInfo.outputPath('model-picker-mobile.png') });
    await page.getByRole('button', { name: '关闭模型选项' }).click();
    await expect(page.getByRole('button', { name: '上传文档', exact: true }).first()).toHaveCSS('width', '44px');
  }
});

test('手机问答与证据切换并从引用返回', async ({ app: page }, testInfo) => {
  await navigate(page, '智能问答');
  await page.locator('textarea').fill('科研失信调查人员是否需要签署保密协议？');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '查看引用 1', exact: true }).first().click();
  await expect(page.locator('.sources-panel')).toBeVisible();
  await expect(page.locator('#source-1')).toHaveClass(/flash/);
  await expect(page.locator('#source-1')).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('mobile-evidence-pane.png') });
  await expect(page.getByRole('button', { name: /证据与引用/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '问答', exact: true }).click();
  await expect(page.locator('.chat-panel')).toBeVisible();
  await expect(page.locator('.msg.assistant')).toContainText('保密');
});

test('手机预审完成后定位到可访问的结果区', async ({ app: page }, testInfo) => {
  await navigate(page, '项目预审');
  await page.getByRole('button', { name: '开始预审' }).click();
  const report = page.getByRole('region', { name: '预审报告' });
  await expect(report.locator('.report-head')).toBeVisible();
  await expect(report).toBeFocused();
  await expect.poll(async () => (await report.boundingBox())?.y ?? -1000).toBeGreaterThanOrEqual(-5);
  await page.screenshot({ path: testInfo.outputPath('mobile-review-result.png') });
});

test('手机预审完成时不抢占上传弹窗焦点', async ({ app: page }) => {
  let release!: () => void; let started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const intercepted = new Promise<void>(resolve => { started = resolve; });
  await page.route('**/api/review', async route => {
    const response = await route.fetch(); started(); await gate; await route.fulfill({ response });
  });
  await navigate(page, '项目预审');
  await page.getByRole('button', { name: '开始预审' }).click();
  await intercepted;
  await page.locator('.topbar-actions').getByRole('button', { name: '上传文档', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '上传文档' });
  await expect(dialog).toBeVisible();
  release();
  await expect(page.getByRole('region', { name: '预审报告' })).toHaveCount(0);
  await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBeTruthy();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: '查看报告', exact: true }).click();
  await expect(page.getByRole('region', { name: '预审报告' })).toBeFocused();
});

for (const method of ['触摸', '键盘'] as const) test(`手机预审期间${method}滚动阅读后不自动跳转报告`, async ({ app: page }) => {
  let release!: () => void; let started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const intercepted = new Promise<void>(resolve => { started = resolve; });
  await page.route('**/api/review', async route => {
    const response = await route.fetch(); started(); await gate; await route.fulfill({ response });
  });
  await navigate(page, '项目预审');
  await page.getByRole('button', { name: '开始预审' }).click();
  await intercepted;
  if (method === '触摸') await page.evaluate(() => window.dispatchEvent(new Event('touchmove')));
  else await page.keyboard.press('PageDown');
  release();
  await expect(page.locator('.review-ready')).toContainText('预审已完成');
  await expect(page.getByRole('region', { name: '预审报告' })).toHaveCount(0);
  await page.getByRole('button', { name: '查看报告', exact: true }).click();
  const report = page.getByRole('region', { name: '预审报告' });
  await expect(report).toBeFocused();
});
