# Content Flow Workbench Local Plugin

- 协议版本：`3`
- 日期：2026-10-22
- 适用范围：本机运行的 Content Flow Workbench，以及 gkbot、Muse、Codex、Claude、Cursor 等需要读取或推进内容链路的 Agent

## 1. 目标

本地插件把工作台能力暴露为一组固定方法，让其他 Agent 不必理解内部数据文件和服务实现，也不需要获得浏览器登录态。

```text
工作台本地服务
  → runtime locator / 显式 URL
  → client.mjs
  → gkbot / Muse / Codex / Claude / Cursor
  → 平台矩阵、内容登记、单条笔记采集、逐字稿、分析、任务包、Drive 导出、晨间流水线
```

插件只代理公开内容或用户当前页面可见内容。它不绕过登录墙、验证码、IP 风控、私有接口、签名或访问控制。

## 2. 文件与发现

插件目录：

```text
plugin/content-flow-workbench/
  manifest.json
  client.mjs
```

`manifest.json` 是分发和自检用的静态声明。`client.mjs` 是 Node.js ESM 客户端，负责发现服务、校验 manifest、限制 origin 和调用声明内路由。

客户端按以下顺序发现工作台：

1. 构造参数或环境变量 `CONTENT_FLOW_WORKBENCH_URL`
2. 环境变量 `CONTENT_FLOW_WORKBENCH_RUNTIME_FILE` 指向的 locator，未指定时读取系统临时目录的 `content-flow-workbench-runtime.json`
3. 默认端口 `http://127.0.0.1:5177` 和 `http://localhost:5177`

运行时 locator 只在服务真实监听成功后写入，包含协议版本、动态端口、URL、PID 和启动时间。`PORT=0` 时不以配置端口冒充实际端口。

```powershell
$env:CONTENT_FLOW_WORKBENCH_RUNTIME_FILE = "C:\temp\content-flow-workbench-runtime.json"
npm start
```

另一个进程可以直接使用同一个 locator：

```js
import {
  connectContentFlowWorkbench
} from "./plugin/content-flow-workbench/client.mjs";

const workbench = await connectContentFlowWorkbench({
  runtimeFile: "C:/temp/content-flow-workbench-runtime.json"
});

const state = await workbench.getState();
```

也支持显式指定本机服务：

```js
const workbench = await connectContentFlowWorkbench({
  baseUrl: "http://127.0.0.1:5177"
});
```

## 3. 传输安全边界

客户端只接受 `http://127.0.0.1:<port>` 或 `http://localhost:<port>`。

以下输入会被拒绝：

- HTTPS、非 loopback 主机
- URL 内含用户名或密码
- URL path、query 或 hash
- manifest 中不是相对 `/api/**` 的方法路由
- 运行服务未在 manifest 中声明的方法
- HTTP 重定向

客户端没有公开任意 URL request 方法。每个调用只能使用 `manifest.json` 中已声明的方法和相对端点。

请求默认不携带 credentials。插件不读取、不导出、也不转发 Cookie、登录态、浏览器 profile、验证码响应或 capture token。

## 4. 十个固定方法

| 方法 | 参数 | 返回重点 |
| --- | --- | --- |
| `getManifest` | `{ refresh?: boolean }` | 协议版本、十个方法、证据策略和安全边界 |
| `getState` | 无 | 工作台主数据及运行时摘要 |
| `getPlatformCapabilities` | 无 | 五平台、六维度能力矩阵与来源计数 |
| `intakeSource` | `{ text: string }` 或字符串 | 规范化 URL、登记后的信源、下一步人工动作 |
| `captureXiaohongshuNote` | `{ text: string }` 或字符串 | 单条小红书笔记的游客态可见内容、证据包、采集状态和下一步动作 |
| `captureTranscript` | `{ signalId, force?, background? }` 或 `signalId` | 逐字稿候选、时间轴、状态和明确失败原因 |
| `createAnalysis` | `{ signalId, force? }` 或 `signalId` | `unverified` 的逐字稿结构、节奏、机制和带时间戳引文 |
| `createAgentTask` | 见下文 | 本地任务目录、`task.md`、`task.json` 和 Agent 上下文 |
| `exportKnowledge` | `{ driveRoot?: string }` 或 `driveRoot` | Google Drive 同步目录中的知识树、清单和 SHA-256 |
| `runMorningPipeline` | 无 | 六段流水线运行记录和下一步动作 |

