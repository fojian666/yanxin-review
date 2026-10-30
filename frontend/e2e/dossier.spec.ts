import type { Page } from '@playwright/test';
import { test, expect, navigate } from './fixtures';

async function expectDossierFitsViewport(page: Page) {
  // 视口切换后等待两帧，让媒体查询和 100dvh 固定布局完成重排。
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  const dimensions = await page.evaluate(() => {
    const body = document.querySelector<HTMLElement>('.dossier-page-body');
    const active = document.querySelector<HTMLElement>('.dossier-page-panel:not([hidden])');
    return {
      viewportHeight: innerHeight,
      documentHeight: document.documentElement.scrollHeight,
      bodyClientHeight: body?.clientHeight ?? 0,
      bodyScrollHeight: body?.scrollHeight ?? 0,
      panelClientHeight: active?.clientHeight ?? 0,
      panelScrollHeight: active?.scrollHeight ?? 0,
    };
  });
  expect(dimensions.documentHeight, '卷宗页整页应锁定在一屏').toBeLessThanOrEqual(dimensions.viewportHeight + 1);
  expect(dimensions.bodyScrollHeight, '卷宗工作面不应产生纵向滚动').toBeLessThanOrEqual(dimensions.bodyClientHeight + 1);
  expect(dimensions.panelScrollHeight, '当前步骤内容不应撑开固定工作面').toBeLessThanOrEqual(dimensions.panelClientHeight + 1);
}

