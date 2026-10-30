---
version: alpha
name: yanxin-review-design
description: 研信智评内网评审工作台的设计契约——青绿纸色、黑白、深海蓝与极光紫主题，宋体标题与黑体界面、简洁的业务文案；React 19 + 手写 CSS，主题令牌取自 frontend/src/styles.css 与 themes.css，并遵守 reduced-motion。
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

> 面向人类与编码 agent 的设计约定。**以代码为准**：基础 token 取自 `frontend/src/styles.css`，主题覆盖取自 `frontend/src/themes.css`，
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
4. **直白的边界**：免责声明、按钮、状态词、错误提示保持平实措辞；标题、空态与引导语也以清楚表达为先。
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
- **楷体（Kaiti SC / KaiTi…）**：问答回答、摘要和证据原文的阅读层；
- **等宽（SFMono / Menlo）**：必要的英文内容与演示口令。

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
| `caption-xs` | 黑体 600 | 10.5 / 1.4 | 演示数据徽章 |
| `code-md` | 等宽 400 | 12.5 / 1.4 | 演示口令、代码片段 |
| `kai-reading` | 楷体 400 | 14 / 1.85 · 0.28px | 批注式说明、空态按语 |

**规则**

- 宋体只用于标题与数字，**不要**用于长正文（小字号宋体在屏幕上发虚）。
- 正文最小 12px；演示数据徽章为 10.5px。
- 数据列与 KPI 使用 `font-variant-numeric: tabular-nums`，避免数值跳动。
- 阅读区最大行宽约 600px（`.welcome > p`、趋势引导语），长文行高 ≥1.8。

## Layout

- 页面骨架：固定侧栏 + 主区。侧栏 264px（折叠 84px；≤980px 强制图标栏 76–84px；≤680px 变抽屉 286px）。
- 主区内边距：`32px 44px 48px`（≤1280px 为 `22px 24px 34px`；≤680px 为 `16px 13px 28px`），
  最大宽度 1760px，`min-width: 0` 防止内容把 flex 子项撑破。
- 纵向节奏：面板间距 20–28px，面板头与内容间距 12–16px；KPI 卡内 `22px 24px`。
- 常用栅格：问答 `1.3fr / minmax(360px, .7fr)`；KPI 桌面 4 列 → ≤1280 两列 → ≤680 仍两列；
  预审左栏 380px；证据/文献卡片按 `auto-fit minmax()` 排列。
- 表格：四套主题表头分别使用青绿、石墨、深蓝、紫色渐变与白色文字，单元格 13.5px，行 hover `surface-hover`；移动端单元格 `8px 6px`
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
  查重匹配与项目预审两页共用，不得只靠 `title` 提示。
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
- 欢迎页：按时段问候（上午好/下午好…），显示名与角色不同才追加角色徽章；管理角色主 CTA「上传文档」，评审角色「开始预审」，访客「进入智能问答」；概况分别展示在册文档、课题卷宗、申报书与政策数量，
  其余入口由卡片承担；入口卡按权限过滤（访客仅问答/趋势/文档中心），图标 + 标题 + 一句说明 + 右箭头。
- 布局：桌面入口 2 列，管理/评审优先预审与查重匹配；移动入口 1 列；无固定高度，矮屏整页滚动；免责声明置于页尾，不折叠。
- 卡片结构：三列栅格 `38px 图标 / minmax(0,1fr) 文本 / auto 箭头`；图标底用 `welcome-card-icon`
  （`primary-soft` 底 + `primary-deep` 图形，异形圆 `50% 50% 50% 8px`，与登录印章同形）；
  标题 15px/600、说明 13.5px `muted`、hover 抬升 2px 且箭头右移 3px。
- 侧栏品牌名是返回欢迎页的链接；欢迎页不进入导航高亮，避免与工具页争夺"当前页"。

**反馈**

- `toast` 顶部居中，3.4s 自动消失，`aria-live="polite"`；错误用 `toast-error`，不抢焦点。
- 空态：图标 + 一句话说明 + 下一步动作。
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
| ≤1280px | 主区 24px 横内边距、问答两栏压缩、KPI 2 列；趋势双图在 >680px 宽视口保持并排并填满可用高度，≤680px 改为上下两行 |
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

- **标题 / 副标题 / 空态 / 引导语**：用简洁业务语言说明功能和下一步，避免装饰性英文眉题、重复说明与堆砌对仗。
  例："根据资料提问"；"请先上传申报书"。
- **按钮 / 表头 / 状态词**：短、直白、动词优先（上传文档、运行一体化检查、移除演示本子）。
- **免责声明与限制提示**：只陈述事实与后果，不修辞：
  "相似不等于抄袭，须人工复核""不输出立项结论、评分与排名""扫描件暂未启用 OCR"。
