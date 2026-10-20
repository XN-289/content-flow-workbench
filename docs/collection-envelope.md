# 采集结果信封

统一信封用于比较不同采集入口的结果：公开 RSS、公开页面、浏览器辅助采集、本地投递箱和快速粘贴。它只描述本次运行观察到的事实，不把候选内容升级为已核实信息。

## 字段契约

每条 `collectionRun.envelope` 固定包含：

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `found` | number | 本次输入中可识别的对象数 |
| `created` | number | 实际新增的 signal / material 数 |
| `duplicates` | number | 因多层身份命中而被跳过的对象数 |
| `blocked` | 0 / 1 | 本次是否需要人工动作或专用 adapter |
| `failed` | 0 / 1 | 本次是否失败 |
| `coverage` | object / null | 可见范围覆盖；公开入口通常为 `null` |
| `nextAction` | string | 直接可执行的下一步，空字符串表示暂无动作 |
| `cursor` | string / null | 后续分页或续采游标；当前入口不依赖分页时为 `null` |
| `error` | string / null | 人类可读错误；来自 `failureReason` |

浏览器辅助采集的 `coverage` 使用现有口径：`totalNotes` 是主页显示总数，`collectedCount` 是当前源累计入库数，`lastLoadedCount` 是本次页面可见数，`status` / `percent` 表示补采状态。

运行记录同时保留原有扁平字段（例如 `run.found`、`run.created`、`run.duplicates`），方便旧 UI 和旧数据读取；新逻辑必须读取 `run.envelope`。

## 聚合

`/api/automation/tick` 的返回值增加 `envelope`，由实际完成的 `collectionRun` 聚合而来。`found / created / duplicates / blocked / failed` 是求和，`nextAction` 取第一个非空动作，`error` 取第一个错误，`coverage` 和 `cursor` 在聚合层为 `null`。

## 验证

`npm run test:chain` 覆盖快速粘贴、浏览器辅助采集、失败 RSS、投递箱 pending 和稳定入库的信封字段。
