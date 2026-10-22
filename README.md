# Content Flow Workbench

本地单人全时段内容研究工作台，用来把对标信号、标题与封面、全文逐字稿、流量机制分析、Agent 深挖、素材沉淀、选题、口播生产、发布记录和复盘放在同一条链路里。AI 负责采集、整理、候选分析和上下文分发，用户保留选题判断、审美取舍与终稿确认。数据保存在本地 JSON，不依赖数据库和云端服务。

## 快速开始

```powershell
git clone https://github.com/XN-289/content-flow-workbench.git
cd content-flow-workbench
npm start
```

打开：<http://127.0.0.1:5177>

如果要让它登录 Windows 后自动在后台运行，执行一次：

```powershell
npm run setup-task
```

移除开机任务：

```powershell
npm run remove-task
```

首次启动时如果 `data/workbench.json` 不存在，服务会返回空工作台；第一次保存后会自动生成本地主数据。

## 全时段研究与晨间节奏

1. 保持工作台服务运行，默认 08:40 自动检查到期信源。也可以手动执行：

   ```powershell
   npm run collect
   ```

   先检查本地投递箱，再检查到期任务；如需跳过档期强制检查全部账号：

   ```powershell
   npm run collect -- --force
   ```

2. 看到好内容时，在今日页“快速粘贴”里直接粘贴原文，不用先整理字段。系统会自动识别 URL、标题、点赞数、账号、平台和“热评： ...”“@评论者： ...”格式的评论。
3. 新对标博主先在账号页“对标账号快速登记”里粘贴平台分享文案或主页链接；小红书短链会解析到最终主页，昵称、粉丝数和采集边界会一起登记。重贴同一主页只更新元数据，不会清空已采集覆盖率。
4. 对认可的笔记补详情证据；有完整公开视频时可显式生成本地逐字稿，阅读全文、时间轴和候选分析。
5. 09:00 打开今日页，先看自动晨报，再处理 Inbox；其他时段可随时投递链接和补充对标账号。
6. 把高价值信号分成 `dissect`、`material`、`watch`、`discard`。
7. 需要修正时，直接展开 Inbox、素材、选题卡片里的“编辑”区域；标题、判断备注、用途、引用注意和选题核心内容都可修改。
8. 生产时从素材库和选题池取输入，不把所有判断都压到写稿环节。

当前采集器支持：

- `public-rss`：抓取 RSS / Atom，去重后生成 Inbox 信号。
- `public-page`：保存公开页面原始快照，并解析页面标题、作者、发布时间、JSON-LD / Open Graph 元数据、正文全文、图片描述、数据口径候选和同站链接，生成 Inbox 信号。
- `browser-assisted`：用户手动打开页面并滚动到目标范围后，通过粘贴可见列表 JSON 或采集书签读取当前已加载内容。脚本不自动滚动、不调用平台接口、不绕过登录或验证码；账号卡片和采集运行会显示“本页已加载 / 主页显示总数 / 工作台累计入库”，历史补采通过继续滚动并重复点击完成，重复内容自动去重。
- `manual`、`platform-export`：记录 blocked 状态和下一步人工动作，不伪装成自动成功。
- `drops/` 本地投递箱：`.json`、`.md`、`.txt` 放入后自动解析、去重、入库，成功进入 `processed/`，失败进入 `failed/`。

信息流中的四平台能力矩阵只使用 `complete / partial / unsupported / unknown` 表达实际边界。公开笔记详情可保存标题、正文、3:4 封面、媒体清单、raw snapshot 和证据包；小红书封面经本地媒体网关还原为稳定地址并缓存，避免临时 CDN 地址过期。逐字稿优先使用页面可见字幕，没有字幕时只对用户显式选择的单条完整视频做本地 ASR。ASR 全文、时间轴和启发式流量分析始终标记 `unverified`，不能当作平台因果证明。

## 自动化调度与本地流水线

