# PROJECT_STATE

Updated: 2026-10-20 15:35
Current phase: implementation

## 一句话现状

已完成 Park 原型分析、North Star 路线图和第一版本地 MVP：工作台可通过 `npm start` 在本机运行，主导航只保留总览 / 信息流 / 工作流 / 系统四个大类 tab，大类内连续排列模块且不设二级 tab；最终形态已确认为 Windows 单用户本地桌面应用，当前 localhost 服务只是先跑通真实流程的运行壳。服务端已内置轻量自动调度、失败退避、并发保护、本地投递箱、快速粘贴、公开页面自动解析、正文全文 / 图片描述 / 数据口径候选抽取、多层身份去重、自动去重分级、每日晨报，以及 Grok / Muse / Codex / Claude / Cursor 的 Agent 任务包与结果回流；signal / material / topic 已提供页面内轻量编辑表单，主数据支持变更前自动备份、内容哈希去重、保留 100 份、显式恢复、静态路径边界、请求体上限和更新字段白名单。备份存储已拆入独立模块，`server.mjs` 只保留恢复编排和服务组合。总览页并列提供今日动作、快速粘贴和生产焦点，信息流连续排列对标账号、Inbox 和素材，工作流连续排列选题、生产、发布和复盘，系统连续排列采集、Agent 和备份；Inbox 已提供清零漏斗、来源级推进率和未看计数。端到端链路已完成 4 视角对抗审查和 20 项临时数据回归，选题状态机、发布门槛、对象身份、Agent 任务锁、结果原子写入、备份恢复和分层证据包均已收紧。对标账号支持分享文案快速登记、可见范围重复采集去重和覆盖率留痕，重复登记不会重置已采集进度。外部项目调研已扩展到采集控制面、收藏归档、媒体下载、Agent 浏览器和平台特定导出方案；采集指挥中心、统一采集结果信封和第一版分层证据包已实现，Inbox 可生成、重建、复制和人工核对证据包。Google Drive 第一版通过桌面同步目录显式镜像，不做 OAuth。第一个真实小红书对标账号已入库，8 条笔记进入 Inbox，作者互动中位数和信号相对倍数已支持自动计算。仓库已补齐 README、TODO 和交接上下文，真实账号明细、素材、备份与 Agent 任务内容只保存在本地或用户显式选择的同步目录。

本轮参考 Postiz、Mixpost 和 LangChain social-media-agent 后，工作台从“表单优先”转向“行动优先”：总览提供每日优先队列和 3 条作品目标进度，信息流提供节奏条，工作流提供阶段漏斗，发布台账提供平台队列；hash 返回 / 前进路由与系统页移动端横向溢出已修复。

## 已接受事实