### `intakeSource`

```js
await workbench.intakeSource(
  "@示例博主 3.7万粉丝 https://www.xiaohongshu.com/user/profile/<id>"
);
```

小红书可以使用这条方法登记博主主页。具体笔记链接应调用 `captureXiaohongshuNote`；不能把主页登记说成已采集全部笔记，也不能用登记结果冒充单条笔记详情。

### `captureXiaohongshuNote`

```js
await workbench.captureXiaohongshuNote(
  "复制口令查看笔记 https://www.xiaohongshu.com/discovery/item/<note-id>?xsec_token=..."
);

await workbench.captureXiaohongshuNote({
  text: "小红书分享文本、短链接或笔记 URL"
});
```

客户端会把入参规范化为 `{ text }`，固定调用工作台声明的：

```text
POST /api/xhs/guest-capture
```

本地服务使用用户当前可见的游客态浏览器采集单条笔记，并把标题、正文、作者、封面、媒体、章节、平台字幕、可见评论和页面访问状态写入原始快照与证据包。路由只接受 `{ text }`；返回采集运行、信号、信源、证据包和下一步动作。原始页面文本、Cookie、token 和浏览器 profile 不进入 HTTP 返回。

这条方法不遍历博主主页，不绕过登录墙、验证码或安全检查，也不自行处理人机认证。页面要求验证时应保持可见窗口并交回用户。媒体签名地址只用于当次下载，不应作为长期知识资产原样同步。

插件 v3、静态 manifest、运行时 manifest 和后端路由使用同一个固定契约。空输入或额外字段会在启动 Chrome 前返回 HTTP 400；同一分享文本运行期间重复提交返回 HTTP 409。

### `captureTranscript`

```js
await workbench.captureTranscript({
  signalId: "signal-id",
  force: true,
  background: false
});
```

逐字稿优先级是页面可见的平台字幕，其次是平台字幕缺失时才显式触发的单条本地 ASR。已有平台字幕不应被 `force: true` 覆盖。没有完整 `.mp4` 时返回 `ok: false`；不会使用 `.m4s` 分片、正文或猜测内容伪造逐字稿。

`background: true` 会先持久化 `running` 状态并立即返回，调用方随后读取 `getState().signals[].transcriptStatus` 和 `transcriptRuns`。

### `createAnalysis`

```js
await workbench.createAnalysis({
  signalId: "signal-id",
  force: false
});
```

分析要求逐字稿全文和有效时间轴。相同输入哈希会复用已有分析；`force: true` 才生成新版本。

结果包含：

- 开头钩子、承诺与张力
- 结构与时间戳引文
- 语速、密度、峰谷窗口
- 受众线索、留存机制候选和情绪回报
- 作者相对基线
- 可复用公式假设
- 证据缺口

所有 ASR 和启发式分析默认标为 `unverified`。启发式结构不能冒充平台因果证明，引用前必须回看原文并人工核对。

### `createAgentTask`

```js
await workbench.createAgentTask({
  agent: "muse",
  kind: "dissect",
  title: "拆解高互动笔记",
  objective: "解释开头、结构和留存机制，并给出待验证假设。",
  signalId: "signal-id",
  outputRequirements: "保留时间戳和证据缺口。",
  mirrorToDrive: false
});
```

- `agent`: `grok`、`muse`、`codex`、`claude`、`cursor`
- `kind`: `research`、`dissect`、`outline`、`script`、`title`、`platform-copy`、`visual`

