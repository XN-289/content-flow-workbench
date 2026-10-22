import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { createBackupStore } from "./backup-store.mjs";
import { analysisRuntime, createTranscriptAnalysis, latestAnalysisForSignal } from "./analysis-workflow.mjs";
import { agentPluginManifest } from "./agent-plugin-contract.mjs";
import { collectBilibiliPublic } from "./bilibili-public.mjs";
import {
  batchIntakeNextAction,
  intakeStatusFromClassification,
  parseBatchIntakeText
} from "./batch-intake.mjs";
import { aggregateCollectionEnvelopes, collectionEnvelopeFromRun, finalizeCollectionRun } from "./collection-envelope.mjs";
import { createEvidenceRuntime, createSignalEvidencePackage, verifyEvidencePackage } from "./evidence-package.mjs";
import { mediaDescriptions, normalizeDetailCapture } from "./detail-evidence.mjs";
import { inboxFunnelRuntime } from "./inbox-funnel.mjs";
import { exportKnowledgeToDrive, knowledgeExportRuntime } from "./knowledge-export.mjs";
import {
  aggregatePipelineStatus,
  isAutomaticCollectionCandidate,
  isAutomaticCollectionDue,
  isManualCollectionCandidate,
  isScheduledCollectionSource,
  morningPipelineRuntime,
  operationStatusFromResult
} from "./morning-pipeline.mjs";
import { platformCapabilityRuntime } from "./platform-capabilities.mjs";
import { createPlatformMediaCache } from "./platform-media.mjs";
import { clearRuntimeLocator, publishRuntimeLocator } from "./runtime-locator.mjs";
import { classifySourceIntakeUrl, resolveSourceIntakeUrl } from "./source-intake.mjs";
import {
  accountWatchRuntimeForSource,
  buildAccountWatchRuntime,
  isAccountWatchSource
} from "./account-watch.mjs";
import {
  applyTranscriptResult,
  createTranscriptRunId,
  resolveAsrRuntime,
  transcribeSignal
} from "./transcribe-signal.mjs";
import { captureXhsGuestNote } from "./xhs-guest-detail.mjs";
import { refreshXhsProfileSources } from "./xhs-public-profile.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appDir = path.join(root, "app");
const distDir = path.join(appDir, "dist");
const dataDir = path.join(root, "data");
const dataFile = process.env.DATA_FILE ? path.resolve(process.env.DATA_FILE) : path.join(dataDir, "workbench.json");
const backupDir = process.env.BACKUP_DIR
  ? path.resolve(process.env.BACKUP_DIR)
  : (process.env.DATA_FILE ? null : path.join(dataDir, "backups"));
const backupRetentionLimit = Math.max(10, Number(process.env.BACKUP_RETENTION || 100));
const dropDir = process.env.DROP_DIR ? path.resolve(process.env.DROP_DIR) : path.join(root, "drops");
const dropProcessedDir = path.join(dropDir, "processed");
const dropFailedDir = path.join(dropDir, "failed");
const cloudInboxRelativeDir = path.join("ContentFlowWorkbench", "Inbox");
const bridgeRoot = process.env.BRIDGE_ROOT ? path.resolve(process.env.BRIDGE_ROOT) : path.join(root, "bridge");
const evidenceRoot = process.env.EVIDENCE_DIR ? path.resolve(process.env.EVIDENCE_DIR) : path.join(root, "evidence");
const transcriptRoot = process.env.TRANSCRIPT_DIR ? path.resolve(process.env.TRANSCRIPT_DIR) : path.join(root, "data", "transcripts");
const mediaCacheDir = process.env.MEDIA_CACHE_DIR
  ? path.resolve(process.env.MEDIA_CACHE_DIR)
  : path.join(dataDir, "media", "covers");
const agentBridgeOutboxDir = path.join(bridgeRoot, "outbox");
const port = Number(process.env.PORT || 5177);
let activePort = port;
const automationTickMs = Math.max(1000, Number(process.env.AUTOMATION_TICK_MS || 60000));
const dropScanMs = Math.max(1000, Number(process.env.DROP_SCAN_MS || 30000));
const browserCapturePaths = new Set(["/api/browser-capture", "/api/browser-detail-capture"]);
const dropExtensions = new Set([".json", ".md", ".txt"]);
const runningSourceIds = new Set();
const runningAgentTaskIds = new Set();
const runningTranscriptSignalIds = new Set();
const runningXhsCaptureIds = new Set();
let stateMutationQueue = Promise.resolve();
const browserCaptureTokens = new Map();
const dropFileStability = new Map();
const maxRequestBodyBytes = 2 * 1024 * 1024;
const platformMediaCache = createPlatformMediaCache({ cacheDir: mediaCacheDir });

const agentOptions = new Set(["grok", "muse", "codex", "claude", "cursor"]);
const agentTaskKinds = new Set(["research", "dissect", "outline", "script", "title", "platform-copy", "visual"]);
const localAgentRunners = new Set(["codex", "claude"]);

const emptyState = () => ({
  version: 1,
  settings: {
    collectionTime: "08:40",
    automationEnabled: true,
    morningBriefEnabled: true,
    inboxTime: "09:00",
    inboxDailyLimit: 10,
    streakDefinition: "",
    driveRoot: ""
  },
  sources: [],
  signals: [],
  materials: [],
  topics: [],
  scripts: [],
  publications: [],
  reviews: [],
  collectionRuns: [],
  rawSnapshots: [],
  morningBriefs: [],
  morningPipelineRuns: [],
  frictionLog: [],
  agentTasks: [],
  evidencePackages: [],
  transcriptRuns: [],
  analysisRuns: [],
  knowledgeExports: [],
  cloudInboxLedger: [],
  intakeBatches: [],
  intakeQueue: [],
  captureRuns: []
});

const { stableJsonValue, readBackupFile, listBackups, createBackup } = createBackupStore({
  backupDir,
  retentionLimit: backupRetentionLimit,
  emptyState
});

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

async function readState() {
  try {
    const text = await fs.readFile(dataFile, "utf8");
    const parsed = JSON.parse(text);
    const state = {
      ...emptyState(),
      ...parsed,
      settings: { ...emptyState().settings, ...(parsed.settings || {}) },
      agentTasks: Array.isArray(parsed.agentTasks) ? parsed.agentTasks : [],
      morningPipelineRuns: Array.isArray(parsed.morningPipelineRuns) ? parsed.morningPipelineRuns : [],
      evidencePackages: Array.isArray(parsed.evidencePackages) ? parsed.evidencePackages : [],
      transcriptRuns: Array.isArray(parsed.transcriptRuns) ? parsed.transcriptRuns : [],
      analysisRuns: Array.isArray(parsed.analysisRuns) ? parsed.analysisRuns : [],
      knowledgeExports: Array.isArray(parsed.knowledgeExports) ? parsed.knowledgeExports : [],
      cloudInboxLedger: Array.isArray(parsed.cloudInboxLedger) ? parsed.cloudInboxLedger : [],
      intakeBatches: Array.isArray(parsed.intakeBatches) ? parsed.intakeBatches : [],
      intakeQueue: Array.isArray(parsed.intakeQueue) ? parsed.intakeQueue : [],
      captureRuns: Array.isArray(parsed.captureRuns) ? parsed.captureRuns : []
    };
    state.settings.driveRoot = String(state.settings.driveRoot || "").trim();
    refreshEngagementMetrics(state);
    prepareAutomationState(state);
    return state;
  } catch (error) {
    if (error.code === "ENOENT") return emptyState();
    throw error;
  }
}

