import { STAGES, STAGE_LABEL, nextStage } from "./constants";
import type { WorkbenchState } from "./types";

export const MANUAL_GATE_KEYS = ["evidence", "opening", "sample", "final"] as const;
export const PRODUCTION_CHECK_KEYS = [
  "coreIdea",
  "targetReader",
  "hook",
  "outline",
  "evidence",
  "visuals",
  "publishPackage"
] as const;
export const REQUIRED_PUBLISH_PLATFORMS = ["douyin", "xiaohongshu", "wechat"] as const;

export type ManualGateKey = (typeof MANUAL_GATE_KEYS)[number];
export type ProductionCheckKey = (typeof PRODUCTION_CHECK_KEYS)[number];
export type RequiredPublishPlatform = (typeof REQUIRED_PUBLISH_PLATFORMS)[number];

export const MANUAL_GATE_LABELS: Record<ManualGateKey, string> = {
  evidence: "证据核对",
  opening: "开头钩子",
  sample: "样片确认",
  final: "终版确认"
};

export const PRODUCTION_CHECK_LABELS: Record<ProductionCheckKey, string> = {
  coreIdea: "核心观点",
  targetReader: "目标读者",
  hook: "开头钩子",
  outline: "提纲",
  evidence: "证据",
  visuals: "画面",
  publishPackage: "发布物料"
};

export const PUBLISH_PLATFORM_LABELS: Record<RequiredPublishPlatform, string> = {
  douyin: "抖音",
  xiaohongshu: "小红书",
  wechat: "公众号"
};

export type StageGateBlocker = "manual-gates" | "production-checks" | "publications" | "review" | "unknown";

export interface StageGateTopic {
  id?: string;
  stage?: string;
  gates?: Record<string, boolean | undefined>;
  productionChecks?: Record<string, boolean | undefined>;
}

export interface StageGateResult {
  currentStage: string;
  currentStageLabel: string;
  nextStage: string | null;
  nextStageLabel: string | null;
  canAdvance: boolean;
  blocked: boolean;
  terminal: boolean;
  reason: string;
  blocker: StageGateBlocker | null;
  missingGates: ManualGateKey[];
  missingChecks: ProductionCheckKey[];
  missingPlatforms: RequiredPublishPlatform[];
  missingReview: boolean;
}

type GateState = Partial<Pick<WorkbenchState, "publications" | "reviews">> | null | undefined;

function labelsFor<T extends string>(keys: T[], labels: Record<T, string>): string {
  return keys.map((key) => labels[key]).join("、");
}

export function evaluateStageGate(state: GateState, topic?: StageGateTopic | null): StageGateResult {
  const currentStage = String(topic?.stage || "");
  const currentStageLabel = STAGE_LABEL[currentStage] || currentStage || "未知阶段";
  const followingStage = nextStage(currentStage);
  const nextStageLabel = followingStage ? STAGE_LABEL[followingStage] || followingStage : null;
  const base = {
    currentStage,
    currentStageLabel,
    nextStage: followingStage,
    nextStageLabel,
    terminal: false,
    blocker: null as StageGateBlocker | null,
    missingGates: [] as ManualGateKey[],
    missingChecks: [] as ProductionCheckKey[],
    missingPlatforms: [] as RequiredPublishPlatform[],
    missingReview: false
  };

  if (!topic) {
    return {
      ...base,
      canAdvance: false,
      blocked: true,
      reason: "还没有选题，无法判断阶段推进条件",
      blocker: "unknown"
    };
  }

  if (!STAGES.includes(currentStage as (typeof STAGES)[number])) {
    return {
      ...base,
      canAdvance: false,
      blocked: true,
      reason: `未知阶段「${currentStage || "空"}」，无法判断推进条件`,
      blocker: "unknown"
    };
  }

  if (!followingStage) {
    return {
      ...base,
      canAdvance: false,
      blocked: false,
      terminal: true,
      reason: "已到终态，无需继续推进"
    };
  }

  if (currentStage === "production") {
    const missingGates = MANUAL_GATE_KEYS.filter((key) => topic.gates?.[key] !== true);
    const blocked = missingGates.length > 0;
    return {
      ...base,
      canAdvance: !blocked,
      blocked,
      reason: blocked
        ? `推进到${nextStageLabel}前，还需通过人工关卡：${labelsFor(missingGates, MANUAL_GATE_LABELS)}`
        : `人工关卡已全部通过，可推进到${nextStageLabel}`,
      blocker: blocked ? "manual-gates" : null,
      missingGates
    };
  }

  if (currentStage === "review") {
    const missingChecks = PRODUCTION_CHECK_KEYS.filter((key) => topic.productionChecks?.[key] !== true);
    const blocked = missingChecks.length > 0;
    return {
      ...base,
      canAdvance: !blocked,
      blocked,
      reason: blocked
        ? `推进到${nextStageLabel}前，还需完成制作检查：${labelsFor(missingChecks, PRODUCTION_CHECK_LABELS)}`
        : `制作检查已全部完成，可推进到${nextStageLabel}`,
      blocker: blocked ? "production-checks" : null,
      missingChecks
    };
  }

  if (currentStage === "ready-to-publish") {
    const publishedPlatforms = new Set(
      (state?.publications || [])
        .filter((item) => item?.topicId === topic.id && item?.status === "published")
        .map((item) => String(item?.platform || ""))
    );
    const missingPlatforms = REQUIRED_PUBLISH_PLATFORMS.filter((platform) => !publishedPlatforms.has(platform));
    const blocked = missingPlatforms.length > 0;
    return {
      ...base,
      canAdvance: !blocked,
      blocked,
      reason: blocked
        ? `推进到${nextStageLabel}前，还需登记已发布平台：${labelsFor(missingPlatforms, PUBLISH_PLATFORM_LABELS)}`
        : `三平台发布记录已齐，可推进到${nextStageLabel}`,
      blocker: blocked ? "publications" : null,
      missingPlatforms
    };
  }

  if (currentStage === "published") {
    const missingReview = !(state?.reviews || []).some((review) => review?.topicId === topic.id);
    return {
      ...base,
      canAdvance: !missingReview,
      blocked: missingReview,
      reason: missingReview
        ? `推进到${nextStageLabel}前，需先保存至少一条复盘记录`
        : `复盘记录已存在，可推进到${nextStageLabel}`,
      blocker: missingReview ? "review" : null,
      missingReview
    };
  }

  return {
    ...base,
    canAdvance: true,
    blocked: false,
    reason: `当前阶段没有额外硬门槛，可推进到${nextStageLabel}`
  };
}
