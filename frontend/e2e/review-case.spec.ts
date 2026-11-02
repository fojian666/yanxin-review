import { expect, loginUI, navigate, test } from './fixtures';

test('项目评审一条龙、专家独立审核、终审与文档中心归档', async ({ app: page, documents, context }, testInfo) => {
  test.setTimeout(120_000);
  const source = documents[0];
  await navigate(page, '项目评审');
  await expect(page.getByRole('heading', { name: '建立项目评审案卷' })).toBeVisible();
  await page.getByLabel('关联历史课题（可选）').selectOption('');
  await page.getByLabel('申报书 / 项目材料').selectOption(source.id);
  await page.getByLabel('案卷名称').fill('E2E 全过程评审');
  await page.getByRole('button', { name: '建立并开始' }).click();
  await expect(page.getByRole('tab', { name: '预审' })).toHaveAttribute('aria-selected', 'true');

  await page.route('**/api/review-cases/*/run', async route => {
    await new Promise(resolve => setTimeout(resolve, 450));
    await route.continue();
  });
  await page.getByRole('button', { name: '一键预审并匹配专家' }).click();
  await expect(page.locator('.review-process-progress')).toContainText('预审进行中');
  await page.screenshot({ path: testInfo.outputPath('review-case-pre-progress.png') });
  await expect(page.getByRole('tab', { name: '专家审核' })).toHaveAttribute('aria-selected', 'true');
  await page.unroute('**/api/review-cases/*/run');
  await page.getByRole('tab', { name: '专家审核' }).click();
  const firstCandidate = page.locator('.review-candidate-list label').first();
  await expect(firstCandidate).toBeVisible();
  await firstCandidate.click();
  await page.getByLabel('选择专家审核账号').selectOption('reviewer');
  await page.getByRole('button', { name: '指派审核' }).click();
  await expect(page.locator('.review-task-row')).toHaveCount(1);
  await expect(page.locator('.review-task-row')).toContainText('待审核');
  await page.screenshot({ path: testInfo.outputPath('review-case-expert-assigned.png') });

  await context.request.post('/api/auth/logout');
  await loginUI(page, 'reviewer');
  await navigate(page, '专家审核');
  await expect(page.locator('.expert-task-tabs button')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'E2E 全过程评审' })).toBeVisible();
  await page.getByLabel('独立审核意见').fill('项目材料完整，技术路线清晰，建议通过并补充年度监测计划。');
  await page.getByRole('button', { name: '提交审核意见' }).click();
  await expect(page.getByRole('heading', { name: '审核意见已提交' })).toBeVisible();
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
  await page.getByRole('button', { name: '进入终审' }).click();
  await expect(page.getByRole('tab', { name: '终审' })).toHaveAttribute('aria-selected', 'true');
  await page.getByPlaceholder('填写终审理由、修改要求或通过条件（至少 10 字）').fill('专家意见已核对，同意通过并按要求补充年度监测计划。');
  await page.route('**/api/review-cases/*/final', async route => {
    await new Promise(resolve => setTimeout(resolve, 450));
    await route.continue();
  });
  await page.getByRole('button', { name: '签署并归档' }).click();
  await expect(page.locator('.review-process-progress')).toContainText('终审签署中');
  await page.screenshot({ path: testInfo.outputPath('review-case-final-progress.png') });
  await expect(page.getByText('终审决定', { exact: true })).toBeVisible();
  await expect(page.getByText('通过', { exact: true }).last()).toBeVisible();
  await expect(page.getByText(/归档哈希|^SHA /)).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('review-case-finalized.png') });

  await navigate(page, '文档中心');
  await page.getByRole('button', { name: /案卷数据/ }).click();
  await expect(page.locator('.document-case-group')).toHaveCount(1);
  await expect(page.locator('.document-case-group > summary')).toContainText('E2E 全过程评审');
  await expect(page.locator('.document-case-artifact-list button')).toHaveCount(5);
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
