import { test, expect, navigate } from './fixtures';
const sse = (events: unknown[]) => events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('');
const source = (name: string) => ({ index: 1, doc_id: name, doc_name: name, page: 1, section: '测试条款', score: 0.2, text: `${name}的证据` });

test('@smoke 真实离线问答、引用和跨页保留', async ({ app: page }) => {
  await navigate(page, '智能问答');
  await page.locator('textarea').fill('科研失信调查人员是否需要签署保密协议？');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('.msg.assistant .msg-content')).not.toBeEmpty();
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeEnabled();
  await expect(page.locator('.source-card').first()).toBeVisible();
  const answer = await page.locator('.msg.assistant .msg-content').innerText();
  await page.getByRole('button', { name: '查看引用 1', exact: true }).first().click();
  await expect(page.locator('#source-1')).toHaveClass(/flash/);
  await navigate(page, '文档中心'); await navigate(page, '智能问答');
  await expect(page.locator('.msg.assistant .msg-content')).toHaveText(answer, { useInnerText: true });
  await page.getByRole('button', { name: '清空对话' }).click();
  await expect(page.locator('.msg')).toHaveCount(0);
  await expect(page.locator('.source-card')).toHaveCount(0);
});

test('两轮受控回答的旧引用恢复旧证据', async ({ app: page }) => {
  let round = 0;
  await page.route('**/api/chat/stream', route => {
    round++;
    return route.fulfill({ contentType: 'text/event-stream', body: sse([
      { type: 'meta', mode: 'offline', citations: [source(`第${round}轮文档`)] },
      { type: 'token', text: `第${round}轮回答 [1]` }, { type: 'done' },
    ]) });
  });
  await navigate(page, '智能问答');
  for (const question of ['第一问', '第二问']) {
    await page.locator('textarea').fill(question);
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeEnabled();
  }
  await expect(page.locator('.sources-panel')).toContainText('第2轮文档的证据');
  await page.getByRole('button', { name: '查看引用 1', exact: true }).first().click();
  await expect(page.locator('.sources-panel')).toContainText('第1轮文档的证据');
  await expect(page.locator('.sources-panel')).not.toContainText('第2轮文档的证据');
});

test('受控流错误提示和真实请求重试', async ({ app: page }) => {
  await page.route('**/api/chat/stream', route => route.fulfill({ contentType: 'text/event-stream', body: sse([{ type: 'error', message: '受控生成失败' }]) }));
  await navigate(page, '智能问答');
  await page.locator('textarea').fill('测试错误');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('.msg-error')).toContainText('受控生成失败');
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeEnabled();
  await page.unroute('**/api/chat/stream');
  await page.locator('textarea').fill('科研诚信');
  const retry = page.waitForResponse(response => response.url().endsWith('/api/chat/stream'));
  await page.getByRole('button', { name: '发送', exact: true }).click();
  expect((await retry).ok()).toBeTruthy();
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeEnabled();
  await expect(page.locator('.msg.assistant')).toHaveCount(2);
  await expect(page.locator('.msg.assistant').last().locator('.msg-error')).toHaveCount(0);
  await expect(page.locator('.msg.assistant .msg-content').last()).toContainText('原文摘录');
  await expect(page.locator('.source-card').first()).toBeVisible();
});

test('受控慢问答离页取消，晚到回答不污染返回页面', async ({ app: page }) => {
  let release!: () => void; let intercepted!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { intercepted = resolve; });
  await page.route('**/api/chat/stream', async route => {
    intercepted(); await gate;
    await route.fulfill({ contentType: 'text/event-stream', body: sse([{ type: 'token', text: '不应出现的晚到回答' }, { type: 'done' }]) }).catch(() => {});
  });
  await navigate(page, '智能问答');
  await page.locator('textarea').fill('慢问题');
  await page.getByRole('button', { name: '发送', exact: true }).click(); await started;
  await navigate(page, '文档中心'); release();
  await page.unrouteAll({ behavior: 'wait' });
  await navigate(page, '智能问答');
  await expect(page.locator('.chat-messages')).not.toContainText('不应出现的晚到回答');
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeEnabled();
});

test('中文输入法回车不发送，Shift+Enter换行', async ({ app: page }) => {
  await navigate(page, '智能问答');
  const input = page.locator('textarea'); await input.fill('正在输入中文');
  let requests = 0;
  page.on('request', request => { if (request.url().endsWith('/api/chat/stream')) requests++; });
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229, isComposing: true });
  await input.press('Shift+Enter');
  await expect(input).toHaveValue('正在输入中文\n'); expect(requests).toBe(0);
});