- `npm start` 后服务端每 60 秒检查一次到期任务，不需要外部队列或额外采集任务计划。
- `npm run setup-task` 会安装当前用户的 Windows 登录任务，让本地服务常驻；只想临时运行时仍用 `npm start`。
- 服务端每 30 秒检查 `drops/`，信号进 Inbox，素材 / 热评进素材库；重复链接和重复摘录不会重复入库。
- 自动调度、投递箱扫描和 Agent 结果扫描都有同类任务合并保护；上一轮未结束时跳过本轮，避免慢任务无限堆积排队。
- 今日页“快速粘贴”接口会保存原始文本快照；支持 JSON、普通文本、链接、常见互动数和热评前缀，自动匹配同域名账号。
- 账号页“对标账号快速登记”支持粘贴分享文案；小红书只解析短链到公开主页，不做后台全量历史抓取。
- 快速粘贴、本地文本投递、RSS 和公开页面会自动保存 `contentText`，并生成最多 30 条数据口径候选；公开页面还会从 OG 图片、`img` 替代文本和 `figcaption` 提取最多 20 条图片描述。
- Inbox 的“拆解线索”折叠区展示数据口径候选、图片描述和正文全文；“入素材”会优先转存第一条数据口径候选，并标记发布前必须回原文核对。
- 高价值信号可通过证据包接口生成分层证据：`meta.json`、原始信号、采集快照、候选摘录、媒体清单和 SHA-256 校验；证据只保存在本地 `evidence/`，不进入 Git。
- 信号去重有四层：规范化链接、平台内容 ID、平台 + 作者 + 标题、平台 + 标题 + 发布时间；小红书 `explore` 和 `discovery/item` 的同一笔记 ID 会被视为同一条。
- Inbox 根据作者互动基线自动标记高潜力、值得观察、常规、待补数据。
- 到达 Inbox 时间后自动生成当日晨报，汇总优先信号、待人工账号、失败重试账号和生产选题数。
- 每日 / 每周任务按 `settings.collectionTime` 排程；按需和仅研究任务不自动执行。
- 失败使用 5 分钟起步的指数退避，最长 6 小时；成功后失败计数清零。
- 同一账号不会并发采集。
- 每次采集运行都有统一结果信封：`found / created / duplicates / blocked / failed / coverage / nextAction / cursor / error`，公开采集、浏览器辅助、投递箱和快速粘贴共用同一口径；契约见 [docs/collection-envelope.md](docs/collection-envelope.md)。
- 账号页和采集页会显示下次运行时间、待人工、失败次数和最后错误。
- 页面可暂停 / 恢复自动化；也可以用环境变量 `AUTOMATION_ENABLED=false` 强制关闭。
- 投递箱目录和扫描间隔可用 `DROP_DIR`、`DROP_SCAN_MS` 覆盖，默认 30 秒，单文件最大 2 MB。

设计参考与边界见 [docs/automation-research.md](docs/automation-research.md)。下一阶段控制面调研见 [docs/external-automation-research.md](docs/external-automation-research.md)。

## Agent 桥接、本地插件与 Google Drive

- 工作台新增“桥接”视图，可以把研究、拆解、提纲、口播稿、标题、平台文案和视觉方案打包成 Agent 任务。
- 支持 Grok、Muse、Codex、Claude、Cursor 五类目标：Grok / Muse 复制任务后回写 `result.md`；Codex / Claude 支持本机一键运行；Cursor 通过任务目录接入。
- 绑定信号的任务包会带入完整逐字稿、带时间戳的分段、ASR 模型、最新候选分析和 `unverified` 边界；Agent 输出仍是候选，不自动成为终稿。
- Google Drive 第一版使用桌面同步目录，不保存 API Key、不做 OAuth。任务默认仅本地保存；创建任务时显式勾选后，才镜像到 `<Drive>/ContentFlowWorkbench/Outbox/<task-id>/`。
- 系统页可显式导出知识树到 `<Drive>/ContentFlowWorkbench/Knowledge/`，生成 manifest、Markdown / JSON 和 SHA-256；默认不包含 Cookie、登录态、capture token 或浏览器 profile。
- 服务每 30 秒扫描本地和 Drive 侧结果，取较新的 `result.md`；提纲和口播稿导入生产稿版本，其他结果导入素材库。
- Codex / Claude 本机任务使用 `task.lock` 防重复运行；结果先写 `result.pending.md`，完成后才替换为 `result.md`。服务重启后会检查锁内进程，仍存活则等待结果，已消失才恢复为待重跑。
- Agent 输出永远是候选，引用、数字、时间和来源必须人工核对后才能进入发布链路。
- `plugin/content-flow-workbench/` 暴露九个固定方法，供 gkbot、Muse、Codex、Claude 等本地 Agent 读取平台能力、登记信源、生成逐字稿与分析、创建任务、导出知识包和运行晨间流水线。客户端只允许 loopback、manifest 路由白名单和无重定向请求。

