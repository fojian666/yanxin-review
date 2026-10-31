import { test, expect, password } from './fixtures';

// 用等效 CSS 视口覆盖浏览器放大后的布局断点；这不是浏览器缩放的完整模拟。
test('桌面放大时各工作区保持可操作且不横向溢出', async ({ app: page, documents }) => {
  test.setTimeout(120_000);
  const routes = [
    ['/welcome', '工作台'], ['/chat', '智能问答'], ['/dossiers', '历史课题'], ['/review', '项目预审'],
    ['/match', '查重匹配'], ['/graph', '知识图谱'], ['/trend', '文献趋势'],
    [`/library?doc=${documents[0].id}`, '文档中心'],
  ];
  for (const scale of [0.8, 0.9, 1, 1.25, 1.5, 2]) {
    await page.setViewportSize({ width: Math.round(1440 / scale), height: Math.round(900 / scale) });
    for (const [path, title] of routes) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${scale}x ${path}`).toBeTruthy();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1), `${scale}x ${path} 页面纵向溢出`).toBeTruthy();
      await expect.poll(() => page.evaluate(() => {
        const panel = document.querySelector<HTMLElement>('.work-deck-panel');
        return !panel || panel.scrollHeight <= panel.clientHeight + 1;
      }), `${scale}x ${path} 章节内容溢出`).toBeTruthy();
      await expect.poll(() => page.locator('.topbar').evaluate(header => {
        const headerBox = header.getBoundingClientRect();
        return [...header.querySelectorAll<HTMLElement>(':scope > .topbar-actions')]
          .every(item => {
            const box = item.getBoundingClientRect();
            return box.top >= headerBox.top - 1 && box.bottom <= headerBox.bottom + 1;
          });
      }), `${scale}x ${path} 顶栏操作溢出`).toBeTruthy();
      if (path === '/dossiers' && scale === 1) {
        const centered = await page.locator('.work-deck-rail nav button').evaluateAll(buttons => buttons.every(button => {
          const number = button.querySelector<HTMLElement>('.work-deck-number');
          const copy = button.querySelector<HTMLElement>('.work-deck-copy');
          if (!number || !copy || number.getClientRects().length === 0) return true;
          const numberRect = number.getBoundingClientRect();
          const copyRect = copy.getBoundingClientRect();
          return Math.abs((numberRect.top + numberRect.height / 2) - (copyRect.top + copyRect.height / 2)) <= 1;
        }));
        expect(centered, '步骤号码与文字必须垂直居中').toBeTruthy();
      }
      if (path === '/graph' && scale >= 1.5) {
        const canvas = page.locator('.kg-canvas-panel');
        await expect(canvas).toBeVisible({ timeout: 30_000 });
        const canvasBox = await canvas.boundingBox();
        expect(canvasBox && canvasBox.width >= 300 && canvasBox.height >= 100, `${scale}x 图谱画布拖动区域`).toBeTruthy();
      }
      if (path === '/trend') {
        const controls = page.locator('.trend-controls-page');
        await expect(controls).toBeVisible({ timeout: 30_000 });
        const controlsFit = await controls.evaluate(element =>
          element.scrollHeight <= element.clientHeight + 1
        );
        expect(controlsFit, `${scale}x 趋势分析设置内容裁切`).toBeTruthy();
        await page.getByRole('tab', { name: '趋势图表', exact: true }).click();
        const chartPanels = page.locator('.trend-chart-page .chart-panel');
        await expect(chartPanels).toHaveCount(2);
        const chartMetrics = await chartPanels.evaluateAll(panels => panels.map(panel => ({
          clientHeight: panel.clientHeight,
          width: panel.getBoundingClientRect().width,
          contentBottom: panel.getBoundingClientRect().bottom
            - parseFloat(getComputedStyle(panel).paddingBottom)
            - parseFloat(getComputedStyle(panel).borderBottomWidth),
          childBottom: Math.max(...Array.from(panel.children).map(child => child.getBoundingClientRect().bottom)),
        })));
        expect(chartMetrics.every(panel => panel.width >= 180 && panel.clientHeight >= 100), `${scale}x 趋势图表被压缩`).toBeTruthy();
        expect(chartMetrics.every(panel => panel.childBottom <= panel.contentBottom + 1), `${scale}x 趋势图表内容裁切`).toBeTruthy();
      }
      const upload = page.getByRole('button', { name: '上传文档' }).first();
      await expect(upload).toBeVisible();
      const box = await upload.boundingBox();
      expect(box && box.width >= 40 && box.height >= 40, `${scale}x ${path} 上传入口`).toBeTruthy();
      if (scale >= 1.5) {
        const tabs = page.locator('.work-deck [role="tab"]');
        const tabCount = await tabs.count();
        for (let index = 0; index < tabCount; index += 1) {
          await tabs.nth(index).click();
          await expect.poll(() => page.evaluate(() => {
            const panel = document.querySelector<HTMLElement>('.work-deck-panel');
            return !panel || panel.scrollHeight <= panel.clientHeight + 1;
          }), `${scale}x ${path} 第 ${index + 1} 章节内容溢出`).toBeTruthy();
        }
      }
    }
  }
  const login = await page.context().request.post('/api/auth/login', { data: { username: 'admin', password } });
  expect(login.ok()).toBeTruthy();
  for (const scale of [0.8, 0.9, 1, 1.25, 1.5, 2]) {
    await page.setViewportSize({ width: Math.round(1440 / scale), height: Math.round(900 / scale) });
    await page.goto('/admin');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('用户管理');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${scale}x 用户管理`).toBeTruthy();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1), `${scale}x 用户管理 页面纵向溢出`).toBeTruthy();
    if (scale >= 1.5) {
      const tabs = page.locator('.admin-deck [role="tab"]');
      const tabCount = await tabs.count();
      for (let index = 0; index < tabCount; index += 1) {
        await tabs.nth(index).click();
        await expect.poll(() => page.evaluate(() => {
          const panel = document.querySelector<HTMLElement>('.admin-deck .work-deck-panel');
          return !panel || panel.scrollHeight <= panel.clientHeight + 1;
        }), `${scale}x 用户管理第 ${index + 1} 章节内容溢出`).toBeTruthy();
      }
    }
  }
});
