import { test, expect, navigate, downloadText } from './fixtures';

test('@smoke 真实预审、规则边界和导出文档一致', async ({ app: page, documents }, testInfo) => {
  await page.goto(`/review?doc=${documents[0].id}`);
  await expect(page.getByLabel('当前卷宗')).toHaveValue(documents[0].id);
  await page.getByRole('button', { name: '开始预审' }).click();
  await expect(page.locator('.report-head')).toContainText(documents[0].name);
  await expect(page.locator('.report-head')).toContainText('规则预审');
  await expect(page.getByRole('heading', { name: '文本查重', exact: true })).toBeVisible();
  await expect(page.locator('.report-seal')).toHaveText('待人工复核');
  await expect(page.locator('.report-limits')).not.toBeEmpty();
  await page.screenshot({ path: testInfo.outputPath('review-desktop.png') });
  const text = await downloadText(page, () => page.getByRole('button', { name: '导出 Markdown', exact: true }).click(), testInfo);
  expect(text).toContain(documents[0].name);
  expect(text).toContain('能力边界');
  expect(text).toContain('文本查重');
  expect(text).toContain('离线规则与检索');
  expect(text).toContain('须经专家和管理人员复核');
  await page.getByLabel('当前卷宗').selectOption(documents[1].id);
  await expect(page.locator('.report-head')).toHaveCount(0);
  await page.getByRole('button', { name: '开始预审' }).click();
  await expect(page.locator('.report-head')).toContainText(documents[1].name);
});

test('预审慢请求期间阻止重复运行，错误后可重试', async ({ app: page, documents }) => {
  await page.goto(`/review?doc=${documents[0].id}`);
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/review', async route => {
    calls++;
    await gate;
    await route.fulfill({ status: 500, json: { error: '受控预审错误' } });
  });
  await page.getByRole('button', { name: '开始预审' }).click();
  await expect(page.getByRole('button', { name: '预审中…' })).toBeDisabled();
  release();
  await expect(page.getByRole('heading', { name: '预审失败', exact: true })).toBeVisible();
  expect(calls).toBe(1);
  await page.unroute('**/api/review');
  await page.getByRole('button', { name: '开始预审' }).click();
  await expect(page.locator('.report-head')).toContainText(documents[0].name);
});

test('预审期间切换卷宗会丢弃旧响应', async ({ app: page, documents }) => {
  await page.goto(`/review?doc=${documents[0].id}`);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void;
  const intercepted = new Promise<void>(resolve => { started = resolve; });
  const oldResponse = page.waitForResponse(response =>
    response.url().endsWith('/api/review') && response.request().postDataJSON().doc_id === documents[0].id
  );
  await page.route('**/api/review', async route => {
    if (route.request().postDataJSON().doc_id !== documents[0].id) return route.continue();
    started();
    await gate;
    await route.continue();
  });
  await page.getByRole('button', { name: '开始预审' }).click();
  await intercepted;
  await page.getByLabel('当前卷宗').selectOption(documents[1].id);
  await expect(page.getByRole('button', { name: '开始预审' })).toBeEnabled();
  await page.getByRole('button', { name: '开始预审' }).click();
  await expect(page.locator('.report-head')).toContainText(documents[1].name);
  release();
  await oldResponse;
  await expect(page.locator('.report-head')).toContainText(documents[1].name);
});

test('@smoke 真实匹配先回避、显示依据并导出，换本子清空结果', async ({ app: page, documents }, testInfo) => {
  await navigate(page, '查重匹配');
  await page.getByLabel('当前卷宗').selectOption(documents[0].id);
  await page.getByRole('button', { name: '运行一体化检查' }).click();
  await expect(page.locator('.match-method-note')).toContainText('不推断简称');
  await page.screenshot({ path: testInfo.outputPath('match-desktop.png') });
  await page.locator('.excluded-box summary').click();
  await expect(page.locator('.excluded-list')).toContainText('示例专家A');
  await expect(page.locator('.excluded-list')).toContainText('与申报单位存在同单位回避');
  await expect(page.locator('.exclusion-evidence').first()).toContainText('原名一致');
  await expect(page.locator('.expert-card').filter({ hasText: '示例专家A' })).toHaveCount(0);
  const text = await downloadText(page, () => page.getByRole('button', { name: '导出结果' }).click(), testInfo);
  expect(text).toContain(documents[0].name);
  expect(text).toContain('专家侧「沄州大学资源环境学院」');
  expect(text).toContain('相似度不等于抄袭');
  await page.getByLabel('当前卷宗').selectOption(documents[1].id);
  await expect(page.getByRole('button', { name: '导出结果' })).toBeDisabled();
  await expect(page.locator('.excluded-box')).toHaveCount(0);
});

test('匹配锁定文档，离页后旧请求不覆盖新本子结果', async ({ app: page, documents, context }) => {
  const oldResult = await (await context.request.post('/api/tool/check', { data: { doc_id: documents[0].id } })).json();
  await navigate(page, '查重匹配');
  await page.getByLabel('当前卷宗').selectOption(documents[0].id);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let intercepted!: () => void;
  const started = new Promise<void>(resolve => { intercepted = resolve; });
  await page.route('**/api/tool/check', async route => {
    if (route.request().postDataJSON().doc_id !== documents[0].id) return route.continue();
    intercepted();
    await gate;
    await route.fulfill({ json: oldResult });
  });
  await page.getByRole('button', { name: '运行一体化检查' }).click();
  await started;
  await expect(page.getByRole('button', { name: '检查中…' })).toBeDisabled();
  await navigate(page, '文档中心');
  await navigate(page, '查重匹配');
  await page.getByLabel('当前卷宗').selectOption(documents[1].id);
  await page.getByRole('button', { name: '运行一体化检查' }).click();
  await expect(page.locator('.match-callout').last()).toContainText('独立测试研究院');
  const received = page.waitForResponse(response => response.url().endsWith('/api/tool/check') && response.request().postDataJSON().doc_id === documents[0].id);
  release();
  await received;
  // 用旧响应处理后的下一次渲染验证，避免“尚未到达就断言不变”。
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.locator('.match-callout').last()).toContainText('独立测试研究院');
  const report = await downloadText(page, () => page.getByRole('button', { name: '导出结果' }).click(), test.info());
  expect(report).toContain(documents[1].name);
  expect(report).toContain(`- 待查文档：${documents[1].name}`);
});

