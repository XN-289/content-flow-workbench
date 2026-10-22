export const agentPluginContractVersion = 3;

export const agentPluginMethods = Object.freeze([
  {
    id: "manifest.get",
    name: "getManifest",
    label: "Read the local plugin manifest",
    httpMethod: "GET",
    endpoint: "/api/agent-plugin/manifest",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    id: "state.get",
    name: "getState",
    label: "Read the local workbench state",
    httpMethod: "GET",
    endpoint: "/api/state",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    id: "platform.capabilities.get",
    name: "getPlatformCapabilities",
    label: "Read the five-platform capability matrix",
    httpMethod: "GET",
    endpoint: "/api/platform-capabilities",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  },
  {
    id: "source.intake",
    name: "intakeSource",
    label: "Classify and register a profile, note, or public URL",
    httpMethod: "POST",
    endpoint: "/api/source-intake",
    inputSchema: {
      type: "object",
      required: ["text"],
      properties: { text: { type: "string" } },
      additionalProperties: false
    }
  },
  {
    id: "xiaohongshu.note.capture",
    name: "captureXiaohongshuNote",
    label: "Capture one guest-visible Xiaohongshu note from share text or URL",
    httpMethod: "POST",
    endpoint: "/api/xhs/guest-capture",
    inputSchema: {
      type: "object",
      required: ["text"],
      properties: {
        text: {
          type: "string",
          description: "Xiaohongshu share text, short link, or note URL."
        }
      },
      additionalProperties: false
    }
  },
  {
    id: "transcript.capture",
    name: "captureTranscript",
    label: "Run explicit local ASR for one signal",
    httpMethod: "POST",
    endpoint: "/api/signals/transcript",
    inputSchema: {
      type: "object",
      required: ["signalId"],
      properties: {
        signalId: { type: "string" },
        force: { type: "boolean", default: false },
        background: { type: "boolean", default: false }
      },
      additionalProperties: false
    }
  },
  {
    id: "analysis.create",
    name: "createAnalysis",
    label: "Create a timestamped transcript-aware candidate analysis",
    httpMethod: "POST",
    endpoint: "/api/signals/analysis",
    inputSchema: {
      type: "object",
      required: ["signalId"],
      properties: {
        signalId: { type: "string" },
        force: { type: "boolean", default: false }
      },
      additionalProperties: false
    }
  },
  {
    id: "agent.task.create",
    name: "createAgentTask",
    label: "Create a task bundle for a local or external agent",
    httpMethod: "POST",
    endpoint: "/api/agent-tasks/create",
    inputSchema: {
      type: "object",
      required: ["agent", "kind", "title", "objective"],
      properties: {
        agent: { enum: ["grok", "muse", "codex", "claude", "cursor"] },
        kind: { enum: ["research", "dissect", "outline", "script", "title", "platform-copy", "visual"] },
        title: { type: "string" },
        objective: { type: "string" },
        topicId: { type: "string" },
        signalId: { type: "string" },
        mirrorToDrive: { type: "boolean" },
        outputRequirements: { type: "string" }
      },
      additionalProperties: false
    }
  },
  {
    id: "knowledge.export",
    name: "exportKnowledge",
    label: "Mirror analyses and transcripts into the configured Google Drive folder",
    httpMethod: "POST",
    endpoint: "/api/knowledge/export",
    inputSchema: {
      type: "object",
      properties: {
        driveRoot: {
          type: "string",
          description: "Optional existing absolute Drive sync path; omitted means use saved settings."
        }
      },
      additionalProperties: false
    }
  },
  {
    id: "morning.run",
    name: "runMorningPipeline",
    label: "Run the six-stage morning pipeline",
    httpMethod: "POST",
    endpoint: "/api/morning-pipeline/run",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false
    }
  }
]);

function publicCapability(method) {
  return {
    id: method.id,
    name: method.name,
    label: method.label,
    endpoint: method.endpoint,
    method: method.httpMethod,
    inputSchema: method.inputSchema
  };
}

export function agentPluginManifest({ baseUrl = "http://127.0.0.1:5177" } = {}) {
  return {
    name: "content-flow-workbench",
    displayName: "Content Flow Workbench",
    protocolVersion: agentPluginContractVersion,
    generatedAt: new Date().toISOString(),
    client: "./client.mjs",
    runtime: {
      mode: "local-http",
      baseUrl,
      originPolicy: "http-origin-on-loopback-only",
      credentialsIncluded: false,
      discovery: {
        baseUrlEnv: "CONTENT_FLOW_WORKBENCH_URL",
        runtimeFileEnv: "CONTENT_FLOW_WORKBENCH_RUNTIME_FILE",
        defaultPort: 5177
      }
    },
    capabilities: agentPluginMethods.map(publicCapability),
    artifacts: {
      agentTaskFiles: ["task.json", "task.md", "result.md"],
      knowledgeTree: [
        "ContentFlowWorkbench/Knowledge/manifest.json",
        "ContentFlowWorkbench/Knowledge/analyses/<analysis-id>.json",
        "ContentFlowWorkbench/Knowledge/analyses/<analysis-id>.md",
        "ContentFlowWorkbench/Knowledge/transcripts/<signal-id>.json"
      ]
    },
    evidencePolicy: {
      defaultState: "unverified",
      transcriptQuotesRequireTimestamps: true,
      prohibitedClaims: [
        "Do not claim a heuristic caused platform traffic.",
        "Do not mark ASR text verified without a human check.",
        "Do not treat blocked or login-walled collection as complete."
      ]
    },
    safetyBoundary: [
      "The client accepts only http origins on 127.0.0.1 or localhost.",
      "Every method resolves to a manifest-declared relative /api/** endpoint on the selected loopback origin.",
      "The workbench never exports cookies, login state, browser profiles, or capture tokens.",
      "Only public or user-visible content is captured.",
      "Login walls, CAPTCHAs, and security checks require the human user.",
      "Google Drive integration uses a local desktop sync directory; it does not request OAuth credentials."
    ]
  };
}
