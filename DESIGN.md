---
version: alpha
name: yanxin-review-design
description: 研信智评内网评审工作台的设计契约——米色纸面与青绿强调色、宋体标题与黑体界面、勘验阅卷式文案；React 19 + 手写 CSS，token 全部取自 frontend/src/styles.css，组件覆盖按钮/输入/面板/表格/导航/徽章/图表容器，动效只允许 transform 与 opacity，并遵守 reduced-motion。
colors:
  primary: "#0e7c6b"
  primary-deep: "#0a5f52"
  primary-soft: "#e4f2ed"
  on-primary: "#ffffff"
  ink: "#10242e"
  ink-secondary: "#1c3a46"
  muted: "#5b6660"
  muted-subtle: "#656d67"
  canvas: "#f3efe6"
  surface: "#fffdf8"
  surface-2: "#fbf8f1"
  surface-hover: "#fdfbf6"
  hairline: "#ded6c7"
  hairline-strong: "#c9bea9"
  nav-surface: "#0b1a23"
  nav-surface-2: "#102a35"
  on-navy: "#f5faf7"
  on-navy-note: "rgba(233, 242, 239, 0.62)"
  on-navy-faint: "rgba(233, 242, 239, 0.58)"
  on-navy-caption: "rgba(238, 247, 243, 0.72)"
  gold: "#b5853c"
  gold-soft: "#f5ead6"
  gold-ink: "#7a5521"
  warning: "#b26a1f"
  danger: "#b3453f"
  danger-soft: "#f8e6e3"
  danger-hairline: "#e3cbc7"
  idle-surface: "#efeae0"
  idle-ink: "#575f58"
  toast-error: "#6e2b27"
  focus: "#0e7c6b"
typography:
  display-login:
    fontFamily: "Songti SC, STSong, serif"
    fontSize: 40px
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: 6px
  display-page:
    fontFamily: "Songti SC, STSong, serif"
    fontSize: 34px
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: 1px
  display-hero:
    fontFamily: "Songti SC, STSong, serif"
    fontSize: 28px
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: 0.5px
  display-welcome:
    fontFamily: "Kaiti SC, STKaiti, KaiTi, 楷体, AR PL UKai CN, Kaiti TC, serif"
    fontSize: 28px
    fontWeight: 600
    lineHeight: 1.6
    letterSpacing: 1.5px
  heading-panel:
    fontFamily: "Songti SC, STSong, serif"
    fontSize: 20px
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: 0.4px
  heading-modal:
    fontFamily: "Songti SC, STSong, serif"
    fontSize: 26px
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: 0px
  heading-form:
    fontFamily: "Songti SC, STSong, serif"
    fontSize: 24px
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: 0.96px
  brand:
    fontFamily: "Songti SC, STSong, serif"
    fontSize: 21px
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: 2px
  body-reading:
    fontFamily: "Kaiti SC, STKaiti, KaiTi, 楷体, AR PL UKai CN, Kaiti TC, serif"
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.85
    letterSpacing: 0.3px
  body-ui:
    fontFamily: "PingFang SC, Hiragino Sans GB, Microsoft YaHei, Helvetica Neue, Arial, sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: 0px
  body-sm:
    fontFamily: "PingFang SC, Hiragino Sans GB, Microsoft YaHei, Helvetica Neue, Arial, sans-serif"
    fontSize: 13.5px
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: 0px
  caption:
    fontFamily: "PingFang SC, Hiragino Sans GB, Microsoft YaHei, Helvetica Neue, Arial, sans-serif"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: 0.2px
  badge-role:
    fontFamily: "PingFang SC, Hiragino Sans GB, Microsoft YaHei, Helvetica Neue, Arial, sans-serif"
    fontSize: 11.5px
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: 0.35px
  caption-xs:
    fontFamily: "PingFang SC, Hiragino Sans GB, Microsoft YaHei, Helvetica Neue, Arial, sans-serif"
    fontSize: 10.5px
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: 2.6px
  button-md:
    fontFamily: "PingFang SC, Hiragino Sans GB, Microsoft YaHei, Helvetica Neue, Arial, sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: 0px
  data-display:
    fontFamily: "Songti SC, STSong, serif"
    fontSize: 36px
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: 0px
  code-md:
    fontFamily: "SFMono-Regular, ui-monospace, Menlo, monospace"
    fontSize: 12.5px
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: 0px
  kai-reading:
    fontFamily: "Kaiti SC, STKaiti, KaiTi, 楷体, AR PL UKai CN, Kaiti TC, serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.85
    letterSpacing: 0.28px
rounded:
  none: 0px
  xs: 2px
  sm: 4px
  md: 6px
  lg: 8px
  xl: 12px
  full: 999px
