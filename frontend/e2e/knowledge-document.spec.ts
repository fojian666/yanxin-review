import { test, expect, navigate } from "./fixtures";

async function expectCenteredIcon(page: import("@playwright/test").Page, selector: string) {
  const container = await page.locator(selector).boundingBox();
  const icon = await page.locator(`${selector} svg`).boundingBox();
  expect(container && icon).toBeTruthy();
  expect(Math.abs((container!.x + container!.width / 2) - (icon!.x + icon!.width / 2))).toBeLessThan(1);
  expect(Math.abs((container!.y + container!.height / 2) - (icon!.y + icon!.height / 2))).toBeLessThan(1);
}

test("@smoke 知识图谱统计、检索、领域筛选、路径推演与大模型跳转", async ({ app: page }, testInfo) => {
  await navigate(page, "知识图谱");
  await page.getByRole("button", { name: "人工知识图谱" }).click();
  await expect(page.locator(".kg-stats")).toContainText("48实体");
  await expect(page.locator(".kg-stats")).toContainText("100关系");
  await expect(page.locator(".kg-stats")).toContainText("7知识域");
  await expect(page.locator(".kg-chart canvas")).toHaveCount(1);
  await expectCenteredIcon(page, ".kg-summary-icon");

  const integrityDomain = page.locator(".kg-domain-list").getByRole("button", { name: /诚信与合规/ });
  await integrityDomain.click();
  await expect(integrityDomain).toHaveAttribute("aria-pressed", "false");
  await integrityDomain.click();
  await expect(integrityDomain).toHaveAttribute("aria-pressed", "true");

  await page.getByLabel("检索知识图谱").fill("持续检查");
  await expect(page.locator(".kg-search-results").getByRole("button", { name: /过程管理/ })).toBeVisible();
  await page.getByLabel("检索知识图谱").fill("申报受理");
  await page.locator(".kg-search-results").getByRole("button", { name: /申报受理/ }).click();
  await page.getByRole("button", { name: "从这里推理" }).click();
  await expect(page.getByLabel("起点")).toHaveValue("intake");

  await page.getByLabel("检索知识图谱").fill("补充耕地");
  const result = page.locator(".kg-search-results").getByRole("button", { name: /储备补充耕地/ });
  await expect(result).toBeVisible();
  await result.click();
  await expect(page.locator(".kg-detail h2")).toHaveText("储备补充耕地");
  await expect(page).toHaveURL(/focus=farmland/);

  await page.getByLabel("起点").selectOption("proposal");
  await page.getByLabel("终点").selectOption("humanReview");
  await page.getByRole("button", { name: "推演语义路径" }).click();
  await expect(page.locator(".kg-path-result")).toContainText("路径");
  await expect(page.locator(".kg-path-chain")).toContainText("人工复核");
  await page.screenshot({ path: testInfo.outputPath("knowledge-graph-desktop.png") });

  await page.getByRole("button", { name: "让大模型解释" }).last().click();
  await expect(page).toHaveURL(/\/chat$/);
  await expect(page.locator(".composer textarea")).toHaveValue(/储备补充耕地/);
});