- 外部自动化调研完成：下一阶段优先补采集指挥中心、统一采集结果信封、平台能力矩阵、快照差异和轻量 doctor，不引入更激进的平台抓取器 — `docs/external-automation-research.md`
- 统一采集结果信封已实现并通过临时数据回归：公开采集、浏览器辅助、本地投递箱和快速粘贴的运行记录均输出 `found / created / duplicates / blocked / failed / coverage / nextAction / cursor / error`，旧扁平字段保留兼容 — `scripts/collection-envelope.mjs`、`docs/collection-envelope.md`、`scripts/chain-regression.mjs`
- 补充外部调研完成：ArchiveBox、Karakeep、linkding、SingleFile、yt-dlp、gallery-dl、Playwright / Playwright MCP、browser-use 及抖音、公众号、X 平台特定项目已纳入对比；可吸收的是分层证据包、幂等媒体归档、能力声明和可见范围导出，不吸收登录态批量抓取、身份池、代理、指纹伪装或验证码处理 — `docs/external-automation-research.md`
- 第一版分层证据包已实现并通过临时数据回归：支持 `meta.json`、raw signal / snapshot、candidate excerpt、media manifest、SHA-256 清单、缺层标记、重复生成保留人工核对结论；真实证据保存在本地 `evidence/` 且不进 Git — `scripts/evidence-package.mjs`、`docs/evidence-package.md`、`scripts/chain-regression.mjs`
- 当天 X 搜索 `from:xparkzz filter:videos` 可见 3 条相关视频，已分别下载、抽帧、OCR 并交叉分析 — `docs/park-prototype-analysis.md`
- 1:15 补充演示是最重要的 UI 原型，展示一条爆款信号从发现到 7 个平台发布的完整链路 — `docs/park-prototype-analysis.md` 第 2.2、3 节
- 项目方向调整为以 Park Content Studio 为第一优先级原型 — `decisions.md`、`PLAN.md` v0.2
- 第一版范围已收敛为今日页、Inbox、素材热评库、拆解、选题池、生产关卡、发布台账、复盘 — `PLAN.md` v0.3 第 5 节
- 用户确认第一阶段最终交付为 3 条以内容为主的口播视频 — `decisions.md`、`PLAN.md` v0.3 第 4 节
- 用户确认信息来源为 X、小红书、抖音、公众号，主发布平台为抖音、小红书、公众号，X 为可选视频平台 — `decisions.md`、`PLAN.md` v0.3 第 5.2、5.8 节
- 用户确认外部模型可承担写稿，工作台负责素材、版本、关卡、终稿导入和发布记录 — `decisions.md`、`PLAN.md` v0.3 第 5.7 节
- 小豆芽在第一版只作为人工信息源候选，不做逆向、绕过限制或批量抓取 — `decisions.md`
- 用户确认对标账号将逐步提供，第一版先提供快速收集和 JSON 批量导入空间 — `decisions.md`、`data/import-template.json`
- 用户确认 Inbox 在早上处理，默认建议 09:00 开始 — `decisions.md`、`docs/local-input-workflow.md`
- 用户当前一条视频可能消耗一个周末，项目需通过生产块和素材库提升个人效率 — `decisions.md`、`docs/local-input-workflow.md`
- 用户确认最终对标是最初 Park 视频中的事件驱动工作台和动画生产线 — `decisions.md`、`docs/north-star-roadmap.md`
- 用户确认自动采集是长期主线：账号进入系统后应逐步实现每日检查、快照留痕、信号和素材候选生成，人只做分流判断 — `decisions.md`
- 项目已初始化本地 Git 主分支 `main`，远端为 `https://github.com/XN-289/content-flow-workbench.git`；真实主数据 `data/workbench.json` 已加入 `.gitignore`，不进入版本历史
- 发布前安全扫描未在项目文件和 Git 历史中发现疑似密钥；29 个唯一疑似值仅存在于 Codex 本地会话日志，不属于 GitHub 交付面
- 第一个真实对标账号为小红书账号；昵称、主页、笔记链接和采集参数只保存在 `data/workbench.json`
- 对标账号快速登记和可见范围覆盖率已通过临时数据回归：首次采集、重复采集去重、补齐到 complete、重复登记保留覆盖率均通过 — `scripts/chain-regression.mjs` 16 项结果
- 浏览器辅助采集第一批可见笔记 8 条已入库，最高互动 `5.9万` 已解析为 `59000` — `data/workbench.json`
- 第一轮只有 8 条的原因是无障碍树后续链接被截断；新采集书签改为读取页面状态中的 `noteId + xsecToken`，但只能覆盖用户手动滚动后已加载的数据 — `docs/xhs-collection-research.md`
- AIHOT 的可吸收模式是统一 adapter、独立调度、下次运行时间、失败退避、singleton 运行和健康状态可见；其 Postgres、pg-boss、Docker 和三进程架构不进入本项目 — `docs/automation-research.md`
- MediaCrawler、catbus、creatorhub、changedetection.io、RSSHub、Crawlee、Maxun、social-auto-upload 等项目调研完成；可吸收的是统一结果信封、能力矩阵、任务意图、快照差异、分类错误、冷却恢复和人工关卡，不吸收登录态后台抓取、自动滚动、私有接口、签名、验证码识别、代理池或指纹伪装 — `docs/external-automation-research.md`
- 本地投递箱已通过临时数据验证：2 个有效文件新增 3 条记录，坏 JSON 进入 `failed/`；重复投递新增 0、识别重复 2 — `tmp/automation-drop-test` 测试后已删除
- 快速粘贴已在临时数据验证：一次输入发现 3 条记录，新增 1 条信号和 2 条热评素材；重复投递新增 0 — 本轮 `tmp/automation-live-test-3` 命令结果，目录不入 Git
- 公开页面自动解析已在临时数据验证：mock 页面自动生成 1 条公众号信号，第二次强制采集 `found 1 / created 0` — 本轮临时测试命令结果
- 小红书同一内容 ID 在 `explore/:id` 与 `discovery/item/:id` 两种路径下已被识别为重复；多层身份去重修复后信号数量不再因同一条记录命中多个 key 而膨胀 — 本轮临时测试命令结果
- 正文 / 图片 / 数据候选抽取已在临时服务验证：快速粘贴、公开页面和 RSS 均保存正文；公开页面提取图片描述；三类入口均生成数据口径候选；重复采集 `created 0 / duplicates 1` — 本轮 `tmp/extraction-live-test` 命令结果，测试数据不入 Git
- 用户确认希望连接 Grok、Muse 等云端 Agent，使用本机 Codex、Claude、Cursor，并用 Google Drive 作为轻量协作空间 — 2026-10-19 用户需求
- 用户确认最终产品形态是只给自己使用的 Windows 本地桌面应用，希望长期打磨体验，不做公开分发或多用户 SaaS — 2026-10-19 用户需求
- Agent 桥接不使用平台登录态、不保存云服务 API Key、不把 Agent 输出自动升级为已核实事实 — `decisions.md`、`docs/agent-bridge.md`
- Boole / Carson / Bohr / Leibniz 四个视角完成端到端对抗审查；未发现 P0，发现的链路断点已修复并通过回归 — 本轮 `scripts/chain-regression.mjs` 结果
- 本地备份采用 JSON 快照和显式恢复；真实备份只保存在本机 `data/backups/`，不进入 Git — `decisions.md`、`.gitignore`
- WRITEOS 建议选择性吸收完成：采纳 Inbox 清零漏斗、来源推进率反馈和 AI 聚类暂缓边界，不迁移技术栈、不做 CRM / 矩阵账号 / 登录态采集 — `decisions.md`、`scripts/inbox-funnel.mjs`
- 界面信息架构已确定为四个大类 tab；总览、信息流、工作流、系统内直接连续排列模块，不设二级 tab — `decisions.md`、`app/app.js`
- 工作台体验调研完成：吸收 Postiz / Mixpost 的队列可见性和 LangChain social-media-agent 的人工关卡，不吸收团队协作、平台直发和重型 SaaS 架构 — `docs/workbench-ux-research.md`
- UI 改动有项目内验收门槛：先定义工作流和信息架构，再改界面；隐式状态必须有显式控件、可恢复并持久化；明暗、可访问性、响应式和四视图检查与业务回归同级别 — `docs/workbench-ui-principles.md`

