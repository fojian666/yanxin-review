import { test, expect, password } from './fixtures';

test('四套主题在各工作面切换、保留并支持键盘操作', async ({ app: page, context }, testInfo) => {
  test.setTimeout(180_000);
  expect((await context.request.post('/api/auth/login', { data: { username: 'admin', password } })).ok()).toBeTruthy();
  const routes = ['/welcome', '/dossiers', '/review', '/match', '/chat', '/graph', '/trend', '/library', '/admin'];
  const topbarBackgrounds = new Set<string>();
  const tableHeaderBackgrounds = new Set<string>();
  const tableHeaderPanelColors = {
    mono: 'rgb(245, 245, 244)',
    blue: 'rgb(244, 249, 253)',
    aurora: 'rgb(244, 242, 250)',
    paper: 'rgb(251, 248, 241)',
  } as const;
  const topbarLeadingColors = {
    mono: 'rgb(48, 54, 56)',
    blue: 'rgb(22, 77, 112)',
    aurora: 'rgb(81, 67, 114)',
    paper: 'rgb(11, 26, 35)',
  } as const;
  for (const [label, value] of [['黑白', 'mono'], ['蓝白', 'blue'], ['极光紫', 'aurora'], ['青绿纸色', 'paper']] as const) {
    await page.goto('/welcome');
    await page.getByRole('button', { name: '切换主题' }).click();
    await page.getByRole('radio', { name: label }).check();
    await expect(page.locator('html')).toHaveAttribute('data-theme', value);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: '切换主题' })).toBeFocused();
    const toggleColors = await page.locator('.sidebar-toggle').evaluate(element => ({
      button: getComputedStyle(element).color,
      icon: getComputedStyle(element.querySelector('svg')!).color,
    }));
    expect(toggleColors.button, `${value} 主题侧栏折叠箭头未使用白色`).toBe('rgb(255, 255, 255)');
    expect(toggleColors.icon, `${value} 主题侧栏折叠图标未继承白色`).toBe('rgb(255, 255, 255)');
    if (value === 'blue') {
      const sidebarLook = await page.locator('.sidebar').evaluate(element => {
        const inactive = element.querySelector<HTMLElement>('.nav-item:not(.active)')!;
        return {
          background: getComputedStyle(element).backgroundColor,
          inactiveColor: getComputedStyle(inactive).color,
        };
      });
      expect(sidebarLook.background, '蓝白主题侧栏应为白色').toBe('rgb(255, 255, 255)');
      expect(sidebarLook.inactiveColor, '蓝白主题导航不应继续使用浅色文字').not.toBe('rgb(233, 242, 239)');
    }
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
      const headingSelectors: Record<string, string> = {
        '/welcome': '.welcome-greeting-row h2',
        '/dossiers': '.dossier-workbench-head h2',
        '/review': '.work-deck-head h3',
        '/match': '.match-hero h2',
        '/chat': '.welcome h2',
        '/graph': '.kg-summary-title strong',
        '/trend': '.trend-hero h2',
        '/library': '.document-reader-head h2',
        '/admin': '.panel-head h2',
      };
      const headingType = await page.locator(headingSelectors[route]).first().evaluate(element => {
        const style = getComputedStyle(element);
        return { family: style.fontFamily, weight: Number.parseInt(style.fontWeight, 10) };
      });
      expect(headingType.family, `${value} ${route} 结构化标题未使用黑体`).toContain('PingFang SC');
      expect(headingType.weight, `${value} ${route} 结构化标题字重不足`).toBeGreaterThanOrEqual(680);
      if (route === '/library') {
        await expect(page.locator('.document-chunk-text').first()).toHaveCSS('font-family', /Kaiti/);
      }
      const shellBar = await page.evaluate(() => {
        const sidebar = document.querySelector<HTMLElement>('.sidebar')!;
        const topbar = document.querySelector<HTMLElement>('.topbar')!;
        const brand = document.querySelector<HTMLElement>('.brand')!;
        const brandHome = document.querySelector<HTMLElement>('.brand-home')!;
        const topbarTitle = document.querySelector<HTMLElement>('.topbar-title h1')!;
        const sidebarBox = sidebar.getBoundingClientRect();
        const topbarBox = topbar.getBoundingClientRect();
        const brandBox = brand.getBoundingClientRect();
        const brandHomeBox = brandHome.getBoundingClientRect();
        const topbarTitleBox = topbarTitle.getBoundingClientRect();
        const style = getComputedStyle(topbar);
        return {
          sidebarRight: sidebarBox.right,
          sidebarBorderRight: getComputedStyle(sidebar).borderRightWidth,
          topbarLeft: topbarBox.left,
          topbarRight: topbarBox.right,
          topbarTop: topbarBox.top,
          topbarHeight: topbarBox.height,
          brandLeft: brandBox.left,
          brandRight: brandBox.right,
          brandTop: brandBox.top,
          brandHeight: brandBox.height,
          brandBorderBottom: getComputedStyle(brand).borderBottomWidth,
          brandBackground: getComputedStyle(brand).backgroundImage,
          brandBackgroundSize: getComputedStyle(brand).backgroundSize,
          topbarBackgroundSize: style.backgroundSize,
          brandCenterY: brandHomeBox.top + brandHomeBox.height / 2,
          logoCenterY: document.querySelector<HTMLElement>('.brand-mark')!.getBoundingClientRect().top
            + document.querySelector<HTMLElement>('.brand-mark')!.getBoundingClientRect().height / 2,
          toggleCenterY: document.querySelector<HTMLElement>('.sidebar-toggle')!.getBoundingClientRect().top
            + document.querySelector<HTMLElement>('.sidebar-toggle')!.getBoundingClientRect().height / 2,
          titleCenterY: topbarTitleBox.top + topbarTitleBox.height / 2,
          bodyRight: document.body.getBoundingClientRect().right,
          viewportWidth: innerWidth,
          background: style.backgroundImage,
          topbarBorderBottom: style.borderBottomWidth,
          radius: style.borderTopLeftRadius,
        };
      });
      expect(Math.abs(shellBar.topbarLeft - shellBar.sidebarRight), `${value} ${route} 顶栏未贴合侧栏`).toBeLessThanOrEqual(1);
      expect(shellBar.sidebarBorderRight, `${value} ${route} 侧栏与系统栏之间出现分隔线`).toBe('0px');
      expect(shellBar.topbarRight, `${value} ${route} 顶栏未贯穿可用宽度`).toBeGreaterThanOrEqual(shellBar.viewportWidth - 1);
      expect(shellBar.bodyRight, `${value} ${route} 右侧保留了滚动条空槽`).toBeGreaterThanOrEqual(shellBar.viewportWidth - 1);
      expect(Math.abs(shellBar.brandLeft), `${value} ${route} 品牌区未从窗口左边开始`).toBeLessThanOrEqual(1);
      expect(Math.abs(shellBar.brandRight - shellBar.sidebarRight), `${value} ${route} 品牌区未与侧栏同宽`).toBeLessThanOrEqual(1);
      expect(Math.abs(shellBar.brandTop - shellBar.topbarTop), `${value} ${route} 品牌区与系统栏起点不一致`).toBeLessThanOrEqual(1);
      expect(Math.abs(shellBar.brandHeight - shellBar.topbarHeight), `${value} ${route} 品牌区与系统栏高度不一致`).toBeLessThanOrEqual(1);
      expect(Math.abs(shellBar.brandCenterY - shellBar.titleCenterY), `${value} ${route} 品牌与页面标题中线未对齐`).toBeLessThanOrEqual(1);
      expect(shellBar.logoCenterY - shellBar.titleCenterY, `${value} ${route} logo 视觉重心未下移`).toBeGreaterThanOrEqual(2);
      expect(shellBar.logoCenterY - shellBar.titleCenterY, `${value} ${route} logo 视觉重心下移过多`).toBeLessThanOrEqual(4);
      expect(Math.abs(shellBar.logoCenterY - shellBar.toggleCenterY), `${value} ${route} logo 与展开按钮未对齐`).toBeLessThanOrEqual(1);
      expect(shellBar.brandBorderBottom, `${value} ${route} 品牌区底部出现分隔线`).toBe('0px');
      expect(shellBar.topbarBorderBottom, `${value} ${route} 系统栏底部出现分隔线`).toBe('0px');
      expect(shellBar.radius, `${value} ${route} 顶栏不应是独立卡片`).toBe('0px');
      expect(shellBar.background, `${value} ${route} 顶栏缺少主题底色`).toContain('linear-gradient');
      expect(shellBar.background, `${value} ${route} 顶栏与侧栏顶部颜色未衔接`).toContain(topbarLeadingColors[value]);
      expect(shellBar.brandBackground, `${value} ${route} 品牌区与系统栏渐变色不一致`).toBe(shellBar.background);
      expect(shellBar.brandBackgroundSize, `${value} ${route} 品牌区与系统栏渐变宽度不一致`).toBe(shellBar.topbarBackgroundSize);
      topbarBackgrounds.add(shellBar.background);
      if (route === '/trend') {
        await page.getByRole('tab', { name: '趋势图表', exact: true }).click();
        await expect(page.locator('.chart-panel').first()).toBeVisible();
        if (value === 'mono') await expect(page.locator('.chart-panel').first()).toHaveCSS('filter', 'none');
      }
      if (route === '/admin') {
        const header = page.locator('.data-table th').first();
        await expect(header).not.toHaveCSS('color', 'rgb(255, 255, 255)');
        const background = await header.evaluate(element => getComputedStyle(element).backgroundColor);
        expect(background).toBe(tableHeaderPanelColors[value]);
        expect(await header.evaluate(element => getComputedStyle(element).backgroundImage)).toBe('none');
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
  expect(tableHeaderBackgrounds.size, '四套主题应有各自的中性表头底色').toBe(4);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/welcome');
  await expect(page.locator('.theme-menu + .simple-mode-trigger')).toBeVisible();
  await page.getByRole('button', { name: '开启简约模式' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-simple-mode', 'true');
  await expect(page.getByRole('button', { name: '关闭简约模式' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.topbar-title h1')).toHaveCSS('animation-name', 'none');
  await expect(page.locator('.topbar-title-icon')).toHaveCount(0);
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

  await page.getByRole('button', { name: '切换主题' }).click();
  await page.getByRole('radio', { name: '蓝白' }).check();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '收起侧边栏' }).click();
  await expect(page.locator('.app-shell')).toHaveClass(/sidebar-collapsed/);
  await expect(page.locator('.sidebar')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(page.locator('.brand')).toHaveCSS('background-color', 'rgb(22, 77, 112)');
  const collapsedBlue = await page.evaluate(() => {
    const sidebar = document.querySelector<HTMLElement>('.sidebar')!;
    const brand = document.querySelector<HTMLElement>('.brand')!;
    const mark = document.querySelector<HTMLElement>('.brand-mark')!;
    const toggle = document.querySelector<HTMLElement>('.sidebar-toggle')!;
    const inactive = document.querySelector<HTMLElement>('.nav-item:not(.active)')!;
    return {
      sidebarBackground: getComputedStyle(sidebar).backgroundColor,
      sidebarColor: getComputedStyle(sidebar).color,
      brandColor: getComputedStyle(brand).backgroundColor,
      brandTop: brand.getBoundingClientRect().top,
      brandHeight: brand.getBoundingClientRect().height,
      logoLeft: mark.getBoundingClientRect().left,
      logoTop: mark.getBoundingClientRect().top,
      logoWidth: mark.getBoundingClientRect().width,
      logoHeight: mark.getBoundingClientRect().height,
      logoCenterY: mark.getBoundingClientRect().top + mark.getBoundingClientRect().height / 2,
      toggleLeft: toggle.getBoundingClientRect().left,
      toggleTop: toggle.getBoundingClientRect().top,
      toggleWidth: toggle.getBoundingClientRect().width,
      toggleHeight: toggle.getBoundingClientRect().height,
      toggleCenterY: toggle.getBoundingClientRect().top + toggle.getBoundingClientRect().height / 2,
      inactiveColor: getComputedStyle(inactive).color,
    };
  });
  expect(collapsedBlue.sidebarBackground, '蓝白主题折叠侧栏应为白色').toBe('rgb(255, 255, 255)');
  expect(collapsedBlue.sidebarColor, '蓝白主题折叠侧栏文字颜色仍为浅色').not.toBe('rgb(233, 242, 239)');
  expect(collapsedBlue.brandColor, '蓝白主题折叠品牌带未保持深蓝').toBe('rgb(22, 77, 112)');
  expect(collapsedBlue.brandTop, '蓝白主题折叠品牌带未从顶部开始').toBe(0);
  expect(collapsedBlue.brandHeight, '蓝白主题折叠品牌带高度未与系统栏一致').toBe(68);
  expect(Math.abs(collapsedBlue.logoCenterY - collapsedBlue.toggleCenterY), '蓝白主题折叠按钮与 logo 未共用中线').toBeLessThanOrEqual(1);
  expect(collapsedBlue.inactiveColor, '蓝白主题折叠导航应为深色文字').not.toBe('rgb(233, 242, 239)');
  await page.screenshot({ path: testInfo.outputPath('blue-sidebar-collapsed.png') });

  await page.getByRole('button', { name: '展开侧边栏' }).click();
  await expect(page.locator('.app-shell')).not.toHaveClass(/sidebar-collapsed/);
  await page.getByRole('button', { name: '切换主题' }).click();
  await page.getByRole('radio', { name: '黑白' }).check();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '收起侧边栏' }).click();
  await expect(page.locator('.app-shell')).toHaveClass(/sidebar-collapsed/);
  await expect(page.locator('.sidebar')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(page.locator('.brand')).toHaveCSS('background-color', 'rgb(48, 54, 56)');
  const collapsedMono = await page.evaluate(() => {
    const brand = document.querySelector<HTMLElement>('.brand')!;
    const mark = document.querySelector<HTMLElement>('.brand-mark')!;
    const toggle = document.querySelector<HTMLElement>('.sidebar-toggle')!;
    return {
      brandTop: brand.getBoundingClientRect().top,
      brandHeight: brand.getBoundingClientRect().height,
      logoLeft: mark.getBoundingClientRect().left,
      logoTop: mark.getBoundingClientRect().top,
      logoWidth: mark.getBoundingClientRect().width,
      logoHeight: mark.getBoundingClientRect().height,
      logoCenterY: mark.getBoundingClientRect().top + mark.getBoundingClientRect().height / 2,
      toggleLeft: toggle.getBoundingClientRect().left,
      toggleTop: toggle.getBoundingClientRect().top,
      toggleWidth: toggle.getBoundingClientRect().width,
      toggleHeight: toggle.getBoundingClientRect().height,
      toggleCenterY: toggle.getBoundingClientRect().top + toggle.getBoundingClientRect().height / 2,
    };
  });
  expect(collapsedMono.brandTop, '黑白主题折叠品牌带未从顶部开始').toBe(0);
  expect(collapsedMono.brandHeight, '黑白主题折叠品牌带高度未与系统栏一致').toBe(68);
  expect(Math.abs(collapsedMono.logoCenterY - collapsedMono.toggleCenterY), '黑白主题折叠按钮与 logo 未共用中线').toBeLessThanOrEqual(1);
  expect(collapsedMono.toggleLeft, '黑白与蓝白折叠按钮横向位置不一致').toBe(collapsedBlue.toggleLeft);
  expect(collapsedMono.toggleTop, '黑白与蓝白折叠按钮纵向位置不一致').toBe(collapsedBlue.toggleTop);
  expect(collapsedMono.toggleWidth, '黑白与蓝白折叠按钮宽度不一致').toBe(collapsedBlue.toggleWidth);
  expect(collapsedMono.toggleHeight, '黑白与蓝白折叠按钮高度不一致').toBe(collapsedBlue.toggleHeight);
  await page.screenshot({ path: testInfo.outputPath('mono-sidebar-collapsed.png') });

  for (const [label, value, brandColor] of [
    ['极光紫', 'aurora', 'rgb(81, 67, 114)'],
    ['青绿纸色', 'paper', 'rgb(11, 26, 35)'],
  ] as const) {
    await page.getByRole('button', { name: '展开侧边栏' }).click();
    await page.getByRole('button', { name: '切换主题' }).click();
    await page.getByRole('radio', { name: label }).check();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '收起侧边栏' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', value);
    await expect(page.locator('.brand')).toHaveCSS('background-color', brandColor);
    const geometry = await page.evaluate(() => {
      const brand = document.querySelector<HTMLElement>('.brand')!;
      const mark = document.querySelector<HTMLElement>('.brand-mark')!;
      const toggle = document.querySelector<HTMLElement>('.sidebar-toggle')!;
      return {
        brandTop: brand.getBoundingClientRect().top,
        brandHeight: brand.getBoundingClientRect().height,
        logoCenterY: mark.getBoundingClientRect().top + mark.getBoundingClientRect().height / 2,
        toggleLeft: toggle.getBoundingClientRect().left,
        toggleTop: toggle.getBoundingClientRect().top,
        toggleWidth: toggle.getBoundingClientRect().width,
        toggleHeight: toggle.getBoundingClientRect().height,
        toggleCenterY: toggle.getBoundingClientRect().top + toggle.getBoundingClientRect().height / 2,
      };
    });
    expect(geometry.brandTop, `${label}折叠品牌带未从顶部开始`).toBe(0);
    expect(geometry.brandHeight, `${label}折叠品牌带高度未与系统栏一致`).toBe(68);
    expect(Math.abs(geometry.logoCenterY - geometry.toggleCenterY), `${label}折叠按钮与 logo 未共用中线`).toBeLessThanOrEqual(1);
    expect(geometry.toggleLeft, `${label}折叠按钮横向位置与蓝白不一致`).toBe(collapsedBlue.toggleLeft);
    expect(geometry.toggleTop, `${label}折叠按钮纵向位置与蓝白不一致`).toBe(collapsedBlue.toggleTop);
    expect(geometry.toggleWidth, `${label}折叠按钮宽度与蓝白不一致`).toBe(collapsedBlue.toggleWidth);
    expect(geometry.toggleHeight, `${label}折叠按钮高度与蓝白不一致`).toBe(collapsedBlue.toggleHeight);
    await page.screenshot({ path: testInfo.outputPath(`${value}-sidebar-collapsed.png`) });
  }

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  for (const [width, height] of [[1280, 720], [1280, 640]] as const) {
    await page.setViewportSize({ width, height });
    const positions: Array<{ theme: string; topbarTop: number; topbarHeight: number; toggleLeft: number; toggleTop: number; toggleWidth: number; toggleHeight: number }> = [];
    for (const theme of ['paper', 'mono', 'blue', 'aurora'] as const) {
      await page.goto('/welcome');
      await page.evaluate(nextTheme => {
        localStorage.setItem('yanxin.theme', nextTheme);
        localStorage.setItem('yanxin.sidebar', '1');
      }, theme);
      await page.reload();
      await expect(page.locator('.app-shell')).toHaveClass(/sidebar-collapsed/);
      const titleMotion = await page.evaluate(async () => {
        const title = document.querySelector<HTMLElement>('.topbar-title h1')!;
        const logo = document.querySelector<HTMLElement>('.brand-mark')!;
        const animation = title.getAnimations()[0];
        animation.currentTime = 0;
        animation.play();
        const centers: Array<{ title: number; logo: number }> = [];
        for (let index = 0; index < 36; index += 1) {
          await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
          const titleBox = title.getBoundingClientRect();
          const logoBox = logo.getBoundingClientRect();
          centers.push({
            title: titleBox.top + titleBox.height / 2,
            logo: logoBox.top + logoBox.height / 2,
          });
        }
        return centers;
      });
      const titleCenters = titleMotion.map(sample => sample.title);
      expect(Math.max(...titleCenters) - Math.min(...titleCenters), `${width}×${height} ${theme} 标题入场发生纵向位移`).toBeLessThanOrEqual(1);
      expect(titleMotion.every(sample => sample.logo - sample.title >= -1), `${width}×${height} ${theme} 入场期间 logo 高于标题中线`).toBeTruthy();
      positions.push(await page.evaluate(themeName => {
        const topbar = document.querySelector<HTMLElement>('.topbar')!;
        const toggle = document.querySelector<HTMLElement>('.sidebar-toggle')!;
        const bar = topbar.getBoundingClientRect();
        const box = toggle.getBoundingClientRect();
        return {
          theme: themeName,
          topbarTop: bar.top,
          topbarHeight: bar.height,
          toggleLeft: box.left,
          toggleTop: box.top,
          toggleWidth: box.width,
          toggleHeight: box.height,
        };
      }, theme));
    }
    const first = positions[0];
    for (const position of positions.slice(1)) {
      expect(position.topbarTop, `${width}×${height} ${position.theme} 系统栏起点不一致`).toBe(first.topbarTop);
      expect(position.topbarHeight, `${width}×${height} ${position.theme} 系统栏高度不一致`).toBe(first.topbarHeight);
      expect(position.toggleLeft, `${width}×${height} ${position.theme} 按钮横向位置不一致`).toBe(first.toggleLeft);
      expect(position.toggleTop, `${width}×${height} ${position.theme} 按钮纵向位置不一致`).toBe(first.toggleTop);
      expect(position.toggleWidth, `${width}×${height} ${position.theme} 按钮宽度不一致`).toBe(first.toggleWidth);
      expect(position.toggleHeight, `${width}×${height} ${position.theme} 按钮高度不一致`).toBe(first.toggleHeight);
    }
  }
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
    await page.getByRole('radio', { name: '蓝白' }).check();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'blue');
    await expect(page.locator('.sidebar')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(page.locator('.brand')).toHaveCSS('background-color', 'rgb(22, 77, 112)');
    const blueSidebar = await page.evaluate(() => {
      const brand = document.querySelector<HTMLElement>('.brand')!;
      return {
        brandTop: brand.getBoundingClientRect().top,
        brandHeight: brand.getBoundingClientRect().height,
      };
    });
    expect(blueSidebar.brandTop, `${width}px 蓝白主题品牌带应从顶部开始`).toBeLessThanOrEqual(1);
    expect(blueSidebar.brandHeight, `${width}px 蓝白主题品牌带高度异常`).toBeGreaterThanOrEqual(67);
    const rect = await page.locator('.theme-options').boundingBox();
    expect(rect && rect.x >= 0 && rect.x + rect.width <= width).toBeTruthy();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
    await page.screenshot({ path: testInfo.outputPath(`theme-mobile-blue-${width}.png`) });
    await page.getByRole('radio', { name: '黑白' }).check();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'mono');
    await expect(page.locator('.sidebar')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(page.locator('.brand')).toHaveCSS('background-color', 'rgb(48, 54, 56)');
    await page.screenshot({ path: testInfo.outputPath(`theme-mobile-mono-${width}.png`) });
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
  await expect(header).not.toHaveCSS('color', 'rgb(255, 255, 255)');
  expect(await header.evaluate(element => getComputedStyle(element).backgroundImage)).toBe('none');
  await expect(header).toHaveCSS('background-color', 'rgb(245, 245, 244)');
  await page.screenshot({ path: testInfo.outputPath('mono-table-header.png') });
  await page.goto('/trend');
  await page.getByRole('tab', { name: '趋势图表', exact: true }).click();
  await expect(page.locator('.chart-panel').first()).toBeVisible();
  expect(await page.locator('.chart-panel').first().evaluate(element => getComputedStyle(element).filter)).toBe('none');
  await page.screenshot({ path: testInfo.outputPath('mono-colorful-chart.png') });
});
