# PROJECT_STATE

Updated: 2026-10-19 12:47
Current phase: implementation

## 一句话现状

已完成 Park 原型分析、North Star 路线图和第一版本地 MVP：工作台可通过 `npm start` 在本机运行，包含今日、账号、Inbox、素材、选题、生产、发布、复盘和采集运行九个视图；服务端已内置轻量自动调度、失败退避、并发保护、本地投递箱、快速粘贴、公开页面自动解析、多层身份去重、自动去重分级和每日晨报，并提供当前用户 Windows 登录常驻任务脚本。第一个真实小红书对标账号已入库，8 条笔记进入 Inbox，作者互动中位数和信号相对倍数已支持自动计算。仓库已补齐 README、TODO 和交接上下文，真实账号明细和素材只保存在本地主数据。

## 已接受事实

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
- 浏览器辅助采集第一批可见笔记 8 条已入库，最高互动 `5.9万` 已解析为 `59000` — `data/workbench.json`
- 第一轮只有 8 条的原因是无障碍树后续链接被截断；新采集书签改为读取页面状态中的 `noteId + xsecToken`，但只能覆盖用户手动滚动后已加载的数据 — `docs/xhs-collection-research.md`
- AIHOT 的可吸收模式是统一 adapter、独立调度、下次运行时间、失败退避、singleton 运行和健康状态可见；其 Postgres、pg-boss、Docker 和三进程架构不进入本项目 — `docs/automation-research.md`
- 本地投递箱已通过临时数据验证：2 个有效文件新增 3 条记录，坏 JSON 进入 `failed/`；重复投递新增 0、识别重复 2 — `tmp/automation-drop-test` 测试后已删除
- 快速粘贴已在临时数据验证：一次输入发现 3 条记录，新增 1 条信号和 2 条热评素材；重复投递新增 0 — 本轮 `tmp/automation-live-test-3` 命令结果，目录不入 Git
- 公开页面自动解析已在临时数据验证：mock 页面自动生成 1 条公众号信号，第二次强制采集 `found 1 / created 0` — 本轮临时测试命令结果
- 小红书同一内容 ID 在 `explore/:id` 与 `discovery/item/:id` 两种路径下已被识别为重复；多层身份去重修复后信号数量不再因同一条记录命中多个 key 而膨胀 — 本轮临时测试命令结果

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

## 已实现