spacing:
  xxs: 4px
  xs: 8px
  sm: 10px
  md: 14px
  lg: 20px
  xl: 24px
  xxl: 32px
  section: 44px
  page: 48px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button-md}"
    rounded: "{rounded.sm}"
    padding: 0 18px
    height: 40px
  button-primary-hover:
    backgroundColor: "{colors.primary-deep}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.sm}"
    height: 40px
  button-primary-disabled:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.sm}"
    height: 40px
  button-ghost:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-secondary}"
    typography: "{typography.button-md}"
    rounded: "{rounded.sm}"
    padding: 0 18px
    height: 40px
  button-ghost-danger:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.danger}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
    padding: 0 12px
    height: 32px
  button-sm:
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
    padding: 0 12px
    height: 32px
  text-input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body-ui}"
    rounded: "{rounded.sm}"
    height: 40px
  text-input-focused:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    height: 40px
  select-control:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body-ui}"
    rounded: "{rounded.sm}"
    height: 42px
  panel:
    backgroundColor: "{colors.surface}"
    typography: "{typography.body-ui}"
    rounded: "{rounded.md}"
  panel-head:
    textColor: "{colors.ink}"
    typography: "{typography.heading-panel}"
  kpi-card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: 22px 24px
  kpi-value:
    textColor: "{colors.ink}"
    typography: "{typography.data-display}"
  count-badge:
    backgroundColor: "{colors.primary-soft}"
    textColor: "{colors.primary-deep}"
    typography: "{typography.caption}"
    rounded: "{rounded.full}"
    padding: 0 9px
    height: 24px
  status-pill-idle:
    backgroundColor: "{colors.idle-surface}"
    textColor: "{colors.idle-ink}"
    typography: "{typography.caption}"
    rounded: "{rounded.full}"
    padding: 3px 9px
  status-pill-pass:
    backgroundColor: "{colors.primary-soft}"
    textColor: "{colors.primary-deep}"
    typography: "{typography.caption}"
    rounded: "{rounded.full}"
    padding: 3px 9px
  status-pill-warn:
    backgroundColor: "{colors.gold-soft}"
    textColor: "{colors.gold-ink}"
    typography: "{typography.caption}"
    rounded: "{rounded.full}"
    padding: 3px 9px
  status-pill-fail:
    backgroundColor: "{colors.danger-soft}"
    textColor: "{colors.danger}"
    typography: "{typography.caption}"
    rounded: "{rounded.full}"
    padding: 3px 9px
  role-badge-admin:
    backgroundColor: "#f5e3d3"
    textColor: "#8a5521"
    typography: "{typography.badge-role}"
    rounded: "{rounded.full}"
    padding: 1px 7px
  role-badge-viewer:
    backgroundColor: "#eee9df"
    textColor: "{colors.idle-ink}"
    typography: "{typography.badge-role}"
    rounded: "{rounded.full}"
    padding: 1px 7px
  picked-doc:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink-secondary}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
    padding: 7px 10px
  table-header:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.muted}"
    typography: "{typography.caption}"
  table-row-hover:
    backgroundColor: "{colors.surface-hover}"
  nav-item:
    backgroundColor: "rgba(255, 255, 255, 0.05)"
    textColor: "rgba(233, 242, 239, 0.66)"
    typography: "{typography.body-ui}"
    rounded: "{rounded.none}"
    padding: 13px 14px
    height: 46px
  nav-item-active:
    backgroundColor: "rgba(14, 124, 107, 0.34)"
    textColor: "{colors.on-navy}"
    typography: "{typography.body-ui}"
    rounded: "{rounded.none}"
    padding: 13px 14px
    height: 46px
  toast:
    backgroundColor: "{colors.nav-surface-2}"
    textColor: "{colors.on-navy}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
    padding: 12px 18px
  toast-error:
    backgroundColor: "{colors.toast-error}"
    textColor: "{colors.on-navy}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
    padding: 12px 18px
  modal-card:
    backgroundColor: "{colors.surface}"
    typography: "{typography.body-ui}"
    rounded: "{rounded.lg}"
    padding: 26px
  modal-head:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.heading-modal}"
    rounded: "8px 8px 0px 0px"
    padding: 26px 26px 12px
  welcome-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body-ui}"
    rounded: "{rounded.md}"
    padding: 16px 16px 14px
  welcome-card-icon:
    backgroundColor: "{colors.primary-soft}"
    textColor: "{colors.primary-deep}"
    rounded: "50% 50% 50% 8px"
    width: 38px
    height: 38px
  skip-link:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary-deep}"
    typography: "{typography.body-ui}"
    rounded: "{rounded.md}"
    padding: 10px 16px
---

# 研信智评 · 设计系统契约

> 面向人类与编码 agent 的设计约定。**以代码为准**：token 取自 `frontend/src/styles.css`，
> 动效取自 `frontend/src/motion.ts`；本文若与实现冲突，先修本文或先改代码，不要两套并存。
> 产品背景与安全边界见 `README.md`、`SECURITY.md`。

## Overview

研信智评是江苏省自然资源科研管理的**内网评审辅助工作台**。设计目标不是"炫技的 AI 产品"，
而是**像一份摊开的卷宗**：温润的米色纸面、沉稳的墨色标题、克制的青绿强调色，信息以证据与
原文为中心。视觉母题来自测绘与勘验——登录页的等高线地形、面板的细描边、宋体标题与楷体
按语，都在强化"正在阅卷"的感觉。

设计原则（按优先级）：

1. **证据优先**：页面主角是原文、页码、相似度、匹配理由；装饰不得抢注意力。
2. **单一强调色**：青绿（primary）只用于主操作、选中态与"通过/正向"；金、红、琥珀各自只
   承担一种语义（演示样本/风险/离线），不新增第五种强调色。
