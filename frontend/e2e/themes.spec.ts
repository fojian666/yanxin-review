import { test, expect, password } from './fixtures';

test('四套主题在各工作面切换、保留并支持键盘操作', async ({ app: page, context }, testInfo) => {
  test.setTimeout(180_000);
  expect((await context.request.post('/api/auth/login', { data: { username: 'admin', password } })).ok()).toBeTruthy();
  const routes = ['/welcome', '/dossiers', '/review', '/match', '/chat', '/graph', '/trend', '/library', '/admin'];
  const topbarBackgrounds = new Set<string>();
  const tableHeaderBackgrounds = new Set<string>();
  const topbarLeadingColors = {
    mono: 'rgb(48, 54, 56)',
    blue: 'rgb(22, 77, 112)',
    aurora: 'rgb(81, 67, 114)',
    paper: 'rgb(11, 26, 35)',
  } as const;
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
      const shellBar = await page.evaluate(() => {
        const sidebar = document.querySelector<HTMLElement>('.sidebar')!;
        const topbar = document.querySelector<HTMLElement>('.topbar')!;
        const sidebarBox = sidebar.getBoundingClientRect();
        const topbarBox = topbar.getBoundingClientRect();
        const style = getComputedStyle(topbar);
        return {
          sidebarRight: sidebarBox.right,
          topbarLeft: topbarBox.left,
          topbarRight: topbarBox.right,
          bodyRight: document.body.getBoundingClientRect().right,
          viewportWidth: innerWidth,
          background: style.backgroundImage,
          radius: style.borderTopLeftRadius,
        };
      });
      expect(Math.abs(shellBar.topbarLeft - shellBar.sidebarRight), `${value} ${route} 顶栏未贴合侧栏`).toBeLessThanOrEqual(1);
      expect(shellBar.topbarRight, `${value} ${route} 顶栏未贯穿可用宽度`).toBeGreaterThanOrEqual(shellBar.viewportWidth - 1);
      expect(shellBar.bodyRight, `${value} ${route} 右侧保留了滚动条空槽`).toBeGreaterThanOrEqual(shellBar.viewportWidth - 1);
      expect(shellBar.radius, `${value} ${route} 顶栏不应是独立卡片`).toBe('0px');
      expect(shellBar.background, `${value} ${route} 顶栏缺少主题底色`).toContain('linear-gradient');
      expect(shellBar.background, `${value} ${route} 顶栏与侧栏顶部颜色未衔接`).toContain(topbarLeadingColors[value]);
      topbarBackgrounds.add(shellBar.background);
      if (route === '/trend') {
        await page.getByRole('tab', { name: '趋势图表', exact: true }).click();
        await expect(page.locator('.chart-panel').first()).toBeVisible();
        if (value === 'mono') await expect(page.locator('.chart-panel').first()).toHaveCSS('filter', 'none');
      }
      if (route === '/admin') {
        const header = page.locator('.data-table th').first();
        await expect(header).toHaveCSS('color', 'rgb(255, 255, 255)');
        const background = await header.evaluate(element => getComputedStyle(element).backgroundImage);
        expect(background).toContain('linear-gradient');
        tableHeaderBackgrounds.add(background);
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
  expect(topbarBackgrounds.size, '四套主题应有各自顶栏配色').toBe(4);
  expect(tableHeaderBackgrounds.size, '四套主题应有各自表头配色').toBe(4);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/welcome');
  await expect(page.locator('.theme-menu + .simple-mode-trigger')).toBeVisible();
  await page.getByRole('button', { name: '开启简约模式' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-simple-mode', 'true');
  await expect(page.getByRole('button', { name: '关闭简约模式' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.topbar-title h1')).toHaveCSS('animation-name', 'none');
  await expect(page.locator('.workspace-overview-mark')).toHaveCSS('display', 'none');
  await expect(page.locator('.sidebar-toggle .lucide')).toHaveCSS('display', 'block');
  expect(await page.evaluate(() => document.getAnimations().filter(animation => animation.playState === 'running').length)).toBe(0);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-simple-mode', 'true');
  await page.goto('/review');
  await page.getByRole('tab', { name: '结论概览', exact: true }).click();
  await expect.poll(() => page.locator('.review-deck .work-deck-panel').last().evaluate(panel => panel.getAnimations().length)).toBe(0);
  await page.goto('/welcome');
  await page.getByRole('button', { name: '关闭简约模式' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-simple-mode', 'false');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-simple-mode', 'false');
});

test('手机和窄屏主题入口可见，选项可切换且不挤压上传', async ({ app: page }, testInfo) => {
  for (const width of [320, 375, 680, 681]) {
    await page.setViewportSize({ width, height: 812 });
    await page.goto('/chat');
    const toggle = page.getByRole('button', { name: '切换主题' });
    const simple = page.getByRole('button', { name: '开启简约模式' });
    const upload = page.locator('.topbar-actions').getByRole('button', { name: '上传文档' });
    await expect(toggle).toBeVisible();
    await expect(upload).toBeVisible();
    expect(await page.locator('.topbar-title h1').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
    await toggle.click();
    await expect(simple).toBeVisible();
    await page.getByRole('radio', { name: '极光紫' }).check();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'aurora');
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(238, 237, 246)');
    const rect = await page.locator('.theme-options').boundingBox();
    expect(rect && rect.x >= 0 && rect.x + rect.width <= width).toBeTruthy();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
    await page.screenshot({ path: testInfo.outputPath(`theme-mobile-${width}.png`) });
    await page.keyboard.press('Escape');
    if (width === 320) {
      await toggle.click();
      await simple.click();
      await expect(page.locator('html')).toHaveAttribute('data-simple-mode', 'true');
      await expect(page.getByRole('button', { name: '关闭简约模式' })).toHaveAttribute('aria-pressed', 'true');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
      await page.getByRole('button', { name: '关闭简约模式' }).click();
    }
  }
});

test('简约模式文档目录保持正常列宽，黑白主题保留彩色内容并使用主题表头', async ({ app: page }, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/library');
  await page.getByRole('button', { name: '开启简约模式' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-simple-mode', 'true');

  for (const width of [1440, 1280, 1024]) {
    await page.setViewportSize({ width, height: 720 });
    await page.reload();
    const directory = page.locator('.document-directory-shell');
    await expect(directory).toBeVisible();
    const row = page.locator('.document-directory-group > button').first();
    await expect(row).toBeVisible();
    await expect(row.locator('.document-directory-icon')).toBeHidden();
    const layout = await row.evaluate(element => {
      const rowBox = element.getBoundingClientRect();
      const copy = element.querySelector<HTMLElement>('.document-directory-copy')!;
      const title = element.querySelector<HTMLElement>('.document-directory-copy strong')!;
      return {
        rowWidth: rowBox.width,
        rowHeight: rowBox.height,
        copyWidth: copy.getBoundingClientRect().width,
        titleWidth: title.getBoundingClientRect().width,
        gridColumns: getComputedStyle(element).gridTemplateColumns,
        overflow: element.scrollWidth <= element.clientWidth + 1,
      };
    });
    expect(layout.rowWidth, `${width}px 目录行宽度塌陷`).toBeGreaterThan(150);
    expect(layout.rowHeight, `${width}px 目录文字纵向坍缩`).toBeLessThan(130);
    expect(layout.copyWidth, `${width}px 文件文字区域未展开`).toBeGreaterThan(150);
    expect(layout.titleWidth, `${width}px 文件标题宽度异常`).toBeGreaterThan(150);
    expect(layout.gridColumns.split(' ')).toHaveLength(1);
    expect(layout.overflow, `${width}px 简约模式目录横向溢出`).toBeTruthy();
    await page.screenshot({ path: testInfo.outputPath(`simple-library-${width}.png`) });
  }

  await page.setViewportSize({ width: 1280, height: 720 });
  for (const [path, title, readySelector] of [
    ['/welcome', '工作台', '.workspace-overview-deck'],
    ['/dossiers', '课题卷宗', '.dossier-workbench-head'],
    ['/review', '项目预审', '.review-run-page .review-control'],
    ['/match', '查重匹配', '.match-run-page'],
    ['/chat', '智能问答', '.chat-layout .chat-panel'],
    ['/graph', '知识图谱', '.kg-canvas-panel'],
    ['/trend', '文献趋势', '.trend-controls-page'],
    ['/library', '文档中心', '.document-center-layout'],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
    await expect(page.locator(readySelector)).toBeVisible();
    await expect(page.locator('.workspace-index, .workspace-tab')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${path} 横向溢出`).toBeTruthy();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1), `${path} 纵向溢出`).toBeTruthy();
    await page.screenshot({ path: testInfo.outputPath(`simple-${path.slice(1)}.png`) });
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/library');
  await page.getByRole('button', { name: '切换主题' }).click();
  await page.getByRole('radio', { name: '黑白' }).check();
  await page.keyboard.press('Escape');
  await expect(page.locator('.topbar')).toHaveCSS('background-image', /linear-gradient/);
  await expect(page.locator('.topbar h1')).toHaveCSS('color', 'rgb(255, 255, 255)');
  await page.getByRole('button', { name: /文献数据/ }).click();
  const header = page.locator('.data-table th').first();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'mono');
  await expect(header).toHaveCSS('color', 'rgb(255, 255, 255)');
  expect(await header.evaluate(element => getComputedStyle(element).backgroundImage)).toContain('linear-gradient');
  await page.screenshot({ path: testInfo.outputPath('mono-table-header.png') });
  await page.goto('/trend');
  await page.getByRole('tab', { name: '趋势图表', exact: true }).click();
  await expect(page.locator('.chart-panel').first()).toBeVisible();
  expect(await page.locator('.chart-panel').first().evaluate(element => getComputedStyle(element).filter)).toBe('none');
  await page.screenshot({ path: testInfo.outputPath('mono-colorful-chart.png') });
});