## 决策索引

- 2026-10-18 — 以 Park Content Studio 为第一优先级原型 — `decisions.md`
- 2026-10-18 — 第一版先手动跑通，再谈自动化 — `decisions.md`
- 2026-10-18 — 40 天内聚焦三条口播视频 — `decisions.md`
- 2026-10-18 — 国内三平台为主，X 为可选分发 — `decisions.md`
- 2026-10-18 — 工作台不做全流程 AI 写稿接入 — `decisions.md`
- 2026-10-18 — 素材与热评作为一等对象 — `decisions.md`
- 2026-10-18 — 小豆芽先作为人工信息源候选 — `decisions.md`
- 2026-10-18 — Inbox 固定在早上处理 — `decisions.md`
- 2026-10-18 — 第一版必须提供本地导入空间 — `decisions.md`
- 2026-10-18 — 用分层产出替代周末硬做 — `decisions.md`
- 2026-10-18 — 以 Park 动画生产线为最终 North Star — `decisions.md`
- 2026-10-18 — 自动采集升级为长期主线 — `decisions.md`
- 2026-10-18 — MVP 采用 Node 内置服务和本地 JSON — `decisions.md`
- 2026-10-18 — 用 TODO 驱动阶段交付 — `decisions.md`
- 2026-10-18 — 浏览器辅助采集先落成半自动闭环 — `decisions.md`
- 2026-10-18 — 小红书采集采用手动可见状态提取 — `decisions.md`
- 2026-10-19 — 自动调度采用 AIHOT-inspired 轻量本地实现 — `decisions.md`
- 2026-10-19 — 自动化第二层采用本地投递箱和晨报 — `decisions.md`
- 2026-10-19 — 自动进料采用快速粘贴与多层身份去重 — `decisions.md`
- 2026-10-19 — 本地常驻采用当前用户登录任务 — `decisions.md`
- 2026-10-19 — 抽取结果只作为候选，不当作已核实事实 — `decisions.md`
- 2026-10-19 — Agent 协作采用任务包与结果回流桥接 — `decisions.md`
- 2026-10-19 — 端到端链路采用服务端状态机、幂等身份和可重复回归 — `decisions.md`、`docs/end-to-end-chain.md`
- 2026-10-19 — 最终形态定为 Windows 单用户本地桌面应用 — `decisions.md`
- 2026-10-19 — 本地备份采用 JSON 快照与显式恢复 — `decisions.md`
- 2026-10-19 — 对标账号采用快速登记加可见覆盖率 — `decisions.md`
- 2026-10-19 — 采集自动化吸收外部项目的控制面模式 — `decisions.md`
- 2026-10-19 — 重要信号采用分层证据包 — `decisions.md`
- 2026-10-20 — WRITEOS 建议选择性吸收 — `decisions.md`
- 2026-10-20 — 界面按总览、信息流、工作流和系统分层 — `decisions.md`
- 2026-10-20 — 界面收回扁平 tab 工作台 — `decisions.md`
- 2026-10-20 — 主导航采用四个大类 tab — `decisions.md`
- 2026-10-20 — 工作台体验采用行动优先和阶段漏斗模式 — `decisions.md`

