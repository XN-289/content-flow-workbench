// 与 data/workbench.json 对齐的最小类型定义（服务端结构为准，前端不重塑数据）

export interface WorkbenchState {
  version: number;
  settings: Record<string, any>;
  sources: any[];
  signals: any[];
  materials: any[];
  topics: any[];
  scripts: any[];
  publications: any[];
  reviews: any[];
  collectionRuns: any[];
  rawSnapshots: any[];
  morningBriefs: any[];
  morningPipelineRuns: any[];
  frictionLog: any[];
  agentTasks: any[];
  evidencePackages: any[];
  transcriptRuns: any[];
  runtime: Record<string, any>;
  [key: string]: any;
}

export type Tone = "neutral" | "success" | "warning" | "danger" | "candidate" | "action";

export type ViewKey = "overview" | "flow" | "workflow" | "system";