# 研信智评 · 科研诚信 RAG 智能评审助手（React + FastAPI）

面向江苏省自然资源科研管理场景的本地可运行原型：上传本子/政策/文献，做**带原文引用的问答**、**本子预审**和**多年文献趋势分析**。

- 前端：React 19 + TypeScript + Vite + ECharts / ECharts GL（3D 趋势图）
- 后端：FastAPI + Uvicorn + Pydantic（OpenAPI 文档 `/docs`）
- RAG：DOCX/PDF 解析 + 结构分块 + TF-IDF 检索 + 千问/离线双模式
- 部署：不侵入现有科技管理系统，独立工作台，内网可运行
- 安全：威胁模型、认证/授权/出口门禁/文件防护与部署检查清单见 `SECURITY.md`

---

## 1. 已实现功能

| 模块 | 能力 |
|---|---|
| 智能问答 | 上传文档后多轮提问；SSE 流式输出；句级 `[1][2]` 引用；右侧证据面板可回看原文、页码/章节、相似度 |
| 文档上传 | DOCX / PDF / TXT / MD；自动识别标题、年份、资料类型；解析、分块、建索引；真实上传进度（百分比+解析阶段提示）；支持删除 |
| 本子预审 | 形式完整性、科研诚信与规范性、语义查重、政策合规四类检查；风险等级环；建议核实问题；导出 Markdown / 打印 PDF |
| 查重匹配 | 对应考核指标“智能查重、专家匹配一体化工具”：同一份本子同时做段落级查重和专家画像匹配，给出证据、回避/负载约束、可解释排序，可导出结果 |
| 历史沿革 | 任意主题的多年文献趋势：年度发文量、主题热度、年度高频主题、代表性文献、规则/千问趋势研判 |
| 3D 趋势视图 | ECharts GL 3D 柱状图 + 主题×年份×文献数 3D 矩阵，自动旋转、可拖拽缩放；支持一键切 2D；WebGL 不可用时自动降级 |
| 登录与品牌 | 地形等高线动态背景（描边生长、虚线流动、双层视差、扫描带、纸纹颗粒）、2×2 核心能力卡、四角色演示卡一键填充；纯 SVG+CSS，`prefers-reduced-motion` 下全关 |
| 统一动效 | 路由页面过渡、导航滑块、消息/证据入场、KPI 数值滚动与更新闪光、3D/2D 交叉淡入、预审步骤进度与风险环、表格行增删退出、匹配空↔结果切换、上传完成对勾、Toast；换主题时 KPI/摘要/年度主题/文献/图表联动；支持减少动态效果 |
| 文献数据 | CSV 批量导入；内置 42 篇**合成演示文献**，可一键移除；真实文献导入后趋势自动使用真实数据 |
| 专家库 | 专家 CSV 导入；内置 12 位**合成演示专家**；不包含性别/年龄；按可用性、在研负载、回避关系过滤 |
| 模型切换 | DashScope 千问 / 内网 vLLM、SGLang、Ollama 的 OpenAI 兼容接口；无配置自动降级 |
| 数据范围 | 文档级范围选择；问答只检索所选文档；删除文档同步删除索引 |

> “历史沿革”按当前需求实现为**多年论文趋势分析**，主题不限定；政策版本沿革、项目/成果谱系在实施方案中保留为后续扩展。

---

## 2. 登录与角色

系统内置账号密码登录（原型方案）与四类角色；正式部署时替换为厅统一身份认证（SSO/OIDC），角色模型沿用。

**演示账号**（首次启动自动创建，密码统一 `yanxin2026`，仅限内网验证）：

| 账号 | 角色 | 权限 |
|---|---|---|
| `admin` | 管理员 | 全部功能 + 用户管理（`/admin` 创建账号） |
| `manager` | 科研管理 | 上传/删除文档、导入文献与专家、移除演示数据、外部推送 `/api/ingest/*` |
| `reviewer` | 评审专家 | 问答、预审、查重匹配、文献趋势；文档库只读 |
| `viewer` | 访客 | 问答与文献趋势（只读演示） |

