# End-to-End Content Chain

- 版本：v0.4
- 日期：2026-10-22
- 适用范围：X、小红书、抖音、公众号的信源登记、标题 / 封面 / 全文逐字稿、候选分析、Agent 深挖、知识导出、素材沉淀、口播生产、三平台发布和复盘

## 1. 总链路

```text
信源注册
  ↓
平台能力矩阵 + 定时 / 手动 / 用户显式采集
  ↓
raw snapshot + collection run
  ↓
多层身份去重 + 相对互动倍数
  ↓
标题 / 正文 / 封面 / 媒体清单
  ↓
全文逐字稿 + 时间轴（字幕优先，单条完整视频可选本地 ASR）
  ↓
候选流量与内容机制分析（unverified）
  ↓
完整上下文交给 Agent 深挖
  ↓
显式导出 Google Drive 知识树
  ↓
用户判断与取舍
  ↓
discard / watch / dissect / material / topic / produce
  ↓        ↓                 ↓
观察池   素材与热评库      选题池
              ↓                 ↓
           拆解与证据包      outline / script 候选稿
                              ↓
                        人工取舍与稿子版本
                              ↓
                         生产七项检查
                              ↓
                         四个人工关卡
                              ↓
                         待发布
                              ↓
                    抖音 / 小红书 / 公众号台账
                              ↓
                           published
                              ↓
                       数据与评论回流
                              ↓
                           reviewed
```

## 2. 阶段契约

| 阶段 | 输入 | 自动动作 | 人工动作 | 输出 | 不允许的事 |
| --- | --- | --- | --- | --- | --- |
| 信源注册 | 平台分享文案或主页链接、角色、采集方式、数据边界 | 解析 URL / 昵称 / 粉丝数，校验配置并生成下次运行时间 | 确认保留原因 | `sources` | 未声明数据边界就采集 |
| 采集 | 到期 source 或手动触发 | RSS / 公开页面抓取、浏览器辅助提交、投递箱扫描、失败退避、覆盖率计算 | 小红书手动滚动和触发书签；历史缺口按提示分批补采 | `collectionRuns`、`rawSnapshots`、候选信号、覆盖率 | 绕过登录、验证码、风控或私有接口 |
| 详情证据 | 用户打开且当前可见的公开笔记 | 提取标题、正文、封面、媒体清单和 raw snapshot，生成证据包 | 确认页面可读并显式触发 | `signals`、证据包、媒体清单 | 登录墙后抓取、自动滚动或伪造正文 |
| 逐字稿 | 页面可见字幕，或单条完整公开视频 | 显式下载一个完整 MP4，本地 ASR 生成全文、时间轴、模型和运行记录 | 选择信号、触发转写、后续校对 | `transcriptRuns`、`signals.transcriptText`、`transcriptSegments` | 把正文 / `.m4s` / 字幕链接当作已完成逐字稿 |
| 候选分析 | 完整逐字稿与有效时间轴 | 生成钩子、结构、节奏、留存机制、情绪回报、作者基线和时间戳引文，按输入哈希复用 | 回原文核对事实与引文 | `analysisRuns` | 把启发式推断说成平台流量因果 |
| Agent 深挖 | `signalId` 或选题上下文 | 生成含全文逐字稿、时间轴、分析和证据缺口的任务包 | 选择 Agent、确认可外发、导入结果 | `agentTasks`、候选稿 / 素材 | 只给摘要、静默读取“最近一条”或自动升级终稿 |
| 知识承接 | 已生成逐字稿与分析 | 写入 Drive 同步目录的 manifest、Markdown / JSON、README 和 SHA-256 | 配置桌面同步目录并显式导出 | `knowledgeExports`、Drive 知识树 | 使用 OAuth / API Key、隐式上传或把 mock 当作真实 Drive 验收 |
| Inbox 去重 | 候选信号 | URL / 内容 ID / 作者标题 / 标题时间四层身份匹配 | 判断价值 | `signals` 与去向标记 | 自动把信号升级为选题或生产 |
| 素材沉淀 | 信号摘录、热评、评论、外部资料 | 识别热评、数据口径候选、关联选题 | 写“为什么好”和引用边界 | `materials` | 把未核对数据当证据 |
| 拆解 | 高潜力信号 | 保存原文线索、生成 Agent 任务包 | 完成结构判断和复用决策 | 拆解类素材 | 只收藏不判断 |
| 选题 | 拆解结论、素材组、信号组 | 合并上下文、计算生产状态 | 确认目标读者、核心观点、最小发布版本 | `topics` | 无核心观点进入生产 |
| Agent 协作 | 选题与素材上下文 | 生成本地任务包，显式镜像 Drive，扫描 `result.md` | 选择 Agent、确认可外发、导入候选稿 | `agentTasks`、候选稿 / 素材 | 云端 Agent 自动发布或静默拿到私密素材 |
| 稿件版本 | Agent 候选稿、人工稿 | 版本留痕、绑定选题 | 取舍、改写、核对证据 | `scripts` | 生成无选题归属的孤立稿 |
| 生产检查 | 稿子、证据、视觉素材 | 显示缺失项 | 勾选七项检查 | 生产完整性 | 关卡未过继续推进 |
| 发布台账 | 待发布选题与发布包 | 按选题 + 平台幂等记录 | 实际发布、填链接和失败原因 | `publications` | 三平台未齐就标记 published |
| 复盘 | 发布数据、评论、摩擦记录 | 聚合展示 | 写假设验证、保留 / 砍掉 / 下一条 | `reviews`、回流素材 | 无复盘标记 reviewed |