async function writeState(state, options = {}) {
  const backupReason = String(options.backupReason || "auto");
  const allowBackup = options.backup !== false && Boolean(backupDir);
  await fs.mkdir(dataDir, { recursive: true });
  if (allowBackup) {
    let previousText = null;
    try {
      previousText = await fs.readFile(dataFile, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (previousText !== null) {
      const previousState = JSON.parse(previousText);
      if (stableJsonValue(previousState) !== stableJsonValue(state)) {
        await createBackup(previousState, backupReason);
      }
    }
  }
  const temp = `${dataFile}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(state, null, 2), "utf8");
  const retryableCodes = new Set(["EPERM", "EACCES", "EBUSY"]);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await fs.rename(temp, dataFile);
      return;
    } catch (error) {
      if (!retryableCodes.has(error?.code)) throw error;
      if (attempt === 5) {
        await fs.rm(temp, { force: true }).catch(() => {});
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 20 * 2 ** attempt));
    }
  }
}

async function restoreBackup(filename) {
  const target = await readBackupFile(filename);
  if (runningAgentTaskIds.size > 0) throw new Error("Agent task is running; wait for it to finish before restore");
  const current = await readState();
  await createBackup(current, "pre-restore");
  const restored = {
    ...emptyState(),
    ...target.state,
    settings: { ...emptyState().settings, ...target.state.settings }
  };
  refreshEngagementMetrics(restored);
  prepareAutomationState(restored);
  await writeState(restored, { backup: false });
  browserCaptureTokens.clear();
  return { ok: true, backup: { ...target, state: undefined }, state: await readState() };
}

function id(prefix) {
  return `${prefix}-${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}`;
}

function now() {
  return new Date().toISOString();
}

function localDateKey(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function localMinuteOfDay(date = new Date()) {
  return date.getHours() * 60 + date.getMinutes();
}

function collectionSlot(value, from = new Date()) {
  const [hours, minutes] = String(value || "08:40").split(":").map(Number);
  const slot = new Date(from.getFullYear(), from.getMonth(), from.getDate(), hours || 0, minutes || 0, 0, 0);
  if (slot.getTime() <= from.getTime()) slot.setDate(slot.getDate() + 1);
  return slot;
}

function nextCollectionRun(source, collectionTime, from = new Date()) {
  const intervalDays = source.checkFrequency === "weekly" ? 7 : 1;
  const slot = collectionSlot(collectionTime || "08:40", from);
  slot.setDate(slot.getDate() + intervalDays - 1);
  return slot.toISOString();
}

function failureDelay(failureCount) {
  const fiveMinutes = 5 * 60 * 1000;
  const sixHours = 6 * 60 * 60 * 1000;
  return Math.min(fiveMinutes * 2 ** Math.max(0, failureCount - 1), sixHours);
}

function isScheduledSource(source) {
  return isScheduledCollectionSource(source);
}

function isAccountWatchDue(source, timestamp = Date.now()) {
  const nextRunAt = Date.parse(String(source?.nextRunAt || ""));
  return isAccountWatchSource(source)
    && Number.isFinite(nextRunAt)
    && nextRunAt <= Number(timestamp);
}

function nextAccountWatchRun(source, collectionTime, from = new Date()) {
  return nextCollectionRun(source, collectionTime, from);
}

function prepareAutomationState(state) {
  for (const source of state.sources || []) {
    source.failureCount = Number(source.failureCount || 0);
    if (!isScheduledSource(source)) {
      source.nextRunAt = source.nextRunAt || "";
      source.automationStatus = source.enabled === false
        ? "disabled"
        : source.checkFrequency === "on-demand"
          ? "on-demand"
          : "research-only";
      continue;
    }

    if (!source.nextRunAt) {
      source.nextRunAt = collectionSlot(state.settings.collectionTime).toISOString();
    }
    if (source.automationStatus !== "retrying") {
      source.automationStatus = isAutomaticCollectionCandidate(source) ? "scheduled" : "manual-required";
    }
  }
}

function isDue(source, timestamp = Date.now()) {
  return isAutomaticCollectionDue(source, timestamp);
}

function automationEnabled(state) {
  const envDisabled = ["false", "0", "off"].includes(String(process.env.AUTOMATION_ENABLED || "").toLowerCase());
  return !envDisabled && state.settings.automationEnabled !== false;
}

function enqueueStateMutation(operation) {
  const run = stateMutationQueue.then(operation, operation);
  stateMutationQueue = run.catch(() => {});
  return run;
}

async function updateTranscriptRunStage(runId, stage) {
  await enqueueStateMutation(async () => {
    const state = await readState();
    const run = (state.transcriptRuns || []).find((item) => item.id === runId);
    if (!run || run.status !== "running") return;
    run.stage = stage;
    run.updatedAt = new Date().toISOString();
    await writeState(state, { backup: false });
  });
}

async function persistBackgroundTranscriptFailure(signalId, runId, error) {
  try {
    await enqueueStateMutation(async () => {
      const state = await readState();
      const existingRun = (state.transcriptRuns || []).find((item) => item.id === runId);
      const finishedAt = new Date().toISOString();
      const message = String(error?.message || error || "后台转写失败").replace(/\s+/g, " ").trim().slice(0, 1000);
      const result = {
        ok: false,
        error: message,
        run: {
          id: runId,
          signalId,
          startedAt: existingRun?.startedAt || finishedAt,
          finishedAt,
          status: "failed",
          error: message,
          nextAction: "检查本地 ASR 配置、媒体链接和 ffmpeg 后重试"
        }
      };
      applyTranscriptResult(state, signalId, result);
      await writeState(state, { backup: false });
    });
  } catch (persistError) {
    console.error("Failed to persist background transcript failure:", persistError);
  }
}

async function executeSignalTranscription(normalizedSignalId, force, transcriptRunId) {
  const signal = await enqueueStateMutation(async () => {
    const state = await readState();
    const current = state.signals.find((item) => item.id === normalizedSignalId);
    if (!current) throw new Error("signal not found");
    return structuredClone(current);
  });

  // ASR can take minutes; keep it outside the global state mutation queue.
  const result = await transcribeSignal(signal, {
    root,
    transcriptRoot,
    asrRuntime: await resolveAsrRuntime(root),
    force: force === true,
    runId: transcriptRunId,
    onProgress: (stage) => updateTranscriptRunStage(transcriptRunId, stage)
  });
  const persisted = await enqueueStateMutation(async () => {
    const state = await readState();
    const applied = applyTranscriptResult(state, normalizedSignalId, result);
    await writeState(state);
    return applied;
  });
  return { ...result, signal: persisted.signal };
}

async function runSignalTranscription(signalId, force = false, { background = false } = {}) {
  const normalizedSignalId = String(signalId || "").trim();
  if (!normalizedSignalId) throw new Error("signalId is required");
  if (runningTranscriptSignalIds.has(normalizedSignalId)) {
    const error = new Error("这条信号的逐字稿正在转写中");
    error.statusCode = 409;
    throw error;
  }

  runningTranscriptSignalIds.add(normalizedSignalId);
  try {
    const transcriptRunId = createTranscriptRunId();
    if (background) {
      const placeholder = await enqueueStateMutation(async () => {
        const state = await readState();
        const signal = state.signals.find((item) => item.id === normalizedSignalId);
        if (!signal) throw new Error("signal not found");
        const startedAt = new Date().toISOString();
        const run = {
          id: transcriptRunId,
          signalId: normalizedSignalId,
          startedAt,
          updatedAt: startedAt,
          finishedAt: null,
          status: "running",
          stage: { id: "queued", label: "已排队，准备媒体" },
          error: "",
          nextAction: ""
        };
        state.transcriptRuns = [run, ...(state.transcriptRuns || [])].slice(0, 30);
        if (signal.transcriptStatus !== "captured") {
          signal.transcriptStatus = "running";
          signal.transcriptNote = "本地逐字稿正在生成；可继续处理其他内容。";
          signal.updatedAt = startedAt;
        }
        await writeState(state);
        return run;
      });

      const task = executeSignalTranscription(normalizedSignalId, force, transcriptRunId)
        .catch((error) => persistBackgroundTranscriptFailure(normalizedSignalId, transcriptRunId, error))
        .finally(() => runningTranscriptSignalIds.delete(normalizedSignalId));
      void task;
      return {
        ok: true,
        accepted: true,
        background: true,
        signalId: normalizedSignalId,
        run: placeholder
      };
    }

    return await executeSignalTranscription(normalizedSignalId, force, transcriptRunId);
  } finally {
    if (!background) runningTranscriptSignalIds.delete(normalizedSignalId);
  }
}

function requestOrigin(request) {
  return request.headers?.origin || "";
}

function isLocalOrigin(origin) {
  return origin === `http://127.0.0.1:${activePort}` || origin === `http://localhost:${activePort}`;
}

function apiOriginAllowed(request, pathname) {
  const origin = requestOrigin(request);
  if (!origin || isLocalOrigin(origin)) return true;
  return browserCapturePaths.has(pathname) && origin === "https://www.xiaohongshu.com";
}

function captureTokenFor(sourceId) {
  const existing = browserCaptureTokens.get(sourceId);
  if (existing && existing.expiresAt > Date.now() + 60 * 1000) return existing;
  const record = {
    sourceId,
    token: crypto.randomBytes(24).toString("base64url"),
    expiresAt: Date.now() + 12 * 60 * 60 * 1000
  };
  browserCaptureTokens.set(sourceId, record);
  return record;
}

function browserCaptureRuntime(state) {
  const sources = state.sources || [];
  const activeSourceIds = new Set(sources
    .filter((source) => source.platform === "xiaohongshu" && source.collectionMethod === "browser-assisted")
    .map((source) => source.id));
  for (const sourceId of browserCaptureTokens.keys()) {
    if (!activeSourceIds.has(sourceId)) browserCaptureTokens.delete(sourceId);
  }
  return sources
    .filter((source) => activeSourceIds.has(source.id))
    .map((source) => {
      const record = captureTokenFor(source.id);
      return { sourceId: source.id, token: record.token, expiresAt: new Date(record.expiresAt).toISOString() };
    });
}

function latestRunForSource(state, sourceId) {
  return (state.collectionRuns || [])
    .filter((run) => run.sourceId === sourceId)
    .sort((a, b) => String(b.startedAt || "").localeCompare(String(a.startedAt || "")))[0] || null;
}

function normalizeBlockedPreview(item) {
  if (!item || typeof item !== "object") return null;
  const title = String(item.title ?? "").trim();
  const coverUrl = String(item.coverUrl ?? "").trim();
  if (!title && !coverUrl) return null;
  const publishedAt = typeof item.publishedAt === "number"
    ? item.publishedAt
    : String(item.publishedAt ?? "").trim();
  return {
    title,
    engagement: String(item.engagement ?? item.likedCount ?? "").trim(),
    publishedAt,
    coverUrl,
    reason: String(item.reason || "note-id-unavailable")
  };
}

function latestBlockedPreviewsForSource(state, sourceId) {
  const snapshots = (state.rawSnapshots || [])
    .filter((snapshot) => (
      snapshot.sourceId === sourceId
      && snapshot.format === "browser-assisted"
    ))
    .sort((left, right) => String(right.capturedAt || "").localeCompare(String(left.capturedAt || "")));

  for (const snapshot of snapshots) {
    try {
      const content = JSON.parse(snapshot.content || "{}");
      if (!Array.isArray(content.blockedItems) || content.blockedItems.length === 0) continue;
      return content.blockedItems
        .map(normalizeBlockedPreview)
        .filter(Boolean)
        .slice(0, 50);
    } catch {
      // Ignore malformed historical snapshots and keep looking for a readable one.
    }
  }
  return [];
}

function sourceControlRecord(state, source, timestamp = Date.now(), accountWatch = null) {
  const latestRun = latestRunForSource(state, source.id);
  const automatic = isAutomaticCollectionCandidate(source);
  const scheduled = isScheduledSource(source);
  const due = isDue(source, timestamp);
  const accountWatchEnabled = isAccountWatchSource(source);
  const hasAccountWatchRun = source.lastRunTrigger === "account-watch"
    || accountWatch?.latestRun?.trigger === "account-watch";
  const watchStatus = accountWatchEnabled && hasAccountWatchRun
    ? String(accountWatch?.refreshStatus || "")
    : "";
  const nextRunTime = source.nextRunAt ? new Date(source.nextRunAt).getTime() : 0;
  const coolingDown = source.automationStatus === "retrying" && nextRunTime > timestamp;
  const failed = source.lastRunStatus === "failed" || latestRun?.status === "failed";
  const blocked = source.lastRunStatus === "blocked" || latestRun?.status === "blocked";
  const manualMethod = ["manual", "platform-export"].includes(source.collectionMethod);
  const browserBackfill = source.collectionMethod === "browser-assisted"
    && (!source.coverage || ["partial", "unknown"].includes(source.coverage.status));

  let controlStatus = "monitoring";
  if (source.enabled === false) controlStatus = "disabled";
  else if (watchStatus === "refreshing") controlStatus = "running";
  else if (watchStatus === "refresh-failed") controlStatus = "failed";
  else if (watchStatus === "refresh-blocked") controlStatus = "manual";
  else if (watchStatus === "baseline-missing") controlStatus = "due";
  else if (watchStatus === "current") controlStatus = "monitoring";
  else if (source.automationStatus === "running") controlStatus = "running";
  else if (coolingDown) controlStatus = "cooldown";
  else if (failed) controlStatus = "failed";
  else if (browserBackfill) controlStatus = "backfill";
  else if (blocked || manualMethod) controlStatus = "manual";
  else if (due) controlStatus = "due";
  else if (source.collectionMethod === "browser-assisted" && source.coverage?.status === "complete") controlStatus = "complete";
  else if (!scheduled) controlStatus = source.collectionMethod === "research-only" ? "research" : "on-demand";

  let primaryAction = "wait";
  let nextAction = "";
  if (controlStatus === "running") {
    nextAction = watchStatus === "refreshing"
      ? "正在按公开主页刷新，完成后会保留可打开笔记并更新预览列表"
      : "等待当前采集完成，不要重复启动";
  } else if (controlStatus === "cooldown") {
    primaryAction = "inspect";
    nextAction = `冷却至 ${source.nextRunAt}；先检查上次失败原因，不要连续重试`;
  } else if (controlStatus === "failed") {
    primaryAction = "inspect";
    nextAction = watchStatus === "refresh-failed"
      ? accountWatch?.latestRun?.nextAction || source.lastCollectionError || "公开主页刷新失败，旧快照已保留"
      : source.lastCollectionError || latestRun?.failureReason || "查看最近失败原因";
  } else if (controlStatus === "manual") {
    primaryAction = source.collectionMethod === "platform-export" ? "import" : "capture";
    nextAction = watchStatus === "refresh-blocked"
      ? `${accountWatch?.latestRun?.nextAction || "公开主页刷新受阻"}；${accountWatch?.lastSnapshotAt ? `上一份有效快照 ${accountWatch.lastSnapshotAt}` : "暂无有效快照"}`
      : source.coverage?.status === "blocked"
      ? `主页可见 ${source.coverage.lastLoadedCount || 0} 条，但 ${source.coverage.blockedNoteCount || 0} 条缺少可打开 noteId；请从 App 分享感兴趣笔记的链接，再由详情书签补证据`
      : source.collectionMethod === "platform-export"
      ? "导出平台数据后，用 JSON 导入或本地投递箱入库"
      : "用快速粘贴、JSON 导入或本地投递箱完成人工进料";
  } else if (controlStatus === "backfill") {
    primaryAction = "capture";
    nextAction = source.coverage?.status === "partial"
      ? `继续在原主页手动滚动并点击采集书签；累计 ${source.coverage.collectedCount || 0}/${source.coverage.totalNotes}`
      : "主页总数待确认；先手动滚动到目标范围，再点击采集书签";
  } else if (controlStatus === "due") {
    primaryAction = "run";
    nextAction = watchStatus === "baseline-missing"
      ? "尚未取得有效主页快照；立即刷新公开主页建立监控基线"
      : "源已到期，立即运行一次公开采集";
  } else if (controlStatus === "complete") {
    nextAction = `当前显示总数已覆盖 ${source.coverage.collectedCount}/${source.coverage.totalNotes}；后续按档期增量采集`;
  } else if (controlStatus === "monitoring") {
    nextAction = watchStatus === "current"
      ? `账号监控已同步；今日 ${Number(accountWatch?.todayNewCount || 0)} 条新预览，${Number(accountWatch?.itemCount || 0)} 条可见；下次 ${source.nextRunAt || "待排程"}`
      : automatic
      ? `下次自动检查：${source.nextRunAt || "待排程"}`
      : "已登记，按需运行";
  } else if (controlStatus === "on-demand") {
    primaryAction = "run";
    nextAction = "按需源不会自动运行；需要时手动检查";
  } else if (controlStatus === "research") {
    primaryAction = "open";
    nextAction = "仅研究源不进入自动采集，保留人工研究记录";
  } else if (controlStatus === "disabled") {
    nextAction = "账号已停用；需要时先修改启用状态";
  }

  return {
    sourceId: source.id,
    platform: source.platform,
    name: source.name || source.account || source.url,
    collectionMethod: source.collectionMethod,
    automatic,
    scheduled,
    controlStatus,
    primaryAction,
    nextAction,
    coverage: source.coverage || null,
    nextRunAt: source.nextRunAt || "",
    failureCount: Number(source.failureCount || 0),
    error: source.lastCollectionError || latestRun?.failureReason || "",
    accountWatch: accountWatchEnabled ? accountWatch || null : null,
    blockedPreviews: accountWatchEnabled && accountWatch?.items?.length
      ? accountWatch.items
          .filter((item) => item.previewOnly)
          .map((item) => ({
            title: item.title,
            description: item.description,
            engagement: item.engagement,
            publishedAt: item.publishedAt,
            coverUrl: item.coverUrl,
            reason: item.reason || "note-id-unavailable",
            isNew: item.isNew,
            firstSeenAt: item.firstSeenAt,
            lastSeenAt: item.lastSeenAt
          }))
          .slice(0, 50)
      : latestBlockedPreviewsForSource(state, source.id),
    lastRun: latestRun ? {
      id: latestRun.id,
      status: latestRun.status,
      trigger: latestRun.trigger,
      startedAt: latestRun.startedAt,
      finishedAt: latestRun.finishedAt,
      found: latestRun.found || 0,
      created: latestRun.created || 0,
      duplicates: latestRun.duplicates || 0,
      blocked: latestRun.blocked || 0,
      failed: latestRun.failed || 0,
      failureReason: latestRun.failureReason || "",
      nextAction: latestRun.nextAction || "",
      envelope: collectionEnvelopeFromRun(latestRun)
    } : null
  };
}

function commandCenterRuntime(state, timestamp = Date.now()) {
  const order = {
    running: 0,
    manual: 1,
    backfill: 2,
    due: 3,
    failed: 4,
    cooldown: 5,
    complete: 6,
    monitoring: 7,
    "on-demand": 8,
    research: 9,
    disabled: 10
  };
  const accountWatch = buildAccountWatchRuntime(state, { now: new Date(timestamp) });
  const records = (state.sources || [])
    .map((source) => sourceControlRecord(
      state,
      source,
      timestamp,
      accountWatch.bySource[source.id] || null
    ))
    .sort((a, b) => (
      Number(Boolean(b.accountWatch?.todayNewCount))
      - Number(Boolean(a.accountWatch?.todayNewCount))
      || (order[a.controlStatus] ?? 99) - (order[b.controlStatus] ?? 99)
      || String(a.name).localeCompare(String(b.name), "zh-CN")
    ));
  const counts = records.reduce((accumulator, record) => {
    accumulator[record.controlStatus] = (accumulator[record.controlStatus] || 0) + 1;
    return accumulator;
  }, {});
  return {
    generatedAt: new Date(timestamp).toISOString(),
    automationEnabled: automationEnabled(state),
    accountWatch,
    counts,
    records
  };
}

function runtimeState(state) {
  const envDisabled = ["false", "0", "off"].includes(String(process.env.AUTOMATION_ENABLED || "").toLowerCase());
  const commandCenter = commandCenterRuntime(state);
  return {
    automation: {
      effectiveEnabled: automationEnabled(state),
      envDisabled,
      pageEnabled: state.settings.automationEnabled !== false
    },
    browserCapture: browserCaptureRuntime(state),
    commandCenter,
    inbox: inboxFunnelRuntime(state),
    evidencePackages: createEvidenceRuntime(state),
    analysis: analysisRuntime(state),
    knowledgeExport: knowledgeExportRuntime(state),
    morningPipeline: morningPipelineRuntime(state, {
      automationEnabled: automationEnabled(state),
      lastRun: state.morningPipelineRuns?.[0],
      accountWatch: commandCenter.accountWatch
    }),
    platformCapabilities: platformCapabilityRuntime(state)
  };
}

function automationTier(signal = {}) {
  if (signal.relativeMultiple === null || signal.relativeMultiple === undefined) return "needs-review";
  if (signal.relativeMultiple >= 3) return "high-potential";
  if (signal.relativeMultiple >= 1.5) return "worth-watching";
  return "normal";
}

function corsHeaders(request) {
  const origin = request.headers?.origin || "";
  if (!origin || !isLocalOrigin(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-allow-private-network": "true",
    "access-control-max-age": "86400",
    vary: "origin"
  };
}

function browserCaptureCorsHeaders(request) {
  if (requestOrigin(request) !== "https://www.xiaohongshu.com") return corsHeaders(request);
  return {
    "access-control-allow-origin": "https://www.xiaohongshu.com",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type, x-capture-token",
    "access-control-allow-private-network": "true",
    "access-control-max-age": "86400",
    vary: "origin"
  };
}

function sendJson(response, status, payload, request = null, headers = null) {
  const body = JSON.stringify(payload, null, 2);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...(headers || (request ? corsHeaders(request) : {}))
  });
  response.end(body);
}

async function servePlatformCover(request, response) {
  try {
    const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
    const sourceUrl = requestUrl.searchParams.get("url") || "";
    const media = await platformMediaCache.get(sourceUrl);
    response.writeHead(200, {
      "content-type": media.contentType,
      "content-length": String(media.content.length),
      "cache-control": "private, max-age=604800, immutable",
      "x-content-type-options": "nosniff",
      "x-cover-cache": media.cache,
      ...corsHeaders(request)
    });
    return response.end(request.method === "HEAD" ? undefined : media.content);
  } catch (error) {
    return sendJson(
      response,
      Number(error.status) || 502,
      { ok: false, error: error.message || "cover unavailable" },
      request
    );
  }
}

class RequestBodyError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

async function readBody(request) {
  const chunks = [];
  const declaredLength = Number(request.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > maxRequestBodyBytes) {
    throw new RequestBodyError(`request body exceeds ${maxRequestBodyBytes} bytes`, 413);
  }
  let received = 0;
  for await (const chunk of request) {
    received += chunk.length;
    if (received > maxRequestBodyBytes) {
      chunks.length = 0;
      continue;
    }
    chunks.push(chunk);
  }
  if (received > maxRequestBodyBytes) {
    throw new RequestBodyError(`request body exceeds ${maxRequestBodyBytes} bytes`, 413);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RequestBodyError("request body must be valid JSON");
  }
}

function identityKeys(type, record = {}) {
  if (type === "sources") return [normalizeUrl(record.url) || record.id].filter(Boolean);
  if (type === "signals") return signalIdentityKeys(record);
  if (type === "materials") {
    const key = `${canonicalSignalUrl(record.sourceUrl) || ""}||${String(record.excerpt || "").replace(/\s+/g, " ").trim()}`;
    return [key].filter(Boolean);
  }
  if (type === "topics") return [(record.title || "").trim().toLowerCase()].filter(Boolean);
  if (type === "publications" && record.topicId && record.platform) {
    return [`publication:${record.topicId}:${record.platform}`];
  }
  return [record.id].filter(Boolean);
}

const protectedImportFields = {
  signals: ["note"],
  sources: ["keepReason"],
  materials: ["whyValuable", "possibleUse", "citationNote"],
  topics: ["coreIdea", "targetReader", "minimalPublishableVersion"],
  publications: ["status", "url", "publishedAt", "failureReason", "nextAction"]
};

function importRecords(state, type, records = []) {
  const existing = state[type] || [];
  const recordIndex = new Map(existing.map((record) => [record.id, record]));
  const keyIndex = new Map();
  for (const record of [...recordIndex.values()]) {
    for (const key of identityKeys(type, record)) {
      if (!keyIndex.has(key)) keyIndex.set(key, record.id);
    }
  }
  let added = 0;
  let merged = 0;
  for (const incoming of records) {
    if (!incoming || typeof incoming !== "object") continue;
    const incomingKeys = identityKeys(type, incoming).filter(Boolean);
    const matchedKey = incomingKeys.find((key) => keyIndex.has(key));
    const patch = Object.fromEntries(
      Object.entries(incoming).filter(([, value]) => value !== undefined && value !== null && value !== "")
    );
    if (matchedKey) {
      const currentId = keyIndex.get(matchedKey);
      const current = recordIndex.get(currentId);
      const mergedRecord = {
        ...current,
        ...patch,
        id: current.id,
        createdAt: current.createdAt || incoming.createdAt || now(),
        updatedAt: now()
      };
      if (type === "signals") {
        mergedRecord.seen = current.seen === true ? true : mergedRecord.seen;
        if (current.disposition && current.disposition !== "inbox") mergedRecord.disposition = current.disposition;
      }
      if (type === "materials" && Array.isArray(current.topicIds)) {
        const incomingTopicIds = Array.isArray(incoming.topicIds) ? incoming.topicIds : [];
        mergedRecord.topicIds = [...new Set([...current.topicIds, ...incomingTopicIds])];
      }
      if (type === "topics") {
        // Re-imports enrich context, but cannot roll back a manually advanced production lifecycle.
        mergedRecord.stage = current.stage;
        if (current.productionChecks) mergedRecord.productionChecks = current.productionChecks;
        if (current.gates) mergedRecord.gates = current.gates;
        for (const key of ["sourceSignalIds", "materialIds"]) {
          if (Array.isArray(current[key])) {
            const incomingIds = Array.isArray(incoming[key]) ? incoming[key] : [];
            mergedRecord[key] = [...new Set([...current[key], ...incomingIds])];
          }
        }
      }
      for (const field of protectedImportFields[type] || []) {
        if (current[field] !== undefined && current[field] !== null && current[field] !== "") {
          mergedRecord[field] = current[field];
        }
      }
      recordIndex.set(current.id, mergedRecord);
      for (const key of identityKeys(type, mergedRecord)) keyIndex.set(key, current.id);
      merged += 1;
    } else {
      const incomingId = incoming.id || "";
      if (incomingId && recordIndex.has(incomingId)) {
        // Template IDs may collide while their URL/title identities differ; never replace an existing record.
        incoming.id = "";
      }
      const record = {
        ...incoming,
        id: incoming.id || id(type.replace(/s$/, "").replace("-", "-")),
        createdAt: incoming.createdAt || now(),
        updatedAt: now()
      };
      if (type === "topics") {
        record.stage = "topic";
        record.productionChecks = {
          coreIdea: false, targetReader: false, hook: false, outline: false,
          evidence: false, visuals: false, publishPackage: false
        };
        record.gates = { evidence: false, opening: false, sample: false, final: false };
      }
      recordIndex.set(record.id, record);
      for (const key of identityKeys(type, record)) keyIndex.set(key, record.id);
      added += 1;
    }
  }
  state[type] = [...recordIndex.values()];
  return { added, merged };
}

function normalizedTitle(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function normalizedDate(value = "") {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : String(value || "").trim();
}

function platformContentId(platform = "", value = "") {
  const url = String(value || "");
  const patterns = {
    xiaohongshu: /\/(?:explore|discovery\/item)\/([A-Za-z0-9_-]+)|\/user\/profile\/[A-Za-z0-9_-]+\/([A-Za-z0-9_-]+)/,
    x: /\/status(?:es)?\/(\d+)/,
    douyin: /\/video\/(\d+)/,
    bilibili: /\/video\/(BV[A-Za-z0-9]+)|(?:^|\/)av(\d+)/i,
    wechat: /\/s\/([A-Za-z0-9_-]+)/
  };
  const pattern = patterns[platform];
  if (!pattern) return "";
  const match = url.match(pattern);
  return match?.[1] || match?.[2] || "";
}

function signalIdentityKeys(record = {}) {
  const url = canonicalSignalUrl(record.url);
  const platform = String(record.platform || platformFromUrl(url || record.url)).trim().toLowerCase() || "other";
  const contentId = platformContentId(platform, url || record.url || "");
  const title = normalizedTitle(record.title);
  const author = normalizedTitle(record.author);
  const publishedAt = normalizedDate(record.publishedAt);
  const keys = [];
  if (url) keys.push(`url:${url}`);
  if (contentId) keys.push(`content:${platform}:${contentId}`);
  if (title && author) keys.push(`title-author:${platform}:${author}:${title}`);
  if (title && publishedAt) keys.push(`title-date:${platform}:${title}:${publishedAt}`);
  return keys;
}

function hasSignal(state, candidate) {
  const keys = new Set(signalIdentityKeys(candidate));
  return (state.signals || []).some((signal) => signalIdentityKeys(signal).some((key) => keys.has(key)));
}

function parseCount(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const match = String(value ?? "").trim().match(/^([\d,.]+)\s*(万|亿|[kK])?\+?$/);
  if (!match) return null;
  const base = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(base)) return null;
  const multiplier = match[2] === "亿" ? 100000000 : match[2] === "万" ? 10000 : match[2] ? 1000 : 1;
  return Math.round(base * multiplier);
}

function normalizeUrl(value) {
  try {
    const url = new URL(String(value).trim());
    // Preserve SPA/content fragments such as #/posts/:id; they can be part of the content identity.
    return url.toString();
  } catch {
    return "";
  }
}

function canonicalSignalUrl(value) {
  const normalized = normalizeUrl(value);
  if (!normalized) return "";
  const url = new URL(normalized);
  const canonicalParams = new URLSearchParams();
  for (const key of [...url.searchParams.keys()].sort()) {
    if (/^(utm_|ref$|spm$)/i.test(key)) continue;
    for (const paramValue of url.searchParams.getAll(key)) {
      canonicalParams.append(key, paramValue);
    }
  }
  const query = canonicalParams.toString();
  url.search = query ? `?${query}` : "";
  return url.toString();
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
  return Number(value.toFixed(2));
}

function refreshEngagementMetrics(state) {
  const groups = new Map();
  for (const signal of state.signals || []) {
    const engagement = parseCount(signal.engagement);
    if (engagement !== null) signal.engagement = engagement;
    if (!signal.sourceId) continue;
    if (!groups.has(signal.sourceId)) groups.set(signal.sourceId, []);
    groups.get(signal.sourceId).push(signal);
  }

  for (const [sourceId, signals] of groups) {
    const source = (state.sources || []).find((item) => item.id === sourceId);
    if (!source) continue;
    const previousSampleCount = Number(source.engagementSampleCount || 0);
    const previousMedian = Number.isFinite(source.authorMedianEngagement)
      ? Number(source.authorMedianEngagement)
      : null;
    const samples = signals
      .map((signal) => signal.engagement)
      .filter((value) => Number.isFinite(value) && value > 0);
    source.engagementSampleCount = samples.length;

    let authorMedian = samples.length >= 3 ? median(samples) : null;
    if (authorMedian === null && Number.isFinite(source.authorMedianEngagement) && source.authorMedianEngagement > 0) {
      authorMedian = source.authorMedianEngagement;
    }
    const metricsChanged = previousSampleCount !== samples.length || previousMedian !== authorMedian;
    if (authorMedian === null) {
      source.authorMedianEngagement = null;
      source.engagementSampleUpdatedAt = "";
      for (const signal of signals) {
        signal.authorMedianEngagement = null;
        signal.relativeMultiple = null;
      }
      continue;
    }

    source.authorMedianEngagement = authorMedian;
    source.engagementSampleUpdatedAt = metricsChanged && samples.length >= 3 ? now() : source.engagementSampleUpdatedAt || "";
    for (const signal of signals) {
      signal.authorMedianEngagement = authorMedian;
      signal.relativeMultiple = Number.isFinite(signal.engagement)
        ? Number((signal.engagement / authorMedian).toFixed(2))
        : null;
      signal.automationTier = automationTier(signal);
    }
  }
}

function signalPriority(signal = {}) {
  const multiple = Number(signal.relativeMultiple);
  const engagement = Number(signal.engagement);
  const time = Math.max(
    new Date(signal.publishedAt || 0).getTime() || 0,
    new Date(signal.capturedAt || 0).getTime() || 0
  );
  return [
    Number.isFinite(multiple) ? multiple : -1,
    Number.isFinite(engagement) ? engagement : -1,
    time
  ];
}

function compareSignals(left, right) {
  const leftPriority = signalPriority(left);
  const rightPriority = signalPriority(right);
  for (let index = 0; index < leftPriority.length; index += 1) {
    if (leftPriority[index] !== rightPriority[index]) return rightPriority[index] - leftPriority[index];
  }
  return String(left.title || "").localeCompare(String(right.title || ""), "zh-CN");
}

function buildMorningBrief(state) {
  const timestamp = new Date();
  const pending = (state.signals || []).filter((signal) => signal.disposition === "inbox");
  const topSignals = [...pending].sort(compareSignals).slice(0, 5);
  const manualSources = (state.sources || []).filter((source) => isManualCollectionCandidate(source));
  const retryingSources = (state.sources || []).filter((source) => (
    isAutomaticCollectionCandidate(source)
    && source.automationStatus === "retrying"
  ));
  const nextActions = [];

  if (topSignals.length) nextActions.push(`先看 ${Math.min(topSignals.length, 3)} 条优先信号`);
  if (manualSources.length) nextActions.push(`处理 ${manualSources.length} 个待人工账号`);
  if (retryingSources.length) nextActions.push(`复核 ${retryingSources.length} 个失败重试账号`);
  if (!nextActions.length) nextActions.push("采集链路稳定，直接进入生产块");

  return {
    id: `brief-${localDateKey(timestamp)}`,
    date: localDateKey(timestamp),
    generatedAt: timestamp.toISOString(),
    inboxCount: pending.length,
    highPotentialCount: pending.filter((signal) => signal.automationTier === "high-potential").length,
    worthWatchingCount: pending.filter((signal) => signal.automationTier === "worth-watching").length,
    manualActionCount: manualSources.length,
    retryingCount: retryingSources.length,
    topicCount: (state.topics || []).filter((topic) => !["published", "reviewed"].includes(topic.stage)).length,
    topSignalIds: topSignals.map((signal) => signal.id),
    nextActions
  };
}

function refreshMorningBrief(state) {
  if (state.settings.morningBriefEnabled === false) return false;
  const timestamp = new Date();
  const [hours, minutes] = String(state.settings.inboxTime || "09:00").split(":").map(Number);
  if (localMinuteOfDay(timestamp) < (hours || 0) * 60 + (minutes || 0)) return false;

  const briefs = state.morningBriefs || [];
  const brief = buildMorningBrief(state);
  const index = briefs.findIndex((item) => item.date === brief.date);
  if (index >= 0) {
    const current = briefs[index];
    const unchanged = JSON.stringify({ ...current, generatedAt: "" }) === JSON.stringify({ ...brief, generatedAt: "" });
    if (unchanged) return false;
    briefs[index] = brief;
  } else {
    briefs.unshift(brief);
  }
  state.morningBriefs = briefs.slice(0, 30);
  return true;
}

function parseFeed(xml) {
  const decode = (value = "") => value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

  const itemBlocks = [
    ...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi),
    ...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)
  ].map((match) => match[0]);

  const pick = (block, tag) => {
    const match = block.match(new RegExp(`<(?:[^:>:]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[^:>:]+:)?${tag}>`, "i"));
    return match ? decode(match[1]) : "";
  };

  return itemBlocks.map((block) => {
    const link = pick(block, "link") || (block.match(/<link\b[^>]*href=["']([^"']+)["']/i)?.[1] || "");
    const contentText = pick(block, "content:encoded") || pick(block, "description") || pick(block, "summary");
    return {
      title: pick(block, "title"),
      link,
      publishedAt: pick(block, "pubDate") || pick(block, "published") || pick(block, "updated"),
      contentText,
      dataPointCandidates: extractDataPointCandidates([contentText])
    };
  }).filter((item) => item.link);
}

function decodeHtmlText(value = "") {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function htmlAttribute(tag = "", name = "") {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return decodeHtmlText(match?.[2] || match?.[3] || match?.[4] || "");
}

function htmlTagText(html, tag) {
  return decodeHtmlText(html.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1] || "");
}

function readableHtmlText(fragment = "") {
  const withoutInactiveBlocks = String(fragment || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg|iframe|nav|header|footer|aside|form)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  const text = decodeHtmlText(
    withoutInactiveBlocks
      .replace(/<br\b[^>]*>/gi, "\n")
      .replace(/<\/(?:p|div|section|article|li|h[1-6]|blockquote|figcaption)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  );
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, 100000);
}

function extractArticleText(html) {
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] || html;
  const blocks = [
    ...body.matchAll(/<article\b[^>]*>[\s\S]*?<\/article>/gi),
    ...body.matchAll(/<main\b[^>]*>[\s\S]*?<\/main>/gi)
  ].map((match) => readableHtmlText(match[0]));
  const preferred = blocks.filter((text) => text.length >= 120).sort((a, b) => b.length - a.length)[0];
  const pageText = readableHtmlText(body);
  return preferred && preferred.length >= 120 ? preferred : pageText;
}

function addImageDescription(images, url, description) {
  const imageUrl = normalizeUrl(url);
  const text = decodeHtmlText(String(description || "")).replace(/\s+/g, " ").trim();
  if (!imageUrl || text.length < 2 || text.length > 300 || /^(?:image|photo|img|picture|logo|icon)$/i.test(text)) return;
  const key = `${imageUrl}||${text.toLowerCase()}`;
  if (images.has(key)) return;
  images.set(key, { url: imageUrl, description: text });
}

function extractImageDescriptions(html, pageUrl, meta = new Map()) {
  const images = new Map();
  addImageDescription(images, absoluteUrl(meta.get("og:image") || meta.get("twitter:image"), pageUrl), meta.get("og:image:alt") || meta.get("twitter:image:alt"));

  for (const figure of html.match(/<figure\b[^>]*>[\s\S]*?<\/figure>/gi) || []) {
    const imageTag = figure.match(/<img\b[^>]*>/i)?.[0] || "";
    const imageUrl = absoluteUrl(htmlAttribute(imageTag, "src") || htmlAttribute(imageTag, "data-src"), pageUrl);
    const caption = figure.match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i)?.[1] || "";
    addImageDescription(images, imageUrl, readableHtmlText(caption));
  }

  for (const tag of html.match(/<img\b[^>]*>/gi) || []) {
    const imageUrl = absoluteUrl(htmlAttribute(tag, "src") || htmlAttribute(tag, "data-src"), pageUrl);
    const description = htmlAttribute(tag, "alt") || htmlAttribute(tag, "title") || htmlAttribute(tag, "aria-label");
    addImageDescription(images, imageUrl, description);
  }
  return [...images.values()].slice(0, 20);
}

