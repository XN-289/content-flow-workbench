# 前端架构规范（FRONTEND_ARCHITECTURE.md）

更新时间：2026-10-22
适用范围：`web/src/**`、`web/vite.config.ts`、`web/tsconfig.json`、前端构建与静态托管脚本
配套文档：`DESIGN.md`（视觉与交互契约）、`docs/UI_RUNTIME.md`（当前运行方式）、`AGENTS.md`（执行手册）

本文记录已经落地的工程架构，不描述尚未采用的框架方案。文档冲突时按以下优先级处理：

1. 业务底线与数据状态机
2. `DESIGN.md`
3. 本架构规范
4. 运行说明与迁移记录

---

## 0. 当前工作域与成品入口

| 路径 | 工作域 | 当前职责 |
| --- | --- | --- |
| `/` | 总览 | 今日状态、行动队列、平台信号概况与晨间流水线运行入口 |
| `/flow` | 信息流 | Inbox 分诊、证据与平台能力矩阵 |
| `/workflow` | 工作流 | 选题、阶段门槛、生产、发布台账与复盘 |
| `/system` | 系统 | 采集指挥中心、自动化与 Agent 桥接配置 |

平台能力矩阵已进入信息流页，覆盖 X、小红书、抖音、公众号的列表、详情、评论、正文、媒体和逐字稿能力；晨间流水线已进入总览与系统页，六段执行状态和最近运行来自 `/api/state`。两者都是当前成品功能，不是后续示意。

## 1. 技术选型

**React 19 + TypeScript 5.7 + Vite 6 + 纯 CSS tokens + 内嵌 SVG 图标。**

| 决策 | 当前实现 | 原因 |
| --- | --- | --- |
| React 19 + TypeScript | `web/src` 使用函数组件、Context 和本地状态 | 将旧单文件模板拆成可验证的工作域与公共组件 |
| Vite 6 | `web/vite.config.ts` + `@vitejs/plugin-react` | 提供 TypeScript 转译、开发热更新和生产构建 |
| 纯 CSS | `tokens.css` 语义变量 + `app.css` 的 `@layer` | 不引入额外样式运行时，主题和组件规则可直接审查 |
| 内嵌 SVG | 图标直接写在 React 组件中 | 当前不需要图标包；尺寸、描边和 `currentColor` 可完全控制 |
| 浏览器路径 | `/`、`/flow`、`/workflow`、`/system` | 工作域可直接收藏和刷新，不依赖页面片段 |

约束：

- 不引入第二套样式系统、UI 组件库或图标组件库。
- 不引入全局状态库。服务端状态、主题、选择状态和浮层状态沿用 `web/src/state/store.tsx` 与局部 `useState`。
- 不引入额外路由依赖；工作域使用原生浏览器路径与 History API，深链由主服务 SPA 回落承接。
- 不把 React 组件重新写回字符串模板，不使用 `innerHTML` 渲染业务内容。
- 新增依赖必须先说明它替代的真实复杂度；仅为单个控件引入 UI 框架不成立。

## 2. 实际目录结构

```text
web/
├─ index.html
├─ package.json
├─ tsconfig.json
├─ vite.config.ts
└─ src/
   ├─ main.tsx
   ├─ App.tsx
   ├─ components/
   │  ├─ AppShell.tsx
   │  └─ primitives.tsx
   ├─ features/
   │  ├─ overview.tsx
   │  ├─ flow.tsx
   │  ├─ workflow.tsx
   │  └─ system.tsx
   ├─ lib/
   │  ├─ api.ts
   │  ├─ constants.ts
   │  ├─ format.ts
   │  └─ types.ts
   ├─ state/
   │  └─ store.tsx
   └─ styles/
      ├─ tokens.css
      └─ app.css
```

相关工程文件：

```text
scripts/
├─ build-ui.mjs       # 构建 React 前端到 app/dist
└─ server.mjs         # 5177 单端口：React 静态托管 + 数据和 API

app/
├─ dist/              # 当前稳定构建产物，生成文件，不是源码
├─ app.js / styles.css / index.html  # 历史 UI，仅作留存
└─ ui-*/              # 历史时间戳产物，不参与当前成品
```

规则：

- 所有前端源码只改 `web/src`。
- `app/dist` 是构建结果，不手工编辑；`npm start` 只读取它，不会隐式重建。
- `app/app.js`、`app/styles.css`、`app/index.html` 与 `app/ui-*` 不再是成品入口，不得继续追加功能或覆盖样式。
- 成品不使用 `scripts/ui.mjs`、`scripts/ui-server.mjs`、独立 UI 端口或 API 代理；这些历史链路只用于解释旧版本。
- feature 之间不直接依赖内部实现；跨域复用进入 `components/` 或 `lib/`。

