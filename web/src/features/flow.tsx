import { useEffect, useMemo, useRef, useState } from "react";
import { api, coverMediaUrl } from "../lib/api";
import { DISPOSITION_LABEL, EVIDENCE_STATE_LABEL } from "../lib/constants";
import { capabilityLabel, capabilityTone, fmtDate, fmtDateTime, platformLabel, toneForEvidence } from "../lib/format";
import type { Tone, TranscriptAnalysisQuote } from "../lib/types";
import {
  canCaptureXhsDetail,
  canCaptureXhsProfile,
  xhsBookmarkletHref,
  xhsDetailBookmarkletHref
} from "../lib/xhs-capture";
import { useStore } from "../state/store";
import { Shell } from "../components/AppShell";
import { Button, Card, Chip, EmptyState, Field, QueueRow, Segmented, Sheet, TimelineItem } from "../components/primitives";

type TranscriptMode = "full" | "timeline" | "analysis";

const FILTERS = [
  { value: "inbox", label: "待分诊" },
  { value: "produce", label: "可生产" },
  { value: "topic", label: "做选题" },
  { value: "material", label: "入素材" },
  { value: "watch", label: "观察" },
  { value: "all", label: "全部" }
];

const INTAKE_STATUS_LABEL: Record<string, string> = {
  queued: "排队中",
  registered: "账号已登记",
  captured: "笔记已入库",
  "needs-browser": "需浏览器",
  duplicate: "重复",
  blocked: "受阻",
  failed: "失败"
};

const INTAKE_BATCH_LABEL: Record<string, string> = {
  running: "处理中",
  completed: "已完成",
  "needs-review": "待人工",
  partial: "部分失败"
};

function intakeTone(status: string): Tone {
  if (status === "failed" || status === "blocked") return "danger";
  if (status === "needs-browser" || status === "duplicate") return "warning";
  if (status === "captured") return "success";
  if (status === "registered") return "action";
  return "neutral";
}

function topicDefaults(record: any) {
  return {
    ...record,
    format: record.format || "spoken-video",
    platforms: record.platforms || ["douyin", "xiaohongshu", "wechat"],
    stage: record.stage || "topic",
    productionChecks: record.productionChecks || {
      coreIdea: false,
      targetReader: false,
      hook: false,
      outline: false,
      evidence: false,
      visuals: false,
      publishPackage: false
    },
    gates: record.gates || { evidence: false, opening: false, sample: false, final: false }
  };
}