function extractDataPointCandidates(texts = []) {
  const candidates = new Map();
  const strongNumber = /(?:\d+(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)\s*(?:%|％|pp|个百分点|万|亿|千元|万元|亿元|美元|元|倍|[xX])/;
  const dataWord = /(增长|下降|上涨|下跌|同比|环比|超过|达到|平均|约|占比|渗透率|收入|利润|用户|流量|成本|毛利|市场规模|中位数)/;
  for (const source of texts) {
    const text = String(source || "").trim();
    if (!text) continue;
    for (const sentence of text.match(/[^\n。！？!?；;]+[。！？!?；;]?/g) || []) {
      const value = sentence.replace(/\s+/g, " ").trim();
      const isCandidate = (strongNumber.test(value) && value.length <= 400) || (dataWord.test(value) && /\d/.test(value) && value.length <= 400);
      if (!isCandidate) continue;
      const key = value.toLowerCase();
      if (!candidates.has(key)) candidates.set(key, value);
      if (candidates.size >= 30) return [...candidates.values()];
    }
  }
  return [...candidates.values()];
}

function collectJsonLdArticles(html) {
  const blocks = html.match(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  const articles = [];
  const visit = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== "object") return;
    const type = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]].filter(Boolean);
    if (type.some((item) => String(item).toLowerCase().includes("article"))) {
      articles.push(value);
    }
    Object.values(value).forEach(visit);
  };

  for (const block of blocks) {
    try {
      visit(JSON.parse(block.replace(/^<script\b[^>]*>/i, "").replace(/<\/script>$/i, "")));
    } catch {
      // A malformed third-party structured-data block does not invalidate the whole page.
    }
  }
  return articles;
}

function absoluteUrl(value, baseUrl) {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return "";
  }
}

function parsePublicPage(html, pageUrl) {
  const meta = new Map();
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const name = htmlAttribute(tag, "property") || htmlAttribute(tag, "name");
    const content = htmlAttribute(tag, "content");
    if (name && content && !meta.has(name)) meta.set(name, content);
  }
  const canonicalTag = (html.match(/<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*>/i) || [])[0] || "";
  const canonicalUrl = canonicalTag ? absoluteUrl(htmlAttribute(canonicalTag, "href"), pageUrl) : pageUrl;
  const title = meta.get("og:title") || meta.get("twitter:title") || htmlTagText(html, "title");
  const article = collectJsonLdArticles(html)[0] || {};
  const jsonLdAuthor = Array.isArray(article.author) ? article.author[0] : article.author;
  const author = meta.get("author")
    || meta.get("article:author")
    || (typeof jsonLdAuthor === "string" ? jsonLdAuthor : jsonLdAuthor?.name)
    || "";
  const publishedAt = meta.get("article:published_time") || meta.get("date") || article.datePublished || "";
  const pageType = String(meta.get("og:type") || "").toLowerCase();
  const contentText = readableHtmlText(article.articleBody || "") || extractArticleText(html);
  const description = meta.get("description") || meta.get("og:description") || "";
  const imageDescriptions = extractImageDescriptions(html, pageUrl, meta);
  const dataPointCandidates = extractDataPointCandidates([article.articleBody, contentText, description]);

  if (title && (pageType.includes("article") || publishedAt || article["@type"])) {
    return [{
      title,
      url: absoluteUrl(meta.get("og:url") || canonicalUrl, pageUrl),
      author,
      publishedAt,
      description,
      contentText,
      imageDescriptions,
      dataPointCandidates
    }];
  }

  let host = "";
  try {
    host = new URL(pageUrl).hostname;
  } catch {
    host = "";
  }
  const links = new Map();
  for (const tag of html.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) || []) {
    const href = absoluteUrl(htmlAttribute(tag, "href"), pageUrl);
    const text = decodeHtmlText(tag.replace(/<[^>]+>/g, " "));
    if (!href || !text || text.length < 4) continue;
    let linkHost = "";
    try {
      linkHost = new URL(href).hostname;
    } catch {
      linkHost = "";
    }
    if (host && linkHost && linkHost !== host) continue;
    if (/\?(utm_|ref|spm)/i.test(href) || /\/(login|signup|about|contact)(\/|$)/i.test(href)) continue;
    const key = canonicalSignalUrl(href);
    if (key && !links.has(key)) links.set(key, { title: text, url: href, author: "", publishedAt: "", description: "" });
  }
  return [...links.values()].slice(0, 100);
}

