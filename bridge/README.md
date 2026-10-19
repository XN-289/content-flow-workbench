# Agent Bridge

这个目录保存 Agent 任务包和结果，真实任务内容只留在本机，不进入 Git。

- `outbox/<task-id>/task.md`：给 Grok、Muse、Codex、Claude 或 Cursor 的完整任务。
- `outbox/<task-id>/result.md`：Agent 结果回流文件。
- `outbox/<task-id>/run-codex.ps1`：本机 Codex 非交互启动脚本。
- `outbox/<task-id>/run-claude.ps1`：本机 Claude 非交互启动脚本。

如果已在工作台填写 Google Drive 桌面同步目录，每个任务会同步镜像到：

```text
<Google Drive>/ContentFlowWorkbench/Outbox/<task-id>/
```

不要把 Cookie、API Key、平台登录态或不愿同步到云盘的私密素材放进任务包。