3. **安静的动效**：只动 `transform` 与 `opacity`，150–260ms，可被打断，`prefers-reduced-motion`
   下全部关闭；不用动效掩盖加载或错误。
4. **直白的边界**：免责声明、按钮、状态词、错误提示保持平实措辞；"文采"只给标题、空态与引导语。
5. **键盘可达**：焦点可见、skip link、抽屉焦点陷阱、弹窗 `role="dialog"` + ESC。

## Colors

调色板是"纸 + 墨 + 青绿"三元结构。所有正文/次要文字组合均按 WCAG AA（≥4.5:1）校准，
焦点环按非文本对比（≥3:1）校准；数值为对 `surface` / `canvas` 的实测比值。

| Token | 值 | 用途 | 对比度 |
|---|---|---|---|
| `primary` | `#0e7c6b` | 主操作、链接、选中态、焦点环、正向状态 | 5.02:1 on surface |
| `primary-deep` | `#0a5f52` | 主按钮 hover、徽章文字、强调文字 | 6.57:1 on primary-soft |
| `primary-soft` | `#e4f2ed` | 计数徽章、通过态底色、图标底 | — |
| `on-primary` | `#ffffff` | 主按钮文字 | 5.02:1 on primary |
| `ink` | `#10242e` | 标题与主正文 | 15.7:1 on surface |
| `ink-secondary` | `#1c3a46` | 次级按钮文字、正文强调 | 11.9:1 on surface |
| `muted` | `#5b6660` | 面板说明、字段提示（12–13.5px） | 5.88:1 surface / 5.21:1 canvas |
| `muted-subtle` | `#656d67` | 更弱的辅助文字、placeholder | 5.25:1 surface / 4.65:1 canvas |
| `canvas` | `#f3efe6` | 页面底色（米色纸面） | — |
| `surface` | `#fffdf8` | 面板、卡片、输入框 | — |
| `surface-2` | `#fbf8f1` | 表头、次级底、聊天工具栏渐变起点 | — |
| `surface-hover` | `#fdfbf6` | 表格行 hover | — |
| `hairline` | `#ded6c7` | 1px 描边、分隔线 | — |
| `hairline-strong` | `#c9bea9` | 需要更明确边界的描边（登录卡、skip link） | — |
| `nav-surface` | `#0b1a23` | 侧栏与深色图表底 | — |
| `nav-surface-2` | `#102a35` | 侧栏渐变、Toast 底 | — |
| `on-navy` | `#f5faf7` | 深色背景上的文字 | 16.8:1 on nav-surface |
| `gold` | `#b5853c` | 演示样本、金色装饰线 | — |
| `gold-soft` | `#f5ead6` | 演示徽章、"关注"状态底 | — |
| `gold-ink` | `#7a5521` | 金色底上的文字 | 5.6:1 on gold-soft |
| `warning` | `#b26a1f` | 离线状态点 | — |
| `danger` | `#b3453f` | 风险、删除操作 | 4.54:1 on danger-soft |
| `danger-soft` | `#f8e6e3` | 风险底、删除 hover 底 | — |
| `toast-error` | `#6e2b27` | 错误 Toast 底 | — |
| `focus` | `#0e7c6b` | 键盘焦点环（2px，offset 2px） | 5.02:1 on surface |

**用色规则**

- 青绿=可行动作与正向；金=演示/样本/需关注；红=风险/破坏性；琥珀=离线/未连接。
- 语义状态必须**颜色 + 文字**同时出现（`status-pill-*` 都带标签），不得只靠颜色。
- 不新增强调色；需要新语义时先加 token 并在此登记，再写组件。
- 深色区域（侧栏、3D 图表）使用 `nav-*` 系列，不把浅色面板 token 直接铺上去。

## Typography

三套字体分工，全部为系统字体栈（无 webfont、无 FOIT）：

- **宋体（Songti SC / STSong）**：品牌、页面标题、面板标题、趋势/查重主标题、KPI 数字——"阅卷"的正式感；
- **黑体（PingFang SC / Microsoft YaHei…）**：界面控件、表格、标签——可读与中性；
- **楷体（Kaiti SC / KaiTi…）**：文案阅读层（欢迎语、问答回答、摘要、研判、证据原文、免责声明）——手写批注感；
- **等宽（SFMono / Menlo）**：英文小标签（`CORE CAPABILITIES`、`SIGN IN`）与演示口令。

