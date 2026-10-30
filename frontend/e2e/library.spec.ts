import { test, expect, navigate, proposalText, downloadText } from './fixtures';

test('文档正文与文献数据独立切换并保持可阅读', async ({ app: page }, testInfo) => {
  for (const [width, height] of [[1440, 900], [720, 450], [375, 812]] as const) {
    await page.setViewportSize({ width, height });
    await page.goto('/library');
    const reader = page.locator('.document-reader-body');
    await expect(reader).toBeVisible();
    await expect.poll(() => reader.evaluate(el => el.clientHeight)).toBeGreaterThan(100);
    await page.screenshot({ path: testInfo.outputPath(`reader-${width}.png`) });
    await reader.focus();
    await reader.press('End');
    await expect.poll(() => reader.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    await reader.press('Home');
    await page.getByRole('button', { name: /文献数据/ }).click();
    await expect(page.getByRole('button', { name: '导入文献 CSV' })).toBeVisible();
    const table = page.locator('.document-literature .table-wrap');
    await expect(table).toBeVisible();
    await expect.poll(() => table.evaluate(el => el.clientHeight)).toBeGreaterThan(40);
    await table.focus();
    await table.evaluate(el => { el.scrollTop = el.scrollHeight; });
    expect(await table.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    await page.screenshot({ path: testInfo.outputPath(`literature-${width}.png`) });
    await page.getByRole('button', { name: '文档正文', exact: true }).click();
    await expect(reader).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBeTruthy();
  }
});

test('@smoke 文档上传、索引、问答跳转、预审跳转与删除闭环', async ({ app: page }, testInfo) => {
  await navigate(page, '文档中心');
  await page.locator('.topbar-actions').getByRole('button', { name: '上传文档', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '上传文档' });
  await dialog.locator('input[type=file]').setInputFiles({ name: '回归上传.txt', mimeType: 'text/plain', buffer: Buffer.from(proposalText('回归研究院')) });
  await dialog.getByLabel('资料类型').selectOption('proposal');
  await dialog.getByPlaceholder('留空则自动取文件名或正文首行').fill('E2E上传闭环');
  await dialog.getByRole('button', { name: '开始上传' }).click();
  await expect(dialog).not.toBeVisible();
  let item = page.locator('.document-directory').getByRole('button', { name: /E2E上传闭环/ });
  await expect(page).toHaveURL(/\/library\?doc=/);
  await item.click();
  await expect(item).toContainText('已索引');
  await expect(page.locator('.document-reader-head')).toContainText('E2E上传闭环');
  await page.getByRole('button', { name: '文档问答', exact: true }).click();
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.locator('.scope-label')).toHaveText('E2E上传闭环');
  await navigate(page, '文档中心');
  item = page.locator('.document-directory').getByRole('button', { name: /E2E上传闭环/ });
  await item.click();
  await page.getByRole('button', { name: '发起预审', exact: true }).click();
  await expect(page.getByLabel('当前卷宗')).toHaveValue(/.+/);
  await expect(page.locator('#workspace-document option:checked')).toHaveText('E2E上传闭环');
  await navigate(page, '文档中心');
  await page.locator('.document-directory').getByRole('button', { name: /E2E上传闭环/ }).click();
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: '删除文档', exact: true }).click();
  await expect(item).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '删除文档', exact: true }).click();
  await expect(page.locator('.document-directory').getByRole('button', { name: /E2E上传闭环/ })).toHaveCount(0);
  await page.getByRole('button', { name: /文献数据/ }).click();
  const template = await downloadText(page, () => page.getByRole('button', { name: '下载 CSV 模板' }).click(), testInfo);
  expect(template).toContain('标题,年份,作者');
});

