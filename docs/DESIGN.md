---
name: Content Flow Workbench
version: 1.1.1
updated: 2026-10-22
product: 本地单人内容生产工作台（Windows 桌面形态，当前为 127.0.0.1 Web 壳）
audience: 每天早上使用的单个内容创作者（非设计师、非团队、非营销官网）
density: compact
theme_modes: [auto, light, dark]
canonical_tokens_file: docs/design-tokens.css
fonts:
  ui_latin: Inter
  ui_cjk: Noto Sans SC
  mono: "JetBrains Mono"
colors:
  canvas: "#F6F7F9"
  surface: "#FFFFFF"
  surface_sunken: "#F1F3F6"
  surface_hover: "#E9ECF1"
  ink: "#10141C"
  ink_muted: "#4A5567"
  ink_subtle: "#778291"
  hairline: "#E3E7ED"
  action: "#2563EB"
  action_soft: "#EEF3FF"
  success: "#0F7A52"
  warning: "#9A5B00"
  danger: "#B42318"
  candidate: "#6941C6"
typography:
  text_2xs: 12px
  text_sm: 13px
  text_base: 14px
  text_lg: 16px
  text_xl: 18px
  text_2xl: 20px
  weights: [400, 500, 600]
spacing:
  base: 4
  scale: [4, 8, 12, 16, 20, 24, 32, 40]
radius:
  chip: 6px
  control: 8px
  card: 10px
  panel: 12px
  sheet: 16px
  pill: 999px
elevation:
  policy: 仅浮层使用阴影；静态卡片一律靠表面阶梯 + 1px 发丝边框
motion:
  durations: {micro: 120ms, panel: 200ms}
  easing: cubic-bezier(.2,.8,.2,1)
icons:
  library: inline-svg
  size: 16px
  stroke: 1.75
---

# Content Flow Workbench — 设计契约（DESIGN.md）

> 本文件是**视觉与交互的唯一事实来源**。任何 AI 或人类在改动 UI 前必须先读它；
> 规则缺失时**不要即兴发挥**，先补规则再实现。目标：让不同的人在不同的会话里做出来的界面，
> 看起来像是同一个设计师的连续作品。

---

## 1. 产品气质（一句话）

**「把信号变成作品的晨间生产线」**：安静、密集、可信、克制。
它是一个工具，不是一个网站；是创作者的工作台，不是给别人看的作品集。

三个词：**可扫描（scannable）· 有结论（decisive）· 诚实（honest）**。

- **可扫描**：一屏能判断优先级；信息用密度和层级组织，不靠留白和折叠隐藏。
- **有结论**：每个视图只回答一个问题，只有一个主行动，其余降级为次要或收进检查器。
- **诚实**：失败、阻塞、待人工、本地演练、未校验，一律显式呈现，绝不伪装成成功。

## 2. 明确放弃什么（Do Not）

| 禁止 | 原因 |
| --- | --- |
| 静态卡片上的阴影、发光、渐变 | 层级靠表面阶梯和发丝边框，阴影会让界面「糊」 |
| 卡片套卡片 | 每层容器都必须有独立信息职责；嵌套卡片等于噪音 |
| 一屏两个主行动 | 焦点分散等于没有焦点 |
| 只用颜色表达状态 | 色觉差异用户与灰度打印都会失效 |
| 原始色值（`#2563EB`）出现在组件里 | 破坏主题切换与后续 AI 迭代；只允许语义 token |
| emoji / Unicode 符号充当图标 | 跨平台字形不可控；统一用内嵌 SVG 图标 |
| 在文件尾部追加覆盖样式 | 覆盖式 CSS 是当前项目最大的技术债，禁止复现 |
| 装饰性动效、渐变背景、大插画 | 高频工具需要安静，动效只表达状态与空间关系 |
| 把桌面两列在手机上折成一列 | 移动端要重新定义任务顺序，不是缩放 |
| 第二个强调色 | 主行动色唯一；状态色语义固定，不得挪用 |

## 3. 布局骨架

### 桌面（≥1280px，默认 1440×1000）

```
┌──────────────────────────────────────────────────────────────┐
│ TopBar 56px：品牌 · 四域导航 · 状态芯片 · 主题三态 · 主行动入口   │
├────────────┬─────────────────────────────┬───────────────────┤
│ Queue      │ Canvas（主画布，视觉重心）    │ Inspector（检查器） │
│ 260px      │ 1fr，最小 640px             │ 300px             │
│ 可扫描队列 │ 当前对象 + 唯一主行动         │ 证据/时间线/风险   │
└────────────┴─────────────────────────────┴───────────────────┘
```