- 演示账号**仅在本机监听（127.0.0.1）时自动创建**；对外监听默认不创建，确需演示设 `SEED_DEMO_USERS=1` 并用 `DEMO_USER_PASSWORD` 指定强密码（留空则生成随机密码打印到日志）；
- 登录后可在“用户管理”页自助改密（`POST /api/auth/password`，改密后所有旧会话失效）；
- 登录失败限速：同一用户名+IP 连续失败 5 次（窗口 300 秒）返回 429，可配 `LOGIN_MAX_FAILURES` / `LOGIN_WINDOW_SECONDS`；
- **数据不出内网（代码级强制）**：LLM 端点仅放行回环/内网/内网域名，公网 DashScope/OpenAI 默认阻止（健康检查显示“公网出口已阻止”），确需使用须显式设 `ALLOW_EXTERNAL_LLM=1`；
- 专家库读取（`GET /api/experts`）限评审专家/科研管理/管理员——访客不可见回避关系与负载画像；
- Qwen3 思考模式：`LLM_ENABLE_THINKING` 留空不发送（兼容旧服务）、设 0 显式关闭（避免只返回思考内容）、设 1 开启；
- 解析边界：单文件 30MB、DOCX 解压总量 120MB、PDF 默认只解析前 2000 页（`MAX_PDF_PAGES` 可调，0 为不限）；HTTPS 部署设 `COOKIE_SECURE=1` 强制会话 Cookie 加密传输；

- 会话：登录后签发 HttpOnly Cookie（7 天有效）；任何接口返回 401 时前端自动回到登录页。
- 权限双层执行：前端按角色隐藏按钮，后端中间件统一拦截 `/api/*` 并对写操作按角色返回 403。
- 密码以 PBKDF2 加盐哈希存储；`admin` 可在“用户管理”页创建正式账号。

---

## 3. 快速启动

环境要求：Python 3.10+；PDF 解析需要 `pdftotext`（macOS `brew install poppler`，Ubuntu `apt install poppler-utils`）。如果 `frontend/dist` 已存在，运行时不依赖 Node；重新构建前端需要 Node 20+。

```bash
cd "课题申报：科研诚信驱动的自然资源科研全周期智慧治理与大模型协同关键技术研究"

cp .env.example .env        # 可选：填入千问配置
./run.sh                    # 自动选择可用解释器，缺依赖时自动安装
```

打开 <http://127.0.0.1:8010>；接口文档 <http://127.0.0.1:8010/docs>。

依赖由 `run.sh` 在所选解释器上自动安装。如果本机没有可用环境（例如 Homebrew Python 受 PEP 668 限制），先 `python3 -m venv .venv` 再运行 `./run.sh`——它会优先使用项目 `.venv`。

`run.sh` 做的事情：

1. 自动选择解释器（显式 `PYTHON` > 项目 `.venv` > conda/Anaconda 已知路径 > 系统 `python3`，取首个能导入依赖者）并检查依赖；
2. 如果 `frontend/dist` 不存在，执行 `cd frontend && npm install && npm run build`；
3. 用 Uvicorn 启动 FastAPI，并托管 React 构建产物。

首次启动会自动：

1. 创建 `data/app.db` 与 `data/uploads/`；
2. 演示账号种子（仅本机监听时创建，见“登录与角色”）；课题申请书含个人信息，**默认不再自动入库**——需要示例本子时在 `.env` 显式设 `SEED_SAMPLE_DOC=1` 并把文件放入项目根目录后重启；
3. 写入 42 篇合成演示文献，用于验证趋势功能；
4. 写入 12 位合成演示专家（`is_sample=1`），用于验证专家匹配。

不需要演示数据时，在 `.env` 中设置 `SEED_SAMPLE_DOC=0`、`SEED_DEMO_PAPERS=0`，或在界面中删除示例本子、点击“移除演示文献”；演示专家无环境变量开关、首次启动会无条件写入，可在“查重匹配”页点击“移除演示专家”一键清理。

---

## 4. 前后端开发模式

后端：

```bash
python3 -m uvicorn app:app --reload --host 127.0.0.1 --port 8010
```

前端（Vite 开发服务器，`/api` 自动代理到 8010）：

```bash
cd frontend
npm install
npm run dev
```

打开 <http://127.0.0.1:5173>。

生产构建：

```bash
cd frontend
npm run build
# 产物在 frontend/dist，由 FastAPI 自动托管
```

---

## 5. 接入千问

