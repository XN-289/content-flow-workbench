const activeTopicStages = new Set(["topic", "outline", "draft", "production", "review", "ready-to-publish"]);

export const automaticCollectionMethods = new Set(["public-rss", "public-page", "bilibili-public"]);

export function isScheduledCollectionSource(source = {}) {
  return Boolean(source)
    && source.enabled !== false
    && source.checkFrequency !== "on-demand"
    && source.collectionMethod !== "research-only";
}

export function isAutomaticCollectionCandidate(source = {}) {
  return isScheduledCollectionSource(source)
    && automaticCollectionMethods.has(source.collectionMethod);
}

export function isManualCollectionCandidate(source = {}) {
  return isScheduledCollectionSource(source)
    && !isAutomaticCollectionCandidate(source);
}

export function isAutomaticCollectionDue(source = {}, timestamp = Date.now()) {
  const nextRunAtValue = String(source?.nextRunAt || "").trim();
  if (!nextRunAtValue) return false;
  const nextRunAt = new Date(nextRunAtValue).getTime();
  return isAutomaticCollectionCandidate(source)
    && Number.isFinite(nextRunAt)
    && nextRunAt <= Number(timestamp);
}

function normalizedOperationStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  if (status === "ok" || status === "ok-no-new" || status === "complete") return "ok";
  if (status === "failed" || status === "error") return "failed";
  if (status === "blocked") return "blocked";
  if (status === "pending" || status === "waiting") return "pending";
  if (status === "partial" || status === "attention") return "attention";
  if (status === "skipped") return "skipped";
  if (status === "running") return "running";
  return "";
}

export function operationStatusFromResult(result = {}) {
  if (!result || typeof result !== "object") return "failed";
  const nestedStatuses = (Array.isArray(result.results) ? result.results : [])
    .map((item) => normalizedOperationStatus(item?.status))
    .filter(Boolean);
  const statuses = [
    normalizedOperationStatus(result.status),
    ...nestedStatuses
  ].filter(Boolean);

  if (statuses.includes("failed") || Number(result.failed) > 0) {
    return "failed";
  }
  if (statuses.includes("blocked") || Number(result.blocked) > 0) return "blocked";
  if (statuses.includes("pending") || Number(result.pending) > 0) return "pending";
  if (statuses.includes("attention") || Number(result.partial) > 0) return "attention";
  if (statuses.includes("running")) return "running";
  if (result.skipped === true || Number(result.skipped) > 0 || statuses.includes("skipped")) return "skipped";
  if (result.ok === false) return "failed";
  return "ok";
}

export function aggregatePipelineStatus(operations = {}) {
  const rank = {
    skipped: 1,
    running: 2,
    attention: 3,
    pending: 4,
    blocked: 5,
    failed: 6
  };
  let selected = "ok";
  for (const operation of Object.values(operations || {})) {
    const status = typeof operation === "string"
      ? normalizedOperationStatus(operation)
      : normalizedOperationStatus(operation?.status);
    if (!status) continue;
    if ((rank[status] || 0) > (rank[selected] || 0)) selected = status;
  }
  return selected;
}

function minuteOfDay(value) {
  const [hours, minutes] = String(value || "09:00").split(":").map(Number);
  return (Number.isFinite(hours) ? hours : 0) * 60 + (Number.isFinite(minutes) ? minutes : 0);
}
function dateKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function safeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