## 已实现

- 原型分析文档 — `docs/park-prototype-analysis.md` — UTF-8 读取检查通过，包含资料范围、稳定结构、可吸收原则、第一版骨架和待确认问题
- 项目计划 v0.8 — `PLAN.md` — 增加账号注册、自动采集流水线、自动化分级、Agent 桥接、Google Drive 显式镜像、选题状态机和链路回归验收
- North Star 路线图 v0.2 — `docs/north-star-roadmap.md` — 定义账号采集入口、自动采集生产线、动画生产线、四个显性计数、Phase 0-5 和数据契约
- 阶段待办清单 — `TODO.md` — 覆盖 North Star 基线、本地闭环、采集骨架、生产结构化、动画工作室、多平台打包和数据回流
- 本地输入与日常节奏文档 v0.2 — `docs/local-input-workflow.md` — 定义自动采集、快速收集、结构化导入、早上 45 分钟流程、口播生产块和摩擦记录
- 导入模板 v2 — `data/import-template.json` — 信息源增加采集方式和运行状态，信号增加采集运行 ID 和采集时间
- 本地工作台 MVP — `scripts/server.mjs`、`app/index.html`、`app/app.js`、`app/styles.css`、`data/workbench.json` — `node --check`、JSON 解析、API 冒烟和浏览器打开检查通过
- 每日采集脚本 — `scripts/collect-all.mjs` — `npm run collect` 在空账号状态下执行通过
- 启动说明 — `README.md` — 包含启动、每日采集和当前采集能力边界
- 浏览器辅助采集闭环 — `scripts/server.mjs`、`app/app.js` — 支持账号页粘贴可见列表 JSON，保存原始快照、URL 去重、解析 `万 / 亿 / k / +` 互动数并导入 Inbox
- 对标账号快速登记与覆盖率 — `scripts/server.mjs`、`app/app.js` — 支持分享文案识别、小红书短链无凭据解析、可见范围采集覆盖率、重复采集去重和重复登记保护；16 项链路回归通过
- 小红书采集调研与书签 — `docs/xhs-collection-research.md`、`scripts/server.mjs`、`app/app.js` — 对比 XHS-Downloader、social-media-copilot、逆向方案和 Beav；实现账号页生成采集书签、受限 CORS 和页面状态提取，语法、预检、入库与去重已在临时数据文件验证
- 作者互动基线 — `scripts/server.mjs`、`app/app.js`、`app/styles.css` — 样本数不低于 3 时自动计算作者中位数和相对倍数，Inbox 按信号强度排序并展示样本量；规范化 URL、UTM 参数、query 顺序去重和空互动保存在临时数据与本地页面验证通过
- 轻量自动调度器 — `scripts/server.mjs`、`scripts/collect-all.mjs`、`app/app.js`、`docs/automation-research.md` — 服务端每分钟检查到期信源；支持每日 / 每周档期、失败指数退避、同源并发保护、待人工提醒、强制检查、自动化暂停 / 恢复和运行状态可视化，不新增依赖
- 本地投递箱与自动晨报 — `scripts/server.mjs`、`scripts/collect-all.mjs`、`app/app.js`、`drops/README.md`、`README.md` — 支持 JSON / Markdown / TXT 自动解析、规范化去重、素材热评入库、成功 / 失败归档、互动基线分级、高潜力信号、待人工账号、重试账号和下一步动作汇总；`npm run collect` 先清投递箱再跑到期任务，临时数据完整路径和重复路径验证通过
- 快速粘贴与多层身份去重 — `scripts/server.mjs`、`app/app.js` — 支持直接粘贴 JSON / 普通文本，自动识别 URL、标题、平台、账号、点赞数和 `热评：` / `@评论者：` 素材；信号身份覆盖规范化 URL、平台内容 ID、平台 + 作者 + 标题、平台 + 标题 + 发布时间；临时数据验证通过
- 公开页面自动解析 — `scripts/server.mjs` — 支持 Open Graph、JSON-LD Article、canonical、作者、发布时间、描述和同站链接提取，并自动生成 Inbox 信号；mock 页面重复采集验证通过
- 正文与线索抽取 — `scripts/server.mjs`、`app/app.js`、`app/styles.css`、`data/import-template.json` — 支持 RSS 正文、公开页面正文、图片描述、数据口径候选、快速粘贴 / 本地文本正文保存；Inbox 展示拆解线索并可转数据素材；临时服务接口测试通过
- Agent 桥接 — `scripts/server.mjs`、`app/app.js`、`bridge/README.md`、`docs/agent-bridge.md` — 支持七类任务、五个 Agent 目标、任务上下文打包、本地任务包、Google Drive 桌面同步镜像、Codex / Claude 本机脚本、双侧结果扫描与导入；临时服务已验证 Drive 回流、outline 导入 scripts、research 导入 materials、重复扫描不重复导入
- 端到端链路回归 — `scripts/server.mjs`、`scripts/chain-regression.mjs`、`docs/end-to-end-chain.md` — 覆盖重复导入保护、相邻阶段推进、三平台发布与复盘门槛、对标登记与覆盖率、RSS 失败识别、投递箱稳定检测、页面与书签冒烟、备份恢复、Agent 存活恢复和 stale lock 清理；16 项全部通过，测试全部使用临时目录
- 记录编辑闭环 — `app/app.js`、`app/styles.css` — Inbox、素材、选题卡片支持折叠编辑表单，统一走 `/api/update`；信号来源链接、素材来源链接和选题阶段不直接暴露编辑，避免破坏身份与状态机；`node --check app/app.js` 和 15 项链路回归通过
- 本地备份与恢复 — `scripts/server.mjs`、`app/app.js`、`scripts/chain-regression.mjs` — 支持变更前自动快照、手动备份、内容哈希去重、100 份保留、恢复前保底、格式校验、Agent 运行中禁止恢复和非法文件名拒绝；15 项临时数据回归通过
- Windows 登录常驻任务 — `scripts/install-startup-task.ps1`、`package.json` — `npm run setup-task` 为当前用户安装并启动本地服务任务，`npm run remove-task` 移除；PowerShell 语法检查通过，尚未在用户机器注册
- 外部自动化项目调研 — `docs/external-automation-research.md` — 对比 MediaCrawler、catbus、creatorhub、changedetection.io、RSSHub、Huginn、n8n、Crawlee、Maxun、social-auto-upload、Beav、ArchiveBox、Karakeep、linkding、SingleFile、yt-dlp、gallery-dl、Playwright / Playwright MCP、browser-use 及抖音 / 公众号 / X 特定项目；形成采集指挥中心、结果信封、能力矩阵、证据包、可见范围导出、快照差异、doctor 与发布包路线

