# 浏览器回归

测试代码随项目交付，任何 harness 都调用相同命令。无须修改本机 8010 服务或开发数据库。

## 首次安装

在仓库根目录安装后端依赖（`python3 -m pip install -r requirements.txt`），然后：

```bash
cd frontend
npm ci
npx playwright install chromium
```

Linux CI 使用 `npx playwright install --with-deps chromium`。Python 不在默认 PATH 时，设置 `E2E_PYTHON` 为项目环境的 Python 完整路径，例如 `E2E_PYTHON=/opt/anaconda3/bin/python3 npm run test:e2e`。

## 日常运行

```bash
npm run test:e2e:types  # 测试脚本本身的类型检查
npm run test:e2e:smoke  # 构建后执行关键流程
npm run test:e2e        # 构建后执行全部桌面/手机测试
npm run test:e2e:report # 打开最近的 HTML 报告
```

调试单个用例：先运行 `npm run build`，然后 `npx playwright test --grep '旧匹配请求' --headed`。

当前共 59 个用例。

## 覆盖矩阵

| 文件 | 覆盖 |
|---|---|
| auth.spec.ts | 四角色登录、UI权限、真实接口403、退出失效、错误密码恢复、会话恢复/清理、创建及重复账号 |
| library.spec.ts | 上传、索引、问答范围和预审跳转、取消/确认删除、文件类型/年份校验、上传失败重试、文献CSV幂等、空库 |
| review-match.spec.ts | 真实离线预审和能力边界、锁定/重复运行保护、错误恢复、真实回避依据及CSV归一、旧请求竞态、两个报告实际下载内容、受控模型展示模式下真实政策原文展开/收起与导出引用 |
| knowledge-document.spec.ts | 知识图谱统计/筛选/搜索/最短路径/大模型跳转；文档中心正文、目录深链、浏览器返回和手机目录焦点 |
| chat-trend.spec.ts | 真实离线SSE及引用、跨页保留/清空、旧引用、流错误恢复、离页取消、输入法/换行、趋势主题年份/2D、无WebGL、空文献、DeepSeek/千问来源快照、离线回退与提前断流 |
| route-arrival.spec.ts | 单页工作区外壳跨功能复用；1440/1920/2560px 卷宗栏与操作不重叠；桌面/手机真实动画事件、重复进入/返回重播、输入与查询不重播、运行期减少动态效果；自然连续播放，逐帧核验背景box始终不存在、正文不透明及手机抽屉退场边界；保留录像与截图 |
| zoom-layout.spec.ts | 80%–200% 缩放的等效 CSS 视口下检查各工作区、单行功能索引和上传入口；不替代真实浏览器缩放审查 |
| infrastructure.spec.ts | 隔离后端被信号终止后的退出和临时目录清理 |
| mobile.spec.ts | 375px导航遍历/宽度/焦点、320–900px上传按钮断点、上传焦点陷阱、证据换行及下载、正常动效和运行期减少动态效果 |

正常流程调用真实后端；模拟响应仅用于明确命名的受控网络故障、竞态和空库展示。Chromium 桌面和375px触屏视口不等同于Safari、Firefox或真机兼容性认证。用例不验证真实大模型回答质量。

## 隔离与失败证据

每个用例独立启动回环随机端口及 `yanxin-e2e-*` 系统临时目录，加载合成种子和本地公开政策。显式关闭模型/嵌入请求、真实申请书种子、公共出口授权和Secure Cookie，覆盖工作区 `.env` 对测试的影响。禁止非本服务源的浏览器HTTP请求。无需固定端口，无需复用已运行服务。用例完成即终止进程并移除临时数据库。

失败时 `test-results/` 与 `playwright-report/` 保存截图、录像、trace、后端日志和浏览器诊断（API路径/状态，无请求体）。查看trace：`npx playwright show-trace test-results/<失败用例>/trace.zip`。CI 保留报告7天；附件含合成测试会话，仍不得提交仓库或公开发布。生成目录已在 `.gitignore` 排除。

## 接入 harness

一轮前端修改结束后调用上述命令，失败则读取报告并修复，再跑失败用例及相关流程。不要每次保存都跑全套，不要绕过失败后提交，不要使用开发库运行破坏性测试。大改仍需实际页面与代码审查。GitHub Actions 在push、PR或手动触发时执行全套；是否设为合并必需检查由仓库规则决定。

模型来源新增受控验证：DeepSeek、千问与离线回退逐条保留来源，提前 EOF 标为中断；手机320/375/680px显示当前模型且上传按钮仍44px。预审页面与 Markdown 导出来源一致。所有模型响应均为测试夹具，不向供应商发请求。

问答模型选择回归使用受控模型目录和 SSE，验证参数、实际来源、禁用选项、焦点及 320/375/680px 布局；不调用真实模型。

单页工作区覆盖：工作台选择申报书后跨预审、匹配和问答传递；访客快捷问答、政策资料不覆盖申报书、文档筛选、手机引用定位与焦点恢复；生成页面截图用于实际审查。