### 方式 A：DashScope（公网/政务云 MaaS）

```bash
QWEN_API_KEY=sk-xxxxxxxx
# 默认即 DashScope + qwen-plus，可不填下面两项
# QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
# QWEN_MODEL=qwen-plus
```

### 方式 B：内网私有化 Qwen（推荐用于真实评审材料）

以 vLLM / SGLang 部署 OpenAI 兼容服务：

```bash
QWEN_BASE_URL=http://10.0.0.10:8000/v1
QWEN_API_KEY=EMPTY
QWEN_MODEL=Qwen3-32B
```

Ollama 示例：

```bash
QWEN_BASE_URL=http://127.0.0.1:11434/v1
QWEN_API_KEY=ollama
QWEN_MODEL=qwen2.5:7b
```

重启后顶栏模式芯片显示“千问 · 模型名”；未配置时显示“离线演示”。

**注意**：如果使用公网 DashScope，上传的评审材料会离开内网；真实评审场景请使用内网 Qwen 或完成数据合规审批。

---

## 6. 文档与文献数据

### 文档上传

- 支持：`.docx`、`.pdf`、`.txt`、`.md`；单文件 ≤ 30MB。
- 扫描版 PDF 暂未启用 OCR：`pdftotext` 提取不到文本时会提示，需先 OCR 或换可复制文本的 PDF。
- 资料类型：本子/申报书、政策/管理办法、文献/论文、其他；也可自动判断。
- 上传“文献”类型时，会同步写入趋势分析的文献库。

### 专家 CSV

“查重匹配 → 专家库 → 下载 CSV 模板”，列：

```csv
姓名,单位,职称,学科,研究方向,代表性成果,回避单位,回避人员,在研项目数,是否可评审
示例专家A,示例大学A,教授,科研管理,科研诚信;科技政策,主持科研诚信相关课题（示例）,示例大学B,,1,是
```

- 研究方向、回避单位、回避人员可用 `;`、`,`、`、` 分隔；
- 在研项目数达到 5 视为负载已满；
- 不采集、不使用性别、年龄等敏感属性；
- 重复导入相同专家（姓名+单位一致）自动跳过。

### 文献 CSV

“文档库 → 文献数据 → 下载 CSV 模板”，列名支持中英文：

```csv
标题,年份,作者,期刊,摘要,关键词
面向自然资源科研诚信的风险预警研究,2024,张三,示例期刊,摘要内容,科研诚信;风险预警
```

也支持 `title,year,authors,venue,abstract,keywords`。关键词用 `;`、`,`、`、` 分隔均可。重复导入相同文献（标题+年份一致）会自动跳过，接口返回 `count`（新增）与 `skipped`（跳过）。

### 外部系统推送（预留接口）

当前文献/专家/示例本子均为**演示数据**。真实数据接入已预留三种路径：

| 路径 | 状态 | 说明 |
|---|---|---|
| CSV 导入 | 已有 | 界面人工批量导入（本文档上文） |
| JSON 推送 `/api/ingest/*` | 已实现 | 外部系统直接推送，幂等去重，可重放 |
| 只读 API 拉取 | 规划中 | 对接省厅科技管理系统（实施方案 §7 数据外挂） |

- `POST /api/ingest/experts`：body `{"experts": [{name, institution, ..., research_areas: [], workload, available}]}`，同名同单位跳过；
- `POST /api/ingest/papers`：body `{"papers": [{title, year, authors, venue, abstract, keywords: []}]}`，同题同年跳过；
- `GET /api/ingest/schema`：自描述契约，含字段 JSON Schema、鉴权方式与预留实体，供对接方自查；
- 鉴权：`.env` 设置 `INGEST_TOKEN` 后，推送接口要求请求头 `X-INGEST-Token` 匹配；未设置时本机演示不鉴权；
- **预留未启用**：项目/课题（ProjectRecord）、诚信记录（IntegrityRecord）、政策版本（PolicyMeta）的结构已在 `rag/schemas.py` 冻结并通过 `/api/ingest/schema` 公开，存储与接收端点待接入真实数据源后启用。

### 演示数据说明

全部演示数据均为**合成内容**，不含任何真实或虚构人名，仅用于功能验证：

