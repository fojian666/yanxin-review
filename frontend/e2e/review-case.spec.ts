import { expect, loginUI, navigate, test } from './fixtures';

test('项目评审一条龙、专家独立审核、终审与文档中心归档', async ({ app: page, documents, context }, testInfo) => {
  test.setTimeout(120_000);
  const source = documents[0];
  await navigate(page, '项目评审');
  await expect(page.getByLabel('当前课题')).toHaveCount(0);
  await expect(page.locator('.workspace-ledger')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '建立项目评审案卷' })).toBeVisible();
  await page.getByLabel('关联历史课题（可选）').selectOption('');
  await page.getByLabel('申报书 / 项目材料').selectOption(source.id);
  await page.getByLabel('案卷名称').fill('E2E 全过程评审');
  await page.getByRole('button', { name: '建立并开始' }).click();
  await expect(page.getByRole('tab', { name: '预审' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('当前课题')).toHaveCount(0);
  await expect(page.locator('.workspace-ledger')).toHaveCount(0);
  await expect(page.getByLabel('切换评审案卷')).toBeVisible();

  await page.route('**/api/review-cases/*/run', async route => {
    await new Promise(resolve => setTimeout(resolve, 450));
    await route.continue();
  });
  await page.getByRole('button', { name: '一键预审并匹配专家' }).click();
  await expect(page.locator('.review-process-progress')).toContainText('预审进行中');
  await page.screenshot({ path: testInfo.outputPath('review-case-pre-progress.png') });
  await expect(page.getByRole('button', { name: '重新运行需新建轮次' })).toBeVisible();
  await expect(page.getByRole('tab', { name: '预审' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.review-case-kpis')).toBeVisible();
  await expect(page.getByText('单位比对口径：')).toBeVisible();
  await expect(page.getByText(/查重相似度不等于抄袭/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('review-case-pre-complete.png') });
  await page.unroute('**/api/review-cases/*/run');
  await page.getByRole('tab', { name: '专家审核' }).click();
  const firstCandidate = page.locator('.review-candidate-list label').first();
  await expect(firstCandidate).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  await expect.poll(async () => (await firstCandidate.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  const expertName = await firstCandidate.locator('strong').innerText();
  const expertsResponse = await context.request.get('/api/experts');
  const experts = (await expertsResponse.json()).experts as { id: number; name: string }[];
  const expertId = experts.find(expert => expert.name === expertName)!.id;
  await firstCandidate.click();
  await expect(page.getByRole('button', { name: '绑定专家账号' })).toHaveCount(0);
  await page.getByRole('link', { name: '专家库管理绑定' }).click();
  await expect(page).toHaveURL(/\/experts$/);
  await expect(page.getByRole('heading', { name: '专家库' })).toBeVisible();
  await page.getByText('专家账号绑定管理').click();
  await page.getByLabel('绑定管理评审账号').selectOption('reviewer');
  await page.getByLabel('绑定管理专家').selectOption(String(expertId));
  await page.screenshot({ path: testInfo.outputPath('review-case-binding-mobile.png') });
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '绑定专家账号' }).click();
  await expect(page.getByText('专家账号已绑定')).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goBack();
  await page.getByRole('tab', { name: '专家审核' }).click();
  await page.locator('.review-candidate-list label').first().click();
  await expect(page.getByLabel('选择专家审核账号')).toHaveValue('reviewer');
  await page.getByRole('button', { name: '指派审核' }).click();
  await expect(page.locator('.review-task-row')).toHaveCount(1);
  await expect(page.locator('.review-task-row')).toContainText('待审核');
  await page.screenshot({ path: testInfo.outputPath('review-case-expert-assigned.png') });

  await context.request.post('/api/auth/logout');
  await loginUI(page, 'admin');
  const longCaseTitle = 'E2E 全过程评审：自然资源科研项目评审与数据治理专项研究'.repeat(3);
  await page.route('**/api/review-tasks/*', async route => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    if (body.task) {
      body.task.case_title = longCaseTitle;
      body.task.doc_name = longCaseTitle;
    }
    await route.fulfill({ response, json: body });
  });
  await navigate(page, '专家审核');
  await expect(page.locator('.expert-task-tabs button')).toHaveCount(1);
  await expect(page.locator('.expert-task-summary')).toContainText('管理员调试');
  await expect(page.getByRole('heading', { name: longCaseTitle })).toBeVisible();
  for (const width of [320, 390, 680, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const link = page.getByRole('link', { name: '查看申报书原文' });
    await link.scrollIntoViewIfNeeded();
    await expect(link).toBeVisible();
    expect(await link.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const parent = element.parentElement!.getBoundingClientRect();
      return element.scrollWidth <= element.clientWidth + 1 && rect.left >= parent.left - 1 && rect.right <= parent.right + 1 && rect.height >= 44;
    })).toBeTruthy();
    if (width === 390) await page.screenshot({ path: testInfo.outputPath('expert-long-title-mobile.png') });
  }
  await page.unroute('**/api/review-tasks/*');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByLabel('独立审核意见').fill('项目材料完整，技术路线清晰，建议通过并补充年度监测计划。');
  await page.getByRole('button', { name: '提交审核意见' }).click();
  await expect(page.getByRole('heading', { name: '审核意见已提交' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('expert-review-admin-debug-submitted.png') });

  await context.request.post('/api/auth/logout');
  await loginUI(page, 'reviewer');
  await navigate(page, '专家审核');
  await expect(page.getByRole('heading', { name: 'E2E 全过程评审' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '审核意见已提交' })).toBeVisible();
  await expect(page.getByText('项目材料完整，技术路线清晰，建议通过并补充年度监测计划。')).toBeVisible();
  await expect(page.getByText(/管理员 admin 调试代提交/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('expert-review-submitted.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('expert-review-mobile.png') });

  await context.request.post('/api/auth/logout');
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginUI(page, 'manager');
  await navigate(page, '项目评审');
  await page.getByRole('tab', { name: '专家审核' }).click();
  await page.getByRole('button', { name: '刷新专家任务' }).click();
  await expect(page.locator('.review-task-row')).toContainText('已提交');
  await expect(page.getByText(/管理员 admin 调试代提交/)).toBeVisible();
  await page.getByRole('button', { name: '进入终审' }).click();
  await expect(page.getByRole('tab', { name: '终审' })).toHaveAttribute('aria-selected', 'true');
  await page.getByLabel('退回修改').check();
  await page.getByPlaceholder('填写终审理由、修改要求或通过条件（至少 10 字）').fill('专家意见已核对，同意通过并按要求补充年度监测计划。');
  await page.route('**/api/review-cases/*/final', async route => {
    await new Promise(resolve => setTimeout(resolve, 450));
    await route.continue();
  });
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '签署并归档' }).click();
  await expect(page.locator('.review-process-progress')).toContainText('终审签署中');
  await page.screenshot({ path: testInfo.outputPath('review-case-final-progress.png') });
  await expect(page.getByText('终审决定', { exact: true })).toBeVisible();
  await expect(page.locator('.review-stage-heading .status-pass')).toContainText('退回修改');
  await expect(page.getByText(/管理员 admin 调试代提交/)).toBeVisible();
  await expect(page.getByText(/归档哈希|^SHA /)).toHaveCount(0);
  const passAlignment = await page.locator('.review-stage-heading .status-pass').evaluate(element => {
    const icon = element.querySelector('svg')!.getBoundingClientRect();
    const label = element.querySelector('span')!.getBoundingClientRect();
    return Math.abs((icon.top + icon.height / 2) - (label.top + label.height / 2));
  });
  expect(passAlignment).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath('review-case-finalized.png') });
  await page.getByLabel('补正材料').selectOption(documents[1].id);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '创建补正重审' }).click();
  await expect(page.getByLabel('切换评审案卷').locator('option:checked')).toContainText('第 2 轮');
  await expect(page.getByRole('button', { name: '一键预审并匹配专家' })).toBeEnabled();
  await page.getByRole('button', { name: '一键预审并匹配专家' }).click();
  await expect(page.getByRole('button', { name: '重新运行需新建轮次' })).toBeVisible();

  await page.route('**/api/review-artifacts', async route => {
    const response = await route.fetch();
    const body = await response.json();
    const pre = body.artifacts.find((item: { artifact_type: string }) => item.artifact_type === 'pre_review');
    pre.content = '# 历史预审报告\n\n原始归档正文';
    pre.payload.limitations = ['历史能力边界测试'];
    pre.payload.sections = [{ items: [{ label: '历史证据', evidence_full: '历史完整证据测试', source_doc_id: source.id }] }];
    await route.fulfill({ response, json: body });
  });
  await navigate(page, '文档中心');
  const caseDataButton = page.getByRole('button', { name: /案卷数据/ });
  await expect(caseDataButton).toContainText('7');
  await expect(caseDataButton).toHaveAttribute('aria-pressed', 'false');
  await caseDataButton.click();
  await expect(page.locator('.document-case-group')).toHaveCount(1);
  await expect(page.locator('.document-case-group > summary')).toContainText('E2E 全过程评审');
  await expect(page.locator('.document-case-artifact-list button')).toHaveCount(7);
  await page.locator('.document-case-artifact-list button').filter({ hasText: '预审报告' }).first().click();
  await expect(page.locator('.document-case-artifact-reader')).toContainText('原始归档正文');
  await expect(page.locator('.document-case-artifact-reader')).toContainText('历史能力边界测试');
  await expect(page.locator('.document-case-artifact-reader')).toContainText('历史完整证据测试');
  await expect(page.getByRole('link', { name: '查看证据原文' })).toHaveAttribute('href', `/library?doc=${source.id}`);
  await page.screenshot({ path: testInfo.outputPath('library-legacy-evidence.png') });
  await page.locator('.document-case-artifact-list button').filter({ hasText: '终审决定' }).click();
  await expect(page.locator('.document-case-artifact-reader')).toContainText('终审意见');
  await expect(page.locator('.document-case-artifact-reader')).toContainText('同意通过');
  await expect(page.getByText(/归档哈希|^SHA /)).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('library-case-artifacts.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
  await expect(page.getByRole('button', { name: /案卷数据/ })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('library-case-artifacts-mobile.png') });
});