test("文档中心读取正文并按目录深链切换", async ({ app: page, documents }, testInfo) => {
  await page.goto(`/library?doc=${documents[0].id}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("文档中心");
  await expectCenteredIcon(page, ".document-center-mark");
  const buttons = await page.locator(".document-center-tools .btn").evaluateAll((items) => items.map((item) => {
    const rect = item.getBoundingClientRect();
    return { top: rect.top, height: rect.height };
  }));
  expect(buttons).toHaveLength(2);
  expect(Math.abs(buttons[0].top - buttons[1].top)).toBeLessThan(1);
  expect(Math.abs(buttons[0].height - buttons[1].height)).toBeLessThan(1);
  const heights = await page.locator(".document-center-layout > *").evaluateAll((items) => items.map((item) => item.getBoundingClientRect().height));
  expect(Math.abs(heights[0] - heights[1])).toBeLessThan(1);
  await expect(page.locator(".document-reader-head h2")).toHaveText(documents[0].name);
  await expect(page.locator(".document-prose")).toContainText("科研诚信与自然资源数据治理研究");
  await expect(page.locator(".document-prose")).toContainText("研究内容");

  await page.locator(".document-directory").getByRole("button", { name: new RegExp(documents[1].name) }).click();
  await expect(page).toHaveURL(new RegExp(`doc=${documents[1].id}`));
  await expect(page.locator(".document-reader-head h2")).toHaveText(documents[1].name);
  await expect(page.locator(".document-prose")).toContainText("科研诚信与自然资源数据治理研究");
  await expect.poll(() => page.locator(".document-reader-body").evaluate(element => element.scrollHeight >= element.clientHeight)).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath("document-center-desktop.png") });

  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`doc=${documents[0].id}`));
  await expect(page.locator(".document-reader-head h2")).toHaveText(documents[0].name);

  const directory = page.locator(".document-directory-shell");
  await directory.scrollIntoViewIfNeeded();
  await directory.hover();
  await page.mouse.wheel(0, 1500);
  await expect.poll(() => directory.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  const lastProposal = page.locator(".document-directory-group").first().getByRole("button").last();
  const lastName = await lastProposal.locator("strong").innerText();
  await lastProposal.click();
  await expect(page.locator(".document-reader-head h2")).toHaveText(lastName);

  await page.getByLabel("筛选文档").fill(documents[1].name);
  await expect(page.locator(".document-directory").getByRole("button", { name: new RegExp(documents[1].name) })).toBeVisible();
  await expect(page.locator(".document-directory").getByRole("button", { name: new RegExp(documents[0].name) })).toHaveCount(0);
});

test("手机文档目录可展开并保持正文焦点", async ({ app: page, documents }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/library?doc=${documents[0].id}`);
  const toggle = page.getByRole("button", { name: /文档目录/ });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await page.locator(".document-directory").getByRole("button", { name: new RegExp(documents[1].name) }).click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".document-reader")).toBeFocused();
  await expect(page.locator(".document-reader-head h2")).toHaveText(documents[1].name);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath("document-center-mobile.png") });
});

test("平板任务态让知识图谱优先进入首屏", async ({ app: page }, testInfo) => {
  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto("/graph");
  const ledger = page.locator(".workspace-ledger");
  expect((await ledger.boundingBox())?.height).toBeLessThan(100);
  const canvasBox = await page.locator(".kg-canvas-panel").boundingBox();
  expect(canvasBox && canvasBox.y).toBeLessThan(460);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath("knowledge-graph-tablet.png") });
  await page.setViewportSize({ width: 1200, height: 900 });
  await expect.poll(async () => {
    const controls = await page.locator(".keyword-list-panel").boundingBox();
    const graph = await page.locator(".kg-canvas-panel").boundingBox();
    const details = await page.locator(".keyword-detail").boundingBox();
    return !!(controls && graph && details && controls.x < graph.x && graph.x < details.x);
  }).toBeTruthy();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

test("快速切换文档时旧正文响应不会覆盖当前文档", async ({ app: page, documents }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let started!: () => void;
  const intercepted = new Promise<void>((resolve) => { started = resolve; });
  await page.route("**/api/documents/*/content", async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.includes(documents[0].id)) return route.continue();
    started();
    await gate;
    await route.continue();
  });
  await page.goto(`/library?doc=${documents[0].id}`);
  await intercepted;
  await page.locator(".document-directory").getByRole("button", { name: new RegExp(documents[1].name) }).click();
  await expect(page.locator(".document-reader-head h2")).toHaveText(documents[1].name);
  await expect(page.locator(".document-prose")).toContainText("科研诚信与自然资源数据治理研究");
  release();
  await page.waitForTimeout(250);
  await expect(page.locator(".document-reader-head h2")).toHaveText(documents[1].name);
});