- **10 份虚构演示本子**：覆盖耕地监测、地质灾害（InSAR）、地面沉降、矿山修复、海岸带、国土空间规划监测、不动产数据治理、湖泊水质反演、森林碳汇等自然资源典型方向；其中两份同域本子含相似段落（用于演示语义查重），两份申报单位相同（用于演示同单位回避）；文档库中带“演示”徽标，可点击“移除演示本子”整体移除；
- **42 篇合成演示文献**：验证趋势图、主题统计与交互，导入真实 CSV 后可“移除演示文献”；
- **12 位合成演示专家**：覆盖上述本子的领域方向，内置回避单位、负载满、不可评审等约束样例，可“移除演示专家”；
- 真实申报书**默认不入库**（`SEED_SAMPLE_DOC=0`）。

---

## 7. 当前实现方式

### 问答链路

1. 解析：DOCX 用 Word XML（含脚注/尾注）；PDF 用 `pdftotext`；文本按段落/章节切分。
2. 分块：按章节标题、段落、句边界切分，块大小约 700 字，重叠 100 字并对齐到句边界；保留页码/章节。
3. 检索：当前使用**字符 n-gram TF-IDF + 关键词/章节命中加权**，零依赖、可离线运行；返回 Top K 片段。
4. 生成：配置千问时，将编号资料 + 问题 + 最近对话发给 Qwen；未配置时使用摘录式回答。
5. 引用：回答中的 `[n]` 与检索片段一一对应；前端右侧面板展示原文和相似度。

> 首期使用 TF-IDF 是为了让原型在没有任何向量模型/GPU 的环境下也能跑通。生产版按实施方案升级为 Qwen3-Embedding + Milvus 混合检索 + Qwen3-Reranker，并在同一接口层替换。

### 本子预审

- 规则检查：章节完整性、科研诚信/数据安全/伦理/知识产权表述、参考文献、文档长度。
- 语义查重：对已入库文档做段落级 TF-IDF 相似度比对，给出相似段落和相似度；相似 ≠ 抄袭，必须人工判断。
- 政策合规：上传政策文件后，检索相关条款作为提示；未上传政策库时明确提示“仅做通用检查”。
- 千问配置后，由模型生成结构化 JSON 预审意见；解析失败自动回退到规则预审。
- 不输出总分、排名、立项结论；报告页脚带免责声明。

### 历史沿革 / 文献趋势

1. 用主题词在文献库中做相关性筛选（标题/关键词/摘要命中 + TF-IDF）。
2. 按年份统计发文量和主题词出现次数。
3. 生成 3D 年度发文量柱状图、3D 主题热度矩阵；可切 2D 折线/柱状图。
4. 生成主题热度、年度高频主题、代表性文献和趋势摘要；配置千问后由模型生成 3–5 条趋势研判。

### 动效规范

- 字体三层分工：标题/品牌用宋体，文案（欢迎语、回答、研判、证据原文、免责声明）用楷体（多平台回退），界面控件/数据用黑体；文案块统一 `letter-spacing .02em`、行高 1.8+；
- 统一缓动 `cubic-bezier(.22, 1, .36, 1)`；页面切换 340ms，微交互 180–260ms；
- 入场位移不超过 10px，hover 抬升 1–2px，避免大幅缩放/旋转；
- 导航使用共享布局滑块；3D/2D 切换交叉淡入，避免图表硬切；
- 换主题时 KPI 数值滚动/字符串淡入、趋势摘要与年度主题重新入场、文献卡片错峰、图表数据过渡；
- 3D 自动旋转速度 3.2–3.6，交互后暂停 4s；
- 侧边栏收起/展开用 rAF 逐帧补间（310ms 缓出；部分嵌入式 webview 的 CSS 宽度过渡会冻结布局，故不用 CSS transition）；图表在容器尺寸变化时以 350ms 动画形变（ECharts resize animation）；
- 分析请求做 280ms 防抖：快速响应不闪 loading 遮罩，慢请求才显示“分析中…”；按钮不使用持续旋转图标；
- 每次分析 KPI 四张卡整体重新入场，年份跨度等不变值也有反馈；
- 支持 `prefers-reduced-motion`：关闭自动旋转、CSS 动画与 Framer 位移动画；
- 登录页动态地形：等高线 `pathLength` 描边生长 + 虚线流动 + 远/近双层漂移（指针视差 `--px/--py`）+ 扫描带 + 纸纹颗粒；入场只用 transform，保证任何一帧内容都可见；
- 状态变化动效（Framer `AnimatePresence`）：表格行删除退出、匹配面板空↔结果切换、上传弹窗文件芯片切换、KPI 数值变化 900ms 闪光；
- 全局尺度：正文 15px、表格 13.5px、标签 12px、控件高 40px、侧栏 264px（折叠 84px）、主区留白 32–48px；≤1400px 表格自动紧凑；
- 路由级 code splitting，3D 图表按需加载。

