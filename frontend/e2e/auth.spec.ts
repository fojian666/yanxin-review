import { test, expect, loginUI, navigate, password } from './fixtures';

for (const role of ['admin', 'manager', 'reviewer', 'viewer']) {
  test(`@smoke ${role} 登录、导航权限与服务端边界`, async ({ page, context }) => {
    await loginUI(page, role);
    const nav = page.locator('.nav');
    const sidebarPaths = await nav.locator('a').evaluateAll(items => items.map(item => item.getAttribute('href')));
    expect(new Set(sidebarPaths).size).toBe(sidebarPaths.length);
    await expect(nav.getByRole('link', { name: '用户管理' })).toHaveCount(role === 'admin' ? 1 : 0);
    await expect(nav.getByRole('link', { name: '查重匹配' })).toHaveCount(role === 'viewer' ? 0 : 1);
    await expect(nav.getByRole('link', { name: '项目评审' })).toHaveCount(['admin', 'manager'].includes(role) ? 1 : 0);
    await expect(nav.getByRole('link', { name: '专家审核' })).toHaveCount(['admin', 'reviewer'].includes(role) ? 1 : 0);
    await expect(nav.getByRole('link', { name: '申报流程' })).toHaveCount(1);
    await expect(page.locator('.topbar-actions').getByRole('button', { name: '上传文档', exact: true })).toHaveCount(['admin', 'manager'].includes(role) ? 1 : 0);
    await navigate(page, '文档中心');
    await expect(page.getByRole('button', { name: '删除文档', exact: true }).first()).toHaveCount(['admin', 'manager'].includes(role) ? 1 : 0);
    // 同时验证后端拒绝越权，不能只以隐藏按钮作为权限证明。
    expect((await context.request.get('/api/auth/users')).status()).toBe(role === 'admin' ? 200 : 403);
    expect((await context.request.get('/api/experts')).status()).toBe(role === 'viewer' ? 403 : 200);
    expect((await context.request.get('/api/review-cases')).status()).toBe(role === 'viewer' ? 403 : 200);
    expect((await context.request.get('/api/review-cases/reviewers')).status()).toBe(['admin', 'manager'].includes(role) ? 200 : 403);
    expect((await context.request.get('/api/review-tasks')).status()).toBe(role === 'viewer' ? 403 : 200);
    expect((await context.request.post('/api/review-tasks/missing/submit', { data: {
      recommendation: 'approve',
      opinion: '管理员调试提交权限验证。',
      conflict_declared: false,
      conflict_reason: '',
    } })).status()).toBe(['admin', 'reviewer'].includes(role) ? 400 : 403);
    if (role !== 'viewer') {
      expect((await context.request.post('/api/review-cases', { data: { doc_id: 'missing' } })).status()).toBe(['admin', 'manager'].includes(role) ? 400 : 403);
    }
    if (role === 'viewer') {
      expect((await context.request.post('/api/review', { data: { doc_id: 'missing' } })).status()).toBe(403);
      await page.goto('/match');
      await expect(page).toHaveURL(/\/chat$/);
      await page.goto('/dossiers');
      await expect(page).toHaveURL(/\/dossiers$/);
      await expect(page.locator('.dossier-workbench')).toBeVisible();
      await expect(page.getByRole('button', { name: '新建历史课题' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: '编辑历史课题' })).toHaveCount(0);
    }
    await page.locator('.user-trigger').click();
    await page.getByRole('menuitem', { name: '退出登录' }).click();
    await expect(page.getByPlaceholder('请输入用户名')).toBeVisible();
    expect((await context.request.get('/api/documents')).status()).toBe(401);
    await page.reload();
    await expect(page.getByPlaceholder('请输入用户名')).toBeVisible();
  });
}

