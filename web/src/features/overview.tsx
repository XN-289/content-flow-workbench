import React, { useMemo } from "react";
import { api } from "../lib/api";
import { STAGE_LABEL } from "../lib/constants";
import {
  countChars,
  fmtClock,
  fmtDateTime,
  pipelineStatusLabel,
  platformLabel,
  toneForPipelineStage
} from "../lib/format";
import { MANUAL_GATE_KEYS, evaluateStageGate } from "../lib/stage-gates";
import { useStore } from "../state/store";
import { Shell } from "../components/AppShell";
import { Button, Card, Chip, QueueRow, Skeleton, StageTrack, StepTrack } from "../components/primitives";

export function OverviewView({ onOpenSignalFlow }: { onOpenSignalFlow: () => void }) {
  const { state, loading, error, refresh, mutate, busy, setView, activeTopicId } = useStore();

  const derived = useMemo(() => {
    const runtime = state?.runtime || {};
    const inbox = runtime.inbox || {};
    const evidence = runtime.evidencePackages || {};
    const pipeline = runtime.morningPipeline || {};
    const commandCenter = runtime.commandCenter || {};
    const topics = state?.topics || [];
    const activeTopic = topics.find((topic: any) => topic.id === activeTopicId) || topics[0];
      const pendingGates = MANUAL_GATE_KEYS.filter((key) => activeTopic?.gates?.[key] !== true);
      const stageGate = evaluateStageGate(state, activeTopic);
    const rehearsals = (state?.publications || []).filter((item: any) => String(item.url || "").startsWith("workbench://local-rehearsal"));
    const blockedRuns = (state?.collectionRuns || []).filter((run: any) => run.status === "blocked" || run.status === "failed");
    const manualSources = (commandCenter.records || []).filter((record: any) => record.controlStatus === "manual");
    const blockedSources = (commandCenter.records || []).filter((record: any) => record.coverage?.status === "blocked");
    const scripts = (state?.scripts || []).filter((script: any) => script.topicId === activeTopic?.id);
    const chars = countChars(scripts[scripts.length - 1]?.text);
    return {
      inbox,
      evidence,
      pipeline,
      activeTopic,
      pendingGates,
        stageGate,
      rehearsals,
      blockedRuns,
      manualSources,
      blockedSources,
      chars,
      scriptCount: scripts.length
    };
  }, [state, activeTopicId]);

  if (loading) {
    return (
      <Shell
        canvas={
          <Card title="正在加载工作台">
            <Skeleton rows={5} />
          </Card>
        }
      />
    );
  }
  if (error || !state) {
    return (
      <Shell
        canvas={
          <Card title="无法加载工作台状态">
            <div className="empty" role="alert">
              <span>{error || "未知错误"}</span>
              <Button onClick={refresh}>重试</Button>
            </div>
          </Card>
        }
      />
    );
  }

  const stages = (derived.pipeline.stages || []).map((stage: any) => ({
    id: stage.id,
    label: stage.label,
    detail: stage.detail,
    tone: toneForPipelineStage(stage.status),
    stateLabel: pipelineStatusLabel(stage.status)
  }));

  // 只有真实存在的待办才进优先级；没有进行中的选题时不写“关卡已通过”这种结论
  const priorities = [
    derived.inbox.pending > 0
      ? {
          tone: "action" as const,
          title: `分诊 ${derived.inbox.pending ?? 0} 条待处理信号`,
          meta: `信息流 · 其中 ${derived.inbox.actionable ?? 0} 条可生产 · 未读 ${derived.inbox.unseenCount ?? 0}`,
          action: "去分诊",
          onClick: onOpenSignalFlow
        }
      : null,
      derived.activeTopic && derived.stageGate.nextStage && derived.stageGate.blocked
      ? {
          tone: "warning" as const,
            title: `推进到${derived.stageGate.nextStageLabel}前先补齐门槛`,
            meta: `工作流 · ${derived.stageGate.reason}`,
            action: "去补齐",
          onClick: () => setView("workflow")
        }
      : null,
    derived.evidence.unverified
      ? {
          tone: "candidate" as const,
          title: `校对 ${derived.evidence.unverified ?? 0} 个未校验证据包`,
          meta: "信息流 · unverified 候选，人工核对前不可作为引用",
          action: "去校验",
          onClick: onOpenSignalFlow
        }
      : null
  ].filter(Boolean) as { tone: any; title: string; meta: string; action: string; onClick: () => void }[];

  const blockedSourceCount = derived.blockedSources.length;
  const idleHints = [
    derived.activeTopic ? null : "还没有进行中的选题",
    blockedSourceCount ? `${blockedSourceCount} 个账号受阻` : null,
    derived.rehearsals.length ? `${derived.rehearsals.length} 条本地演练发布待复核` : null,
    state.morningPipelineRuns.length === 0 ? "还没有运行过晨间流水线" : null
  ].filter(Boolean) as string[];
  const idleLead = blockedSourceCount ? "还有采集账号受阻。" : "今天没有卡住的事。";

  return (
    <Shell
      queueLabel="今日分诊"
      inspectorLabel="系统状态与边界"
      queue={
        <>
          <div className="card-head">
            <h2 className="card-title">今日分诊</h2>
            <span className="card-sub">
              {derived.inbox.pending ?? 0} 条待处理
            </span>
          </div>
          <div className="queue">
            <QueueRow
              tone={derived.inbox.pending ? "action" : "neutral"}
              title="信号分诊"
              meta={`${derived.inbox.pending ?? 0} 条待处理 · ${derived.inbox.actionable ?? 0} 条可生产`}
              right={<Chip tone="action">待分诊</Chip>}
              onClick={onOpenSignalFlow}
            />
            <QueueRow
              tone={derived.evidence.unverified ? "candidate" : "neutral"}
              title="证据包核对"
              meta={`${derived.evidence.unverified ?? 0} 个 unverified`}
              right={derived.evidence.unverified ? <Chip tone="candidate">unverified</Chip> : <Chip tone="neutral">无待核对</Chip>}
              onClick={onOpenSignalFlow}
            />
            <QueueRow
              tone={!derived.activeTopic ? "neutral" : derived.pendingGates.length ? "warning" : "success"}
              title="人工关卡"
              meta={
                !derived.activeTopic
                  ? "没有进行中的选题"
                  : derived.pendingGates.length
                  ? `${derived.pendingGates.length} 项未确认`
                  : "已全部通过"
              }
              right={
                !derived.activeTopic ? (
                  <Chip tone="neutral">不适用</Chip>
                ) : derived.pendingGates.length ? (
                  <Chip tone="warning">待人工</Chip>
                ) : (
                  <Chip tone="success">完成</Chip>
                )
              }
              onClick={() => setView("workflow")}
            />
            <QueueRow
              tone="neutral"
              title="发布演练"
              meta={`${derived.rehearsals.length} 条本地演练记录`}
              right={<Chip tone="neutral" outline>
                本地演练
              </Chip>}
              onClick={() => setView("workflow")}
            />
          </div>

          <div className="stack">
            <span className="section-label">采集健康</span>
            <QueueRow
              tone={derived.blockedSources.length ? "danger" : "success"}
              title="账号采集"
              meta={`${derived.blockedSources.length} 个账号受阻 · ${derived.manualSources.length} 个需人工`}
              right={<Chip tone={derived.blockedSources.length ? "danger" : "success"}>{derived.blockedSources.length ? "受阻" : "正常"}</Chip>}
              onClick={() => setView("flow")}
            />
            <QueueRow
              tone={derived.blockedRuns.length ? "warning" : "neutral"}
              title="采集运行记录"
              meta={`${state.collectionRuns.length} 次运行 · ${derived.blockedRuns.length} 次受阻或失败`}
              right={<Chip tone="neutral">系统</Chip>}
              onClick={() => setView("system")}
            />
          </div>
        </>
      }
      canvas={
        <>
          <Card
            title="晨间流水线"
            hint={`最近一次 ${fmtDateTime(state.morningPipelineRuns?.[0]?.finishedAt)}`}
            actions={
              <Button variant="primary" disabled={busy === "morning"} onClick={() => mutate("morning", () => api.runMorningPipeline(), "晨间流水线已运行")}>
                {busy === "morning" ? "运行中…" : "运行晨间流水线"}
              </Button>
            }
          >
            <StepTrack stages={stages} />
          </Card>

          <Card
            title="今天先做什么"
            hint={priorities.length ? "按真实阻塞程度排序" : blockedSourceCount ? "采集账号存在受阻" : "当前没有需要立刻处理的事"}
          >
            {priorities.length ? (
              <div className="stack">
                {priorities.map((item, index) => (
                <div className="row" key={item.title} style={{ cursor: "default" }}>
                  <span
                    className="row-dot"
                    style={{
                      background: "var(--surface-sunken)",
                      color: "var(--ink-muted)",
                      width: 22,
                      height: 22,
                      borderRadius: 6,
                      display: "grid",
                      placeItems: "center",
                      fontSize: 12,
                      fontWeight: 600
                    }}
                    aria-hidden="true"
                  >
                    {index + 1}
                  </span>
                  <span style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
                    <span className="row-title">{item.title}</span>
                    <span className="row-meta">{item.meta}</span>
                  </span>
                  <Button small onClick={item.onClick}>
                    {item.action}
                  </Button>
                </div>
              ))}
              </div>
            ) : (
              <div className="empty">
                <span>
                  {idleHints.length
                    ? `${idleLead}${idleHints.join("；")}。`
                    : "今天没有卡住的事。可以去信息流抓信号，或开始新的选题。"}
                </span>
                <div className="inline">
                    <Button onClick={onOpenSignalFlow}>
                    去信息流
                  </Button>
                  <Button onClick={() => setView("workflow")}>打开工作流</Button>
                </div>
              </div>
            )}
          </Card>

          {derived.activeTopic ? (
            <Card
              title="当前选题"
              hint={`阶段：${STAGE_LABEL[derived.activeTopic.stage] || derived.activeTopic.stage}`}
              actions={
                <>
                  <Button small onClick={() => setView("workflow")}>
                    打开工作台
                  </Button>
                  <Button
                    small
                      disabled={!derived.stageGate.canAdvance || busy === "stage"}
                      title={derived.stageGate.reason}
                      onClick={() => {
                        if (!derived.stageGate.canAdvance || !derived.stageGate.nextStage) return;
                        mutate("stage", () => api.update("topics", derived.activeTopic.id, { stage: derived.stageGate.nextStage }), "阶段已推进");
                      }}
                  >
                      {derived.stageGate.nextStage ? `推进到${derived.stageGate.nextStageLabel}` : "已到终态"}
                  </Button>
                </>
              }
            >
              <div className="stack" style={{ gap: 10 }}>
                <strong style={{ fontSize: 18, lineHeight: "26px" }}>{derived.activeTopic.title}</strong>
                <StageTrack current={derived.activeTopic.stage} />
                  {derived.stageGate.nextStage ? (
                    <span className="subtle" style={{ fontSize: 12, lineHeight: "18px" }}>
                      {derived.stageGate.reason}
                    </span>
                  ) : null}
                <span className="muted" style={{ fontSize: 12 }}>
                  口播稿 {derived.chars.nonSpace} 字（原始 {derived.chars.raw}） · {derived.scriptCount} 版稿件 ·{" "}
                  {derived.rehearsals.length} 条本地演练发布
                </span>
              </div>
            </Card>
          ) : (
            <Card title="当前选题">
              <div className="empty">
                <span>还没有选题。先到信息流分诊信号，再从一条信号直接开题。</span>
                  <Button onClick={onOpenSignalFlow}>
                  去信息流
                </Button>
              </div>
            </Card>
          )}
        </>
      }
      inspector={
        <>
          <Card title="系统状态" tight>
            <div className="stack" style={{ gap: 8 }}>
              <StatusRow label="自动化" value={state.runtime?.automation?.effectiveEnabled ? "运行中" : "已暂停"} tone={state.runtime?.automation?.effectiveEnabled ? "success" : "warning"} />
              <StatusRow label="Inbox 上限" value={`${derived.inbox.pending ?? 0} / ${state.settings?.inboxDailyLimit ?? 10}`} tone={derived.inbox.pending > (state.settings?.inboxDailyLimit ?? 10) ? "warning" : "neutral"} />
              <StatusRow label="证据包" value={`${derived.evidence.total ?? 0} 个 · ${derived.evidence.unverified ?? 0} 未校验`} tone="candidate" />
              <StatusRow label="投递箱时间" value={String(state.settings?.inboxTime ?? "—")} />
              <StatusRow label="最近采集" value={fmtClock(state.collectionRuns?.[0]?.finishedAt)} />
            </div>
          </Card>

          <Card title="风险与边界" tight>
            <div className="stack" style={{ gap: 8 }}>
              <Risk text={`${platformLabel("xiaohongshu")} 登录墙受限：不保存登录态、不绕过验证码`} />
              {derived.blockedSources.length ? <Risk text={`${derived.blockedSources.length} 个账号主页缺 noteId，不算完整采集`} /> : null}
              <Risk text={`${derived.evidence.unverified ?? 0} 个证据包为 unverified 候选，引用前需人工核对`} />
              {derived.rehearsals.length ? <Risk text={`${derived.rehearsals.length} 条发布记录是本地演练，不是公开平台发布`} /> : null}
            </div>
          </Card>

          <Card title="数据快照" tight>
            <div className="stack" style={{ gap: 6 }}>
              <StatusRow label="对标账号" value={`${state.sources.length}`} />
              <StatusRow label="信号" value={`${state.signals.length}`} />
              <StatusRow label="选题" value={`${state.topics.length}`} />
              <StatusRow label="稿件" value={`${state.scripts.length}`} />
              <StatusRow label="证据包" value={`${state.evidencePackages.length}`} />
              <StatusRow label="逐字稿" value={`${state.transcriptRuns.length}`} />
            </div>
          </Card>
        </>
      }
      mobileAction={
        <Button variant="primary" disabled={busy === "morning"} onClick={() => mutate("morning", () => api.runMorningPipeline(), "晨间流水线已运行")}>
          {busy === "morning" ? "运行中…" : "运行晨间流水线"}
        </Button>
      }
    />
  );
}

function StatusRow({ label, value, tone = "neutral" }: { label: string; value: string; tone?: any }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
      <span className="muted" style={{ fontSize: 12 }}>
        {label}
      </span>
      <span
        style={{
          fontSize: 12,
          fontWeight: 500,
          color:
            tone === "success" ? "var(--success)" : tone === "warning" ? "var(--warning)" : tone === "danger" ? "var(--danger)" : tone === "candidate" ? "var(--candidate)" : "var(--ink)"
        }}
      >
        {value}
      </span>
    </div>
  );
}

function Risk({ text }: { text: string }) {
  return (
    <div className="check" style={{ alignItems: "flex-start" }}>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ marginTop: 3, flex: "none" }} aria-hidden="true">
        <path d="M7 1.5L13 12H1L7 1.5Z" stroke="var(--warning)" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M7 5.5V8.5" stroke="var(--warning)" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="7" cy="10.3" r="0.8" fill="var(--warning)" />
      </svg>
      <span style={{ fontSize: 12, lineHeight: "18px" }}>{text}</span>
    </div>
  );
}
