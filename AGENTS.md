# AGENTS.md — 给后续所有 Agent 的工作手册

> 你正在（或即将）接手 Content Flow Workbench。
> 本手册解决两件事：**按什么顺序读文档**，以及**改完怎么算完成**。

---

## 0. 三十秒上手

```powershell
cd D:\personal-content-workbench
npm run build:ui
$env:AUTOMATION_ENABLED="false"   # 验收期间关闭，避免后台采集改动真实数据
npm start
# 打开 http://127.0.0.1:5177/
```

`scripts/server.mjs` 在同一个 5177 端口托管 `app/dist` 的 React 成品与 `/api/**`。`npm start` 不会隐式构建前端；改了 `web/src/**` 后先运行 `npm run build:ui`，再重启服务。

验收期间不要打开自动化，不要把 `data/workbench.json` 的真实内容外传。验收完成后按用户当前意图恢复自动化状态。

## 1. 必读顺序（不要跳）

1. `AGENTS.md`（本文件）——怎么工作。
2. `docs/AGENT_COORDINATION.md` ——单一源码、分支边界、冲突解决与最终合并门槛。
3. `docs/DESIGN.md` ——视觉与交互契约，**改 UI 前必读**。
4. `web/src/styles/tokens.css` 与 `docs/design-tokens.css` ——运行时 token 与文档镜像，两处必须同步。
5. `docs/UI_RUNTIME.md` ——当前构建、单端口运行和开发模式。
6. `docs/FRONTEND_ARCHITECTURE.md` ——React 代码结构、状态与静态托管边界。
7. `handoff/UI_AUDIT.md`、`handoff/FRONTEND_CONTEXT.md`、`handoff/VERIFICATION_AND_RISKS.md` ——现状、数据、风险。
8. `docs/workbench-ui-principles.md` ——业务侧不可破坏的底线。

**冲突优先级**：业务底线（数据/状态机/安全） > 单一源码规则 > `docs/DESIGN.md` > `docs/FRONTEND_ARCHITECTURE.md`。具体命令与当前运行事实以根 `package.json`、相关脚本和 `docs/UI_RUNTIME.md` 为准；文档冲突时先修正文档。

## 2. 不可破坏（改 UI 也不许动）

- 数据结构与 API 契约；`npm run test:chain`（41 项）必须通过。
- 选题状态机：`topic → outline → draft → production → review → ready-to-publish → published → reviewed`，门槛由服务端校验。
- 诚实语义：`本地演练`、`blocked`、`待人工`、`unverified`、采集失败，必须显式呈现，不能伪装成成功。
- 平台能力矩阵只能使用 `complete / partial / unsupported / unknown`，登录墙和人工可见范围不能被写成完整自动采集。
- 晨间流水线的六段状态和最近运行必须来自真实运行结果；待人工不是因为视觉需要而改色或消失。
- 安全边界：不保存 Cookie/登录态，不绕过验证码，不把受限采集写成完整采集。
- 隐私：真实账号、笔记、评论、媒体、证据、逐字稿只在本地使用，不上传公共仓库/图床/外部服务。

## 3. 改 UI 的标准动作

1. 在 `docs/DESIGN.md` 里找到对应规则；**找不到就先补规则**。
2. 只使用 `web/src/styles/tokens.css` 中的语义 token（`--surface`、`--ink-muted`、`--warning-soft`…），禁止组件内写原始色值。
3. 修改 token 时一起检查 `docs/design-tokens.css`，确保变量名、浅色值和暗色值一致。
4. 四个工作域只使用浏览器路径：`/`、`/flow`、`/workflow`、`/system`；页面刷新和直达由单端口 SPA 回落承接。
5. 一次只改一层：token 与组件实现分开，避免无法定位视觉回归来源。
6. 遵循组件准入条件：对应真实动作 / 至少两处复用 / 六态齐全。
7. 完成后跑闸门（见 §4），保留桌面、移动和暗色截图。
8. 在 `docs/DECISIONS.md` 追加一条：做了什么 / 为什么 / 放弃了什么。

## 4. 完成定义（DoD）

