import { readFile } from 'node:fs/promises';
import { expect, loginUI, navigate, password, test } from './fixtures';

test('材料归属、匿名查重、受限导出与显式阅读授权', async ({ app: page, documents, context }, testInfo) => {
  test.setTimeout(90_000);
  const [own, other] = documents;
  for (const [document, owner] of [[own, 'viewer'], [other, 'manager']] as const) {
    expect((await context.request.put(`/api/documents/${document.id}/access`, { data: {
      owner_username: owner, visibility: 'restricted', readers: [],
    } })).ok()).toBeTruthy();
  }

  await page.goto(`/library?doc=${own.id}`);
  await page.getByRole('button', { name: '阅读权限', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '材料阅读权限' });
  await expect(dialog.getByLabel('材料归属账号')).toHaveValue('viewer');
  await expect(dialog.getByLabel('阅读范围')).toHaveValue('restricted');
  const assertDialogLayout = async () => {
    const bounds = await dialog.boundingBox();
    const title = await dialog.getByRole('heading', { name: '材料阅读权限' }).boundingBox();
    const filename = await dialog.locator('.document-access-body > strong').boundingBox();
    expect(bounds && title && filename).toBeTruthy();
    expect(title!.x).toBeGreaterThan(bounds!.x);
    expect(title!.y).toBeGreaterThan(bounds!.y);
    expect(filename!.y).toBeGreaterThan(title!.y + title!.height);
    await expect(dialog.getByRole('button', { name: '保存阅读权限' })).toBeInViewport();
  };
  await assertDialogLayout();
  await dialog.getByRole('checkbox', { name: /reviewer/ }).check();
  await page.screenshot({ path: testInfo.outputPath('document-access-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.getByRole('button', { name: '保存阅读权限' }).scrollIntoViewIfNeeded();
  await expect(dialog).toBeInViewport();
  expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(390);
  await assertDialogLayout();
  await page.screenshot({ path: testInfo.outputPath('document-access-mobile.png') });
  await dialog.getByRole('button', { name: '保存阅读权限' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('阅读权限已保存并留痕')).toBeVisible();

  await context.request.post('/api/auth/logout');
  await loginUI(page, 'viewer');
  const docs = (await (await context.request.get('/api/documents')).json()).documents;
  expect(docs.some((doc: { id: string }) => doc.id === own.id)).toBeTruthy();
  expect(docs.some((doc: { id: string }) => doc.id === other.id)).toBeFalsy();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/review?doc=${own.id}`);
  await expect(page.getByRole('tab', { name: '运行预审' })).toBeVisible();
  const reviewResponse = page.waitForResponse(response => response.url().endsWith('/api/review') && response.request().method() === 'POST');
  await page.getByRole('button', { name: '开始预审' }).click();
  const payload = await (await reviewResponse).json();
  expect(JSON.stringify(payload)).not.toContain(other.id);
  expect(JSON.stringify(payload)).not.toContain(other.name);
  await expect(page.locator('.report-head')).toContainText(own.name);
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出完整报告' }).click();
  const download = await downloadEvent;
  const exported = await readFile((await download.path())!, 'utf8');
  expect(exported).toContain('对方原文受保护');
  expect(exported).not.toContain(other.name);
  expect(exported).not.toContain(other.id);
  await page.getByRole('tab', { name: '查重与追问' }).click();
  await expect(page.locator('.review-finding-page')).toContainText('原文受保护');
  await expect(page.locator(`a[href*="${other.id}"]`)).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('owner-restricted-review.png') });
  expect((await context.request.get(`/api/documents/${other.id}/content`)).status()).toBe(403);
  expect((await context.request.put(`/api/documents/${own.id}/access`, { data: { visibility: 'public' } })).status()).toBe(403);

  await context.request.post('/api/auth/logout');
  await loginUI(page, 'reviewer');
  await page.goto(`/match?doc=${other.id}`);
  await expect(page.getByRole('alert')).toContainText('未找到该申报材料或无权读取');
  await expect(page.getByRole('button', { name: '运行一体化检查' })).toBeDisabled();
  await page.goto(`/match?doc=${own.id}`);
  await expect(page.getByRole('alert')).toHaveCount(0);
  const checkResponse = page.waitForResponse(response => response.url().endsWith('/api/tool/check') && response.request().postDataJSON().doc_id === own.id);
  await page.getByRole('button', { name: '运行一体化检查' }).click();
  expect((await checkResponse).ok()).toBeTruthy();
  await expect(page.getByRole('button', { name: '运行一体化检查' })).toBeEnabled();
  await page.getByRole('tab', { name: '查重结果' }).click();
  await expect(page.locator('.match-duplicate-list')).toContainText('原文受保护');
  await expect(page.locator(`a[href*="${other.id}"]`)).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('reviewer-restricted-match.png') });

  // 额外授权后才可读取对方原文，接口和页面采用同一判断。
  expect((await context.request.post('/api/auth/login', { data: { username: 'manager', password } })).ok()).toBeTruthy();
  expect((await context.request.put(`/api/documents/${other.id}/access`, { data: {
    owner_username: 'manager', visibility: 'restricted', readers: ['reviewer'],
  } })).ok()).toBeTruthy();
  await context.request.post('/api/auth/logout');
  await loginUI(page, 'reviewer');
  await page.goto(`/match?doc=${own.id}`);
  const authorizedResponse = page.waitForResponse(response => response.url().endsWith('/api/tool/check') && response.request().postDataJSON().doc_id === own.id);
  await page.getByRole('button', { name: '运行一体化检查' }).click();
  expect((await authorizedResponse).ok()).toBeTruthy();
  await expect(page.getByRole('button', { name: '运行一体化检查' })).toBeEnabled();
  await page.getByRole('tab', { name: '查重结果' }).click();
  const authorizedLink = page.getByRole('link', { name: `打开《${other.name}》原文` });
  await expect(authorizedLink).toBeVisible();
  await authorizedLink.click();
  await expect(page.locator('.document-reader-head h2')).toHaveText(other.name);
  await expect(page.getByRole('button', { name: '阅读权限', exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('authorized-reference-reader.png') });
  await navigate(page, '智能问答');
});
