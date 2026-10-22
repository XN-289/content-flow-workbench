export const STAGES = [
  "topic",
  "outline",
  "draft",
  "production",
  "review",
  "ready-to-publish",
  "published",
  "reviewed"
] as const;

export const STAGE_LABEL: Record<string, string> = {
  topic: "选题",
  outline: "提纲",
  draft: "草稿",
  production: "制作",
  review: "待审",
  "ready-to-publish": "待发",
  published: "已发",
  reviewed: "已复盘"
};

export const DISPOSITION_LABEL: Record<string, string> = {
  inbox: "待分诊",
  produce: "可生产",
  topic: "做选题",
  material: "入素材",
  watch: "观察",
  discard: "丢弃",
  dissected: "已拆解"
};

export const PUBLICATION_STATUS_LABEL: Record<string, string> = {
  draft: "草稿",
  ready: "待发",
  published: "已发",
  failed: "失败",
  blocked: "受阻"
};

export const EVIDENCE_STATE_LABEL: Record<string, string> = {
  unverified: "unverified",
  verified: "已校验",
  rejected: "已驳回",
  missing: "缺原始证据"
};

export const RUN_STATUS_LABEL: Record<string, string> = {
  ok: "完成",
  success: "完成",
  ready: "就绪",
  done: "完成",
  completed: "完成",
  pending: "待处理",
  attention: "待人工",
  blocked: "受阻",
  failed: "失败",
  skipped: "已跳过",
  running: "运行中",
  idle: "空闲"
};

export function nextStage(stage: string): string | null {
  const index = STAGES.indexOf(stage as any);
  if (index < 0 || index >= STAGES.length - 1) return null;
  return STAGES[index + 1];
}