async function runCollection(state, sourceId, trigger = "manual") {
  const source = state.sources.find((item) => item.id === sourceId);
  if (!source) throw new Error("source not found");
  const scheduledRun = trigger === "automatic" || trigger === "force";

  const run = {
    id: id("run"),
    sourceId: source.id,
    status: "running",
    trigger,
    startedAt: now(),
    finishedAt: "",
    found: 0,
    created: 0,
    failureReason: "",
    nextAction: ""
  };
  finalizeCollectionRun(run);
  state.collectionRuns.unshift(run);
  source.automationStatus = isScheduledSource(source)
    ? (isAutomaticCollectionCandidate(source) ? "running" : "manual-required")
    : "on-demand";

  try {
    if (source.collectionMethod === "public-rss") {
      const response = await fetch(source.url, {
        headers: { "user-agent": "PersonalContentWorkbench/0.1 single-user" },
        redirect: "follow",
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const xml = await response.text();
      if (!/<(?:rss|feed|rdf:rdf)\b/i.test(xml)) {
        throw new Error("响应不是有效的 RSS / Atom feed（可能是 HTML、登录页或挑战页）");
      }
      state.rawSnapshots.unshift({
        id: id("snapshot"),
        runId: run.id,
        sourceId: source.id,
        url: source.url,
        capturedAt: now(),
        format: "rss",
        content: xml.slice(0, 500000)
      });
      const items = parseFeed(xml);
      run.found = items.length;
      run.duplicates = 0;
      for (const item of items) {
        const candidate = {
          platform: source.platform,
          author: source.account || source.name,
          title: item.title,
          url: item.link,
          publishedAt: item.publishedAt,
          contentText: item.contentText || "",
          dataPointCandidates: item.dataPointCandidates || []
        };
        if (hasSignal(state, candidate)) {
          run.duplicates += 1;
          continue;
        }
        state.signals.unshift({
          id: id("signal"),
          sourceId: source.id,
          collectionRunId: run.id,
          platform: source.platform,
          author: source.account || source.name,
          url: item.link,
          title: item.title,
          publishedAt: item.publishedAt,
          capturedAt: now(),
          engagement: null,
          authorMedianEngagement: source.authorMedianEngagement ?? null,
          relativeMultiple: null,
          seen: false,
          disposition: "inbox",
          note: "RSS 采集候选，互动数据待确认",
          contentText: item.contentText || "",
          imageDescriptions: [],
          dataPointCandidates: item.dataPointCandidates || [],
          createdAt: now(),
          updatedAt: now()
        });
        run.created += 1;
      }
      run.status = run.created > 0 ? "ok" : "ok-no-new";
      run.nextAction = run.created > 0 ? "到 Inbox 分流" : "无新内容，保持监控";
    } else if (source.collectionMethod === "public-page") {
      const response = await fetch(source.url, {
        headers: { "user-agent": "PersonalContentWorkbench/0.1 single-user" },
        redirect: "follow",
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      state.rawSnapshots.unshift({
        id: id("snapshot"),
        runId: run.id,
        sourceId: source.id,
        url: source.url,
        capturedAt: now(),
        format: "html",
        content: html.slice(0, 500000)
      });
      const items = parsePublicPage(html, response.url || source.url);
      run.found = items.length;
      run.duplicates = 0;
      for (const item of items) {
        const candidate = {
          platform: source.platform,
          author: item.author || source.account || source.name,
          title: item.title,
          url: item.url,
          publishedAt: item.publishedAt,
          contentText: item.contentText || "",
          imageDescriptions: item.imageDescriptions || [],
          dataPointCandidates: item.dataPointCandidates || []
        };
        if (hasSignal(state, candidate)) {
          run.duplicates += 1;
          continue;
        }
        state.signals.unshift({
          id: id("signal"),
          sourceId: source.id,
          collectionRunId: run.id,
          ...candidate,
          capturedAt: now(),
          engagement: null,
          authorMedianEngagement: source.authorMedianEngagement ?? null,
          relativeMultiple: null,
          automationTier: "needs-review",
          seen: false,
          disposition: "inbox",
          note: item.description || "公开页面自动解析",
          contentText: item.contentText || "",
          imageDescriptions: item.imageDescriptions || [],
          dataPointCandidates: item.dataPointCandidates || [],
          createdAt: now(),
          updatedAt: now()
        });
        run.created += 1;
      }
      run.status = run.created > 0 ? "ok" : "ok-no-new";
      run.nextAction = run.created > 0 ? "到 Inbox 分流" : "页面无新增信号，原始快照已保留";
    } else if (source.collectionMethod === "bilibili-public") {
      const collected = await collectBilibiliPublic(source.url);
      run.found = collected.items.length;
      run.duplicates = 0;
      run.adapter = {
        id: "bilibili-public",
        executableAvailable: collected.executableAvailable === true,
        subtitleCount: collected.subtitleCount || 0
      };
      state.rawSnapshots.unshift({
        id: id("snapshot"),
        runId: run.id,
        sourceId: source.id,
        url: source.url,
        capturedAt: now(),
        format: "bilibili-public-metadata",
        context: {
          status: collected.status,
          itemCount: collected.items.length,
          subtitleCount: collected.subtitleCount || 0,
          mediaDownloaded: false,
          credentialsIncluded: false
        },
        content: JSON.stringify(collected.items, null, 2).slice(0, 500000)
      });

      if (collected.status === "blocked") {
        run.status = "blocked";
        run.failureReason = collected.reason;
        run.humanAction = collected.humanAction;
        run.nextAction = collected.nextAction;
      } else if (collected.status === "failed") {
        run.status = "failed";
        run.failureReason = collected.reason;
        run.humanAction = collected.humanAction;
        run.nextAction = collected.nextAction;
      } else {
        for (const item of collected.items) {
          const candidate = {
            platform: "bilibili",
            author: item.author || source.account || source.name,
            title: item.title,
            url: item.url,
            publishedAt: item.publishedAt,
            contentText: item.description || ""
          };
          if (hasSignal(state, candidate)) {
            run.duplicates += 1;
            continue;
          }
          const transcript = item.transcriptStatus === "captured" && item.transcriptText
            ? {
                transcriptText: item.transcriptText,
                transcriptStatus: "captured",
                transcriptSource: item.transcriptSource,
                transcriptModel: item.transcriptModel,
                transcriptSegments: item.transcriptSegments,
                transcriptDurationSeconds: item.transcriptDurationSeconds,
                transcriptCapturedAt: item.transcriptCapturedAt,
                transcriptNote: item.transcriptNote,
                evidenceState: "unverified"
              }
            : {
                transcriptText: "",
                transcriptStatus: "missing",
                transcriptSource: "",
                transcriptNote: "B 站公开字幕轨不可用；未把简介冒充逐字稿。"
              };
          state.signals.unshift({
            id: id("signal"),
            sourceId: source.id,
            collectionRunId: run.id,
            platform: "bilibili",
            author: item.author || source.account || source.name,
            authorId: item.authorId || "",
            sourceProfileUrl: item.sourceProfileUrl || "",
            url: item.url,
            title: item.title,
            publishedAt: item.publishedAt,
            capturedAt: now(),
            engagement: null,
            authorMedianEngagement: source.authorMedianEngagement ?? null,
            relativeMultiple: null,
            automationTier: "needs-review",
            seen: false,
            disposition: "inbox",
            note: "B 站公开元数据；字幕和简介均不自动视为已验证",
            contentText: item.description || "",
            coverUrl: item.coverUrl || "",
            mediaItems: item.mediaItems || [],
            imageDescriptions: mediaDescriptions(item.mediaItems || [], []),
            dataPointCandidates: extractDataPointCandidates([item.description || ""]),
            ...transcript,
            extraction: {
              adapter: "bilibili-public",
              mediaDownloaded: false,
              credentialsIncluded: false
            },
            createdAt: now(),
            updatedAt: now()
          });
          run.created += 1;
        }
        run.status = run.created > 0 ? "ok" : "ok-no-new";
        run.nextAction = run.created > 0 ? "到 Inbox 分流" : "公开页面无新增内容";
      }
    } else {
      run.status = "blocked";
      run.failureReason = `${source.collectionMethod} 需要人工动作或专用 adapter`;
      run.nextAction = source.collectionMethod === "manual"
        ? "用快速收集或 JSON 导入"
        : "导出文件后导入，或补充浏览器辅助 adapter";
    }
  } catch (error) {
    run.status = "failed";
    run.failureReason = error.message;
    run.nextAction = "检查链接、平台限制或改用浏览器辅助导入";
  } finally {
    run.finishedAt = now();
    source.lastRunStatus = run.status;
    source.lastRunAt = run.finishedAt;
    source.lastRunTrigger = trigger;
    source.lastCollectionError = run.status === "failed" ? run.failureReason : "";

    if (scheduledRun && isScheduledSource(source)) {
      const finishedAt = new Date(run.finishedAt);
      if (run.status === "failed") {
        source.failureCount = Number(source.failureCount || 0) + 1;
        source.nextRunAt = new Date(finishedAt.getTime() + failureDelay(source.failureCount)).toISOString();
        source.automationStatus = "retrying";
      } else {
        source.failureCount = 0;
        source.lastAutomaticRunAt = run.finishedAt;
        source.nextRunAt = nextCollectionRun(source, state.settings.collectionTime, finishedAt);
        source.automationStatus = run.status === "blocked" ? "manual-required" : "scheduled";
      }
    }
    finalizeCollectionRun(run);
  }

  return run;
}

async function collectWithLock(state, sourceId, trigger = "manual") {
  if (runningSourceIds.has(sourceId)) return null;
  runningSourceIds.add(sourceId);
  try {
    return await runCollection(state, sourceId, trigger);
  } finally {
    runningSourceIds.delete(sourceId);
  }
}

async function runAutomationTick(force = false) {
  try {
    const state = await readState();
    if (!automationEnabled(state)) {
      return { ok: true, skipped: true, reason: "automation is disabled" };
    }

    const candidates = state.sources.filter((source) => (
      isAutomaticCollectionCandidate(source)
      && (force || isAutomaticCollectionDue(source))
    ));
    const results = [];
    const runs = [];
    for (const source of candidates) {
      if (runningSourceIds.has(source.id)) {
        results.push({ sourceId: source.id, source: source.name || source.account || source.id, status: "skipped", reason: "already running" });
        continue;
      }

      const run = await collectWithLock(state, source.id, force ? "force" : "automatic");
      if (run) {
        runs.push(run);
        results.push({
          sourceId: source.id,
          source: source.name || source.account || source.id,
          status: run.status,
          found: run.found,
          created: run.created,
          duplicates: run.duplicates,
          blocked: run.blocked,
          failed: run.failed,
          failureReason: run.failureReason,
          nextAction: run.nextAction,
          cursor: run.cursor
        });
      }
    }

    const briefChanged = refreshMorningBrief(state);
    if (results.some((item) => item.status !== "skipped") || briefChanged) {
      refreshEngagementMetrics(state);
      await writeState(state);
    }

    return {
      ok: true,
      ranAt: now(),
      mode: force ? "force" : "scheduled",
      total: results.length,
      okCount: results.filter((item) => String(item.status).startsWith("ok")).length,
      blocked: results.filter((item) => item.status === "blocked").length,
      failed: results.filter((item) => item.status === "failed").length,
      skipped: results.filter((item) => item.status === "skipped").length,
      envelope: aggregateCollectionEnvelopes(runs),
      results
    };
  } finally {
  }
}

function positiveCount(value) {
  const parsed = parseCount(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function importBrowserCapture(state, sourceId, items, blockedItems = [], context = {}, options = {}) {
  const source = state.sources.find((item) => item.id === sourceId);
  if (!source) throw new Error("source not found");
  if (source.collectionMethod !== "browser-assisted") {
    throw new Error("only browser-assisted sources can use browser capture");
  }
  if (!Array.isArray(items)) throw new Error("items must be an array");
  if (!Array.isArray(blockedItems)) throw new Error("blockedItems must be an array");
  if (items.length === 0 && blockedItems.length === 0) {
    throw new Error("items or blockedItems must be a non-empty array");
  }
  if (!context || typeof context !== "object") throw new Error("context must be an object");

  const blockedNotes = blockedItems.map((item) => {
    if (!item || typeof item !== "object") throw new Error("each blocked item must be an object");
    const preview = normalizeBlockedPreview(item);
    if (!preview) throw new Error("each blocked item needs a title or cover URL");
    return preview;
  });

  const existingSignalsByKey = new Map();
  for (const signal of state.signals || []) {
    for (const key of signalIdentityKeys(signal)) existingSignalsByKey.set(key, signal);
  }
  const seen = new Set(existingSignalsByKey.keys());
  const candidates = [];
  const duplicateInputs = new Set();
  let metadataEnriched = 0;
  for (const item of items) {
    if (!item || typeof item !== "object") throw new Error("each item must be an object");
    const url = normalizeUrl(item.url);
    if (!url) throw new Error("each item needs a valid URL");
    const candidate = {
      ...item,
      url,
      platform: source.platform,
      author: item.author || source.account || source.name
    };
    const keys = signalIdentityKeys(candidate);
    const duplicateKey = keys.find((key) => seen.has(key) || duplicateInputs.has(key));
    if (duplicateKey) {
      const existing = keys
        .map((key) => existingSignalsByKey.get(key))
        .find(Boolean);
      if (existing) {
        const description = String(item.contentText ?? item.description ?? "").trim();
        const coverUrl = normalizeUrl(item.coverUrl) || "";
        const mediaItems = Array.isArray(item.mediaItems) ? item.mediaItems : [];
        let enriched = false;
        if (!String(existing.title || "").trim() && String(item.title || "").trim()) {
          existing.title = String(item.title).trim();
          enriched = true;
        }
        if (!String(existing.contentText || "").trim() && description) {
          existing.contentText = description;
          enriched = true;
        }
        if (!String(existing.coverUrl || "").trim() && coverUrl) {
          existing.coverUrl = coverUrl;
          enriched = true;
        }
        if (!Array.isArray(existing.mediaItems) || existing.mediaItems.length === 0) {
          if (mediaItems.length > 0) {
            existing.mediaItems = mediaItems;
            existing.imageDescriptions = mediaDescriptions(mediaItems, []);
            enriched = true;
          }
        }
        if (!String(existing.publishedAt || "").trim() && String(item.publishedAt || "").trim()) {
          existing.publishedAt = item.publishedAt;
          enriched = true;
        }
        if (enriched) {
          existing.updatedAt = now();
          metadataEnriched += 1;
        }
      }
      if (duplicateInputs.has(duplicateKey)) continue;
      for (const key of keys) duplicateInputs.add(key);
      continue;
    }
    for (const key of keys) duplicateInputs.add(key);
    candidates.push(candidate);
  }

  const run = {
    id: id("run"),
    sourceId: source.id,
    trigger: String(options.trigger || "browser-assisted"),
    status: "running",
    startedAt: now(),
    finishedAt: "",
    found: items.length + blockedNotes.length,
    created: 0,
    duplicates: items.length - candidates.length,
    metadataEnriched,
    loadedCount: items.length + blockedNotes.length,
    blockedNoteCount: blockedNotes.length,
    profileNoteCount: positiveCount(context.profileNoteCount),
    profileFollowers: positiveCount(context.profileFollowers),
    profileEngagement: positiveCount(context.profileEngagement),
    failureReason: "",
    nextAction: ""
  };
  finalizeCollectionRun(run);
  state.collectionRuns.unshift(run);
  state.rawSnapshots.unshift({
    id: id("snapshot"),
    runId: run.id,
    sourceId: source.id,
    url: source.url,
    capturedAt: now(),
    format: "browser-assisted",
    context: {
      visibleNoteCount: items.length + blockedNotes.length,
      importableNoteCount: items.length,
      blockedNoteCount: blockedNotes.length,
      profileNoteCount: run.profileNoteCount,
      profileFollowers: run.profileFollowers,
      profileEngagement: run.profileEngagement
    },
    content: JSON.stringify({ items, blockedItems: blockedNotes, context }, null, 2).slice(0, 500000)
  });

  for (const item of candidates) {
    const engagement = parseCount(item.engagement);
    const mediaItems = Array.isArray(item.mediaItems) ? item.mediaItems : [];
    state.signals.unshift({
      id: id("signal"),
      sourceId: source.id,
      collectionRunId: run.id,
      platform: source.platform,
      author: source.account || source.name,
      url: item.url,
      title: String(item.title ?? "").trim(),
      contentText: String(item.contentText ?? item.description ?? "").trim(),
      coverUrl: normalizeUrl(item.coverUrl) || "",
      mediaItems,
      imageDescriptions: mediaDescriptions(mediaItems, []),
      publishedAt: item.publishedAt || "",
      capturedAt: now(),
      engagement,
      authorMedianEngagement: source.authorMedianEngagement ?? null,
      relativeMultiple: engagement !== null && source.authorMedianEngagement
        ? Number((engagement / source.authorMedianEngagement).toFixed(2))
        : null,
      seen: false,
      disposition: "inbox",
      note: "浏览器辅助采集，数据来自人工确认的可见列表",
      createdAt: now(),
      updatedAt: now()
    });
    run.created += 1;
  }

  const collectedCount = (state.signals || []).filter((signal) => signal.sourceId === source.id).length;
  const identityBlocked = blockedNotes.length > 0;
  const coverageStatus = identityBlocked && (!run.profileNoteCount || collectedCount < run.profileNoteCount)
    ? "blocked"
    : !run.profileNoteCount
    ? "unknown"
    : collectedCount >= run.profileNoteCount ? "complete" : "partial";
  const coveragePercent = run.profileNoteCount
    ? Math.min(100, Math.round((collectedCount / run.profileNoteCount) * 100))
    : null;

  run.status = identityBlocked && candidates.length === 0
    ? "blocked"
    : run.created > 0 ? "ok" : "ok-no-new";
  run.finishedAt = now();
  run.collectedCount = collectedCount;
  run.coverageStatus = coverageStatus;
  run.coveragePercent = coveragePercent;
  run.nextAction = coverageStatus === "blocked"
    ? `主页 ${run.loadedCount} 条可见，但 ${blockedNotes.length} 条缺少可打开 noteId；请从 App 分享目标笔记链接后用详情书签补证据`
    : coverageStatus === "complete"
    ? "本页范围已覆盖主页显示笔记数；后续按档期做增量采集"
    : coverageStatus === "partial"
      ? `继续在原主页向下手动滚动，并重复点击采集书签；当前累计 ${collectedCount}/${run.profileNoteCount}`
      : "主页未识别到笔记总数；继续滚动到目标范围后重复采集";
  source.lastRunStatus = run.status;
  source.lastRunAt = run.finishedAt;
  if (run.profileFollowers) source.profileFollowers = run.profileFollowers;
  if (run.profileEngagement) source.profileEngagement = run.profileEngagement;
  source.coverage = {
    totalNotes: run.profileNoteCount,
    collectedCount,
    lastLoadedCount: run.loadedCount,
    status: coverageStatus,
    percent: coveragePercent,
    blockedNoteCount: blockedNotes.length,
    identityStatus: identityBlocked ? "note-id-unavailable" : "available",
    updatedAt: run.finishedAt
  };
  refreshEngagementMetrics(state);
  finalizeCollectionRun(run);
  return run;
}

function accountWatchSourceContext(result = {}) {
  return {
    ...(result.context && typeof result.context === "object" ? result.context : {}),
    checkedAt: result.checkedAt || now(),
    effectiveUrl: result.effectiveUrl || "",
    captureProvider: "playwright-public-profile",
    sourceProfileUrl: result.source?.url || result.context?.sourceProfileUrl || ""
  };
}

function accountWatchNextAction(run, accountWatch) {
  if (run.created > 0) {
    return `已导入 ${run.created} 条可打开笔记；其余 ${accountWatch.previewOnly ? "游客态预览" : "内容"}继续按主页快照监控`;
  }
  if (accountWatch.itemCount > 0) {
    return `主页已刷新，可见 ${accountWatch.itemCount} 条；没有发现新的可导入笔记`;
  }
  return "主页已刷新，没有发现可读取笔记";
}

function persistAccountWatchSuccess(state, source, result, trigger, timestamp) {
  const run = importBrowserCapture(
    state,
    source.id,
    result.items || [],
    result.blockedItems || [],
    accountWatchSourceContext(result),
    { trigger: "account-watch" }
  );
  run.status = run.created > 0 ? "ok" : "ok-no-new";
  run.failureReason = "";
  const accountWatch = accountWatchRuntimeForSource(state, source.id);
  run.nextAction = accountWatchNextAction(run, accountWatch || {});

  source.lastRunStatus = run.status;
  source.lastRunAt = run.finishedAt || timestamp;
  source.lastRunTrigger = trigger;
  source.lastCollectionError = "";
  source.failureCount = 0;
  source.automationStatus = "scheduled";
  if (trigger !== "manual") source.lastAutomaticRunAt = run.finishedAt || timestamp;
  source.nextRunAt = nextAccountWatchRun(source, state.settings.collectionTime, new Date(run.finishedAt || timestamp));
  return run;
}

function persistAccountWatchFailure(state, source, result, trigger, timestamp) {
  const status = result.status === "failed" ? "failed" : "blocked";
  const run = {
    id: id("run"),
    sourceId: source.id,
    trigger: "account-watch",
    status,
    startedAt: result.startedAt || timestamp,
    finishedAt: result.checkedAt || timestamp,
    found: 0,
    created: 0,
    duplicates: 0,
    failureReason: result.failureReason || "账号主页刷新失败",
    nextAction: result.nextAction || "保留上一份有效快照，并等待下一次公开主页刷新",
    challengeCode: result.challengeCode || "",
    effectiveUrl: result.effectiveUrl || ""
  };
  finalizeCollectionRun(run);
  state.collectionRuns.unshift(run);

  source.lastRunStatus = status;
  source.lastRunAt = run.finishedAt;
  source.lastRunTrigger = trigger;
  source.lastCollectionError = run.failureReason;
  source.failureCount = Number(source.failureCount || 0) + 1;
  source.automationStatus = status === "blocked" ? "manual-required" : "retrying";
  if (trigger !== "manual") source.lastAutomaticRunAt = run.finishedAt;
  source.nextRunAt = nextAccountWatchRun(source, state.settings.collectionTime, new Date(run.finishedAt));
  return run;
}

let accountWatchRefreshBusy = false;

async function refreshAccountWatchQueued(options = {}) {
  const sourceId = String(options.sourceId || "").trim();
  const trigger = String(options.trigger || "manual");
  const force = options.force === true;
  const manual = options.manual === true;

  if (accountWatchRefreshBusy) {
    if (manual) throw new Error("账号刷新正在进行，请等待当前批次完成");
    return { ok: true, skipped: true, reason: "account watch refresh is already running" };
  }

  const snapshot = await readState();
  if (!manual && !automationEnabled(snapshot)) {
    return { ok: true, skipped: true, reason: "automation is disabled" };
  }
  const available = (snapshot.sources || []).filter(isAccountWatchSource);
  const selected = available.filter((source) => (
    sourceId ? source.id === sourceId : force || isAccountWatchDue(source)
  ));
  if (sourceId && selected.length === 0) throw new Error("小红书账号主页源不存在");

  const runnable = selected.filter((source) => !runningSourceIds.has(source.id));
  const skipped = selected.length - runnable.length;
  if (runnable.length === 0) {
    return {
      ok: true,
      skipped: true,
      total: selected.length,
      skippedCount: skipped,
      reason: selected.length ? "selected account source is already running" : "no account refresh is due"
    };
  }

  accountWatchRefreshBusy = true;
  for (const source of runnable) runningSourceIds.add(source.id);
  const startedAt = now();
  let refreshResults = [];
  try {
    try {
      refreshResults = await refreshXhsProfileSources(runnable);
    } catch (error) {
      refreshResults = runnable.map((source) => ({
        ok: false,
        status: "failed",
        sourceId: source.id,
        sourceName: source.name || source.account || source.id,
        checkedAt: now(),
        startedAt,
        failureReason: String(error?.message || error || "浏览器启动失败"),
        nextAction: "检查本机 Chrome 与网络后重试；上一份有效快照不会受影响"
      }));
    }
  } finally {
    for (const source of runnable) runningSourceIds.delete(source.id);
    accountWatchRefreshBusy = false;
  }

  return enqueueStateMutation(async () => {
    const state = await readState();
    const persisted = [];
    for (const result of refreshResults) {
      const source = (state.sources || []).find((item) => item.id === result.sourceId);
      if (!source || !isAccountWatchSource(source)) continue;
      const checkedAt = result.checkedAt || now();
      if (result.ok) {
        const run = persistAccountWatchSuccess(
          state,
          source,
          { ...result, startedAt },
          trigger,
          checkedAt
        );
        const accountWatch = accountWatchRuntimeForSource(state, source.id);
        persisted.push({
          ok: true,
          status: run.status,
          sourceId: source.id,
          sourceName: source.name || source.account || source.id,
          created: run.created,
          itemCount: accountWatch?.itemCount || 0,
          todayNewCount: accountWatch?.todayNewCount || 0,
          previewOnly: accountWatch?.previewOnly === true,
          run
        });
      } else {
        const run = persistAccountWatchFailure(
          state,
          source,
          { ...result, startedAt },
          trigger,
          checkedAt
        );
        persisted.push({
          ok: false,
          status: run.status,
          sourceId: source.id,
          sourceName: source.name || source.account || source.id,
          created: 0,
          itemCount: 0,
          todayNewCount: 0,
          failureReason: run.failureReason,
          nextAction: run.nextAction,
          challengeCode: run.challengeCode,
          run
        });
      }
    }
    refreshEngagementMetrics(state);
    await writeState(state);
    const runs = persisted.map((item) => item.run);
    return {
      ok: true,
      ranAt: now(),
      trigger,
      total: selected.length,
      okCount: persisted.filter((item) => String(item.status).startsWith("ok")).length,
      blocked: persisted.filter((item) => item.status === "blocked").length,
      failed: persisted.filter((item) => item.status === "failed").length,
      skipped: skipped,
      created: persisted.reduce((total, item) => total + Number(item.created || 0), 0),
      newPreviewCount: persisted.reduce((total, item) => total + Number(item.todayNewCount || 0), 0),
      envelope: aggregateCollectionEnvelopes(runs),
      results: persisted
    };
  });
}

function importBrowserDetailCapture(state, signalId, sourceId, capture) {
  const signal = (state.signals || []).find((item) => item.id === signalId);
  if (!signal) throw new Error("signal not found");
  if (signal.platform !== "xiaohongshu") throw new Error("detail capture only supports Xiaohongshu signals");
  if (!signal.sourceId || signal.sourceId !== sourceId) throw new Error("capture source does not match signal source");
  const source = (state.sources || []).find((item) => item.id === sourceId);
  if (!source) throw new Error("source not found");
  if (source.collectionMethod !== "browser-assisted") {
    throw new Error("only browser-assisted sources can use browser detail capture");
  }

  const timestamp = now();
  const normalized = normalizeDetailCapture(signal, capture, timestamp);
  const snapshot = {
    id: id("snapshot"),
    sourceId,
    signalId: signal.id,
    url: normalized.capture.captureUrl,
    capturedAt: timestamp,
    format: "browser-detail-assisted",
    context: {
      captureScope: "user-visible-detail-page",
      noteId: normalized.capture.noteId,
      mediaCount: normalized.capture.mediaItems.length,
      transcriptStatus: normalized.capture.transcriptStatus,
      autoScroll: false,
      privateApiCalled: false,
      mediaDownloaded: false
    },
    content: JSON.stringify(normalized.capture, null, 2).slice(0, 500000)
  };
  state.rawSnapshots.unshift(snapshot);

  const existingMediaItems = Array.isArray(signal.mediaItems) ? signal.mediaItems : [];
  const mediaItems = [...existingMediaItems, ...normalized.capture.mediaItems]
    .filter((item, index, items) => item?.url && items.findIndex((other) => other.url === item.url) === index)
    .slice(0, 50);
  const nextContentText = normalized.patch.contentText || signal.contentText || "";
  const successfulDetailCapture = !normalized.capture.extraction.redirectedFromDetailUrl;
  Object.assign(signal, normalized.patch, {
    ...(successfulDetailCapture ? { url: normalized.capture.captureUrl } : {}),
    mediaItems,
    imageDescriptions: mediaDescriptions(mediaItems, signal.imageDescriptions),
    dataPointCandidates: nextContentText
      ? extractDataPointCandidates([nextContentText])
      : (signal.dataPointCandidates || []),
    rawSnapshotId: snapshot.id,
    updatedAt: timestamp
  });
  source.lastDetailCaptureAt = timestamp;
  refreshEngagementMetrics(state);

  const evidencePackage = (state.evidencePackages || []).find((item) => item.signalId === signal.id) || null;
  if (evidencePackage) {
    evidencePackage.verification = {
      state: "unverified",
      checkedAt: "",
      checkedBy: "",
      note: "详情证据已更新，原始证据包需要重建并重新人工核对。"
    };
    evidencePackage.updatedAt = timestamp;
  }
  return {
    signal,
    snapshot,
    evidencePackageId: evidencePackage?.id || "",
    rebuildEvidenceRecommended: Boolean(evidencePackage)
  };
}

function publicCaptureRun(run = {}) {
  return {
    id: run.id,
    status: run.status,
    trigger: run.trigger,
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
    finishedAt: run.finishedAt,
    noteId: run.noteId,
    captureUrl: run.captureUrl,
    captureState: run.captureState,
    reason: run.reason,
    humanAction: run.humanAction,
    signalId: run.signalId,
    created: run.created,
    transcriptStatus: run.transcriptStatus,
    mediaCount: run.mediaCount,
    warnings: run.warnings
  };
}

function xhsCaptureProgressPatch(payload = {}) {
  return {
    status: String(payload.status || "running"),
    captureState: String(payload.captureState || ""),
    noteId: String(payload.noteId || ""),
    captureUrl: normalizeUrl(payload.finalUrl || payload.captureUrl || ""),
    reason: String(payload.reason || "").slice(0, 2000),
    humanAction: String(payload.humanAction || "").slice(0, 2000),
    checkedAt: String(payload.checkedAt || now())
  };
}

async function persistXhsCaptureProgress(runId, payload) {
  await enqueueStateMutation(async () => {
    const state = await readState();
    const run = (state.captureRuns || []).find((item) => item.id === runId);
    if (!run) return;
    const patch = xhsCaptureProgressPatch(payload);
    const changed = ["status", "captureState", "noteId", "captureUrl", "reason", "humanAction"]
      .some((key) => run[key] !== patch[key]);
    if (!changed) return;
    Object.assign(run, patch, {
      updatedAt: now(),
      ...(["captured", "blocked", "failed"].includes(patch.status) ? { finishedAt: now() } : {})
    });
    await writeState(state, { backup: false });
  });
}

function xhsCaptureSignal(state, capture = {}) {
  const noteId = String(capture.noteId || platformContentId("xiaohongshu", capture.captureUrl || ""));
  const canonicalCaptureUrl = canonicalSignalUrl(capture.captureUrl || "");
  return (state.signals || []).find((signal) => {
    if (signal.platform !== "xiaohongshu") return false;
    if (noteId && (signal.noteId === noteId || platformContentId("xiaohongshu", signal.url || "") === noteId)) {
      return true;
    }
    return Boolean(canonicalCaptureUrl && canonicalSignalUrl(signal.url || "") === canonicalCaptureUrl);
  }) || null;
}

function xhsCaptureSource(state, capture = {}) {
  const author = normalizedTitle(capture.author);
  return sourceForUrl(state, capture.sourceProfileUrl || "")
    || sourceForUrl(state, capture.captureUrl || "")
    || (state.sources || []).find((source) => (
      source.platform === "xiaohongshu"
      && author
      && normalizedTitle(source.account || source.name) === author
    ))
    || null;
}

function persistXhsGuestCapture(state, result = {}) {
  const capture = result.capture;
  if (!capture || typeof capture !== "object") throw new Error("guest capture did not return detail evidence");
  const timestamp = now();
  const source = xhsCaptureSource(state, capture);
  let signal = xhsCaptureSignal(state, capture);
  let created = false;

  if (!signal) {
    const noteId = String(capture.noteId || platformContentId("xiaohongshu", capture.captureUrl || ""));
    const base = normalizeDropRecords({
      state,
      signals: [{
        sourceId: source?.id || "",
        platform: "xiaohongshu",
        author: capture.author || source?.account || source?.name || "",
        authorId: capture.authorId || "",
        sourceProfileUrl: capture.sourceProfileUrl || "",
        title: capture.title || `小红书笔记 ${noteId}`,
        url: capture.captureUrl,
        noteId,
        coverUrl: capture.coverUrl || "",
        publishedAt: capture.publishedAt || "",
        engagement: capture.engagement || null,
        note: "小红书游客可见详情采集",
        contentText: capture.bodyText || "",
        captureState: capture.captureState || "captured-public",
        evidenceState: "unverified"
      }],
      materials: []
    });
    if (!base.signals.length) throw new Error("guest capture did not contain a valid Xiaohongshu note");
    const totals = importRecords(state, "signals", base.signals);
    created = totals.added > 0;
    signal = xhsCaptureSignal(state, capture);
  }
  if (!signal) throw new Error("captured Xiaohongshu note could not be merged into signals");

  const normalized = normalizeDetailCapture(signal, capture, timestamp);
  const snapshot = {
    id: id("snapshot"),
    sourceId: source?.id || signal.sourceId || "",
    signalId: signal.id,
    url: normalized.capture.captureUrl,
    capturedAt: timestamp,
    format: "xhs-guest-chrome",
    context: {
      captureScope: "guest-visible-detail-page",
      noteId: normalized.capture.noteId,
      mediaCount: normalized.capture.mediaItems.length,
      transcriptStatus: normalized.capture.transcriptStatus,
      localOnly: true,
      rawPageTextMayContainPrivateState: true,
      privateApiCalled: false,
      mediaDownloaded: false,
      credentialsIncluded: false
    },
    content: JSON.stringify(normalized.capture, null, 2).slice(0, 500000)
  };
  state.rawSnapshots.unshift(snapshot);

  const existingMediaItems = Array.isArray(signal.mediaItems) ? signal.mediaItems : [];
  const mediaItems = [...existingMediaItems, ...normalized.capture.mediaItems]
    .filter((item, index, items) => item?.url && items.findIndex((other) => other.url === item.url) === index)
    .slice(0, 50);
  const nextContentText = normalized.patch.contentText || signal.contentText || "";
  Object.assign(signal, normalized.patch, {
    mediaItems,
    imageDescriptions: mediaDescriptions(mediaItems, signal.imageDescriptions),
    dataPointCandidates: nextContentText
      ? extractDataPointCandidates([nextContentText])
      : (signal.dataPointCandidates || []),
    evidenceState: "unverified",
    rawSnapshotId: snapshot.id,
    updatedAt: timestamp
  });
  if (source) {
    source.lastDetailCaptureAt = timestamp;
    source.lastRunStatus = "ok";
    source.lastRunAt = timestamp;
  }
  refreshEngagementMetrics(state);

  const evidencePackage = (state.evidencePackages || []).find((item) => item.signalId === signal.id) || null;
  if (evidencePackage) {
    evidencePackage.verification = {
      state: "unverified",
      checkedAt: "",
      checkedBy: "",
      note: "小红书详情已更新，原始证据包需要重建并重新人工核对。"
    };
    evidencePackage.updatedAt = timestamp;
  }
  return {
    signal,
    snapshot,
    created,
    transcriptStatus: normalized.capture.transcriptStatus,
    mediaCount: mediaItems.length,
    warnings: normalized.capture.warnings
  };
}

function firstUrlInText(value) {
  const match = String(value || "").match(/https?:\/\/[^\s<>"')，。]+/i);
  return normalizeUrl(match?.[0] || "");
}

function detectSourcePlatform(url) {
  const hostname = new URL(url).hostname.toLowerCase();
  if (hostname.endsWith("xiaohongshu.com") || hostname === "xhslink.cn") return "xiaohongshu";
  if (hostname === "x.com" || hostname === "twitter.com") return "x";
  if (hostname.endsWith("douyin.com")) return "douyin";
  if (hostname.endsWith("bilibili.com") || hostname === "b23.tv") return "bilibili";
  if (hostname.endsWith("qq.com")) return "wechat";
  return "other";
}

function sourceIntakeName(text) {
  return (String(text || "").match(/@([^\s@，。;；]{1,40})/)?.[1] || "").trim();
}

function sourceIntakeCount(text, pattern) {
  const match = String(text || "").match(pattern);
  if (!match) return null;
  return positiveCount(`${match[1]}${match[2] || ""}`);
}

async function importSourceIntake(state, text, options = {}) {
  const rawUrl = options.inputUrl || firstUrlInText(text);
  if (!rawUrl) throw new Error("paste a source URL or platform share text with a URL");
  const url = options.canonicalUrl || await resolveSourceIntakeUrl(rawUrl);
  const platform = detectSourcePlatform(url);
  const name = String(options.name || sourceIntakeName(text) || "").trim();
  const profileFollowers = sourceIntakeCount(text, /([\d,.]+)\s*(万|亿|[kK])?\s*(?:个)?粉丝/);
  const profileNoteCount = sourceIntakeCount(text, /([\d,.]+)\s*(万|亿|[kK])?\s*(?:篇)?笔记/);
  const profileEngagement = sourceIntakeCount(text, /([\d,.]+)\s*(万|亿|[kK])?\s*\+?\s*(?:次)?(?:获)?赞与收藏/);
  const isXhsProfile = platform === "xiaohongshu"
    && /\/user\/profile\/[A-Za-z0-9]+/.test(new URL(url).pathname);
  const isBilibili = platform === "bilibili";

  if (platform === "xiaohongshu" && !isXhsProfile) {
    throw new Error("Xiaohongshu source intake currently expects a blogger profile page");
  }

  const existingSource = (state.sources || []).find((item) => normalizeUrl(item.url) === url);
  const incomingSource = existingSource
    ? { name, platform, account: name, url, profileFollowers, profileEngagement }
    : {
      name,
      platform,
      account: name,
      role: "benchmark",
      url,
      accountWatch: platform === "xiaohongshu" || isBilibili,
      checkFrequency: platform === "xiaohongshu" || isBilibili ? "daily" : "weekly",
      collectionMethod: platform === "xiaohongshu"
        ? "browser-assisted"
        : isBilibili ? "bilibili-public" : "public-page",
      dataBoundary: platform === "xiaohongshu" ? "manual-copy" : "public",
      profileFollowers,
      profileEngagement,
      keepReason: "对标账号快速登记",
      coverage: {
        totalNotes: profileNoteCount,
        collectedCount: 0,
        lastLoadedCount: 0,
        status: profileNoteCount ? "partial" : "unknown",
        percent: profileNoteCount ? 0 : null,
        updatedAt: now()
      }
    };
  const totals = importRecords(state, "sources", [incomingSource]);
  const source = state.sources.find((item) => normalizeUrl(item.url) === url);
  if (existingSource) {
    const previousCoverage = existingSource.coverage || {
      collectedCount: 0,
      lastLoadedCount: 0,
      status: "unknown",
      percent: null
    };
    const totalNotes = Number(profileNoteCount || previousCoverage.totalNotes || 0);
    const collectedCount = Number(previousCoverage.collectedCount || 0);
    source.coverage = {
      ...previousCoverage,
      totalNotes,
      collectedCount,
      status: !totalNotes ? "unknown" : collectedCount >= totalNotes ? "complete" : "partial",
      percent: totalNotes ? Math.min(100, Math.round((collectedCount / totalNotes) * 100)) : null,
      updatedAt: now()
    };
  }
  prepareAutomationState(state);
  refreshEngagementMetrics(state);
  return {
    ok: true,
    totals,
    source,
    nextAction: platform === "xiaohongshu"
      ? "打开这个主页，手动滚动到目标范围，点击采集书签；需要补全历史时继续向下滚动并重复点击。"
      : platform === "bilibili"
        ? "每日自动读取公开视频元数据和字幕轨；412/403 时保留 blocked 并转人工。"
      : "先运行一次公开页面采集；如平台要求登录，改用平台导出或手动导入。"
  };
}

const captureMetadataAliases = new Map(Object.entries({
  title: "title",
  "标题": "title",
  "题目": "title",
  url: "url",
  link: "url",
  sourceurl: "url",
  "链接": "url",
  "原文链接": "url",
  "来源链接": "url",
  "作品链接": "url",
  author: "author",
  "作者": "author",
  "账号": "author",
  platform: "platform",
  "平台": "platform",
  "来源平台": "platform",
  coverurl: "coverurl",
  cover: "coverurl",
  "封面": "coverurl",
  "封面链接": "coverurl",
  transcript: "transcript",
  transcripttext: "transcript",
  "逐字稿": "transcript",
  "口播稿": "transcript",
  "字幕": "transcript",
  body: "body",
  contenttext: "body",
  "正文": "body",
  "简介": "body",
  description: "body",
  sourceid: "sourceid",
  "来源id": "sourceid",
  publishedat: "publishedat",
  date: "publishedat",
  "发布时间": "publishedat",
  "日期": "publishedat",
  engagement: "engagement",
  "互动": "engagement",
  "点赞": "engagement",
  kind: "kind",
  "类别": "kind",
  note: "note",
  "备注": "note"
}));

function captureMetadataKey(label = "") {
  const key = String(label).trim().toLowerCase().replace(/[\s_-]+/g, "");
  return captureMetadataAliases.get(key) || "";
}

function splitLeadingCaptureMetadata(text = "") {
  const metadata = {};
  const bodyLines = [];
  const transcriptLines = [];
  let readingBody = false;
  let readingTranscript = false;
  for (const line of String(text || "").split(/\r?\n/)) {
    if (readingTranscript) {
      transcriptLines.push(line);
      continue;
    }
    if (readingBody) {
      bodyLines.push(line);
      continue;
    }
    if (!line.trim()) continue;
    const match = line.match(/^\s*([^:：]{1,30})\s*[:：]\s*(.*)$/);
    const key = match ? captureMetadataKey(match[1]) : "";
    if (!key) {
      readingBody = true;
      bodyLines.push(line);
      continue;
    }
    const value = match[2].trim();
    if (key === "transcript") {
      readingTranscript = true;
      if (value) transcriptLines.push(value);
      continue;
    }
    metadata[key] = value;
  }
  return {
    metadata,
    body: bodyLines.join("\n").trim(),
    transcript: transcriptLines.join("\n").trim(),
    hasTranscriptLabel: transcriptLines.length > 0
  };
}

function signalUrlFromRecord(record = {}) {
  return record.url || record.sourceUrl || record.link || record.source_url || "";
}

function transcriptTextFromRecord(record = {}) {
  const explicit = record.transcriptText
    ?? record.transcript
    ?? record.transcript_text
    ?? record.subtitleText
    ?? record.subtitle_text;
  if (explicit !== undefined && explicit !== null && String(explicit).trim()) return String(explicit).trim();
  if (record.manualTranscript === true) {
    const fallback = record.body ?? record.contentText ?? record.description ?? "";
    if (String(fallback).trim()) return String(fallback).trim();
  }
  return "";
}

function parseDropFile(fileName, text) {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === ".json") {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return {
        context: {},
        signals: parsed.filter((item) => item && typeof item === "object" && signalUrlFromRecord(item)),
        materials: parsed.filter((item) => (
          item
          && typeof item === "object"
          && item.excerpt
          && !signalUrlFromRecord(item)
        ))
      };
    }
    if (!parsed || typeof parsed !== "object") throw new Error("JSON must be an array or object");
    return {
      context: parsed,
      signals: Array.isArray(parsed.signals) ? parsed.signals : signalUrlFromRecord(parsed) ? [parsed] : [],
      materials: Array.isArray(parsed.materials) ? parsed.materials : parsed.excerpt ? [parsed] : []
    };
  }

  if (!extension || extension === ".md" || extension === ".txt") {
    const parsed = splitLeadingCaptureMetadata(text);
    const metadata = parsed.metadata;
    let body = parsed.body;
    let title = metadata.title || "";
    const heading = body.match(/^#\s+(.+)$/m);
    if (heading) {
      title = title || heading[1].trim();
      body = body.replace(heading[0], "").trim();
    }
    const urls = [...body.matchAll(/https?:\/\/[^\s<>"')]+/g)].map((match) => match[0]);
    const preferredUrl = urls.find((value) => !/xhslink\.(?:cn|com)/i.test(value)) || urls[0] || "";
    const url = metadata.url || preferredUrl;
    const labeledTranscript = parsed.transcript;
    const kind = String(metadata.kind || "").toLowerCase();
    const materialTypes = new Set(["opinion", "case", "data", "quote", "hot-comment", "counter-example", "lead"]);
    const context = {
      sourceId: metadata.sourceid || "",
      platform: metadata.platform || "",
      author: metadata.author || ""
    };
    const inferredTranscript = !labeledTranscript
      && !metadata.body
      && Boolean(url)
      && body.replace(/https?:\/\/\S+/g, "").trim().length >= 60
      ? body
      : "";
    const transcriptText = labeledTranscript || inferredTranscript;
    const contentText = metadata.body || (transcriptText ? "" : body);

    if (kind === "material" || (!kind && !url && (transcriptText || body))) {
      return {
        context,
        signals: [],
        materials: [{
          ...metadata,
          type: materialTypes.has(kind) || !kind ? "opinion" : kind,
          possibleUse: metadata.possibleuse || metadata.use || "evidence",
          sourceUrl: url,
          excerpt: transcriptText || body
        }]
      };
    }

    if (!url) throw new Error("text drop needs url, sourceUrl, or kind: material");
    return {
      context,
      signals: [{
        title,
        url,
        coverUrl: metadata.coverurl || "",
        engagement: metadata.engagement || null,
        author: metadata.author || "",
        platform: metadata.platform || "",
        publishedAt: metadata.publishedat || "",
        note: transcriptText
          ? "用户提供逐字稿，正文与来源已保存；逐字稿仍需人工核对"
          : body ? "本地文本信号，正文已保存" : metadata.note || "",
        contentText,
        ...(transcriptText ? {
          transcriptText,
          manualTranscript: true,
          transcriptStatus: "captured",
          transcriptSource: "user-provided",
          transcriptModel: "user-provided",
          evidenceState: "unverified"
        } : {}),
        imageDescriptions: [],
        dataPointCandidates: extractDataPointCandidates([contentText || transcriptText])
      }],
      materials: []
    };
  }

  throw new Error("unsupported drop file type");
}

function platformFromUrl(value = "") {
  const host = (() => {
    try {
      return new URL(value).hostname.toLowerCase();
    } catch {
      return "";
    }
  })();
  if (host.includes("xiaohongshu")) return "xiaohongshu";
  if (host.includes("douyin")) return "douyin";
  if (host.includes("bilibili.com") || host.includes("b23.tv")) return "bilibili";
  if (host.includes("x.com") || host.includes("twitter.com")) return "x";
  if (host.includes("weixin.qq.com") || host.includes("mp.weixin.qq.com")) return "wechat";
  return "other";
}

function sourceForUrl(state, value = "") {
  let target;
  try {
    target = new URL(value);
  } catch {
    return null;
  }
  const targetCanonical = canonicalSignalUrl(target.toString());
  const targetProfileId = target.hostname.endsWith("xiaohongshu.com")
    ? target.pathname.match(/^\/user\/profile\/([A-Za-z0-9_-]+)\/?$/)?.[1] || ""
    : "";
  return (state.sources || []).find((source) => {
    try {
      const candidate = new URL(source.url);
      if (targetCanonical && canonicalSignalUrl(candidate.toString()) === targetCanonical) return true;
      if (!targetProfileId || !candidate.hostname.endsWith("xiaohongshu.com")) return false;
      return candidate.pathname.match(/^\/user\/profile\/([A-Za-z0-9_-]+)\/?$/)?.[1] === targetProfileId;
    } catch {
      return false;
    }
  }) || null;
}

function parseLooseCapture(state, text) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return parseDropFile("capture.json", trimmed);
  }

  const parsed = splitLeadingCaptureMetadata(trimmed);
  const metadata = parsed.metadata;
  const bodyLines = parsed.body.split(/\r?\n/);

  const urls = [...trimmed.matchAll(/https?:\/\/[^\s<>"')]+/g)].map((match) => match[0]);
  const preferredUrl = urls.find((value) => !/xhslink\.(?:cn|com)/i.test(value)) || urls[0] || "";
  const primaryUrl = metadata.url || preferredUrl;
  const source = (state.sources || []).find((item) => item.id === (metadata.sourceid || "")) || sourceForUrl(state, primaryUrl);
  const platform = metadata.platform || source?.platform || platformFromUrl(primaryUrl);
  const contentLines = bodyLines
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^https?:\/\//.test(line));
  const titleLine = contentLines.find((line) => line.length >= 4 && !/^(?:赞|点赞|喜欢|评论|转发|收藏|阅读|发布时间)\b/.test(line));
  const title = metadata.title
    || (titleLine?.match(/^(?:标题|题目)\s*[:：]\s*(.+)$/)?.[1] || "")
    || titleLine
    || "";
  const engagementValue = trimmed.match(/(?:赞|点赞|喜欢|liked?)\s*[:：]?\s*([\d,.]+\s*(?:万|亿|[kK])?\+?)/i)?.[1]
    || metadata.engagement
    || null;
  const noteLines = contentLines.filter((line) => line !== title);
  const inferredTranscript = !parsed.transcript
    && !metadata.body
    && Boolean(primaryUrl)
    && noteLines.join("\n").length >= 60
    ? noteLines.join("\n")
    : "";
  const transcriptText = parsed.transcript || inferredTranscript;
  const contentText = metadata.body || (transcriptText ? "" : noteLines.join("\n"));
  const signals = urls.length || primaryUrl
    ? [{
        sourceId: source?.id || metadata.sourceid || "",
        platform,
        author: metadata.author || source?.account || source?.name || "",
        title,
        url: primaryUrl,
        coverUrl: metadata.coverurl || "",
        engagement: parseCount(engagementValue),
        publishedAt: metadata.publishedat || metadata.date || "",
        note: transcriptText
          ? "用户提供逐字稿，正文与来源已保存；逐字稿仍需人工核对"
          : noteLines.length ? "快速粘贴文本，正文已保存" : metadata.note || "快速粘贴自动解析",
        contentText,
        ...(transcriptText ? {
          transcriptText,
          manualTranscript: true,
          transcriptStatus: "captured",
          transcriptSource: "user-provided",
          transcriptModel: "user-provided",
          evidenceState: "unverified"
        } : {}),
        imageDescriptions: [],
        dataPointCandidates: extractDataPointCandidates([contentText || transcriptText])
      }]
    : [];

  const materials = [];
  for (const line of contentLines) {
    const comment = line.match(/^(?:热评|评论|高赞评论)\s*[:：]\s*(.+)$/);
    if (comment) {
      materials.push({
        sourceUrl: primaryUrl,
        platform,
        author: metadata.author || source?.account || source?.name || "",
        type: "hot-comment",
        excerpt: comment[1],
        whyValuable: "自动识别的热评，价值待人工确认",
        possibleUse: "audience-language"
      });
      continue;
    }
    const mention = line.match(/^@([^：:]{1,30})[：:]\s*(.{4,})$/);
    if (mention) {
      materials.push({
        sourceUrl: primaryUrl,
        platform,
        author: mention[1],
        type: "hot-comment",
        excerpt: mention[2],
        whyValuable: "自动识别的用户评论，价值待人工确认",
        possibleUse: "audience-language"
      });
    }
  }

  return { context: { sourceId: source?.id || "" }, signals, materials };
}

function normalizeDropRecords({ state, signals = [], materials = [], context = {} }) {
  const normalizedSignals = [];
  let invalidSignals = 0;
  for (const record of signals) {
    if (!record || typeof record !== "object") {
      invalidSignals += 1;
      continue;
    }
    const url = normalizeUrl(signalUrlFromRecord(record));
    if (!url) {
      invalidSignals += 1;
      continue;
    }
    const sourceId = record.sourceId || context.sourceId || "";
    const source = (state.sources || []).find((item) => item.id === sourceId);
    const engagement = parseCount(record.engagement);
    const transcriptText = transcriptTextFromRecord(record);
    const manualTranscript = Boolean(transcriptText);
    const title = String(record.title || "").trim()
      || (manualTranscript ? `未命名逐字稿 · ${platformFromUrl(url)}` : "");
    normalizedSignals.push({
      ...record,
      sourceId: source ? source.id : "",
      url,
      platform: record.platform || source?.platform || context.platform || platformFromUrl(url) || "other",
      author: record.author || source?.account || source?.name || context.author || "",
      title,
      coverUrl: normalizeUrl(record.coverUrl || record.cover || "") || "",
      engagement,
      authorMedianEngagement: source?.authorMedianEngagement ?? null,
      relativeMultiple: null,
      automationTier: "needs-review",
      capturedAt: record.capturedAt || now(),
      seen: false,
      disposition: manualTranscript ? "material" : record.disposition || "inbox",
      note: manualTranscript
        ? `${String(record.note || "用户提供逐字稿").replace(/[。；;]+$/, "")}；仍需人工核对`
        : record.note || "本地投递箱自动入库",
      contentText: String(record.contentText || record.body || record.description || "").slice(0, 100000),
      ...(manualTranscript ? {
        transcriptText: transcriptText.slice(0, 500000),
        transcriptStatus: "captured",
        transcriptSource: "user-provided",
        transcriptModel: "user-provided",
        transcriptCapturedAt: record.transcriptCapturedAt || now(),
        evidenceState: "unverified"
      } : {}),
      imageDescriptions: Array.isArray(record.imageDescriptions)
        ? record.imageDescriptions
          .filter((item) => item && typeof item === "object")
          .map((item) => ({
            url: normalizeUrl(item.url) || "",
            description: String(item.description || "").replace(/\s+/g, " ").trim().slice(0, 300)
          }))
          .filter((item) => item.url && item.description)
          .slice(0, 20)
        : [],
      dataPointCandidates: Array.isArray(record.dataPointCandidates)
        ? record.dataPointCandidates
          .map((item) => String(item || "").replace(/\s+/g, " ").trim().slice(0, 400))
          .filter(Boolean)
          .slice(0, 30)
        : [],
      createdAt: record.createdAt || now(),
      updatedAt: now()
    });
  }

  const normalizedMaterials = [];
  let invalidMaterials = 0;
  for (const record of materials) {
    if (!record || typeof record !== "object" || !String(record.excerpt || "").trim()) {
      invalidMaterials += 1;
      continue;
    }
    normalizedMaterials.push({
      ...record,
      sourceUrl: normalizeUrl(record.sourceUrl) || "",
      platform: record.platform || context.platform || "other",
      type: record.type || "opinion",
      possibleUse: record.possibleUse || "evidence",
      topicIds: Array.isArray(record.topicIds) ? record.topicIds : [],
      createdAt: record.createdAt || now(),
      updatedAt: now()
    });
  }

  return { signals: normalizedSignals, materials: normalizedMaterials, invalidSignals, invalidMaterials };
}

async function archiveDropFile(sourceDir, fileName, targetDir) {
  await fs.mkdir(targetDir, { recursive: true });
  const source = path.join(sourceDir, fileName);
  const extension = path.extname(fileName);
  const stem = path.basename(fileName, extension);
  let target = path.join(targetDir, fileName);
  try {
    await fs.access(target);
    target = path.join(targetDir, `${stem}-${Date.now()}${extension}`);
  } catch {
    // Target name is available.
  }
  await fs.rename(source, target);
}

async function listDropFiles(rootDir) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && dropExtensions.has(path.extname(entry.name).toLowerCase()))
    .filter((entry) => entry.name.toLowerCase() !== "readme.md")
    .map((entry) => entry.name)
    .slice(0, 20);
}

async function processDropFile({
  state,
  sourceDir,
  processedDir,
  failedDir,
  fileName,
  sourceId,
  trigger,
  useContentLedger = false
}) {
  const filePath = path.join(sourceDir, fileName);
  const statBefore = await fs.stat(filePath);
  const fingerprint = `${statBefore.size}:${statBefore.mtimeMs}`;
  const stabilityKey = path.resolve(filePath);
  if (dropFileStability.get(stabilityKey) !== fingerprint) {
    dropFileStability.set(stabilityKey, fingerprint);
    const pendingRun = {
      id: id("run"),
      sourceId,
      status: "pending",
      trigger,
      startedAt: now(),
      finishedAt: now(),
      found: 0,
      created: 0,
      duplicates: 0,
      failureReason: "file is still changing",
      nextAction: "等待文件写入稳定后自动重试",
      fileName
    };
    finalizeCollectionRun(pendingRun);
    state.collectionRuns.unshift(pendingRun);
    await writeState(state);
    return { fileName, status: "pending", error: "file is still changing" };
  }

  dropFileStability.delete(stabilityKey);
  const run = {
    id: id("run"),
    sourceId,
    status: "running",
    trigger,
    startedAt: now(),
    finishedAt: "",
    found: 0,
    created: 0,
    duplicates: 0,
    failureReason: "",
    nextAction: "",
    fileName
  };
  finalizeCollectionRun(run);
  state.collectionRuns.unshift(run);

  try {
    const stat = await fs.stat(filePath);
    if (stat.size > 2 * 1024 * 1024) throw new Error("file exceeds 2 MB");
    const text = await fs.readFile(filePath, "utf8");
    const statAfter = await fs.stat(filePath);
    if (statAfter.size !== stat.size || statAfter.mtimeMs !== stat.mtimeMs) {
      dropFileStability.set(stabilityKey, `${statAfter.size}:${statAfter.mtimeMs}`);
      run.status = "pending";
      run.failureReason = "file changed while being read";
      run.nextAction = "等待文件写入稳定后自动重试";
      finalizeCollectionRun(run);
      await writeState(state);
      return { fileName, status: "pending", error: run.failureReason };
    }

    const contentHash = crypto.createHash("sha256").update(text).digest("hex");
    if (useContentLedger) {
      const previous = (state.cloudInboxLedger || []).find((item) => item.sha256 === contentHash);
      if (previous) {
        run.status = "ok-no-new";
        run.duplicates = 1;
        run.nextAction = "内容哈希已处理，归档到 Inbox/Processed";
        finalizeCollectionRun(run);
        await writeState(state);
        try {
          await archiveDropFile(sourceDir, fileName, processedDir);
        } catch (archiveError) {
          run.archiveError = archiveError.message;
          await writeState(state);
        }
        return { fileName, status: run.status, duplicates: 1, duplicateContent: true };
      }
    }

    state.rawSnapshots.unshift({
      id: id("snapshot"),
      runId: run.id,
      sourceId,
      url: sourceId === "drive-inbox" ? `drive-inbox://${fileName}` : `drop://${fileName}`,
      capturedAt: now(),
      format: `${sourceId}${path.extname(fileName).toLowerCase()}`,
      content: text.slice(0, 500000)
    });

    const parsed = parseDropFile(fileName, text);
    const normalized = normalizeDropRecords({ state, ...parsed });
    if (!normalized.signals.length && !normalized.materials.length) {
      throw new Error("drop file has no valid signal or material");
    }
    const signalTotals = importRecords(state, "signals", normalized.signals);
    const materialTotals = importRecords(state, "materials", normalized.materials);

    run.found = normalized.signals.length + normalized.materials.length;
    run.created = signalTotals.added + materialTotals.added;
    run.duplicates = signalTotals.merged + materialTotals.merged;
    run.status = run.created > 0 ? "ok" : "ok-no-new";
    run.nextAction = run.created > 0 ? "到 Inbox / 素材库查看" : "无新增，已归档";
    finalizeCollectionRun(run);

    if (useContentLedger) {
      state.cloudInboxLedger = [{
        sha256: contentHash,
        fileName,
        status: run.status,
        created: run.created,
        duplicates: run.duplicates,
        processedAt: now()
      }, ...(state.cloudInboxLedger || [])].slice(0, 5000);
    }
    await writeState(state);
    try {
      await archiveDropFile(sourceDir, fileName, processedDir);
    } catch (archiveError) {
      run.archiveError = archiveError.message;
      await writeState(state);
    }
    return {
      fileName,
      status: run.status,
      created: run.created,
      duplicates: run.duplicates,
      invalid: normalized.invalidSignals + normalized.invalidMaterials
    };
  } catch (error) {
    run.status = "failed";
    run.failureReason = error.message;
    run.nextAction = "查看 drops/failed 中的文件并修正格式";
    finalizeCollectionRun(run);
    await writeState(state);
    try {
      await archiveDropFile(sourceDir, fileName, failedDir);
    } catch (archiveError) {
      run.failureReason += `; archive failed: ${archiveError.message}`;
      await writeState(state);
    }
    return { fileName, status: "failed", error: error.message };
  }
}

async function runDropFolderScan(trigger = "automatic", allowDisabled = false) {
  try {
    const state = await readState();
    if (!allowDisabled && !automationEnabled(state)) {
      return { ok: true, skipped: true, reason: "automation is disabled" };
    }

    await Promise.all([fs.mkdir(dropDir, { recursive: true }), fs.mkdir(dropProcessedDir, { recursive: true }), fs.mkdir(dropFailedDir, { recursive: true })]);
    const results = [];
    const localFiles = await listDropFiles(dropDir);
    for (const fileName of localFiles) {
      results.push(await processDropFile({
        state,
        sourceDir: dropDir,
        processedDir: dropProcessedDir,
        failedDir: dropFailedDir,
        fileName,
        sourceId: "local-drop",
        trigger
      }));
    }

    let cloudInbox = { configured: false, total: 0, results: [] };
    if (state.settings.driveRoot) {
      try {
        const driveRoot = await validateDriveRoot(state.settings.driveRoot);
        const cloudInboxDir = path.join(driveRoot, cloudInboxRelativeDir);
        const cloudProcessedDir = path.join(cloudInboxDir, "Processed");
        const cloudFailedDir = path.join(cloudInboxDir, "Failed");
        await Promise.all([
          fs.mkdir(cloudInboxDir, { recursive: true }),
          fs.mkdir(cloudProcessedDir, { recursive: true }),
          fs.mkdir(cloudFailedDir, { recursive: true })
        ]);
        const cloudFiles = await listDropFiles(cloudInboxDir);
        const cloudResults = [];
        for (const fileName of cloudFiles) {
          cloudResults.push(await processDropFile({
            state,
            sourceDir: cloudInboxDir,
            processedDir: cloudProcessedDir,
            failedDir: cloudFailedDir,
            fileName,
            sourceId: "drive-inbox",
            trigger,
            useContentLedger: true
          }));
        }
        cloudInbox = {
          configured: true,
          root: cloudInboxDir,
          total: cloudResults.length,
          results: cloudResults
        };
        results.push(...cloudResults);
      } catch (error) {
        cloudInbox = {
          configured: true,
          total: 0,
          results: [],
          error: error.message
        };
      }
    }

    refreshEngagementMetrics(state);
    const changed = refreshMorningBrief(state);
    if (changed) await writeState(state);
    return {
      ok: true,
      scannedAt: now(),
      total: results.length,
      created: results.reduce((total, item) => total + (item.created || 0), 0),
      failed: results.filter((item) => item.status === "failed").length,
      results,
      cloudInbox
    };
  } finally {
  }
}

async function runQuickCapture(text, preferredSourceId = "") {
  try {
    const state = await readState();
    const parsed = parseLooseCapture(state, String(text || ""));
    const preferredSource = (state.sources || []).find((source) => source.id === preferredSourceId);
    if (preferredSource) {
      parsed.context = {
        ...parsed.context,
        sourceId: preferredSource.id,
        platform: preferredSource.platform,
        author: preferredSource.account || preferredSource.name
      };
      parsed.signals = parsed.signals.map((signal) => ({
        ...signal,
        sourceId: signal.sourceId || preferredSource.id,
        platform: signal.platform === "other" ? preferredSource.platform : signal.platform,
        author: signal.author || preferredSource.account || preferredSource.name || ""
      }));
    }
    const normalized = normalizeDropRecords({ state, ...parsed });
    if (!normalized.signals.length && !normalized.materials.length) {
      return { ok: false, error: "未识别到链接、信号或热评" };
    }

    const timestamp = now();
    const run = {
      id: id("run"),
      sourceId: parsed.context.sourceId || "quick-capture",
      status: "running",
      trigger: "quick-capture",
      startedAt: timestamp,
      finishedAt: "",
      found: normalized.signals.length + normalized.materials.length,
      created: 0,
      duplicates: 0,
      failureReason: "",
      nextAction: ""
    };
    finalizeCollectionRun(run);
    state.collectionRuns.unshift(run);
    state.rawSnapshots.unshift({
      id: id("snapshot"),
      runId: run.id,
      sourceId: run.sourceId,
      url: normalized.signals[0]?.url || normalized.materials[0]?.sourceUrl || "workbench://quick-capture",
      capturedAt: timestamp,
      format: "text",
      content: String(text).slice(0, 500000)
    });

    const signalTotals = importRecords(state, "signals", normalized.signals);
    const materialTotals = importRecords(state, "materials", normalized.materials);
    refreshEngagementMetrics(state);
    run.created = signalTotals.added + materialTotals.added;
    run.duplicates = signalTotals.merged + materialTotals.merged;
    run.status = "ok";
    run.finishedAt = now();
    run.nextAction = run.created > 0 ? "到 Inbox / 素材库查看" : "重复内容，未新增";
    finalizeCollectionRun(run);
    refreshMorningBrief(state);
    await writeState(state);
    return {
      ok: true,
      run,
      signals: signalTotals,
      materials: materialTotals,
      invalid: normalized.invalidSignals + normalized.invalidMaterials
    };
  } finally {
  }
}

function sourceForIntakeAuthor(state, platform, author) {
  const normalizedAuthor = normalizedTitle(author);
  if (!normalizedAuthor) return null;
  return (state.sources || []).find((source) => (
    source.platform === platform
    && normalizedTitle(source.account || source.name) === normalizedAuthor
  )) || null;
}

function captureBatchIntakeNote(state, run, queueItem, classification) {
  const parsed = parseLooseCapture(state, queueItem.rawText);
  const parsedSignal = parsed.signals[0] || {};
  const matchedSource = sourceForUrl(state, classification.canonicalUrl || queueItem.url)
    || sourceForIntakeAuthor(state, "xiaohongshu", queueItem.authorCandidate);
  const incomingSignal = {
    ...parsedSignal,
    sourceId: parsedSignal.sourceId || matchedSource?.id || "",
    platform: "xiaohongshu",
    author: queueItem.authorCandidate || parsedSignal.author || matchedSource?.account || matchedSource?.name || "",
    title: queueItem.titleCandidate || parsedSignal.title || `小红书笔记 ${classification.noteId}`,
    url: classification.canonicalUrl || queueItem.url,
    noteId: classification.noteId,
    note: "分享文本已登记；标题和正文来自可见分享信息，封面、详情证据与逐字稿仍需浏览器补采",
    captureState: "share-metadata",
    evidenceState: "unverified",
    capturedAt: now()
  };
  const normalized = normalizeDropRecords({ state, signals: [incomingSignal], materials: [] });
  const totals = importRecords(state, "signals", normalized.signals);
  const signal = (state.signals || []).find((item) => (
    (classification.noteId && item.noteId === classification.noteId)
    || canonicalSignalUrl(item.url) === canonicalSignalUrl(incomingSignal.url)
  )) || null;
  state.rawSnapshots.unshift({
    id: id("snapshot"),
    runId: run.id,
    sourceId: matchedSource?.id || "",
    signalId: signal?.id || "",
    url: incomingSignal.url,
    capturedAt: now(),
    format: "share-text",
    context: {
      captureScope: "user-pasted-share-text",
      noteId: classification.noteId,
      mediaDownloaded: false,
      privateApiCalled: false
    },
    content: queueItem.rawText.slice(0, 500000)
  });
  run.found += 1;
  run.created += totals.added;
  run.duplicates += totals.merged;
  return { signal, totals, matchedSource };
}

function intakeQueueSummary(queue) {
  return queue.reduce((summary, item) => {
    summary.total += 1;
    summary[item.status] = (summary[item.status] || 0) + 1;
    return summary;
  }, {
    total: 0,
    queued: 0,
    registered: 0,
    captured: 0,
    "needs-browser": 0,
    duplicate: 0,
    blocked: 0,
    failed: 0
  });
}

async function runBatchSourceIntake(state, text) {
  const parsedItems = parseBatchIntakeText(text);
  if (!parsedItems.length) {
    throw new Error("未识别到可处理的公开链接");
  }

  const timestamp = now();
  const batch = {
    id: id("intake-batch"),
    status: "running",
    itemCount: parsedItems.length,
    inputCharacters: String(text || "").length,
    startedAt: timestamp,
    finishedAt: "",
    summary: null,
    nextAction: ""
  };
  const run = {
    id: id("run"),
    sourceId: "batch-intake",
    status: "running",
    trigger: "batch-intake",
    startedAt: timestamp,
    finishedAt: "",
    found: 0,
    created: 0,
    duplicates: 0,
    failureReason: "",
    nextAction: "",
    batchId: batch.id
  };
  state.intakeBatches.unshift(batch);
  state.collectionRuns.unshift(run);
  finalizeCollectionRun(run);

  const queuedItems = [];
  for (const parsed of parsedItems) {
    const queueItem = {
      id: id("intake"),
      batchId: batch.id,
      ordinal: parsed.ordinal,
      status: "queued",
      platform: parsed.platformHint,
      url: parsed.url,
        originalUrl: parsed.url,
      canonicalUrl: "",
      identityKey: parsed.identityKey,
      titleCandidate: parsed.titleCandidate,
      authorCandidate: parsed.authorCandidate,
      rawText: parsed.contextText,
      sourceId: "",
      signalId: "",
      duplicateOf: "",
      nextAction: "正在识别链接",
      error: "",
      createdAt: now(),
      processedAt: ""
    };
    queuedItems.push(queueItem);

    try {
      const classification = await classifySourceIntakeUrl(parsed.url, { state });
      queueItem.platform = classification.platform || parsed.platformHint;
      queueItem.canonicalUrl = classification.canonicalUrl || parsed.url;
      queueItem.url = classification.canonicalUrl || parsed.url;

      if (!classification.ok) {
        queueItem.status = intakeStatusFromClassification(classification);
        queueItem.error = classification.reason || "链接无法安全解析";
        queueItem.nextAction = queueItem.status === "needs-browser"
          ? "打开原始短链取得最终地址；若出现登录或人机认证，请人工接管后重新投递"
          : "换用公开可访问的最终链接，或在浏览器中人工确认";
        continue;
      }

      if (classification.existingRecord) {
        queueItem.status = "duplicate";
        queueItem.duplicateOf = classification.existingRecord.id;
        if (classification.existingRecord.entityType === "source") queueItem.sourceId = classification.existingRecord.id;
        if (classification.existingRecord.entityType === "signal") queueItem.signalId = classification.existingRecord.id;
        queueItem.nextAction = "打开已有记录继续处理，不重复入库";
        continue;
      }

      const previousQueueItem = state.intakeQueue.find((item) => (
        item.identityKey
        && item.identityKey === parsed.identityKey
        && ["registered", "captured", "duplicate"].includes(item.status)
      ));
      if (previousQueueItem) {
        queueItem.status = "duplicate";
        queueItem.duplicateOf = previousQueueItem.id;
        queueItem.sourceId = previousQueueItem.sourceId || "";
        queueItem.signalId = previousQueueItem.signalId || "";
        queueItem.nextAction = "这条链接已在本地队列处理过";
        continue;
      }

      if (classification.detectedType === "xhs-profile") {
        const sourceName = queueItem.authorCandidate
          || (classification.profileId ? `小红书博主 ${classification.profileId.slice(-6)}` : "");
        const intake = await importSourceIntake(state, queueItem.rawText, {
          inputUrl: parsed.url,
          canonicalUrl: classification.canonicalUrl,
          name: sourceName
        });
        queueItem.status = "registered";
        queueItem.sourceId = intake.source?.id || "";
        queueItem.nextAction = "主页已登记；用可见浏览器读取目标范围，遇登录或认证时人工接管";
        continue;
      }

      if (classification.detectedType === "xhs-note") {
        const captured = captureBatchIntakeNote(state, run, queueItem, classification);
        queueItem.signalId = captured.signal?.id || "";
        queueItem.sourceId = captured.matchedSource?.id || captured.signal?.sourceId || "";
        queueItem.status = "captured";
        queueItem.nextAction = "已进入 Inbox；下一步补采封面与详情证据，再生成逐字稿和候选拆解";
        continue;
      }

      const intake = await importSourceIntake(state, queueItem.rawText, {
        inputUrl: parsed.url,
        canonicalUrl: classification.canonicalUrl,
        name: queueItem.authorCandidate || new URL(classification.canonicalUrl).hostname
      });
      queueItem.status = "registered";
      queueItem.sourceId = intake.source?.id || "";
      queueItem.nextAction = intake.nextAction || "公开页面已登记";
      run.found += 1;
    } catch (error) {
      queueItem.status = "failed";
      queueItem.error = String(error?.message || "处理失败").slice(0, 500);
      queueItem.nextAction = "查看错误原因，修正分享文本或链接后重新投递";
    } finally {
      queueItem.processedAt = now();
    }
  }

  state.intakeQueue = [...queuedItems, ...state.intakeQueue].slice(0, 300);
  const summary = intakeQueueSummary(queuedItems);
  batch.summary = summary;
  batch.finishedAt = now();
  batch.status = summary.failed > 0
    ? "partial"
    : summary.blocked > 0 || summary["needs-browser"] > 0
      ? "needs-review"
      : "completed";
  batch.nextAction = batchIntakeNextAction(summary);

  run.status = summary.failed > 0 || summary.blocked > 0
    ? "blocked"
    : summary["needs-browser"] > 0
      ? "blocked"
      : run.created > 0
        ? "ok"
        : "ok-no-new";
  run.finishedAt = now();
  run.nextAction = batch.nextAction;
  run.failureReason = summary.failed > 0
    ? `${summary.failed} 条处理失败`
    : summary.blocked + summary["needs-browser"] > 0
      ? `${summary.blocked + summary["needs-browser"]} 条需要人工或浏览器补采`
      : "";
  finalizeCollectionRun(run);
  refreshEngagementMetrics(state);
  refreshMorningBrief(state);

  return {
    ok: true,
    batch,
    run,
    items: queuedItems,
    summary
  };
}

function clipText(value, length = 900) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, length);
}

async function validateDriveRoot(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  const resolved = path.resolve(trimmed);
  if (!path.isAbsolute(resolved) || path.parse(resolved).root === resolved) {
    throw new Error("Google Drive 目录必须是已存在的绝对目录，不能直接填盘符根目录");
  }
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new Error("目录不存在。请先启动 Google Drive 桌面同步，再填写它的本地同步目录");
  }
  return resolved;
}

function driveTaskDir(driveRoot, taskId) {
  return path.join(driveRoot, "ContentFlowWorkbench", "Outbox", taskId);
}

function buildAgentSignalContext(state, signal, { includeFullTranscript = false } = {}) {
  const transcriptText = String(signal.transcriptText || "");
  const transcriptSegments = Array.isArray(signal.transcriptSegments) ? signal.transcriptSegments : [];
  const latestAnalysis = latestAnalysisForSignal(state, signal.id);
  return {
    id: signal.id,
    title: signal.title || signal.note || "",
    author: signal.author || "",
    platform: signal.platform || "",
    url: signal.url || "",
    capturedAt: signal.capturedAt || "",
    engagement: signal.engagement ?? null,
    relativeMultiple: signal.relativeMultiple ?? null,
    coverUrl: signal.coverUrl || "",
    dataPointCandidates: Array.isArray(signal.dataPointCandidates) ? signal.dataPointCandidates.slice(0, 5) : [],
    contentText: clipText(signal.contentText, includeFullTranscript ? 12000 : 4000),
    contentTextTruncated: String(signal.contentText || "").length > (includeFullTranscript ? 12000 : 4000),
    imageDescriptions: Array.isArray(signal.imageDescriptions) ? signal.imageDescriptions.slice(0, 10) : [],
    mediaItems: Array.isArray(signal.mediaItems) ? signal.mediaItems.slice(0, 20) : [],
    transcript: transcriptText ? {
      evidenceState: "unverified",
      warning: "ASR 候选稿可能包含同音字、断句和术语错误；引用前必须人工校对并保留时间戳。",
      model: signal.transcriptModel || "",
      capturedAt: signal.transcriptCapturedAt || "",
      durationSeconds: Number(signal.transcriptDurationSeconds || 0),
      characterCount: transcriptText.length,
      segmentCount: transcriptSegments.length,
      text: includeFullTranscript ? transcriptText : clipText(transcriptText, 2000),
      textTruncated: !includeFullTranscript && transcriptText.length > 2000,
      segments: includeFullTranscript ? transcriptSegments : transcriptSegments.slice(0, 20),
      segmentsTruncated: !includeFullTranscript && transcriptSegments.length > 20,
      omittedSegmentCount: includeFullTranscript ? 0 : Math.max(0, transcriptSegments.length - 20),
      artifactPath: signal.transcriptArtifactPath || "",
      mediaPath: signal.transcriptMediaPath || ""
    } : null,
    latestAnalysis: latestAnalysis ? {
      id: latestAnalysis.id,
      evidenceState: latestAnalysis.evidenceState || "unverified",
      generatedAt: latestAnalysis.createdAt || "",
      analysis: latestAnalysis.analysis || null
    } : null
  };
}

function buildAgentTaskContext(state, topicId = "", signalId = "") {
  const topic = (state.topics || []).find((item) => item.id === topicId) || null;
  const focusSignal = (state.signals || []).find((item) => item.id === signalId) || null;
  const linkedMaterialIds = new Set(topic?.materialIds || []);
  const linkedMaterials = (state.materials || []).filter((item) => linkedMaterialIds.has(item.id)).slice(0, 12);
  const hotComments = (state.materials || []).filter((item) => item.type === "hot-comment" && !linkedMaterialIds.has(item.id)).slice(0, 8);
  const evidenceMaterials = (state.materials || []).filter((item) => ["data", "case", "quote"].includes(item.type) && !linkedMaterialIds.has(item.id)).slice(0, 8);
  const selectedMaterials = [...linkedMaterials, ...hotComments, ...evidenceMaterials]
    .filter((item, index, list) => list.findIndex((other) => other.id === item.id) === index)
    .slice(0, 20)
    .map((item) => ({
      id: item.id,
      type: item.type,
      author: item.author || "",
      sourceUrl: item.sourceUrl || "",
      excerpt: clipText(item.excerpt, 900),
      whyValuable: clipText(item.whyValuable, 300),
      citationNote: clipText(item.citationNote, 240)
    }));

  const linkedSignalIds = new Set([
    ...(topic?.sourceSignalIds || []),
    ...(focusSignal ? [focusSignal.id] : [])
  ]);
  const linkedSignals = (state.signals || []).filter((item) => linkedSignalIds.has(item.id)).slice(0, 8);
  const highPotentialSignals = (state.signals || [])
    .filter((item) => item.automationTier === "high-potential" && !linkedSignalIds.has(item.id))
    .slice(0, 5);
  const selectedSignals = [...linkedSignals, ...highPotentialSignals]
    .filter((item, index, list) => list.findIndex((other) => other.id === item.id) === index)
    .slice(0, 12)
    .map((item) => buildAgentSignalContext(state, item, { includeFullTranscript: item.id === signalId }));

  const scripts = topic
    ? (state.scripts || [])
      .filter((item) => item.topicId === topic.id)
      .slice(0, 3)
      .map((item) => ({ id: item.id, versionNote: item.versionNote, inputSummary: clipText(item.inputSummary, 400), text: clipText(item.text, 1200) }))
    : [];

  const context = {
    ...(topic ? {
      topic: {
        id: topic.id,
        title: topic.title,
        coreIdea: topic.coreIdea,
        targetReader: topic.targetReader,
        minimalPublishableVersion: topic.minimalPublishableVersion,
        stage: topic.stage,
        platforms: topic.platforms || []
      }
    } : {}),
    ...(focusSignal ? {
      focusSignal: buildAgentSignalContext(state, focusSignal, { includeFullTranscript: true })
    } : {}),
    materials: selectedMaterials,
    signals: selectedSignals,
    scripts: topic ? scripts : []
  };

  const digest = [
    topic ? `选题：${topic.title}` : "任务未绑定选题",
    focusSignal ? `聚焦信号：${focusSignal.title || focusSignal.note || focusSignal.id}` : "",
    focusSignal?.transcriptText ? `逐字稿：${focusSignal.transcriptSegments?.length || 0} 段 · unverified` : "",
    `素材 ${selectedMaterials.length} 条`,
    `信号 ${selectedSignals.length} 条`,
    scripts.length ? `既有稿子版本 ${scripts.length} 个` : ""
  ].filter(Boolean).join(" · ");
  return { context, digest };
}

function agentTaskMarkdown(task, taskContext) {
  const { context, digest } = taskContext;
  return `# Agent Task: ${task.title}

## 执行目标

${task.objective}

${task.outputRequirements ? `## 输出要求\n\n${task.outputRequirements}\n\n` : ""}## 当前工作台上下文

${digest}

\`\`\`json
${JSON.stringify(context, null, 2)}
\`\`\`

## 输出协议

1. 只输出最终结果正文，使用 Markdown。
2. 不要编造来源、数字、时间范围和原文语境。
3. 未核实的信息必须标注“待核对”；引用素材时保留来源链接。
4. 结果由人保存为同目录 \`result.md\`，本地 Codex / Claude 启动脚本会自动完成这一步。
5. 输出前自查：是否回答任务目标、是否有证据缺口、是否给出下一步人工动作。
`;
}

function codexLauncherScript(taskId) {
  return `$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
Set-Location -LiteralPath $PSScriptRoot
$lock = @{ taskId = ${JSON.stringify(taskId)}; pid = $pid; acquiredAt = (Get-Date).ToUniversalTime().ToString("o") }
$lock | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot "task.lock") -Encoding UTF8
$task = Get-Content -LiteralPath (Join-Path $PSScriptRoot "task.md") -Raw -Encoding UTF8
$resultPending = Join-Path $PSScriptRoot "result.pending.md"
$task | codex exec --sandbox read-only --ephemeral --output-last-message $resultPending -
if (-not (Test-Path -LiteralPath $resultPending)) { throw "codex did not create result.md" }
Move-Item -LiteralPath $resultPending -Destination (Join-Path $PSScriptRoot "result.md") -Force
`;
}

function claudeLauncherScript(taskId) {
  return `$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
Set-Location -LiteralPath $PSScriptRoot
$lock = @{ taskId = ${JSON.stringify(taskId)}; pid = $pid; acquiredAt = (Get-Date).ToUniversalTime().ToString("o") }
$lock | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot "task.lock") -Encoding UTF8
$task = Get-Content -LiteralPath (Join-Path $PSScriptRoot "task.md") -Raw -Encoding UTF8
$output = $task | claude -p --restricted --tools "" --output-format text --no-session-persistence
$resultPending = Join-Path $PSScriptRoot "result.pending.md"
Set-Content -LiteralPath $resultPending -Value $output -Encoding UTF8
Move-Item -LiteralPath $resultPending -Destination (Join-Path $PSScriptRoot "result.md") -Force
`;
}

async function writeAgentTaskFiles(task, markdown, configuredDriveRoot = "", mirrorToDrive = false) {
  const taskDir = path.join(agentBridgeOutboxDir, task.id);
  try {
    await fs.mkdir(taskDir, { recursive: true });
    task.outboxPath = taskDir;
    task.drivePath = "";
    task.driveStatus = "not-configured";
    const mirrorDir = configuredDriveRoot ? driveTaskDir(configuredDriveRoot, task.id) : "";
    if (mirrorToDrive) {
      task.drivePath = mirrorDir;
      task.driveStatus = "synced";
    } else if (configuredDriveRoot) {
      task.driveStatus = "local-only";
    }

    const launcherName = localAgentRunners.has(task.agent) ? `run-${task.agent}.ps1` : "";
    const files = {
      "task.json": JSON.stringify(task, null, 2),
      "task.md": markdown,
      "result.md": ""
    };
    for (const [fileName, content] of Object.entries(files)) {
      await fs.writeFile(path.join(taskDir, fileName), content, "utf8");
    }
    if (launcherName) {
      const launcher = task.agent === "codex" ? codexLauncherScript(task.id) : claudeLauncherScript(task.id);
      await fs.writeFile(path.join(taskDir, launcherName), launcher, "utf8");
    }

    if (mirrorToDrive) {
      if (!configuredDriveRoot) throw new Error("未配置 Google Drive 目录，不能镜像任务包");
      const stagingDir = `${mirrorDir}.${crypto.randomUUID().slice(0, 8)}.tmp`;
      await fs.mkdir(stagingDir, { recursive: true });
      try {
        for (const fileName of [...Object.keys(files), launcherName].filter(Boolean)) {
          await fs.copyFile(path.join(taskDir, fileName), path.join(stagingDir, fileName));
        }
        await fs.rename(stagingDir, mirrorDir);
      } catch (error) {
        await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
        throw error;
      }
    }
    return task;
  } catch (error) {
    await fs.rm(taskDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function createAgentTask(state, input = {}) {
  const agent = String(input.agent || "").trim().toLowerCase();
  const kind = String(input.kind || "").trim().toLowerCase();
  const title = clipText(input.title, 120);
  const objective = clipText(input.objective, 3000);
  if (!agentOptions.has(agent)) throw new Error("unknown agent");
  if (!agentTaskKinds.has(kind)) throw new Error("unknown task kind");
  if (!title || !objective) throw new Error("title and objective are required");
  const topicId = String(input.topicId || "").trim();
  if (topicId && !(state.topics || []).some((topic) => topic.id === topicId)) throw new Error("topic not found");
  const signalId = String(input.signalId || "").trim();
  if (signalId && !(state.signals || []).some((signal) => signal.id === signalId)) throw new Error("signal not found");
  if (["outline", "script"].includes(kind) && !topicId) throw new Error("提纲和口播稿任务必须绑定选题");
  const mirrorToDrive = input.mirrorToDrive === true || input.mirrorToDrive === "true";
  if (mirrorToDrive && !state.settings.driveRoot) throw new Error("未配置 Google Drive 目录，不能镜像任务包");

  const { context, digest } = buildAgentTaskContext(state, topicId, signalId);
  const timestamp = now();
  const task = {
    id: id("agent"),
    title,
    agent,
    kind,
    topicId,
    signalId,
    objective,
    outputRequirements: clipText(input.outputRequirements, 2000),
    contextDigest: digest,
    status: "outbox",
    outboxPath: "",
    drivePath: "",
    driveStatus: "not-configured",
    prompt: "",
    resultText: "",
    resultHash: "",
    resultImportedAt: "",
    importedTarget: "",
    lastError: "",
    createdAt: timestamp,
    updatedAt: timestamp
  };
  const markdown = agentTaskMarkdown(task, { context, digest });
  task.prompt = markdown;
  await writeAgentTaskFiles(task, markdown, state.settings.driveRoot, mirrorToDrive);
  state.agentTasks.unshift(task);
  return task;
}

async function latestAgentResult(task) {
  const candidates = [];
  for (const [key, directory] of [["local", task.outboxPath], ["drive", task.drivePath]]) {
    if (!directory) continue;
    const filePath = path.join(directory, "result.md");
    const [stat, text] = await Promise.all([
      fs.stat(filePath).catch(() => null),
      fs.readFile(filePath, "utf8").catch(() => "")
    ]);
    if (stat?.isFile() && text.trim()) candidates.push({ key, filePath, text, modifiedAt: stat.mtimeMs });
  }
  if (!candidates.length) return null;
  return candidates.sort((a, b) => b.modifiedAt - a.modifiedAt)[0];
}

async function scanAgentTaskResults(state, { persist = true } = {}) {
  let changed = false;
  for (const task of state.agentTasks || []) {
    if (!["outbox", "running", "result-ready"].includes(task.status)) continue;
    const result = await latestAgentResult(task);
    if (!result) continue;
    let localRunCleaned = false;
    if (result.key === "local") {
      if (task.localProcessPid != null) {
        task.localProcessPid = null;
        localRunCleaned = true;
      }
      if (runningAgentTaskIds.delete(task.id)) localRunCleaned = true;
      const lockPath = agentTaskLockPath(task.id);
      const hadLock = await fs.stat(lockPath).then((stat) => stat.isFile()).catch(() => false);
      if (hadLock) {
        await fs.rm(lockPath, { force: true }).catch(() => {});
        localRunCleaned = true;
      }
    }
    const hash = crypto.createHash("sha256").update(result.text).digest("hex");
    const unchangedResult = task.resultHash === hash && task.resultText === result.text;
    if (unchangedResult && task.driveStatus !== "sync-error" && !localRunCleaned) continue;

    if (result.key === "drive" && task.outboxPath) {
      await fs.writeFile(path.join(task.outboxPath, "result.md"), result.text, "utf8");
      task.driveStatus = "synced";
    } else if (result.key === "local" && task.drivePath) {
      await fs.writeFile(path.join(task.drivePath, "result.md"), result.text, "utf8").catch(() => {
        task.driveStatus = "sync-error";
      });
      if (task.driveStatus !== "sync-error") task.driveStatus = "synced";
    }
    task.resultText = result.text;
    task.resultHash = hash;
    task.status = "result-ready";
    task.updatedAt = now();
    changed = true;
  }
  if (changed && persist) await writeState(state);
  return { ok: true, changed, readyCount: (state.agentTasks || []).filter((task) => task.status === "result-ready").length };
}

async function importAgentTaskResult(state, taskId) {
  const task = (state.agentTasks || []).find((item) => item.id === taskId);
  if (!task) throw new Error("agent task not found");
  if (task.status === "imported") throw new Error("该任务结果已导入");
  await scanAgentTaskResults(state, { persist: false });
  if (!String(task.resultText || "").trim()) throw new Error("result.md is empty");

  const resultText = String(task.resultText).trim();
  let target = "";
  if (["outline", "script"].includes(task.kind)) {
    importRecords(state, "scripts", [{
      topicId: task.topicId,
      tool: task.agent,
      versionNote: `${task.title} · Agent 结果`,
      inputSummary: task.contextDigest,
      text: resultText
    }]);
    target = "scripts";
    const topic = (state.topics || []).find((item) => item.id === task.topicId);
    if (topic) {
      if (task.kind === "outline" && topic.stage === "topic") {
        validateTopicStageTransition(state, topic, "outline");
        topic.stage = "outline";
        topic.updatedAt = now();
      }
      if (task.kind === "script") {
        if (topic.stage !== "outline") throw new Error("口播稿结果导入前，选题必须先确认提纲阶段");
        validateTopicStageTransition(state, topic, "draft");
        topic.stage = "draft";
        topic.updatedAt = now();
      }
    }
  } else {
    importRecords(state, "materials", [{
      sourceUrl: `workbench://agent-task/${task.id}`,
      platform: "other",
      author: task.agent,
      type: task.kind === "research" || task.kind === "dissect" ? "lead" : "opinion",
      excerpt: resultText.slice(0, 50000),
      whyValuable: `Agent 输出候选：${task.title}`,
      possibleUse: task.kind === "title" ? "title" : task.kind === "visual" ? "case" : "evidence",
      citationNote: "Agent 输出，发布前必须核对原始证据和来源链接",
      evidenceState: "unverified",
      topicIds: task.topicId ? [task.topicId] : []
    }]);
    target = "materials";
  }
  task.status = "imported";
  task.resultImportedAt = now();
  task.importedTarget = target;
  task.updatedAt = now();
  await writeState(state);
  return { ok: true, target, task };
}

async function finishLocalAgentTask(taskId, code, errorMessage = "") {
  await enqueueStateMutation(async () => {
    try {
      const state = await readState();
      const task = state.agentTasks.find((item) => item.id === taskId);
      if (!task || !runningAgentTaskIds.has(taskId)) return;
      if (code === 0) {
        await scanAgentTaskResults(state, { persist: false });
        if (task.status !== "result-ready") {
          task.status = "outbox";
          task.lastError = "本机 Agent 已结束，但没有生成 result.md";
          task.updatedAt = now();
        }
      } else {
        task.status = "outbox";
        task.lastError = errorMessage || `本机 Agent 退出码 ${code}`;
        task.updatedAt = now();
      }
      task.localProcessPid = null;
      await writeState(state);
      await fs.rm(agentTaskLockPath(taskId), { force: true }).catch(() => {});
    } catch (error) {
      console.error(`Agent task ${taskId} finish handling failed: ${error.message}`);
    } finally {
      runningAgentTaskIds.delete(taskId);
    }
  });
}

function agentTaskLockPath(taskId) {
  return path.join(agentBridgeOutboxDir, taskId, "task.lock");
}

async function readAgentTaskLock(taskId) {
  const raw = await fs.readFile(agentTaskLockPath(taskId), "utf8").catch(() => "");
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  if (!text.trim()) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && Number(parsed.pid) > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function processPidAppearsAlive(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function recoverDetachedAgentTasks(state) {
  let changed = false;
  for (const task of state.agentTasks || []) {
    if (task.status === "imported") {
      const lockPath = agentTaskLockPath(task.id);
      const lock = await readAgentTaskLock(task.id);
      const lockExists = await fs.stat(lockPath).then((stat) => stat.isFile()).catch(() => false);
      if (task.localProcessPid == null && !lockExists) continue;
      if (task.localProcessPid != null && processPidAppearsAlive(task.localProcessPid)) continue;
      if (lock?.pid && processPidAppearsAlive(lock.pid)) continue;

      const resultText = task.outboxPath
        ? await fs.readFile(path.join(task.outboxPath, "result.md"), "utf8").catch(() => "")
        : "";
      if (!resultText.trim() || !task.resultHash) continue;
      const resultHash = crypto.createHash("sha256").update(resultText).digest("hex");
      if (resultHash !== task.resultHash) continue;

      task.localProcessPid = null;
      task.localRunMetadataCleanedAt = now();
      runningAgentTaskIds.delete(task.id);
      await fs.rm(lockPath, { force: true }).catch(() => {});
      changed = true;
      continue;
    }
    if (task.status !== "running") continue;
    const lock = await readAgentTaskLock(task.id);
    if (lock?.pid && processPidAppearsAlive(lock.pid)) {
      task.localProcessPid = lock.pid;
      task.lastError = "服务重启后检测到本机 Agent 进程仍在运行，等待结果回流";
      task.updatedAt = now();
    } else {
      const startedAt = Date.parse(task.localRunStartedAt || "");
      const withinSpawnGrace = runningAgentTaskIds.has(task.id)
        && Number.isFinite(startedAt)
        && Date.now() - startedAt < 10_000;
      if (withinSpawnGrace) continue;
      runningAgentTaskIds.delete(task.id);
      task.status = "outbox";
      task.localProcessPid = null;
      task.lastError = "本机 Agent 进程已退出但没有生成结果；请重跑或扫描结果";
      task.updatedAt = now();
      await fs.rm(agentTaskLockPath(task.id), { force: true }).catch(() => {});
    }
    changed = true;
  }
  return changed;
}

async function recoverInterruptedAgentTasks() {
  await enqueueStateMutation(async () => {
    const state = await readState();
    const recovered = await recoverDetachedAgentTasks(state);
    if (recovered) await writeState(state);
    await scanAgentTaskResults(state);
  });
}

let automationTickBusy = false;
let morningPipelineBusy = false;

function schedulerOwnedByMorningPipeline(options = {}) {
  return morningPipelineBusy && options.fromMorningPipeline !== true;
}

async function runAutomationTickQueued(force, options = {}) {
  if (schedulerOwnedByMorningPipeline(options)) {
    return { ok: true, skipped: true, reason: "morning pipeline owns scheduler" };
  }
  if (automationTickBusy) {
    return { ok: true, skipped: true, reason: "previous automation tick is still running" };
  }
  automationTickBusy = true;
  try {
    const publicResult = await enqueueStateMutation(() => runAutomationTick(force));
    const accountResult = await refreshAccountWatchQueued({
      force,
      trigger: "account-watch",
      manual: false
    });
    if (accountResult?.skipped || accountResult?.ok === false) {
      return publicResult;
    }
    const results = [...(publicResult.results || []), ...(accountResult.results || [])];
    return {
      ...publicResult,
      total: Number(publicResult.total || 0) + Number(accountResult.total || 0),
      okCount: Number(publicResult.okCount || 0) + Number(accountResult.okCount || 0),
      blocked: Number(publicResult.blocked || 0) + Number(accountResult.blocked || 0),
      failed: Number(publicResult.failed || 0) + Number(accountResult.failed || 0),
      skipped: Number(publicResult.skipped || 0) + Number(accountResult.skipped || 0),
      accountWatch: accountResult,
      results
    };
  } finally {
    automationTickBusy = false;
  }
}

let dropScanBusy = false;
async function runDropFolderScanQueued(trigger, allowDisabled, options = {}) {
  if (schedulerOwnedByMorningPipeline(options)) {
    return { ok: true, skipped: true, reason: "morning pipeline owns scheduler" };
  }
  if (dropScanBusy) {
    return { ok: true, skipped: true, reason: "previous drop scan is still running" };
  }
  dropScanBusy = true;
  try {
    return await enqueueStateMutation(() => runDropFolderScan(trigger, allowDisabled));
  } finally {
    dropScanBusy = false;
  }
}

async function runQuickCaptureQueued(text, sourceId) {
  return enqueueStateMutation(() => runQuickCapture(text, sourceId));
}

async function startLocalAgentTask(state, taskId) {
  const task = (state.agentTasks || []).find((item) => item.id === taskId);
  if (!task) throw new Error("agent task not found");
  if (!localAgentRunners.has(task.agent)) throw new Error("只有 Codex 和 Claude 支持本机一键运行");
  if (runningAgentTaskIds.has(taskId)) throw new Error("该 Agent 任务正在运行");
  if (task.status === "imported") throw new Error("该任务结果已导入，请新建任务继续迭代");
  const launcher = path.join(task.outboxPath || path.join(agentBridgeOutboxDir, taskId), `run-${task.agent}.ps1`);
  await fs.access(launcher);
  const lockPath = agentTaskLockPath(taskId);
  const oldLock = await readAgentTaskLock(taskId);
  if (oldLock?.pid && processPidAppearsAlive(oldLock.pid)) {
    throw new Error(`该任务仍有本机 Agent 进程 ${oldLock.pid}，不能重复运行`);
  }
  await fs.rm(lockPath, { force: true }).catch(() => {});
  const lockHandle = await fs.open(lockPath, "wx");
  await lockHandle.writeFile(JSON.stringify({
    taskId,
    pid: 0,
    acquiredAt: now()
  }, null, 2), "utf8");
  await lockHandle.close();
  task.status = "running";
  task.lastError = "";
  task.localRunStartedAt = now();
  task.updatedAt = now();
  runningAgentTaskIds.add(taskId);
  await writeState(state);
  let child;
  try {
    child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", launcher], {
      cwd: path.dirname(launcher),
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
  } catch (error) {
    task.status = "outbox";
    task.lastError = error.message;
    task.updatedAt = now();
    runningAgentTaskIds.delete(taskId);
    await fs.rm(lockPath, { force: true }).catch(() => {});
    await writeState(state);
    throw error;
  }
  task.localProcessPid = child.pid || null;
  await writeState(state);
  child.on("error", (error) => finishLocalAgentTask(taskId, 1, error.message));
  child.on("exit", (code) => finishLocalAgentTask(taskId, code || 0));
  child.unref();
  return { ok: true, task };
}

const topicStageOrder = [
  "topic",
  "outline",
  "draft",
  "production",
  "review",
  "ready-to-publish",
  "published",
  "reviewed"
];
const requiredPublishPlatforms = ["douyin", "xiaohongshu", "wechat"];
const updatableFields = {
  signals: ["title", "author", "disposition", "note", "engagement", "seen"],
  sources: ["authorMedianEngagement"],
  materials: ["platform", "type", "author", "possibleUse", "excerpt", "whyValuable", "citationNote"],
  topics: ["title", "coreIdea", "targetReader", "minimalPublishableVersion", "stage", "productionChecks", "gates"]
};
const editableSettingFields = ["inboxTime", "inboxDailyLimit"];

function patchRecord(type, record, patch = {}) {
  const allowedFields = updatableFields[type];
  if (!allowedFields) throw new Error("record type is not editable");
  if (!patch || Array.isArray(patch) || typeof patch !== "object") throw new Error("patch must be an object");

  const suppliedFields = Object.keys(patch);
  const unsupportedFields = suppliedFields.filter((field) => !allowedFields.includes(field));
  if (unsupportedFields.length) throw new Error(`fields are not editable: ${unsupportedFields.join(", ")}`);
  if (!suppliedFields.length) throw new Error("patch cannot be empty");

  const updated = { ...record };
  for (const field of suppliedFields) {
    if (type === "topics" && (field === "productionChecks" || field === "gates")) {
      if (!patch[field] || Array.isArray(patch[field]) || typeof patch[field] !== "object") {
        throw new Error(`${field} must be an object`);
      }
      updated[field] = { ...(record[field] || {}), ...patch[field] };
    } else {
      updated[field] = patch[field];
    }
  }
  return updated;
}

function validateSettingsPatch(patch = {}) {
  if (!patch || Array.isArray(patch) || typeof patch !== "object") throw new Error("patch must be an object");
  const suppliedFields = Object.keys(patch);
  if (!suppliedFields.length) throw new Error("patch cannot be empty");

  const unsupportedFields = suppliedFields.filter((field) => !editableSettingFields.includes(field));
  if (unsupportedFields.length) throw new Error(`fields are not editable: ${unsupportedFields.join(", ")}`);

  const validated = {};
  if (Object.hasOwn(patch, "inboxTime")) {
    if (typeof patch.inboxTime !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(patch.inboxTime)) {
      throw new Error("inboxTime must use HH:MM in 24-hour time");
    }
    validated.inboxTime = patch.inboxTime;
  }
  if (Object.hasOwn(patch, "inboxDailyLimit")) {
    if (!Number.isInteger(patch.inboxDailyLimit) || patch.inboxDailyLimit < 1 || patch.inboxDailyLimit > 100) {
      throw new Error("inboxDailyLimit must be an integer between 1 and 100");
    }
    validated.inboxDailyLimit = patch.inboxDailyLimit;
  }
  return validated;
}

function validatePublicationRecord(state, record = {}) {
  if (record.status !== "published") return;
  const topic = (state.topics || []).find((item) => item.id === record.topicId);
  if (!topic) throw new Error("published publication must be linked to a topic");
  if (!["ready-to-publish", "published"].includes(topic.stage)) {
    throw new Error("选题到达待发阶段后，才能记录已发布");
  }
}

function validateTopicStageTransition(state, topic, nextStage) {
  const currentIndex = topicStageOrder.indexOf(topic.stage);
  const nextIndex = topicStageOrder.indexOf(nextStage);
  if (currentIndex < 0 || nextIndex < 0) throw new Error("unknown topic stage");
  if (nextIndex !== currentIndex + 1) throw new Error("选题阶段只能逐级推进，不能跳级或回退");

  if (topic.stage === "production") {
    const gates = topic.gates || {};
    const missingGates = ["evidence", "opening", "sample", "final"].filter((key) => gates[key] !== true);
    if (missingGates.length) throw new Error(`四个人工关卡未全部通过：${missingGates.join("、")}`);
  }
  if (topic.stage === "review") {
    const checks = topic.productionChecks || {};
    const missingChecks = ["coreIdea", "targetReader", "hook", "outline", "evidence", "visuals", "publishPackage"]
      .filter((key) => checks[key] !== true);
    if (missingChecks.length) throw new Error(`七项生产检查未全部通过：${missingChecks.join("、")}`);
  }
  if (nextStage === "published") {
    const published = new Set((state.publications || [])
      .filter((item) => item.topicId === topic.id && item.status === "published")
      .map((item) => item.platform));
    const missingPlatforms = requiredPublishPlatforms.filter((platform) => !published.has(platform));
    if (missingPlatforms.length) throw new Error(`抖音、小红书、公众号未全部发布：缺 ${missingPlatforms.join("、")}`);
  }
  if (nextStage === "reviewed") {
    const hasReview = (state.reviews || []).some((item) => item.topicId === topic.id);
    if (!hasReview) throw new Error("先保存复盘记录，才能标记已复盘");
  }
}

let agentResultScanBusy = false;
async function runAgentResultScanQueued(options = {}) {
  if (schedulerOwnedByMorningPipeline(options)) {
    return { ok: true, skipped: true, reason: "morning pipeline owns scheduler" };
  }
  if (agentResultScanBusy) {
    return { ok: true, skipped: true, reason: "previous agent result scan is still running" };
  }
  agentResultScanBusy = true;
  try {
    return await enqueueStateMutation(async () => {
      const state = await readState();
      const recovered = await recoverDetachedAgentTasks(state);
      const result = await scanAgentTaskResults(state);
      if (recovered) await writeState(state);
      return result;
    });
  } finally {
    agentResultScanBusy = false;
  }
}

function morningPipelineCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

function initialMorningPipelineOperations(startedAt) {
  return {
    dropFolder: {
      status: "running",
      startedAt,
      finishedAt: "",
      total: 0,
      created: 0,
      failed: 0,
      pending: 0,
      results: []
    },
    collection: {
      status: "running",
      startedAt,
      finishedAt: "",
      total: 0,
      failed: 0,
      blocked: 0,
      skipped: 0,
      envelope: null
    },
    agentResults: {
      status: "running",
      startedAt,
      finishedAt: "",
      changed: false,
      readyCount: 0
    }
  };
}

function morningPipelineOperationFromResult(stage, result, previous = {}) {
  const value = result && typeof result === "object" ? result : {};
  const results = Array.isArray(value.results) ? value.results : [];
  const nestedStatusCount = (status) => results.filter((item) => item?.status === status).length;
  const errors = [
    value.error,
    value.failureReason,
    ...results
      .filter((item) => ["failed", "pending", "blocked"].includes(item?.status))
      .map((item) => item?.error || item?.failureReason)
  ].map((item) => String(item || "").trim()).filter(Boolean);

  return {
    ...previous,
    status: operationStatusFromResult(value),
    startedAt: previous.startedAt || now(),
    finishedAt: now(),
    total: morningPipelineCount(value.total),
    created: morningPipelineCount(value.created),
    failed: Math.max(morningPipelineCount(value.failed), nestedStatusCount("failed")),
    blocked: Math.max(morningPipelineCount(value.blocked), nestedStatusCount("blocked")),
    pending: Math.max(morningPipelineCount(value.pending), nestedStatusCount("pending")),
    partial: Math.max(morningPipelineCount(value.partial), nestedStatusCount("partial")),
    skipped: Math.max(morningPipelineCount(value.skipped), value.skipped === true ? 1 : 0),
    okCount: morningPipelineCount(value.okCount),
    changed: value.changed === true,
    readyCount: morningPipelineCount(value.readyCount),
    envelope: value.envelope || previous.envelope || null,
    reason: String(value.reason || ""),
    error: errors[0] || "",
    results: results.slice(0, 20).map((item) => ({
      fileName: String(item?.fileName || ""),
      status: String(item?.status || ""),
      created: morningPipelineCount(item?.created),
      duplicates: morningPipelineCount(item?.duplicates),
      invalid: morningPipelineCount(item?.invalid),
      error: String(item?.error || item?.failureReason || "")
    })),
    stage
  };
}

function failedMorningPipelineOperation(previous = {}, error) {
  return {
    ...previous,
    status: "failed",
    finishedAt: now(),
    error: String(error?.message || error || "unknown pipeline operation error")
  };
}

async function updateMorningPipelineRecord(runId, mutate, { final = false } = {}) {
  return enqueueStateMutation(async () => {
    const state = await readState();
    const index = (state.morningPipelineRuns || []).findIndex((item) => item.id === runId);
    if (index < 0) throw new Error("morning pipeline run record not found");

    const record = {
      ...state.morningPipelineRuns[index],
      operations: { ...(state.morningPipelineRuns[index].operations || {}) },
      updatedAt: now()
    };
    mutate(record, state);
    if (final) {
      record.finishedAt = now();
      record.briefChanged = refreshMorningBrief(state);
    }
    record.status = aggregatePipelineStatus(record.operations);
    const pipeline = morningPipelineRuntime(state, {
      automationEnabled: automationEnabled(state),
      lastRun: record,
      accountWatch: buildAccountWatchRuntime(state)
    });
    record.stages = pipeline.stages;
    record.nextActions = pipeline.nextActions;

    state.morningPipelineRuns[index] = record;
    state.morningPipelineRuns = [
      record,
      ...state.morningPipelineRuns.filter((item) => item.id !== runId)
    ].slice(0, 30);
    await writeState(state, final ? {} : { backup: false });
    return record;
  });
}

async function runMorningPipelineQueued() {
  if (morningPipelineBusy) {
    throw new Error("previous morning pipeline is still running");
  }
  morningPipelineBusy = true;
  const startedAt = now();
  const runId = id("morning-pipeline");
  const operationResults = {};
  try {
    await enqueueStateMutation(async () => {
      const state = await readState();
      const record = {
        id: runId,
        status: "running",
        startedAt,
        updatedAt: startedAt,
        finishedAt: "",
        briefChanged: false,
        stages: [],
        nextActions: [],
        operations: initialMorningPipelineOperations(startedAt)
      };
      const pipeline = morningPipelineRuntime(state, {
        automationEnabled: automationEnabled(state),
        lastRun: record,
        accountWatch: buildAccountWatchRuntime(state)
      });
      record.stages = pipeline.stages;
      record.nextActions = pipeline.nextActions;
      state.morningPipelineRuns = [record, ...(state.morningPipelineRuns || [])].slice(0, 30);
      await writeState(state, { backup: false });
    });

    const stages = [
      {
        name: "dropFolder",
        run: () => runDropFolderScanQueued("morning-pipeline", true, { fromMorningPipeline: true })
      },
      {
        name: "collection",
        run: () => runAutomationTickQueued(false, { fromMorningPipeline: true })
      },
      {
        name: "agentResults",
        run: () => runAgentResultScanQueued({ fromMorningPipeline: true })
      }
    ];

    for (const stage of stages) {
      let result;
      try {
        result = await stage.run();
        operationResults[stage.name] = result;
      } catch (error) {
        operationResults[stage.name] = { ok: false, status: "failed", error: error.message };
        await updateMorningPipelineRecord(runId, (record) => {
          record.operations[stage.name] = failedMorningPipelineOperation(record.operations[stage.name], error);
        });
        continue;
      }
      await updateMorningPipelineRecord(runId, (record) => {
        record.operations[stage.name] = morningPipelineOperationFromResult(
          stage.name,
          result,
          record.operations[stage.name]
        );
      });
    }

    const run = await updateMorningPipelineRecord(runId, () => {}, { final: true });
    const operationResult = (name) => ({
      ...(operationResults[name] && typeof operationResults[name] === "object" ? operationResults[name] : {}),
      status: run.operations?.[name]?.status || "unknown"
    });
    return {
      ok: true,
      completed: true,
      run,
      dropFolder: operationResult("dropFolder"),
      collection: operationResult("collection"),
      agentResults: operationResult("agentResults")
    };
  } finally {
    morningPipelineBusy = false;
  }
}

async function handleApi(request, response, pathname) {
  if (!apiOriginAllowed(request, pathname)) {
    return sendJson(response, 403, { ok: false, error: "origin not allowed" }, request);
  }

  if (request.method === "OPTIONS" && pathname.startsWith("/api/")) {
    const headers = browserCapturePaths.has(pathname)
      ? browserCaptureCorsHeaders(request)
      : corsHeaders(request);
    if (!headers["access-control-allow-origin"]) {
      return sendJson(response, 403, { ok: false, error: "origin not allowed" }, request);
    }
    response.writeHead(204, { "cache-control": "no-store", ...headers });
    return response.end();
  }

  if (request.method === "GET" && pathname === "/api/state") {
    const state = await readState();
    return sendJson(response, 200, { ...state, runtime: runtimeState(state) }, request);
  }

  if (request.method === "GET" && pathname === "/api/agent-plugin/manifest") {
    return sendJson(response, 200, agentPluginManifest({ baseUrl: `http://127.0.0.1:${activePort}` }), request);
  }

  if (request.method === "GET" && pathname === "/api/platform-capabilities") {
    const state = await readState();
    return sendJson(response, 200, platformCapabilityRuntime(state), request);
  }

  if (request.method === "GET" && pathname === "/api/export") {
    const state = await readState();
    response.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": 'attachment; filename="workbench-export.json"'
    });
    return response.end(JSON.stringify(state, null, 2));
  }

  if (request.method === "GET" && pathname === "/api/backups") {
    return sendJson(response, 200, { ok: true, ...(await listBackups()) }, request);
  }

  if ((request.method === "GET" || request.method === "HEAD") && pathname === "/api/media/cover") {
    return servePlatformCover(request, response);
  }

  if (request.method !== "POST") return sendJson(response, 405, { error: "method not allowed" }, request);

  let body;
  try {
    body = await readBody(request);
  } catch (error) {
    const captureOrigin = browserCapturePaths.has(pathname) && requestOrigin(request) === "https://www.xiaohongshu.com";
    const headers = captureOrigin ? browserCaptureCorsHeaders(request) : undefined;
    const status = error instanceof RequestBodyError ? error.status : 400;
    return sendJson(response, status, { ok: false, error: error.message }, request, headers || undefined);
  }
  const isXhsCapture = browserCapturePaths.has(pathname) && requestOrigin(request) === "https://www.xiaohongshu.com";
  if (isXhsCapture) {
    const token = browserCaptureTokens.get(String(body.sourceId || ""));
    const supplied = String(request.headers["x-capture-token"] || "");
    if (!token || token.expiresAt <= Date.now() || supplied !== token.token) {
      return sendJson(response, 401, { ok: false, error: "capture token is invalid or expired" }, request, browserCaptureCorsHeaders(request));
    }
  }

  try {
    if (pathname === "/api/backups/create") {
      const result = await enqueueStateMutation(async () => createBackup(await readState(), "manual"));
      return sendJson(response, 200, { ok: true, backup: result }, request);
    }

    if (pathname === "/api/backups/restore") {
      const filename = String(body.filename || body.id || "");
      const result = await enqueueStateMutation(() => restoreBackup(filename));
      return sendJson(response, 200, result, request);
    }

    if (pathname === "/api/import") {
      const result = await enqueueStateMutation(async () => {
        const state = await readState();
        const totals = {};
        for (const type of ["sources", "signals", "materials", "topics"]) {
          totals[type] = importRecords(state, type, body[type] || []);
        }
        refreshEngagementMetrics(state);
        await writeState(state);
        return { ok: true, totals };
      });
      return sendJson(response, 200, result, request);
    }

    if (pathname === "/api/xhs/guest-capture") {
      const isPlainObject = body && typeof body === "object" && !Array.isArray(body);
      const fields = isPlainObject ? Object.keys(body) : [];
      if (fields.some((field) => field !== "text")) {
        return sendJson(response, 400, {
          ok: false,
          error: "guest capture accepts only the text field; cookies, tokens, profiles, and capture payloads are not accepted"
        }, request);
      }
      const text = isPlainObject && typeof body.text === "string" ? body.text.trim() : "";
      if (!text) {
        return sendJson(response, 400, {
          ok: false,
          error: "text is required and must contain a Xiaohongshu share link or share text"
        }, request);
      }
      const captureKey = crypto.createHash("sha256").update(text).digest("hex");
      if (runningXhsCaptureIds.has(captureKey)) {
        return sendJson(response, 409, {
          ok: false,
          error: "the same Xiaohongshu capture is already running"
        }, request);
      }

      runningXhsCaptureIds.add(captureKey);
      const captureRunId = id("capture");
      const startedAt = now();
      try {
        await enqueueStateMutation(async () => {
          const state = await readState();
          state.captureRuns.unshift({
            id: captureRunId,
            status: "running",
            trigger: "xiaohongshu-guest-chrome",
            startedAt,
            updatedAt: startedAt,
            finishedAt: "",
            captureState: "starting",
            reason: "已接受采集任务，正在解析分享链接。",
            humanAction: "",
            noteId: "",
            captureUrl: "",
            signalId: "",
            created: 0,
            transcriptStatus: "",
            mediaCount: 0,
            warnings: []
          });
          await writeState(state, { backup: false });
        });

        const captured = await captureXhsGuestNote(text, {
          runId: captureRunId,
          onStatus: (payload) => persistXhsCaptureProgress(captureRunId, payload)
        });
        const final = await enqueueStateMutation(async () => {
          const state = await readState();
          const run = (state.captureRuns || []).find((item) => item.id === captureRunId);
          let persisted = null;
          let persistenceError = "";
          if (captured.ok) {
            try {
              persisted = persistXhsGuestCapture(state, captured);
            } catch (error) {
              persistenceError = String(error?.message || error).slice(0, 2000);
            }
          }
          const finalStatus = captured.ok && persisted ? "captured" : (captured.status || "failed");
          if (run) {
            Object.assign(run, {
              status: finalStatus,
              captureState: captured.capture?.captureState || run.captureState || "",
              noteId: captured.capture?.noteId || run.noteId || "",
              captureUrl: normalizeUrl(captured.finalUrl || run.captureUrl || ""),
              reason: persistenceError || captured.reason || run.reason || "",
              humanAction: captured.humanAction || run.humanAction || "",
              signalId: persisted?.signal?.id || "",
              created: persisted?.created ? 1 : 0,
              transcriptStatus: persisted?.transcriptStatus || "",
              mediaCount: persisted?.mediaCount || 0,
              warnings: Array.isArray(captured.warnings) ? captured.warnings.slice(0, 20) : [],
              finishedAt: now(),
              updatedAt: now()
            });
          }
          await writeState(state, { backup: false });
          return {
            ok: Boolean(captured.ok && persisted),
            status: finalStatus,
            runId: captureRunId,
            finalUrl: captured.finalUrl || "",
            reason: persistenceError || captured.reason || "",
            humanAction: captured.humanAction || "",
            warnings: Array.isArray(captured.warnings) ? captured.warnings : [],
            signalId: persisted?.signal?.id || "",
            created: Boolean(persisted?.created),
            transcriptStatus: persisted?.transcriptStatus || "",
            mediaCount: persisted?.mediaCount || 0,
            captureRun: publicCaptureRun(run || {
              id: captureRunId,
              status: finalStatus,
              startedAt,
              finishedAt: now()
            })
          };
        });
        return sendJson(response, 200, final, request);
      } finally {
        runningXhsCaptureIds.delete(captureKey);
      }
    }

    if (pathname === "/api/source-intake") {
      const result = await enqueueStateMutation(async () => {
        const state = await readState();
        const intake = await importSourceIntake(state, body.text);
        await writeState(state);
        return intake;
      });
      return sendJson(response, 200, result, request);
    }

    if (pathname === "/api/source-intake/batch") {
      const result = await enqueueStateMutation(async () => {
        const state = await readState();
        const intake = await runBatchSourceIntake(state, body.text);
        await writeState(state);
        return intake;
      });
      return sendJson(response, 200, result, request);
    }

    if (pathname === "/api/evidence-packages/create") {
      const signalId = String(body.signalId || "");
      if (!signalId) return sendJson(response, 400, { ok: false, error: "signalId is required" }, request);
      const result = await enqueueStateMutation(async () => {
        const state = await readState();
        const created = await createSignalEvidencePackage({ state, signalId, evidenceRoot });
        await writeState(state);
        return { ok: true, ...created };
      });
      return sendJson(response, 200, result, request);
    }

    if (pathname === "/api/evidence-packages/verify") {
      const evidenceId = String(body.id || "");
      if (!evidenceId) return sendJson(response, 400, { ok: false, error: "id is required" }, request);
      const result = await enqueueStateMutation(async () => {
        const state = await readState();
        const record = await verifyEvidencePackage(state, evidenceId, body, evidenceRoot);
        await writeState(state);
        return { ok: true, record };
      });
      return sendJson(response, 200, result, request);
    }

    if (pathname === "/api/record") {
      const type = body.type;
      const allowed = ["sources", "signals", "materials", "topics", "scripts", "publications", "reviews", "frictionLog"];
      if (!allowed.includes(type)) return sendJson(response, 400, { error: "unknown record type" }, request);
      const result = await enqueueStateMutation(async () => {
        const state = await readState();
        const sourceRecord = body.record || {};
        const requestedId = String(sourceRecord.id || "");
        if (type === "publications") validatePublicationRecord(state, sourceRecord);
        const previousIds = new Set((state[type] || []).map((item) => item.id).filter(Boolean));
        const totals = importRecords(state, type, [sourceRecord]);
        const identity = new Set(identityKeys(type, sourceRecord).filter(Boolean));
        const record = (state[type] || []).find((item) =>
          (requestedId && item.id === requestedId) ||
          identityKeys(type, item).some((key) => identity.has(key))
        ) || (state[type] || []).find((item) => !previousIds.has(item.id)) || null;
        refreshEngagementMetrics(state);
        await writeState(state);
        return { ok: true, ...totals, record };
      });
      return sendJson(response, 200, result, request);
    }

    if (pathname === "/api/reviews/save") {
      const advanceToReviewed = body.advanceToReviewed === true;
      const result = await enqueueStateMutation(async () => {
        const state = await readState();
        const record = body.record || {};
        const topic = (state.topics || []).find((item) => item.id === record.topicId);
        if (!topic) throw new Error("复盘必须关联一个已存在的选题");
        const totals = importRecords(state, "reviews", [record]);

        if (advanceToReviewed) {
          if (topic.stage !== "published") {
            throw new Error("只有已发选题保存复盘后，才能自动进入已复盘");
          }
          validateTopicStageTransition(state, topic, "reviewed");
          const topicIndex = state.topics.findIndex((item) => item.id === topic.id);
          state.topics[topicIndex] = { ...topic, stage: "reviewed", updatedAt: now() };
        }

        refreshEngagementMetrics(state);
        await writeState(state);
        return { ok: true, ...totals };
      });
      return sendJson(response, 200, result, request);
    }

    if (pathname === "/api/update") {
      const result = await enqueueStateMutation(async () => {
        const state = await readState();
        const { type, id: recordId, patch = {} } = body;
        if (type === "settings") {
          const settingsPatch = validateSettingsPatch(patch);
          Object.assign(state.settings, settingsPatch);
          await writeState(state);
          return { ok: true, settings: state.settings };
        }
        if (!updatableFields[type]) throw new Error("unknown or read-only record type");
        if (!Array.isArray(state[type])) throw new Error("record type is invalid");
        const index = state[type].findIndex((record) => record.id === recordId);
        if (index < 0) throw new Error("record not found");
        const record = state[type][index];
        const nextRecord = { ...patchRecord(type, record, patch), id: recordId, updatedAt: now() };
        if (type === "topics" && nextRecord.stage !== record.stage) {
          validateTopicStageTransition(state, record, patch.stage);
        }
        state[type][index] = nextRecord;
        refreshEngagementMetrics(state);
        await writeState(state);
        return { ok: true, record: state[type][index] };
      });
      return sendJson(response, 200, result, request);
    }

    if (pathname === "/api/collect") {
      const run = await enqueueStateMutation(async () => {
        const state = await readState();
        const collected = await collectWithLock(state, body.sourceId, "manual");
        if (collected) {
          refreshEngagementMetrics(state);
          await writeState(state);
        }
        return collected;
      });
      if (run) return sendJson(response, 200, { ok: true, run }, request);
      return sendJson(response, 409, { ok: false, error: "source is already running" }, request);
    }

    if (pathname === "/api/accounts/refresh") {
      const result = await refreshAccountWatchQueued({
        sourceId: String(body.sourceId || "").trim(),
        trigger: "account-watch",
        force: true,
        manual: true
      });
      return sendJson(response, 200, result, request);
    }

    if (pathname === "/api/automation/tick") {
      const result = await runAutomationTickQueued(body.force === true);
      return sendJson(response, 200, result, request);
    }

    if (pathname === "/api/morning-pipeline/run") {
      const result = await runMorningPipelineQueued();
      return sendJson(response, 200, result, request);
    }

    if (pathname === "/api/automation/settings") {
      if (typeof body.automationEnabled !== "boolean") {
        return sendJson(response, 400, { ok: false, error: "automationEnabled must be boolean" }, request);
      }
      const result = await enqueueStateMutation(async () => {
        const state = await readState();
        state.settings.automationEnabled = body.automationEnabled;
        await writeState(state);
        return { ok: true, settings: state.settings };
      });
      return sendJson(response, 200, result, request);
    }

    if (pathname === "/api/agent-bridge/settings") {
      const result = await enqueueStateMutation(async () => {
        const state = await readState();
        state.settings.driveRoot = await validateDriveRoot(body.driveRoot);
        await writeState(state);
        return { ok: true, settings: state.settings };
      });
      return sendJson(response, 200, result, request);
    }

    if (pathname === "/api/agent-tasks/create") {
      const result = await enqueueStateMutation(async () => {
        const state = await readState();
        const task = await createAgentTask(state, body);
        await writeState(state);
        return { ok: true, task };
      });
      return sendJson(response, 200, result, request);
    }

    if (pathname === "/api/agent-tasks/scan") {
      const result = await enqueueStateMutation(async () => {
        const state = await readState();
        return scanAgentTaskResults(state);
      });
      return sendJson(response, 200, result, request);
    }

    if (pathname === "/api/agent-tasks/run") {
      const result = await enqueueStateMutation(async () => {
        const state = await readState();
        return startLocalAgentTask(state, body.id);
      });
      return sendJson(response, 200, result, request);
    }

    if (pathname === "/api/agent-tasks/import") {
      const result = await enqueueStateMutation(async () => {
        const state = await readState();
        return importAgentTaskResult(state, body.id);
      });
      return sendJson(response, 200, result, request);
    }

    if (pathname === "/api/drop-folder/scan") {
      const result = await runDropFolderScanQueued("drop-folder-manual", true);
      return sendJson(response, 200, result, request);
    }

    if (pathname === "/api/capture") {
      if (!String(body.text || "").trim()) {
        return sendJson(response, 400, { ok: false, error: "text is required" }, request);
      }
      const result = await runQuickCaptureQueued(body.text, body.sourceId);
      return sendJson(response, result.ok ? 200 : 400, result, request);
    }

    if (pathname === "/api/signals/transcript") {
      const result = await runSignalTranscription(body.signalId, body.force === true, {
        background: body.background === true
      });
      return sendJson(response, 200, result, request);
    }

    if (pathname === "/api/signals/analysis") {
      const signalId = String(body.signalId || "").trim();
      if (!signalId) return sendJson(response, 400, { ok: false, error: "signalId is required" }, request);
      const result = await enqueueStateMutation(async () => {
        const state = await readState();
        const candidate = createTranscriptAnalysis({ state, signalId });
        const latest = latestAnalysisForSignal(state, signalId);
        if (body.force !== true && latest?.input?.transcriptHash === candidate.input.transcriptHash) {
          return { ok: true, reused: true, analysis: latest };
        }
        state.analysisRuns.unshift(candidate);
        await writeState(state);
        return { ok: true, reused: false, analysis: candidate };
      });
      return sendJson(response, 200, result, request);
    }

    if (pathname === "/api/knowledge/export") {
      const result = await enqueueStateMutation(async () => {
        const state = await readState();
        const requestedDriveRoot = String(body.driveRoot || state.settings.driveRoot || "").trim();
        const driveRoot = await validateDriveRoot(requestedDriveRoot);
        const exported = await exportKnowledgeToDrive({ state, driveRoot });
        const record = {
          id: exported.exportId,
          status: "completed",
          evidenceState: exported.manifest.evidenceState,
          targetRoot: exported.targetRoot,
          analysisCount: exported.analysisCount,
          transcriptCount: exported.transcriptCount,
          fileCount: exported.fileCount,
          generatedAt: exported.generatedAt,
          createdAt: now()
        };
        state.knowledgeExports.unshift(record);
        await writeState(state);
        return { ok: true, export: record };
      });
      return sendJson(response, 200, result, request);
    }

    if (pathname === "/api/browser-capture") {
      const result = await enqueueStateMutation(async () => {
        const state = await readState();
        const run = importBrowserCapture(
          state,
          body.sourceId,
          body.items,
          body.blockedItems || [],
          body.context || {}
        );
        await writeState(state);
        return { ok: true, run };
      });
      const headers = isXhsCapture ? browserCaptureCorsHeaders(request) : undefined;
      return sendJson(response, 200, result, request, headers || undefined);
    }

    if (pathname === "/api/browser-detail-capture") {
      const result = await enqueueStateMutation(async () => {
        const state = await readState();
        const result = importBrowserDetailCapture(state, body.signalId, body.sourceId, body.capture);
        await writeState(state);
        return { ok: true, ...result };
      });
      const headers = isXhsCapture ? browserCaptureCorsHeaders(request) : undefined;
      return sendJson(response, 200, result, request, headers || undefined);
    }

    return sendJson(response, 404, { error: "not found" }, request);
  } catch (error) {
    const headers = isXhsCapture ? browserCaptureCorsHeaders(request) : undefined;
    return sendJson(response, 400, { ok: false, error: error.message }, request, headers || undefined);
  }
}

async function serveStatic(request, response, pathname) {
  const method = request.method || "GET";
  if (method !== "GET" && method !== "HEAD") {
    response.writeHead(405, { "content-type": "text/plain; charset=utf-8", allow: "GET, HEAD" });
    return response.end("method not allowed");
  }
  if (pathname.includes("\0")) {
    response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    return response.end("forbidden");
  }
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^[/\\]+/, "");
  const filePath = path.resolve(distDir, relative);
  const containedPath = path.relative(distDir, filePath);
  if (!containedPath || path.isAbsolute(containedPath) || containedPath === ".." || containedPath.startsWith(`..${path.sep}`)) {
    response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    return response.end("forbidden");
  }
  try {
    const content = await fs.readFile(filePath);
    response.writeHead(200, {
      "content-type": contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    });
    return response.end(method === "HEAD" ? undefined : content);
  } catch (error) {
    if (error.code !== "ENOENT" && error.code !== "ENOTDIR" && error.code !== "EISDIR") {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      return response.end("static file read failed");
    }
  }

  const relativeSegments = relative.split(/[/\\]+/);
  const missingStaticFile = relative !== "index.html"
    && (relativeSegments[0] === "assets" || Boolean(path.extname(relative)));
  if (missingStaticFile) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    return response.end("not found");
  }

  try {
    const fallback = await fs.readFile(path.join(distDir, "index.html"));
    response.writeHead(200, {
      "content-type": contentTypes[".html"],
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    });
    response.end(method === "HEAD" ? undefined : fallback);
  } catch {
    response.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
    response.end("前端尚未构建，请先执行 npm run build:ui");
  }
}

const server = http.createServer(async (request, response) => {
  let isApiRequest = false;
  try {
    const pathname = decodeURIComponent(new URL(request.url || "/", "http://127.0.0.1").pathname);
    isApiRequest = pathname === "/api" || pathname.startsWith("/api/");
    if (isApiRequest) await handleApi(request, response, pathname);
    else await serveStatic(request, response, pathname);
  } catch (error) {
    if (isApiRequest) return sendJson(response, 500, { ok: false, error: error.message }, request);
    response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    response.end(error instanceof URIError ? "bad request path" : "bad request");
  }
});

server.listen(port, "127.0.0.1", () => {
  activePort = server.address().port;
  const locator = publishRuntimeLocator({ port: activePort });
  console.log(`Personal Content Workbench: http://127.0.0.1:${activePort}`);
  console.log(`Runtime locator: ${locator.path}`);
  console.log(`Static UI: ${distDir}`);
  console.log(`Automation scheduler: ${["false", "0", "off"].includes(String(process.env.AUTOMATION_ENABLED || "").toLowerCase()) ? "disabled" : "enabled"}, tick ${automationTickMs}ms`);
  console.log(`Drop folder scanner: ${dropDir}, scan ${dropScanMs}ms`);
});

process.once("exit", clearRuntimeLocator);
process.once("SIGINT", () => process.exit(130));
process.once("SIGTERM", () => process.exit(143));

const automationTimer = setInterval(() => {
  runAutomationTickQueued(false).catch((error) => {
    console.error(`Automation tick failed: ${error.message}`);
  });
}, automationTickMs);

const dropTimer = setInterval(() => {
  runDropFolderScanQueued("drop-folder", false).catch((error) => {
    console.error(`Drop folder scan failed: ${error.message}`);
  });
}, dropScanMs);

const startupRecoveryTimer = setTimeout(() => {
  recoverInterruptedAgentTasks().catch((error) => {
    console.error(`Agent task recovery failed: ${error.message}`);
  }).finally(() => clearInterval(startupRecoveryTimer));
}, 100);

const agentResultTimer = setInterval(() => {
  runAgentResultScanQueued().catch((error) => {
    console.error(`Agent result scan failed: ${error.message}`);
  });
}, dropScanMs);

server.on("close", () => {
  clearInterval(automationTimer);
  clearInterval(dropTimer);
  clearInterval(agentResultTimer);
});