- Grid：`grid-template-columns: 260px minmax(640px, 1fr) 300px`
- 页面外边距 24px，卡片间距 16px，卡片内边距 16–20px。
- 左栏与右栏是**持久表面**（`--surface` + 单侧 1px 发丝边框），不是悬浮面板。
- 画布区允许 1 个大卡片或 2 个并排卡片；不允许 3 列以上等权布局。

### 移动（390px 为基准）

顺序固定为：**今天判断 → 当前对象 → 唯一下一步 → 检查器内容收进全屏 Sheet**。

- 顶部栏 52px；底部固定动作区（安全区内），不随内容漂移。
- 触控目标 ≥44×44；主行动按钮高度 48px。
- 阶段导航使用紧凑 stepper，**禁止横向滑动容器**。
- 任何断点都不得出现横向溢出。

## 4. 排版

- 字体：`Inter`（拉丁/数字）+ `Noto Sans SC`（中文），回退 `system-ui`。
- **中文正文行高不低于 1.6**；12px 仅用于 meta 与状态标签，不得用于正文。
- 字重只用 400 / 500 / 600。禁止 700+ 与斜体（数字强调除外）。
- 数字、字数、计数用 `font-variant-numeric: tabular-nums`，避免跳动。
- 中文排版细则：
  - 中文与英文混排时，中英文之间留半角空隙（写文案时主动加空格）。
  - 中文不做 italic，不用两端对齐（`text-align: justify`），不手动加字距。
  - 标题用 `letter-spacing: -0.01em` 收紧；正文不加字距。
- 关键数字（统计、计数、字数）：18–24px，字重 600，`tabular-nums`，颜色 `--ink`；单位与标签降级为 `--ink-subtle`。

| Token | 尺寸/行高 | 用途 |
| --- | --- | --- |
| `text-2xs` | 12 / 16 | meta、状态标签、辅助说明 |
| `text-sm` | 13 / 20 | 密集列表行、表格、按钮 |
| `text-base` | 14 / 22 | 正文、卡片正文、输入 |
| `text-lg` | 16 / 24 | 卡片标题 |
| `text-xl` | 18 / 26 | 区块标题、对象标题（移动端）、**关键数字** |
| `text-2xl` | 20 / 28 | 页面标题、对象标题（桌面） |
| `text-display` | 24 / 32 | 空状态与统计大数，**每屏最多一处** |

## 5. 颜色与状态语义

### 5.1 表面阶梯（Linear 式：层级靠阶梯，不靠阴影）

| Token | 浅色 | 深色 | 用途 |
| --- | --- | --- | --- |
| `--canvas` | `#F6F7F9` | `#0E1116` | 页面底 |
| `--surface` | `#FFFFFF` | `#151A21` | 卡片、左/右栏、顶栏 |
| `--surface-sunken` | `#F1F3F6` | `#1B222B` | 内嵌区块、表头、代码块 |
| `--surface-hover` | `#E9ECF1` | `#232B36` | 行 hover、选中行 |
| `--hairline` | `#E3E7ED` | `#242C37` | 1px 边框 |
| `--hairline-strong` | `#D3D9E2` | `#333D4A` | 输入框、聚焦前边框 |

### 5.2 文字

| Token | 浅色 | 深色 | 用途 |
| --- | --- | --- | --- |
| `--ink` | `#10141C` | `#E9ECF1` | 标题、正文关键值 |
| `--ink-muted` | `#4A5567` | `#98A3B3` | 正文、描述 |
| `--ink-subtle` | `#778291` | `#6C7787` | meta、时间戳、次要计数 |
| `--ink-on-action` | `#FFFFFF` | `#FFFFFF` | 主行动按钮文字 |

对比度底线：正文 ≥4.5:1，次级文字与边框 ≥3:1。

### 5.3 状态四族（每族固定 token + 固定文案，禁止挪用）

| 族 | Token（前景 / 柔和底） | 语义 | 必须同时出现的文字 |
| --- | --- | --- | --- |
| 对象状态 | `--success` / `--success-soft` | 完成、已校验、已复盘 | 「完成」「已校验」 |
| 运行状态 | `--warning` / `--warning-soft` | 待人工、attention、部分完成 | 「待人工」 |
| 阻塞状态 | `--danger` / `--danger-soft` | 受阻、失败、登录墙 | 「受阻」「失败」 |
| 候选状态 | `--candidate` / `--candidate-soft` | 待分诊、unverified、Agent 候选 | 「待分诊」「unverified」 |
| 演练/中性 | `--ink-muted` / `--surface-sunken` | 本地演练、未启用、无数据 | 「本地演练」 |

规则：
1. 状态**至少三重编码**：颜色 + 文字 + 位置（顶部条 / 行内 chip / 右侧检查器）。
2. `本地演练`、`blocked`、`待人工`、`unverified` 是产品语义，**不得省略、不得合并、不得用中性色**。
3. 危险色只用于真实阻塞或破坏性动作，不用于「需要注意一下」。

