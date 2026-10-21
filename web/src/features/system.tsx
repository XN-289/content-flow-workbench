import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { fmtClock, fmtDateTime, platformLabel, toneForRunStatus } from "../lib/format";
import { RUN_STATUS_LABEL } from "../lib/constants";
import { useStore } from "../state/store";
import { Shell } from "../components/AppShell";
import { Button, Card, Chip, EmptyState, Field, Sheet, Switch } from "../components/primitives";

export function SystemView() {
  const { state, mutate, busy } = useStore();
  const [backups, setBackups] = useState<any[]>([]);
  const [sheet, setSheet] = useState<null | "agent" | "backup" | "import">(null);
  const [draft, setDraft] = useState<any>({});
  const [error, setError] = useState<string | null>(null);

  const loadBackups = async () => {
    try {
      const result = await api.backups();
      setBackups(result?.backups || result?.items || []);
    } catch {
      setBackups([]);
    }
  };

  useEffect(() => {
    loadBackups();
  }, []);

  if (!state) return null;

  const automation = state.runtime?.automation || {};
  const runs = state.collectionRuns || [];

  const toggleAutomation = (next: boolean) => {
    mutate("automation", () => api.automationSettings(next), next ? "自动化已恢复" : "自动化已暂停");
  };

  const restore = (filename: string) => {
    if (!window.confirm(`确认恢复备份「${filename}」？当前状态会先自动保存为恢复前备份。`)) return;
    mutate("restore", async () => {
      await api.backupRestore(filename);
      await loadBackups();
    }, "备份已恢复");
  };

  return (
    <>
      <Shell
        canvas={
          <>
            <div className="canvas-columns">
              <Card title="自动化与调度" hint="环境变量优先级最高">
                <div className="stack" style={{ gap: 12 }}>
                  <Switch
                    checked={Boolean(state.settings?.automationEnabled)}
                    onChange={toggleAutomation}
                    label={`页面开关：${state.settings?.automationEnabled ? "已开启" : "已关闭"}`}
                  />
                    <Switch
                      checked={Boolean(automation.effectiveEnabled)}
                      onChange={() => undefined}
                      disabled
                      label={`实际生效状态（只读）：${automation.effectiveEnabled ? "运行中" : "已暂停"}`}
                    />
                  {automation.envDisabled ? (
                    <p className="subtle" style={{ fontSize: 12, lineHeight: "18px" }}>
                      当前进程以 AUTOMATION_ENABLED=false 启动，环境变量关闭优先于页面开关。需要恢复定时采集时，请在启动命令中去掉该变量。
                    </p>
                  ) : null}
                  <div className="inline">
                    <Button small disabled={busy === "tick"} onClick={() => mutate("tick", () => api.automationTick(true), "已手动触发一次检查")}>
                      手动触发检查
                    </Button>
                    <Button small disabled={busy === "drop"} onClick={() => mutate("drop", () => api.dropFolderScan(), "投递箱已扫描")}>
                      扫描投递箱
                    </Button>
                    <Button small disabled={busy === "morning"} onClick={() => mutate("morning", () => api.runMorningPipeline(), "晨间流水线已运行")}>
                      运行晨间流水线
                    </Button>
                  </div>
                </div>
              </Card>

              <Card title="备份与恢复" hint="只在本地，不外传">
                <div className="stack" style={{ gap: 12 }}>
                  <div className="inline">
                    <Button small disabled={busy === "backup"} onClick={() => mutate("backup", async () => {
                      const result = await api.backupCreate();
                      await loadBackups();
                      return result;
                    }, "备份已处理")}>
                      立即备份
                    </Button>
                    <Button small onClick={() => setSheet("import")}>
                      导入状态文件
                    </Button>
                  </div>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>备份</th>
                        <th>时间</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {backups.slice(0, 8).map((item: any) => (
                        <tr key={item.filename || item.name}>
                          <td>
                            <span className="mono">{item.filename || item.name}</span>
                          </td>
                          <td>{fmtDateTime(item.createdAt)}</td>
                          <td>
                            <Button small onClick={() => restore(item.filename || item.name)}>
                              恢复
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!backups.length ? <EmptyState text="还没有备份记录" /> : null}
                </div>
              </Card>
            </div>

            <Card
              title="Agent 任务"
              hint={`${state.agentTasks.length} 个任务`}
              actions={
                <>
                  <Button small disabled={busy === "agent-scan"} onClick={() => mutate("agent-scan", () => api.agentScan(), "已扫描本机结果")}>
                    扫描结果
                  </Button>
                  <Button small variant="primary" onClick={() => { setDraft({ title: "", prompt: "" }); setError(null); setSheet("agent"); }}>
                    新建任务
                  </Button>
                </>
              }
            >
              {state.agentTasks.length ? (
                <table className="table">
                  <thead>
                    <tr>
                      <th>任务</th>
                      <th>状态</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.agentTasks.map((task: any) => (
                      <tr key={task.id}>
                        <td>
                          <strong>{task.title || task.id}</strong>
                          <div className="subtle" style={{ fontSize: 11 }}>
                            {task.outboxPath || "无输出路径"}
                          </div>
                        </td>
                        <td>
                          <Chip tone={toneForRunStatus(task.status)}>{RUN_STATUS_LABEL[task.status] || task.status || "待处理"}</Chip>
                        </td>
                        <td>
                          <div className="inline">
                            <Button small disabled={busy === `agent-run-${task.id}`} onClick={() => mutate(`agent-run-${task.id}`, () => api.agentRun(task.id), "已触发本机 Agent")}>
                              运行
                            </Button>
                            <Button small disabled={busy === `agent-import-${task.id}`} onClick={() => mutate(`agent-import-${task.id}`, () => api.agentImport(task.id), "结果已导入")}>
                              导入结果
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <EmptyState text="没有待处理的 Agent 任务。本机 Agent 结果只会作为候选导入，不会自动变成成品。" />
              )}
            </Card>

            <Card title="采集运行记录" hint={`${runs.length} 次`}>
              <table className="table">
                <thead>
                  <tr>
                    <th>账号</th>
                    <th>触发</th>
                    <th>结果</th>
                    <th>时间</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.slice(0, 12).map((run: any) => {
                    const source = state.sources.find((item: any) => item.id === run.sourceId);
                    return (
                      <tr key={run.id}>
                        <td>{source?.name || run.sourceId}</td>
                        <td>{run.trigger || "—"}</td>
                        <td>
                          <div className="inline">
                            <Chip tone={toneForRunStatus(run.status)}>{RUN_STATUS_LABEL[run.status] || run.status}</Chip>
                            <span className="subtle" style={{ fontSize: 11 }}>
                              发现 {run.found ?? 0} · 新增 {run.created ?? 0} · 受阻 {run.blocked ?? 0}
                            </span>
                          </div>
                          {run.failureReason || run.nextAction ? (
                            <div className="subtle" style={{ fontSize: 11, marginTop: 4 }}>
                              {run.failureReason || run.nextAction}
                            </div>
                          ) : null}
                        </td>
                        <td>{fmtClock(run.finishedAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>

            <Card title="运行设置" hint="只保存本地偏好">
              <div className="canvas-columns" style={{ gap: 12 }}>
                <Field label="每日 Inbox 时间" hint="格式 HH:MM">
                  <input
                    className="input"
                    defaultValue={state.settings?.inboxTime || "09:00"}
                    onBlur={(event) =>
                      mutate("settings-inbox-time", () => api.update("settings", "inboxTime", { inboxTime: event.target.value }), "已保存")
                    }
                  />
                </Field>
                <Field label="每日条数上限">
                  <input
                    className="input"
                    type="number"
                    defaultValue={state.settings?.inboxDailyLimit ?? 10}
                    onBlur={(event) =>
                      mutate("settings-limit", () => api.update("settings", "inboxDailyLimit", { inboxDailyLimit: Number(event.target.value) }), "已保存")
                    }
                  />
                </Field>
              </div>
            </Card>
          </>
        }
        inspector={
          <>
            <Card title="运行环境" tight>
              <div className="stack" style={{ gap: 8 }}>
                <Row label="服务" value="127.0.0.1 本地单进程" />
                <Row label="数据" value="data/workbench.json" />
                <Row label="投递箱" value={state.settings?.driveRoot || "未配置"} />
                <Row label="证据目录" value={`${state.evidencePackages.length} 个包`} />
              </div>
            </Card>
            <Card title="安全边界" tight>
              <div className="stack" style={{ gap: 8 }}>
                <p className="subtle" style={{ fontSize: 12, lineHeight: "18px" }}>
                  不保存平台 Cookie 或登录态，不绕过验证码；受限、失败、跳过一律如实记录，不伪装成成功。真实账号、评论、媒体与逐字稿只留在本地。
                </p>
              </div>
            </Card>
          </>
        }
      />

      <Sheet
        open={sheet === "agent"}
        title="新建 Agent 任务"
        onClose={() => setSheet(null)}
        footer={
          <>
            <Button onClick={() => setSheet(null)}>取消</Button>
            <Button
              variant="primary"
              onClick={async () => {
                try {
                  await api.agentCreate(draft);
                  setSheet(null);
                  await mutate("agent-create", () => Promise.resolve(), "任务包已生成");
                } catch (err: any) {
                  setError(err.message || "创建失败");
                }
              }}
            >
              创建
            </Button>
          </>
        }
      >
        <Field label="任务标题" error={error || undefined}>
          <input className="input" value={draft.title || ""} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        </Field>
        <Field label="任务说明" hint="写清输入、约束和交付格式">
          <textarea className="textarea" style={{ minHeight: 140 }} value={draft.prompt || ""} onChange={(e) => setDraft({ ...draft, prompt: e.target.value })} />
        </Field>
      </Sheet>

      <Sheet
        open={sheet === "import"}
        title="导入状态文件"
        onClose={() => setSheet(null)}
        footer={<Button onClick={() => setSheet(null)}>关闭</Button>}
      >
        <Field label="选择 workbench.json" hint="导入会覆盖当前状态，建议先做一次备份" error={error || undefined}>
          <input
            className="input"
            type="file"
            accept="application/json"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              try {
                const payload = JSON.parse(await file.text());
                await api.importState(payload);
                setSheet(null);
                await mutate("import", () => Promise.resolve(), "状态已导入");
              } catch (err: any) {
                setError(err.message || "导入失败");
              }
            }}
          />
        </Field>
      </Sheet>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
      <span className="muted" style={{ fontSize: 12 }}>
        {label}
      </span>
      <span className="subtle mono" style={{ fontSize: 11, textAlign: "right" }}>
        {value}
      </span>
    </div>
  );
}