| Level | 字体 | 字号/行高 | 用途 |
|---|---|---|---|
| `display-login` | 宋体 600 | 40 / 1.15 · 6px | 登录页品牌主标题 |
| `display-page` | 宋体 600 | 34 / 1.15 | 顶栏页面标题 |
| `display-hero` | 宋体 600 | 28 / 1.25 | 趋势/查重主标题 |
| `display-welcome` | 楷体 600 | 28 / 1.6 · 1.5px | 问答欢迎语（≤680px 为 24px） |
| `heading-panel` | 宋体 600 | 20 / 1.25 | 面板标题 |
| `heading-modal` | 宋体 600 | 26 / 1.2 | 上传弹窗标题 |
| `brand` | 宋体 600 | 21 / 1.2 · 2px | 侧栏品牌名 |
| `data-display` | 宋体 600 | 36 / 1.15 | KPI 数值（`tabular-nums`） |
| `body-reading` | 楷体 400 | 15 / 1.85 | 问答回答、摘要、报告正文、证据原文 |
| `body-ui` | 黑体 400 | 14 / 1.6 | 默认界面文字、按钮 |
| `body-sm` | 黑体 400 | 13.5 / 1.6 | 面板说明、表格 |
| `caption` | 黑体 400 | 12 / 1.6 | 字段标签、辅助说明、徽章 |
| `caption-xs` | 黑体 600 | 10.5 / 1.4 · 2.6px | 英文 eyebrow 标签 |
| `code-md` | 等宽 400 | 12.5 / 1.4 | 演示口令、代码片段 |
| `kai-reading` | 楷体 400 | 14 / 1.85 · 0.28px | 批注式说明、空态按语 |

**规则**

- 宋体只用于标题与数字，**不要**用于长正文（小字号宋体在屏幕上发虚）。
- 正文最小 12px；唯一例外是 10.5px 的全大写 eyebrow（字距已补偿）。
- 数据列与 KPI 使用 `font-variant-numeric: tabular-nums`，避免数值跳动。
- 阅读区最大行宽约 600px（`.welcome > p`、趋势引导语），长文行高 ≥1.8。

## Layout

- 页面骨架：固定侧栏 + 主区。侧栏 264px（折叠 84px；≤980px 强制图标栏 76–84px；≤680px 变抽屉 286px）。
- 主区内边距：`32px 44px 48px`（≤1280px 为 `22px 24px 34px`；≤680px 为 `16px 13px 28px`），
  最大宽度 1760px，`min-width: 0` 防止内容把 flex 子项撑破。
- 纵向节奏：面板间距 20–28px，面板头与内容间距 12–16px；KPI 卡内 `22px 24px`。
- 常用栅格：问答 `1.3fr / minmax(360px, .7fr)`；KPI 桌面 4 列 → ≤1280 两列 → ≤680 仍两列；
  预审左栏 380px；证据/文献卡片按 `auto-fit minmax()` 排列。
- 表格：表头 `surface-2`，单元格 13.5px，行 hover `surface-hover`；移动端单元格 `8px 6px`
  内边距、表格在 `.table-wrap` 内横向滚动，**不得**把面板撑出视口。
- 间距只用 `spacing` 刻度（4/8/10/14/20/24/32/44/48）；组件内例外需在 PR 中说明。

## Elevation & Depth

| 层级 | 值 | 用途 |
|---|---|---|
| `shadow`（面板） | `0 10px 28px rgba(16,36,46,.055)` | 面板、KPI、卡片默认 |
| hover 抬升 | `translateY(-1px)` + `0 4px 12px rgba(16,36,46,.08)` | 按钮、用户卡、表格操作 |
| 下拉/菜单 | `0 14px 34px rgba(16,36,46,.16)` | 用户菜单、范围菜单 |
| 模态 | `0 30px 80px rgba(8,20,26,.3)` + 背景模糊 3px | 上传弹窗 |
| Toast | `0 12px 30px rgba(8,20,26,.25)` | 顶部居中提示 |

- 阴影只用以上 4 档，不随手写第五种；深色图表用内发光/渐变而非大阴影。
- 抬升只做 1–2px，不做大幅缩放；按下态可 `scale(.97)`（按钮）但不得改变布局尺寸。
- 层级：内容 `z-index: 1`，侧栏 20，遮罩 85，抽屉 90，模态 100，skip link 200，Toast 300。

## Shapes

- 圆角刻度：`xs 2px`（演示角标）、`sm 4px`（按钮/输入/卡片）、`md 6px`（面板/弹窗内块）、
  `lg 8px`（弹窗/消息气泡）、`xl 12px`（登录卡）、`full 999px`（徽章、药丸、开关）。
- 侧栏激活项是"左侧 2px 亮边 + 右圆角"的卷宗标签形，不使用整块圆角卡片。
- 头像/图标底 50%；登录印章是 `50% 50% 50% 8px` 的异形圆。
- 拖拽区用 1px 虚线（`hairline` → 激活 `primary`）；分隔用 1px 实线，不用阴影代替。

## Components

**按钮**

- `button-primary`：唯一主操作/屏（上传、运行检查、登录）。渐变 `primary → primary-deep`；
  hover 亮度 +7% 并抬升 1px；disabled `opacity .55` + `cursor: not-allowed`；loading 时文字改为
  进行时并禁用，不显示持续旋转的装饰图标。
- `button-ghost`：次要操作（导出、取消、模板下载）。1px `hairline` 边 + 半透明 `surface` 底。
- `button-ghost-danger`（`.btn-ghost.danger`）：**清除类**操作（移除演示本子/文献/专家）统一用
  `danger` 文字 + `danger-hairline` 边，hover 换 `danger-soft` 底；与 `table-btn.danger`、
  `link-btn.danger` 同族，让"会删数据"的动作在页面上只有一种颜色。