使用方式和隐私边界见 [docs/agent-bridge.md](docs/agent-bridge.md)，Agent 插件协议见 [docs/plugin.md](docs/plugin.md)。

## 数据与隐私

- 主数据：`data/workbench.json`（本地生成，不进入 Git）
- 本地备份：`data/backups/`（本地生成，不进入 Git）
- 导入模板：[data/import-template.json](data/import-template.json)
- 页面导出：工作台右上角“导出”
- 备份视图支持“立即备份”、查看时间和记录数量、显式恢复；每次主数据真实变化前会自动保存上一版，同一内容不重复落盘，默认保留 100 份。恢复前会再保存一份“恢复前”备份。

不要提交以下内容：

- 真实对标账号、笔记链接、评论摘录和个人素材。
- 平台临时访问参数、Cookie、登录态或 API token。
- `data/exports/`、`data/raw/`、`data/backups/`、日志、浏览器 profile 和环境变量文件。
- `drops/processed/`、`drops/failed/` 中的真实素材、链接和评论。

如需换机器，在旧机器备份视图创建一份备份或导出 JSON，把文件保存在私人位置；新机器启动工作台后，将备份文件放入本机 `data/backups/` 再通过备份视图恢复，或直接恢复到 `data/workbench.json`。备份包含真实账号和素材，不要提交或放到公开位置。

## 交接地图

| 需要什么 | 看哪里 |
| --- | --- |
| 当前状态、事实、未决问题 | [PROJECT_STATE.md](PROJECT_STATE.md) |
| 单一源码与多 Agent 合并规则 | [docs/AGENT_COORDINATION.md](docs/AGENT_COORDINATION.md) |
| 阶段待办和下一个行动 | [TODO.md](TODO.md) |
| 总体方案和版本计划 | [PLAN.md](PLAN.md) |
| North Star 生产线 | [docs/north-star-roadmap.md](docs/north-star-roadmap.md) |
| Park 原型分析 | [docs/park-prototype-analysis.md](docs/park-prototype-analysis.md) |
| 小红书采集边界 | [docs/xhs-collection-research.md](docs/xhs-collection-research.md) |
| 自动化调度设计 | [docs/automation-research.md](docs/automation-research.md) |
| 采集结果信封 | [docs/collection-envelope.md](docs/collection-envelope.md) |
| 外部自动化项目调研 | [docs/external-automation-research.md](docs/external-automation-research.md) |
| 分层证据包标准 | [docs/evidence-package.md](docs/evidence-package.md) |
| 日常输入流程 | [docs/local-input-workflow.md](docs/local-input-workflow.md) |
| 端到端链路与状态机 | [docs/end-to-end-chain.md](docs/end-to-end-chain.md) |
| Agent 桥接 | [docs/agent-bridge.md](docs/agent-bridge.md) |
| UI 设计原则与验收门槛 | [docs/workbench-ui-principles.md](docs/workbench-ui-principles.md) |
| 决策记录 | [docs/DECISIONS.md](docs/DECISIONS.md) |

## 验证

```powershell
npm run verify:workbench
npm run verify:source
npm start
```

`npm run verify:workbench` 顺序运行语法检查、41 项主链路、后端流水线、17 项信源登记、7 项批量采集、5 项插件协议、TypeScript、`git diff --check` 和 UI 构建；成功时只输出每步一行，失败时才展开对应日志。需要定位单项问题时，可分别运行 `npm run test:chain`、`npm run test:backend`、`npm run test:sources`、`npm run test:batch`、`npm run test:plugin`、`npm run check:types` 或 `npm run build:ui`。

启动后确认首页和 `/api/state` 都返回 200。以上回归使用临时数据、动态端口或 mock Drive，不读取或修改真实主数据。真实 Google Drive 同步目录和 gkbot / Muse 回流仍需用户在本机完成一次真实接入验收。`npm run verify:source` 用于最终发布或交接，要求当前是干净的 `main`，所有 Agent 分支和 worktree 已合并，并验证本地、`origin/main` 与 GitHub 实时主线为同一个 SHA。
