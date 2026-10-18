# Content Flow Workbench

本地单人内容工作台，用来把信号采集、素材沉淀、选题、口播生产、发布记录和复盘放在同一个界面里。数据保存在本地 JSON，不依赖数据库和云端服务。

## 快速开始

```powershell
git clone https://github.com/XN-289/content-flow-workbench.git
cd content-flow-workbench
npm start
```

打开：<http://127.0.0.1:5177>

首次启动时如果 `data/workbench.json` 不存在，服务会返回空工作台；第一次保存后会自动生成本地主数据。

## 每日节奏

1. 08:40 执行采集，或在服务启动后运行：

   ```powershell
   npm run collect
   ```

2. 09:00 打开今日页，处理 Inbox。
3. 把高价值信号分成 `dissect`、`material`、`watch`、`discard`。
4. 生产时从素材库和选题池取输入，不把所有判断都压到写稿环节。

当前采集器支持：

- `public-rss`：抓取 RSS / Atom，去重后生成 Inbox 信号。
- `public-page`：保存公开页面原始快照，暂不解析成信号。
- `browser-assisted`：用户手动打开页面并滚动到目标范围后，通过粘贴可见列表 JSON 或采集书签读取当前已加载内容。脚本不自动滚动、不调用平台接口、不绕过登录或验证码。
- `manual`、`platform-export`：记录 blocked 状态和下一步人工动作，不伪装成自动成功。

## 数据与隐私

- 主数据：`data/workbench.json`（本地生成，不进入 Git）
- 导入模板：[data/import-template.json](data/import-template.json)
- 页面导出：工作台右上角“导出”

不要提交以下内容：

- 真实对标账号、笔记链接、评论摘录和个人素材。
- 平台临时访问参数、Cookie、登录态或 API token。
- `data/exports/`、`data/raw/`、日志、浏览器 profile 和环境变量文件。

如需换机器，先在旧机器导出 JSON，再在新机器恢复到 `data/workbench.json`。恢复文件仍然只保存在本地，不要提交。

## 交接地图

| 需要什么 | 看哪里 |
| --- | --- |
| 当前状态、事实、未决问题 | [PROJECT_STATE.md](PROJECT_STATE.md) |
| 阶段待办和下一个行动 | [TODO.md](TODO.md) |
| 总体方案和版本计划 | [PLAN.md](PLAN.md) |
| North Star 生产线 | [docs/north-star-roadmap.md](docs/north-star-roadmap.md) |
| Park 原型分析 | [docs/park-prototype-analysis.md](docs/park-prototype-analysis.md) |
| 小红书采集边界 | [docs/xhs-collection-research.md](docs/xhs-collection-research.md) |
| 日常输入流程 | [docs/local-input-workflow.md](docs/local-input-workflow.md) |
| 决策记录 | [decisions.md](decisions.md) |

## 验证

```powershell
node --check scripts/server.mjs
node --check scripts/collect-all.mjs
node --check app/app.js
node -e "JSON.parse(require('fs').readFileSync('data/import-template.json','utf8')); console.log('JSON OK')"
npm start
```

启动后确认首页和 `/api/state` 都返回 200。
