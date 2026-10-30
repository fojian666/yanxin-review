import { test, expect, password } from './fixtures';

test('所有路由共享文档中心的紧凑工作区外壳', async ({ app: page }) => {
  const taskRoutes = ['/dossiers', '/review', '/match', '/chat', '/graph', '/trend', '/library'];
  const allRoutes = ['/welcome', ...taskRoutes];

  for (const [width, height] of [[1440, 900], [1366, 768], [1280, 720]] as const) {
    await page.setViewportSize({ width, height });
    const shells = [];

    for (const path of allRoutes) {
      await page.goto(path);
      await expect(page.locator('.workspace-home')).toBeVisible();
      await expect(page.locator('.welcome-disclaimer')).toBeVisible();
      await expect(page.locator('.workspace-index, .workspace-tab')).toHaveCount(0);
      shells.push(await page.evaluate(path => {
        const box = (selector: string) => {
          const rect = document.querySelector(selector)!.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        };
        return {
          path,
          task: path !== '/welcome',
          topbar: box('.topbar'),
          ledger: box('.workspace-ledger'),
          stage: box('.workspace-stage'),
        };
      }, path));
    }

    const taskShells = shells.filter(shell => shell.task);
    const unique = (values: number[]) => Math.max(...values) - Math.min(...values) <= 1;
    expect(unique(shells.map(shell => shell.topbar.y)), `${width}px 顶栏起点应一致`).toBeTruthy();
    expect(unique(shells.map(shell => shell.topbar.height)), `${width}px 顶栏高度应一致`).toBeTruthy();
    expect(unique(taskShells.map(shell => shell.ledger.height)), `${width}px 卷宗栏高度应一致`).toBeTruthy();
    expect(unique(taskShells.map(shell => shell.stage.y)), `${width}px 工作面起点应一致`).toBeTruthy();
    expect(unique(taskShells.map(shell => shell.stage.height)), `${width}px 工作面高度应一致`).toBeTruthy();
  }
});

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

test('宽屏分析设置横向利用卡片空间，缩放后保持不溢出', async ({ app: page }) => {
  for (const [width, height] of [[1920, 1080], [1440, 900], [1280, 720]]) {
    await page.setViewportSize({ width, height });
    await page.goto('/trend');
    const layout = await page.locator('.trend-controls').evaluate(controls => {
      const search = controls.querySelector<HTMLElement>('.search-box')!.getBoundingClientRect();
      const years = controls.querySelector<HTMLElement>('.year-row')!.getBoundingClientRect();
      const card = controls.closest<HTMLElement>('.trend-hero')!.getBoundingClientRect();
      return {
        cardWidth: card.width,
        controlsWidth: controls.getBoundingClientRect().width,
        searchWidth: search.width,
        sameRow: Math.abs((search.top + search.height / 2) - (years.top + years.height / 2)) <= 1,
        contentRight: years.right - search.left,
      };
    });
    expect(layout.controlsWidth, `${width}px 设置区未铺满卡片`).toBeGreaterThan(layout.cardWidth * 0.9);
    expect(layout.sameRow, `${width}px 搜索与年份应共用横向空间`).toBeTruthy();
    expect(layout.searchWidth, `${width}px 搜索框未随剩余宽度伸展`).toBeGreaterThan(layout.controlsWidth * 0.45);
    expect(layout.contentRight, `${width}px 设置控件仍未利用右侧空间`).toBeGreaterThan(layout.controlsWidth * 0.9);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}px 横向溢出`).toBeTruthy();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1), `${width}px 页面纵向溢出`).toBeTruthy();
  }
});

test('宽屏工作面、预审控制、匹配控制和新建用户表单铺满可用宽度', async ({ app: page }, testInfo) => {
  await page.setViewportSize({ width: 1920, height: 1080 });

  for (const path of ['/welcome', '/review', '/match', '/chat', '/graph', '/trend', '/library']) {
    await page.goto(path);
    await expect(page.locator('.workspace-home')).toBeVisible();
    const widths = await page.evaluate(() => {
      const pageElement = document.querySelector<HTMLElement>('.page')!;
      const home = document.querySelector<HTMLElement>('.workspace-home')!;
      const style = getComputedStyle(pageElement);
      return {
        pageInner: pageElement.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        home: home.getBoundingClientRect().width,
      };
    });
    expect(widths.home, `${path} 工作区未铺满页面内容宽度`).toBeGreaterThanOrEqual(widths.pageInner - 1);
  }

  await page.goto('/review');
  await expect(page.locator('.review-run-page')).toBeVisible();
  const reviewWidths = await page.evaluate(() => ({
    page: document.querySelector<HTMLElement>('.review-run-page')!.getBoundingClientRect().width,
    control: document.querySelector<HTMLElement>('.review-control')!.getBoundingClientRect().width,
  }));
  expect(reviewWidths.control, '预审运行面板未铺满').toBeGreaterThanOrEqual(reviewWidths.page - 1);

  await page.goto('/match');
  await expect(page.locator('.match-run-page')).toBeVisible();
  const matchWidths = await page.evaluate(() => ({
    hero: document.querySelector<HTMLElement>('.match-hero')!.getBoundingClientRect().width,
    controls: document.querySelector<HTMLElement>('.match-controls')!.getBoundingClientRect().width,
  }));
  expect(matchWidths.controls, '匹配控制区未铺满').toBeGreaterThan(matchWidths.hero * 0.9);

  expect((await page.context().request.post('/api/auth/login', { data: { username: 'admin', password } })).ok()).toBeTruthy();
  await page.goto('/admin');
  await expect(page.locator('.admin-deck')).toBeVisible();
  await page.getByRole('tab', { name: '新建用户', exact: true }).click();
  await expect(page.locator('.admin-create-form')).toBeVisible();
  const adminWidths = await page.evaluate(() => ({
    page: document.querySelector<HTMLElement>('.admin-deck-page')!.getBoundingClientRect().width,
    form: document.querySelector<HTMLElement>('.admin-create-form')!.getBoundingClientRect().width,
  }));
  expect(adminWidths.form, '新建用户表单未利用横向空间').toBeGreaterThan(adminWidths.page * 0.9);
  await page.screenshot({ path: testInfo.outputPath('wide-work-surfaces.png') });
});
