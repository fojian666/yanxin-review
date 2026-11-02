import { test, expect, navigate } from './fixtures';

const SYSTEM_NAME = '江苏省自然资源科研诚信智慧治理平台';

test('平台固定蓝白外壳、统一品牌和无主题简约入口', async ({ app: page }, testInfo) => {
  await page.goto('/welcome');

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'blue');
  await expect(page.locator('.brand-name')).toHaveText(SYSTEM_NAME);
  await expect(page.locator('.brand-mark')).toHaveCount(0);
  await expect(page.locator('.brand-name')).toHaveCSS('white-space', 'nowrap');
  await expect(page.locator('.brand-name')).toHaveCSS('font-size', '16px');
  await expect(page.locator('.topbar-actions').getByRole('button', { name: '切换主题' })).toHaveCount(0);
  await expect(page.locator('.topbar-actions').getByRole('button', { name: /简约模式/ })).toHaveCount(0);
  await expect(page.locator('.theme-menu, .theme-trigger, .simple-mode-trigger')).toHaveCount(0);
  await expect(page).toHaveTitle(`工作台 · ${SYSTEM_NAME}`);
  await expect(page.locator('.topbar-title, .topbar-title-icon')).toHaveCount(0);

  const nav = page.locator('.nav .nav-item');
  await expect(nav.first()).toContainText('智能问答');
  await expect(nav.nth(1)).toContainText('项目评审');
  await expect(nav.nth(2)).toContainText('申报流程');
  await expect(nav.first()).toHaveAttribute('href', '/chat');
  await expect(nav.nth(1)).toHaveAttribute('href', '/review-cases');
  await expect(nav.nth(2)).toHaveAttribute('href', '/dossiers');
  const navWeights = await nav.evaluateAll(items => items.map(item => Number.parseInt(getComputedStyle(item).fontWeight, 10)));
  expect(navWeights.every(weight => weight >= 700)).toBeTruthy();

  await expect(page.locator('.nav')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(page.locator('.sidebar')).toHaveCSS('background-color', 'rgb(242, 248, 253)');
  const shell = await page.evaluate(() => {
    const brand = document.querySelector<HTMLElement>('.brand')!.getBoundingClientRect();
    const topbar = document.querySelector<HTMLElement>('.topbar')!.getBoundingClientRect();
    const sidebar = document.querySelector<HTMLElement>('.sidebar')!.getBoundingClientRect();
    const nav = document.querySelector<HTMLElement>('.nav')!.getBoundingClientRect();
    const brandName = document.querySelector<HTMLElement>('.brand-name')!.getBoundingClientRect();
    const toggle = document.querySelector<HTMLElement>('.sidebar-toggle')!.getBoundingClientRect();
    return {
      brandTop: brand.top,
      brandBottom: brand.bottom,
      brandHeight: brand.height,
      brandWidth: brand.width,
      sidebarLeft: sidebar.left,
      sidebarWidth: sidebar.width,
      navLeft: nav.left,
      navTop: nav.top,
      navWidth: nav.width,
      sidebarBottom: sidebar.bottom,
      navBottom: nav.bottom,
      topbarRight: topbar.right,
      viewportRight: window.innerWidth,
      topbarHeight: topbar.height,
      toggleCenter: toggle.top + toggle.height / 2,
      brandNameCenter: brandName.top + brandName.height / 2,
      brandCenter: brand.top + brand.height / 2,
    };
  });
  expect(Math.abs(shell.brandTop)).toBeLessThanOrEqual(1);
  expect(Math.abs(shell.brandHeight - shell.topbarHeight)).toBeLessThanOrEqual(1);
  expect(Math.abs(shell.toggleCenter - shell.brandNameCenter)).toBeLessThanOrEqual(1);
  expect(shell.brandWidth).toBe(380);
  expect(shell.sidebarWidth).toBe(240);
  expect(shell.navWidth).toBe(shell.sidebarWidth);
  expect(shell.navLeft).toBe(shell.sidebarLeft);
  expect(Math.abs(shell.navTop - shell.brandBottom)).toBeLessThanOrEqual(1);
  expect(Math.abs(shell.navBottom - shell.sidebarBottom)).toBeLessThanOrEqual(1);
  expect(Math.abs(shell.topbarRight - shell.viewportRight)).toBeLessThanOrEqual(1);
  const warningContrast = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--warning)';
    probe.style.background = 'var(--warning-soft)';
    document.body.appendChild(probe);
    const parse = (value: string) => value.match(/\d+(?:\.\d+)?/g)!.slice(0, 3).map(Number);
    const luminance = (rgb: number[]) => {
      const values = rgb.map(channel => {
        const value = channel / 255;
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
    };
    const foreground = luminance(parse(getComputedStyle(probe).color));
    const background = luminance(parse(getComputedStyle(probe).backgroundColor));
    probe.remove();
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  });
  expect(warningContrast).toBeGreaterThanOrEqual(4.5);
  const brandNameLayout = await page.locator('.brand-name').evaluate(element => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  }));
  expect(brandNameLayout.scrollWidth).toBeLessThanOrEqual(brandNameLayout.clientWidth + 1);
  await page.screenshot({ path: testInfo.outputPath('unified-blue-welcome.png') });

  for (const route of ['/dossiers', '/review', '/match', '/trend'] as const) {
    await page.goto(route);
    await expect(page.locator('.work-deck-copy small, .work-deck-head p')).toHaveCount(0);
  }
  await page.goto('/chat');
  await expect(page.locator('.welcome > p, .quick-card small, .sources-panel .panel-head p')).toHaveCount(0);
  await page.goto('/library');
  await expect(page.locator('.document-center-title > div > span')).toHaveCount(0);

  const legacyNeutralColors = [
    'rgb(255, 253, 248)',
    'rgb(251, 248, 241)',
    'rgb(248, 244, 235)',
    'rgb(242, 250, 246)',
    'rgb(241, 248, 245)',
    'rgb(239, 233, 221)',
    'rgb(232, 246, 241)',
    'rgb(228, 242, 237)',
  ];
  const assertThemeNeutral = async () => {
    const leaks = await page.locator('.page *').evaluateAll((elements, legacyColors) => elements
      .filter(element => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 4
          && rect.height > 4
          && style.display !== 'none'
          && style.visibility !== 'hidden'
          && !element.closest('.status-pass, .status-warn, .status-fail, .role-badge, .badge-sample, .dossier-check-dot');
      })
      .map(element => {
        const style = getComputedStyle(element);
        const colors = [style.backgroundColor, style.backgroundImage, style.borderColor].join(' ');
        return legacyColors.some(color => colors.includes(color))
          ? `${element.tagName.toLowerCase()}.${String(element.className)} ${colors}`
          : '';
      })
      .filter(Boolean), legacyNeutralColors);
    expect(leaks).toEqual([]);
  };

  for (const route of ['/chat', '/graph', '/library'] as const) {
    await page.goto(route);
    await assertThemeNeutral();
  }
  for (const route of ['/dossiers', '/review', '/match', '/trend', '/admin'] as const) {
    await page.goto(route);
    const tabs = page.locator('.work-deck-rail [role="tab"]');
    const count = await tabs.count();
    for (let index = 0; index < count; index += 1) {
      await tabs.nth(index).click();
      await assertThemeNeutral();
    }
  }
});