## 3. 状态模型

| 状态 | 归属 | 持久化 | 说明 |
| --- | --- | --- | --- |
| sources、signals、topics、runs 等业务状态 | `StoreProvider` | 不持久化 | 每次从 `/api/state` 获取，服务端是唯一事实源 |
| 主题三态 | `StoreProvider` | `localStorage["cfw.theme"]` | `auto/light/dark`，首屏前写入 `data-theme`，避免闪烁 |
| 当前工作域 | `StoreProvider` | 浏览器路径 | `/`、`/flow`、`/workflow`、`/system`；刷新与前进后退保持一致 |
| 当前选题 | `StoreProvider` | `localStorage["cfw.topic"]` | 只保存选择，不缓存业务对象副本 |
| Sheet、Tab、筛选等界面状态 | 组件局部状态 | 按需持久化 | 关闭后可丢弃的 UI 状态不回写业务数据 |

约束：

- 默认工作域是 `/`；导航只改变浏览器路径，不新增查询参数或页面片段来表达工作域。
- 主服务对未知页面路径回落到 `app/dist/index.html`，但缺失的 `/assets/**` 和带扩展名资源必须返回 404。
- 业务数据不得以 `localStorage`、Context 副本和组件 state 形成多个事实源。
- 写操作执行后重新获取服务端状态，不乐观改写阶段、发布状态或校验结果。
- 阶段推进、生产检查、发布记录和复盘门槛最终由 `scripts/server.mjs` 校验；前端可以提前解释阻塞原因，但不能自行宣称成功。

## 4. 数据访问边界

- 组件不直接调用 `fetch`，统一通过 `web/src/lib/api.ts`。
- API 类型集中在 `web/src/lib/types.ts`；不得在组件内复制另一套响应结构。
- `/api/state` 是主读取入口；写操作完成后通过 store 的 `mutate` 或 `refresh` 重取状态。
- 错误必须保留为可见失败态，包含原因、排查路径和重试。不得把受阻、待人工、本地演练显示成完成。
- API 路由、请求/响应语义和 `data/workbench.json` 顶层结构不因前端重构而改变。

## 5. 样式与 token

### 5.1 事实源

- 视觉规则、组件状态与可访问性规则：`docs/DESIGN.md`
- 设计 token 文档镜像：`docs/design-tokens.css`
- 前端构建实际引用的运行时 token：`web/src/styles/tokens.css`
- 两份 token 文件必须保持相同变量名和浅色/暗色值。修改时在同一次变更中同步。
- 任何新增或修改 token 都必须先说明语义用途，再同步文档镜像与运行时文件。

### 5.2 使用规则

1. 组件只使用语义 token，例如 `var(--surface)`、`var(--ink-muted)`、`var(--danger)`；禁止在组件 CSS 中新增原始色值。
2. 浅色是默认值，暗色只通过 `[data-theme="dark"]` 覆盖。
3. `web/src/styles/app.css` 只允许使用 `reset`、`layout`、`components`、`utilities` 四层。
4. 禁止在文件尾部追加覆盖式规则；修复应进入原规则或对应组件层。
5. 静态表面靠 `--surface-sunken`、发丝边框和间距建立层级；阴影只用于 Sheet、对话框等浮层。
6. 状态同时使用文字、位置和颜色表达；不得只靠色点或柔和底色。

当前浅色表面阶梯统一为冷灰：

| Token | 值 |
| --- | --- |
| `--canvas` | `#F6F7F9` |
| `--surface-sunken` | `#F1F3F6` |
| `--surface-hover` | `#E9ECF1` |
| `--hairline` | `#E3E7ED` |
| `--hairline-strong` | `#D3D9E2` |
| `--ink-muted` | `#4A5567` |

暗色表面阶梯、状态四族和主行动色继续沿用 `docs/DESIGN.md` §5 与 token 文件，不得在组件中另起颜色。

## 6. 组件与可访问性