## 3. 选题状态机

```text
topic → outline → draft → production → review → ready-to-publish → published → reviewed
```

规则：

1. 服务端只允许相邻阶段推进；API 不能从 `topic` 直接跳到 `published`。
2. `production → review` 前必须通过四个人工关卡：证据、开头、样片或初稿、终审。
3. `review → ready-to-publish` 前必须完成七项生产检查。
4. 任何阶段进入 `published` 前，抖音、小红书、公众号的台账都必须是 `published`。
5. `published → reviewed` 前必须存在复盘记录。
6. 重复导入选题只补充背景和关联，不覆盖当前阶段、生产检查和人工关卡。

## 4. 对象归属

| 对象 | 唯一身份或归属 | 重复导入行为 |
| --- | --- | --- |
| `sources` | 规范化 URL | 合并可更新字段 |
| `signals` | URL / 平台内容 ID / 作者标题 / 标题时间 | 保留 `seen`、非 Inbox 去向和人工备注 |
| `materials` | 规范化信号 URL + 摘录；同一条素材带不同 UTM / ref / spm 不拆分 | 保留选题关联和价值判断 |
| `topics` | 标题小写 | 保留生命周期字段，关联数组合并 |
| `scripts` | 记录 ID，必须绑定选题 | Agent 重复导入会被结果哈希拦截 |
| `publications` | `topicId + platform` | 同一选题同一平台只保留一条台账 |
| `reviews` | 记录 ID | 复盘以人工提交为准 |

## 5. 失败与待人工状态

- 采集失败：记录 `lastCollectionError`、失败次数和下次退避时间，不生成假信号。
- 需要登录或平台导出：采集状态转 `blocked`，下一步是人工导出或浏览器辅助，不伪装成功。
- Agent 运行中断：服务重启后读取 `task.lock`；进程仍存活则保持 `running`，进程消失才回 `outbox` 并清理失效锁。
- Agent 结果待核对：只进入候选稿或素材，不自动成为终稿。
- Drive 镜像失败：本地任务目录清理，任务不落库，避免半同步状态。
- 发布失败：台账记录失败原因和下一步，不推进选题阶段。

## 6. 隐私与自动化边界

1. 工作台默认本地运行，主数据只保存在 `data/workbench.json`。
2. Agent 任务包默认只写入本地 `bridge/outbox/`。
3. Google Drive 必须先配置目录，再由用户逐任务勾选镜像；未勾选时显示 `local-only`。
4. 云端 Agent 只接收任务包、返回 Markdown，不获得工作台控制权。
5. 小红书只读取用户已滚动加载的可见状态，由用户显式触发，不做后台静默采集。
6. 采集覆盖率必须如实显示：能识别主页显示总数时展示累计入库比例；识别不到时标记总数待确认，不伪装全量成功。
7. 自动化可以采集、去重、整理和提醒；选题取舍、证据核对、终审和发布永远由人确认。

## 7. 回归清单

每次修改链路后执行：

```powershell
npm run verify:workbench
```

`verify-workbench.mjs` 顺序执行语法检查、41 项主链路、后端流水线、17 项信源登记、7 项批量采集、5 项插件协议、TypeScript、`git diff --check` 和 UI 构建，成功时只输出每步一行，失败时才展开对应日志。发布结论以本次命令输出的 `passed / total` 为准，不沿用历史数字。

`chain-regression.mjs` 覆盖信号 / 素材 / 选题身份、状态机、三平台发布与复盘门槛、信源登记与覆盖率、RSS / 投递箱、页面与书签冒烟、备份恢复、Agent 恢复、状态封装、平台能力、逐字稿、分析、知识导出和晨间流水线。`backend-pipeline-regression.mjs` 覆盖流水线状态、事务与失败路径；`plugin-regression.mjs` 覆盖动态端口 locator、九个插件方法、安全拒绝、Agent 全文上下文、Drive 导出和流水线；`source-intake-regression.mjs` 与 `batch-intake-regression.mjs` 分别覆盖单链接分类和多链接粘贴边界。

真实 ASR 成功路径另用 `npm run test:transcript:e2e` 独立验收。该命令要求 Windows 中文 SAPI、`ffmpeg` 和 `data/asr-runtime.local.json` 指向的本地 faster-whisper 模型；脚本生成临时中文语音和 MP4，预置到临时 `TRANSCRIPT_DIR`，并把信号媒体 URL 指向故意不可访问的 CDN 地址，以证明成功路径复用本地完整视频且没有网络下载。随后断言后台运行原位完成、全文 / 时间轴 / 媒体与 JSON 落盘、证据包 SHA-256 匹配、候选分析保持 `unverified` 并按逐字稿哈希复用。该命令不读取真实主数据，也不放入默认验收，因为依赖本机语音、ffmpeg 与模型。

这些回归会创建临时 `DATA_FILE`、`DROP_DIR`、`BRIDGE_ROOT`、`EVIDENCE_DIR`、`TRANSCRIPT_DIR`、`BACKUP_DIR`、Drive mock 目录和 mock RSS 服务；不读取真实 `data/workbench.json`，也不写真实投递箱、证据、逐字稿或备份目录。