test('@smoke 趋势主题、年份联动与2D视图', async ({ app: page }) => {
  await navigate(page, '文献趋势');
  await expect(page.locator('.notice')).toContainText('演示数据');
  await page.getByLabel('分析主题').fill('大模型');
  await page.getByLabel('起始年份').selectOption('2023');
  await page.getByLabel('结束年份').selectOption('2025');
  const pending = page.waitForResponse(r => r.url().endsWith('/api/trends') && r.request().postDataJSON().query === '大模型');
  await page.getByLabel('分析主题').press('Enter'); expect((await pending).ok()).toBeTruthy();
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await expect(page.getByRole('button', { name: '2D', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.chart-2d').first()).toBeVisible();
  await page.getByRole('tab', { name: '分析设置', exact: true }).click();
  const starts = await page.getByLabel('起始年份').locator('option').allTextContents();
  const ends = await page.getByLabel('结束年份').locator('option').allTextContents();
  expect(Math.max(...starts.map(Number))).toBeLessThanOrEqual(2025);
  expect(Math.min(...ends.map(Number))).toBeGreaterThanOrEqual(2023);
});

test('无WebGL回退2D且正常显示统计', async ({ app: page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...args: unknown[]) {
      if (kind.includes('webgl')) return null;
      return original.call(this, kind as '2d', ...args as []) as never;
    } as typeof original;
  });
  await page.goto('/trend');
  await page.getByRole('tab', { name: '趋势图表', exact: true }).click();
  await expect(page.getByRole('button', { name: '3D', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '2D', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.chart-2d').first()).toBeVisible();
});

test('趋势失败可重试，真实空文献库正常显示', async ({ app: page, context }) => {
  await page.route('**/api/trends', route => route.fulfill({ status: 500, json: { error: '受控趋势失败' } }));
  await navigate(page, '文献趋势');
  await expect(page.locator('.error-panel')).toContainText('受控趋势失败');
  await page.unroute('**/api/trends'); await context.request.delete('/api/papers/sample');
  await page.reload();
  await expect(page.locator('.kpi').first()).toContainText('0');
  await page.getByRole('tab', { name: '趋势图表', exact: true }).click();
  // 先让空库3D类目轴完成绘制，不能抢先切2D绕过 formatter 回归。
  if (await page.getByRole('button', { name: '3D', exact: true }).isEnabled()) {
    await expect(page.locator('.chart-3d canvas')).toHaveCount(2);
  } else {
    await expect(page.getByRole('button', { name: '2D', exact: true })).toHaveAttribute('aria-pressed', 'true');
  }
  await expect(page.getByRole('heading', { name: '页面出了点意外', exact: true })).toHaveCount(0);
  await expect(page.locator('.error-panel')).toHaveCount(0);
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await expect(page.locator('.chart-2d').first()).toBeVisible();
  await page.getByRole('tab', { name: '分析设置', exact: true }).click();
  await expect(page.locator('.kpi').first()).toContainText('0');
  await page.screenshot({ path: test.info().outputPath('empty-library-after.png'), fullPage: true });
});

test('受控DeepSeek与千问来源逐次保存，回退不冒认当前模型', async ({ app: page, context }, testInfo) => {
  const health = await (await context.request.get('/api/health')).json();
  health.llm = { configured: true, provider: 'deepseek', label: 'DeepSeek', model: 'deepseek-flash', base_url: '' };
  await page.route('**/api/health', route => route.fulfill({ json: health }));
  await page.reload();
  await navigate(page, '智能问答');
  await expect(page.locator('.topbar .mode-chip')).toHaveCount(0);
  let turn = 0;
  const generations = [
    { provider: 'deepseek', label: 'DeepSeek', model: 'deepseek-flash', status: 'complete' },
    { provider: 'qwen', label: '千问 / DashScope', model: 'qwen-plus', status: 'complete' },
    { provider: 'offline', label: '离线检索', model: '', status: 'fallback' },
    { provider: 'qwen', label: '千问 / DashScope', model: 'qwen-plus', status: 'complete' },
  ];
  await page.route('**/api/chat/stream', route => {
    const generation = generations[turn++];
    return route.fulfill({ contentType: 'text/event-stream', body: sse([
      { type: 'meta', citations: [], mode: 'qwen', warning: '' },
      { type: 'generation', generation },
      { type: 'token', text: `受控第${turn}轮回答` },
      ...(turn === 4 ? [] : [{ type: 'done', generation }]),
    ]) });
  });
  for (let i = 0; i < 4; i++) {
    await page.locator('textarea').fill(`来源核对${i}`);
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeEnabled();
    await expect(page.locator('.msg.assistant')).toHaveCount(i + 1);
  }
  await expect(page.locator('.msg.assistant .generation-source')).toHaveText([
    'DeepSeek · deepseek-flash', '千问 / DashScope · qwen-plus', '已回退离线摘录', '千问 / DashScope · qwen-plus（生成中断）',
  ]);
  await navigate(page, '文档中心'); await navigate(page, '智能问答');
  await expect(page.locator('.msg.assistant .generation-source').first()).toHaveText('DeepSeek · deepseek-flash');
  await page.screenshot({ path: testInfo.outputPath('generation-desktop.png'), fullPage: true });
});

test('问答输入区选择模型与强度并随请求独立发送', async ({ app: page }, testInfo) => {
  const options = { models: [
    { id: 'default', label: 'DeepSeek', model: 'deepseek-flash', available: true, reason: '', strengths: ['default', 'quick', 'low', 'high', 'max'] },
    { id: 'offline', label: '离线摘录', model: '', available: true, reason: '', strengths: ['default'] },
    { id: 'deepseek-v4-pro', label: 'DeepSeek', model: 'deepseek-v4-pro', available: true, reason: '', strengths: ['default', 'quick', 'low', 'high', 'max'] },
    { id: 'qwen-plus', label: '千问 / DashScope', model: 'qwen-plus', available: false, reason: '未配置该供应商密钥', strengths: ['default', 'quick', 'low', 'high', 'max'] },
  ] };
  await page.route('**/api/chat/options', route => route.fulfill({ json: options }));
  let captured: Record<string, unknown> = {};
  await page.route('**/api/chat/stream', route => {
    captured = route.request().postDataJSON();
    return route.fulfill({ contentType: 'text/event-stream', body: sse([
      { type: 'meta', citations: [], mode: 'qwen' },
      { type: 'generation', generation: { provider: 'deepseek', label: 'DeepSeek', model: 'deepseek-v4-pro', strength: 'high', status: 'complete' } },
      { type: 'token', text: '受控回答' }, { type: 'done', generation: { provider: 'deepseek', label: 'DeepSeek', model: 'deepseek-v4-pro', strength: 'high', status: 'complete' } },
    ]) });
  });
  await navigate(page, '智能问答');
  const toolbar = page.locator('.chat-model-controls');
  await expect(toolbar.getByRole('button', { name: /模型：deepseek-flash/ })).toBeEnabled();
  await toolbar.getByRole('button', { name: /模型：/ }).click();
  await expect(page.getByLabel(/千问 \/ DashScope/)).toBeDisabled();
  await expect(toolbar).toContainText('未配置该供应商密钥');
  await page.screenshot({ path: testInfo.outputPath('model-picker-desktop.png') });
  await page.getByLabel(/DeepSeek · deepseek-v4-pro/).check();
  await toolbar.getByRole('button', { name: /强度：/ }).click();
  await page.getByLabel(/^高/).check();
  await page.keyboard.press('Escape');
  await expect(toolbar.getByRole('button', { name: /强度：高/ })).toBeFocused();
  await page.locator('textarea').fill('测试模型设置');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('.msg.assistant')).toContainText('强度：高');
  expect(captured.model).toBe('deepseek-v4-pro');
  expect(captured.strength).toBe('high');
  await navigate(page, '文档中心'); await navigate(page, '智能问答');
  await expect(page.locator('.chat-model-controls')).toContainText('deepseek-v4-pro');
  await expect(page.locator('.msg.assistant')).toContainText('强度：高');
  await navigate(page, '文档中心');
  await page.unroute('**/api/chat/options');
  await page.route('**/api/chat/options', route => route.fulfill({ status: 503, json: { detail: '受控选项加载失败' } }));
  await navigate(page, '智能问答');
  await expect(page.locator('.chat-model-controls')).toContainText('deepseek-v4-pro');
  await expect(page.getByRole('button', { name: '选项加载失败，重试' })).toBeVisible();
});


test('长文档名称在不同宽度保持单行且选择菜单可用', async ({ app: page, documents }) => {
  await navigate(page, '智能问答');
  await page.locator('.scope-btn').click();
  await page.locator('.scope-option').filter({ hasText: documents[0].name }).locator('input').check();
  await page.locator('.scope-btn').click();
  for (const width of [320, 375, 680, 900, 1280, 1920]) {
    await page.setViewportSize({ width, height: 800 });
    const layout = await page.locator('.scope-label').evaluate((el) => {
      const style = getComputedStyle(el);
      return { whiteSpace: style.whiteSpace, height: el.getBoundingClientRect().height, fontSize: parseFloat(style.fontSize) };
    });
    expect(layout.whiteSpace).toBe('nowrap');
    expect(layout.height).toBeLessThanOrEqual(layout.fontSize * 2);
    await page.locator('.scope-btn').click();
    await expect(page.locator('.scope-menu')).toBeVisible();
    await page.locator('.scope-btn').click();
  }
});