- 中文引号用「」或""，比例符号与单位之间留半角空格（30MB、2000 页）；数字用阿拉伯数字。

## Accessibility

- 对比度：正文与辅助文字 ≥4.5:1（已实测 token 组合）；焦点环与 UI 边界 ≥3:1。
- 辅助文字下限：状态药丸、侧栏按语、登录页脚与特性说明 ≥12px，角色徽章 ≥11.5px，且都需实测过线——
  `on-navy-note .62`≈5.9、`on-navy-faint .58`≈5.3、`on-navy-caption .72`≈7.6、
  `idle-ink on idle-surface` 5.50、`role-viewer #575f58 on #eee9df` 5.45。
  演示数据徽章（`badge-sample` 10.5px）用于标记样本数据。
- 问答输入框的 `title` 和无障碍名称提示 Enter 发送、Shift+Enter 换行；界面保留人工复核提示。
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

`frontend/e2e/` 用真实 Chromium 验证业务状态、权限、错误恢复、下载内容与跨页请求生命周期；375px 视口验证导航、长证据换行和模态焦点。常规用例减少动态效果以稳定断言，专门用例验证 `WorkDeck` 前进/后退方向切换、动画完播、旋转暂停及运行期偏好变化。80%–200% 等效视口逐路由验证页面级纵向、横向均不溢出。空文献图表的类目标签允许空值，3D/2D 均须保持页面可用。禁止未捕获异常、React 渲染错误及非本服务源 HTTP 请求；受控网络故障需恢复真实流程。截图用于实际页面复核，不采用易受字体/系统差异影响的全页像素基线。Safari、Firefox、真机与读屏仍需独立验证。

### 路由标题

顶栏保留页面大标题和必要操作，移除标题说明、绿色栏目卷标和顶栏模型配置。生成结果仍显示实际来源。
各工作区标题以短暂的揭示和轻微上移入场；不使用背景色块，减少动态效果时立即静态显示。

窄屏上传按钮：≤680px统一为44×44px图标按钮，隐藏文字并清除水平内边距；>680px恢复图标与文字。保持“上传文档”可访问名称，421–680px不得挤压图标。浏览器回归检查320/375/420/421/500/680/681/900px。

预审证据契约：模型与离线模式均展示系统政策检索的文件、章条、摘要及可展开原文；模型输出不得替换这些证据和真实查重结果。浏览器回归使用真实本地政策检索结果、受控模型展示模式验证展开/收起与导出引用，不请求外部模型。

模型来源展示契约：顶栏不显示模型配置；回答与预审报告显示各自生成时的实际来源快照，预审 Markdown 导出同样保留来源。失败回退和中断保持明确标记，旧结果显示“来源未记录”。

智能问答输入框上方放紧凑的“模型 / 强度”入口，点击向上展开勾选面板，每组单选；手机使用单行并保持上传按钮位置及 44px 触控目标。面板支持键盘与 Escape 返回焦点，未配置模型禁用并说明原因，发送中禁用选择。状态仅在当前登录会话的问答页之间保留。

单页工作区：所有受保护路由共享同一外壳，卷宗上下文常驻，只有当前工作面随路由替换；所有任务路由沿用文档中心验证过的紧凑外壳，顶栏和卷宗栏用同一垂直密度，后续工作面共享剩余高度；工作台因含问候与概况，卷宗栏按内容自然增高。左侧导航与顶栏标题读取同一工作区配置，顺序和权限过滤保持一致；中央功能导航不再渲染，避免重复并释放工作面高度；旧路由保留刷新、深链与浏览器后退语义。顶部统一选择课题卷宗或单独申报书，任务页收紧顶部区域，问候和概况保留在工作台；未归入申请书的卷宗不会沿用其他本子；卷宗详情可收起，预审与查重实时同步，问答以该选择作为可选范围。桌面预审操作区与可键盘聚焦的结果区并排，结果区独立滚动而打印完整展开；用户管理表格亦可聚焦滚动。手机任务态把卷宗上下文压缩为单一选择；问答与证据采用互斥切换，引用跳转时焦点进入对应证据，触控入口不小于 44px。专家库与趋势代表性文献按需展开，文档中心按名称筛选。原有角色权限、报告证据和免责声明保持。

桌面 80%–200% 缩放按可用 CSS 视口响应；侧栏折叠后仍保留当前路由与可访问名称。浏览器回归以等效视口检查，不将其视为真实缩放验证。

### 知识图谱与文档中心

