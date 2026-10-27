import { test, expect, navigate } from './fixtures';

// 全程自然播放并逐帧采样，不能用暂停帧替代连续动效验证。
type MotionAudit = { routeArrivals: string[]; pageOpacities: number[]; drawerRights: number[]; sampling: boolean };
test.use({ video: 'on' });
for (const [label, width, height] of [['桌面', 1440, 900], ['手机', 375, 812]] as const) {
  test(`${label}翻卷入页每次进入重播，同页状态不重播且尊重动态偏好`, async ({ app: page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect.poll(() => page.locator('.route-arrival').evaluate(element => element.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length)).toBe(0);
    await page.evaluate(() => {
      const state = window as typeof window & MotionAudit;
      state.routeArrivals = []; state.pageOpacities = []; state.drawerRights = []; state.sampling = true;
      const sample = () => {
        const page = document.querySelector('.page');
        state.pageOpacities.push(page ? Number(getComputedStyle(page).opacity) : 0);
        if (state.sampling) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
      document.addEventListener('animationstart', event => {
        if (event.animationName !== 'route-paper-open') return;
        state.routeArrivals.push(location.pathname);
        if (innerWidth <= 680) {
          state.drawerRights.push(document.getElementById('site-nav')!.getBoundingClientRect().right);
        }
      });
    });
    const arrivals = () => page.evaluate(() => (window as typeof window & MotionAudit).routeArrivals);
    await navigate(page, '智能问答');
    await expect.poll(arrivals).toEqual(['/chat']);
    const marker = page.locator('.route-arrival');
    await expect(marker).toHaveAttribute('aria-hidden', 'true');
    await expect(marker).toHaveCSS('pointer-events', 'none');
    await expect.poll(() => page.locator('#site-nav').evaluate(element => element.getAnimations().filter(animation => animation.playState === 'running').length)).toBe(0);
    const unfolding = testInfo.outputPath(`route-unfolding-${width}.png`);
    await page.screenshot({ path: unfolding });
    await testInfo.attach('自然切页画面', { path: unfolding, contentType: 'image/png' });

    await page.locator('.composer textarea').fill('同页输入不应重播');
    await page.evaluate(() => {
      history.pushState(null, '', `${location.pathname}?scope=regression`);
      dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect(page).toHaveURL(/scope=regression/);
    await expect(page.locator('.composer textarea')).toHaveValue('同页输入不应重播');
    await navigate(page, '文档库');
    await expect.poll(arrivals).toEqual(['/chat', '/library']);
    await navigate(page, '智能问答');
    await expect.poll(arrivals).toEqual(['/chat', '/library', '/chat']);
    await page.goBack();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('文档库');
    await expect.poll(arrivals).toEqual(['/chat', '/library', '/chat', '/library']);
    await expect.poll(() => marker.evaluate(element => element.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length)).toBe(0);
    await expect(page.locator('.route-arrival-tab')).toHaveText('文档库');
    await expect(page.locator('.route-arrival-tab')).toHaveCSS('opacity', '1');
    await expect(page.locator('.route-arrival-paper-front')).toHaveCSS('opacity', '0');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    const screenshot = testInfo.outputPath(`route-arrival-${width}.png`);
    await page.screenshot({ path: screenshot });
    await testInfo.attach('翻卷入页终态', { path: screenshot, contentType: 'image/png' });
    // 运行期切换立即停止；再进入路由也只有静态标记。
    await navigate(page, '智能问答');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(page.locator('.route-arrival-paper-front')).toHaveCSS('animation-name', 'none');
    await expect(page.locator('.route-arrival-tab')).toHaveCSS('animation-name', 'none');
    await navigate(page, '文档库');
    await expect(page.locator('.route-arrival-paper-front')).toHaveCSS('animation-name', 'none');
    await expect(page.locator('.route-arrival-paper-front')).toHaveCSS('transform', 'none');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const audit = await page.evaluate(() => {
      const state = window as typeof window & MotionAudit; state.sampling = false;
      return { pageOpacities: state.pageOpacities, drawerRights: state.drawerRights };
    });
    expect(audit.pageOpacities.length).toBeGreaterThan(10);
    expect(Math.min(...audit.pageOpacities), '正文不得先淡到透明或出现空帧').toBe(1);
    if (width <= 680) {
      expect(audit.drawerRights.length).toBeGreaterThan(0);
      expect(Math.max(...audit.drawerRights), '翻卷开始前抽屉必须完全退场').toBeLessThanOrEqual(1);
    }
  });
}
