import { test, expect, password } from './fixtures';

test('所有路由共享文档中心的紧凑工作区外壳', async ({ app: page }) => {
  const taskRoutes = ['/dossiers', '/review', '/match', '/chat', '/graph', '/trend', '/library'];
  const allRoutes = ['/welcome', ...taskRoutes];

  for (const [width, height] of [[1440, 900], [1280, 720]] as const) {
    await page.setViewportSize({ width, height });
    const shells = [];

    for (const path of allRoutes) {
      await page.goto(path);
      await expect(page.locator('.workspace-home')).toBeVisible();
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
          index: box('.workspace-index'),
          stage: box('.workspace-stage'),
        };
      }, path));
    }

    const taskShells = shells.filter(shell => shell.task);
    const unique = (values: number[]) => Math.max(...values) - Math.min(...values) <= 1;
    expect(unique(shells.map(shell => shell.topbar.y)), `${width}px 顶栏起点应一致`).toBeTruthy();
    expect(unique(shells.map(shell => shell.topbar.height)), `${width}px 顶栏高度应一致`).toBeTruthy();
    expect(unique(shells.map(shell => shell.index.height)), `${width}px 功能索引高度应一致`).toBeTruthy();
    expect(unique(taskShells.map(shell => shell.ledger.height)), `${width}px 卷宗栏高度应一致`).toBeTruthy();
    expect(unique(taskShells.map(shell => shell.index.y)), `${width}px 功能索引起点应一致`).toBeTruthy();
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
