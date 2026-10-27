import { test, expect, navigate } from './fixtures';

// 单独保留正常动效录像；常规业务回归仍使用减少动态效果。
test.use({ video: 'on' });
for (const [label, width, height] of [['桌面', 1440, 900], ['手机', 375, 812]] as const) {
  test(`${label}翻卷入页每次进入重播，同页状态不重播且尊重动态偏好`, async ({ app: page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect.poll(() => page.locator('.route-arrival').evaluate(element => element.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length)).toBe(0);
    await page.evaluate(() => {
      const state = window as typeof window & { routeArrivals: string[] };
      state.routeArrivals = [];
      document.addEventListener('animationstart', event => {
        if (event.animationName !== 'route-paper-open') return;
        state.routeArrivals.push(location.pathname);
        // 暂停首次真实入场的160ms中间帧，供视觉审查；随后恢复自然播放。
        if (state.routeArrivals.length === 1) {
          document.querySelector('.route-arrival')?.getAnimations({ subtree: true }).forEach(animation => {
            animation.pause(); animation.currentTime = 160;
          });
        }
      });
    });
    const arrivals = () => page.evaluate(() => (window as typeof window & { routeArrivals: string[] }).routeArrivals);
    await navigate(page, '智能问答');
    await expect.poll(arrivals).toEqual(['/chat']);
    const marker = page.locator('.route-arrival');
    await expect(marker).toHaveAttribute('aria-hidden', 'true');
    await expect(marker).toHaveCSS('pointer-events', 'none');
    await expect.poll(() => page.locator('#site-nav').evaluate(element => element.getAnimations().filter(animation => animation.playState === 'running').length)).toBe(0);
    const unfolding = testInfo.outputPath(`route-unfolding-${width}.png`);
    await page.screenshot({ path: unfolding });
    await testInfo.attach('翻卷入页中间帧', { path: unfolding, contentType: 'image/png' });
    await marker.evaluate(element => element.getAnimations({ subtree: true }).forEach(animation => animation.play()));
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
  });
}