- 采集指挥中心 — `scripts/server.mjs`、`app/app.js`、`app/styles.css`、`scripts/chain-regression.mjs` — 账号页按运行中、待人工、待补采、到期、失败、冷却、完成等状态输出行动队列，展示覆盖率、失败原因、最近运行摘要、书签 / 脚本 / 主页入口和下一步动作；无覆盖率旧数据也进入待补采，`node --check`、`npm run test:chain` 16 项回归通过
- 统一采集结果信封 — `scripts/collection-envelope.mjs`、`scripts/server.mjs`、`docs/collection-envelope.md`、`scripts/chain-regression.mjs` — 单次运行和自动调度聚合均输出统一信封；快速粘贴、浏览器辅助、失败 RSS、投递箱 pending / 稳定入库已验证，`npm run test:chain` 20 项全部通过
- 服务边界与更新白名单 — `scripts/server.mjs`、`scripts/chain-regression.mjs` — 静态路径用相对路径边界拒绝越界，请求体限制 2MB 并区分 400 / 413，`/api/update` 只允许页面可编辑字段，防止身份与内部运行态被覆盖；`node --check`、`npm run test:chain` 17 项回归通过
- 备份存储模块 — `scripts/backup-store.mjs`、`scripts/server.mjs`、`scripts/chain-regression.mjs` — 备份读写、哈希去重、保留策略和格式校验移入独立模块，`server.mjs` 保留恢复编排；新增模块边界冒烟断言，`node --check` 与 `npm run test:chain` 17 项回归通过
- Inbox 清零漏斗 — `scripts/inbox-funnel.mjs`、`scripts/server.mjs`、`app/app.js`、`app/styles.css`、`scripts/chain-regression.mjs` — 输出全局与来源级的待处理、已判断、已推进、推进率和未看计数；未关联来源归入快速收集；`node --check`、`npm run test:chain` 18 项回归、1440 / 390 视口无横向溢出和 5177 健康检查通过
- 四个大类 tab — `app/app.js`、`app/styles.css`、`scripts/chain-regression.mjs` — 主导航只保留总览 / 信息流 / 工作流 / 系统；信息流、工作流、系统分别组合渲染原有模块，总览动作使用锚点定位但不形成二级 tab；链路回归保护大类路由和旧二级路由清理
- 工作台行动优先体验 — `app/app.js`、`app/styles.css`、`docs/workbench-ux-research.md`、`scripts/chain-regression.mjs` — 总览提供现在 / 接着 / 稍后行动队列与作品目标进度，行动队列可直接跳转对应模块；信息流提供进料 / Inbox / 素材节奏，工作流提供阶段漏斗和近 3 天摩擦摘要，发布台账提供平台队列；大类 hash 重渲染、浏览器返回 / 前进、系统页移动端溢出修复和模块位置进入回归；`node --check`、`npm run test:chain` 18 项、`git diff --check` 和桌面 / 390px 四视图 Playwright 检查通过
- UI 设计原则与验收门槛 — `docs/workbench-ui-principles.md` — 固化四个大类 tab、行动优先、显式状态控件、明暗三态、可访问性、响应式、Apple 式视觉语言和 UI 交付前清单；以后界面改动先过该清单再提交
- 分层证据包 — `scripts/evidence-package.mjs`、`scripts/server.mjs`、`app/app.js`、`app/styles.css`、`scripts/chain-regression.mjs` — Inbox 支持生成 / 重建证据包、复制本地目录和人工核对；标记已核对必须填写说明，错误显示在说明字段旁并回焦输入框；`meta.json`、原始信号 / 快照、候选摘录、媒体清单和 SHA-256 进入隔离目录验证，`node --check`、`npm run test:chain` 19 项回归、1440 / 390 无横向溢出、44px 触控和明暗检查通过