### 5.4 主行动色

`--action #2563EB`（深色模式 `#3F7BF0`），`--action-soft #EEF3FF`（深色 `#16233D`）。
仅用于：主按钮、当前导航项、焦点环、可交互链接、品牌标识。**不得用于装饰、不得大面积铺底。**

> 品牌标识是唯一的例外：品牌 logo 允许使用主行动色的**轻微渐变**（135°，`--action` → `--action-hover`），
> 这是为了让产品在一堆中性表面里有可辨识的“签名”，不违反“卡片禁渐变”——该约束只针对内容卡片。

### 5.5 画布节奏

桌面画布区顶部允许一个**今日结论条**（晨报摘要）：一条细长发丝面板，
内容是「日期 + 一句话结论 + 2–4 个关键数字」，字号 `text-sm`，不占视觉重心。
它解决的是“总览一打开就知道今天什么状态”——这是本产品的第一个动作。

## 6. 组件规范

> 尺寸为基准值；实现时用 token 表达，不写魔法数字。

### Button
| 变体 | 高度（桌面/移动） | 背景 | 边框 | 文色 | 用法 |
| --- | --- | --- | --- | --- | --- |
| primary | 32 / 48 | `--action` | 无 | `--ink-on-action` | 每屏最多 1 个 |
| secondary | 32 / 44 | `--surface` | 1px `--hairline` | `--ink` | 次要动作 |
| ghost | 32 / 44 | 透明 | 无 | `--ink-muted` | 三级动作、工具栏 |
| danger | 32 / 44 | `--danger` | 无 | `#FFF` | 破坏性动作，需二次确认 |

- 水平内边距 12px（ghost 8px），圆角 `--radius-control`，字重 500/600。
- 禁用：`opacity .5` + `cursor: not-allowed`，**必须保留可读性**。

### StatusChip
- 高度 20px，圆角 `--radius-pill`，左右内边距 10px，`text-2xs` 字重 500。
- 背景为对应 `-soft`，文字为对应前景色；**不得只用实心色块**。
- 深色模式下 chip 额外带 1px `rgba(255,255,255,0.08)` 边框，保证软底在暗面上可读。

### Card / Panel
- 背景 `--surface`，1px `--hairline`，圆角 `--radius-card`，内边距 16–20px。
- 标题 16/600，`letter-spacing: -0.01em`；正文 14/22；meta 12/16 `--ink-subtle`。**卡片内不再放卡片。**
- 卡片 hover 只允许：1px 边框加深到 `--hairline-strong`，或整体 `translateY(-1px)`；**禁止加阴影**。
- 卡片内部分区用 1px `--hairline` 分隔线 + 16px 间距，不用嵌套卡片。
- 区块小标题（section-label）：11px / 500 / `--ink-subtle` / `letter-spacing: 0.02em`（中文不加字距）。

### QueueRow（Raycast 式密集行）
- 行高 36px，圆角 6px，hover `--surface-hover`；**行间用留白而非分隔线**。
- 左侧 8px 状态点 → 标题（13/500）→ meta（12）→ 右侧 chip → 可选计数。
- 选中态：**左侧 2px `--action` 指示条** + `--action-soft` 底，标题 `--ink`；不要整行变浅蓝。
- 列表内主行动**只出现在当前条目**（如 Inbox 中第一条待分诊信号），其余行一律降级为 secondary/ghost。

### Checklist（阶段完成面）
- 不用表单网格。用「图标 + 文字 + 状态词」的 32px 行。
- 通过项 `--success` 图标；未完成项 `--warning` 且文案写清缺什么。

### StageStepper
- 8 段固定顺序：`topic → outline → draft → production → review → ready-to-publish → published → reviewed`。
- 已完成：实心点 + `--ink-subtle` 标签；当前：2px 描边点 + 强调标签 + 文字「阶段：X」。
- **禁止用颜色区分已通过/未通过以外的语义**；门槛未过不显示为完成。

### Inspector（检查器）
- 时间线条目：8px 状态点 + 标题（12/600）+ meta（12）+ chip；条目间 12px 间距。
- 历史、版本、摩擦、风险都在这里，**不进主画布**。

### FormField / SideEditor
- 默认只读摘要 + 「编辑」按钮 → 从右侧滑出 Sheet（宽 420–480px）。
- 标签必须在字段上方，禁止只用 placeholder；错误信息紧贴字段下方。
- 输入类：1px `--hairline-strong`，圆角 `--radius-control`，高 36px（移动 44px）。
- 长文本类：草稿**自动保存**，不设底部大「保存」按钮；离开时提示未保存状态。