test('预审返回时保留用户当前选择的案卷', async ({ app: page, documents, context }) => {
  const created = [];
  for (const title of ['延迟预审案卷', '当前查看案卷']) {
    const response = await context.request.post('/api/review-cases', { data: { title, doc_id: documents[0].id, dossier_id: '' } });
    expect(response.ok()).toBeTruthy();
    created.push((await response.json()).case);
  }
  await navigate(page, '项目评审');
  await page.getByLabel('切换评审案卷').selectOption(created[0].id);
  await expect(page.locator('.review-case-bar')).toContainText('延迟预审案卷');
  let release!: () => void;
  let started!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const requestStarted = new Promise<void>(resolve => { started = resolve; });
  await page.route(`**/api/review-cases/${created[0].id}/run`, async route => {
    const response = await route.fetch();
    started();
    await blocked;
    await route.fulfill({ response });
  });
  await page.getByRole('button', { name: '一键预审并匹配专家' }).click();
  await requestStarted;
  await page.getByLabel('切换评审案卷').selectOption(created[1].id);
  await expect(page.locator('.review-case-bar')).toContainText('当前查看案卷');
  release();
  await expect(page.getByText('预审、查重和专家匹配已完成并归档')).toBeVisible();
  await expect(page.getByLabel('切换评审案卷')).toHaveValue(created[1].id);
});