- `button-sm`（32px）：表格行内、面板头。移动端不在表格里堆叠超过 3 个。
- 图标统一 Lucide、`stroke-width 1.7`；图标 + 文字并排，间距 8px；纯图标按钮必须有 `aria-label`。

**输入**

- `text-input` 40px 高、`sm` 圆角、`hairline` 边；focus-visible 时 2px `primary` 环（offset 2px），
  **不得**只换边框颜色。
- `select-control` 42px；原生下拉优先，不自定义复杂菜单。
- `picked-doc`：下拉框会截断长标题，选定后在其下方用一行 `surface-2` 底 + `hairline` 边呈示**全称**
  （前缀标签"当前选定"12px `muted`，标题 13.5px `ink-secondary`，`overflow-wrap: anywhere` 允许折行）。
  查重匹配与本子预审两页共用，不得只靠 `title` 提示。
- 必填与校验：标签常显，错误就近显示并 `role="alert"`；错误文案说明"原因 + 怎么改"。

**面板 / 数据**

- `panel`：`surface` + 1px `hairline` + `md` 圆角 + `shadow`；标题在 `panel-head`，右侧放计数徽章或操作。
- `kpi-card`：默认 4 列，数字用宋体 36px + 等宽数字；数值变化时 480ms 闪光，reduced-motion 下不闪。
- `count-badge`：只表示数量（如"10 份"），不表示状态；状态用 `status-pill-*`。
- 表格：表头 `caption` 12px `muted`；行高 ~49px；危险操作红色且与常规操作隔开；
  删除必须二次确认；移动端允许横向滚动，但不允许页面级横向溢出。

**状态**

- `status-pill-idle`（待检查/尚未运行）、`status-pill-pass`（通过/可评审）、`status-pill-warn`（关注/负载已满）、
  `status-pill-fail`（风险/不可评审）。**未运行前不得用 pass 色**：绿色暗示"已查过且干净"，会误导结论。
- KPI 卡顶部色条同理：`kpi-teal` 是常规强调，出现高相似命中时改用 `kpi-gold`，不作为"评分"。
- 演示数据用金色 `badge-sample`（10.5px，`gold-soft` 底），与真实数据明确区分。
- 角色徽章四色：管理员金、科研管理青、评审专家蓝、访客灰；管理员因历史原因仍用
  `#f5e3d3 / #8a5521` 原始值（见 Known Gaps）。

**导航**

- `nav-item` 46px 高，深色侧栏上文字 `rgba(233,242,239,.66)`；hover 白色 + 5% 白底；
  `nav-item-active` 青绿渐变底 + 2px 亮边 + 白色文字，共享布局滑块（spring）。
- 桌面可折叠为 84px 图标栏（`title` 提供名称）；≤680px 为抽屉：遮罩、焦点陷阱、ESC 关闭、
  点击遮罩关闭、路由切换自动收起、打开时锁 html/body 滚动。
- 当前页在导航中必须高亮；不要用纯图标替代文字导航（折叠态除外，且必须有 `title`）。

**欢迎页 / 进入过渡**

- 登录成功 → 深色全屏过渡（印章 + 扫描线，约 280ms；reduced-motion 即时切换），随后落在 `/welcome`；
  过渡只表示"正在进入"，不得伪造百分比或加载步骤；刷新与会话恢复不重复播放。
- 欢迎页：按时段问候（上午好/下午好…），显示名与角色不同才追加角色徽章；管理角色主 CTA「上传文档」，评审角色「开始预审」，访客「进入智能问答」；资料概况展示总量、申报书与政策数量，
  其余入口由卡片承担；入口卡按权限过滤（访客仅问答/趋势/文档库），图标 + 标题 + 一句说明 + 右箭头。
- 布局：桌面入口 2 列，管理/评审优先预审与查重匹配；移动入口 1 列；无固定高度，矮屏整页滚动；免责声明置于页尾，不折叠。
- 卡片结构：三列栅格 `38px 图标 / minmax(0,1fr) 文本 / auto 箭头`；图标底用 `welcome-card-icon`
  （`primary-soft` 底 + `primary-deep` 图形，异形圆 `50% 50% 50% 8px`，与登录印章同形）；
  标题 15px/600、说明 13.5px `muted`、hover 抬升 2px 且箭头右移 3px。
- 侧栏品牌名是返回欢迎页的链接；欢迎页不进入导航高亮，避免与工具页争夺"当前页"。

**反馈**

- `toast` 顶部居中，3.4s 自动消失，`aria-live="polite"`；错误用 `toast-error`，不抢焦点。
- 空态：图标 + 一句话说明 + 下一步动作；文案可用楷体按语。
- 弹窗：`role="dialog"` + `aria-modal`、焦点陷阱、ESC、关闭后焦点归还触发按钮；
  有未保存内容时关闭需确认。`modal-head` 吸顶（`position: sticky; top: 0` + 负外边距覆盖卡片内边距），
  卡片内部滚动时标题与关闭按钮始终可见可点。

**图表**

- 深色面板（`nav-surface` 渐变）+ 3D/2D 切换；WebGL 不可用自动降级 2D。
- 图表容器必须有 `role="img"` 与文本摘要（年度发文量、主题矩阵的峰值与规模）；
- 单色强调 + 低对比网格线；tooltip 展示精确值；不依赖红/绿对比传达含义。

