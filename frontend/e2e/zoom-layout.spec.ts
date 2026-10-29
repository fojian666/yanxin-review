import { test, expect, password } from './fixtures';

// 用等效 CSS 视口覆盖浏览器放大后的布局断点；这不是浏览器缩放的完整模拟。
test('桌面放大时各工作区保持可操作且不横向溢出', async ({ app: page, documents }) => {
  test.setTimeout(120_000);
  const routes = [
    ['/welcome', '工作台'], ['/chat', '智能问答'], ['/review', '本子预审'],
    ['/match', '查重匹配'], ['/graph', '知识图谱'], ['/trend', '文献趋势'],
    [`/library?doc=${documents[0].id}`, '文档中心'],
  ];
  for (const scale of [0.8, 0.9, 1, 1.25, 1.5, 2]) {
    await page.setViewportSize({ width: Math.round(1440 / scale), height: Math.round(900 / scale) });
    for (const [path, title] of routes) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${scale}x ${path}`).toBeTruthy();
      await expect.poll(() => page.locator('.workspace-tab > span:not(.workspace-tab-marker)').evaluateAll(items => items.every(item => { const line = parseFloat(getComputedStyle(item).lineHeight); return item.getBoundingClientRect().height <= line * 1.15; })), `${scale}x ${path} 功能索引换行`).toBeTruthy();
      const upload = page.getByRole('button', { name: '上传文档' }).first();
      await expect(upload).toBeVisible();
      const box = await upload.boundingBox();
      expect(box && box.width >= 40 && box.height >= 40, `${scale}x ${path} 上传入口`).toBeTruthy();
    }
  }
  const login = await page.context().request.post('/api/auth/login', { data: { username: 'admin', password } });
  expect(login.ok()).toBeTruthy();
  for (const scale of [0.8, 0.9, 1, 1.25, 1.5, 2]) {
    await page.setViewportSize({ width: Math.round(1440 / scale), height: Math.round(900 / scale) });
    await page.goto('/admin');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('用户管理');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${scale}x 用户管理`).toBeTruthy();
  }
});
