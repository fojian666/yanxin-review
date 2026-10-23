/* zcode-workflow
description: 研信智评·提交前健康检查：先跑两道确定性门禁（后端 pytest 回归、前端 tsc --noEmit + vite
  构建），再并行核对 README、AGENTS.md、实施方案三份文档与代码的一致性，每条发现由独立子代理复核后汇总为健康报告。
whenToUse: 提交代码前或文档/代码改动后，想确认项目处于可交付状态时运行；也适合定期跑一次防止三份文档与代码漂移。隐私红线文件（申请书终稿
  docx、软著 screenshots）固定排除，且不做端到端接口冒烟。
*/
interface DocFinding {
  /** 文档中出问题的位置：行号或小节名，如 "README.md:120" 或 "§8.2 第 3 条"。 */
  where: string;
  /** 一句话：文档写了什么、代码实际是什么。 */
  what: string;
  /** 证据：必须同时包含文档原句和代码中相反事实的位置（file:line）。 */
  evidence: string;
  /** high=会误导使用或评审；medium=明显过期；low=措辞或细枝末节。 */
  severity: "low" | "medium" | "high";
}

interface DocReview {
  /** 一句话：该文档与代码的总体一致程度。 */
  summary: string;
  findings: DocFinding[];
}

interface Confirmation {
  /** 独立复核后该发现是否成立。 */
  holds: boolean;
  /** 复核说明：引用文档与代码的位置佐证；不成立时说明理由。 */
  note: string;
}

interface Finding {
  /** 问题位置：文档名 + 行号/小节，或命令名。 */
  where: string;
  /** 一句话：发现了什么。 */
  what: string;
  /** 证据：文档原句与代码位置，或命令与输出节选。 */
  evidence: string;
  /** verified=已经独立复核或命令退出码证实；unconfirmed=复核未成立或未完成。 */
  status: "verified" | "unconfirmed";
  /** 严重度：high 仅留给会误导使用/评审或导致回归的问题。 */
  severity: "low" | "medium" | "high";
}

interface WorkflowReport {
  /** 两三句话，回答本次健康检查的结论。 */
  conclusion: string;
  findings: Finding[];
  /** 本次实际跑了哪些检查、怎么核实的。 */
  verified: string[];
  /** 没查什么、为什么。 */
  notCovered: string[];
}

const DOC_TARGETS = [
  {
    doc: "README.md",
    focus:
      "使用说明与 API 文档：逐条核对 README 描述的接口路径、参数、端口、启动命令与功能行为，是否与 app.py 的实际路由及 rag/ 各模块实现一致。",
  },
  {
    doc: "AGENTS.md",
    focus:
      "模块地图与数据事实：核对文件清单及职责描述、常用命令，以及具体数字（路由条数、测试项数、分块/TOP_K/上传上限等默认值）与实际代码是否一致。",
  },
  {
    doc: "实施方案-RAG垂类模型与智能问答.md",
    focus:
      "重点看 §8.2 已落地清单：清单声称已落地的功能，逐条确认在 app.py、rag/、frontend/src/ 中确有对应实现；找出多报（清单有、代码无）与漏报（代码有、清单未列）。",
  },
];

const PRIVACY_RULE =
  "不要读取「3.科研课题申请书（终稿）.docx」和「交付材料/01-软件著作权/screenshots/」（含真实个人信息，按项目红线排除在检查外）。";

function reviewAsk(doc: string, focus: string): string {
  return [
    `核对文档《${doc}》与当前代码是否一致。`,
    `核对重点：${focus}`,
    "代码都在仓库根目录：app.py、rag/、frontend/src/、tests/、frontend/package.json、run.sh。先通读文档，再打开它描述的代码逐条比对。",
    "只报告文档与代码之间真实、可指认的不一致（文档写错、已过期、代码变了文档未跟上）；一致的不用报，拿不准的不要报。",
    "不需要运行测试或构建，脚本已经跑过；只做静态比对。",
    `红线：只读核对，不要修改任何文件；${PRIVACY_RULE}`,
    "若无法完成核对（文件缺失、指引矛盾），如实说明并停止，不要编造发现。",
    "用中文回答。",
  ].join("\n");
}