- 知识图谱采用三栏工作台：左侧知识域与最短路径，中央浅纸色语义星图，右侧实体属性与邻接关系。桌面 1440px 三栏并排；≤1050px 星图独占整行，≤900px 依序为星图、控制区、详情。星图使用固定语义簇与可缩放画布，搜索、知识域显隐和路径只更新高亮状态，不随机重排节点。
- 默认“文档关键词”视图按分块频次呈现最多 500 个关键词（默认 100，可选 10、20、50、100、200、500）及共现余弦关联与原文来源；支持整个知识库或单个卷宗（含历史版本），以不分组的散点布局呈现，连线表示共现关联。大图文字重叠时自动避让，悬停可查看词语并弱化非选中连线，使用可键盘操作的关键词列表；当前会话上传、删除后重读。结果为本地规则提取，不称为人工确认的关系，词汇不足时按实际数量显示。人工图谱为 48 实体、100 关系、7 知识域；实体详情与关系列表提供等价键盘入口。`?focus=<id>` 保存当前实体，进入问答时以 `?prompt=` 预填解释问题且消费后移除参数。
- 文档中心使用按钮切换正文与文献数据；正文采用“目录树 + 开卷正文”结构。左侧按课题材料和公共与参考资料分区，再按卷宗材料角色或文档类型分组；同一文档跨角色可出现在多个分组，同角色只列一次，未归类资料保留入口；一级与二级目录均可收起，二级向右缩进，展开仅作轻微位移；搜索时展开匹配结果，减少动态效果时即时呈现；右侧显示文档元信息、书页正文、章节和页码。桌面目录与正文共用外框、等高并各自滚动；资料工具栏按钮等高对齐。≤900px 目录折叠为按钮，选择后自动收起并把焦点交给正文。
- 正文与文献切换和资料工具合并在一行，文档中心的顶栏、卷宗栏和阅读器页头进一步收紧；窄屏及矮屏收起重复的资料标题和上传入口，将空间让给正文。正文区域可键盘聚焦滚动，首个分块与文档名重复时不额外绘制标题。
- 文档正文通过 `GET /api/documents/{doc_id}/content` 读取有序文本块；接口只返回公开文档字段，不暴露 `path` 或原始文件名。当前文档使用 `?doc=` 深链；点击目录产生浏览器历史记录，返回时恢复上一份文档。
- 文档中心保留上传、删除、名称筛选、问答、预审、索引状态、演示数据清理和文献 CSV 操作。文献数据独占一个可切换工作面，表格在固定窗格内滚动。
- 趋势“代表文献”使用语义链接进入 `/library?view=literature&paper=<id>`；文献数据视图据此定位并高亮目标行。`view=literature` 可刷新恢复，默认文档正文继续省略 `view`，保留 `/library?doc=` 旧深链。
- 问答引用、查重对方文档、预审政策/查重依据、卷宗当前与历史材料均使用 `/library?doc=<id>` 语义链接；只展示证据名称而不提供原文入口视为可达性缺陷。
- 预审 03“检查项”和 04“查重与追问”的证据卡填满当前工作面剩余高度；摘要默认 4 行，展开后不再裁切，长证据只在卡内滚动，分页与“打开依据原文”保持可见。
- 图谱与文档切换动效只使用 transform/opacity；减少动态效果时星图不高亮过渡、书页不旋转，正文立即可读。

### 课题卷宗与材料体检（2026-10-29）

- `DossierWorkbench` 位于独立的“课题卷宗”工作面（`/dossiers`），与项目预审分开，沿用卷宗纸面、青绿强调色和宋体标题。桌面采用左侧七步编号栏、右侧固定工作面；手机与矮窗口把步骤栏转为紧凑网格。概况、材料、归入、历史、体检、流程和边界逐页切换，长列表在页内翻项，页面与工作面均不得产生纵向滚动。
- 卷宗头显示年度、指令性/指导性和材料阶段；当前页标题显示步骤编号、名称、说明与体检分类。材料角色用短标签呈现，文件名与版本是主信息。
- 同角色重新归卷自动形成新版本；旧版本在折叠历史中保留，可人工切回。盖章扫描件、诚信承诺书、合同、实施承诺、绩效自评、财务决算、专家意见和备案材料提供“人工确认”，记录操作者和时间。
- 体检状态只用“通过/关注/风险”三类现有语义，并在每项文字说明缺项或待确认原因；不能用颜色暗示已证明公章、签字或官方审批真实。
- 桌面每一步只呈现一个可操作页，底部提供上一步/下一步；≤900px 或高度≤600px 时步骤栏改为 4 列网格，高度≤550px 的横屏改为 7 列单行；≤680px 概况改为 2×2、材料操作保持文件名与操作按钮并列。1440×900、1920×1000、2560×1440、720×450 与 375×812 均纳入真实浏览器一屏回归。
- 新建/编辑卷宗遵循既有模态契约：焦点进入并受困、ESC 关闭、背景滚动锁定、关闭恢复触发按钮。交互状态文字不依赖动画；减少动态效果时列表和体检结果即时呈现。

### 统一章节页架与全路由 One Page（2026-10-29）