test('历史评审案卷缺失查重明细时仍可打开且不虚报为零', async ({ app: page, documents, context }, testInfo) => {
  const created = await context.request.post('/api/review-cases', { data: { title: '旧版案卷', doc_id: documents[0].id, dossier_id: '' } });
  expect(created.ok()).toBeTruthy();
  const caseId = (await created.json()).case.id;
  const result = await context.request.post(`/api/review-cases/${caseId}/run`, { data: {} });
  expect(result.ok()).toBeTruthy();
  await page.route(`**/api/review-cases/${caseId}`, async route => {
    const response = await route.fetch();
    const body = await response.json();
    for (const artifact of body.case.artifacts) {
      if (artifact.artifact_type === 'pre_review') {
        artifact.payload = { doc: { name: '旧材料' }, overall: { risk_level: '高', checked_items: 3, summary: '历史摘要' }, sections: [], disclaimer: '仅供人工复核' };
      }
      if (artifact.artifact_type === 'tool_check') {
        const candidate = artifact.payload.match.candidates[0];
        artifact.payload = { doc: { name: '旧材料' }, duplicate: {}, match: { candidates: candidate ? [{ expert: candidate.expert }] : [] }, disclaimer: '仅供人工复核' };
      }
    }
    await route.fulfill({ response, json: body });
  });
  await navigate(page, '项目评审');
  await page.getByRole('tab', { name: '预审', exact: true }).click();
  await expect(page.locator('.review-case-kpis')).toContainText('历史归档未记录查重明细');
  await expect(page.locator('.review-case-kpis')).toContainText('未记录');
  await expect(page.locator('.review-case-workspace')).not.toContainText('undefined');
  await expect(page.locator('.review-case-workspace')).not.toContainText('NaN');
  await page.getByRole('tab', { name: '专家审核', exact: true }).click();
  await expect(page.locator('.review-candidate-pool')).not.toContainText('NaN');
  const candidate = page.locator('.review-candidate-list label');
  await expect(candidate).toHaveCount(1);
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await expect(candidate).toBeVisible();
    const size = await candidate.boundingBox();
    expect(size!.height).toBeLessThanOrEqual(100);
    expect(await candidate.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const pool = element.closest('.review-candidate-pool')!.getBoundingClientRect();
      return rect.height >= 44 && rect.top >= pool.top && rect.bottom <= pool.bottom;
    })).toBeTruthy();
    const assignment = page.getByLabel('选择专家审核账号');
    await assignment.scrollIntoViewIfNeeded();
    await expect(assignment).toBeVisible();
    if (viewport.width === 1280) await page.screenshot({ path: testInfo.outputPath('single-candidate.png') });
  }
});