function confirmAsk(doc: string, finding: DocFinding): string {
  return [
    `下面是一条来自《${doc}》核对的不一致发现，请独立复核它是否成立。不要采信发现者的结论，自己打开对应位置比对：`,
    JSON.stringify(finding),
    "成立标准：文档原句确实如发现所述，且代码当前位置的事实确实与文档相悖。",
    `红线：只读复核，不要修改任何文件；${PRIVACY_RULE}`,
    "用中文回答。",
  ].join("\n");
}

artifact.metrics("gates", {
  title: "门禁结果",
  metrics: [
    { field: "backend", label: "后端回归测试" },
    { field: "frontend", label: "前端构建" },
  ],
});
artifact.table("findings", {
  title: "发现清单",
  columns: [
    { field: "where", label: "位置" },
    { field: "what", label: "问题" },
    { field: "severity", label: "严重度" },
    { field: "status", label: "状态" },
  ],
});

phase("运行后端回归测试");
const backendP = world.run("python3", ["-m", "pytest", "tests/", "-q"], { timeoutMs: 300_000 });

phase("运行前端类型检查与构建");
const frontendP = world.run("npm", ["--prefix", "frontend", "run", "build"], { timeoutMs: 600_000 });

const backend = await backendP;
const frontend = await frontendP;
const passedMatch = /(\d+) passed/.exec(backend.stdout);
const passedCount = passedMatch?.[1] ?? "?";
log(
  `后端回归测试${backend.exitCode === 0 ? `通过（${passedCount} 项）` : "失败"}；前端构建${frontend.exitCode === 0 ? "通过" : "失败"}`,
);
report(
  {
    backend: backend.exitCode === 0 ? `通过（${passedCount} 项）` : "失败",
    frontend: frontend.exitCode === 0 ? "通过" : "失败",
  },
  "gates",
);

const gateFindings: Finding[] = [];
if (backend.exitCode !== 0) {
  const f: Finding = {
    where: "tests/（python3 -m pytest tests/ -q）",
    what: "后端回归测试未通过",
    evidence: `退出码 ${backend.exitCode}。输出节选：${(backend.stderr || backend.stdout).slice(0, 1500)}`,
    status: "verified",
    severity: "high",
  };
  gateFindings.push(f);
  report(f, "findings");
}
if (frontend.exitCode !== 0) {
  const f: Finding = {
    where: "frontend（npm --prefix frontend run build）",
    what: "前端类型检查或构建未通过",
    evidence: `退出码 ${frontend.exitCode}。输出节选：${(frontend.stderr || frontend.stdout).slice(0, 1500)}`,
    status: "verified",
    severity: "high",
  };
  gateFindings.push(f);
  report(f, "findings");
}

phase("三份文档并行核对代码一致性，逐条独立复核后汇总");
log(`并行核对：${DOC_TARGETS.map((t) => `《${t.doc}》`).join("、")}`);

const perDoc = await Promise.all(
  // join 屏障：最终报告需要全部三份文档的发现才能汇总
  DOC_TARGETS.map(async (t) => {
    try {
      const review = await agent(`文档核对·${t.doc}`, {
        system: "严谨的技术文档审计员：只认代码里读到的事实，不猜测、不凑数；没有不一致就如实报零条。",
      }).ask<DocReview>(reviewAsk(t.doc, t.focus));
      log(`《${t.doc}》核对完成：${review.findings.length} 条候选发现`);
      const checks = await Promise.all(
        review.findings.map((f, i) =>
          agent(`独立复核·${t.doc}·${i + 1}`, {
            system: "独立复核员：只凭自己打开文件比对的结果下结论，原发现者的说法一律不算数。",
          }).ask<Confirmation>(confirmAsk(t.doc, f)),
        ),
      );
      return review.findings.map((f, i) => {
        const c = checks[i];
        const finding: Finding = {
          where: `${t.doc}｜${f.where}`,
          what: f.what,
          evidence: `${f.evidence}｜复核${c.holds ? "成立" : "不成立"}：${c.note}`,
          status: c.holds ? "verified" : "unconfirmed",
          severity: f.severity,
        };
        report(finding, "findings");
        return finding;
      });
    } catch (err) {
      const finding: Finding = {
        where: t.doc,
        what: "该文档的核对流程未能完成，结果缺失",
        evidence: String(err).slice(0, 300),
        status: "unconfirmed",
        severity: "low",
      };
      report(finding, "findings");
      return [finding];
    }
  }),
);

