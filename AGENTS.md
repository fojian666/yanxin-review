# AGENTS.md — 研信智评 · AI 助手速览上下文

> 给 AI 编程助手的项目速读文件。人是第一读者的话请看 `README.md`（更全）；安全设计与漏洞披露见 `SECURITY.md`；这里只放快速上手和**不能破坏的约束**。

## 这是什么

面向江苏省自然资源科研管理的**科研诚信 RAG 智能评审助手**（"研信智评"）：外挂式、内网部署、不侵入现有科技管理系统。课题原型的配套代码。FastAPI + React 全栈，当前库内数据**全部为演示合成数据**。

## 常用命令

```bash
./run.sh                                                    # 一键运行 → http://127.0.0.1:8010（自动探测 PYTHON/.venv/conda）
python3 -m uvicorn app:app --reload --port 8010             # 后端开发
cd frontend && npm run dev                                  # 前端开发（5173，/api 代理 8010）
cd frontend && npm run build                                # 前端构建（tsc --noEmit + vite）
python3 -m pytest tests/ -q                                 # 回归测试（50 项）
```

PDF 解析依赖 `pdftotext`（poppler）。`frontend/dist` 已存在时运行不需要 Node。

登录演示账号：`admin` / `manager` / `reviewer` / `viewer`。本机监听时密码统一 `yanxin2026`；**对外监听默认不创建演示账号**，需显式 `SEED_DEMO_USERS=1` + `DEMO_USER_PASSWORD`。支持自助改密。

## 模块地图

```
app.py                 FastAPI：25 条路由（含认证 6 条、数据接入 3 条）、SSE 流式问答、上传、SPA 托管（路径穿越有防护）
rag/
  config.py            所有环境变量与默认值（分块 700/100、TOP_K 7、30MB 上限、Qwen/INGEST_TOKEN）
  db.py                SQLite（WAL）：documents/chunks/papers/experts/meta；导入去重 insert_*_if_new
  parsers.py           DOCX（含脚注/尾注）/PDF（pdftotext，页码）/TXT/CSV 解析；60k 字截断保护
  text.py              清洗、章节识别、结构分块、jieba 关键词（领域词表已注入）
  retrieval.py         字符 n-gram TF-IDF 检索 + 关键词/章节加权 + 文档间段落查重
                       （检索升级为向量混合检索时只替换此模块，接口不变）
  qa.py                RAG 问答：系统提示含防注入；无 LLM 时离线摘录式回答
  review.py            预审：规则引擎（8 类必需章节）+ 可选千问 JSON（解析失败自动回退规则）
  experts.py           专家匹配：硬约束过滤（不可评审/在研≥5/同单位/回避）→
                       0.55·语义 + 0.30·关键词 + 0.15·学科 − 负载惩罚；查重分级 ≥0.55 高 / 0.30–0.55 关注
  trends.py            文献趋势：相关性筛选 + 年度统计 + 规则/千问摘要
  llm.py               OpenAI 兼容客户端（DashScope/内网 vLLM/SGLang/Ollama）；已兼容 Qwen3 思考模式
  schemas.py + ingest.py   外部数据接入契约与推送写入（幂等去重）
  auth.py               账号密码认证（PBKDF2）+ 会话（SQLite）+ 四角色
  seed.py              演示数据种子（标记存 meta 表，与库同生命周期；旧 .seeded_* 文件自动迁移）
  demo_proposals.py    10 份虚构演示本子（内置相似段落/同单位/负载满等演示设计）
frontend/src/
  pages/               Login(动态地形背景) / Welcome(登录后工作台) / Chat / Trend(3D) / Match(查重+专家匹配) / Review(预审) / Library / Admin(用户管理)
  AppContext.tsx       全局状态；api.ts 客户端 + SSE 解析；motion.ts 统一动效；charts/ ECharts GL
  styles.css           全局尺度（正文 15px/控件 40px/侧栏 264）、登录页地形/网格/纸纹关键帧、状态动效类；
                       动效只用 transform 入场，prefers-reduced-motion 全关；≤680px 抽屉导航与 skip link
```

## 数据事实