function formatDurationSeconds(value: any): string {
  const total = Math.max(0, Math.round(Number(value) || 0));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function formatTranscriptTimestamp(value: any): string {
  const totalMs = Math.max(0, Math.round((Number(value) || 0) * 1000));
  const minutes = Math.floor(totalMs / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const milliseconds = totalMs % 1000;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}

function formatPublishedDate(value: any): string {
  if (!value) return "";
  const numeric = typeof value === "number" ? value : Number(value);
  const date = Number.isFinite(numeric) && numeric > 0 ? new Date(numeric) : new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function AnalysisQuoteView({ quote }: { quote?: TranscriptAnalysisQuote | null }) {
  if (!quote) return null;
  return (
    <blockquote className="analysis-quote">
      <div className="analysis-quote-meta">
        <span className="tabular">
          {quote.startTimestamp} - {quote.endTimestamp}
        </span>
        <Chip tone="candidate">unverified</Chip>
      </div>
      <p>{quote.text}</p>
      {quote.why ? <footer>{quote.why}</footer> : null}
    </blockquote>
  );
}

function SignalCover({
  src,
  title,
  variant = "row"
}: {
  src?: string | null;
  title?: string | null;
  variant?: "row" | "reader" | "preview";
}) {
  const [attempt, setAttempt] = useState<"proxy" | "direct" | "failed">("proxy");
  const proxiedSrc = coverMediaUrl(src);

  useEffect(() => {
    setAttempt("proxy");
  }, [src]);

  if (!src || attempt === "failed") return null;
  const displaySrc = attempt === "proxy" && proxiedSrc !== src ? proxiedSrc : src;
  return (
    <img
      className={`signal-cover signal-cover--${variant}`}
      src={displaySrc}
      alt={`封面：${title || "未命名内容"}`}
      loading={variant === "reader" ? "eager" : "lazy"}
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setAttempt(attempt === "proxy" && proxiedSrc !== src ? "direct" : "failed")}
    />
  );
}

function downloadTextFile(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("浏览器未允许复制");
}

function BookmarkletActions({
  href,
  onCopy,
  label
}: {
  href: string;
  onCopy: () => void;
  label: string;
}) {
  return (
    <>
      <a
        className="btn small"
        href={href}
        draggable="true"
        title="拖到浏览器书签栏；点击不会在当前工作台执行"
        onClick={(event) => event.preventDefault()}
      >
        {label}
      </a>
      <Button small variant="ghost" onClick={onCopy}>
        复制脚本
      </Button>
    </>
  );
}

export function FlowView({ focusSignalId }: { focusSignalId?: string | null }) {
  const { state, mutate, busy, setView, setActiveTopic, notify, refresh } = useStore();
  const [filter, setFilter] = useState("inbox");
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [capabilityPlatformId, setCapabilityPlatformId] = useState("xiaohongshu");
  const [verify, setVerify] = useState<any>(null);
  const [verifyNote, setVerifyNote] = useState("");
  const [verifyState, setVerifyState] = useState("verified");
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [transcriptSignalId, setTranscriptSignalId] = useState<string | null>(null);
  const [transcriptMode, setTranscriptMode] = useState<TranscriptMode>("full");
  const [analysisFeedback, setAnalysisFeedback] = useState<{
    tone: "success" | "danger" | "warning";
    message: string;
  } | null>(null);
  const seenTranscriptStatuses = useRef<Record<string, string>>({});

  const runtime = state?.runtime || {};
  const commandCenter = runtime.commandCenter || {};
  const capabilities = runtime.platformCapabilities || {};
  const evidenceSummary = runtime.evidencePackages || {};
  const capabilityPlatforms: any[] = Array.isArray(capabilities.platforms) ? capabilities.platforms : [];
  const capabilityDimensions: any[] = Array.isArray(capabilities.dimensions) ? capabilities.dimensions : [];

  const records: any[] = useMemo(() => commandCenter.records || [], [commandCenter]);
  const signals = state?.signals || [];
  const latestIntakeBatch = state?.intakeBatches?.[0] || null;
  const latestIntakeItems = useMemo(() => {
    if (!latestIntakeBatch) return [];
    return (state?.intakeQueue || [])
      .filter((item) => item.batchId === latestIntakeBatch.id)
      .sort((left, right) => left.ordinal - right.ordinal)
      .slice(0, 4);
  }, [latestIntakeBatch?.id, state?.intakeQueue]);
  const evidenceBySignal = useMemo(() => {
    const map: Record<string, any> = {};
    (state?.evidencePackages || []).forEach((item: any) => {
      map[item.signalId] = item;
    });
    return map;
  }, [state]);
  const transcriptBySignal = useMemo(() => {
    const map: Record<string, any> = {};
    (state?.transcriptRuns || []).forEach((item: any) => {
      const current = map[item.signalId];
      const itemTime = String(item.startedAt || item.updatedAt || "");
      const currentTime = String(current?.startedAt || current?.updatedAt || "");
      if (!current || itemTime > currentTime) map[item.signalId] = item;
    });
    return map;
  }, [state?.transcriptRuns]);
  const analysisBySignal = useMemo(() => {
    const map: Record<string, any> = {};
    (state?.analysisRuns || []).forEach((item: any) => {
      if (item.status !== "completed") return;
      const current = map[item.signalId];
      if (!current || String(item.createdAt || "") > String(current.createdAt || "")) {
        map[item.signalId] = item;
      }
    });
    return map;
  }, [state?.analysisRuns]);

  useEffect(() => {
    const runs: any[] = state?.transcriptRuns || [];
    runs.forEach((run) => {
      const previous = seenTranscriptStatuses.current[run.id];
      if (previous === "running" && run.status !== "running") {
        if (run.status === "captured") {
          notify("逐字稿已完成，可以查看全文和时间轴", "success");
        } else if (run.status === "failed") {
          notify("逐字稿生成失败，可在信息流中重新转写", "danger");
        }
      }
      seenTranscriptStatuses.current[run.id] = run.status;
    });
    if (!runs.some((run) => run.status === "running")) return;
    const timer = window.setInterval(() => {
      void refresh();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [state?.transcriptRuns, refresh, notify]);

  if (!state) return null;

  const visibleSignals = (filter === "all" ? signals : signals.filter((signal: any) => signal.disposition === filter))
    .slice()
    .sort((a: any, b: any) => String(b.capturedAt || "").localeCompare(String(a.capturedAt || "")));

  const activeRecord = records.find((record) => record.sourceId === sourceId) || records[0];
  const activeSource = state.sources.find((source: any) => source.id === activeRecord?.sourceId);
  const canCaptureProfile = canCaptureXhsProfile(activeSource, runtime);
  const selectedCapabilityPlatform =
    capabilityPlatforms.find((platform: any) => platform.id === capabilityPlatformId) || capabilityPlatforms[0] || null;
  const transcriptSignal = state.signals.find((signal: any) => signal.id === transcriptSignalId) || null;
  const transcriptSource = transcriptSignal
    ? state.sources.find((source: any) => source.id === transcriptSignal.sourceId)
    : null;
  const canCaptureTranscriptDetail = canCaptureXhsDetail(transcriptSignal, transcriptSource, runtime);
  const transcriptRun = transcriptSignal
    ? state.transcriptRuns.find((run: any) => run.signalId === transcriptSignal.id && run.status === "captured") ||
      transcriptBySignal[transcriptSignal.id] ||
      null
    : null;
  const transcriptSegments: any[] = Array.isArray(transcriptSignal?.transcriptSegments)
    ? transcriptSignal.transcriptSegments
    : [];
  const transcriptText = String(transcriptSignal?.transcriptText || "");
  const transcriptAnalysis = transcriptSignal ? analysisBySignal[transcriptSignal.id] || null : null;
  const transcriptAnalysisBody = transcriptAnalysis?.analysis || null;
  const configuredDriveRoot = String(state.settings?.driveRoot || "").trim();

  const setDisposition = (signalId: string, disposition: string) =>
    mutate(`signal-${signalId}`, () => api.update("signals", signalId, { disposition, seen: true }), `已标记为${DISPOSITION_LABEL[disposition] || disposition}`);

  const collectActiveSource = async () => {
    const key = `collect-${activeRecord.sourceId}`;
    const result = await mutate(key, () => api.collect(activeRecord.sourceId));
    const run = result?.run || {};
    if (run.status === "blocked") {
      notify(run.failureReason || "采集需要人工动作", "warning");
    } else if (run.status === "failed") {
      notify(run.failureReason || "采集失败", "danger");
    } else {
      notify(run.created > 0 ? `采集完成，新增 ${run.created} 条` : "采集完成，没有新增内容", "success");
    }
  };

  const createTopic = async (signal: any) => {
    try {
      const result = await mutate(
        "topic",
        async () => {
          const created = await api.record(
            "topics",
            topicDefaults({ title: signal.title, coreIdea: "", targetReader: "", sourceSignalIds: [signal.id] })
          );
          await api.update("signals", signal.id, { disposition: "topic", seen: true });
          return created;
        },
        "选题已创建"
      );
      if (result?.record?.id) {
        setActiveTopic(result.record.id);
        setView("workflow");
      }
    } catch {
      // Store already surfaces the server's actionable error.
    }
  };

  const openTranscript = (signal: any) => {
    setTranscriptSignalId(signal.id);
    setTranscriptMode("full");
    setAnalysisFeedback(null);
  };

  const startTranscript = async (signal: any, force = false) => {
    try {
      const result = await mutate(
        `transcript-${signal.id}`,
        () => api.transcript(signal.id, force, true),
        "已开始后台转写，可以继续处理其他内容"
      );
      if (result?.run?.id) seenTranscriptStatuses.current[result.run.id] = "running";
    } catch {
      // Store already surfaces the server's actionable error.
    }
  };

  const copyTranscript = async () => {
    if (!transcriptText) return;
    try {
      await copyText(transcriptText);
      notify("逐字稿全文已复制", "success");
    } catch (error: any) {
      notify(error.message || "复制失败", "danger");
    }
  };

  const copyCaptureScript = async (script: string, successMessage: string) => {
    try {
      await copyText(script);
      notify(successMessage, "success");
    } catch (error: any) {
      notify(error.message || "采集脚本复制失败", "danger");
    }
  };

  const downloadTranscriptTxt = () => {
    if (!transcriptSignal) return;
    const timeline = transcriptSegments.map((segment, index) => {
      const start = segment.startTimestamp || formatTranscriptTimestamp(segment.start);
      const end = segment.endTimestamp || formatTranscriptTimestamp(segment.end);
      return `${index + 1}. [${start} - ${end}] ${segment.text || ""}`;
    });
    const content = [
      transcriptSignal.title || "未命名内容",
      `来源：${transcriptSource?.name || "未知来源"}`,
      `来源链接：${transcriptSource?.url || ""}`,
      `模型：${transcriptSignal.transcriptModel || transcriptRun?.model || "未标注"}`,
      `媒体时长：${formatDurationSeconds(transcriptSignal.transcriptDurationSeconds || transcriptRun?.durationSeconds)}`,
      `生成时间：${fmtDateTime(transcriptSignal.transcriptCapturedAt || transcriptRun?.finishedAt)}`,
      "状态：ASR 候选稿（unverified），引用前需人工校对",
      "",
      "全文",
      transcriptText,
      "",
      "时间轴",
      ...(timeline.length ? timeline : ["无分段"])
    ].join("\n");
    downloadTextFile(`transcript-${transcriptSignal.id}.txt`, content, "text/plain;charset=utf-8");
  };

  const downloadTranscriptJson = () => {
    if (!transcriptSignal) return;
    const payload = {
      schemaVersion: 1,
      title: transcriptSignal.title || "",
      source: {
        id: transcriptSignal.sourceId || "",
        name: transcriptSource?.name || "",
        url: transcriptSource?.url || ""
      },
      transcript: {
        status: "unverified",
        text: transcriptText,
        model: transcriptSignal.transcriptModel || transcriptRun?.model || "",
        durationSeconds: transcriptSignal.transcriptDurationSeconds || transcriptRun?.durationSeconds || 0,
        capturedAt: transcriptSignal.transcriptCapturedAt || transcriptRun?.finishedAt || "",
        source: transcriptSignal.transcriptSource || "",
        segments: transcriptSegments
      }
    };
    downloadTextFile(
      `transcript-${transcriptSignal.id}.json`,
      JSON.stringify(payload, null, 2),
      "application/json;charset=utf-8"
    );
  };

  const generateTranscriptAnalysis = async (force = false) => {
    if (!transcriptSignal) return;
    setAnalysisFeedback(null);
    try {
      const result = await mutate(`analysis-${transcriptSignal.id}`, () => api.analysis(transcriptSignal.id, force));
      setTranscriptMode("analysis");
      setAnalysisFeedback({
        tone: "success",
        message: result?.reused
          ? "逐字稿没有变化，已复用相同哈希的候选拆解。"
          : "候选拆解已生成；结论与原文引用均保持 unverified。"
      });
    } catch (error: any) {
      setAnalysisFeedback({ tone: "danger", message: error.message || "候选拆解生成失败" });
    }
  };

  const createAnalysisAgentTask = async () => {
    if (!transcriptSignal) return;
    setAnalysisFeedback(null);
    const title = `深挖流量结构：${transcriptSignal.title || transcriptSignal.id}`.slice(0, 120);
    const objective = [
      `基于本地信号 ${transcriptSignal.id} 的全文逐字稿、带时间戳分段和候选拆解，解释这条内容为什么可能有效，并给出可借鉴但不能直接照搬的创作假设。`,
      "必须区分平台数据事实、逐字稿原文和推断结论；所有推断继续标记为 unverified，引用原文必须保留起止时间戳。",
      "重点分析：前 15 秒钩子、承诺与张力、四段结构、节奏、留存机制、情绪回报、作者相对基线和可复用公式。",
      "输出：证据摘要、可验证假设、最有风险的假设、可复刻结构、不要复刻的表达、下一步采集缺口的建议。"
    ].join("\n");
    try {
      const result = await mutate(`analysis-agent-${transcriptSignal.id}`, () =>
        api.agentCreate({
          agent: "codex",
          kind: "dissect",
          signalId: transcriptSignal.id,
          title,
          objective
        })
      );
      setAnalysisFeedback({
        tone: "success",
        message: `Agent 深挖任务已创建：${result?.task?.id || "已进入 Outbox"}。任务文件包含完整逐字稿、时间轴与 unverified 约束。`
      });
    } catch (error: any) {
      setAnalysisFeedback({ tone: "danger", message: error.message || "Agent 任务创建失败" });
    }
  };

  const exportTranscriptKnowledge = async () => {
    setAnalysisFeedback(null);
    if (!configuredDriveRoot) {
      setAnalysisFeedback({
        tone: "warning",
        message: "尚未配置 Google Drive 同步目录。先在系统页保存本机映射目录，再显式导出知识包。"
      });
      return;
    }
    try {
      const result = await mutate("knowledge-export", () => api.exportKnowledge(configuredDriveRoot));
      setAnalysisFeedback({
        tone: "success",
        message: `已导出 ${result?.export?.analysisCount || 0} 个拆解和 ${result?.export?.transcriptCount || 0} 份逐字稿到 ${
          result?.export?.targetRoot || "Google Drive"
        }。`
      });
    } catch (error: any) {
      setAnalysisFeedback({ tone: "danger", message: error.message || "知识导出失败" });
    }
  };

  const openVerify = (item: any) => {
    setSheetError(null);
    setVerify(item);
    setVerifyState(item.verification?.state === "unverified" ? "verified" : "unverified");
    setVerifyNote(item.verification?.note || "");
  };

  const createEvidence = async (signal: any) => {
    try {
      const result = await mutate(`evidence-${signal.id}`, () => api.evidenceCreate(signal.id), "证据包已创建");
      if (result?.record) openVerify(result.record);
    } catch {
      // Store already surfaces the server's actionable error.
    }
  };

  const submitVerify = async () => {
    try {
      await api.evidenceVerify(verify.id, verifyState, verifyNote);
      setVerify(null);
      await mutate("verify", () => Promise.resolve(), "证据包状态已更新");
    } catch (err: any) {
      setSheetError(err.message || "更新失败");
    }
  };

  return (
    <>
      <Shell
        queueLabel="对标账号"
        inspectorLabel="平台能力与证据"
        queue={
          <>
            <div className="card-head">
              <h2 className="card-title">对标账号</h2>
              <span className="card-sub">{state.sources.length} 个</span>
            </div>
            <div className="queue">
              {records.map((record) => {
                const coverageStatus = record.coverage?.status;
                const tone = coverageStatus === "blocked" ? "danger" : record.controlStatus === "manual" ? "warning" : "success";
                return (
                  <QueueRow
                    key={record.sourceId}
                    selected={record.sourceId === activeRecord?.sourceId}
                    tone={tone}
                    title={record.name}
                    meta={`${platformLabel(record.platform)} · ${record.coverage?.collectedCount ?? 0}/${record.coverage?.totalNotes ?? "?"} 已采集`}
                    right={<Chip tone={tone}>{coverageStatus === "blocked" ? "受阻" : record.controlStatus === "manual" ? "待人工" : "正常"}</Chip>}
                    onClick={() => {
                      setSourceId(record.sourceId);
                      if (capabilityPlatforms.some((platform: any) => platform.id === record.platform)) {
                        setCapabilityPlatformId(record.platform);
                      }
                    }}
                  />
                );
              })}
              {!records.length ? <EmptyState text="还没有对标账号" /> : null}
            </div>

            <div className="stack" style={{ gap: 6 }}>
              <span className="section-label">Inbox</span>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                <span className="muted">待分诊</span>
                <span className="tabular subtle">{runtime.inbox?.pending ?? 0}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                <span className="muted">可生产</span>
                <span className="tabular subtle">{runtime.inbox?.actionable ?? 0}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                <span className="muted">证据包未校验</span>
                <span className="tabular subtle">{evidenceSummary.unverified ?? 0}</span>
              </div>
            </div>

            <div className="stack" style={{ gap: 8 }}>
              <span className="section-label">最近链接入库</span>
              {latestIntakeBatch ? (
                <>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span className="subtle" style={{ fontSize: 11 }}>
                      {fmtDateTime(latestIntakeBatch.finishedAt || latestIntakeBatch.startedAt)}
                    </span>
                    <Chip tone={intakeTone(latestIntakeBatch.status)}>
                      {INTAKE_BATCH_LABEL[latestIntakeBatch.status] || latestIntakeBatch.status}
                    </Chip>
                  </div>
                  {latestIntakeBatch.summary ? (
                    <p className="muted" style={{ fontSize: 12, lineHeight: "20px" }}>
                      识别 {latestIntakeBatch.summary.total} 条，账号 {latestIntakeBatch.summary.registered}，
                      笔记 {latestIntakeBatch.summary.captured}，重复 {latestIntakeBatch.summary.duplicate}，
                      待处理{" "}
                      {latestIntakeBatch.summary["needs-browser"] +
                        latestIntakeBatch.summary.blocked +
                        latestIntakeBatch.summary.failed}
                    </p>
                  ) : null}
                  <div className="stack" style={{ gap: 4 }}>
                    {latestIntakeItems.map((item) => (
                      <div
                        key={item.id}
                        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}
                      >
                        <span
                          className="muted"
                          title={item.titleCandidate || item.authorCandidate || "未命名链接"}
                          style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                        >
                          {item.authorCandidate || item.titleCandidate || `链接 ${item.ordinal}`}
                        </span>
                        <Chip tone={intakeTone(item.status)}>{INTAKE_STATUS_LABEL[item.status] || item.status}</Chip>
                      </div>
                    ))}
                  </div>
                  {latestIntakeBatch.nextAction ? (
                    <p className="subtle" style={{ fontSize: 11, lineHeight: "18px" }}>
                      {latestIntakeBatch.nextAction}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="subtle" style={{ fontSize: 12 }}>
                  还没有链接批次
                </p>
              )}
            </div>
          </>
        }
        canvas={
          <>
            {activeRecord ? (
              <Card
                className="source-card"
                title={activeRecord.name}
                hint={`${platformLabel(activeRecord.platform)} · ${activeRecord.collectionMethod || "采集方式未标注"}`}
                actions={
                  <>
                    <Button
                      small
                      disabled={busy === `collect-${activeRecord.sourceId}`}
                      onClick={collectActiveSource}
                    >
                      {activeRecord.collectionMethod === "browser-assisted" ? "检查采集条件" : "立即采集"}
                    </Button>
                    <Button small onClick={() => mutate("drop", () => api.dropFolderScan(), "投递箱已扫描")}>
                      扫描投递箱
                    </Button>
                  </>
                }
              >
                <div className="stack" style={{ gap: 8 }}>
                  {activeSource?.url ? (
                    <div className="source-line">
                      <span className="section-label">主页</span>
                      <a
                        className="source-link"
                        href={activeSource.url}
                        target="_blank"
                        rel="noreferrer"
                        title={activeSource.url}
                      >
                        <span>{activeSource.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}</span>
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                          <path d="M4.5 2H2.8C2.36 2 2 2.36 2 2.8V9.2C2 9.64 2.36 10 2.8 10H9.2C9.64 10 10 9.64 10 9.2V7.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                          <path d="M6.8 2H10V5.2M9.7 2.3L5.4 6.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </a>
                    </div>
                  ) : (
                    <div className="source-line">
                      <span className="section-label">主页</span>
                      <span className="subtle" style={{ fontSize: 12 }}>未登记主页链接</span>
                    </div>
                  )}
                  {canCaptureProfile ? (
                    <div className="inline">
                      <BookmarkletActions
                        href={xhsBookmarkletHref(activeSource, runtime)}
                        onCopy={() =>
                          void copyCaptureScript(
                            xhsBookmarkletHref(activeSource, runtime),
                            "主页采集脚本已复制"
                          )
                        }
                        label="主页采集书签"
                      />
                    </div>
                  ) : null}
                  <div className="inline">
                    <Chip tone={activeRecord.coverage?.status === "blocked" ? "danger" : "success"}>
                      覆盖率 {activeRecord.coverage?.percent ?? 0}%
                    </Chip>
                    {activeRecord.coverage?.blockedNoteCount ? <Chip tone="warning">{activeRecord.coverage.blockedNoteCount} 条受阻</Chip> : null}
                    {activeRecord.coverage?.identityStatus === "note-id-unavailable" ? <Chip tone="warning">缺 noteId</Chip> : null}
                  </div>
                  {activeRecord.nextAction ? (
                    <p className="muted" style={{ fontSize: 13, lineHeight: "22px" }}>
                      {activeRecord.nextAction}
                    </p>
                  ) : null}
                  {activeRecord.blockedPreviews?.length ? (
                    <section className="blocked-preview-panel" aria-label="游客态可见笔记预览">
                      <div className="blocked-preview-heading">
                        <div>
                          <span className="section-label">游客态可见预览</span>
                          <p className="blocked-preview-note">
                            标题与封面可读；noteId 被平台隐藏。正文和逐字稿需从 App 分享具体笔记链接后补采。
                          </p>
                        </div>
                        <span className="tabular subtle">{activeRecord.blockedPreviews.length} 条</span>
                      </div>
                      <div className="blocked-preview-list">
                        {activeRecord.blockedPreviews.map((preview: any, index: number) => (
                          <article
                            className="blocked-preview-item"
                            key={`${preview.coverUrl || preview.title || "preview"}-${index}`}
                          >
                            <SignalCover
                              src={preview.coverUrl}
                              title={preview.title}
                              variant="preview"
                            />
                            <div className="blocked-preview-copy">
                              <strong title={preview.title || "未命名笔记"}>
                                {preview.title || "未命名笔记"}
                              </strong>
                              <div className="blocked-preview-meta">
                                <span>{preview.engagement ? `赞 ${preview.engagement}` : "赞数未显示"}</span>
                                <span>{formatPublishedDate(preview.publishedAt) || "日期未显示"}</span>
                              </div>
                            </div>
                          </article>
                        ))}
                      </div>
                    </section>
                  ) : null}
                </div>
              </Card>
            ) : null}

            <Card
              title="平台能力矩阵"
              hint="4 平台 × 6 维度 · 只陈述已验证边界，不保存登录态"
              tight
              className="platform-capability-card"
            >
              <details className="card-disclosure">
                <summary>
                  <span>查看平台边界与采集方法</span>
                  <Chip tone="neutral">低频诊断</Chip>
                </summary>
                <div className="stack" style={{ gap: 12, paddingTop: 12 }}>
                  <div className="capability-legend" aria-label="能力状态图例">
                    {["complete", "partial", "unsupported", "unknown"].map((status) => (
                      <Chip key={status} tone={capabilityTone(status)}>
                        {capabilityLabel(status)}
                      </Chip>
                    ))}
                  </div>
                  {capabilityPlatforms.length ? (
                    <div className="platform-matrix-wrap">
                      <table className="platform-matrix">
                        <caption className="sr-only">平台能力矩阵</caption>
                        <thead>
                          <tr>
                            <th scope="col">平台</th>
                            {capabilityDimensions.map((dimension: any) => (
                              <th key={dimension.id} scope="col">
                                {dimension.label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {capabilityPlatforms.map((platform: any) => {
                            const selected = platform.id === selectedCapabilityPlatform?.id;
                            return (
                              <tr
                                key={platform.id}
                                className="platform-matrix-row"
                                data-selected={selected ? "true" : undefined}
                                onClick={() => setCapabilityPlatformId(platform.id)}
                              >
                                <th scope="row">
                                  <button
                                    type="button"
                                    className="platform-matrix-platform"
                                    aria-pressed={selected}
                                    onClick={() => setCapabilityPlatformId(platform.id)}
                                  >
                                    <strong>{platform.label}</strong>
                                    <span>{platform.sourceCount} 个源</span>
                                  </button>
                                </th>
                                {capabilityDimensions.map((dimension: any) => {
                                  const capability = platform.capabilities?.[dimension.id];
                                  return (
                                    <td key={dimension.id} data-label={dimension.label}>
                                      <span title={capability?.method || "方法未标注"}>
                                        <Chip tone={capabilityTone(capability?.status)}>{capabilityLabel(capability?.status)}</Chip>
                                      </span>
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <EmptyState text="平台能力尚未加载" />
                  )}
                </div>
              </details>
            </Card>

            <Card
              className="inbox-card"
              title="Inbox 分诊"
              hint={`${visibleSignals.length} 条 · 每屏只做判断，不做长表单`}
              actions={
                <Segmented
                  ariaLabel="Inbox 筛选"
                  value={filter}
                  onChange={setFilter}
                  options={FILTERS.map((item) => ({
                    value: item.value,
                    label: `${item.label}${
                      item.value === "all"
                        ? ` ${signals.length}`
                        : ` ${signals.filter((signal: any) => signal.disposition === item.value).length}`
                    }`
                  }))}
                />
              }
            >
              <div className="signal-list">
                {visibleSignals.slice(0, 40).map((signal: any, signalIndex: number) => {
                  const evidence = evidenceBySignal[signal.id];
                  const transcript = transcriptBySignal[signal.id];
                  const hasCapturedTranscript =
                    signal.transcriptStatus === "captured" && Boolean(String(signal.transcriptText || "").trim());
                  const transcriptRunning =
                    !hasCapturedTranscript && (signal.transcriptStatus === "running" || transcript?.status === "running");
                  const transcriptFailed =
                    !hasCapturedTranscript &&
                    !transcriptRunning &&
                    (signal.transcriptStatus === "failed" || transcript?.status === "failed");
                  // 「下一条该处理的」= 当前筛选下第一条仍待分诊的信号
                  const isNextSignal = signalIndex === 0 && signal.disposition === "inbox";
                  const source = state.sources.find((item: any) => item.id === signal.sourceId);
                  const canCaptureDetail = canCaptureXhsDetail(signal, source, runtime);
                  const isFocus = focusSignalId === signal.id;
                  return (
                    <div
                      key={signal.id}
                      className="signal-row"
                      data-signal-id={signal.id}
                      data-focused={isFocus ? "true" : undefined}
                    >
                      <div className="signal-row-layout">
                        <SignalCover src={signal.coverUrl} title={signal.title} />
                        <div className="signal-row-content">
                          <div className="card-head">
                            <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                              <strong style={{ fontSize: 13 }}>{signal.title}</strong>
                              <span className="subtle" style={{ fontSize: 11 }}>
                                {source?.name || "未知来源"} · {platformLabel(signal.platform)} · {fmtDate(signal.capturedAt)}
                              </span>
                            </div>
                            <div className="inline">
                              <Chip tone={signal.disposition === "inbox" ? "warning" : signal.disposition === "discard" ? "neutral" : "action"}>
                                {DISPOSITION_LABEL[signal.disposition] || signal.disposition}
                              </Chip>
                            </div>
                          </div>
                          <div className="inline">
                            {evidence ? (
                              <Chip tone={toneForEvidence(evidence.verification?.state)}>
                                证据包 · {EVIDENCE_STATE_LABEL[evidence.verification?.state] || evidence.verification?.state}
                              </Chip>
                            ) : (
                              <Chip tone="neutral">无证据包</Chip>
                            )}
                            {hasCapturedTranscript || transcriptRunning || transcriptFailed ? (
                              <Chip tone={transcriptFailed ? "danger" : transcriptRunning ? "action" : "candidate"}>
                                逐字稿 · {transcriptFailed ? "失败" : transcriptRunning ? "转写中" : "unverified"}
                              </Chip>
                            ) : null}
                          </div>
                          <div className="inline">
                            {/* 主行动只给“下一条该处理的信号”，其余行降级为次级动作，避免每行都是主按钮 */}
                            <Button small variant={isNextSignal ? "primary" : "secondary"} onClick={() => void createTopic(signal)} disabled={busy === "topic"}>
                              开选题
                            </Button>
                            <Button small variant="ghost" onClick={() => setDisposition(signal.id, "material")}>
                              入素材
                            </Button>
                            <Button small variant="ghost" onClick={() => setDisposition(signal.id, "watch")}>
                              观察
                            </Button>
                            <Button small variant="ghost" onClick={() => setDisposition(signal.id, "discard")}>
                              丢弃
                            </Button>
                            {!evidence ? (
                              <Button small disabled={busy === `evidence-${signal.id}`} onClick={() => void createEvidence(signal)}>
                                建证据包
                              </Button>
                            ) : (
                              <Button small onClick={() => openVerify(evidence)}>
                                核对证据
                              </Button>
                            )}
                            {canCaptureDetail ? (
                              <details className="capture-inline">
                                <summary>补详情</summary>
                                <div className="capture-inline-actions">
                                  <BookmarkletActions
                                    href={xhsDetailBookmarkletHref(signal, runtime)}
                                    onCopy={() =>
                                      void copyCaptureScript(
                                        xhsDetailBookmarkletHref(signal, runtime),
                                        "详情采集脚本已复制"
                                      )
                                    }
                                    label="补详情书签"
                                  />
                                </div>
                              </details>
                            ) : null}
                            {hasCapturedTranscript ? (
                              <Button small onClick={() => openTranscript(signal)}>
                                查看逐字稿
                              </Button>
                            ) : transcriptRunning ? (
                              <Button small disabled>
                                转写中 · {transcript?.stage?.label || "准备中"}
                              </Button>
                            ) : (
                              <Button
                                small
                                disabled={busy === `transcript-${signal.id}`}
                                onClick={() => void startTranscript(signal, transcriptFailed)}
                              >
                                {busy === `transcript-${signal.id}`
                                  ? "正在提交"
                                  : transcriptFailed
                                    ? "重新转写"
                                    : "转写媒体"}
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {!visibleSignals.length ? <EmptyState text="这个筛选下没有信号" action={<Button onClick={() => setFilter("all")}>看全部</Button>} /> : null}
              </div>
            </Card>
          </>
        }
        inspector={
          <>
            {selectedCapabilityPlatform ? (
              <Card
                title={`${selectedCapabilityPlatform.label} · 能力详情`}
                hint={`${selectedCapabilityPlatform.sourceCount} 个源 · 实测方法`}
                tight
              >
                <div className="capability-detail-list">
                  {capabilityDimensions.map((dimension: any) => {
                    const capability = selectedCapabilityPlatform.capabilities?.[dimension.id];
                    return (
                      <div key={dimension.id} className="capability-detail-row">
                        <div className="capability-detail-head">
                          <strong>{dimension.label}</strong>
                          <Chip tone={capabilityTone(capability?.status)}>{capabilityLabel(capability?.status)}</Chip>
                        </div>
                        <span>{capability?.method || "方法未标注"}</span>
                      </div>
                    );
                  })}
                </div>
                <dl className="capability-boundaries">
                  <div>
                    <dt>登录边界</dt>
                    <dd>{selectedCapabilityPlatform.loginBoundary || "未声明登录边界"}</dd>
                  </div>
                  <div>
                    <dt>风险边界</dt>
                    <dd>{selectedCapabilityPlatform.riskBoundary || "未声明风险边界"}</dd>
                  </div>
                </dl>
              </Card>
            ) : null}

            <Card title="证据与逐字稿" hint={`${state.evidencePackages.length} / ${state.transcriptRuns.length}`} tight>
              <div className="queue">
                {state.evidencePackages.slice(0, 6).map((item: any) => (
                  <TimelineItem
                    key={item.id}
                    tone={toneForEvidence(item.verification?.state)}
                    title={`证据包 · ${item.packageKey?.slice(-6)}`}
                    meta={`${item.layers?.length || 0} 层 · ${fmtDate(item.updatedAt)}`}
                    right={
                      <Button small onClick={() => openVerify(item)}>
                        核对
                      </Button>
                    }
                  />
                ))}
                {state.transcriptRuns.slice(0, 4).map((item: any) => {
                  const signal = state.signals.find((candidate: any) => candidate.id === item.signalId);
                  const canView =
                    item.status === "captured" &&
                    signal?.transcriptStatus === "captured" &&
                    Boolean(String(signal?.transcriptText || "").trim());
                  return (
                    <TimelineItem
                      key={item.id}
                      tone={item.status === "failed" ? "danger" : item.status === "running" ? "action" : "candidate"}
                      title={signal?.title ? `逐字稿 · ${signal.title}` : `逐字稿 · ${item.segmentCount ?? 0} 段`}
                      meta={
                        item.status === "running"
                          ? `${fmtDateTime(item.startedAt)} · ${item.stage?.label || "准备中"}`
                          : item.status === "failed"
                            ? item.error || "转写失败"
                            : `${item.segmentCount ?? 0} 段 · ${formatDurationSeconds(item.durationSeconds)} · 待人工校对`
                      }
                      right={
                        canView && signal ? (
                          <Button small onClick={() => openTranscript(signal)}>
                            查看
                          </Button>
                        ) : item.status === "failed" && signal ? (
                          <Button small onClick={() => void startTranscript(signal, true)}>
                            重试
                          </Button>
                        ) : (
                          <Chip tone={item.status === "running" ? "action" : "candidate"}>
                            {item.status === "running" ? "转写中" : "unverified"}
                          </Chip>
                        )
                      }
                    />
                  );
                })}
              </div>
            </Card>
          </>
        }
        mobileAction={
          <Button variant="primary" onClick={() => setView("workflow")}>
            去工作流推进当前选题
          </Button>
        }
      />

      <Sheet
        open={Boolean(verify)}
        title="核对证据包"
        onClose={() => setVerify(null)}
        footer={
          <>
            <Button onClick={() => setVerify(null)}>取消</Button>
            <Button variant="primary" onClick={submitVerify}>
              保存
            </Button>
          </>
        }
      >
        {verify ? (
          <>
            <Field label="包标识">
              <input className="input" value={verify.packageKey || ""} readOnly />
            </Field>
            <Field label="包含层" hint={verify.layers?.join("、") || "无"}>
              <input className="input" value={`${verify.layers?.length || 0} 层`} readOnly />
            </Field>
            <Field label="校验结论" error={sheetError || undefined}>
              <select className="select" value={verifyState} onChange={(e) => setVerifyState(e.target.value)}>
                <option value="verified">已校验（可作为引用）</option>
                <option value="unverified">保持 unverified（候选）</option>
                <option value="rejected">驳回（证据不足）</option>
              </select>
            </Field>
            <Field label="备注">
              <textarea className="textarea" style={{ minHeight: 100 }} value={verifyNote} onChange={(e) => setVerifyNote(e.target.value)} />
            </Field>
          </>
        ) : null}
      </Sheet>

      <Sheet
        open={Boolean(transcriptSignal)}
        title="逐字稿阅读器"
        size="wide"
        onClose={() => setTranscriptSignalId(null)}
        footer={
          <Button onClick={() => setTranscriptSignalId(null)}>
            关闭
          </Button>
        }
      >
        {transcriptSignal ? (
          <div className="transcript-reader">
            <header className="transcript-reader-head">
              <div className="transcript-reader-summary">
                <SignalCover src={transcriptSignal.coverUrl} title={transcriptSignal.title} variant="reader" />
                <div className="stack" style={{ gap: 6, minWidth: 0 }}>
                  <h3 className="transcript-reader-title">{transcriptSignal.title}</h3>
                  {transcriptSource?.url ? (
                    <a
                      className="transcript-reader-source"
                      href={transcriptSource.url}
                      target="_blank"
                      rel="noreferrer"
                      title={transcriptSource.url}
                    >
                      {transcriptSource.name || transcriptSource.url}
                    </a>
                  ) : (
                    <span className="transcript-reader-source">{transcriptSource?.name || "来源未登记"}</span>
                  )}
                </div>
              </div>
              <dl className="transcript-meta">
                <div>
                  <dt>模型</dt>
                  <dd>{transcriptSignal.transcriptModel || transcriptRun?.model || "未标注"}</dd>
                </div>
                <div>
                  <dt>媒体时长</dt>
                  <dd className="tabular">
                    {formatDurationSeconds(transcriptSignal.transcriptDurationSeconds || transcriptRun?.durationSeconds)}
                  </dd>
                </div>
                <div>
                  <dt>全文</dt>
                  <dd className="tabular">{transcriptText.length} 字</dd>
                </div>
                <div>
                  <dt>时间轴</dt>
                  <dd className="tabular">{transcriptSegments.length} 段</dd>
                </div>
                <div>
                  <dt>生成时间</dt>
                  <dd>{fmtDateTime(transcriptSignal.transcriptCapturedAt || transcriptRun?.finishedAt)}</dd>
                </div>
              </dl>
            </header>

            <div className="transcript-notice" role="note">
              <Chip tone="candidate">unverified</Chip>
              <span>ASR 候选稿，引用前需人工校对。</span>
            </div>

            <div className="transcript-toolbar">
              <Segmented
                ariaLabel="逐字稿视图"
                value={transcriptMode}
                onChange={(value: TranscriptMode) => setTranscriptMode(value)}
                options={[
                  { value: "full", label: "全文" },
                  { value: "timeline", label: "时间轴" },
                  { value: "analysis", label: "流量拆解" }
                ]}
              />
              <div className="transcript-reader-actions">
                {canCaptureTranscriptDetail ? (
                  <BookmarkletActions
                    href={xhsDetailBookmarkletHref(transcriptSignal, runtime)}
                    onCopy={() =>
                      void copyCaptureScript(
                        xhsDetailBookmarkletHref(transcriptSignal, runtime),
                        "详情采集脚本已复制"
                      )
                    }
                    label="补详情书签"
                  />
                ) : null}
                <Button small disabled={!transcriptText} onClick={copyTranscript}>
                  复制全文
                </Button>
                <Button small disabled={!transcriptText} onClick={downloadTranscriptTxt}>
                  下载 TXT
                </Button>
                <Button small disabled={!transcriptText} onClick={downloadTranscriptJson}>
                  下载 JSON
                </Button>
              </div>
            </div>

            <div className="transcript-analysis-actions" aria-label="逐字稿分析与交接">
              <Button
                small
                variant="primary"
                disabled={!transcriptText || !transcriptSegments.length || busy === `analysis-${transcriptSignal.id}`}
                onClick={() => void generateTranscriptAnalysis()}
              >
                {busy === `analysis-${transcriptSignal.id}` ? "拆解中..." : "生成流量拆解 · unverified"}
              </Button>
              <Button small disabled={!transcriptAnalysis} onClick={() => setTranscriptMode("analysis")}>
                查看拆解
              </Button>
              <Button
                small
                disabled={!transcriptText || busy === `analysis-agent-${transcriptSignal.id}`}
                onClick={() => void createAnalysisAgentTask()}
              >
                {busy === `analysis-agent-${transcriptSignal.id}` ? "创建中..." : "交给 Agent 深挖"}
              </Button>
              <Button
                small
                disabled={!transcriptAnalysis || !configuredDriveRoot || busy === "knowledge-export"}
                onClick={() => void exportTranscriptKnowledge()}
              >
                {busy === "knowledge-export" ? "导出中..." : "导出到 Google Drive"}
              </Button>
            </div>

            {!configuredDriveRoot ? (
              <div className="transcript-action-note" role="note">
                <span>知识导出只会写入已配置的 Google Drive 本机同步目录，不包含 Cookie 或登录态。</span>
                <Button small variant="ghost" onClick={() => setView("system")}>
                  前往系统设置
                </Button>
              </div>
            ) : null}

            {analysisFeedback ? (
              <div
                className="transcript-action-feedback"
                data-tone={analysisFeedback.tone}
                role={analysisFeedback.tone === "danger" ? "alert" : "status"}
              >
                {analysisFeedback.message}
              </div>
            ) : null}

            {transcriptMode === "full" ? (
              transcriptText ? (
                <article className="transcript-full-text" aria-label="逐字稿全文">
                  {transcriptText}
                </article>
              ) : (
                <EmptyState text="这次运行没有可读取的逐字稿全文" />
              )
            ) : transcriptMode === "timeline" ? (
              transcriptSegments.length ? (
                <ol className="transcript-timeline" aria-label="逐字稿时间轴">
                  {transcriptSegments.map((segment: any, index: number) => (
                    <li key={`${segment.start ?? index}-${index}`} className="transcript-timeline-item">
                      <time className="transcript-timestamp">
                        {segment.startTimestamp || formatTranscriptTimestamp(segment.start)}
                      </time>
                      <p>{segment.text || "本段没有识别文本"}</p>
                    </li>
                  ))}
                </ol>
              ) : (
                <EmptyState text="这次运行没有可读取的时间轴分段" />
              )
            ) : !transcriptAnalysisBody ? (
              <EmptyState text="还没有流量拆解。先生成候选拆解，再查看结构与带时间戳引文。" />
            ) : (
              <div className="transcript-analysis" aria-label="候选流量拆解">
                <header className="analysis-heading">
                  <div className="stack">
                    <div className="inline">
                      <Chip tone="candidate">候选拆解</Chip>
                      <Chip tone="candidate">unverified</Chip>
                    </div>
                    <h3>这条内容为什么可能有效</h3>
                    <p className="analysis-lead">{transcriptAnalysisBody.summary}</p>
                  </div>
                  <div className="analysis-run-meta">
                    <span>{fmtDateTime(transcriptAnalysis.finishedAt || transcriptAnalysis.createdAt)}</span>
                    <span>{transcriptAnalysis.sourceMode}</span>
                    <Button
                      small
                      variant="ghost"
                      disabled={busy === `analysis-${transcriptSignal.id}`}
                      onClick={() => void generateTranscriptAnalysis(true)}
                    >
                      重新生成
                    </Button>
                  </div>
                </header>

                <div className="analysis-pair">
                  <section className="analysis-section">
                    <div className="analysis-section-head">
                      <h4>开头钩子</h4>
                      <Chip tone="candidate">unverified</Chip>
                    </div>
                    <strong>{transcriptAnalysisBody.hook.pattern}</strong>
                    <p>{transcriptAnalysisBody.hook.candidateRead}</p>
                    <AnalysisQuoteView quote={transcriptAnalysisBody.hook.quote} />
                  </section>
                  <section className="analysis-section">
                    <div className="analysis-section-head">
                      <h4>承诺与张力</h4>
                      <Chip tone="candidate">unverified</Chip>
                    </div>
                    <p>{transcriptAnalysisBody.promiseAndTension.tension}</p>
                    <AnalysisQuoteView quote={transcriptAnalysisBody.promiseAndTension.quote} />
                  </section>
                </div>

                <section className="analysis-section">
                  <div className="analysis-section-head">
                    <h4>四段结构</h4>
                    <Chip tone="candidate">unverified</Chip>
                  </div>
                  <div className="analysis-structure">
                    {transcriptAnalysisBody.structure.map((part: any, index: number) => (
                      <article className="analysis-structure-part" key={part.id || index}>
                        <div className="analysis-structure-title">
                          <span className="analysis-index tabular">{String(index + 1).padStart(2, "0")}</span>
                          <div className="stack">
                            <strong>{part.label}</strong>
                            <span>{part.role}</span>
                          </div>
                          {part.startTimestamp ? (
                            <time className="transcript-timestamp tabular">
                              {part.startTimestamp} - {part.endTimestamp}
                            </time>
                          ) : null}
                        </div>
                        <p>{part.candidateSummary}</p>
                        <AnalysisQuoteView quote={part.quote} />
                      </article>
                    ))}
                  </div>
                </section>

                <section className="analysis-section">
                  <div className="analysis-section-head">
                    <h4>节奏</h4>
                    <Chip tone="candidate">unverified</Chip>
                  </div>
                  <dl className="analysis-metrics">
                    <div>
                      <dt>时长</dt>
                      <dd>{formatDurationSeconds(transcriptAnalysisBody.pacing.durationSeconds)}</dd>
                    </div>
                    <div>
                      <dt>口播字数</dt>
                      <dd>{transcriptAnalysisBody.pacing.characterCount}</dd>
                    </div>
                    <div>
                      <dt>字 / 秒</dt>
                      <dd>{transcriptAnalysisBody.pacing.charsPerSecond}</dd>
                    </div>
                    <div>
                      <dt>分段 / 分钟</dt>
                      <dd>{transcriptAnalysisBody.pacing.segmentsPerMinute}</dd>
                    </div>
                  </dl>
                  <p>{transcriptAnalysisBody.pacing.candidateRead}</p>
                  {transcriptAnalysisBody.pacing.fastestWindow ? (
                    <p className="analysis-inline-evidence">
                      最快 15 秒：
                      <time className="transcript-timestamp tabular">
                        {transcriptAnalysisBody.pacing.fastestWindow.startTimestamp} -{" "}
                        {transcriptAnalysisBody.pacing.fastestWindow.endTimestamp}
                      </time>
                      ，约 {transcriptAnalysisBody.pacing.fastestWindow.charsPerSecond} 字 / 秒。
                    </p>
                  ) : null}
                </section>

                <div className="analysis-pair">
                  <section className="analysis-section">
                    <div className="analysis-section-head">
                      <h4>留存机制候选</h4>
                      <Chip tone="candidate">unverified</Chip>
                    </div>
                    {transcriptAnalysisBody.retention.length ? (
                      <ul className="analysis-list">
                        {transcriptAnalysisBody.retention.map((item: any) => (
                          <li key={item.id}>
                            <strong>
                              {item.label} · {item.count} 次
                            </strong>
                            <span>{item.why}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>没有识别到明显的文本留存机制。</p>
                    )}
                  </section>
                  <section className="analysis-section">
                    <div className="analysis-section-head">
                      <h4>情绪回报候选</h4>
                      <Chip tone="candidate">unverified</Chip>
                    </div>
                    <p>{transcriptAnalysisBody.emotionalPayoff.candidateRead}</p>
                    {transcriptAnalysisBody.emotionalPayoff.primary ? (
                      <p className="analysis-inline-evidence">
                        主要候选：<strong>{transcriptAnalysisBody.emotionalPayoff.primary.label}</strong>
                      </p>
                    ) : null}
                  </section>
                </div>

                <section className="analysis-section">
                  <div className="analysis-section-head">
                    <h4>作者相对表现</h4>
                    <Chip tone="candidate">unverified</Chip>
                  </div>
                  <p>{transcriptAnalysisBody.authorBaseline.candidateRead}</p>
                </section>

                <section className="analysis-section">
                  <div className="analysis-section-head">
                    <h4>可复用公式（假设）</h4>
                    <Chip tone="candidate">unverified</Chip>
                  </div>
                  <strong>{transcriptAnalysisBody.reusableFormula.name}</strong>
                  <p>{transcriptAnalysisBody.reusableFormula.skeleton}</p>
                  <p>{transcriptAnalysisBody.reusableFormula.candidateUse}</p>
                </section>

                <section className="analysis-section">
                  <div className="analysis-section-head">
                    <h4>证据缺口</h4>
                    <Chip tone="warning">先核对</Chip>
                  </div>
                  <ul className="analysis-list">
                    {transcriptAnalysisBody.evidenceGaps.map((gap: string, index: number) => (
                      <li key={`${index}-${gap}`}>
                        <span>{gap}</span>
                      </li>
                    ))}
                  </ul>
                </section>

                <section className="analysis-section">
                  <div className="analysis-section-head">
                    <h4>可回溯引文</h4>
                    <Chip tone="candidate">{transcriptAnalysisBody.quotes.length} 条 · unverified</Chip>
                  </div>
                  <div className="analysis-quotes">
                    {transcriptAnalysisBody.quotes.map((quote: TranscriptAnalysisQuote, index: number) => (
                      <article key={`${quote.startTimestamp}-${quote.endTimestamp}-${index}`}>
                        <span className="analysis-quote-number tabular">引文 {index + 1}</span>
                        <AnalysisQuoteView quote={quote} />
                      </article>
                    ))}
                  </div>
                </section>
              </div>
            )}
          </div>
        ) : null}
      </Sheet>
    </>
  );
}
