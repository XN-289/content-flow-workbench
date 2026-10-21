import type { WorkbenchState } from "./types";

// 与 scripts/server.mjs 保持一致的端点；前端不自行重写服务端状态机。
async function post<T = any>(path: string, body?: any): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {})
  });
  let data: any = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error || `请求失败（${response.status}）`);
  }
  return data as T;
}

async function get<T = any>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) {
    // 失败要说清“发生了什么”，否则用户只能猜
    throw new Error(`加载失败（HTTP ${response.status}）`);
  }
  return (await response.json()) as T;
}

export const api = {
  state: () => get<WorkbenchState>("/api/state"),
  update: (type: string, id: string, patch: any) => post("/api/update", { type, id, patch }),
  record: (type: string, record: any) => post("/api/record", { type, record }),
  saveReview: (record: any, advanceToReviewed = false) =>
    post("/api/reviews/save", { record, advanceToReviewed }),
  collect: (sourceId: string) => post("/api/collect", { sourceId }),
  capture: (text: string, sourceId?: string) => post("/api/capture", { text, sourceId }),
  sourceIntake: (text: string) => post("/api/source-intake", { text }),
  transcript: (signalId: string, force = false, background = false) =>
    post("/api/signals/transcript", { signalId, force, background }),
  runMorningPipeline: () => post("/api/morning-pipeline/run"),
  automationTick: (force = false) => post("/api/automation/tick", { force }),
  automationSettings: (automationEnabled: boolean) => post("/api/automation/settings", { automationEnabled }),
  dropFolderScan: () => post("/api/drop-folder/scan"),
  evidenceCreate: (signalId: string) => post("/api/evidence-packages/create", { signalId }),
  evidenceVerify: (id: string, state: string, note = "") => post("/api/evidence-packages/verify", { id, state, note }),
  agentCreate: (payload: any) => post("/api/agent-tasks/create", payload),
  agentScan: () => post("/api/agent-tasks/scan"),
  agentRun: (id: string) => post("/api/agent-tasks/run", { id }),
  agentImport: (id: string) => post("/api/agent-tasks/import", { id }),
  agentBridge: (driveRoot: string) => post("/api/agent-bridge/settings", { driveRoot }),
  backups: () => get<any>("/api/backups"),
  backupCreate: () => post("/api/backups/create"),
  backupRestore: (filename: string) => post("/api/backups/restore", { filename }),
  importState: (payload: any) => post("/api/import", payload)
};

export function isLocalRehearsal(url?: string): boolean {
  return Boolean(url && url.startsWith("workbench://local-rehearsal"));
}