### EmptyState / Loading / Error
- 空状态：**一句原因 + 一个可行动的下一步**，居中放置，可用圆形图标底（40px，`--surface-sunken` + 内嵌 SVG 图标），不用插画。
- 空数据下**不得出现「已完成 / 全部通过」这类结论**——没有对象时没有状态，只有下一步。
- 加载：骨架块保持与内容同尺寸，禁止 spinner 顶替整页。
- 错误：**HTTP 状态码 + 一句原因 + 可操作的排查路径 + 重试**；把可复制的原始错误放次要位置，供排障使用。

### Sheet / Dialog / Toast
- 仅浮层使用阴影：`--shadow-overlay`。
- Sheet 从右侧滑入 200ms；`prefers-reduced-motion` 时降级为淡入。
- Toast 只承载「操作结果」，不承载状态；状态永远在它所属的对象旁边。

### TranscriptReader（宽版 Sheet）
- 已捕获的逐字稿必须可读，不能只停留在运行记录或状态 chip；入口文案固定为「查看逐字稿」。
- 阅读器使用 `Sheet.size="wide"`：桌面 680–760px，移动端全屏；正文阅读宽度不超过 68ch。
- 头部展示标题、来源、模型、媒体时长、字数、段数与生成时间；ASR 结果必须持续显示「unverified」与「ASR 候选稿，引用前需人工校对」。
- 「全文 / 时间轴」是同一对象的两种视图，用 Segmented 切换；全文可复制，TXT / JSON 可下载。
- 后台转写运行中必须显示当前阶段；失败保留可重试入口。轮询只刷新状态，不阻塞其他内容操作。

### 焦点与键盘
- 焦点环：2px `--action` + 2px offset，任何主题下都必须可见。
- Tab 顺序 = 视觉顺序；浮层打开时焦点进入浮层，关闭后回到触发元素。
- 所有图标按钮必须有 `aria-label`；快捷键提示用 `Keycap` 组件（11px，圆角 4px，`--surface-sunken`）。

## 7. 图标

- 统一**内嵌 SVG**（当前不依赖图标库，避免安装成本），16px，`stroke-width 1.75`，颜色继承文本色（`stroke="currentColor"`）。
- 图标旁已有文字时图标仅作装饰（`aria-hidden`）。
- 状态图标语义固定：check=完成、alert-triangle=受阻/待人工、clock=待人工、file-text=候选/未校验、flask=本地演练。
- 若未来经独立架构决策引入图标库，保持同样的尺寸与描边口径，不要混用两种图标体系。

## 8. 动效

- 只用于：状态切换、浮层进出、列表项插入。
- 时长：微交互 120ms，面板 200ms；缓动 `cubic-bezier(.2,.8,.2,1)`。
- 禁止：入场动画堆叠、视差、装饰循环动画。
- `prefers-reduced-motion: reduce` 时全部降级为无位移淡入。

## 9. 暗色模式

- 三态：`auto`（跟随系统）/ `light` / `dark`，显式选择持久化到 localStorage，刷新保持。
- 暗色**不是把浅色变黑**：重新定义表面阶梯、边框透明度与状态色亮度（见 §5.1、§5.3）。
- 切换只改 `data-theme` 属性，**组件里禁止出现 `dark:` 变体散点**。

## 10. AI 迭代协议（重要）

新增或修改任何 UI 时，按此顺序执行：

1. **先在本文件里找规则**。找到 → 按规则实现；没找到 → **先补规则**（更新本文件），再实现。
2. **只用语义 token**。需要新颜色时，先在 §5 增加 token 并说明用途，再在组件里使用。
3. **一次只改一层**：token 改动与组件改动分开提交，避免无法定位视觉回归来源。
4. **改完必须出三张图**：1440 桌面、390 移动、当前主题（含暗色）。截图缺失视为未完成。
5. **回归**：`npm run test:chain` 必须通过；涉及 DOM 的 UI 测试改为按角色/文案断言，不锁死 class 名。
6. **记录取舍**：在 `docs/DECISIONS.md` 追加一条「做了什么 / 为什么 / 放弃了什么」。

新增组件的准入条件（不满足就不要加）：
- 对应一个真实的用户动作或状态表达；
- 能在至少两个工作域复用；
- 有完整的 默认/悬停/聚焦/禁用/加载/错误 六态定义。

## 11. 与其他文档的关系

- `docs/FRONTEND_ARCHITECTURE.md`：代码结构、状态管理、迁移步骤（工程侧）。
- `AGENTS.md`：Agent 的工作流程、命令、禁止事项、验收清单（执行侧）。
- `docs/workbench-ui-principles.md`：业务侧不可破坏的底线（数据、状态机、安全边界）。

三份文档冲突时，优先级：**业务底线 > 本设计契约 > 架构规范**。
