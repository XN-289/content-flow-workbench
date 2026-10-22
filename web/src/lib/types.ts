// 与 data/workbench.json 对齐的最小类型定义（服务端结构为准，前端不重塑数据）

export type AgentName = "grok" | "muse" | "codex" | "claude" | "cursor";

export type AgentTaskKind =
  | "research"
  | "dissect"
  | "outline"
  | "script"
  | "title"
  | "platform-copy"
  | "visual";

export interface AgentTaskCreatePayload {
  agent: AgentName;
  kind: AgentTaskKind;
  title: string;
  objective: string;
  topicId?: string;
  signalId?: string;
  mirrorToDrive?: boolean;
  outputRequirements?: string;
}

export interface AgentTask {
  id: string;
  title: string;
  agent: AgentName | string;
  kind: AgentTaskKind | string;
  topicId?: string;
  signalId?: string;
  status?: string;
  outboxPath?: string;
  drivePath?: string;
  driveStatus?: string;
  [key: string]: any;
}

export interface TranscriptAnalysisQuote {
  startTimestamp: string;
  endTimestamp: string;
  text: string;
  why?: string;
}

export interface TranscriptAnalysisPart {
  id: string;
  label: string;
  role: string;
  startTimestamp: string;
  endTimestamp: string;
  candidateSummary: string;
  quote: TranscriptAnalysisQuote | null;
  evidenceState: "unverified";
}

export interface TranscriptAnalysisRun {
  id: string;
  signalId: string;
  status: "completed" | string;
  schemaVersion: number;
  evidenceState: "unverified";
  createdAt: string;
  finishedAt: string;
  sourceMode: string;
  input: {
    transcriptHash: string;
    transcriptModel: string;
    transcriptCapturedAt: string;
    characterCount: number;
    segmentCount: number;
    durationSeconds: number;
  };
  analysis: {
    summary: string;
    hook: {
      pattern: string;
      quote: TranscriptAnalysisQuote | null;
      candidateRead: string;
      evidenceState: "unverified";
    };
    promiseAndTension: {
      quote: TranscriptAnalysisQuote | null;
      tension: string;
      evidenceState: "unverified";
    };
    structure: TranscriptAnalysisPart[];
    pacing: {
      durationSeconds: number;
      characterCount: number;
      segmentCount: number;
      charsPerSecond: number;
      segmentsPerMinute: number;
      averageSegmentCharacters: number;
      longSegmentCount: number;
      shortSegmentRatio: number;
      fastestWindow: {
        startTimestamp: string;
        endTimestamp: string;
        charsPerSecond: number;
      } | null;
      candidateRead: string;
      evidenceState: "unverified";
    };
    audience: Array<{
      id: string;
      label: string;
      count: number;
      quote: TranscriptAnalysisQuote | null;
      evidenceState: "unverified";
    }>;
    retention: Array<{
      id: string;
      label: string;
      count: number;
      quote: TranscriptAnalysisQuote | null;
      why: string;
      evidenceState: "unverified";
    }>;
    emotionalPayoff: {
      primary: {
        id: string;
        label: string;
        count: number;
        quote: TranscriptAnalysisQuote | null;
      } | null;
      cues: Array<{
        id: string;
        label: string;
        count: number;
        quote: TranscriptAnalysisQuote | null;
      }>;
      candidateRead: string;
      evidenceState: "unverified";
    };
    authorBaseline: {
      sampleCount: number;
      peerMedianEngagement: number | null;
      currentEngagement: number | null;
      relativeMultiple: number | null;
      sampleAdequate: boolean;
      candidateRead: string;
      evidenceState: "unverified";
    };
    reusableFormula: {
      name: string;
      skeleton: string;
      candidateUse: string;
      evidenceState: "unverified";
    };
    evidenceGaps: string[];
    quotes: TranscriptAnalysisQuote[];
  };
}

export interface KnowledgeExportRecord {
  id: string;
  status: "completed" | string;
  evidenceState: "unverified";
  targetRoot: string;
  analysisCount: number;
  transcriptCount: number;
  fileCount: number;
  generatedAt: string;
  createdAt: string;
}

export type IntakeQueueStatus =
  | "queued"
  | "registered"
  | "captured"
  | "needs-browser"
  | "duplicate"
  | "blocked"
  | "failed";

export interface IntakeBatchSummary {
  total: number;
  queued: number;
  registered: number;
  captured: number;
  "needs-browser": number;
  duplicate: number;
  blocked: number;
  failed: number;
}

export interface IntakeBatch {
  id: string;
  status: "running" | "completed" | "needs-review" | "partial" | string;
  itemCount: number;
  inputCharacters: number;
  startedAt: string;
  finishedAt: string;
  summary: IntakeBatchSummary | null;
  nextAction: string;
}

export interface IntakeQueueItem {
  id: string;
  batchId: string;
  ordinal: number;
  status: IntakeQueueStatus;
  platform: string;
  url: string;
  originalUrl: string;
  canonicalUrl: string;
  identityKey: string;
  titleCandidate: string;
  authorCandidate: string;
  sourceId: string;
  signalId: string;
  duplicateOf: string;
  nextAction: string;
  error: string;
  createdAt: string;
  processedAt: string;
}

export interface BatchIntakeResult {
  ok: true;
  batch: IntakeBatch;
  run: Record<string, any>;
  items: IntakeQueueItem[];
  summary: IntakeBatchSummary;
}

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
  agentTasks: AgentTask[];
  evidencePackages: any[];
  transcriptRuns: any[];
  analysisRuns: TranscriptAnalysisRun[];
  knowledgeExports: KnowledgeExportRecord[];
  intakeBatches: IntakeBatch[];
  intakeQueue: IntakeQueueItem[];
  runtime: Record<string, any>;
  [key: string]: any;
}

export type Tone = "neutral" | "success" | "warning" | "danger" | "candidate" | "action";

export type ViewKey = "overview" | "flow" | "workflow" | "system";