test('错误密码可恢复，密码显示开关不更改值', async ({ page }) => {
  await page.goto('/');
  await page.getByPlaceholder('请输入用户名').fill('manager');
  const field = page.getByPlaceholder('请输入密码', { exact: true });
  await field.fill('wrong-password');
  await page.getByRole('button', { name: '登 录', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('用户名或密码错误');
  await field.fill(password);
  await page.getByRole('button', { name: '显示密码' }).click();
  await expect(field).toHaveAttribute('type', 'text');
  await expect(field).toHaveValue(password);
  await page.getByRole('button', { name: '登 录', exact: true }).click();
  await expect(page).toHaveURL(/\/welcome$/);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('工作台');
});

test('会话失效后清除问答和上传弹窗状态', async ({ app: page, context }) => {
  await navigate(page, '智能问答');
  await page.getByPlaceholder('问点什么', { exact: false }).fill('科研诚信');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeEnabled();
  await page.locator('.topbar-actions').getByRole('button', { name: '上传文档', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await context.request.post('/api/auth/logout');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await navigate(page, '文档中心');
  // 主动触发下一次受保护的请求。
  await page.reload();
  await expect(page.getByPlaceholder('请输入用户名')).toBeVisible();
  await loginUI(page);
  await navigate(page, '智能问答');
  await expect(page.locator('.msg')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('管理员创建账号后真实账号可登录，重复创建有反馈', async ({ page, context }, testInfo) => {
  await loginUI(page, 'admin');
  await navigate(page, '用户管理');
  await page.getByRole('tab', { name: '新建用户', exact: true }).click();
  await expect(page.locator('.admin-deck-page').getByRole('heading', { name: '新建用户' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('admin-desktop.png') });
  await page.getByPlaceholder('如 zhangsan').fill('e2e-user');
  await page.getByPlaceholder('设置初始密码').fill('e2e-password');
  await page.getByPlaceholder('显示名称').fill('自动回归用户');
  await page.getByRole('button', { name: '创建用户', exact: true }).click();
  await expect(page.getByRole('row').filter({ hasText: 'e2e-user' })).toContainText('访客');
  await page.getByRole('tab', { name: '新建用户', exact: true }).click();
  await page.getByPlaceholder('如 zhangsan').fill('e2e-user');
  await page.getByPlaceholder('设置初始密码').fill('e2e-password');
  await page.getByRole('button', { name: '创建用户', exact: true }).click();
  await expect(page.locator('.toast').last()).toContainText('创建失败');
  const response = await context.request.post('/api/auth/login', { data: { username: 'e2e-user', password: 'e2e-password' } });
  expect(response.ok()).toBeTruthy();
  await page.reload();
  await expect(page.locator('.nav').getByRole('link', { name: '用户管理' })).toHaveCount(0);
});

test('上传XHR返回401也退出登录，重新登录不残留弹窗', async ({ app: page, context }) => {
  await page.locator('.topbar-actions').getByRole('button', { name: '上传文档', exact: true }).click();
  await page.getByRole('dialog').locator('input[type=file]').setInputFiles({ name: '过期测试.txt', mimeType: 'text/plain', buffer: Buffer.from('科研诚信测试材料') });
  await context.request.post('/api/auth/logout');
  await page.getByRole('button', { name: '开始上传' }).click();
  await expect(page.getByPlaceholder('请输入用户名')).toBeVisible();
  await loginUI(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('键盘跳转主内容与侧栏折叠持久化', async ({ app: page }) => {
  await page.goto('/chat');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('智能问答');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: '跳到主要内容' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
  await page.getByRole('button', { name: '收起侧边栏', exact: true }).click();
  await expect(page.locator('.app-shell')).toHaveClass(/sidebar-collapsed/);
  await page.reload();
  await expect(page.getByRole('button', { name: '展开侧边栏', exact: true })).toBeVisible();
});

test('登录页在桌面和手机可用，演示入口遵循后台开关', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('江苏省自然资源科研诚信智慧治理平台');
  await expect(page.getByRole('heading', { name: '账号登录' })).toBeVisible();
  await expect(page.getByText('材料不出内网')).toHaveCount(0);
  await expect(page.getByText('核心能力')).toHaveCount(0);
  await expect(page.getByText('演示账号', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('login-desktop.png') });
  await page.getByText('演示账号', { exact: true }).click();
  await page.getByRole('button', { name: '科研管理', exact: true }).click();
  await expect(page.getByLabel('用户名', { exact: true })).toHaveValue('manager');
  await expect(page.getByLabel('密码', { exact: true })).toHaveValue(password);
  await page.locator('.access-demo summary').click();
  for (const width of [320, 390, 680]) {
    await page.setViewportSize({ width, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await expect(page.getByRole('button', { name: '登 录' })).toBeInViewport();
    if (width === 390) await page.screenshot({ path: testInfo.outputPath('login-mobile.png') });
  }
  for (const theme of ['paper', 'mono', 'blue', 'aurora']) {
    await page.evaluate(value => localStorage.setItem('yanxin.theme', value), theme);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.getByRole('button', { name: '登 录' })).toBeInViewport();
  }
  await page.evaluate(() => { localStorage.setItem('yanxin.theme', 'blue'); localStorage.setItem('yanxin.simple-mode', '1'); });
  await page.route('**/api/health', async route => {
    const response = await route.fetch();
    const body = await response.json();
    body.demo_login = false;
    await route.fulfill({ response, json: body });
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: '账号登录' })).toBeVisible();
  await expect(page.getByText('演示账号', { exact: true })).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-simple-mode', 'true');
  await expect(page.getByRole('button', { name: '显示密码' }).locator('svg')).toBeVisible();
});