- 原型分析文档 — `docs/park-prototype-analysis.md` — UTF-8 读取检查通过，包含资料范围、稳定结构、可吸收原则、第一版骨架和待确认问题
- 项目计划 v0.7 — `PLAN.md` — 增加账号注册、自动采集流水线、自动化分级、采集骨架和小红书可见状态采集边界
- North Star 路线图 v0.2 — `docs/north-star-roadmap.md` — 定义账号采集入口、自动采集生产线、动画生产线、四个显性计数、Phase 0-5 和数据契约
- 阶段待办清单 — `TODO.md` — 覆盖 North Star 基线、本地闭环、采集骨架、生产结构化、动画工作室、多平台打包和数据回流
- 本地输入与日常节奏文档 v0.2 — `docs/local-input-workflow.md` — 定义自动采集、快速收集、结构化导入、早上 45 分钟流程、口播生产块和摩擦记录
- 导入模板 v2 — `data/import-template.json` — 信息源增加采集方式和运行状态，信号增加采集运行 ID 和采集时间
- 本地工作台 MVP — `scripts/server.mjs`、`app/index.html`、`app/app.js`、`app/styles.css`、`data/workbench.json` — `node --check`、JSON 解析、API 冒烟和浏览器打开检查通过
- 每日采集脚本 — `scripts/collect-all.mjs` — `npm run collect` 在空账号状态下执行通过
- 启动说明 — `README.md` — 包含启动、每日采集和当前采集能力边界
- 浏览器辅助采集闭环 — `scripts/server.mjs`、`app/app.js` — 支持账号页粘贴可见列表 JSON，保存原始快照、URL 去重、解析 `万 / 亿 / k / +` 互动数并导入 Inbox
- 小红书采集调研与书签 — `docs/xhs-collection-research.md`、`scripts/server.mjs`、`app/app.js` — 对比 XHS-Downloader、social-media-copilot、逆向方案和 Beav；实现账号页生成采集书签、受限 CORS 和页面状态提取，语法、预检、入库与去重已在临时数据文件验证
- 作者互动基线 — `scripts/server.mjs`、`app/app.js`、`app/styles.css` — 样本数不低于 3 时自动计算作者中位数和相对倍数，Inbox 按信号强度排序并展示样本量；规范化 URL、UTM 参数、query 顺序去重和空互动保存在临时数据与本地页面验证通过
- 轻量自动调度器 — `scripts/server.mjs`、`scripts/collect-all.mjs`、`app/app.js`、`docs/automation-research.md` — 服务端每分钟检查到期信源；支持每日 / 每周档期、失败指数退避、同源并发保护、待人工提醒、强制检查、自动化暂停 / 恢复和运行状态可视化，不新增依赖
- 本地投递箱与自动晨报 — `scripts/server.mjs`、`scripts/collect-all.mjs`、`app/app.js`、`drops/README.md`、`README.md` — 支持 JSON / Markdown / TXT 自动解析、规范化去重、素材热评入库、成功 / 失败归档、互动基线分级、高潜力信号、待人工账号、重试账号和下一步动作汇总；`npm run collect` 先清投递箱再跑到期任务，临时数据完整路径和重复路径验证通过
- 快速粘贴与多层身份去重 — `scripts/server.mjs`、`app/app.js` — 支持直接粘贴 JSON / 普通文本，自动识别 URL、标题、平台、账号、点赞数和 `热评：` / `@评论者：` 素材；信号身份覆盖规范化 URL、平台内容 ID、平台 + 作者 + 标题、平台 + 标题 + 发布时间；临时数据验证通过
- 公开页面自动解析 — `scripts/server.mjs` — 支持 Open Graph、JSON-LD Article、canonical、作者、发布时间、描述和同站链接提取，并自动生成 Inbox 信号；mock 页面重复采集验证通过
- Windows 登录常驻任务 — `scripts/install-startup-task.ps1`、`package.json` — `npm run setup-task` 为当前用户安装并启动本地服务任务，`npm run remove-task` 移除；PowerShell 语法检查通过，尚未在用户机器注册

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

## 下一步

1. 用户在第一个小红书对标主页手动滚动到目标范围，点击账号页生成的采集书签 — 验证可见数量、链接和 Private Network Access 行为
2. 用户用一条真实信号和一条真实热评各投一个文件到 `drops/` — 验证本地投递箱日常手感
3. 用户打开 `http://127.0.0.1:5177` 的 Inbox — 分流第一批信号，至少挑 2 条拆解、2 条观察
4. 用户给出三个优先主题 — 每个主题有一句话核心观点
5. 用户后续逐步提供对标账号和链接 — 每个账号标注平台和期望采集方式
6. 补齐 10 条真实对标信号并复核自动作者互动中位数和相对倍数 — 当前已完成 8 条
7. 沉淀 20 条素材或热评并手动完成 3 次拆解 — 验证素材字段和拆解模板是否够用
8. 逐步补充公开 RSS / 公开页面信息源 — 用真实 L2 信源验证自动调度的日常稳定性

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
- 待办清单：`TODO.md`
- 导入模板：`data/import-template.json`
- 决策文件：`decisions.md`
- 验证命令：`node --check scripts/server.mjs`、`node --check app/app.js`、`npm run collect`
- 已知坑：中文文本必须用 Node UTF-8 或显式 UTF-8 安全方式读取；Windows OCR 需要通过 `powershell.exe -File ...batch-ocr.ps1` 运行；新克隆没有真实主数据，需要从私人备份恢复或重新导入

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
