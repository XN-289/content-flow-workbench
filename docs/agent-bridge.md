# Agent Bridge

- 版本：v0.3
- 日期：2026-10-22
- 适用范围：本地单人工作台与 gkbot、Muse、Grok、Codex、Claude、Cursor 的任务包、逐字稿分析、知识导出和结果回流协作；不做通用聊天入口和 Agent 平台

## 1. 目标

Agent Bridge 把一次研究、拆解、提纲、写稿或视觉设计任务打包成固定目录，让本地和云端 Agent 使用同一份上下文与输出协议。工作台负责组织上下文、分发任务、回收结果和保留人工关卡；Agent 只返回 Markdown 候选稿。

```text
工作台信号 / 全文逐字稿 / 时间轴 / 候选分析 / 选题 / 素材 / 热评 / 稿件版本
  → task.md + task.json（绑定 signalId 时自动带入完整证据上下文）
  → 本地 bridge / Google Drive 桌面同步目录
  → gkbot / Muse / Grok / Codex / Claude / Cursor
  → result.md
  → 自动扫描与人工导入
  → 素材库或生产稿版本
```

工作台同时提供 Node ESM 本地插件 `plugin/content-flow-workbench/`。宿主 Agent 优先通过插件方法读取平台能力、登记信源、生成逐字稿 / 分析、创建任务和导出知识，不直接拼接服务端 URL。协议见 [docs/plugin.md](plugin.md)。

## 2. Agent 支持方式

| Agent | 接入方式 | 工作台动作 |
| --- | --- | --- |
| gkbot | 本地插件或任务目录 | 通过 plugin client 读取状态和推进链路，或消费 `task.md` 后回写 `result.md` |
| Muse | 本地插件或任务目录 | 通过 plugin client 获取全文上下文，或按任务包回写 `result.md` |
| Grok | 云端 Agent | 复制 `task.md` 到 Grok，把结果保存为任务目录的 `result.md` |
| Codex | 本机 CLI | 点击“本机运行”，生成 `run-codex.ps1` 并非交互执行 |
| Claude | 本机 CLI | 点击“本机运行”，生成 `run-claude.ps1` 并非交互执行 |
| Cursor | 本机编辑器 | 点击“复制目录”，在 Cursor 打开该任务目录，处理后写入 `result.md` |

Codex 与 Claude 的启动是显式按钮触发，不在后台连续调用，避免隐性消耗额度。Cursor 不做伪装的一键运行；本机没有稳定的 `cursor` CLI 时，先保留目录级交接。

## 3. 目录协议

本地任务包：

```text
bridge/outbox/<task-id>/
  task.json       # 任务元数据
  task.md         # 完整 Prompt 与上下文
  result.md       # Agent 输出
  task.lock       # 本机 Agent 运行锁；仅运行期存在
  run-codex.ps1   # Codex 任务生成
  run-claude.ps1  # Claude 任务生成
```

如果配置了 Google Drive 桌面同步目录，并且创建任务时显式勾选“同步任务包到 Google Drive”，该任务才会镜像到：

```text
<Google Drive>/ContentFlowWorkbench/Outbox/<task-id>/
```

本地与云盘两侧的 `result.md` 都会被扫描，系统取修改时间更新的一版，并把它同步到另一侧。`bridge/` 中真实任务内容不进入 Git。

### 结果与运行锁

- `result.md` 只表示一份完整可导入的结果。Codex / Claude 本机脚本先写 `result.pending.md`，命令成功结束后用原子替换生成 `result.md`。
- `task.lock` 记录任务 ID、实际 PowerShell PID 和获取时间。任务正常结束或失败退出后删除。
- 服务重启后会读取运行中任务的锁：PID 仍存活时任务保持 `running`，等待结果回流；PID 已消失时恢复为 `outbox`，提示重跑或扫描结果，并清理失效锁。
- Grok、Muse、Cursor 等人工回写场景仍要求保存完成后再写 `result.md`；工作台不会把半成品主动升级为终稿。

## 4. Google Drive 配置

第一版使用 Google Drive 桌面版在本机挂载的同步目录，不做 OAuth，不保存 Google API Key，也不让工作台直接操作云端。