test('文档二级分类按卷宗角色展示，跨卷宗同角色不重复', async ({ app: page, documents, context }, testInfo) => {
  const listed = await (await context.request.get('/api/documents')).json();
  const policy = listed.documents.find((doc: { kind: string }) => doc.kind === 'policy');
  expect(policy).toBeTruthy();
  for (const [name, role] of [['分类测试甲', 'integrity_pledge'], ['分类测试乙', 'integrity_pledge'], ['分类测试丙', 'contract']]) {
    const created = await context.request.post('/api/dossiers', { data: { name } });
    expect(created.ok()).toBeTruthy();
    const { dossier } = await created.json();
    const attached = await context.request.post(`/api/dossiers/${dossier.id}/documents`, {
      data: { doc_id: documents[0].id, role },
    });
    expect(attached.ok()).toBeTruthy();
    if (name === '分类测试甲') {
      const reference = await context.request.post(`/api/dossiers/${dossier.id}/documents`, { data: { doc_id: policy.id, role: 'other' } });
      expect(reference.ok()).toBeTruthy();
    }
  }
  await page.goto('/library');
  const directory = page.locator('.document-directory');
  await expect(directory.getByRole('heading', { name: '课题材料', exact: true })).toBeVisible();
  await expect(directory.getByRole('heading', { name: '公共与参考资料', exact: true })).toBeVisible();
  for (const role of ['诚信承诺书', '合同']) {
    const group = directory.locator('.document-directory-group').filter({ has: page.getByRole('heading', { name: new RegExp(`^${role}\\s`) }) });
    await expect(group.getByRole('button', { name: new RegExp(documents[0].name) })).toHaveCount(1);
  }
  const proposalGroup = directory.locator('.document-directory-group').filter({ has: page.getByRole('heading', { name: /^申请书\s/ }) });
  await expect(proposalGroup.getByRole('button', { name: new RegExp(documents[1].name) })).toBeVisible();
  await expect(directory.getByRole('heading', { name: /^政策\s/ })).toBeVisible();
  const otherGroup = directory.locator('.document-directory-group').filter({ has: page.getByRole('heading', { name: /^其他材料\s/ }) });
  await expect(otherGroup.getByRole('button').filter({ hasText: policy.name })).toHaveCount(1);
  const projectCategory = directory.locator('.document-directory-category').filter({ has: page.getByRole('heading', { name: '课题材料', exact: true }) });
  await projectCategory.locator(':scope > summary').click();
  await expect(projectCategory.locator('.document-directory-group').first()).toBeHidden();
  await projectCategory.locator(':scope > summary').click();
  const contract = directory.locator('.document-directory-group').filter({ has: page.getByRole('heading', { name: /^合同\s/ }) });
  await contract.locator('summary').click();
  await expect(contract.getByRole('button', { name: new RegExp(documents[0].name) })).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('document-categories.png') });
  await directory.getByLabel('筛选文档').fill(documents[0].name);
  await expect(directory.locator('.document-directory-group').filter({ has: page.getByRole('heading', { name: /^合同\s/ }) }).getByRole('button', { name: new RegExp(documents[0].name) })).toBeVisible();
  await expect(directory.getByRole('button', { name: new RegExp(documents[1].name) })).toHaveCount(0);
});


test('文档关键词星图显示真实关键词和来源，上传后更新', async ({ app: page, server }, testInfo) => {
  expect((await fetch(`${server.url}/api/knowledge/keywords`)).status).toBe(401);
  await navigate(page, '知识图谱');
  await expect(page.locator('.keyword-graph .kg-stats')).toContainText('100关键词');
  await expect(page.locator('.keyword-list button')).toHaveCount(100);
  await expect(page.locator('.keyword-source a').first()).toBeVisible();
  await expect(page.locator('.keyword-caveat')).toContainText('不代表因果');
  const sources = page.locator('.keyword-graph .kg-stats span').last().locator('strong');
  const before = Number(await sources.innerText());
  await page.screenshot({ path: testInfo.outputPath('keyword-graph-desktop.png') });
  await page.locator('.topbar-actions').getByRole('button', { name: '上传文档', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '上传文档' });
  await dialog.locator('input[type=file]').setInputFiles({ name: '图谱更新.txt', mimeType: 'text/plain', buffer: Buffer.from('生态监测和资源治理。生态监测依赖资源治理及科学评估。'.repeat(30)) });
  await dialog.getByLabel('资料类型').selectOption('other');
  await dialog.getByRole('button', { name: '开始上传' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(sources).toHaveText(String(before + 1));
  await navigate(page, '文档中心');
  await page.locator('.document-directory').getByRole('button', { name: /图谱更新/ }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '删除文档', exact: true }).click();
  await expect(page.getByText('文档已删除', { exact: true })).toBeVisible();
  await navigate(page, '知识图谱');
  await expect(sources).toHaveText(String(before));
  await page.getByRole('button', { name: '人工知识图谱' }).click();
  await expect(page.locator('.kg-stats')).toContainText('48实体');
});