## Do's and Don'ts

**Do**

- 用 token：颜色写 `var(--primary)`、间距用刻度、圆角用 `rounded` 档位。
- 标题用宋体、界面文字用黑体、文案阅读层用楷体；中文标点全角，数字与英文半角。
- 状态同时给颜色与文字/图标；空态给出下一步动作。
- 动效只用 `transform`/`opacity`，并在 `prefers-reduced-motion` 下关闭。
- 新增可交互元素时同时实现：hover、focus-visible、active、disabled、loading（如适用）。

**Don't**

- 不引入新的强调色、渐变或阴影档位；不把装饰性渐变铺在大段文字后。
- 不用宋体排正文，不用 10px 以下文字，不用纯颜色表达风险等级。
- 不用宽度/高度/位置动画（会造成布局抖动与 webview 冻结），不改用 `!important` 覆盖 token。
- 不隐藏焦点环；不用 `div` 模拟按钮；不给图标按钮留空 `aria-label`。
- 不在按钮、状态词、免责声明里使用文学化措辞（红线：AI 不打分、相似≠抄袭、须人工复核）。
- 不为单个页面发明局部间距/圆角；需要新规则时先更新本文件。

## Responsive Behavior

| 断点 | 行为 |
|---|---|
| ≥1401px | 完整布局：侧栏 264px、主区 44px 横内边距、KPI 4 列 |
| ≤1400px | 表格字号 12.5px、单元格 `12px 10px`、文档标题省略号 360px |
| ≤1280px | 主区 24px 横内边距、问答两栏压缩、KPI 2 列、趋势栅格单列 |
| ≤980px | 侧栏强制图标栏（76–84px）、隐藏折叠开关、顶栏标题 25px |
| ≤680px | 侧栏变抽屉；顶栏纵向排列，菜单靠左、状态/上传/用户 10px 紧排；面板头可换行；表格内滚动；聊天工具栏单行、范围文字省略 |
| ≤640px | 登录角色卡单列 |
| ≤420px | 上传按钮只留图标（`aria-label` 保留） |
| ≤360px | 隐藏模式徽章；聊天工具栏允许换行 |

- 375px 是验收基准：不得出现页面级横向滚动；表格只在 `.table-wrap` 内滚动。
- 触控目标原则 ≥44px；当前按钮 40px、`button-sm` 32px 属于已知差距（见 Known Gaps）。
- 不提供暗色模式；深色仅用于侧栏、图表与 Toast。

**高度适配（视口高度断点）**

- 布局高度一律优先 `100dvh`（保留 `100vh` 回退），避免移动端浏览器地址栏造成的跳动。
- 问答面板与证据面板共用 `height: calc(100dvh - 214px)`、`min-height: 0`，矮屏只做面板内滚动，
  **不允许**再把整页顶出视口（≤680px 时为 `- 250px`）。
- ≤760px 高：侧栏与登录卡内边距收紧、导航项 42px、主区底部留白 32px。
- ≤640px 高：品牌印章缩小、隐藏侧栏副标题、聊天工具栏/输入区压缩、输入框最高 96px。
- ≤620px 高：登录页隐藏装饰性"核心能力"卡（功能不受影响），页面本身保持可滚动。
- 弹窗：`max-height: calc(100dvh - 40px)` + 内部滚动；375×560 下"开始上传"仍可达。
- 预审左栏：`position: sticky` + `max-height: calc(100dvh - 32px)` + 内部滚动。
- 表格滚动区：`max-height: min(560px, calc(100dvh - 260px))`。
- 登录页使用 `place-items: safe center`：内容高于视口时顶部不被裁切，整页可滚动。
- 侧栏 `overflow-y: auto`：极矮视口下导航可滚动，页脚不会被截断。

## Motion

- 统一缓动：`cubic-bezier(.22, 1, .36, 1)`（`EASE`）；弹簧 `stiffness 330 / damping 30 / mass .9`。
- 时长：按钮反馈 150ms；页面进入 220ms、退出 100ms；列表错峰每项 25ms；KPI 数字更新 480ms；模态 260ms。
- 页面切换：`opacity + translateY(6px→0)`；退出仅淡出，不追加位移。
- 状态变化用 `AnimatePresence`：表格行删除退出、匹配空↔结果、上传文件芯片、KPI 闪光（480ms）。
- 登录页地形：等高线描边生长、虚线流动、远/近双层视差（指针 `--px/--py`）、扫描带、纸纹；
  仅 CSS/SVG，入场只用 transform，保证任何一帧内容可见。
- `prefers-reduced-motion: reduce`：关闭 3D 自动旋转、位移动画与 CSS 关键帧；抽屉/焦点环改为即时切换。
- 不用动画阻塞输入；动画可被用户操作打断；不用无限循环动画（登录背景除外，且 reduced-motion 关闭）。

## Copy Voice

- **标题 / 副标题 / 空态 / 引导语**：勘验阅卷意象，四字格与对仗，克制不堆砌。
  例："以诚信为尺，勘每一卷申报"；"把本子放进来，让 AI 先读、先问、先核"；"库中尚空。上传一份本子或政策文件，即开始。"
