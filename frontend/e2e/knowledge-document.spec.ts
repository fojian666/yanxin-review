import { test, expect, navigate } from "./fixtures";

test("@smoke 知识图谱统计、检索、领域筛选、路径推演与大模型跳转", async ({ app: page }, testInfo) => {
  await navigate(page, "知识图谱");
  await expect(page.locator(".kg-stats")).toContainText("48实体");
  await expect(page.locator(".kg-stats")).toContainText("100关系");
  await expect(page.locator(".kg-stats")).toContainText("7知识域");
  await expect(page.locator(".kg-chart canvas")).toHaveCount(1);

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
    const controls = await page.locator(".kg-control").first().boundingBox();
    const graph = await page.locator(".kg-canvas-panel").boundingBox();
    const details = await page.locator(".kg-detail").boundingBox();
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