test('@smoke 卷宗建立、材料归卷与人工确认形成体检结果', async ({ app: page, documents, context }, testInfo) => {
  // 概况仅在工作台展示，切入任务后仍验证其共享状态同步。
  const stats = page.locator('.workspace-register');
  const docCounter = stats.locator('div').filter({ hasText: '在册文档' }).locator('strong');
  await expect(docCounter).toHaveText(/^\d+$/);
  const docCount = await docCounter.innerText();
  await expect(stats.locator('div').filter({ hasText: '课题卷宗' }).locator('strong')).toHaveText('0');
  await navigate(page, '课题卷宗');
  await expect(page.getByRole('heading', { name: '建立第一份课题卷宗' })).toBeVisible();
  await expect(page.getByRole('button', { name: /新建.*卷宗/ })).toHaveCount(1);
  await page.getByRole('button', { name: '新建课题卷宗' }).click();

  const dialog = page.getByRole('dialog', { name: '新建卷宗' });
  await dialog.getByLabel('课题名称').fill('2026 自然资源科研诚信测试卷宗');
  await dialog.getByRole('button', { name: '下一步' }).click();
  await dialog.getByLabel('课题负责人（可选）').fill('测试负责人');
  await dialog.getByLabel('申报 / 承担单位（可选）').fill('测试自然资源研究院');
  await dialog.getByLabel('申报单位主管部门（建议填写）').fill('测试市自然资源主管部门');
  await dialog.getByRole('button', { name: '保存卷宗' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '2026 自然资源科研诚信测试卷宗' })).toBeVisible();
  await page.getByRole('button', { name: '新建课题卷宗' }).click();
  await expect(page.getByRole('dialog', { name: '新建卷宗' })).toBeVisible();
  await page.getByRole('dialog', { name: '新建卷宗' }).getByRole('button', { name: '关闭' }).click();
  await expect(stats.locator('div').filter({ hasText: '课题卷宗' }).locator('strong')).toHaveText('1');
  await expect(stats.locator('div').filter({ hasText: '在册文档' }).locator('strong')).toHaveText(docCount);
  await expect(page.getByLabel('当前课题卷宗')).toHaveCount(1);
  await expect(page.getByLabel('切换卷宗')).toHaveCount(0);
  const workspaceSelect = page.getByLabel('当前课题卷宗');
  const dossierId = await workspaceSelect.inputValue();
  await workspaceSelect.selectOption('');
  await expect(page.getByRole('heading', { name: '选择或新建课题卷宗' })).toBeVisible();
  await expect(page.getByRole('button', { name: '新建课题卷宗' })).toBeVisible();
  await workspaceSelect.selectOption(`doc:${documents[1].id}`);
  await navigate(page, '本子预审');
  await expect(page.locator('.dossier-workbench')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '开始预审' })).toBeEnabled();
  await workspaceSelect.selectOption(dossierId);
  await expect(page.getByRole('button', { name: '开始预审' })).toBeDisabled();
  await navigate(page, '课题卷宗');
  await expect(page.getByLabel('当前课题卷宗')).toHaveValue(dossierId);
  await expect(page.getByRole('button', { name: '开始预审' })).toHaveCount(0);
  const toggle = page.locator('button[aria-controls="dossier-details"]');
  const expandedHeight = await page.locator('.dossier-workbench').evaluate((element) => element.getBoundingClientRect().height);
  await toggle.click();
  await expect(page.locator('#dossier-details')).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  const collapsed = await page.evaluate(() => {
    const workbench = document.querySelector<HTMLElement>('.dossier-workbench');
    const head = document.querySelector<HTMLElement>('.dossier-workbench-head');
    const details = document.querySelector<HTMLElement>('#dossier-details');
    return {
      height: workbench?.getBoundingClientRect().height ?? 0,
      headHeight: head?.getBoundingClientRect().height ?? 0,
      detailsHeight: details?.getBoundingClientRect().height ?? 0,
    };
  });
  expect(collapsed.height, '收起后卷宗容器应缩回头部高度').toBeLessThanOrEqual(collapsed.headHeight + 2);
  expect(collapsed.detailsHeight, '收起后详情区不应保留高度').toBe(0);
  expect(collapsed.height).toBeLessThan(expandedHeight / 2);
  await page.screenshot({ path: testInfo.outputPath('dossier-collapsed.png') });
  await page.getByRole('button', { name: '展开详情' }).click();
  await expect(page.locator('#dossier-details')).toBeVisible();
  await page.getByRole('tab', { name: '课题流程', exact: true }).click();
  await expect(page.locator('.dossier-process ol li')).toHaveCount(1);
  await page.getByRole('group', { name: '流程分页' }).getByRole('button', { name: '下一项' }).click();
  await expect(page.locator('.dossier-process li.is-current')).toContainText('立项申请');

  await page.getByRole('tab', { name: '归入资料', exact: true }).click();
  await page.getByLabel('选择要归卷的资料').selectOption(documents[0].id);
  await page.getByLabel('材料角色').selectOption('proposal_text');
  await page.getByRole('button', { name: '归入卷宗' }).click();
  await page.getByRole('tab', { name: '卷宗材料', exact: true }).click();
  await expect(page.locator('.dossier-material-row').filter({ hasText: documents[0].name })).toBeVisible();

  await page.getByRole('tab', { name: '归入资料', exact: true }).click();
  await page.getByLabel('选择要归卷的资料').selectOption(documents[1].id);
  await page.getByLabel('材料角色').selectOption('signed_proposal');
  await page.getByRole('button', { name: '归入卷宗' }).click();
  await page.getByRole('tab', { name: '卷宗材料', exact: true }).click();
  await page.getByRole('group', { name: '材料分页' }).getByRole('button', { name: '下一项' }).click();
  const scanRow = page.locator('.dossier-material-row').filter({ hasText: documents[1].name });
  await expect(scanRow).toContainText('盖章申请书');
  const verifyButton = scanRow.getByRole('button', { name: /确认.*人工核验/ });
  await expect(verifyButton).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('tab', { name: '材料体检', exact: true }).click();
  const checklistPayload = await (await context.request.get(`/api/dossiers/${dossierId}/checklist`)).json();
  const checkpoint = checklistPayload.sections
    .flatMap((section: { items: Array<{ label: string }> }) => section.items)
    .findIndex((item: { label: string }) => item.label === '申请书（盖章扫描件）');
  expect(checkpoint).toBeGreaterThanOrEqual(0);
  const checkPager = page.getByRole('group', { name: '体检项目分页' });
  for (let index = 0; index < checkpoint; index += 1) {
    await checkPager.getByRole('button', { name: '下一项' }).click();
    await expect(checkPager).toContainText(`${index + 2} / ${checklistPayload.overall.checked_items}`);
  }
  await expect(page.locator('.dossier-check-item').filter({ hasText: '申请书（盖章扫描件）' })).toContainText('不是 PDF');

  await page.getByRole('tab', { name: '卷宗材料', exact: true }).click();
  page.once('dialog', dialog => dialog.dismiss());
  await verifyButton.click();
  await expect(verifyButton).toHaveAttribute('aria-pressed', 'false');
  page.once('dialog', dialog => dialog.accept());
  await verifyButton.click();
  await expect(scanRow.getByRole('button', { name: /撤销.*人工核验/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(scanRow).toContainText('manager 已确认');
  await page.getByRole('tab', { name: '材料体检', exact: true }).click();
  await expect(page.locator('.dossier-check-item').filter({ hasText: '申请书（盖章扫描件）' })).toContainText('不是 PDF');
  for (const { width, height } of [
    { width: 1440, height: 900 },
    { width: 1920, height: 1000 },
    { width: 2560, height: 1440 },
    { width: 720, height: 450 },
  ]) {
    await page.setViewportSize({ width, height });
    if (width === 1440) {
      const centered = await page.locator('.dossier-deck .work-deck-rail nav button').evaluateAll(buttons => buttons.every(button => {
        const number = button.querySelector<HTMLElement>('.work-deck-number');
        const copy = button.querySelector<HTMLElement>('.work-deck-copy');
        if (!number || !copy || number.getClientRects().length === 0) return true;
        const numberRect = number.getBoundingClientRect();
        const copyRect = copy.getBoundingClientRect();
        return Math.abs((numberRect.top + numberRect.height / 2) - (copyRect.top + copyRect.height / 2)) <= 1;
      }));
      expect(centered, '卷宗步骤号码与文字必须垂直居中').toBeTruthy();
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      `${width}px 卷宗工作台不得横向溢出`
    ).toBeTruthy();
    for (const label of ['卷宗概况', '卷宗材料', '归入资料', '历史版本', '材料体检', '课题流程', '检查边界']) {
      await page.getByRole('tab', { name: label, exact: true }).click();
      await expect(page.locator('.dossier-deck .work-deck-head h3')).toHaveText(label);
      await expectDossierFitsViewport(page);
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('tab', { name: '卷宗概况', exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 5_000 });
  await page.screenshot({ path: testInfo.outputPath('dossier-workbench-desktop.png'), fullPage: true });

  await page.getByRole('button', { name: '编辑卷宗' }).click();
  const editDialog = page.getByRole('dialog', { name: '编辑卷宗' });
  page.once('dialog', (dialog) => dialog.accept());
  await editDialog.getByRole('button', { name: '删除卷宗' }).click();
  await expect(editDialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '建立第一份课题卷宗' })).toBeVisible();
  await expect(stats.locator('div').filter({ hasText: '课题卷宗' }).locator('strong')).toHaveText('0');
  await expect(stats.locator('div').filter({ hasText: '在册文档' }).locator('strong')).toHaveText(docCount);
  const remaining = await (await context.request.get('/api/documents')).json();
  expect(remaining.documents.map((item: { id: string }) => item.id)).toEqual(
    expect.arrayContaining(documents.map((item) => item.id))
  );
});

test('手机卷宗体检不横向溢出且表单可操作', async ({ app: page, documents }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await navigate(page, '课题卷宗');
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
  expect(await dialog.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBeTruthy();
  await page.setViewportSize({ width: 720, height: 450 });
  expect(await dialog.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBeTruthy();
  await dialog.getByLabel('课题名称').fill('手机端卷宗测试');
  await dialog.getByRole('button', { name: '下一步' }).click();
  expect(await dialog.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBeTruthy();
  await page.setViewportSize({ width: 375, height: 812 });
  await dialog.getByLabel('申报 / 承担单位（可选）').fill('移动测试单位');
  await dialog.getByRole('button', { name: '保存卷宗' }).click();
  await expect(dialog).toHaveCount(0);

  await page.getByRole('tab', { name: '归入资料', exact: true }).click();
  await page.getByLabel('选择要归卷的资料').selectOption(documents[0].id);
  await page.getByRole('button', { name: '归入卷宗' }).click();
  await page.getByRole('tab', { name: '卷宗材料', exact: true }).click();
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
  for (const label of ['卷宗概况', '卷宗材料', '归入资料', '历史版本', '材料体检', '课题流程', '检查边界']) {
    await page.getByRole('tab', { name: label, exact: true }).click();
    await expect(page.locator('.dossier-deck .work-deck-head h3')).toHaveText(label);
    await expectDossierFitsViewport(page);
  }
  await page.getByRole('tab', { name: '卷宗材料', exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 5_000 });
  await page.screenshot({ path: testInfo.outputPath('dossier-workbench-mobile.png'), fullPage: true });
});
