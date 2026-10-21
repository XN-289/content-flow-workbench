# Evidence Package Standard

- 版本：v0.2
- 日期：2026-10-21
- 适用对象：高价值信号、热评和后续需要进入口播稿的引用证据

## 目标

证据包解决两个问题：链接失效后仍能复核当时采集到了什么；AI 摘要、数据口径和拆解结论永远不会被误当成已核实事实。第一版先支持信号证据包，热评和素材证据包沿用同一目录标准。

## 目录结构

```text
evidence/
  README.md
  signal-<signal-id>-<hash>/
    meta.json
    checksums.sha256
    raw/
      signal.json
      snapshot.json        # 有采集运行快照时存在
    candidate/
      excerpt.md
      transcript.md         # 有已捕获逐字稿时存在
    media-manifest.json
```

`meta.json` 是唯一入口，记录证据 ID、信号 ID、来源、采集运行、原始快照、覆盖范围、候选摘录、逐字稿元数据、媒体清单、文件哈希和人工核对状态。`raw/signal.json` 保存结构化信号；`raw/snapshot.json` 保存采集入口留下的原始快照；`candidate/excerpt.md` 是待核对工作稿，不是事实陈述。

`candidate/transcript.md` 只在 `transcriptStatus=captured` 且存在非空全文时生成，内容包含 ASR 全文、时间轴、模型、时长、片段数和本地 artifact 路径。`meta.json` 的 `transcript.reviewRequired` 必须为 `true`；ASR 同音字、标点和术语错误不能被自动标记为已核实事实。转写失败时保留 `failed` 运行记录，不生成空 transcript，也不能覆盖已捕获全文。

## 核对状态

| 状态 | 含义 | 允许的下一步 |
| --- | --- | --- |
| `unverified` | 自动采集或机器抽取的候选证据 | 打开来源链接、查看原始快照、人工核对 |
| `verified` | 用户已核对来源和摘录，并写了核对说明 | 可进入生产证据引用 |
| `rejected` | 用户判断不可用或来源存疑 | 保留证据包，但不进入生产 |

标记 `verified` 必须填写人工核对说明。重复生成同一个信号的证据包会保留核对状态，只刷新证据文件和索引。

## 边界

1. `evidence/` 只保存在本机或用户显式选择的同步目录，不进入 Git。
2. `unknown` 覆盖率必须保留，不能为了显示 complete 编造总数。
3. 媒体第一版只记录 manifest，不自动下载；后续下载必须按 URL 和 checksum 幂等补齐。
4. 缺少 `raw/snapshot.json` 时，`meta.json` 和主数据索引会显式标记 `missingLayers: ["raw-snapshot"]`。
5. Agent 输出只能进入 candidate 层，不能直接修改 verification 状态。
6. 逐字稿媒体下载必须由用户在单条信号上显式触发；只选择完整 MP4，不下载 `.m4s` 分片，不批量转写。

## 当前 API

```http
POST /api/evidence-packages/create
{ "signalId": "signal-..." }

POST /api/evidence-packages/verify
{
  "id": "evidence-...",
  "state": "verified",
  "checkedBy": "local-user",
  "note": "人工核对说明"
}
```

证据目录可用 `EVIDENCE_DIR` 覆盖，方便测试或后续镜像到用户显式选择的私人目录。
