import { test, expect, navigate } from './fixtures';

test('@smoke 卷宗建立、材料归卷与人工确认形成体检结果', async ({ app: page, documents, context }, testInfo) => {
  await navigate(page, '本子预审');
  await expect(page.getByRole('heading', { name: '建立第一份课题卷宗' })).toBeVisible();
  await expect(page.getByRole('button', { name: /新建.*卷宗/ })).toHaveCount(1);
  await page.getByRole('button', { name: '新建课题卷宗' }).click();

  const dialog = page.getByRole('dialog', { name: '新建卷宗' });
  await dialog.getByLabel('课题名称').fill('2026 自然资源科研诚信测试卷宗');
  await dialog.getByLabel('课题负责人（可选）').fill('测试负责人');
  await dialog.getByLabel('申报 / 承担单位（可选）').fill('测试自然资源研究院');
  await dialog.getByLabel('申报单位主管部门（建议填写）').fill('测试市自然资源主管部门');
  await dialog.getByRole('button', { name: '保存卷宗' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '2026 自然资源科研诚信测试卷宗' })).toBeVisible();
  await expect(page.getByLabel('当前课题卷宗')).toHaveCount(1);
  await expect(page.getByLabel('切换卷宗')).toHaveCount(0);
  const workspaceSelect = page.getByLabel('当前课题卷宗');
  const dossierId = await workspaceSelect.inputValue();
  await workspaceSelect.selectOption('');
  await expect(page.getByRole('heading', { name: '选择或新建课题卷宗' })).toBeVisible();
  await expect(page.getByRole('button', { name: '新建课题卷宗' })).toBeVisible();
  await workspaceSelect.selectOption(`doc:${documents[1].id}`);
  await expect(page.getByRole('button', { name: '开始预审' })).toBeEnabled();
  await workspaceSelect.selectOption(dossierId);
  await expect(page.getByRole('button', { name: '开始预审' })).toBeDisabled();
  const toggle = page.getByRole('button', { name: '收起详情' });
  await toggle.click();
  await expect(page.locator('#dossier-details')).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('dossier-collapsed.png') });
  await page.getByRole('button', { name: '展开详情' }).click();
  await expect(page.locator('#dossier-details')).toBeVisible();
  await page.locator('.dossier-process summary').click();
  await expect(page.locator('.dossier-process ol li')).toHaveCount(6);
  await expect(page.locator('.dossier-process li.is-current')).toContainText('立项申请');

  await page.getByLabel('选择要归卷的资料').selectOption(documents[0].id);
  await page.getByLabel('材料角色').selectOption('proposal_text');
  await page.getByRole('button', { name: '归入卷宗' }).click();
  await expect(page.locator('.dossier-material-row').filter({ hasText: documents[0].name })).toBeVisible();

  await page.getByLabel('选择要归卷的资料').selectOption(documents[1].id);
  await page.getByLabel('材料角色').selectOption('signed_proposal');
  await page.getByRole('button', { name: '归入卷宗' }).click();
  const scanRow = page.locator('.dossier-material-row').filter({ hasText: documents[1].name });
  await expect(scanRow).toContainText('盖章申请书');
  await expect(scanRow.getByLabel('人工确认')).not.toBeChecked();
  await expect(page.locator('.dossier-check-item').filter({ hasText: '申请书（盖章扫描件）' })).toContainText('不是 PDF');

  await scanRow.getByLabel('人工确认').click();
  await expect(scanRow).toContainText('manager 已确认');
  await expect(page.locator('.dossier-check-item').filter({ hasText: '申请书（盖章扫描件）' })).toContainText('不是 PDF');
  for (const width of [1440, 1920, 2560]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      `${width}px 卷宗工作台不得横向溢出`
    ).toBeTruthy();
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 5_000 });
  await page.screenshot({ path: testInfo.outputPath('dossier-workbench-desktop.png'), fullPage: true });

  await page.getByRole('button', { name: '编辑卷宗' }).click();
  const editDialog = page.getByRole('dialog', { name: '编辑卷宗' });
  page.once('dialog', (dialog) => dialog.accept());
  await editDialog.getByRole('button', { name: '删除卷宗' }).click();
  await expect(editDialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '建立第一份课题卷宗' })).toBeVisible();
  const remaining = await (await context.request.get('/api/documents')).json();
  expect(remaining.documents.map((item: { id: string }) => item.id)).toEqual(
    expect.arrayContaining(documents.map((item) => item.id))
  );
});

test('手机卷宗体检不横向溢出且表单可操作', async ({ app: page, documents }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await navigate(page, '本子预审');
  await page.getByRole('button', { name: '新建课题卷宗' }).click();
  const dialog = page.getByRole('dialog', { name: '新建卷宗' });
  await expect(dialog.locator('..')).toHaveCSS('position', 'fixed');
  await expect(dialog.locator('..')).toHaveCSS('opacity', '1');
  await page.screenshot({ path: testInfo.outputPath('dossier-modal-open.png') });
  const initial = await dialog.evaluate((el) => {
    const header = el.querySelector('.modal-head')!.getBoundingClientRect();
    const label = el.querySelector('.field span')!.getBoundingClientRect();
    return { scrollTop: el.scrollTop, headerBottom: header.bottom, labelTop: label.top };
  });
  expect(initial.scrollTop).toBe(0);
  expect(initial.labelTop).toBeGreaterThanOrEqual(initial.headerBottom);
  await dialog.hover();
  await page.mouse.wheel(0, 500);
  await expect.poll(() => dialog.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await page.mouse.wheel(0, -1000);
  await expect.poll(() => dialog.evaluate((el) => el.scrollTop)).toBe(0);
  await dialog.getByLabel('课题名称').fill('手机端卷宗测试');
  await dialog.getByLabel('申报 / 承担单位（可选）').fill('移动测试单位');
  await dialog.getByRole('button', { name: '保存卷宗' }).click();
  await expect(dialog).toHaveCount(0);

  await page.getByLabel('选择要归卷的资料').selectOption(documents[0].id);
  await page.getByRole('button', { name: '归入卷宗' }).click();
  await expect(page.locator('.dossier-material-row').filter({ hasText: documents[0].name })).toBeVisible();
  await expect(page.locator('.dossier-workbench')).toBeVisible();
  await expect(page.locator('.skip-link')).not.toBeFocused();
  for (const width of [320, 375, 420, 421, 500, 680, 681, 900]) {
    await page.setViewportSize({ width, height: 812 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      `${width}px 卷宗工作台不得横向溢出`
    ).toBeTruthy();
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 5_000 });
  await page.screenshot({ path: testInfo.outputPath('dossier-workbench-mobile.png'), fullPage: true });
});
