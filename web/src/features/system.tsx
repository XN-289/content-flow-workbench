import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { fmtClock, fmtDateTime, toneForEvidence, toneForRunStatus } from "../lib/format";
import { RUN_STATUS_LABEL } from "../lib/constants";
import type { AgentName, AgentTaskCreatePayload, AgentTaskKind } from "../lib/types";
import { useStore } from "../state/store";
import { Shell } from "../components/AppShell";
import { Button, Card, Chip, EmptyState, Field, Sheet, Switch } from "../components/primitives";

const AGENT_OPTIONS: { value: AgentName; label: string }[] = [
  { value: "grok", label: "Grok" },
  { value: "muse", label: "Muse" },
  { value: "codex", label: "Codex" },
  { value: "claude", label: "Claude" },
  { value: "cursor", label: "Cursor" }
];

const TASK_KIND_OPTIONS: { value: AgentTaskKind; label: string }[] = [
  { value: "research", label: "研究" },
  { value: "dissect", label: "内容拆解" },
  { value: "outline", label: "提纲" },
  { value: "script", label: "口播稿" },
  { value: "title", label: "标题" },
  { value: "platform-copy", label: "平台文案" },
  { value: "visual", label: "视觉脚本" }
];

const TOPIC_REQUIRED_KINDS = new Set<AgentTaskKind>(["outline", "script"]);

type AgentFormErrors = Partial<Record<"title" | "objective" | "topicId" | "mirrorToDrive", string>>;

function initialAgentDraft(topicId?: string | null): AgentTaskCreatePayload {
  return {
    agent: "codex",
    kind: "research",
    title: "",
    objective: "",
    topicId: topicId || "",
    signalId: "",
    mirrorToDrive: false
  };
}

function labelForAgent(value?: string) {
  return AGENT_OPTIONS.find((option) => option.value === value)?.label || value || "Agent";
}

function labelForTaskKind(value?: string) {
  return TASK_KIND_OPTIONS.find((option) => option.value === value)?.label || value || "任务类型待定";
}

