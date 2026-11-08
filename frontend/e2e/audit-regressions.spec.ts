import { test, expect, loginUI, navigate } from "./fixtures";

function trendResult(query: string, start: number, end: number) {
  const years = Array.from({ length: end - start + 1 }, (_, index) => start + index);
  return {
    query,
    years,
    counts: years.map(() => 0),
    keyword_series: [],
    top_keywords_by_year: years.map((year) => ({ year, keywords: [] })),
    papers: [],
    summary: "当前年份窗口暂无匹配文献。",
    mode: "offline",
    warning: "",
    sample: false,
    no_match: true,
    stats: {
      total: 0,
      year_start: start,
      year_end: end,
      top_keyword: "",
      growth_pct: null,
      first_year_count: 0,
      last_year_count: 0,
      sample_count: 0,
      real_count: 0,
    },
  };
}

test("趋势首跑使用实际文献年份而不是固定窗口", async ({ app: page }) => {
  const papers = [2013, 2014, 2015, 2016].map((year, index) => ({
    id: 9000 + index,
    title: `年份测试文献 ${year}`,
    authors: "测试作者",
    year,
    venue: "测试期刊",
    abstract: "科研诚信测试摘要",
    keywords: "科研诚信",
    keywords_list: ["科研诚信"],
    is_sample: 0,
    source: "csv",
  }));
  const requests: Array<Record<string, unknown>> = [];
  await page.route("**/api/papers", (route) => route.fulfill({ json: { papers, count: papers.length } }));
  await page.route("**/api/trends", async (route) => {
    const payload = route.request().postDataJSON() as { query: string; start_year: number; end_year: number };
    requests.push(payload);
    await route.fulfill({ json: trendResult(payload.query, payload.start_year, payload.end_year) });
  });
  await page.reload();
  await navigate(page, "文献趋势");
  await expect(page.getByLabel("起始年份")).toHaveValue("2013");
  await expect(page.getByLabel("结束年份")).toHaveValue("2016");
  expect(requests[0]).toMatchObject({ start_year: 2013, end_year: 2016 });
});

test("案卷和专家任务读取失败显示错误而不是空态", async ({ app: page, context }) => {
  await page.route("**/api/review-cases", (route) => route.fulfill({ status: 500, json: { detail: "受控案卷读取失败" } }));
  await navigate(page, "项目评审");
  await expect(page.locator(".review-case-loading[role='alert']")).toContainText("受控案卷读取失败");
  await expect(page.getByText("建立项目评审案卷", { exact: true })).toHaveCount(0);
  await page.unroute("**/api/review-cases");

  await context.request.post("/api/auth/logout");
  await loginUI(page, "admin");
  await page.route("**/api/review-tasks", (route) => route.fulfill({ status: 500, json: { detail: "受控任务读取失败" } }));
  await navigate(page, "专家审核");
  await expect(page.locator(".expert-review-empty[role='alert']")).toContainText("受控任务读取失败");
  await expect(page.getByText("当前没有可调试的审核任务。", { exact: true })).toHaveCount(0);
});