test('上传校验、键盘焦点与服务端失败后重试', async ({ app: page }) => {
  const trigger = page.locator('.topbar-actions').getByRole('button', { name: '上传文档', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '开始上传' }).click();
  await expect(page.locator('.toast').last()).toContainText('请先选择文件');
  await dialog.locator('input[type=file]').setInputFiles({ name: '不支持.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('invalid') });
  await expect(page.locator('.toast').last()).toContainText('仅支持');
  await dialog.locator('input[type=file]').setInputFiles({ name: '测试.txt', mimeType: 'text/plain', buffer: Buffer.from(proposalText('测试单位')) });
  await dialog.getByPlaceholder('如 2024').fill('1980');
  await dialog.getByRole('button', { name: '开始上传' }).click();
  await expect(page.locator('.toast').last()).toContainText('年份需在');
  await dialog.getByPlaceholder('如 2024').fill('2025');
  await page.route('**/api/documents', route => route.request().method() === 'POST' ? route.fulfill({ status: 500, json: { error: '受控上传失败' } }) : route.continue());
  await dialog.getByRole('button', { name: '开始上传' }).click();
  await expect(page.locator('.toast').last()).toContainText('受控上传失败');
  await expect(dialog.getByRole('button', { name: '开始上传' })).toBeEnabled();
  await page.unroute('**/api/documents');
  await dialog.getByRole('button', { name: '开始上传' }).click();
  await expect(dialog).toHaveCount(0);
  await trigger.click();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('文献 CSV 导入和重复导入保持幂等', async ({ app: page, context }) => {
  await navigate(page, '文档中心');
  await page.getByRole('button', { name: /文献数据/ }).click();
  const csv = { name: '文献.csv', mimeType: 'text/csv', buffer: Buffer.from('标题,年份,作者,期刊,摘要,关键词\nE2E文献,2025,测试作者,测试期刊,科研诚信数据治理研究,科研诚信;数据治理\n') };
  const input = page.locator('input[type=file]');
  await input.setInputFiles(csv);
  await expect(page.getByRole('row').filter({ hasText: 'E2E文献' })).toHaveCount(1);
  await input.setInputFiles([]);
  await input.setInputFiles(csv);
  await expect(page.locator('.toast').last()).toContainText('已导入');
  const papers = await (await context.request.get('/api/papers')).json();
  expect(papers.papers.filter((paper: { title: string }) => paper.title === 'E2E文献')).toHaveLength(1);
});

test('空文档中心提示可操作，预审及匹配禁用运行', async ({ app: page }) => {
  await page.route('**/api/documents', route => route.fulfill({ json: { documents: [] } }));
  await page.reload();
  await navigate(page, '文档中心');
  await expect(page.getByText('尚无文档', { exact: true })).toBeVisible();
  await navigate(page, '本子预审');
  await expect(page.getByRole('button', { name: '开始预审' })).toBeDisabled();
  await navigate(page, '查重匹配');
  await expect(page.getByRole('button', { name: '运行一体化检查' })).toBeDisabled();
  await navigate(page, '智能问答');
  await page.locator('textarea').fill('测试');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('清理演示数据保留自建文档、文献、专家与公开政策', async ({ app: page, documents, context }) => {
  const papers = await context.request.post('/api/papers/import', { multipart: { file: { name: '自建.csv', mimeType: 'text/csv', buffer: Buffer.from('标题,年份,摘要,关键词\nE2E保留文献,2025,科研诚信,科研诚信\n') } } });
  expect(papers.ok()).toBeTruthy();
  const experts = await context.request.post('/api/experts/import', { multipart: { file: { name: '自建专家.csv', mimeType: 'text/csv', buffer: Buffer.from('姓名,单位,研究方向\nE2E保留专家,测试单位,科研诚信\n') } } });
  expect(experts.ok()).toBeTruthy();
  await page.goto('/library');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '移除演示本子' }).click();
  await expect(page.locator('.document-directory').getByRole('button', { name: /演示本子：/ })).toHaveCount(0);
  await expect(page.locator('.document-directory').getByRole('button', { name: new RegExp(documents[0].name) })).toBeVisible();
  await page.getByRole('button', { name: /文献数据/ }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '移除演示文献' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'E2E保留文献' })).toBeVisible();
  const remaining = await (await context.request.get('/api/papers')).json();
  expect(remaining.papers).toHaveLength(1);
  const docs = await (await context.request.get('/api/documents')).json();
  expect(docs.documents.filter((doc: { source: string }) => doc.source === 'public')).toHaveLength(2);
  await navigate(page, '查重匹配');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('tab', { name: '专家库', exact: true }).click();
  await page.getByRole('button', { name: '移除演示专家' }).click();
  await expect(page.getByRole('row').filter({ hasText: '示例专家A' })).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: 'E2E保留专家' })).toBeVisible();
});