- `WorkDeck` 为有明确步骤的业务页提供统一左侧章节栏、顶部当前页说明、底部上一步/下一步。章节按钮等高等距并在可用高度内居中；活动态使用共享布局弹簧。
- 趋势分析设置去掉 KPI 网格的尾随下边距，指标卡垂直居中并占用剩余高度；趋势图表的两层容器都参与 flex 高度分配，短桌面仍保持两张图并排、真实画布填满卡片，不使用固定 345px 高度后再裁切。浏览器缩放到 250%–500% 时，主页面仍锁定一屏，趋势设置和单张图表改在主窗格内滚动，避免继续压缩或裁切。
- 分析设置中的快捷主题只更新同一章节的主题词与 KPI，不主动切换章节；清除演示文献后的后台重算同样留在设置页。只有显式点击“分析趋势”或输入后按 Enter 才展示图表。该行为避免“大模型”“语义查重”等词条点击后未经用户确认跳到第 2 步。
- 窄屏趋势指标分两列，空间不足时设置区内部滚动；趋势图表支持滚轮缩放（3D 视角距离、2D 年份区间）。用户管理工作面占满工作区宽度，任务页收紧底部留白。
- 章节前进时新页从右侧 14px、后退时从左侧 14px，以 180ms `cubic-bezier(.22,1,.36,1)` 滑入；新页使用不透明纸面覆盖退出页，避免两层文字混合。退出页只移动并淡出，页面外壳本身不淡出。减少动态效果时即时切换。
- 章节栏使用 tab/tabpanel 语义，方向键前后移动并同步焦点；号码与两行标题共享同一垂直中心线。宽度不超过 900px 或高度不超过 800px 时改为 4 列网格，高度不超过 600px 的横屏改 7 列单行；移动端关键入口不小于 44px。
- 课题卷宗、预审、匹配、趋势和用户管理分别使用 7、5、5、4、3 个章节。报告或列表内容过长时用页内分项，不允许把主页面撑出视口。
- `/welcome` 只承载总览与当前卷宗提示，不再嵌入其他任务工作面。问答与图谱在窄屏使用互斥分区；图谱在宽度不超过 1050px 或高度不超过 720px 时切换分区，720×450 下仍保留至少 100px 的可拖动画布。文档中心固定左目录与右书页，矮屏压缩页头和工具条；聊天消息、证据、正文和图谱仅在各自固定窗格内滚动。预审打印使用独立完整报告，不受当前章节限制。

- 桌面工作面步骤栏随可用高度分布步骤，栏头以淡青色块与短色条建立层次；矮屏和窄屏保持原有紧凑步骤布局，不减少正文空间。
- 顶栏上传入口旁提供青绿纸色、黑白、深海蓝和极光紫主题选择；使用浏览器本地存储并跨页保留。黑白主题只收束界面外壳，警告、错误、图表类别和内容预览保留可辨颜色。系统栏和数据表随主题使用青绿、石墨、深蓝、紫色渐变与白色文字；系统栏从侧栏右缘无缝贯穿到窗口右边，不渲染为独立卡片；窄屏主题入口保持 44px 并允许键盘操作。
- 主题旁提供“简约”开关并写入浏览器本地存储；开启后 `html[data-simple-mode="true"]` 关闭 CSS 动画、过渡、平滑滚动及 `motion.ts` 控制的 Framer/rAF 动效，隐藏 Lucide 装饰图标和背景纹理，保留菜单、关闭、上传、用户等纯图标操作。文档目录行在图标隐藏后重排为单个文字轨道，不得保留图标列或把标题挤成纵向单字。≤400px 时独立开关收进主题面板，避免挤压标题；主题面板中的开关仍使用 `aria-pressed` 和动态可访问名称。
- 查重匹配完成后保持“运行检查”章节，结果只更新当前页 KPI，用户自行进入查重结果、专家候选、回避边界或专家库；不得在成功回调中自动切页。
- 预审结论概览在风险摘要之前显示免责声明，在摘要中显示能力边界，结论页自身获得纵向滚动；风险等级、报告摘要和边界不得只在后续章节出现。页脚免责声明在 1280×720、横屏手机和文档任务态延续显示，只缩字号与间距，不折叠。
- `ReviewPage` 与 `MatchPage` 的文档切换 effect 只跟随 `activeDocId` 和“当前 ID 是否存在”的布尔变化；`docs` 数组因上传、导入或删除无关资料而刷新时，不得清空当前报告或检查结果。顶部卷宗/申报书切换同步问答 `selectedDocs` 并清空旧消息和引用；从侧栏进入“智能问答”保留手工多文档范围。
- 查看者不显示“发起预审”。人工确认材料使用显式按钮和确认对话框，不再在勾选时直接写入。章节 rail 的触控目标在横屏、矮屏和 80%–500% 缩放下均保持至少 44px。