export function morningPipelineRuntime(state = {}, options = {}) {
  const timestamp = options.now instanceof Date ? options.now : new Date();
  const inboxLimit = Math.max(1, safeNumber(state.settings?.inboxDailyLimit ?? 10));
  const inboxMinute = minuteOfDay(state.settings?.inboxTime);
  const pendingSignals = (state.signals || []).filter((signal) => signal.disposition === "inbox");
  const dueSources = (state.sources || []).filter((source) => isAutomaticCollectionDue(source, timestamp.getTime()));
  const manualSources = (state.sources || []).filter((source) => isManualCollectionCandidate(source));
  const retryingSources = (state.sources || []).filter((source) => (
    isAutomaticCollectionCandidate(source)
    && source.automationStatus === "retrying"
  ));
  const readyAgentResults = (state.agentTasks || []).filter((task) => task.status === "result-ready");
  const runningAgentTasks = (state.agentTasks || []).filter((task) => task.status === "running");
  const activeTopics = (state.topics || []).filter((topic) => activeTopicStages.has(topic.stage));
  const productionTopics = (state.topics || []).filter((topic) => ["outline", "draft", "production", "review"].includes(topic.stage));
  const todayBrief = (state.morningBriefs || []).find((brief) => brief.date === dateKey(timestamp));
  const beforeInboxSlot = timestamp.getHours() * 60 + timestamp.getMinutes() < inboxMinute;

  const stages = [
    {
      id: "drop-folder",
      label: "投递箱",
      status: "ready",
      detail: "扫描 JSON / Markdown / TXT，首轮不稳定文件保留 pending。",
      view: "flow",
      anchor: "flow-sources"
    },
    {
      id: "collection",
      label: "到期采集",
      status: options.automationEnabled === false ? "blocked" : dueSources.length || retryingSources.length ? "attention" : "ok",
      detail: options.automationEnabled === false
        ? "页面自动化或环境变量已关闭。"
        : `${dueSources.length} 个到期，${manualSources.length} 个待人工，${retryingSources.length} 个重试中。`,
      view: "flow",
      anchor: "flow-sources"
    },
    {
      id: "agent-results",
      label: "结果回流",
      status: readyAgentResults.length ? "attention" : runningAgentTasks.length ? "running" : "ok",
      detail: `${readyAgentResults.length} 条结果待导入，${runningAgentTasks.length} 条任务运行中。`,
      view: "system",
      anchor: "system-agents"
    },
    {
      id: "brief",
      label: "晨报",
      status: todayBrief ? "ok" : beforeInboxSlot ? "waiting" : "ready",
      detail: todayBrief ? `已生成，覆盖 ${todayBrief.inboxCount} 条待处理信号。` : beforeInboxSlot ? "等待 Inbox 时段。" : "待刷新今日晨报。",
      view: "overview",
      anchor: ""
    },
    {
      id: "inbox",
      label: "Inbox 分流",
      status: !pendingSignals.length ? "ok" : pendingSignals.length > inboxLimit ? "attention" : "ready",
      detail: !pendingSignals.length
        ? "Inbox 已清零。"
        : `${pendingSignals.length} 条待处理，本地上限 ${inboxLimit} 条。`,
      view: "flow",
      anchor: "flow-inbox"
    },
    {
      id: "production",
      label: "生产块",
      status: productionTopics.length ? "ready" : activeTopics.length ? "attention" : "ok",
      detail: productionTopics.length
        ? `优先推进 ${productionTopics[0].title}`
        : activeTopics.length
          ? "有选题但尚未进入提纲。"
          : "暂无活跃选题。",
      view: "workflow",
      anchor: "workflow-production"
    }
  ];

  const latestRun = options.lastRun && typeof options.lastRun === "object" ? options.lastRun : null;
  const operationStageIds = {
    "drop-folder": "dropFolder",
    collection: "collection",
    "agent-results": "agentResults"
  };
  for (const stage of stages) {
    const operationName = operationStageIds[stage.id];
    const operation = operationName ? latestRun?.operations?.[operationName] : null;
    const status = normalizedOperationStatus(operation?.status);
    if (status) stage.status = status;
  }

  return {
    generatedAt: timestamp.toISOString(),
    date: dateKey(timestamp),
    inboxTime: state.settings?.inboxTime || "09:00",
    inboxDailyLimit: inboxLimit,
    stages,
    nextActions: stages
      .filter((stage) => ["ready", "attention", "blocked", "pending", "failed", "skipped", "running"].includes(stage.status))
      .map((stage) => `${stage.label}：${stage.detail}`)
  };
}
