import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

test.use({ trace: 'off' });

async function expectOnePage(page: Page, label: string) {
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const metrics = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    bodyWidth: document.body.scrollWidth,
    bodyHeight: document.body.scrollHeight,
  }));
  expect(metrics.scrollWidth, `${label} 横向溢出`).toBeLessThanOrEqual(metrics.width + 1);
  expect(metrics.scrollHeight, `${label} 页面纵向溢出`).toBeLessThanOrEqual(metrics.height + 1);
  const clippedButtons = await page.locator('button:visible').evaluateAll(buttons => buttons.flatMap(rawButton => {
    const button = rawButton as HTMLElement;
    const label = (button.innerText || button.getAttribute('aria-label') || button.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
    if (!label) return [];
    const elements = [button, ...button.querySelectorAll<HTMLElement>('span,strong,small')]
      .filter(element => !element.classList.contains('sr-only') && element.getClientRects().length > 0);
    return elements
      .filter(element => element.scrollWidth > element.clientWidth + 2 || element.scrollHeight > element.clientHeight + 2)
      .map(element => ({
        text: label,
        element: element.tagName.toLowerCase(),
        className: element.className,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      }));
  }));
  expect(clippedButtons, `${label} 按钮文字被裁切`).toEqual([]);
}

test('@smoke 紧凑窗口下全部按钮结果保持一屏且文字完整', async ({ app: page, documents, context }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 720, height: 450 });
  const dossierResponse = await context.request.post('/api/dossiers', {
    data: { name: '紧凑窗口全按钮审查课题', plan_type: 'directive', phase: 'application' },
  });
  const dossier = (await dossierResponse.json()).dossier;
  await context.request.post(`/api/dossiers/${dossier.id}/documents`, {
    data: { doc_id: documents[0].id, role: 'proposal_text' },
  });

  await page.goto('/welcome');
  await page.locator('.topbar-actions').getByRole('button', { name: '上传文档', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '上传文档' })).toBeVisible();
  await expectOnePage(page, '上传弹窗');
  await page.getByRole('dialog', { name: '上传文档' }).getByRole('button', { name: '关闭' }).click();
  await page.locator('.user-trigger').click();
  await expect(page.getByRole('menu')).toBeVisible();
  await expectOnePage(page, '用户菜单');
  await page.keyboard.press('Escape');

  await page.goto('/dossiers');
  await expect(page.locator('.dossier-workbench')).toBeVisible();
  await page.getByRole('button', { name: '编辑历史课题' }).click();
  await expect(page.getByRole('dialog', { name: '编辑历史课题' })).toBeVisible();
  await expectOnePage(page, '编辑历史课题弹窗');
  await page.getByRole('dialog', { name: '编辑历史课题' }).getByRole('button', { name: '关闭' }).click();
  await page.getByRole('button', { name: '收起详情' }).click();
  await expect(page.locator('#dossier-details')).toBeHidden();
  await expectOnePage(page, '卷宗收起');
  await page.getByRole('button', { name: '展开详情' }).click();
  for (const label of ['课题概况', '课题材料', '归入资料', '历史版本', '材料体检', '课题流程', '检查边界']) {
    await page.getByRole('tab', { name: label, exact: true }).click();
    await expect(page.locator('.dossier-deck .work-deck-head h3')).toHaveText(label);
    await expectOnePage(page, `卷宗/${label}`);
  }
  expect(await page.locator('.dossier-deck .work-deck-rail [role="tab"]').evaluateAll(tabs =>
    tabs.every(tab => tab.getBoundingClientRect().height >= 44)
  ), '横屏紧凑模式章节触控目标不得低于 44px').toBeTruthy();

  await page.goto(`/review?doc=${documents[0].id}`);
  await expect(page.getByRole('button', { name: '开始预审' })).toBeVisible();
  await page.getByRole('button', { name: '开始预审' }).click();
  await expect(page.locator('.report-head')).toContainText(documents[0].name);
  for (const label of ['结论概览', '检查项', '查重与追问', '边界与导出']) {
    await page.getByRole('tab', { name: label, exact: true }).click();
    await expect(page.locator('.review-deck .work-deck-head h3')).toHaveText(label);
    await expectOnePage(page, `预审/${label}`);
    if (label === '边界与导出') {
      const boundary = page.locator('.review-boundaries-page');
      await expect(boundary.locator('.review-boundary-copy')).toContainText('使用边界');
      await expect(boundary.locator('.review-export-panel')).toContainText('报告输出');
      await expect(boundary).toHaveCSS('overflow-y', 'auto');
      await boundary.evaluate(element => { element.scrollTop = element.scrollHeight; });
      await expect.poll(() => boundary.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
      await expect(boundary.getByRole('button', { name: '打印 / 存为 PDF', exact: true })).toBeVisible();
    }
  }
  expect(await page.locator('.review-deck .work-deck-rail [role="tab"]').evaluateAll(tabs =>
    tabs.every(tab => tab.getBoundingClientRect().height >= 44)
  ), '预审章节触控目标不得低于 44px').toBeTruthy();

  await page.goto(`/match?doc=${documents[0].id}`);
  await expect(page.getByRole('button', { name: '运行一体化检查' })).toBeVisible();
  await page.getByRole('button', { name: '运行一体化检查' }).click();
  await expect(page.getByRole('button', { name: '导出结果' })).toBeEnabled();
  for (const label of ['查重结果', '专家候选', '回避边界', '专家库']) {
    await page.getByRole('tab', { name: label, exact: true }).click();
    await expect(page.locator('.match-deck .work-deck-head h3')).toHaveText(label);
    await expectOnePage(page, `匹配/${label}`);
  }

  await page.goto('/trend');
  await page.getByRole('button', { name: '分析趋势' }).click();
  for (const label of ['趋势图表', '研判摘要', '代表文献']) {
    await page.getByRole('tab', { name: label, exact: true }).click();
    await expect(page.locator('.trend-deck .work-deck-head h3')).toHaveText(label);
    await expectOnePage(page, `趋势/${label}`);
  }
  await page.getByRole('tab', { name: '趋势图表', exact: true }).click();
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await expectOnePage(page, '趋势/2D');
  await page.getByRole('tab', { name: '分析设置', exact: true }).click();
  const topicButtons = page.locator('.trend-controls-page .chips button');
  for (let index = 0; index < await topicButtons.count(); index += 1) {
    const topic = topicButtons.nth(index);
    if (!(await topic.isVisible())) break;
    await topic.click();
    await expectOnePage(page, `趋势/主题${index + 1}`);
  }

  await page.goto('/chat');
  await page.getByRole('button', { name: /模型：/ }).click();
  await expect(page.locator('.chat-model-panel')).toContainText('选择模型');
  await expectOnePage(page, '问答/模型选项');
  await page.getByRole('button', { name: '关闭模型选项' }).click();
  await page.getByRole('button', { name: /强度：/ }).click();
  await expect(page.locator('.chat-model-panel')).toContainText('推理强度');
  await expectOnePage(page, '问答/强度选项');
  await page.getByRole('button', { name: '关闭模型选项' }).click();
  const quickCount = await page.locator('.quick-grid button').count();
  for (let index = 0; index < quickCount; index += 1) {
    await page.goto('/chat');
    const quick = page.locator('.quick-grid button').nth(index);
    if (!(await quick.isVisible())) break;
    await quick.click();
    await expect(page.locator('.msg.assistant')).toBeVisible();
    await expectOnePage(page, `问答/快捷问题${index + 1}`);
  }
  await page.locator('textarea').fill('科研失信调查人员是否需要签署保密协议？');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('.msg.assistant .msg-content')).not.toBeEmpty();
  await page.getByRole('button', { name: /证据与引用/ }).click();
  await expect(page.locator('.source-card').first()).toBeVisible();
  await expectOnePage(page, '问答/证据');
  await page.getByRole('button', { name: '问答', exact: true }).click();
  await expect(page.locator('.msg.assistant')).toBeVisible();
  await expectOnePage(page, '问答/回答');
  const messages = page.locator('.chat-messages');
  if (await messages.evaluate(element => element.scrollHeight > element.clientHeight + 1)) {
    await messages.hover();
    await page.mouse.wheel(0, 400);
    await expect.poll(() => messages.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  }

  await page.goto('/graph');
  for (const label of ['筛选与路径', '关键词列表', '关键词详情', '关键词星图']) {
    const button = page.getByRole('button', { name: label, exact: true });
    if (await button.isVisible()) await button.click();
    await expectOnePage(page, `知识图谱/${label}`);
  }
  await page.getByRole('button', { name: '关键词列表', exact: true }).click();
  const keywordList = page.locator('.keyword-list');
  await expect.poll(() => keywordList.evaluate(element => element.scrollHeight > element.clientHeight + 1)).toBeTruthy();
  await keywordList.hover();
  await page.mouse.wheel(0, 260);
  await expect.poll(() => keywordList.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  const keywordCount = await page.locator('.keyword-list button').count();
  for (let index = 0; index < keywordCount; index += 1) {
    await page.getByRole('button', { name: '关键词列表', exact: true }).click();
    const keyword = page.locator('.keyword-list button').nth(index);
    await keyword.click();
    await expect(page.getByRole('button', { name: '关键词详情', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expectOnePage(page, `知识图谱/关键词${index + 1}`);
  }
  await page.getByRole('button', { name: '人工知识图谱', exact: true }).click();
  await expect(page.locator('.kg-chart canvas')).toHaveCount(1);
  for (const label of ['筛选与路径', '实体详情', '语义星图']) {
    const button = page.getByRole('button', { name: label, exact: true });
    if (await button.isVisible()) await button.click();
    await expectOnePage(page, `人工图谱/${label}`);
  }
  await page.getByRole('button', { name: '筛选与路径', exact: true }).click();
  const domainButtons = page.locator('.kg-domain-list button');
  for (let index = 0; index < await domainButtons.count(); index += 1) {
    await domainButtons.nth(index).click();
    await expectOnePage(page, `人工图谱/知识域${index + 1}`);
  }
  await page.getByRole('button', { name: '语义星图', exact: true }).click();
  await page.waitForTimeout(300);
  const graphCanvas = page.locator('.kg-canvas canvas').first();
  const graphBox = await graphCanvas.boundingBox();
  expect(graphBox && graphBox.width > 300 && graphBox.height > 100, '人工图谱画布可拖动区域').toBeTruthy();
  await page.mouse.move(graphBox!.x + graphBox!.width / 2, graphBox!.y + graphBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(graphBox!.x + graphBox!.width / 2 + 28, graphBox!.y + graphBox!.height / 2 + 16, { steps: 4 });
  await page.mouse.up();
  await expectOnePage(page, '人工图谱/拖动');

  await page.goto(`/library?doc=${documents[0].id}`);
  await expect(page.locator('.document-reader-head h2')).toHaveText(documents[0].name);
  const reader = page.locator('.document-reader-body');
  if (await reader.evaluate(element => element.scrollHeight > element.clientHeight + 1)) {
    await reader.hover();
    await page.mouse.wheel(0, 280);
    await expect.poll(() => reader.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  }
  const next = page.locator('.document-pager-button.is-next');
  if (await next.isVisible()) {
    await next.click();
    await expect(page.locator('.document-reader-head h2')).not.toHaveText(documents[0].name);
    await expectOnePage(page, '文档中心/下一份');
  }
  const directoryToggle = page.getByRole('button', { name: /文档目录/ });
  if (await directoryToggle.isVisible()) {
    await directoryToggle.click();
    await expect(directoryToggle).toHaveAttribute('aria-expanded', 'true');
    await expectOnePage(page, '文档中心/目录展开');
  }

  await page.setViewportSize({ width: 960, height: 700 });
  await page.goto('/trend');
  await page.getByRole('tab', { name: '分析设置', exact: true }).click();
  const wideTopicButtons = page.locator('.trend-controls-page .chips button');
  await expect.poll(() => wideTopicButtons.first().isVisible()).toBeTruthy();
  for (let index = 0; index < await wideTopicButtons.count(); index += 1) {
    await wideTopicButtons.nth(index).click();
    await expectOnePage(page, `紧凑桌面趋势/主题${index + 1}`);
  }

  const login = await context.request.post('/api/auth/login', { data: { username: 'admin', password: 'yanxin2026' } });
  expect(login.ok()).toBeTruthy();
  await page.setViewportSize({ width: 720, height: 450 });
  await page.goto('/admin');
  await expect(page.locator('.admin-deck')).toBeVisible();
  for (const label of ['新建用户', '权限说明', '用户与角色']) {
    await page.getByRole('tab', { name: label, exact: true }).click();
    await expect(page.locator('.admin-deck .work-deck-head h3')).toHaveText(label);
    await expectOnePage(page, `用户管理/${label}`);
  }
});