## 已验收

- 无。当前结论仍待用户确认，不写已验收。

## 未决问题

- P1 — 第一批对标账号只完成第一个，后续账号未确认 — 用户 — 不阻塞第一批信号分流和素材库建设 — 用户后续逐步提供账号
- P0 — 40 天内优先讲清楚的三个主题未确认 — 用户 — 阻塞选题池初始化 — 用户给出三个主题
- P0 — “连续出摊”的定义未确认 — 用户 — 阻塞今日页指标 — 用户定义计数规则
- P2 — Inbox 早上处理的具体时钟未确认 — 用户 — 可先用 09:00 默认值 — 用户确认或修改
- P1 — X 视频发布或跳过标准未确认 — 用户 — 阻塞可选平台决策 — 用户给出边界
- P1 — 公众号文稿是视频发布后整理还是同步准备未确认 — 用户 — 阻塞生产排期 — 用户选择节奏
- P1 — 采集书签尚未在第一个小红书对标主页人工验证 — 用户 — 不阻塞 Inbox 已有 8 条信号分流 — 用户手动滚动后点击书签，记录可见数量和新增数量
- P1 — 真实 Google Drive 同步目录尚未配置 — 用户 — 不阻塞本地 bridge 使用 — 用户在桥接页填写桌面同步目录
- P1 — Codex / Claude 真实选题任务尚未运行，Grok / Muse 手动回流尚未验证 — 用户 — 不阻塞代码交付 — 用户各跑一次真实任务并记录手感
- P2 — Cursor 的标准打开方式尚未确认 — 用户 — 可先复制任务目录手动打开 — 用户确认常用入口后再评估增强
- P2 — Grok / Muse / Cursor 人工保存 `result.md` 时仍可能被写成半成品 — 实现 — 本机 Codex / Claude 已用 pending + 替换缓解 — 后续增加显式完成标记
- P2 — 浏览器采集 token 在服务重启或 12 小时后失效，需要刷新页面重新复制书签 — 实现 — 可接受第一阶段手动操作 — 后续做按需刷新
- P2 — `collectionRuns`、`rawSnapshots` 和 Agent `resultText` 没有保留上限 — 实现 — 单人本地短期可用 — 后续做归档或大文本外置
- P2 — API 错误语义仍偏粗，部分不同失败都返回 400 — 实现 — 不影响单人使用 — 后续做 typed error
- P2 — 浏览器采集空结果不落 collection run；Drive 云端任务素材隐私分级未做 — 实现 — 已有显式勾选兜底 — 后续分别补运行留痕和 `cloudSafe`
- P2 — `data/backups/` 只保存在本机，尚未自动镜像到 Google Drive 或其他私人位置 — 用户 — 单机磁盘故障仍可能丢失数据 — 用户定期把备份复制到私人位置

## 下一步