### 交互边界

- 侧边栏可收起为图标栏（状态记忆于本地，窄屏默认收起）；≤680px 改为抽屉导航（遮罩、焦点陷阱、ESC 关闭、路由切换自动收起）；
- 无障碍：全局「跳到主要内容」skip link、路由切换焦点移交主区、图表 `role="img"` 文本摘要；焦点环与次级文字对比度满足 WCAG AA；
- 侧边栏、顶栏、按钮、筛选、KPI、图表工具栏、表格操作不可选中/拖动；
- 正文（问答、证据、摘要、论文信息、表格内容、预审报告）保留选中与复制；
- 导航链接无下划线，禁用原生链接拖拽；
- 固定滚动条槽（`scrollbar-gutter`），顶栏上传按钮不随页面高度/滚动条变化而左右移动；
- 3D 图表仍支持拖拽旋转；滚轮不再缩放图表，而是正常滚动页面。

### 3D 图表实现

- `echarts` 5.x + `echarts-gl` 2.x；
- `bar3D` 年度柱状图：自动旋转、拖拽旋转、光照与阴影；**滚轮缩放已关闭，滚轮用于页面滚动**；
- `bar3D` 主题矩阵：主题 × 年份 × 文献数；
- `postEffect` 开启 Bloom/SSAO，增强立体层次；
- 顶部“3D / 2D”切换；浏览器无 WebGL 时自动使用 2D 并给出提示；
- KPI 数字滚动、卡片入场、报告风险环等使用 Framer Motion / CSS 动画。

---

## 8. 技术栈

### 前端

| 依赖 | 用途 |
|---|---|
| React 19 + TypeScript | 组件化 UI |
| Vite 6 | 开发服务器与生产构建 |
| React Router 6 | 页面路由（`/chat`、`/trend`、`/match`、`/review`、`/library`） |
| ECharts 5.6 + ECharts GL 2.0 | 2D/3D 图表 |
| Framer Motion 12 | 页面、卡片、风险环动画 |
| Lucide React | 图标 |

### 后端

| 依赖 | 用途 |
|---|---|
| FastAPI + Uvicorn | API、SSE 流式、OpenAPI 文档 |
| Pydantic | 请求模型与校验 |
| python-multipart | 文件上传 |
| scikit-learn + numpy | TF-IDF 检索、查重、趋势统计 |
| jieba | 中文分词与关键词 |
| python-dotenv | `.env` 配置 |
| requests | 调用千问/OpenAI 兼容接口 |

系统依赖：`pdftotext`（Poppler）。数据库：SQLite（标准库 `sqlite3`）；文件：本地 `data/uploads`。

---

## 9. 目录结构

```
.
├── app.py                  # FastAPI 入口、API、React 静态托管
├── rag/
│   ├── config.py           # 路径、模型、分块参数
│   ├── db.py               # SQLite 表与读写
│   ├── schemas.py          # 外部数据接入契约（含预留实体）
│   ├── ingest.py           # 系统间推送数据写入（幂等）
│   ├── parsers.py          # DOCX/PDF/TXT/CSV 解析
│   ├── text.py             # 清洗、分块、关键词
│   ├── retrieval.py        # TF-IDF 检索与查重
│   ├── llm.py              # Qwen / OpenAI 兼容客户端
│   ├── qa.py               # RAG 问答与离线摘录
│   ├── review.py           # 本子预审
│   ├── trends.py           # 文献趋势
│   ├── experts.py          # 专家库、回避/负载约束、专家匹配
│   └── seed.py             # 示例本子 + 演示文献/专家
├── frontend/
│   ├── src/
│   │   ├── pages/          # Login / Chat / Trend / Match / Review / Library / Admin
│   │   ├── components/     # 布局、上传、Markdown、KPI、EChart
│   │   ├── charts/         # ECharts GL 3D / 2D 图表
│   │   ├── App.tsx
│   │   ├── AppContext.tsx
│   │   ├── api.ts
│   │   └── styles.css
│   ├── package.json
│   └── vite.config.ts
├── data/                   # 运行时生成：SQLite + 上传文件
├── tests/                  # pytest 健壮性回归（50 项）
├── requirements.txt
├── requirements-dev.txt
├── .env.example
└── run.sh
```