- [ ] `npm run verify:workbench` 全部通过；它顺序覆盖语法、41 项主链路、后端流水线、信源、批量采集、插件、TypeScript、diff 与 UI 构建
- [ ] `app/dist/index.html` 存在，且本轮资源由 `npm run build:ui` 重新生成
- [ ] 在 `AUTOMATION_ENABLED=false` 下，`/`、`/flow`、`/workflow`、`/system` 与 `/api/state` 均返回 200
- [ ] 缺失 `/assets/**` 返回 404；越出 `app/dist` 的路径返回 403
- [ ] 截图：1440×1000、390×844、375×812、深色模式；涉及移动浮层时补横屏
- [ ] 三态主题（自动/浅色/深色）可用，显式选择刷新后保持
- [ ] 键盘可达主路径，焦点可见不被遮挡；触控目标 ≥44px
- [ ] 空/加载/失败/待人工/禁用/阻塞/完成/本地演练/unverified 状态均有设计
- [ ] 无横向溢出、无文字遮挡、无控制台错误
- [ ] `prefers-reduced-motion: reduce` 下没有依赖位移才能理解的状态
- [ ] 未编辑 `app/dist` 生成文件，未在旧文件尾部追加覆盖规则
- [ ] `docs/DECISIONS.md` 已记录
- [ ] 发布 / 交接终态已合并所有 Agent 分支，并在推送后通过 `npm run verify:source`

## 5. 命令速查

```powershell
# 一键验收：语法、41 项主链路、后端、信源、批量、插件、类型、diff、UI 构建
npm run verify:workbench

# 只定位业务链路回归（41 项）
npm run test:chain

# 单一源码终态检查；要求 main 干净且已推送
npm run verify:source

# 构建与主服务语法检查
node --check scripts/build-ui.mjs
node --check scripts/server.mjs

# 单端口验收；页面和 API 同时监听 5177
$env:AUTOMATION_ENABLED="false"; npm start
Invoke-WebRequest http://127.0.0.1:5177/ -UseBasicParsing
Invoke-WebRequest http://127.0.0.1:5177/flow -UseBasicParsing
Invoke-WebRequest http://127.0.0.1:5177/api/state -UseBasicParsing
```

需要 Vite 热更新时，终端 1 运行 `npm start`，终端 2 进入 `web/` 运行 `npm run dev`。开发页是 5181，`/api` 只在开发期代理到 5177；成品仍只有一个 5177 服务。

## 6. 禁止事项

- ❌ 手工修改 `app/dist`，或在 `app.js`、`app/styles.css` 等历史文件尾部继续叠加功能。
- ❌ 把 `scripts/ui.mjs`、`scripts/ui-server.mjs`、`app/ui-*` 时间戳目录或第二套静态服务重新当作成品入口。
- ❌ 另起 UI 端口或在成品链路增加 `/api` 代理；成品必须由 `scripts/server.mjs` 同端口托管。
- ❌ 把工作域状态改成查询参数、页面片段或组件内部隐式状态，绕开上述四个浏览器路径。
- ❌ 在组件里写 `#2563EB` 这类原始色值，或引入第二套样式/UI 框架。
- ❌ 引入第二个强调色，或用状态色做装饰。
- ❌ 把跳过、失败、blocked、待人工或 unverified 显示为成功。
- ❌ 一次性全页重写后再补规则；应先满足 `docs/DESIGN.md` 与六态定义。
- ❌ 修改 UI 断言去迁就旧 class 名；应按角色、文案和可见行为断言。
- ❌ 关闭自动化开关后忘记按用户意图恢复。
- ❌ 在独立 worktree、未合并分支或 stash 中留下“已完成”的代码后宣称交付。
- ❌ 两个 Agent 同时写同一 worktree，或用强制推送、整文件覆盖解决协作冲突。

## 7. 交接给下一任时的最小交付

1. 可运行的 React 成品与最新 `app/dist` 构建结果。
2. 四工作域 + 三视口 + 暗色截图。
3. `npm run verify:workbench` 结果与单端口 HTTP 检查结果。
4. `docs/DECISIONS.md` 新增条目。
5. 最终提交 SHA、已合入分支、`npm run verify:source` 结果。
6. 仍未完成项与已知风险，明确写出来。
