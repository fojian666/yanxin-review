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
cd frontend && npm run test:e2e:types && npm run test:e2e      # 62 项浏览器回归（首次需安装 Chromium）
python3 -m pytest tests/ -q                                 # 回归测试（147 个测试函数，参数化展开 160 项，默认不联网）
python3 -m tools.eval_retrieval                             # TF-IDF 与向量召回对比（需嵌入后端可用）
python3 -m tools.doc_check                                  # 文档漂移检查（每轮改完必跑）
python3 -m rag.corpus                                       # 导入公开政策语料（幂等；--force 重建）
python3 tools/fetch_corpus.py --check                       # 离线校验政策快照与溯源清单 sha256
```

PDF 解析依赖 `pdftotext`（poppler）。`frontend/dist` 已存在时运行不需要 Node。

登录演示账号：`admin` / `manager` / `reviewer` / `viewer`。本机监听时密码统一 `yanxin2026`；**对外监听默认不创建演示账号**，需显式 `SEED_DEMO_USERS=1` + `DEMO_USER_PASSWORD`。支持自助改密。

## 模块地图

```
app.py                 FastAPI：31 条 API 路由（含认证 6 条、卷宗 11 条、数据接入 3 条）、SSE 流式问答、文档读取、上传、SPA 托管（路径穿越有防护）
rag/
  config.py            所有环境变量与默认值（分块 700/100、TOP_K 7、30MB 上限、LLM_PROVIDER 预设、INGEST_TOKEN）
  db.py                SQLite（WAL）：documents/chunks/papers/experts/dossiers/dossier_documents/meta；导入去重 insert_*_if_new
  dossiers.py          课题卷宗材料角色、计划类型/阶段体检、版本与人工确认规则
  parsers.py           DOCX（含脚注/尾注）/PDF（pdftotext，页码）/TXT/CSV 解析；60k 字截断保护
  text.py              清洗、章节识别、结构分块、jieba 关键词（领域词表已注入）
  retrieval.py         检索：TF-IDF（字符 n-gram）为基线与回落，向量可用时接管打分；
                       keyword/章节加权与文档间段落查重（查重固定走 TF-IDF，理由见下）
  embeddings.py        嵌入后端 local/api/none（auto 逐级降级，本地加载失败改走 API）；公网端点受
                       ALLOW_EXTERNAL_EMBED 门禁 + 拒绝跟随重定向；向量按「后端|端点|模型 + 单条文本」
                       哈希缓存（新增文档不重算整库），查询向量不落盘
  qa.py                RAG 问答：系统提示含防注入；无 LLM 时离线摘录式回答
  review.py            预审：规则引擎（8 类必需章节）+ 可选千问 JSON（解析失败自动回退规则）
  experts.py           专家匹配：硬约束过滤（不可评审/在研≥5/同单位/回避）→
                       0.55·语义 + 0.30·关键词 + 0.15·学科 − 负载惩罚；查重分级 ≥0.55 高 / 0.30–0.55 关注
  trends.py            文献趋势：相关性筛选 + 年度统计 + 规则/千问摘要
  llm.py               OpenAI 兼容客户端（DashScope/DeepSeek/内网 vLLM/SGLang/Ollama）；
                       思考参数按方言发送（Qwen 的 enable_thinking / DeepSeek 的 thinking.type）
  schemas.py + ingest.py   外部数据接入契约与推送写入（幂等去重）
  auth.py               账号密码认证（PBKDF2）+ 会话（SQLite）+ 四角色
  corpus.py             公开政策语料入库（corpus/ → documents kind=policy/source=public，幂等，--force 重建）
  seed.py              演示数据种子（标记存 meta 表，与库同生命周期；旧 .seeded_* 文件自动迁移）
  demo_proposals.py    10 份虚构演示本子（内置相似段落/同单位/负载满等演示设计）