- **按钮 / 表头 / 状态词**：短、直白、动词优先（上传文档、运行一体化检查、移除演示本子）。
- **免责声明与限制提示**：只陈述事实与后果，不修辞：
  "相似不等于抄袭，须人工复核""不输出立项结论、评分与排名""扫描件暂未启用 OCR"。
- 中文引号用「」或""，比例符号与单位之间留半角空格（30MB、2000 页）；数字用阿拉伯数字。

## Accessibility

- 对比度：正文与辅助文字 ≥4.5:1（已实测 token 组合）；焦点环与 UI 边界 ≥3:1。
- 辅助文字下限：状态药丸、侧栏按语、登录页脚与特性说明 ≥12px，角色徽章 ≥11.5px，且都需实测过线——
  `on-navy-note .62`≈5.9、`on-navy-faint .58`≈5.3、`on-navy-caption .72`≈7.6、
  `idle-ink on idle-surface` 5.50、`role-viewer #575f58 on #eee9df` 5.45。
  纯装饰的字距标签（`.eyebrow` 10.5px、`badge-sample` 10.5px）不承载独有信息，允许更小。
- 快捷键提示（Enter 发送 / Shift+Enter 换行）只在精确指针设备出现：
  `@media (hover: none), (pointer: coarse)` 下 `.kbd-hint` 隐藏，触屏只保留免责句。
- 焦点：全局 `:focus-visible` 2px `primary` 环 + offset 2px；指针触发的焦点不显示 UA 环形，
  但**不得**移除键盘焦点样式。
- skip link：每页第一个 Tab 是"跳到主要内容"；路由切换后焦点移交 `<main id="main" tabindex="-1">`
  （首屏与重定向不抢焦点）。
- 抽屉/弹窗：`aria-modal`、焦点陷阱（含焦点外逃拉回）、ESC 关闭、关闭后归还焦点；打开时锁滚动。
- 交互语义：按钮用 `<button>`，导航用 `<a>`/`NavLink`；纯图标按钮必须有 `aria-label`；
  当前页 `aria-current`（NavLink 自动）。
- 动态反馈：Toast `aria-live="polite"`；表单错误 `role="alert"`；图表 `role="img"` + 摘要。
- 动效：所有动画尊重 `prefers-reduced-motion`；不闪烁超过 3 次/秒。
- 已知未覆盖：真实读屏软件（VoiceOver/NVDA）与 iOS/Android 真机尚未人工走查。

## Implementation Alignment

- **Token 源**：`frontend/src/styles.css` 的 `:root`（22 个颜色 + `--shadow` + `--radius`：
  `--bg --panel --panel-2 --ink --ink-2 --muted --muted-2 --line --line-strong --teal --teal-deep
  --teal-soft --gold --gold-soft --amber --red --red-soft --red-line --idle --idle-ink --navy --navy-2`；
  `--font-kai` 单独在文件后半段的第二个 `:root` 块补定义）。
- **动效源**：`frontend/src/motion.ts`（`EASE`、`SPRING`、`pageVariants`、`staggerContainer`、
  `prefersReducedMotion`）。
- **组件落点**：`frontend/src/components/`（Topbar、Sidebar、UploadModal、KpiCard、EmptyState、
  StatusPill、EChart）与 `frontend/src/pages/`。
- **映射关系**：`primary→--teal`、`primary-deep→--teal-deep`、`primary-soft→--teal-soft`、
  `ink→--ink`、`muted→--muted`、`canvas→--bg`、`surface→--panel`、`surface-2→--panel-2`、
  `hairline→--line`、`nav-surface→--navy`、`gold-soft→--gold-soft`、`danger→--red`、
  `danger-hairline→--red-line`、`idle-surface→--idle`、`idle-ink→--idle-ink`。
- **验证命令**：`cd frontend && npm run build`（tsc + vite）；改动样式后至少核对 1440/375 两档。

## Known Gaps

- `styles.css` 仍有约 199 处硬编码 hex（`#fffdf8` 21 次最多）；本文按语义记录，尚未全部收口为变量。
- `surface-hover`、`spacing`、`rounded` 的绝大多数档位目前是"规则"而非 CSS 变量；已变量化的只有 `--radius`、`--shadow` 与 22 个颜色。
- 角色徽章四色中，访客已改用 `--idle-ink`，管理员/科研管理/评审专家仍是局部原始值（`#f5e3d3`、`#e5edf6` 等）；建议补 4 组 token。
- 深色侧栏/登录页上的前景以 `rgba(..., .58/.62/.72)` 字面量书写，本文按 `on-navy-*` 记录，CSS 侧尚未变量化。
- 图标尺寸（13–42px）与欢迎卡 38px 图标底只记录在本文组件条目里，未建尺寸档位。
- 触控目标：主按钮 40px、`button-sm` 32px、表格操作 26px，低于 44px 建议；移动端未单独放大。
- 图表 tooltip 仅悬停可达，键盘用户只能读到 `aria-label` 摘要；未提供数据表降级。
- 无暗色模式；无 `SCREEN_SPEC.md` 页面级规格。
- 宋体/楷体依赖系统字体，Windows 与部分 Linux 环境回退为默认衬线，需在目标终端复核。
- 真实读屏（VoiceOver/NVDA）与 iOS/Android 真机走查仍未做；触屏快捷键提示的隐藏已用 CDP 模拟
  `(hover: none)` 验证，未在真机复测。