- 库：`data/app.db`；上传原件：`data/uploads/`；两者均在 `.gitignore`。
- 当前默认数据 = **10 份虚构演示本子**（`rag/demo_proposals.py`，source='demo'，界面可“移除演示本子”）+ 42 篇合成文献 + 12 位合成专家（均 `is_sample=1`，可一键移除）；真实申报书默认不入库（`SEED_SAMPLE_DOC=0`）。
- 演示本子内置演示设计：P01/P02 同域含相似段落（查重演示）、P02/P07 同申报单位（同单位回避演示）、专家 K 负载满 / L 不可评审 / D 回避单位（排除演示）。
- 重新播种演示数据：清 `meta` 表中 `seeded_papers` / `seeded_doc` / `seeded_experts` 对应键。
- 外部真实数据入口：CSV 导入（界面）或 `POST /api/ingest/experts|papers`（JSON 推送，幂等）；契约自查 `GET /api/ingest/schema`。项目/诚信记录/政策版本 schema 已预留但**无存储**，勿提前建表。

## 不能破坏的约束（业务红线）

1. **AI 不打分、不排名、不给立项/处罚结论**；预审/查重/匹配输出必须带免责声明，查重必须提示"相似≠抄袭、需人工复核"。
2. **专家匹配不使用性别、年龄等敏感属性**；回避/负载约束过滤必须在语义排序之前。
3. **数据不出内网**：默认只监听 `127.0.0.1`；已内置账号密码登录与四角色（`rag/auth.py`；本机演示密码 `yanxin2026`，对外需 `SEED_DEMO_USERS`+`DEMO_USER_PASSWORD`），生产接 SSO 前不应对外网开放 `HOST=0.0.0.0`。**LLM 公网端点默认被代码阻止**（回环/内网/内网域名才放行），要用公网 DashScope 必须 `ALLOW_EXTERNAL_LLM=1` 显式授权；登录失败限速 5 次/300s。
4. **隐私**：`3.科研课题申请书（终稿）.docx` 与 `交付材料/01-软件著作权/screenshots/` 含真实个人信息，已在 `.gitignore` 排除——**勿提交、勿解除忽略、勿在回复中复述其中的个人数据**。
5. 评审材料不得用于模型训练（未获书面授权前）。

## 已知边界（勿误报为 bug）

- 检索是 TF-IDF，不是向量检索（升级路线已定，见实施方案 §5.2）。
- 无 OCR（扫描件 PDF 会提示）；Uvicorn 为单进程开发模式。
- 专家同单位回避是**精确字符串匹配**，接真实专家库前需做单位名归一（已知待办）。
- 申报单位/负责人未识别时专家匹配会**明确提示回避约束未生效**（不误报“未发现冲突”）；预审风险环是纯分类色，无评分刻度。
- `GET /api/experts` 限 reviewer/manager/admin（最小权限）；DOCX 含 `<!DOCTYPE>/<!ENTITY>` 直接拒绝（实体防护）；PDF 默认只解析前 2000 页；Qwen3 思考开关 `LLM_ENABLE_THINKING`（留空不发/0 关/1 开）；HTTPS 部署设 `COOKIE_SECURE=1`。
- 上传大小限制由 `/api/health` 的 `upload_limit_mb` 下发，前端同步展示；上传走 XHR 以显示真实进度。

## 改动与提交约定

- 后端改动 → 跑 `pytest`；前端改动 → 跑 `npm run build`（含 tsc 类型检查）。
- Conventional Commits，中文描述（`fix:` / `feat:` / `refactor:` / `init:`）。
- 文案基调（2026-10-24 定稿）：标题/副标题/空态/引导语用勘验阅卷意象（四字格、对仗，如"以诚信为尺，勘每一卷申报"）；按钮、表头、状态词与免责声明保持直白，不修辞。
- 文档五处需同步：`README.md`（使用与 API）、`实施方案-RAG垂类模型与智能问答.md`（§8.2 已落地清单）、`DESIGN.md`（设计 token、组件、动效与无障碍契约）、`SECURITY.md`（安全行为描述与基线 commit，改认证/权限/防护/环境变量时必更）、`交付材料/`（若涉及软著功能描述与源程序清单——**注意源程序清单当前与代码有漂移，提交软著前需重新生成**）。