tools/
  fetch_corpus.py      抓取公开公文 → corpus/policy/*.txt + corpus/sources.json（唯一联网环节，--check 离线校验）
  eval_retrieval.py    14 个政策问题的 TF-IDF vs 向量召回对比（命中@k / MRR，答案按原文关键句定位）
  doc_check.py         文档漂移检查：测试数/接口表/模块清单/环境变量/软著材料/过时表述，只读，退出码非 0 即有不一致
  soft_copyright.py    生成软著《源程序清单》并打印规模表（--check 只校验）——
                       **所有代码改完后最后跑**，否则清单又落后于刚改的文件
corpus/                随仓库交付的真实公文快照：sources.json（URL/许可/抓取时间/sha256）+ policy/*.txt
frontend/src/
  pages/               Login(动态地形背景) / Welcome(登录后工作台) / Chat / Trend(3D) / KnowledgeGraph / Match(查重+专家匹配) / Review(预审) / Library(文档中心) / Admin(用户管理)
  data/knowledge.ts    科研治理知识图谱：48 实体、100 关系、7 知识域、搜索与最短路径
  data/proposalWorkflow.ts  课题流程基线：指南、申请、评审、实施、验收、备案六个导航节点
  components/          DocumentDirectory(目录)、DocumentReader(书页正文)、EChart(关系图)
  AppContext.tsx       全局状态；api.ts 客户端 + SSE 解析；motion.ts 统一动效；charts/ ECharts GL
  styles.css           全局尺度（正文 15px/控件 40px/侧栏 264）、登录页地形/网格/纸纹关键帧、状态动效类；
                       动效只用 transform 入场，prefers-reduced-motion 全关；≤680px 抽屉导航与 skip link
```

## 数据事实

- 库：`data/app.db`；上传原件：`data/uploads/`；两者均在 `.gitignore`。
- 当前默认数据 = **10 份虚构演示本子**（`rag/demo_proposals.py`，source='demo'，界面可“移除演示本子”）+ 42 篇合成文献 + 12 位合成专家（均 `is_sample=1`，可一键移除）；真实申报书默认不入库（`SEED_SAMPLE_DOC=0`）。
- **真实政策语料**：`corpus/` 下两部政府公开公文（科技部等22部门《科研失信行为调查处理规则》国科发监〔2022〕221号、江苏省《科技计划项目信用管理办法》苏科技规〔2022〕3号），`python3 -m rag.corpus` 导入为 `kind='policy'`、`source='public'`，溯源信息存 `corpus/sources.json` 与 `documents.meta_json`。**它不是演示数据**：`./run.sh` 启动时自动导入一次（幂等、失败不阻断）；直接用 `uvicorn` 起服务时需手动跑 `rag.corpus`。
- 演示本子内置演示设计：P01/P02 同域含相似段落（查重演示）、P02/P07 同申报单位（同单位回避演示）、专家 K 负载满 / L 不可评审 / D 回避单位（排除演示）。
- 重新播种演示数据：清 `meta` 表中 `seeded_papers` / `seeded_doc` / `seeded_experts` 对应键。
- 外部真实数据入口：CSV 导入（界面）或 `POST /api/ingest/experts|papers`（JSON 推送，幂等）；契约自查 `GET /api/ingest/schema`。本地课题卷宗与材料归卷已实现；外部项目/诚信记录/政策版本 schema 仍为只读契约预留。

## 不能破坏的约束（业务红线）

1. **AI 不打分、不排名、不给立项/处罚结论**；预审/查重/匹配输出必须带免责声明，查重必须提示"相似≠抄袭、需人工复核"。
2. **专家匹配不使用性别、年龄等敏感属性**；回避/负载约束过滤必须在语义排序之前。
3. **数据不出内网**：默认只监听 `127.0.0.1`；已内置账号密码登录与四角色（`rag/auth.py`；本机演示密码 `yanxin2026`，对外需 `SEED_DEMO_USERS`+`DEMO_USER_PASSWORD`），生产接 SSO 前不应对外网开放 `HOST=0.0.0.0`。**LLM 公网端点默认被代码阻止**（回环/内网/内网域名才放行），要用公网 DashScope 必须 `ALLOW_EXTERNAL_LLM=1` 显式授权；登录失败限速 5 次/300s。**嵌入端点同一口径**：公网需 `ALLOW_EXTERNAL_EMBED=1`，且 `api` 后端会把待检索文本发出去——真实评审材料只用 `local`/内网端点。**两条出网面都拒绝跟随重定向**（307/308 会把原始 body 转到未校验地址），`auto` 嵌入降级到 API 前必须重跑门禁、不通过就退回纯 TF-IDF；改任何一处都要保住这条，用例已锁定。
4. **隐私**：本地 `*.docx` / `*.doc` 申报材料与 `交付材料/01-软件著作权/screenshots/` 可能含真实个人信息，已在 `.gitignore` 排除——**勿提交、勿解除忽略、勿在回复中复述其中的个人数据**。
5. 评审材料不得用于模型训练（未获书面授权前）。

## 已知边界（勿误报为 bug）

- 检索有向量后端，但**不是向量库**：矩阵在内存里做点积（几千条量级，numpy 比 HTTP 往返快），不需要 Milvus。未配置或端点在公网且未授权时自动退回纯 TF-IDF。
- 两种打分尺度不同，阈值必须分开：结果下限 `EMBED_MIN_SCORE=0.45`（向量）、政策引用 `0.58` / TF-IDF `0.08`；证据面板的相似度条也按后端分档。改任何一个前先跑 `tools/eval_retrieval.py`，并在真实本子上确认政策引用非空。
- **查重候选排除政策**：仅影响查重，问答和合规引用保留政策；候选截断前过滤，防止政策块挤占真正的重复本子。
- **查重不走向量**：字面重合查重才是对的，向量会把“主题相近但无重复”判成高相似。
- 单测默认 `EMBED_BACKEND=none`（`tests/conftest.py`），不要为了“测得更真实”去放开——单测不该发外部请求。
- 政策库只有两部公开公文。条款级比对只输出“可能相关条款 + 人工核对”，**不做版本时效判断**（`PolicyMeta` 的生效/失效/被替代字段已冻结、未建存储）。政策引用保留全角标点（`normalize_text` 用 NFC + 全角数字字母转半角，**不要改回 NFKC**，否则「（一）…；」会变「(一)…;」）。
- **无模型不是故障**：未配 `LLM_PROVIDER` 或没有 key 时，问答走原文摘录、预审走规则引擎、趋势走规则统计；预审报告带 `limitations` 逐条说明规则做不到什么，前端显示在结论下方。不要把这些兜底结果当成语义判断。
- 出口门禁拒绝百分号主机名及非标准数字 IP（十进制、十六进制、八进制），Unicode 主机名先做 IDNA 归一；仍支持标准内网 IP 与内网 DNS。DeepSeek 预设不回落使用千问密钥。
- 政策默认导入仅允许 `corpus/` 内相对路径并强制校验有效 SHA256；重复导入仅在快照一致时原位修正条号，不改文档/分块 ID 或正文。
- 模型预审不得覆盖系统的政策引用（含完整证据与章条标签）和查重章节。OpenAI 预设不发千问扩展参数，显式 `LLM_THINKING_STYLE` 优先于预设。
- 手动政策抓取仅固定政府来源 HTTPS、默认校验证书且不跟随重定向；失败保留快照，不得回退 HTTP 或关闭 TLS 校验。SHA256 只校验完整性，不证明来源真实性。`--force` 仅重建清单同来源，不自动清理历史政策。
- 无 OCR（扫描件 PDF 会提示）；Uvicorn 为单进程开发模式。
- 卷宗体检只核对本地材料角色、当前版本、人工确认和可读取文本线索；同角色新材料自动成为当前版本。不得把“文件已上传”表述为公章、签字真实，也不得把本地检查表述为官方受理、评审、验收或结题状态。
- 专家同单位及配置回避单位仅做排版空白、全半角字符和括号归一后等值比较；保留英文词间空格及括号内容，原名不改写；简称、别名、上下级单位仍需人工核对。
- 申报单位/负责人未识别时专家匹配会**明确提示回避约束未生效**（不误报“未发现冲突”）；预审风险环是纯分类色，无评分刻度。
- `GET /api/experts` 限 reviewer/manager/admin（最小权限）；DOCX 含 `<!DOCTYPE>/<!ENTITY>` 直接拒绝（全文扫描，不受偏移限制）；PDF 默认只解析前 2000 页；思考开关 `LLM_ENABLE_THINKING`（留空不发/0 关/1 开）；参数方言由 `LLM_THINKING_STYLE` 决定（auto 按端点推断：含 deepseek 发 `thinking.type=disabled`，其余发 `enable_thinking`）——**DeepSeek 默认开思考，JSON 任务不关就会把 max_tokens 吃光、正文为空**；HTTPS 部署设 `COOKIE_SECURE=1`。
- 上传大小限制由 `/api/health` 的 `upload_limit_mb` 下发，前端同步展示；上传走 XHR 以显示真实进度。

## 改动与提交约定

- 后端改动 → 跑 `pytest`；前端改动 → 跑 `npm run build`（含 tsc 类型检查）。
- **FastAPI 路由按声明顺序匹配**：固定路径（`/api/documents/sample`）必须先于同前缀的参数路径（`/api/documents/{doc_id}`）声明，否则被参数路由吃掉返回 404（已踩过一次）。
- Conventional Commits，中文描述（`fix:` / `feat:` / `refactor:` / `init:`）。
- 文案基调：界面用简洁、直白的业务语言；避免重复说明、装饰性英文小标题和过度修辞。保留必要的模型来源、错误信息、人工复核及业务边界。
- 文档五处需同步：`README.md`（使用与 API）、`实施方案-RAG垂类模型与智能问答.md`（§8.2 已落地清单）、`DESIGN.md`（设计 token、组件、动效与无障碍契约）、`SECURITY.md`（安全行为描述与基线 commit，改认证/权限/防护/环境变量时必更）、`交付材料/`（若涉及软著功能描述与源程序清单——**注意源程序清单当前与代码有漂移，提交软著前需重新生成**）。

浏览器回归位于 `frontend/e2e/`，详见其中 README；`E2E_PYTHON` 可指定 Python。每例临时数据库、随机回环端口，禁用模型出口；不得改为复用开发数据库。前端大改运行全套并保留实际页面审查；报告目录已忽略，不得提交测试会话附件。GitHub Actions 随 push/PR 检查。

路由动效“栏目卷标入场”按 pathname 重播，查询参数和普通状态更新不得重播；不渲染背景box或纸影，仅绿色栏目卷标滑入并静态保留，装饰不阻挡交互，正文不淡出、仅4px/280ms归位，手机端等待抽屉真实退场后播放；减少动态效果即时静态。连续播放逐帧验证正文不透明、卷标入场时抽屉已退场，不以暂停帧代替验收。对应 `frontend/e2e/route-arrival.spec.ts` 覆盖桌面/手机。

右上角上传按钮：≤680px统一44px图标按钮并隐藏文字、padding为0；不要让图标按钮宽度与文字隐藏使用不同断点。移动端回归覆盖420/421和680/681边界。

模型标识契约：顶栏仅显示当前配置；回答与预审及其 Markdown 导出使用独立 `generation` 快照（provider/label/model/status），回退标离线、中断保留实际来源，缺记录不猜测。SSE 首 token 前发来源事件、done 给最终状态；旧 mode=qwen 仅作兼容，不能据此称供应商为千问。旧 QWEN_* 自动接口仅对已知官方端点显示具体供应商。

智能问答模型与强度只在输入区选择，以请求级独立客户端生效，不修改全局客户端或预审/趋势；选择器目录由 `GET /api/chat/options` 下发，不返回密钥或接口地址。后台按供应商独立密钥和出口门禁验证白名单，未知模型/强度拒绝，模型缺能力或显式方言不匹配只开放默认。切页保持会话选择，退出/刷新重置。

One Page 工作区：所有受保护路由共享同一卷宗上下文与功能索引，只有当前工作面替换；保留旧路由用于刷新、深链和浏览器后退。顶部只放一个资料选择器，同时提供课题卷宗与单独申报书；卷宗无当前申请书时清空预审与查重对象，不沿用旧文档。卷宗详情可收起。预审与查重实时同步，工作台进入问答可带入选定本子但不限制问答多文档；知识图谱采用左控制、中星图、右详情，支持知识域筛选、实体搜索、邻接关系、最短路径和 `?focus=` 深链；文档中心采用左目录、右书页，正文只经认证接口读取有序文本块并隐藏本地路径，保留上传、删除、筛选、问答、预审和文献 CSV 管理。课题卷宗面板按材料角色归卷，同角色新版本自动成为当前版本；盖章、签字和主管部门状态只能人工确认，计划类型决定申报指标和实施文件。手机进入具体任务后隐藏问候与重复指标，只保留卷宗选择及单行功能索引；问答与证据切换，引用定位转移焦点；手机预审完成时若弹窗或导航打开、或用户正在操作其他控件或滚动阅读，保留焦点并提供查看报告入口；桌面预审报告及用户列表独立滚动且键盘可达，打印报告不截断；专家库与代表性文献可展开。