### 本轮精修契约

- ≤680px 趋势与预审压缩重复介绍，趋势快捷主题横向滚动；常用触控按钮最小高 44px。
- KPI 年份范围单行，文本主题独立字号；数字首次直接显示真实值，仅变化时补间。
- 3D 提供两图统一旋转开关，离屏、后台与系统减少动态效果即时停动；拖拽静置恢复计时器由组件清理。
- 2D Canvas 与数字 rAF 动画动态订阅系统减少动态效果；图表 resize 无补间。
- 路由加载使用带状态说明的骨架屏；预审进度条使用 scaleY；静态图表光晕不循环，卡片不常驻 will-change。

### 展卷、循证与呈卷

- 工作台资料区三层纸页以 transform 展开（最长720ms），青绿卷标与纸页细线随后落位；同一标签页会话仅首次播放。装饰 aria-hidden、不拦截指针；≤680px缩为88px薄卷，不挤压操作入口。
- 可操作引用使用原生 button，支持 Enter/Space；点击保留旧轮证据切换与定位。两栏端点可见时，青绿折线与光点连接引用和证据（650ms）；滚动/resize撤除。单栏仅目标原文墨洗强调（1200ms），重复点击可重播且不重置全文展开。
- 真实预审结果返回后，正文即时可读、检查项轻微错峰；“待人工复核”落款在220ms后落定。落款不表达通过、评分或立项结论，不替代风险分类与免责声明。
- 新增动画均为一次性，使用 transform/opacity；减少动态效果时保留静态纸页、引用边框及复核落款。无新增外部素材或运行依赖。

### 回避核对依据（2026-10-26）

专家匹配结果先显示申报单位及负责人原名，再显示单位比较边界。未识别字段以独立琥珀色提示块呈现，使用 `role="status"`，文字明确指出相关约束未生效；不能仅靠颜色表达。排除列表可展开，每位专家显示原因与原名比较依据（或可用状态、负载阈值），长单位名在窄屏自然换行。页面和 Markdown 导出保持一致，候选仅表述“未命中已配置的回避条件，仍需人工核对”，不得暗示已核清简称、别名、隶属关系。

### 浏览器回归契约（2026-10-27）

`frontend/e2e/` 用真实 Chromium 验证业务状态、权限、错误恢复、下载内容与跨页请求生命周期；375px 视口验证导航、长证据换行和模态焦点。常规用例减少动态效果以稳定断言，专门用例验证正常动画结束、旋转暂停及运行期偏好变化。空文献图表的类目标签允许空值，3D/2D 均须保持页面可用。禁止未捕获异常、React 渲染错误及非本服务源 HTTP 请求；受控网络故障需恢复真实流程。截图用于实际页面复核，不采用易受字体/系统差异影响的全页像素基线。Safari、Firefox、真机与读屏仍需独立验证。

### 路由栏目卷标入场（2026-10-27）

按用户要求完全移除卷标背后的box和两层纸影，仅保留绿色栏目卷标：延迟70ms、滑入350ms并静态保留；手机横向位移32px减至18px、卷标高24px。标题立即可读，正文始终不透明、4px归位280ms，退出不淡出。装饰绝对定位、aria-hidden、pointer-events:none，不占布局。按pathname重建，进入/返回重播，查询、输入及刷新不重播。手机端等待导航抽屉真实退场后播放，直接进入无额外等待；减少动态效果即时变为静态卷标。浏览器回归自然播放并逐帧确认背景box始终不存在、正文不透明、卷标入场时抽屉完全退场，保留截图与录像。

窄屏上传按钮：≤680px统一为44×44px图标按钮，隐藏文字并清除水平内边距；>680px恢复图标与文字。保持“上传文档”可访问名称，421–680px不得挤压图标。浏览器回归检查320/375/420/421/500/680/681/900px。

预审证据契约：模型与离线模式均展示系统政策检索的文件、章条、摘要及可展开原文；模型输出不得替换这些证据和真实查重结果。浏览器回归使用真实本地政策检索结果、受控模型展示模式验证展开/收起与导出引用，不请求外部模型。

模型来源展示契约：桌面顶栏显示“供应商 · 模型”，≤680px 在标题说明下方展示“当前配置：供应商 · 模型”，保留右上角44px上传图标按钮。回答元信息与预审报告显示各自生成时的实际来源快照；换模型或跨页不改写历史标识。失败回退明确标为离线摘录/规则预审，中断保留来源并提示“生成中断”，旧结果显示“来源未记录”。来源长文本允许换行，不挤压操作区。预审 Markdown 导出同样带来源。

智能问答输入框上方放紧凑的“模型 / 强度”入口，点击向上展开勾选面板，每组单选；手机使用单行并保持上传按钮位置及 44px 触控目标。面板支持键盘与 Escape 返回焦点，未配置模型禁用并说明原因，发送中禁用选择。状态仅在当前登录会话的问答页之间保留。
