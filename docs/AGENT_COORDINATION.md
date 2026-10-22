# 单一源码与多 Agent 协作

本文件定义 Content Flow Workbench 的唯一源码，以及 Codex、Claude、Cursor、Grok、Muse 等本地或云端 Agent 并行工作时的合并规则。

## 1. 唯一源码

- 本地唯一源码：`D:\personal-content-workbench` 的 `main` 工作区。
- 远端唯一源码：`https://github.com/XN-289/content-flow-workbench` 的 `main`。
- `main` 必须始终可构建、可启动，并与 `origin/main` 保持同一提交。
- Agent 分支、额外 worktree、handoff 包、桌面副本、Google Drive 镜像和历史截图都只是临时协作产物，不是最终源码。
- `data/`、`evidence/`、`drops/`、`bridge/`、`work/`、`handoff/` 中的真实数据与本地证据不属于公共源码；以本地私人备份为准。

## 2. 角色

- **集成者**：唯一负责把 Agent 分支合入 `main`、解决最终冲突、更新 `PROJECT_STATE.md` / `TODO.md` / `docs/DECISIONS.md` 并推送远端的人。
- **执行 Agent**：在自己的分支或 worktree 内完成一个明确范围，提交可审查的变更，报告提交 SHA、验证结果和残余风险。
- **同一时间一个 worktree 只能由一个 Agent 写入。** 不要两个 runtime 同时改同一个工作目录。

推荐命名：

```text
codex/<task-scope>
claude/<task-scope>
cursor/<task-scope>
```

worktree 放在仓库外，例如：

```text
D:\personal-content-workbench-worktrees\<agent>-<task>
```

## 3. 开始前

1. 读取 `AGENTS.md`、本文件和与任务相关的设计与状态文档。
2. 从最新 `origin/main` 创建独立分支或 worktree，不直接在 `main` 上开发。
3. 声明本次修改的文件边界；涉及共享热点文件时先串行协调。
4. 不把真实主数据复制进公共 worktree；需要演示时使用临时数据和只读 fixture。

```powershell
git fetch origin --prune
git switch main
git merge --ff-only origin/main
git switch -c codex/<task-scope>
```

## 4. 并行边界

以下文件或目录属于高冲突面，默认只允许一个写入者，或由集成者在合并后统一更新：

- `scripts/server.mjs`
- `package.json`、锁文件与构建配置
- `web/src/styles/tokens.css`、`docs/design-tokens.css`
- `app/dist/**`
- `PROJECT_STATE.md`、`TODO.md`、`docs/DECISIONS.md`
- 同一功能域内的多个组件和 API 契约

拆分并行任务时优先按独立模块、独立文档或前后端契约切分。两个 Agent 都需要改同一热点文件时，必须串行，不允许各自覆盖后让集成者猜哪一份正确。

## 5. 交付前合并

执行 Agent 在推送前先把最新远端主线合入自己的分支，在自己的分支内解决冲突并重跑验证：

```powershell
git fetch origin --prune
git merge origin/main
npm run test:chain
```

冲突处理原则：

- 不整文件覆盖另一方改动，逐段保留双方有效行为。
- 数据契约、状态机、安全边界和诚实语义优先于视觉或局部便利。
- 前端构建产物必须由 `npm run build:ui` 重新生成，不手工合并 `app/dist`。
- 冲突解决后至少重跑受影响测试；涉及共享契约时同时跑 `npm run test:chain` 和后端流水线回归。
- 不使用 `git reset --hard`、`git checkout -- .`、强制推送或删除他人分支来“解决”冲突。

## 6. 集成到唯一源码

集成者按一个分支一个分支的顺序合并，每合入一个分支就验证一次：

```powershell
git switch main
git fetch origin --prune
git merge --ff-only origin/main
git merge --ff-only codex/<task-scope>
npm run verify:workbench
git push origin main
npm run verify:source
```

如果 `--ff-only` 失败，说明 `main` 或分支已分叉。回到对应分支合入最新 `origin/main`、解决冲突并重新验证，不得强推。

## 7. 终态门槛

`npm run verify:source` 是发布和交接前的机器门槛，检查：

- 当前分支必须是 `main`。
- 所有 worktree 必须没有未提交或未跟踪文件。
- 不得残留 stash、未解决合并项或冲突标记。
- 所有 worktree HEAD、本地分支和远端分支必须已经包含在 `main`。
- 本地 `main`、`origin/main` 和 GitHub 实时 `main` 必须是同一个 SHA。

该脚本不能替代 `npm run verify:workbench`、浏览器验收或安全边界检查。它们必须同时通过。

## 8. 最终交付信息

每次交接必须提供：

1. 最终提交 SHA。
2. 已合入的分支或 worktree 列表。
3. `npm run verify:source` 结果。
4. `npm run verify:workbench` 与浏览器验收结果。
5. 未解决冲突、未合并分支和残余风险；没有就明确写“无”。
