# PROJECT_STATE

Updated: 2026-10-19 11:11
Current phase: implementation

## 一句话现状

已完成 Park 原型分析、North Star 路线图和第一版本地 MVP：工作台可通过 `npm start` 在本机运行，包含今日、账号、Inbox、素材、选题、生产、发布、复盘和采集运行九个视图；第一个真实小红书对标账号已入库，8 条笔记进入 Inbox，作者互动中位数和信号相对倍数已支持自动计算。仓库已补齐 README、TODO 和交接上下文，真实账号明细和素材只保存在本地主数据。

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
- 发布前安全扫描未在项目文件中发现疑似密钥；27 类疑似值仅存在于 Codex 本地会话日志，不属于 GitHub 交付面
- 第一个真实对标账号为小红书账号；昵称、主页、笔记链接和采集参数只保存在 `data/workbench.json`
- 浏览器辅助采集第一批可见笔记 8 条已入库，最高互动 `5.9万` 已解析为 `59000` — `data/workbench.json`
- 第一轮只有 8 条的原因是无障碍树后续链接被截断；新采集书签改为读取页面状态中的 `noteId + xsecToken`，但只能覆盖用户手动滚动后已加载的数据 — `docs/xhs-collection-research.md`

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
2. 用户打开 `http://127.0.0.1:5177` 的 Inbox — 分流第一批信号，至少挑 2 条拆解、2 条观察
3. 用户给出三个优先主题 — 每个主题有一句话核心观点
4. 用户后续逐步提供对标账号和链接 — 每个账号标注平台和期望采集方式
5. 补齐 10 条真实对标信号并复核自动作者互动中位数和相对倍数 — 当前已完成 8 条
6. 沉淀 20 条素材或热评并手动完成 3 次拆解 — 验证素材字段和拆解模板是否够用
7. 评估是否为 Windows 任务计划配置每日 08:40 执行 `npm run collect` — 浏览器辅助账号仍需人工打开页面确认可见列表

## 恢复上下文

- 远端仓库：`https://github.com/XN-289/content-flow-workbench`
- 入口文件：仓库根目录的 `PLAN.md`
- 工作台启动：在仓库根目录执行 `npm start`，访问 `http://127.0.0.1:5177`
- 每日采集：工作台启动后执行 `npm run collect`
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