1. 连续三个真实工作日从总览行动队列开始工作 — 验收标准：不需要手工翻找入口也能判断下一步动作，重复卡点记录在复盘区近 3 天摩擦摘要中
2. 在账号页刷新采集指挥中心，用第一个小红书对标账号确认待补采状态、覆盖率、最近运行摘要和下一步动作 — 验收标准：用户能在页面直接判断下一步是否需要滚动补采
3. 用一条真实高价值信号生成并人工核对证据包 — 验收标准：来源链接、原始快照或缺层说明、候选摘录、媒体清单和核对说明互相关联，真实证据不进 Git
4. 用户在第一个小红书对标主页手动滚动到目标范围，点击账号页生成的采集书签 — 验证可见数量、链接和 Private Network Access 行为
5. 用户用一条真实信号和一条真实热评各投一个文件到 `drops/` — 验证本地投递箱日常手感
6. 用户打开 `http://127.0.0.1:5177` 的 Inbox — 分流第一批信号，至少挑 2 条拆解、2 条观察
7. 用户给出三个优先主题 — 每个主题有一句话核心观点
8. 配置真实 Google Drive 同步目录，并用一个真实选题跑一次 Codex 或 Claude 任务 — 验证任务包、运行、扫描和导入闭环

## 恢复上下文

- 远端仓库：`https://github.com/XN-289/content-flow-workbench`
- 入口文件：仓库根目录的 `PLAN.md`
- 工作台启动：在仓库根目录执行 `npm start`，访问 `http://127.0.0.1:5177`
- 每日采集：工作台启动后执行 `npm run collect`
- 常驻任务：`npm run setup-task` 安装当前用户登录任务，`npm run remove-task` 移除；默认不随克隆自动安装
- 原型分析：`docs/park-prototype-analysis.md`
- 本地输入流程：`docs/local-input-workflow.md`
- North Star 路线图：`docs/north-star-roadmap.md`
- 小红书采集调研：`docs/xhs-collection-research.md`
- 外部自动化项目调研：`docs/external-automation-research.md`
- 工作台体验调研：`docs/workbench-ux-research.md`
- UI 设计原则：`docs/workbench-ui-principles.md`
- Agent 桥接：`docs/agent-bridge.md`
- 待办清单：`TODO.md`
- 导入模板：`data/import-template.json`
- 决策文件：`decisions.md`
- 验证命令：`node --check scripts/server.mjs`、`node --check app/app.js`、`npm run test:chain`、`npm run collect`
- 已知坑：中文文本必须用 Node UTF-8 或显式 UTF-8 安全方式读取；Windows OCR 需要通过 `powershell.exe -File ...batch-ocr.ps1` 运行；新克隆没有真实主数据，需要从私人备份恢复或重新导入；真实备份不进入 Git

## 最近更新