test('匹配请求失败后恢复，缺申报信息独立告警', async ({ app: page, context }) => {
  const response = await context.request.post('/api/documents', { multipart: {
    file: { name: '缺信息.txt', mimeType: 'text/plain', buffer: Buffer.from('科研诚信自然资源数据治理研究，无申报单位和负责人字段。') }, kind: 'proposal', title: 'E2E缺信息',
  } });
  const doc = (await response.json()).document;
  await page.goto('/match');
  await page.getByLabel('当前卷宗').selectOption(doc.id);
  await page.route('**/api/tool/check', route => route.abort('failed'));
  await page.getByRole('button', { name: '运行一体化检查' }).click();
  await expect(page.locator('.error-panel')).toContainText('网络错误');
  await page.unroute('**/api/tool/check');
  await page.getByRole('button', { name: '运行一体化检查' }).click();
  await expect(page.locator('.match-constraint-warning')).toContainText('申报单位、负责人');
});

test('专家CSV导入、归一回避和模板下载', async ({ app: page, documents }, testInfo) => {
  await navigate(page, '查重匹配');
  await page.getByText('管理专家库', { exact: false }).click();
  const template = await downloadText(page, () => page.getByRole('button', { name: '下载 CSV 模板' }).click(), testInfo);
  expect(template).toContain('回避单位');
  await page.locator('input[type=file]').setInputFiles({ name: '专家.csv', mimeType: 'text/csv', buffer: Buffer.from('姓名,单位,学科,研究方向,在研项目数,是否可评审\nE2E归一专家,沄州 大学资源环境学院,科研诚信,数据治理,1,是\n') });
  await expect(page.getByRole('row').filter({ hasText: 'E2E归一专家' })).toBeVisible();
  await page.getByLabel('当前卷宗').selectOption(documents[0].id);
  await page.getByRole('button', { name: '运行一体化检查' }).click();
  await page.locator('.excluded-box summary').click();
  await expect(page.locator('.excluded-list').getByText('E2E归一专家', { exact: true })).toBeVisible();
  await expect(page.locator('.excluded-list')).toContainText('排版归一后一致');
});

test('真实空专家库仍展示回避边界与可解释空态', async ({ app: page, documents, context }) => {
  expect((await context.request.delete('/api/experts/sample')).ok()).toBeTruthy();
  await page.goto('/match');
  await page.getByLabel('当前卷宗').selectOption(documents[0].id);
  await page.getByRole('button', { name: '运行一体化检查' }).click();
  await expect(page.locator('.match-method-note')).toContainText('不推断简称');
  await expect(page.getByText('暂无满足约束的候选专家，请检查专家库或回避 / 负载设置。')).toBeVisible();
  await expect(page.locator('.expert-card')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '导出结果' })).toBeEnabled();
});

test('受控模型模式保留真实政策原文展开与导出引用', async ({ app: page, documents, context }, testInfo) => {
  // 原文来自隔离后端的真实政策检索；仅切换展示模式，不调用外部模型。
  const response = await context.request.post('/api/review', { data: { doc_id: documents[0].id } });
  expect(response.ok()).toBeTruthy();
  const report = await response.json();
  const policy = report.sections.find((section: { key: string }) => section.key === 'policy');
  const item = policy.items.find((entry: { evidence: string; evidence_full?: string }) =>
    entry.evidence_full && entry.evidence_full.length > entry.evidence.length);
  expect(item, '真实政策命中应有可展开原文').toBeTruthy();
  report.mode = 'qwen';
  report.generation = { provider: 'deepseek', label: 'DeepSeek', model: 'deepseek-flash', status: 'complete' };
  report.limitations = [];
  await page.route('**/api/review', route => route.fulfill({ json: report }));
  await page.goto(`/review?doc=${documents[0].id}`);
  await page.getByRole('button', { name: '开始预审' }).click();
  const row = page.locator('.check-item').filter({ hasText: item.label });
  await expect(row.locator('.check-evidence')).toHaveText(item.evidence);
  await row.getByRole('button', { name: /展开全文/ }).click();
  await expect(row.locator('.check-evidence')).toHaveText(item.evidence_full);
  await expect(row.getByRole('button', { name: '收起原文' })).toHaveAttribute('aria-expanded', 'true');
  await row.getByRole('button', { name: '收起原文' }).click();
  await expect(row.locator('.check-evidence')).toHaveText(item.evidence);
  const text = await downloadText(page, () => page.getByRole('button', { name: '导出 Markdown', exact: true }).click(), testInfo);
  expect(text).toContain('生成来源：DeepSeek · deepseek-flash');
  await expect(page.locator('.report-meta .generation-source')).toContainText('DeepSeek · deepseek-flash');
  expect(text).toContain(item.label);
  expect(text).toContain(item.evidence);
  expect(text).toContain('人工核对');
  await page.screenshot({ path: testInfo.outputPath('model-policy-evidence.png'), fullPage: true });
});