1. 安装并登录 Google Drive 桌面版。
2. 确认它在资源管理器中显示为本地目录，例如 `G:/Google Drive` 或用户目录下的 `Google Drive`。
3. 在工作台“桥接”页粘贴该目录，保存连接。
4. 新建任务时默认仅保存本地 `bridge/outbox/<task-id>/`；只有勾选镜像后才创建 `ContentFlowWorkbench/Outbox/<task-id>/`。

如果目录不存在，保存会失败并提示先启动 Google Drive。这个失败是有意的，避免把任务写到错误位置。

## 5. 任务类型与回流位置

| 类型 | 适用环节 | 导入位置 |
| --- | --- | --- |
| `research` | 补充研究、来源线索 | 素材库 |
| `dissect` | 对标内容拆解 | 素材库 |
| `outline` | 选题提纲 | 生产稿版本 |
| `script` | 口播稿 | 生产稿版本 |
| `title` | 标题候选 | 素材库 |
| `platform-copy` | 平台文案候选 | 素材库 |
| `visual` | 动画、画面、视觉方案 | 素材库 |

`outline` 与 `script` 进入生产稿版本；其他类型进入素材库。所有 Agent 输出都带“发布前必须核对原始证据和来源链接”的提示，不能直接当作已核实事实。

## 6. 任务上下文

绑定选题时，任务包会自动带上：

- 选题的一句话观点、目标读者、最小可发布版本、当前阶段和平台。
- 选题关联素材，最多 12 条。
- 近期热评素材，最多 8 条。
- 数据、案例、金句素材，最多 8 条；合并后最多 20 条。
- 关联信号与高潜力信号，最多 12 条。
- 既有稿件版本，最多 3 个。

直接绑定一条信号时，任务包会自动带上：

- 标题、来源、作者、平台、发布时间、链接和互动基线。
- 完整逐字稿全文、带起止时间的全部分段、字数、时长、ASR 模型、生成时间和来源。
- 最新一版候选分析，包括钩子、结构、节奏、留存机制、情绪回报、作者基线、带时间戳引文和证据缺口。
- `unverified` 边界、已知缺失层和必须回原文核对的字段。

逐字稿不能被截成摘要交付给 Agent；只有用户边界不允许外发时才保留本地任务。未绑定信号或选题时，任务仍可携带素材、热评、数据线索和高潜力信号，用于日常研究或拆解。

Prompt 固定要求 Agent：

1. 只输出最终 Markdown。
2. 不编造来源、数字、时间范围和语境。
3. 未核实信息标注“待核对”。
4. 保留来源链接。
5. 输出前自查目标、证据缺口和下一步人工动作。

## 7. 隐私与安全

- 不把 Cookie、API Key、平台登录态、验证码或私密素材放进任务包。
- Google Drive 只使用用户显式配置的桌面同步目录。
- 云端 Agent 任务包会随目录同步，创建前先确认素材是否适合放入云盘。
- Agent 输出只是候选；发布前必须回原文核对数字、口径、时间和引用。
- 不把 Agent 变成自动发布器；终稿、证据核对和平台发布仍由人确认。

## 8. 日常用法

1. 早上分流后，把需要深挖的信号或选题交给 `research` / `dissect`。
2. 写稿前，先跑 `outline`，确认结构没有跑偏。
3. 结构确认后再跑 `script`，同一选题可比较 Codex、Claude、Grok、Muse 的版本。
4. 结果进入“结果待导入”后，先读一遍，再点击导入。
5. 发布前逐条核对证据，不把“待核对”内容带进成稿。

## 9. 验证

```powershell
npm run build:ui
npm run test:chain
npm run test:plugin
node scripts/backend-pipeline-regression.mjs
node scripts/source-intake-regression.mjs
```

插件回归会启动动态端口的临时服务，检查 locator、九个方法、路由白名单、loopback / 重定向拒绝、无 MP4 时的逐字稿失败边界、全文 Agent 任务、Drive 导出和晨间流水线。功能冒烟仍应使用临时 `DATA_FILE`、`BRIDGE_ROOT`、`EVIDENCE_DIR` 和 Drive mock，不要直接用真实主数据测试云端同步。

真实 Google Drive 桌面同步目录和 gkbot / Muse 宿主接入尚未完成端到端人工验收。代码与隔离回归通过不等于外部宿主的真实适配已经验收。
