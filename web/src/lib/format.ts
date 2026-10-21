import type { Tone } from "./types";

export function fmtDate(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export function fmtDateTime(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fmtClock(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 与服务端一致的口径：非空白字符 / 原始字符 */
export function countChars(text?: string): { nonSpace: number; raw: number } {
  const raw = text || "";
  return { nonSpace: raw.replace(/\s+/g, "").length, raw: raw.length };
}

export function relativeMultiple(signal: any): string {
  const multiple = Number(signal?.relativeMultiple || 0);
  if (!Number.isFinite(multiple) || multiple <= 0) return "无对比基准";
  return `${multiple.toFixed(1)}× 中位互动`;
}

export function toneForRunStatus(status?: string): Tone {
  switch (status) {
    case "ok":
    case "success":
    case "done":
      return "success";
    case "attention":
    case "pending":
      return "warning";
    case "blocked":
    case "failed":
      return "danger";
    case "running":
      return "action";
    default:
      return "neutral";
  }
}

export function toneForEvidence(state?: string): Tone {
  if (state === "verified") return "success";
  if (state === "rejected") return "danger";
  if (state === "unverified") return "candidate";
  return "neutral";
}

const PIPELINE_STATUS_META: Record<string, { label: string; tone: Tone; summary: string }> = {
  ok: { label: "完成", tone: "success", summary: "完成" },
  attention: { label: "待人工", tone: "warning", summary: "待人工" },
  blocked: { label: "受阻", tone: "danger", summary: "受阻" },
  failed: { label: "失败", tone: "danger", summary: "失败" },
  running: { label: "运行中", tone: "action", summary: "运行中" },
  waiting: { label: "等待", tone: "action", summary: "等待" },
  ready: { label: "就绪", tone: "action", summary: "就绪" },
  unknown: { label: "状态未知", tone: "neutral", summary: "状态未知" }
};

const PIPELINE_SUMMARY_ORDER = ["failed", "blocked", "attention", "running", "waiting", "ready", "unknown"] as const;

function normalizePipelineStatus(status?: string): string {
  return status && PIPELINE_STATUS_META[status] ? status : "unknown";
}

export function pipelineStatusLabel(status?: string): string {
  return PIPELINE_STATUS_META[normalizePipelineStatus(status)].label;
}

export function toneForPipelineStage(status?: string): Tone {
  return PIPELINE_STATUS_META[normalizePipelineStatus(status)].tone;
}

export function summarizePipelineStages(stages: Array<{ status?: string }> = []): { tone: Tone; label: string } {
  if (!stages.length) {
    return { tone: "neutral", label: "流水线 状态未知" };
  }
  if (stages.every((stage) => stage.status === "ok")) {
    return { tone: "success", label: "流水线 全部完成" };
  }

  const counts: Record<string, number> = {};
  for (const stage of stages) {
    if (stage.status === "ok") continue;
    const status = normalizePipelineStatus(stage.status);
    counts[status] = (counts[status] || 0) + 1;
  }

  const highestPriorityStatus = PIPELINE_SUMMARY_ORDER.find((status) => counts[status]);
  if (!highestPriorityStatus) {
    return { tone: "neutral", label: "流水线 状态未知" };
  }
  const primary = `${counts[highestPriorityStatus]} 段${PIPELINE_STATUS_META[highestPriorityStatus].summary}`;
  const remainingCount = Object.entries(counts)
    .filter(([status]) => status !== highestPriorityStatus)
    .reduce((total, [, count]) => total + count, 0);

  return {
    tone: PIPELINE_STATUS_META[highestPriorityStatus].tone,
    label: `流水线 ${primary}${remainingCount ? ` · 另 ${remainingCount} 项未完成` : ""}`
  };
}

export function platformLabel(id?: string): string {
  const map: Record<string, string> = {
    xiaohongshu: "小红书",
    douyin: "抖音",
    shipinhao: "视频号",
    bilibili: "B站",
    wechat: "公众号",
    x: "X"
  };
  return map[id || ""] || id || "未知平台";
}

export function capabilityTone(status?: string): Tone {
  if (status === "complete") return "success";
  if (status === "partial") return "warning";
  if (status === "unsupported") return "neutral";
  return "neutral";
}

export function capabilityLabel(status?: string): string {
  const map: Record<string, string> = {
    complete: "完整可用",
    partial: "部分可用",
    unsupported: "不支持",
    unknown: "未验证"
  };
  return map[status || ""] || "未验证";
}