const allFindings = [...gateFindings, ...perDoc.flat()];
const verifiedCount = allFindings.filter((f) => f.status === "verified").length;
const highVerified = allFindings.filter((f) => f.severity === "high" && f.status === "verified").length;
const failedGates: string[] = [];
if (backend.exitCode !== 0) failedGates.push("后端回归测试");
if (frontend.exitCode !== 0) failedGates.push("前端构建");

const conclusion =
  failedGates.length === 0
    ? `两道门禁均通过：后端回归（pytest，${passedCount} 项）与前端构建（tsc --noEmit + vite build）全绿。三份文档核对共 ${allFindings.length} 条发现，${verifiedCount} 条经独立复核成立${highVerified > 0 ? `，其中 ${highVerified} 条高严重度建议优先处理` : "，无高严重度问题"}。`
    : `门禁未通过（${failedGates.join("、")}），不建议提交：请先按发现清单修复后重跑。文档核对另有 ${allFindings.length - gateFindings.length} 条发现（${verifiedCount} 条经复核成立）。`;

const md: string[] = [
  "# 提交前健康检查报告",
  "",
  "## 一、门禁（确定性检查）",
  `- 后端回归 \`python3 -m pytest tests/ -q\`：${backend.exitCode === 0 ? `✅ 通过（${passedCount} 项）` : "❌ 失败"}`,
  `- 前端构建 \`npm --prefix frontend run build\`（tsc --noEmit + vite build）：${frontend.exitCode === 0 ? "✅ 通过" : "❌ 失败"}`,
  "",
  `## 二、文档与代码一致性（共 ${allFindings.length} 条，${verifiedCount} 条经独立复核成立）`,
];
if (allFindings.length === 0) {
  md.push("三份文档（README、AGENTS.md、实施方案 §8.2）与代码未发现不一致。");
}
for (const f of allFindings) {
  md.push(`- **[${f.severity}｜${f.status === "verified" ? "已复核成立" : "复核未成立"}]** ${f.where}：${f.what}`);
  md.push(`  - 证据：${f.evidence.replace(/\n/g, " ")}`);
}
md.push(
  "",
  "## 三、本次未覆盖",
  "- 隐私红线排除：「3.科研课题申请书（终稿）.docx」「交付材料/01-软件著作权/screenshots/」未检查。",
  "- 软著源程序清单与代码的漂移未核查（AGENTS.md 已记待办：提交软著前需重新生成）。",
  "- 未启动服务做端到端接口冒烟，路由行为仅经文档-代码静态比对。",
);

await artifact.markdown("report", md.join("\n"), {
  title: "提交前健康检查报告",
  description: "两道门禁的通过情况，以及 README、AGENTS.md、实施方案三份文档与代码的一致性发现。",
  primary: true,
});

const result: WorkflowReport = {
  conclusion,
  findings: allFindings,
  verified: [
    `后端回归：python3 -m pytest tests/ -q，退出码 ${backend.exitCode}（${passedCount} 项通过）`,
    `前端构建：npm --prefix frontend run build（tsc --noEmit + vite build），退出码 ${frontend.exitCode}`,
    `文档发现逐条独立复核：${verifiedCount}/${allFindings.length} 条复核成立`,
  ],
  notCovered: [
    "「3.科研课题申请书（终稿）.docx」与「交付材料/01-软著/screenshots/」含真实个人信息，按项目红线未检查",
    "软著源程序清单与代码的漂移未核查（已知待办，提交软著前需重新生成）",
    "未启动 uvicorn 做端到端接口冒烟，仅做静态文档-代码比对",
  ],
};
return result;