- 2026-10-18 18:40 — 新增 North Star 路线图和 TODO，项目计划升级到 v0.5 — 影响长期目标、数据契约、动画生产线和阶段验收
- 2026-10-18 18:47 — 自动采集升级为长期主线，项目计划升级到 v0.6 — 新增账号注册表、采集运行、原始快照、source adapter、自动化分级和小豆芽研究边界
- 2026-10-18 18:56 — 实现第一版本地 MVP 和每日采集脚本 — 九个视图、JSON 数据、RSS / 公开页面 / 人工导入采集留痕、Node 内置服务
- 2026-10-18 19:08 — 接入第一个真实对标账号并跑通浏览器辅助采集 — 8 条笔记进入 Inbox，互动数完成结构化解析
- 2026-10-18 19:24 — 完成小红书采集开源方案调研并落地安全采集书签 — 明确 8 条截断原因，实现页面状态提取、受限 CORS、语法与临时数据验证
- 2026-10-18 23:19 — 完成发布前安全检查、Git 初始化和交接文档升级 — 真实主数据排除在 Git 外，README / TODO / PROJECT_STATE 可支撑新机器恢复
- 2026-10-19 11:11 — 实现作者互动中位数、相对倍数、Inbox 强度排序和规范化 URL 去重 — 信号优先级判断从手工记录升级为自动计算，完整四层去重仍待做
- 2026-10-19 11:29 — 参考 AIHOT 落地轻量自动调度 — `npm start` 即可获得到期检查、失败退避、并发保护、状态可见和手动 / 强制入口，不引入数据库和队列
- 2026-10-19 12:25 — 增加本地投递箱和自动晨报 — 采集后自动解析、去重、分级、归档和晨报汇总，受限平台仍不使用登录态或私有接口
- 2026-10-19 12:47 — 增加快速粘贴、公开页面自动解析、四层身份去重和登录常驻任务脚本 — 自动进料从文件投递扩展到粘贴和公开页面，服务可按用户选择保持常驻
- 2026-10-19 13:35 — 增加正文全文、图片描述和数据口径候选抽取 — Inbox 从标题摘要升级为可展开拆解线索，机器抽取保持候选定位，发布前仍需人工核对
- 2026-10-19 13:54 — 增加 Agent 桥接、Google Drive 桌面同步镜像和结果回流 — Grok / Muse / Codex / Claude / Cursor 共享任务包协议，Agent 输出作为候选进入素材库或生产稿版本
- 2026-10-19 15:07 — 完成端到端链路清理、4 视角对抗审查和 14 项回归 — 修复素材身份分裂、定时器背压、Agent 重复启动和半成品结果风险；补齐链路文档与交接状态
- 2026-10-19 15:22 — 确认最终形态为 Windows 单用户本地桌面应用 — 当前 localhost 壳继续跑通真实流程，桌面化在第一条口播链路后评估，不做多租户 SaaS
- 2026-10-19 15:33 — 补齐 signal / material / topic 页面编辑闭环 — 人工判断、素材价值、引用注意和选题核心内容不再依赖 API 或 JSON；链路回归扩展编辑表单冒烟
- 2026-10-19 15:55 — 实现本地备份与显式恢复 — 主数据变更前自动保存上一版，页面可手动备份和恢复，回归扩展到 15 项且全部使用临时目录
- 2026-10-19 16:17 — 增加对标账号快速登记、可见范围覆盖率留痕和重复登记保护 — 采集边界保持人工滚动后显式触发，回归扩展到 16 项且全部通过
- 2026-10-19 16:29 — 完成外部自动化项目调研并确定下一阶段控制面优先级 — 新增采集指挥中心、统一结果信封、平台能力矩阵、快照差异、doctor 和发布包路线
- 2026-10-19 16:40 — 补充收藏归档、媒体下载、Agent 浏览器和平台特定项目调研 — 新增分层证据包、幂等媒体归档和可见范围导出路线；TODO 下一个行动编号已修正
- 2026-10-19 17:26 — 实现采集指挥中心并纳入端到端回归 — 账号页现在能按状态优先级输出每个源的下一次动作、覆盖率、失败原因和最近运行摘要
- 2026-10-19 18:09 — 完成代码质量复核并加固服务边界 — 静态路径、请求体上限、直接生产动作和更新字段白名单纳入回归；5177 服务已重启并健康检查通过
- 2026-10-19 19:28 — 拆分备份存储模块并增加结构护栏 — `server.mjs` 减少备份实现细节，备份链路回归保持 17 项通过；当前改动尚未提交
- 2026-10-20 10:53 — 选择性吸收 WRITEOS 并实现 Inbox 清零漏斗 — Inbox 新增全局指标、筛选计数和来源级推进率，链路回归扩展到 18 项且全部通过；5177 服务已重启并健康检查通过；当前改动尚未提交
- 2026-10-20 11:13 — 按用户反馈重构工作台信息架构 — 今日、收集、Inbox、生产、复盘职责分离，回归保持 18 项通过，桌面和手机页面无横向溢出；当前改动尚未提交
- 2026-10-20 11:22 — 按用户手感收回扁平 tab 工作台 — 独立收集页撤回，快速粘贴回到今日页，保留 Inbox 漏斗和复盘摩擦记录；当前改动尚未提交
- 2026-10-20 11:30 — 主导航确定为四个大类 tab — 信息流、工作流、系统改为大类内连续工作区，总览动作支持锚点定位；当前改动尚未提交
- 2026-10-20 12:15 — 行动优先界面补齐直接跳转和摩擦反馈 — 总览行动队列可点击直达对应模块，复盘区显示近 3 天摩擦摘要；18 项链路回归与桌面 / 移动四视图检查通过；本轮改动进入本地 Git 提交
- 2026-10-20 14:11 — 固化 UI 设计原则与验收门槛 — 明确四类 tab 信息架构、显式状态控件、明暗三态、可访问性、响应式和视觉语言；后续 UI 改动必须先过清单再提交
- 2026-10-20 15:21 — 实现第一版分层证据包并完成 UI 可访问性收紧 — 证据目录包含结构化索引、原始信号 / 快照、候选摘录、媒体清单和哈希，人工核对说明改为字段内错误；链路回归扩展到 19 项且全部通过
- 2026-10-20 15:35 — 实现统一采集结果信封 — 公开采集、浏览器辅助、本地投递箱和快速粘贴共用运行结果契约，链路回归扩展到 20 项且全部通过
- 2026-10-20 14:22 — 收紧移动端顶栏密度 — 明暗切换与本地数据状态同排展示，主题按钮保持 44px 触控高度；390px 首屏不再被顶栏占掉一半