test("文献数据超过一百条仍可搜索并分页访问", async ({ app: page }) => {
  const papers = Array.from({ length: 166 }, (_, index) => ({
    id: 10000 + index,
    title: `Paper ${String(index + 1).padStart(3, "0")}`,
    authors: "分页测试",
    year: 2020 + (index % 6),
    venue: "测试期刊",
    abstract: "摘要",
    keywords: "分页;文献",
    keywords_list: ["分页", "文献"],
    is_sample: 0,
    source: "csv",
  }));
  await page.route("**/api/papers", (route) => route.fulfill({ json: { papers, count: papers.length } }));
  await page.reload();
  await page.goto("/library?view=literature");
  await expect(page.getByText("1 / 4 页 · 共 166 条", { exact: true })).toBeVisible();
  await expect(page.locator(".data-table tbody tr")).toHaveCount(50);
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(page.getByText("2 / 4 页 · 共 166 条", { exact: true })).toBeVisible();
  await expect(page.locator(".data-table tbody tr").first()).toContainText("Paper 051");
  await page.getByPlaceholder("搜索标题、作者、关键词或年份").fill("Paper 120");
  await expect(page.locator(".data-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".data-table tbody tr")).toContainText("Paper 120");
});

test("失效预审深链会被消费并从地址栏移除", async ({ app: page, documents }) => {
  await page.goto("/review?doc=missing-document");
  await expect(page).toHaveURL(/\/review$/);
  await expect(page.getByLabel("当前课题")).toHaveValue("");
  await page.reload();
  await expect(page).toHaveURL(/\/review$/);
  expect(documents.length).toBeGreaterThan(0);
});

test("矮视口下图谱点击关键词会切换到详情窗格", async ({ app: page }) => {
  await page.setViewportSize({ width: 1440, height: 650 });
  await navigate(page, "知识图谱");
  const compactSwitch = page.locator(".kg-compact-switch").first();
  await expect(compactSwitch).toBeVisible();
  await compactSwitch.getByRole("button", { name: "关键词列表" }).click();
  const keyword = page.locator(".keyword-list button").first();
  await expect(keyword).toBeVisible();
  await keyword.click();
  await expect(compactSwitch.getByRole("button", { name: "关键词详情" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".keyword-detail")).toBeVisible();
});

test("上传成功但列表刷新失败时仍明确告知上传已完成", async ({ app: page }) => {
  let uploadStarted = false;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/documents")) uploadStarted = true;
  });
  await page.route("**/api/documents", (route) => {
    if (route.request().method() === "GET" && uploadStarted) {
      return route.fulfill({ status: 500, json: { detail: "受控刷新失败" } });
    }
    return route.continue();
  });
  await page.getByRole("button", { name: "上传文档", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "上传刷新测试.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("科研诚信材料正文。"),
  });
  await page.getByRole("button", { name: "开始上传", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("文档已上传并建立索引");
  await expect(page.locator(".toast")).toContainText("目录刷新失败");
  await expect(page.getByRole("dialog", { name: "上传文档" })).toHaveCount(0);
});

test("卷宗体检读取失败显示读取失败而不是黄色关注", async ({ app: page, context }) => {
  const created = await context.request.post("/api/dossiers", {
    data: {
      name: "体检错误测试卷宗",
      year: 2026,
      plan_type: "directive",
      phase: "application",
      applicant_unit: "",
      leader: "",
      supervisor: "",
    },
  });
  expect(created.ok()).toBeTruthy();
  const dossierId = (await created.json()).dossier.id as string;
  await page.route(`**/api/dossiers/${dossierId}/checklist`, (route) =>
    route.fulfill({ status: 500, json: { detail: "受控体检读取失败" } })
  );
  await page.reload();
  await navigate(page, "申报流程");
  await expect(page.locator(".dossier-workbench .status-pill").first()).toHaveText("读取失败");
  await page.getByRole("tab", { name: "材料体检", exact: true }).click();
  await expect(page.locator(".dossier-error")).toContainText("受控体检读取失败");
});

test("二次预审后案卷页展示最新归档而不是第一条", async ({ app: page, context, documents }) => {
  const created = await context.request.post("/api/review-cases", {
    data: { title: "最新归档测试", doc_id: documents[0].id, dossier_id: "" },
  });
  expect(created.ok()).toBeTruthy();
  const caseId = (await created.json()).case.id as string;
  const detail = await context.request.get(`/api/review-cases/${caseId}`);
  expect(detail.ok()).toBeTruthy();
  const payload = await detail.json();
  payload.case.artifacts = [
    {
      id: "old-pre",
      case_id: caseId,
      stage: "pre_review",
      stage_label: "预审",
      artifact_type: "pre_review",
      title: "旧预审",
      round: 1,
      format: "markdown",
      content: "旧预审正文",
      payload: { overall: { summary: "旧预审摘要" }, disclaimer: "人工复核", sections: [] },
      source_doc_id: documents[0].id,
      created_by: "manager",
      created_at: "2026-01-01T00:00:00",
      sha256: "old",
    },
    {
      id: "new-pre",
      case_id: caseId,
      stage: "pre_review",
      stage_label: "预审",
      artifact_type: "pre_review",
      title: "新预审",
      round: 1,
      format: "markdown",
      content: "新预审正文",
      payload: {
        overall: { summary: "最新预审摘要" },
        disclaimer: "人工复核",
        sections: [],
        scoring: {
          version: "precheck-v1",
          label: "规范性检查（试行）",
          maximum: 100,
          earned: 80,
          pending_points: 0,
          upper_bound: 80,
          final_score: 80,
          risk_level: "低",
          risk_reason: "规则得分测试",
          critical_issues: [],
          dimensions: [],
          disclaimer: "人工复核",
          thresholds: { low: 80, medium: 60 },
          duplicate_metrics: undefined,
        },
      },
      source_doc_id: documents[0].id,
      created_by: "manager",
      created_at: "2026-01-02T00:00:00",
      sha256: "new",
    },
  ];
  await page.route(`**/api/review-cases/${caseId}`, (route) => route.fulfill({ json: payload }));
  await page.reload();
  await navigate(page, "项目评审");
  await expect(page.getByText("最新预审摘要", { exact: true })).toBeVisible();
  await expect(page.getByText("未发现关键问题，仍须人工复核。", { exact: true })).toBeVisible();
  await expect(page.getByText("旧预审摘要", { exact: true })).toHaveCount(0);
});

test("空历史课题不会把问答范围回退为全部文档", async ({ app: page, context }) => {
  const created = await context.request.post("/api/dossiers", {
    data: {
      name: "空材料问答测试卷宗",
      year: 2026,
      plan_type: "directive",
      phase: "application",
      applicant_unit: "",
      leader: "",
      supervisor: "",
    },
  });
  expect(created.ok()).toBeTruthy();
  const dossierId = (await created.json()).dossier.id as string;
  await page.reload();
  await expect(page.getByLabel("当前课题")).toBeVisible();
  await page.getByLabel("当前课题").selectOption(dossierId);
  await navigate(page, "智能问答");
  await expect(page.locator(".scope-label")).toHaveText("当前历史课题暂无可提问材料");
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeDisabled();
  await expect(page.locator("textarea")).toBeDisabled();
});

test("移除演示文献成功但刷新失败时不误报为移除失败", async ({ app: page }) => {
  let deleted = false;
  page.on("request", (request) => {
    if (request.method() === "DELETE" && request.url().endsWith("/api/papers/sample")) deleted = true;
  });
  await page.route("**/api/papers", (route) => {
    if (route.request().method() === "GET" && deleted) {
      return route.fulfill({ status: 500, json: { detail: "受控文献刷新失败" } });
    }
    return route.continue();
  });
  await navigate(page, "文献趋势");
  await expect(page.locator(".notice")).toContainText("演示数据");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "移除演示文献", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("已移除");
  await expect(page.locator(".toast")).toContainText("列表刷新失败");
  await expect(page.locator(".toast")).not.toContainText("移除失败");
});