- `components/primitives.tsx` 提供 Button、StatusChip、Card、QueueRow、Checklist、StageStepper、Sheet 等通用原语。
- `components/AppShell.tsx` 提供桌面三区骨架和移动端上下文 Sheet；页面不各自复制外壳。
- 图标使用内嵌 SVG，默认 `16px`、`stroke-width="1.75"`、`stroke="currentColor"`。有可见文字时图标 `aria-hidden="true"`；纯图标按钮必须有 `aria-label`。
- Sheet 打开后焦点进入浮层，Tab 与 Shift+Tab 在浮层内循环，Escape 关闭，背景滚动锁定，关闭后焦点回到触发元素。
- 所有交互控件必须有默认、悬停、聚焦、禁用状态；异步动作增加进行中状态，读取失败增加错误状态。
- 移动端触控目标不小于 44×44px；不能通过缩放桌面三列来替代移动端重排。
- 任何视口都不得出现横向溢出、文字遮挡或状态文案截断。

## 7. 构建与运行边界

成品模式：

```powershell
cd D:\personal-content-workbench
npm run build:ui
npm start
```

打开 `http://127.0.0.1:5177/`。`scripts/server.mjs` 在单一端口同时提供：

- `app/dist/**` 下的 React 构建产物；
- `/api/**` 下的工作台接口；
- `/`、`/flow`、`/workflow`、`/system` 的 SPA 深链回落；
- 缺失静态资源的 404 与越界路径的 403。

`npm start` 不会隐式构建前端。改了 `web/src/**` 或 token 后，必须先运行 `npm run build:ui`，再重启服务。详细行为以 `docs/UI_RUNTIME.md` 为准。

开发模式需要两个进程：

```powershell
# 终端 1：数据、API 与已构建页面的主服务
cd D:\personal-content-workbench
npm start

# 终端 2：Vite 热更新
cd D:\personal-content-workbench\web
npm run dev
```

Vite 开发页默认是 5181，并只在开发期把 `/api` 代理到 5177。成品运行没有第二个 UI 服务，也没有 API 代理。

工程约束：

- 构建输出固定为 `app/dist`，入口固定为 `app/dist/index.html`；`emptyOutDir: true` 会清空旧产物，随后由 `scripts/build-ui.mjs` 回填 `capture-bridge.html`，避免历史 hash 文件累积。
- `scripts/server.mjs` 的数据与 API 契约保持稳定，并负责静态路径边界。
- 静态托管不得把 `/assets/*` 的 404 错误地回退成 `index.html`；SPA 仅对页面路由回退。
- 前端源码变更后必须重新构建、重启并确认页面引用最新 bundle。
- 当前 TypeScript 配置尚未启用 `strict`；新代码不得用 `any` 掩盖接口不确定性，后续可单独收紧。

## 8. 验证

每轮涉及前端或 token 的变更至少执行：

```powershell
node --check scripts/build-ui.mjs
node --check scripts/server.mjs
npm run build:ui
npm run test:chain
```

启动 `npm start` 后补充单端口检查：

```powershell
Invoke-WebRequest http://127.0.0.1:5177/ -UseBasicParsing
Invoke-WebRequest http://127.0.0.1:5177/flow -UseBasicParsing
Invoke-WebRequest http://127.0.0.1:5177/workflow -UseBasicParsing
Invoke-WebRequest http://127.0.0.1:5177/system -UseBasicParsing
Invoke-WebRequest http://127.0.0.1:5177/api/state -UseBasicParsing
```

浏览器验收覆盖：

- 1440×1000 桌面、390×844 与 375×812 移动视口；涉及移动 Sheet 时补横屏。
- 浅色、暗色和系统自动主题。
- 总览、信息流、工作流、系统四个工作域。
- 空数据、最小数据、API 失败、加载、待人工、受阻、完成与本地演练状态。
- 无横向溢出、无控制台异常、无 `undefined`、`NaN`、`[object Object]` 或 `Invalid Date`。
- Sheet 焦点进入、Tab 循环、Escape 关闭与焦点恢复。
- `prefers-reduced-motion: reduce` 下状态仍可理解，Sheet 背景不透明且不与底层文字重叠。

测试失败必须保留真实原因。不得为了通过验收而修改真实业务数据、伪造 API 成功或跳过服务端状态机。

## 9. 不应做的事

- 不改 `data/workbench.json` 顶层结构。
- 不新增、删除或改名 API 路由而不同步服务端和回归测试。
- 不在组件中写原始色值、暗色分支或第二套 token。
- 不在文件尾部追加覆盖 CSS，不用内联样式绕过设计 token。
- 不绕过阶段门槛、登录墙、验证码或平台风控。
- 不上传真实账号、评论、媒体、证据、逐字稿或本地数据到外部服务。
- 不将 `PROJECT_STATE.md`、`work/`、截图、报告和真实数据作为普通前端交付物提交。