---

## 10. API 摘要

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 模型状态、文档/文献统计（免登录） |
| POST | `/api/auth/login` | 登录，签发会话 Cookie（免登录） |
| POST | `/api/auth/logout` | 退出登录 |
| GET | `/api/auth/me` | 当前用户与角色 |
| GET | `/api/auth/users` | 用户列表（仅管理员） |
| POST | `/api/auth/users` | 创建用户（仅管理员） |
| POST | `/api/auth/password` | 自助改密（改密后旧会话全失效） |
| GET | `/api/documents` | 文档列表 |
| POST | `/api/documents` | 上传文档（multipart：file、kind、year、title） |
| DELETE | `/api/documents/<id>` | 删除文档与索引 |
| DELETE | `/api/documents/sample` | 移除演示本子 |
| POST | `/api/chat` | 非流式问答 |
| POST | `/api/chat/stream` | SSE 流式问答 |
| POST | `/api/review` | 本子预审（doc_id） |
| POST | `/api/trends` | 文献趋势（query、start_year、end_year） |
| GET | `/api/papers` | 文献列表 |
| POST | `/api/papers/import` | 文献 CSV 导入 |
| DELETE | `/api/papers/sample` | 移除演示文献 |
| GET | `/api/experts` | 专家库列表 |
| POST | `/api/experts/import` | 专家 CSV 导入 |
| DELETE | `/api/experts/sample` | 移除演示专家 |
| POST | `/api/tool/check` | 查重 + 专家匹配一体化检查 |
| POST | `/api/ingest/experts` | 外部系统推送专家（JSON，幂等去重） |
| POST | `/api/ingest/papers` | 外部系统推送文献（JSON，幂等去重） |
| GET | `/api/ingest/schema` | 数据接入契约：字段、鉴权、预留实体 |

交互式文档：<http://127.0.0.1:8010/docs>。

---

## 11. 已做验证

- 示例本子 DOCX：解析 → 分块 → 问答 → 引用 → 预审报告全链路通过。
- PDF：生成中文测试 PDF，`pdftotext` 解析、页码引用、问答通过。
- 查重：同一 DOCX 上传两次，预审报告识别最高段落相似度 0.997，风险等级“高”。
- CSV：导入 4 篇测试文献，趋势统计、主题曲线、代表性文献正确更新。
- FastAPI：上传、CSV 导入、查重、预审、SSE 流式接口通过；`/docs` 可访问。
- React：Playwright 1440px 桌面视口检查问答、趋势、预审、文档库；WebGL 可用时渲染 2 个 3D canvas，2D 切换正常，无控制台错误。
- 千问接入：用本地 OpenAI 兼容 mock 验证非流式、SSE 流式、预审 JSON、趋势摘要四条路径；真实千问效果需配置实际模型后验证。
- 动效与可访问性：验证导航滑块、页面过渡、3D/2D 交叉淡入、预审步骤进度、聊天跨页持久化；`prefers-reduced-motion` 下 3D 仍可用且无控制台错误。
- 查重匹配：同文档重复上传识别相似度 0.997；专家库 12 人，按可用/负载/回避过滤后推荐 8 人，排除 2 人；专家 CSV 导入通过。
- 交付材料：`交付材料/` 下已提供考核指标对照表、软著说明书/源代码说明/申请信息表、本地验证报告初稿、研究报告初稿、论文提纲。
- 登录与角色：未登录 401、viewer 删除 403、manager 正常 200、admin 用户管理页创建账号；浏览器实测三角色界面门控与登录/退出流转。
- 健壮性回归：pytest 50 项通过，覆盖登录哈希/会话/端点、空库趋势、SPA 路径穿越、错误脱敏、top_k 边界、WAL、超长截断、DOCX 脚注解析、文献/专家导入去重、孤儿分块过滤、种子标记入库与旧标记迁移、分块失败清理上传文件、类型内容嗅探、接入推送幂等、接入令牌条件鉴权、接入契约完整性。
- 登录页与全站动效：headless Chrome 截图 + DOM 探针验证地形背景、状态动效与 `prefers-reduced-motion` 降级，无控制台错误。
- 文案打磨：全站标题/空态/引导语改写后逐页截图核对，无换行孤字与溢出。