export function SystemView() {
  const { state, mutate, busy, activeTopicId } = useStore();
  const [backups, setBackups] = useState<any[]>([]);
  const [sheet, setSheet] = useState<null | "agent" | "backup" | "import">(null);
  const [draft, setDraft] = useState<AgentTaskCreatePayload>(() => initialAgentDraft(activeTopicId));
  const [agentErrors, setAgentErrors] = useState<AgentFormErrors>({});
  const [agentError, setAgentError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [driveRootDraft, setDriveRootDraft] = useState("");
  const [driveRootDirty, setDriveRootDirty] = useState(false);
  const [driveFeedback, setDriveFeedback] = useState<{ tone: "success" | "danger"; message: string } | null>(null);

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
  const configuredDriveRoot = String(state.settings?.driveRoot || "").trim();
  const driveSaving = busy === "drive-root";
  const agentCreating = busy === "agent-create";

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

  const openAgentSheet = () => {
    const defaultTopicId = state.topics.some((topic) => topic.id === activeTopicId) ? activeTopicId : "";
    setDraft(initialAgentDraft(defaultTopicId));
    setAgentErrors({});
    setAgentError(null);
    setSheet("agent");
  };

  const updateAgentDraft = (patch: Partial<AgentTaskCreatePayload>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setAgentErrors({});
    setAgentError(null);
  };

  const submitAgentTask = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors: AgentFormErrors = {};
    if (!draft.title.trim()) nextErrors.title = "请输入任务标题";
    if (!draft.objective.trim()) nextErrors.objective = "请写清研究目标与交付要求";
    if (TOPIC_REQUIRED_KINDS.has(draft.kind) && !draft.topicId) nextErrors.topicId = "提纲和口播稿任务必须绑定选题";
    if (draft.mirrorToDrive && !configuredDriveRoot) nextErrors.mirrorToDrive = "请先保存 Google Drive 同步目录";

    setAgentErrors(nextErrors);
    setAgentError(null);
    const firstError = Object.keys(nextErrors)[0];
    if (firstError) {
      const fieldId = {
        title: "agent-task-title",
        objective: "agent-task-objective",
        topicId: "agent-task-topic",
        mirrorToDrive: "agent-task-drive-switch"
      }[firstError as keyof AgentFormErrors];
      window.requestAnimationFrame(() => document.getElementById(fieldId)?.focus());
      return;
    }

    try {
      await mutate(
        "agent-create",
        () =>
          api.agentCreate({
            ...draft,
            title: draft.title.trim(),
            objective: draft.objective.trim(),
            topicId: draft.topicId?.trim() || "",
            signalId: draft.signalId?.trim() || ""
          }),
        "Agent 任务包已创建"
      );
      setSheet(null);
    } catch (err: any) {
      setAgentError(err.message || "创建失败");
    }
  };

  const saveDriveRoot = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setDriveFeedback(null);
    const nextDriveRoot = driveRootDirty ? driveRootDraft.trim() : configuredDriveRoot;
    try {
      const result = await mutate(
        "drive-root",
        () => api.agentBridge(nextDriveRoot),
        "Google Drive 同步目录已保存"
      );
      const savedRoot = String(result?.settings?.driveRoot || "");
      setDriveRootDraft(savedRoot);
      setDriveRootDirty(false);
      setDriveFeedback({
        tone: "success",
        message: savedRoot ? "已启用任务包镜像。知识文件仍按显式导出动作处理。" : "同步目录已清空，任务包只保留在本地。"
      });
    } catch (err: any) {
      setDriveFeedback({ tone: "danger", message: err.message || "保存失败" });
    }
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
                    <Button small onClick={() => { setImportError(null); setSheet("import"); }}>
                      导入状态文件
                    </Button>
                  </div>
                  <div className="table-scroll" role="region" aria-label="备份列表" tabIndex={0}>
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
                  </div>
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
                  <Button small variant="primary" onClick={openAgentSheet}>
                    新建任务
                  </Button>
                </>
              }
            >
              {state.agentTasks.length ? (
                <div className="table-scroll" role="region" aria-label="Agent 任务列表" tabIndex={0}>
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
                              {labelForAgent(task.agent)} · {labelForTaskKind(task.kind)}
                              {task.signalId ? ` · 信号 ${task.signalId}` : ""}
                            </div>
                            <div className="subtle" style={{ fontSize: 11 }}>
                              {task.outboxPath || "无输出路径"}
                            </div>
                          </td>
                          <td>
                            <Chip tone={toneForRunStatus(task.status)}>{RUN_STATUS_LABEL[task.status] || task.status || "待处理"}</Chip>
                          </td>
                          <td>
                            <div className="inline">
                              {task.status === "outbox" ? (
                                <Button small disabled={busy === `agent-run-${task.id}`} onClick={() => mutate(`agent-run-${task.id}`, () => api.agentRun(task.id), "已触发本机 Agent")}>
                                  运行
                                </Button>
                              ) : null}
                              {task.status === "result-ready" ? (
                                <Button small disabled={busy === `agent-import-${task.id}`} onClick={() => mutate(`agent-import-${task.id}`, () => api.agentImport(task.id), "结果已导入")}>
                                  导入结果
                                </Button>
                              ) : null}
                              {!["outbox", "result-ready"].includes(task.status) ? (
                                <span className="subtle" style={{ fontSize: 12 }}>当前状态无需操作</span>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState text="没有待处理的 Agent 任务。本机 Agent 结果只会作为候选导入，不会自动变成成品。" />
              )}
            </Card>

            <Card title="采集运行记录" hint={`${runs.length} 次`}>
              <div className="table-scroll" role="region" aria-label="采集运行记录" tabIndex={0}>
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
              </div>
            </Card>

            <Card title="知识包历史" hint={`${state.knowledgeExports.length} 次显式导出`}>
              {state.knowledgeExports.length ? (
                <ul className="knowledge-export-list" aria-label="知识包导出历史">
                  {state.knowledgeExports.slice(0, 12).map((item) => (
                    <li key={item.id} className="knowledge-export-item">
                      <div className="knowledge-export-head">
                        <div className="knowledge-export-identity">
                          <strong className="mono">{item.id}</strong>
                          <span className="subtle">完成 {fmtDateTime(item.createdAt)}</span>
                        </div>
                        <div className="inline">
                          <Chip tone={toneForRunStatus(item.status)}>
                            {RUN_STATUS_LABEL[item.status] || item.status || "状态未知"}
                          </Chip>
                          <Chip tone={toneForEvidence(item.evidenceState)}>{item.evidenceState}</Chip>
                        </div>
                      </div>
                      <div className="knowledge-export-metrics">
                        <span>{item.analysisCount} 个拆解</span>
                        <span>{item.transcriptCount} 份逐字稿</span>
                        <span>{item.fileCount} 个文件</span>
                      </div>
                      <div className="knowledge-export-target">
                        <span>目标路径</span>
                        <code>{item.targetRoot || "未记录"}</code>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState text="还没有知识包导出记录。信息流中显式导出后，结果会出现在这里。" />
              )}
            </Card>

            <div className="canvas-columns">
              <Card title="运行设置" hint="只保存本地偏好">
                <div className="stack" style={{ gap: 12 }}>
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

              <Card title="Google Drive 同步" hint="本机同步目录，不是工作台投递箱">
                <form className="stack" style={{ gap: 12 }} onSubmit={saveDriveRoot}>
                  <Field
                    label="同步目录"
                    hint="填写 Google Drive 桌面版映射到本机的绝对路径。任务包会镜像到 ContentFlowWorkbench/Outbox。"
                    error={driveFeedback?.tone === "danger" ? driveFeedback.message : undefined}
                  >
                    <input
                      className="input mono"
                      value={driveRootDirty ? driveRootDraft : configuredDriveRoot}
                      disabled={driveSaving}
                      spellCheck={false}
                      aria-label="Google Drive 同步目录"
                      aria-invalid={driveFeedback?.tone === "danger"}
                      placeholder="C:\Users\you\Google Drive\My Drive"
                      onChange={(event) => {
                        setDriveRootDraft(event.target.value);
                        setDriveRootDirty(true);
                        setDriveFeedback(null);
                      }}
                    />
                  </Field>
                  <div className="inline">
                    <Button type="submit" small disabled={driveSaving}>
                      {driveSaving ? "保存中..." : "保存目录"}
                    </Button>
                    <Chip tone={configuredDriveRoot ? "success" : "neutral"}>
                      {configuredDriveRoot ? "已配置" : "未配置"}
                    </Chip>
                  </div>
                  {driveFeedback?.tone === "success" ? (
                    <div className="inline" role="status">
                      <Chip tone="success">已保存</Chip>
                      <span className="subtle" style={{ fontSize: 12 }}>
                        {driveFeedback.message}
                      </span>
                    </div>
                  ) : null}
                </form>
              </Card>
            </div>
          </>
        }
        inspector={
          <>
            <Card title="运行环境" tight>
              <div className="stack" style={{ gap: 8 }}>
                <Row label="服务" value="127.0.0.1 本地单进程" />
                <Row label="数据" value="data/workbench.json" />
                <Row label="Drive 同步目录" value={configuredDriveRoot || "未配置"} />
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
              type="submit"
              form="agent-task-form"
              disabled={agentCreating}
            >
              {agentCreating ? "创建中..." : "创建"}
            </Button>
          </>
        }
      >
        <form id="agent-task-form" className="stack" style={{ gap: 16 }} onSubmit={submitAgentTask}>
          {agentError ? (
            <div className="field-error" role="alert">
              {agentError}
            </div>
          ) : null}
          <div className="canvas-columns" style={{ gap: 12 }}>
            <Field label="Agent">
              <select
                className="select"
                value={draft.agent}
                aria-label="Agent"
                onChange={(event) => updateAgentDraft({ agent: event.target.value as AgentName })}
              >
                {AGENT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="任务类型">
              <select
                className="select"
                value={draft.kind}
                aria-label="任务类型"
                onChange={(event) => updateAgentDraft({ kind: event.target.value as AgentTaskKind })}
              >
                {TASK_KIND_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="任务标题" error={agentErrors.title}>
            <input
              id="agent-task-title"
              className="input"
              value={draft.title}
              maxLength={120}
              aria-label="任务标题"
              aria-invalid={Boolean(agentErrors.title)}
              onBlur={() => {
                if (!draft.title.trim()) setAgentErrors((current) => ({ ...current, title: "请输入任务标题" }));
              }}
              onChange={(event) => updateAgentDraft({ title: event.target.value })}
            />
          </Field>
          <Field label="Objective" hint="写清要回答的问题、证据约束和交付格式" error={agentErrors.objective}>
            <textarea
              id="agent-task-objective"
              className="textarea"
              style={{ minHeight: 150 }}
              value={draft.objective}
              maxLength={3000}
              aria-label="Objective"
              aria-invalid={Boolean(agentErrors.objective)}
              onBlur={() => {
                if (!draft.objective.trim()) {
                  setAgentErrors((current) => ({ ...current, objective: "请写清研究目标与交付要求" }));
                }
              }}
              onChange={(event) => updateAgentDraft({ objective: event.target.value })}
            />
          </Field>
          <Field
            label="绑定选题"
            hint={TOPIC_REQUIRED_KINDS.has(draft.kind) ? "当前任务类型必须绑定选题。" : "可选。用于带入现有选题、素材和稿件上下文。"}
            error={agentErrors.topicId}
          >
            <select
              id="agent-task-topic"
              className="select"
              value={draft.topicId || ""}
              aria-label="绑定选题"
              aria-invalid={Boolean(agentErrors.topicId)}
              onChange={(event) => updateAgentDraft({ topicId: event.target.value })}
            >
              <option value="">不绑定选题</option>
              {state.topics.map((topic) => (
                <option key={topic.id} value={topic.id}>
                  {topic.title || topic.id}
                </option>
              ))}
            </select>
          </Field>
          <Field label="绑定信号" hint="可选。选择一条对标笔记，让 Agent 带入该信号的本地上下文。">
            <select
              className="select"
              value={draft.signalId || ""}
              aria-label="绑定信号"
              onChange={(event) => updateAgentDraft({ signalId: event.target.value })}
            >
              <option value="">不绑定单条信号</option>
              {state.signals.map((signal) => (
                <option key={signal.id} value={signal.id}>
                  {signal.title || signal.note || signal.id}
                  {signal.author ? ` · ${signal.author}` : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="任务包去向"
            hint={
              configuredDriveRoot
                ? "开启后会镜像到 Google Drive；无论是否开启，本地 Outbox 都会保留一份。"
                : "先在系统页保存 Google Drive 同步目录，才能开启镜像。"
            }
            error={agentErrors.mirrorToDrive}
          >
            <div className="inline" id="agent-task-drive-switch" tabIndex={-1}>
              <Switch
                checked={Boolean(draft.mirrorToDrive)}
                disabled={!configuredDriveRoot}
                label={draft.mirrorToDrive ? "镜像到 Google Drive" : "仅保留本地 Outbox"}
                onChange={(checked) => updateAgentDraft({ mirrorToDrive: checked })}
              />
            </div>
          </Field>
        </form>
      </Sheet>

      <Sheet
        open={sheet === "import"}
        title="导入状态文件"
        onClose={() => setSheet(null)}
        footer={<Button onClick={() => setSheet(null)}>关闭</Button>}
      >
        <Field label="选择 workbench.json" hint="导入会覆盖当前状态，建议先做一次备份" error={importError || undefined}>
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
                setImportError(err.message || "导入失败");
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