test('工作台选择申报书并在预审、匹配、问答间保持上下文', async ({ app: page, documents }, testInfo) => {
  await page.getByLabel('当前卷宗').selectOption(documents[1].id);
  await page.screenshot({ path: testInfo.outputPath('workspace-desktop.png') });
  await page.locator('.welcome-entries').getByRole('link', { name: /本子预审/ }).click();
  await expect(page.getByLabel('当前卷宗')).toHaveValue(documents[1].id);
  await navigate(page, '查重匹配');
  await expect(page.getByLabel('当前卷宗')).toHaveValue(documents[1].id);
  await page.getByLabel('当前卷宗').selectOption(documents[0].id);
  await navigate(page, '本子预审');
  await expect(page.getByLabel('当前卷宗')).toHaveValue(documents[0].id);
  await page.locator('.brand-home').click();
  await expect(page.getByLabel('当前卷宗')).toHaveValue(documents[0].id);
  await page.locator('.welcome-entries').getByRole('link', { name: /智能问答/ }).click();
  await expect(page.locator('.scope-btn')).toContainText(documents[0].name);
  await navigate(page, '文档中心');
  await page.locator('.document-directory-group').filter({ has: page.getByRole('heading', { name: '政策' }) }).getByRole('button').first().click();
  await page.getByRole('button', { name: '文档问答', exact: true }).click();
  await page.locator('.brand-home').click();
  await expect(page.getByLabel('当前卷宗')).toHaveValue(documents[0].id);
});

test('文档中心名称筛选不改变实际数据', async ({ app: page, documents }) => {
  await navigate(page, '文档中心');
  await page.getByLabel('筛选文档').fill(documents[0].name);
  await expect(page.locator('.document-directory').getByRole('button', { name: new RegExp(documents[0].name) })).toBeVisible();
  await expect(page.locator('.document-directory').getByRole('button', { name: new RegExp(documents[1].name) })).toHaveCount(0);
  await page.getByLabel('筛选文档').fill('无此文档');
  await expect(page.getByText('没有匹配的文档', { exact: true })).toBeVisible();
  await page.getByLabel('筛选文档').clear();
  await expect(page.locator('.document-directory').getByRole('button', { name: new RegExp(documents[1].name) })).toBeVisible();
});

test('访客从工作台进入问答时使用选定申报书', async ({ app: page, documents, context }) => {
  const login = await context.request.post('/api/auth/login', { data: { username: 'viewer', password: 'yanxin2026' } });
  expect(login.ok()).toBeTruthy();
  await page.reload();
  await page.getByLabel('当前卷宗').selectOption(documents[1].id);
  await page.getByRole('link', { name: /用此卷宗提问/ }).click();
  await expect(page.locator('.scope-btn')).toContainText(documents[1].name);
});

test('清空当前卷宗后预审与查重不可运行', async ({ app: page, documents }) => {
  await page.getByLabel('当前卷宗').selectOption(documents[0].id);
  await page.getByLabel('当前卷宗').selectOption('');
  await navigate(page, '本子预审');
  await expect(page.getByLabel('当前卷宗')).toHaveValue('');
  await expect(page.getByRole('button', { name: '开始预审' })).toBeDisabled();
  await navigate(page, '查重匹配');
  await expect(page.getByLabel('当前卷宗')).toHaveValue('');
  await expect(page.getByRole('button', { name: '运行一体化检查' })).toBeDisabled();
});