### 健壮性与测试

安全设计（认证与会话、授权矩阵、LLM 出口门禁、文件防护、漏洞披露）的单一事实源是 `SECURITY.md`；本节只列回归测试覆盖。

回归测试（无需前端构建，纯后端）：

```bash
python3 -m pytest tests/ -q          # 50 passed
```

`tests/test_robustness.py` 覆盖的加固点：

- **空文献库趋势**：`papers` 为空时返回空趋势而非在 TF-IDF 处崩溃。
- **SPA 路径穿越**：`/../` 等越界路径一律 404，绝不返回 `frontend/dist` 之外的文件。
- **错误信息不外泄**：未捕获异常统一返回“服务器内部错误”，响应体不含内部细节（如密码、堆栈）。
- **`top_k` 边界**：`ToolCheckRequest.top_k` 限定 `1–20`，越界返回 422。
- **SQLite 并发**：连接启用 `WAL` + `busy_timeout=5000`，缓解读写并发锁冲突。
- **超长文档截断**：解析后统一执行 `MAX_CONTENT_CHARS`（默认 6 万字）截断并给出 warning，避免超大文件撑爆分块/索引（已用 8 万字 TXT 端到端验证：截断至 6 万字、86 块、提示“文档过长”）。

前端健壮性（经 `tsc --noEmit` + 构建 + 跨路由冒烟验证，无控制台错误）：

- **请求超时**：`api.ts` 的 `request()` 加 `AbortController`（默认 60s），后端卡死时 UI 不再永久挂起，提示“请求超时”；`fetch` 网络异常统一提示“网络错误，无法连接到服务器”。SSE 流式接口不设硬超时（长连接），仅对建连失败做友好提示。
- **ErrorBoundary**：路由外层包裹 `components/ErrorBoundary.tsx`，单页渲染崩溃时显示兜底卡片（重试 / 返回问答），不再整站白屏；按 `pathname` 自动重置。

---

## 12. 当前边界与下一步

**边界**

- 单机演示版：默认只监听 `127.0.0.1`；内网其他机器访问设 `HOST=0.0.0.0` 前，应先配置强口令（`SEED_DEMO_USERS` + `DEMO_USER_PASSWORD`）与防火墙。已有账号密码登录与四角色权限矩阵，SSO/OIDC 待接。
- 当前使用 Uvicorn 开发模式；生产部署请配置多 worker、Nginx、HTTPS、日志与进程守护。
- 无 OCR；扫描件需先转文本。
- 当前检索为 TF-IDF，不是向量检索；语义召回能力有限。
- 3D 图表依赖 WebGL；无 WebGL 自动降级 2D。
- 已做路由级 code splitting：首屏 JS 约 423KB；3D 趋势页按需加载约 1.66MB（ECharts GL 占比较大）。
- 预审为规则 + 可选千问，不替代专家评审；查重结果需人工复核。
- 专家匹配目前是原型：示例专家为合成数据；真实专家库、回避关系和负载数据需接入现有系统或 CSV 授权导入。
- 正式研究报告、省厅试点验证报告、论文、软著尚未提交；`交付材料/` 中是初稿/模板，不能当作已验收成果。
- 演示文献为合成数据，不能用于真实研究结论。

**建议下一步**

1. 配置真实 Qwen（内网优先），用 20–30 份真实本子做评测集，校准检索阈值和预审口径。
2. 替换为 Qwen3-Embedding + Milvus 混合检索 + Qwen3-Reranker。
3. 导入真实政策库（含生效/失效日期），启用条款级合规审查。
4. 接入现有科技管理系统：只读 API/视图、SSO、预审任务回写。
5. 生产化：OCR、权限、审计、加密、等保、模型服务监控。