test('主题与简约模式仍可由持久化状态生效但不再显示入口', async ({ app: page, documents }) => {
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

  await page.goto('/graph');
  await page.getByRole('button', { name: '人工知识图谱', exact: true }).click();
  await page.getByLabel('检索知识图谱').fill('科研');
  const clearGraph = page.getByRole('button', { name: '清空图谱搜索' });
  await expect(clearGraph).toBeVisible();
  await expect(clearGraph.locator('svg')).toBeVisible();

  await page.goto(`/review?doc=${documents[0].id}`);
  await page.getByRole('button', { name: '开始预审' }).click();
  const exportReport = page.getByRole('button', { name: '导出完整报告' });
  await expect(exportReport).toBeVisible();
  await expect(exportReport.locator('svg')).toBeVisible();

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
  await expect(page.locator('.brand-name')).toHaveCSS('white-space', 'nowrap');
  const mobileLayout = await page.locator('.brand-name').evaluate(element => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  }));
  expect(mobileLayout.scrollWidth).toBeLessThanOrEqual(mobileLayout.clientWidth + 1);
  expect(mobileLayout.scrollHeight).toBeLessThanOrEqual(mobileLayout.clientHeight + 1);
  await expect(page.locator('.nav .nav-item').first()).toContainText('智能问答');
  await expect(page.locator('.nav .nav-item').nth(1)).toContainText('项目评审');
  await expect(page.locator('.nav .nav-item').nth(2)).toContainText('申报流程');
  await expect(page.locator('.brand-mark')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('unified-blue-mobile-nav.png') });
  await page.keyboard.press('Escape');

  for (const route of ['/chat', '/dossiers', '/review', '/match', '/graph', '/trend', '/library', '/admin'] as const) {
    await page.goto(route);
    await page.getByRole('button', { name: '打开导航' }).click();
    const drawer = await page.evaluate(() => {
      const sidebar = document.querySelector<HTMLElement>('.sidebar')!.getBoundingClientRect();
      const nav = document.querySelector<HTMLElement>('.sidebar .nav')!.getBoundingClientRect();
      const brand = document.querySelector<HTMLElement>('.brand')!.getBoundingClientRect();
      const topbar = document.querySelector<HTMLElement>('.topbar')!.getBoundingClientRect();
      return {
        sidebarBottom: sidebar.bottom,
        navBottom: nav.bottom,
        navHeight: nav.height,
        brandHeight: brand.height,
        topbarHeight: topbar.height,
      };
    });
    expect(drawer.navHeight).toBeGreaterThan(0);
    expect(Math.abs(drawer.sidebarBottom - drawer.navBottom)).toBeLessThanOrEqual(1);
    expect(Math.abs(drawer.brandHeight - drawer.topbarHeight)).toBeLessThanOrEqual(1);
    await page.keyboard.press('Escape');
  }
  await page.goto('/welcome');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await navigate(page, '申报流程');
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
  await page.locator('.nav .nav-item').first().hover();
  await expect(page.locator('.nav .nav-item').first()).toHaveCSS('transform', 'none');
  await expect(page.locator('.nav .nav-item').first()).toHaveCSS('background-color', 'rgb(242, 247, 250)');
  await expect(page.locator('.nav .nav-item.active')).toHaveCSS('background-color', 'rgb(220, 239, 249)');
  const hoveredItem = await page.locator('.nav .nav-item').first().evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, width: rect.width, height: rect.height };
  });
  const activeItem = await page.locator('.nav .nav-item.active').evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, width: rect.width, height: rect.height };
  });
  expect(Math.abs(hoveredItem.left - activeItem.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(hoveredItem.width - activeItem.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(hoveredItem.height - activeItem.height)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath('unified-blue-collapsed-hover.png') });
  await page.screenshot({ path: testInfo.outputPath('unified-blue-collapsed.png') });

  const revealBackdrop = await page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>('.app-shell')!;
    const backdrop = getComputedStyle(shell, '::before');
    const brand = getComputedStyle(document.querySelector<HTMLElement>('.brand')!);
    const topbar = getComputedStyle(document.querySelector<HTMLElement>('.topbar')!);
    return {
      backdropContent: backdrop.content,
      backdropWidth: Number.parseFloat(backdrop.width),
      backdropHeight: Number.parseFloat(backdrop.height),
      backdropBackground: backdrop.backgroundColor,
      backdropImage: backdrop.backgroundImage,
      backdropAttachment: backdrop.backgroundAttachment,
      backdropSize: backdrop.backgroundSize,
      brandImage: brand.backgroundImage,
      brandAttachment: brand.backgroundAttachment,
      brandSize: brand.backgroundSize,
      topbarImage: topbar.backgroundImage,
      topbarAttachment: topbar.backgroundAttachment,
      topbarSize: topbar.backgroundSize,
    };
  });
  expect(revealBackdrop.backdropContent).toBe('""');
  expect(revealBackdrop.backdropWidth).toBeGreaterThanOrEqual(1440);
  expect(revealBackdrop.backdropHeight).toBeGreaterThanOrEqual(68);
  expect(revealBackdrop.backdropAttachment).toBe('fixed');
  expect(revealBackdrop.brandAttachment).toBe('fixed');
  expect(revealBackdrop.topbarAttachment).toBe('fixed');
  expect(revealBackdrop.brandImage).toBe(revealBackdrop.backdropImage);
  expect(revealBackdrop.topbarImage).toBe(revealBackdrop.backdropImage);
  expect(revealBackdrop.brandSize).toBe(revealBackdrop.backdropSize);
  expect(revealBackdrop.topbarSize).toBe(revealBackdrop.backdropSize);

  for (const theme of ['mono', 'paper'] as const) {
    await page.setViewportSize({ width: 1000, height: 300 });
    await page.evaluate(value => {
      localStorage.setItem('yanxin.theme', value);
      localStorage.setItem('yanxin.sidebar', '0');
    }, theme);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const navScroller = page.locator('.nav');
    await expect(navScroller).toHaveCSS('overflow-y', 'auto');
    expect(await navScroller.evaluate(element => element.scrollHeight > element.clientHeight + 1)).toBeTruthy();
    await navScroller.hover();
    await page.mouse.wheel(0, 260);
    await expect.poll(() => navScroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    const lastItem = page.locator('.nav .nav-item').last();
    await lastItem.scrollIntoViewIfNeeded();
    const box = await lastItem.boundingBox();
    expect(box && box.y + box.height <= 300).toBeTruthy();
  }
});