绑定 `signalId` 时，任务包保留全文逐字稿、时间轴、ASR 模型、最新分析和 `unverified` 边界。任务默认只写本地 `bridge/outbox/<task-id>/`；只有显式设置 `mirrorToDrive: true` 才镜像到已配置的 Google Drive 同步目录。

### `exportKnowledge`

```js
await workbench.exportKnowledge({
  driveRoot: "G:/My Drive"
});
```

导出位置：

```text
<driveRoot>/ContentFlowWorkbench/Knowledge/
  manifest.json
  README.md
  analyses/<analysis-id>.json
  analyses/<analysis-id>.md
  transcripts/<signal-id>.json
```

`manifest.json` 为每个文件记录 SHA-256，声明不包含凭据、Cookie、登录态和原始浏览器产物。导出必须由用户显式触发。

## 5. gkbot 与 Muse 接入

如果宿主能够加载 Node.js ESM 本地模块，直接把整个 `plugin/content-flow-workbench/` 目录交给宿主，并从 `manifest.json` 注册可用方法。不要在宿主中复制一套 HTTP 路由；始终调用 `client.mjs`，让 origin、方法白名单和 manifest 校验集中在一个入口。

最小调用流程：

```js
import { connectContentFlowWorkbench } from "./client.mjs";

const workbench = await connectContentFlowWorkbench();
const capabilities = await workbench.getPlatformCapabilities();
const capture = await workbench.captureXiaohongshuNote(
  "小红书分享文本或笔记 URL"
);
const state = await workbench.getState();

const signalId = capture.signalId || capture.signal?.id;
const signal = state.signals.find((item) => item.id === signalId);
if (signal?.transcriptStatus === "captured") {
  await workbench.createAnalysis({ signalId: signal.id });
}
```

如果宿主只能执行命令行，使用同一目录中的 `client.mjs` 写一个很薄的 Node 启动器，不要直接拼接工作台 URL。这样仍然保留 loopback、重定向和端点白名单约束。

建议为 gkbot 和 Muse 分别配置：

```text
CONTENT_FLOW_WORKBENCH_RUNTIME_FILE=<本机 locator 路径>
```

这样宿主不需要写死端口。工作台升级后，locator 会提供新服务和协议版本。

## 6. Google Drive 边界

插件使用 Google Drive 桌面客户端的本地同步目录，不请求 OAuth，不保存 Google API Key，也不直接修改云端权限。

调用 `exportKnowledge` 前必须满足：

1. Google Drive 桌面客户端已启动并登录。
2. 同步目录在本机真实存在。
3. 用户明确触发导出或任务镜像。

如果目录不存在，调用失败，不会改写到猜测路径。

## 7. 人工关卡

以下情况必须交回用户：

- 登录墙、验证码、人机认证、安全验证或访问限制
- 需要登录后才能看到的搜索结果、评论或详情
- 需要确认素材可以同步到云端
- 逐字稿事实、数字、时间和引文的人工校对
- 选题取舍、终稿、发布和复盘判断

自动化的职责是采集、整理、分析和分发上下文，不是代替用户判断，也不是绕过平台控制。

## 8. 验证与分发

运行插件隔离回归：

```powershell
npm run test:plugin
```

该回归会启动动态端口的临时服务，验证 locator、协议版本、十个方法、manifest 路由声明、安全拒绝、`captureXiaohongshuNote` 的字符串/对象入参和固定传输映射、无 MP4 时的逐字稿失败边界、Agent 任务、Drive 导出和晨间流水线。

插件侧回归不会打开真实小红书页面，但会把 `POST /api/xhs/guest-capture` 的路由存在性、源码/运行时契约和空输入拒绝设为硬断言，并确认空输入不会创建浏览器采集运行。登录/验证码人工接管和真实证据落库仍由后端独立集成回归验证，客户端 mock 结果不能视为真实采集成功。

分发给其他 Agent 时至少包含：

```text
manifest.json
client.mjs
docs/plugin.md
```

接收方仍需连接本机正在运行的工作台。插件文件本身不包含工作台数据、登录态或 Google Drive 凭据。
