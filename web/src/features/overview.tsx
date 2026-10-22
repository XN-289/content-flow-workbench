import { useMemo } from "react";
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
import { Button, Card, Chip, Skeleton, StageTrack, StepTrack } from "../components/primitives";

type Priority = {
  tone: "action" | "warning" | "candidate";
  title: string;
  meta: string;
  action: string;
  onClick: () => void;
};

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
    const rehearsals = (state?.publications || []).filter((item: any) =>
      String(item.url || "").startsWith("workbench://local-rehearsal")
    );
    const blockedRuns = (state?.collectionRuns || []).filter(
      (run: any) => run.status === "blocked" || run.status === "failed"
    );
    const manualSources = (commandCenter.records || []).filter((record: any) => record.controlStatus === "manual");
    const blockedSources = (commandCenter.records || []).filter(
      (record: any) => record.coverage?.status === "blocked"
    );
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

  const priorities = [
    derived.inbox.pending > 0
      ? {
          tone: "action" as const,
          title: `分诊 ${derived.inbox.pending ?? 0} 条待处理信号`,
          meta: `其中 ${derived.inbox.actionable ?? 0} 条可生产，未读 ${derived.inbox.unseenCount ?? 0} 条`,
          action: "开始分诊",
          onClick: onOpenSignalFlow
        }
      : null,
    derived.activeTopic && derived.stageGate.nextStage && derived.stageGate.blocked
      ? {
          tone: "warning" as const,
          title: `推进到${derived.stageGate.nextStageLabel}前先补齐门槛`,
          meta: derived.stageGate.reason,
          action: "去补齐",
          onClick: () => setView("workflow")
        }
      : null,
    derived.evidence.unverified
      ? {
          tone: "candidate" as const,
          title: `校对 ${derived.evidence.unverified ?? 0} 个未校验证据包`,
          meta: "候选证据在人工核对前不用于引用",
          action: "去校验",
          onClick: onOpenSignalFlow
        }
      : null
  ].filter(Boolean) as Priority[];

  const blockedSourceCount = derived.blockedSources.length;
  const idleHints = [
    derived.activeTopic ? null : "还没有进行中的选题",
    blockedSourceCount ? `${blockedSourceCount} 个账号受阻` : null,
    derived.rehearsals.length ? `${derived.rehearsals.length} 条本地演练待复核` : null,
    state.morningPipelineRuns.length === 0 ? "还没有运行过账号采集" : null
  ].filter(Boolean) as string[];
  const primary = priorities[0];
  const primaryTitle = primary?.title ?? (derived.activeTopic ? "当前选题可以继续推进" : "从一条真实信号开始");
  const primaryMeta =
    primary?.meta ??
    (idleHints.length ? idleHints.join("；") : "今天没有卡住的事，可以直接整理素材或开始新的选题。");
  const primaryAction = primary?.action ?? (derived.activeTopic ? "打开工作台" : "去信息流");
  const primaryOnClick = primary?.onClick ?? (derived.activeTopic ? () => setView("workflow") : onOpenSignalFlow);
  const automationKnown = Boolean(state.runtime?.automation);
  const automationOn = Boolean(state.runtime?.automation?.effectiveEnabled);
  const automationLabel = !automationKnown ? "自动化未配置" : automationOn ? "自动化运行中" : "自动化已暂停";

  return (
    <Shell
      canvas={
        <Card
          className="overview-focus"
          title="今日焦点"
          hint={state.morningPipelineRuns?.[0] ? `账号采集更新于 ${fmtDateTime(state.morningPipelineRuns[0].finishedAt)}` : "还没有账号采集记录"}
        >
          <div className="overview-focus-copy">
            <strong>{primaryTitle}</strong>
            <p>{primaryMeta}</p>
          </div>

          <div className="inline">
            <Button variant="primary" onClick={primaryOnClick}>
              {primaryAction}
            </Button>
            <Button
              disabled={busy === "morning"}
              onClick={() => mutate("morning", () => api.runMorningPipeline(), "账号采集已更新")}
            >
              {busy === "morning" ? "采集中…" : "更新账号采集"}
            </Button>
          </div>

          {derived.activeTopic ? (
            <section className="overview-topic" aria-label="当前选题">
              <div className="overview-topic-head">
                <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                  <span className="section-label">当前选题 · {STAGE_LABEL[derived.activeTopic.stage] || derived.activeTopic.stage}</span>
                  <strong>{derived.activeTopic.title}</strong>
                </div>
                <Button small onClick={() => setView("workflow")}>
                  打开工作台
                </Button>
              </div>
              <StageTrack current={derived.activeTopic.stage} />
              <div className="inline">
                {derived.pendingGates.length ? (
                  <Chip tone="warning">{derived.pendingGates.length} 项人工关卡待确认</Chip>
                ) : (
                  <Chip tone="success">人工关卡已通过</Chip>
                )}
                {derived.stageGate.nextStage && derived.stageGate.blocked ? (
                  <Chip tone="warning">推进已锁定</Chip>
                ) : null}
                <span className="subtle">
                  口播稿 {derived.chars.nonSpace} 字 · {derived.scriptCount} 版稿件 · {derived.rehearsals.length} 条本地演练
                </span>
              </div>
              <div className="inline">
                <Button
                  small
                  disabled={!derived.stageGate.canAdvance || busy === "stage"}
                  title={derived.stageGate.reason}
                  onClick={() => {
                    if (!derived.stageGate.canAdvance || !derived.stageGate.nextStage) return;
                    mutate(
                      "stage",
                      () => api.update("topics", derived.activeTopic.id, { stage: derived.stageGate.nextStage }),
                      "阶段已推进"
                    );
                  }}
                >
                  {derived.stageGate.nextStage ? `推进到${derived.stageGate.nextStageLabel}` : "已到终态"}
                </Button>
                {derived.stageGate.nextStage ? <span className="subtle">{derived.stageGate.reason}</span> : null}
              </div>
            </section>
          ) : null}

          <details className="card-disclosure overview-details">
            <summary>
              <span>运行与数据</span>
              {blockedSourceCount ? <Chip tone="danger">{blockedSourceCount} 个账号受阻</Chip> : <Chip tone="success">账号采集正常</Chip>}
              {derived.evidence.unverified ? <Chip tone="candidate">{derived.evidence.unverified} 个证据待核对</Chip> : null}
            </summary>

            <div className="overview-detail-body">
              <StepTrack stages={stages} />

              {priorities.length > 1 ? (
                <div className="overview-followups">
                  <span className="section-label">其余待办</span>
                  {priorities.slice(1).map((item) => (
                    <div className="overview-followup-row" key={item.title}>
                      <span>
                        <strong>{item.title}</strong>
                        <small>{item.meta}</small>
                      </span>
                      <Button small onClick={item.onClick}>
                        {item.action}
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="overview-stats">
                <div className="overview-stat">
                  <StatusRow label="待分诊" value={`${derived.inbox.pending ?? 0} / ${state.settings?.inboxDailyLimit ?? 10}`} />
                </div>
                <div className="overview-stat">
                  <StatusRow label="自动化" value={automationLabel} tone={automationOn ? "success" : "warning"} />
                </div>
                <div className="overview-stat">
                  <StatusRow label="最近采集" value={fmtClock(state.collectionRuns?.[0]?.finishedAt)} />
                </div>
                <div className="overview-stat">
                  <StatusRow label="采集运行" value={`${state.collectionRuns.length} 次 · ${derived.blockedRuns.length} 次异常`} tone={derived.blockedRuns.length ? "warning" : "neutral"} />
                </div>
                <div className="overview-stat">
                  <StatusRow label="对标账号" value={`${state.sources.length} 个 · ${derived.manualSources.length} 个需人工`} />
                </div>
                <div className="overview-stat">
                  <StatusRow label="素材规模" value={`${state.signals.length} 信号 · ${state.topics.length} 选题 · ${state.scripts.length} 稿件`} />
                </div>
              </div>

              <div className="overview-risks">
                <Risk text={`${platformLabel("xiaohongshu")} 不保存登录态、不绕过验证码；受阻账号不算完整采集`} />
                <Risk text={`${derived.evidence.unverified ?? 0} 个证据包仍是 unverified 候选，引用前需要人工核对`} />
                {derived.rehearsals.length ? <Risk text={`${derived.rehearsals.length} 条发布记录只是本地演练，不是公开平台发布`} /> : null}
              </div>

              <div className="inline">
                <Button small onClick={onOpenSignalFlow}>
                  管理账号与素材
                </Button>
                <Button small onClick={() => setView("system")}>
                  查看系统记录
                </Button>
              </div>
            </div>
          </details>
        </Card>
      }
    />
  );
}

function StatusRow({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "success" | "warning" | "danger" | "candidate" }) {
  const color =
    tone === "success"
      ? "var(--success)"
      : tone === "warning"
        ? "var(--warning)"
        : tone === "danger"
          ? "var(--danger)"
          : tone === "candidate"
            ? "var(--candidate)"
            : "var(--ink)";

  return (
    <div className="overview-stat-line">
      <span className="muted">{label}</span>
      <span style={{ color }}>{value}</span>
    </div>
  );
}

function Risk({ text }: { text: string }) {
  return (
    <div className="check overview-risk">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path d="M7 1.5L13 12H1L7 1.5Z" stroke="var(--warning)" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M7 5.5V8.5" stroke="var(--warning)" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="7" cy="10.3" r="0.8" fill="var(--warning)" />
      </svg>
      <span>{text}</span>
    </div>
  );
}
