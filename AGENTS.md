# AGENTS.md — 研信智评 · AI 助手速览上下文

> 给 AI 编程助手的项目速读文件。人是第一读者的话请看 `README.md`（更全）；这里只放快速上手和**不能破坏的约束**。

## 这是什么

面向江苏省自然资源科研管理的**科研诚信 RAG 智能评审助手**（"研信智评"）：外挂式、内网部署、不侵入现有科技管理系统。课题原型的配套代码。FastAPI + React 全栈，当前库内数据**全部为演示合成数据**。

## 常用命令

```bash
./run.sh                                                    # 一键运行 → http://127.0.0.1:8010
python3 -m uvicorn app:app --reload --port 8010             # 后端开发
cd frontend && npm run dev                                  # 前端开发（5173，/api 代理 8010）
cd frontend && npm run build                                # 前端构建（tsc --noEmit + vite）
python3 -m pytest tests/ -q                                 # 回归测试（18 项）
```

PDF 解析依赖 `pdftotext`（poppler）。`frontend/dist` 已存在时运行不需要 Node。

## 模块地图

```
app.py                 FastAPI：18 条路由、SSE 流式问答、上传、SPA 托管（路径穿越有防护）
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
  seed.py              演示数据种子（标记存 meta 表，与库同生命周期；旧 .seeded_* 文件自动迁移）
frontend/src/
  pages/               Chat / Trend(3D) / Match(查重+专家匹配) / Review(预审) / Library
  AppContext.tsx       全局状态；api.ts 客户端 + SSE 解析；motion.ts 统一动效；charts/ ECharts GL
```

## 数据事实

- 库：`data/app.db`；上传原件：`data/uploads/`；两者均在 `.gitignore`。
- 当前默认数据 = 1 份示例本子（种子写入）+ 42 篇合成文献 + 12 位合成专家（均 `is_sample=1`，界面可一键移除）。
- 重新播种演示数据：清 `meta` 表中 `seeded_papers` / `seeded_doc` / `seeded_experts` 对应键。
- 外部真实数据入口：CSV 导入（界面）或 `POST /api/ingest/experts|papers`（JSON 推送，幂等）；契约自查 `GET /api/ingest/schema`。项目/诚信记录/政策版本 schema 已预留但**无存储**，勿提前建表。

## 不能破坏的约束（业务红线）

1. **AI 不打分、不排名、不给立项/处罚结论**；预审/查重/匹配输出必须带免责声明，查重必须提示"相似≠抄袭、需人工复核"。
2. **专家匹配不使用性别、年龄等敏感属性**；回避/负载约束过滤必须在语义排序之前。
3. **数据不出内网**：默认只监听 `127.0.0.1`；设 `HOST=0.0.0.0` 前必须先加登录/鉴权（当前无 SSO/RBAC）。
4. **隐私**：`3.科研课题申请书（终稿）.docx` 与 `交付材料/01-软件著作权/screenshots/` 含真实个人信息，已在 `.gitignore` 排除——**勿提交、勿解除忽略、勿在回复中复述其中的个人数据**。
5. 评审材料不得用于模型训练（未获书面授权前）。

## 已知边界（勿误报为 bug）

- 检索是 TF-IDF，不是向量检索（升级路线已定，见实施方案 §5.2）。
- 无 OCR（扫描件 PDF 会提示）；Uvicorn 为单进程开发模式。
- 专家同单位回避是**精确字符串匹配**，接真实专家库前需做单位名归一（已知待办）。
- 前端 30MB 上传校验为硬编码，与后端 `MAX_UPLOAD_BYTES` 独立。

## 改动与提交约定

- 后端改动 → 跑 `pytest`；前端改动 → 跑 `npm run build`（含 tsc 类型检查）。
- Conventional Commits，中文描述（`fix:` / `feat:` / `refactor:` / `init:`）。
- 文档三处需同步：`README.md`（使用与 API）、`实施方案-RAG垂类模型与智能问答.md`（§8.2 已落地清单）、`交付材料/`（若涉及软著功能描述与源程序清单——**注意源程序清单当前与代码有漂移，提交软著前需重新生成**）。
