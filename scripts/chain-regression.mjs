import http from "node:http";
import crypto from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { platformCapabilityRuntime } from "./platform-capabilities.mjs";
import { sanitizeStateBlockedSnapshots } from "./blocked-snapshot-sanitizer.mjs";
import {
  agentPluginContractVersion,
  agentPluginMethods
} from "./agent-plugin-contract.mjs";
import { createSignalEvidencePackage } from "./evidence-package.mjs";
import { normalizeDetailCapture } from "./detail-evidence.mjs";
import {
  aggregatePipelineStatus,
  isAutomaticCollectionCandidate,
  isAutomaticCollectionDue,
  isManualCollectionCandidate,
  morningPipelineRuntime,
  operationStatusFromResult
} from "./morning-pipeline.mjs";
import { resolveSourceIntakeUrl } from "./source-intake.mjs";
import { applyTranscriptResult, selectTranscriptMedia } from "./transcribe-signal.mjs";
import { publicShareUrl } from "./knowledge-export.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checks = [];
let workbenchProcess = null;
let mockServer = null;
let tempRoot = "";

function equal(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function truthy(value, label) {
  if (!value) throw new Error(`${label}: expected truthy, received ${JSON.stringify(value)}`);
}

function match(value, pattern, label) {
  if (!pattern.test(String(value || ""))) {
    throw new Error(`${label}: ${JSON.stringify(value)} does not match ${pattern}`);
  }
}

function pass(name) {
  checks.push(name);
  console.log(`ok - ${name}`);
}

function checkPowerShellSyntax(filePath, label) {
  if (process.platform !== "win32") return;
  const powershellPath = String(filePath).replace(/'/g, "''");
  const result = spawnSync("powershell.exe", [
    "-NoProfile",
    "-Command",
    `$file='${powershellPath}';$tokens=$null;$errors=$null;[System.Management.Automation.Language.Parser]::ParseFile($file,[ref]$tokens,[ref]$errors)|Out-Null;if($errors.Count){$errors|ForEach-Object{$_.Message};exit 1}`
  ], { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error(`${label} PowerShell syntax check failed: ${result.error?.message || result.stderr || result.stdout}`);
  }
}

async function getPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

async function requestJson(base, route, body, method = "POST") {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: { "content-type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(body || {})
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  return { status: response.status, payload };
}

function requestRoute(base, route, { method = "GET", body = "", headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(new URL(base), { path: route, method, headers }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let payload = null;
        try {
          payload = text ? JSON.parse(text) : null;
        } catch {
          payload = { raw: text };
        }
        resolve({ status: response.statusCode, payload });
      });
    });
    request.on("error", reject);
    request.end(body);
  });
}

async function api(base, route, body) {
  const result = await requestJson(base, route, body);
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`${route} failed with ${result.status}: ${JSON.stringify(result.payload)}`);
  }
  return result.payload;
}

async function failingApi(base, route, body, messagePattern) {
  const result = await requestJson(base, route, body);
  if (result.status < 400) {
    throw new Error(`${route} unexpectedly succeeded with ${result.status}`);
  }
  const message = String(result.payload?.error || result.payload?.message || "");
  if (messagePattern && !messagePattern.test(message)) {
    throw new Error(`${route} failed for an unexpected reason: ${message}`);
  }
  return result;
}

async function state(base) {
  return (await requestJson(base, "/api/state", null, "GET")).payload;
}

async function waitForServer(base) {
  let lastError = "";
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const result = await requestJson(base, "/api/state", null, "GET");
      if (result.status === 200) return result.payload;
      lastError = `HTTP ${result.status}`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`temporary workbench did not start: ${lastError}`);
}

async function startWorkbench(port, dataFile, dropDir, bridgeRoot, backupDir, evidenceDir, transcriptDir) {
  const child = spawn(process.execPath, [path.join(repoRoot, "scripts/server.mjs")], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(port),
      DATA_FILE: dataFile,
      DROP_DIR: dropDir,
      BRIDGE_ROOT: bridgeRoot,
      BACKUP_DIR: backupDir,
      EVIDENCE_DIR: evidenceDir,
      TRANSCRIPT_DIR: transcriptDir,
      CONTENT_FLOW_WORKBENCH_RUNTIME_FILE: path.join(tempRoot, "runtime-locator.json"),
      WORKBENCH_ASR_CONFIG: path.join(tempRoot, "missing-asr-runtime.local.json"),
      AUTOMATION_ENABLED: "false",
      AUTOMATION_TICK_MS: "60000",
      DROP_SCAN_MS: "60000"
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString("utf8");
  });
  child.getOutput = () => output;
  return child;
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 3000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function updateStage(base, topicId, stage) {
  const result = await api(base, "/api/update", { type: "topics", id: topicId, patch: { stage } });
  return result.record;
}

async function addTopic(base, title, extra = {}) {
  await api(base, "/api/import", { topics: [{ title, ...extra }] });
  const current = await state(base);
  return current.topics.find((topic) => topic.title === title);
}

async function main() {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "content-flow-regression-"));
  const dataFile = path.join(tempRoot, "workbench.json");
  const dropDir = path.join(tempRoot, "drops");
  const bridgeRoot = path.join(tempRoot, "bridge");
  const driveRoot = path.join(tempRoot, "drive-root");
  const backupDir = path.join(tempRoot, "backups");
  const evidenceDir = path.join(tempRoot, "evidence");
  const transcriptDir = path.join(tempRoot, "transcripts");
  await fs.mkdir(dropDir, { recursive: true });
  await fs.mkdir(bridgeRoot, { recursive: true });
  await fs.mkdir(driveRoot, { recursive: true });
  await fs.mkdir(backupDir, { recursive: true });
  await fs.mkdir(evidenceDir, { recursive: true });
  await fs.mkdir(transcriptDir, { recursive: true });

  const mockPort = await getPort();
  const workbenchPort = await getPort();
  const base = `http://127.0.0.1:${workbenchPort}`;
  mockServer = http.createServer((request, response) => {
    if (request.url === "/html-feed") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<html><body>login or challenge page</body></html>");
      return;
    }
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("not found");
  });
  await new Promise((resolve) => mockServer.listen(mockPort, "127.0.0.1", resolve));

  workbenchProcess = await startWorkbench(workbenchPort, dataFile, dropDir, bridgeRoot, backupDir, evidenceDir, transcriptDir);
  await waitForServer(base);

  const dueAt = new Date(Date.now() - 60_000).toISOString();
  const scheduledSource = {
    enabled: true,
    checkFrequency: "daily",
    nextRunAt: dueAt
  };
  equal(
    isAutomaticCollectionCandidate({ ...scheduledSource, collectionMethod: "public-rss" }),
    true,
    "public RSS is an automatic collection candidate"
  );
  equal(
    isAutomaticCollectionDue({ ...scheduledSource, collectionMethod: "public-page" }),
    true,
    "due public page is automatically collectable"
  );
  equal(
    isAutomaticCollectionDue({ ...scheduledSource, collectionMethod: "public-rss", nextRunAt: "" }),
    false,
    "missing schedule is not due"
  );
  equal(
    isAutomaticCollectionCandidate({ ...scheduledSource, collectionMethod: "manual" }),
    false,
    "manual source is excluded from automatic collection"
  );
  equal(
    isAutomaticCollectionCandidate({ ...scheduledSource, collectionMethod: "browser-assisted" }),
    false,
    "browser-assisted source is excluded from automatic collection"
  );
  equal(
    isManualCollectionCandidate({ ...scheduledSource, collectionMethod: "manual" }),
    true,
    "manual source is queued for human action"
  );
  equal(
    isManualCollectionCandidate({ ...scheduledSource, collectionMethod: "browser-assisted" }),
    true,
    "browser-assisted source is queued for human action"
  );

  const operationStatusCases = [
    [{ status: "ok-no-new" }, "ok"],
    [{ status: "pending" }, "pending"],
    [{ status: "blocked" }, "blocked"],
    [{ status: "failed" }, "failed"],
    [{ skipped: true }, "skipped"],
    [{ skipped: 2 }, "skipped"],
    [{ status: "blocked", ok: false }, "blocked"],
    [{ status: "pending", ok: false }, "pending"],
    [{ status: "partial", ok: false }, "attention"],
    [{ ok: true, results: [{ status: "partial" }] }, "attention"],
    [{ ok: true, results: [{ status: "failed" }] }, "failed"],
    [{ ok: false }, "failed"]
  ];
  for (const [result, expected] of operationStatusCases) {
    equal(operationStatusFromResult(result), expected, `operation status from ${JSON.stringify(result)}`);
  }
  equal(aggregatePipelineStatus({ first: "ok", second: "pending" }), "pending", "aggregate pipeline pending status");
  equal(aggregatePipelineStatus({ first: "pending", second: "failed" }), "failed", "aggregate pipeline failed precedence");
  equal(aggregatePipelineStatus({ first: "skipped", second: "running" }), "running", "running stage is not hidden by skipped");
  const statusPipeline = morningPipelineRuntime({
    settings: { inboxTime: "09:00", inboxDailyLimit: 10 }
  }, {
    lastRun: {
      operations: {
        dropFolder: { status: "pending" },
        collection: { status: "blocked" },
        agentResults: { status: "failed" }
      }
    }
  });
  equal(
    statusPipeline.stages.find((stage) => stage.id === "drop-folder")?.status,
    "pending",
    "morning stage preserves pending operation status"
  );
  equal(
    statusPipeline.stages.find((stage) => stage.id === "collection")?.status,
    "blocked",
    "morning stage preserves blocked operation status"
  );
  equal(
    statusPipeline.stages.find((stage) => stage.id === "agent-results")?.status,
    "failed",
    "morning stage preserves failed operation status"
  );
  pass("自动候选、人工队列与晨间阶段状态共用同一套诚实判定");

  const provenanceSignal = {
    id: "signal-provenance-regression",
    sourceId: "source-provenance-regression",
    collectionRunId: "",
    rawSnapshotId: "snapshot-linked",
    title: "Evidence provenance regression",
    url: "https://example.com/evidence-provenance-regression"
  };
  const provenanceState = {
    sources: [],
    collectionRuns: [],
    signals: [provenanceSignal],
    rawSnapshots: [
      { id: "snapshot-linked", runId: "" },
      { id: "snapshot-unrelated-one", runId: "" },
      { id: "snapshot-unrelated-two", runId: "" }
    ],
    evidencePackages: []
  };
  const provenancePackage = await createSignalEvidencePackage({
    state: provenanceState,
    signalId: provenanceSignal.id,
    evidenceRoot: evidenceDir
  });
  const provenanceMeta = JSON.parse(await fs.readFile(
    path.join(provenancePackage.packageDirectory, "meta.json"),
    "utf8"
  ));
  equal(
    JSON.stringify(provenanceMeta.provenance.rawSnapshotIds),
    JSON.stringify(["snapshot-linked"]),
    "evidence provenance excludes unrelated empty-run snapshots"
  );
  pass("证据包 provenance 不会把空 runId 的无关快照混入来源链");

  let shortLinkRequestMethod = "";
  const resolvedShortLink = await resolveSourceIntakeUrl("https://xhslink.cn/o/regression", async (input, options) => {
    shortLinkRequestMethod = options.method;
    const target = "https://www.xiaohongshu.com/user/profile/regressionprofile?xsec_token=temporary";
    return {
      url: `https://www.xiaohongshu.com/login?redirectPath=${encodeURIComponent(target)}`,
      headers: new Map(),
      arrayBuffer: async () => new ArrayBuffer(0)
    };
  });
  equal(shortLinkRequestMethod, "GET", "XHS short-link resolution HTTP method");
  equal(resolvedShortLink, "https://www.xiaohongshu.com/user/profile/regressionprofile", "XHS login redirect profile canonicalization");
  pass("小红书短链从登录重定向参数还原主页并保留无参数身份");

  // Import identity keeps manual Inbox decisions instead of pushing records back to Inbox.
  await api(base, "/api/import", {
    signals: [{
      url: "https://example.com/first?utm_source=test",
      title: "First signal",
      platform: "other",
      seen: true,
      disposition: "dissect",
      note: "人工判断保留"
    }]
  });
  await api(base, "/api/import", {
    signals: [{
      url: "https://example.com/first?ref=x",
      title: "First signal changed",
      seen: false,
      disposition: "inbox",
      note: "自动导入覆盖"
    }]
  });
  let current = await state(base);
  equal(current.signals.length, 1, "signal identity count");
  equal(current.signals[0].disposition, "dissect", "signal disposition after duplicate import");
  equal(current.signals[0].seen, true, "signal seen after duplicate import");
  equal(current.signals[0].note, "人工判断保留", "protected signal note");
  pass("重复导入信号不打回 Inbox，并保留人工判断");
  const quickFunnel = current.runtime.inbox.sources.find((source) => source.sourceId === "quick-capture");
  equal(current.runtime.inbox.total, 1, "inbox funnel total count");
  equal(current.runtime.inbox.pending, 0, "inbox funnel pending count");
  equal(current.runtime.inbox.actionable, 1, "inbox funnel actionable count");
  equal(current.runtime.inbox.pushRate, 100, "inbox funnel push rate");
  equal(quickFunnel.total, 1, "quick capture funnel total count");
  pass("Inbox 清零漏斗能区分待处理、已推进和来源推送率");

  const quickCapture = (await api(base, "/api/capture", {
    text: "https://example.com/first?utm_source=test"
  })).run;
  equal(quickCapture.envelope.found, 1, "quick capture envelope found count");
  equal(quickCapture.envelope.created, 0, "quick capture envelope created count");
  equal(quickCapture.envelope.duplicates, 1, "quick capture envelope duplicate count");
  equal(quickCapture.envelope.failed, 0, "quick capture envelope failed count");
  equal(quickCapture.envelope.nextAction, "重复内容，未新增", "quick capture envelope next action");
  pass("快速粘贴返回统一采集结果信封");

  const lifecycleTopic = await addTopic(base, "Lifecycle topic", {
    coreIdea: "人工核心观点",
    stage: "published",
    sourceSignalIds: []
  });
  equal(lifecycleTopic.stage, "topic", "new imported topic stage");
  truthy(lifecycleTopic.productionChecks, "new topic production checks");
  truthy(lifecycleTopic.gates, "new topic gates");
  pass("API 新导入选题强制从 topic 开始");

  await failingApi(base, "/api/record", {
    type: "publications",
    record: { topicId: lifecycleTopic.id, platform: "douyin", status: "published" }
  }, /待发阶段/);

  const materialUrl = "https://example.com/material";
  await api(base, "/api/import", {
    materials: [{
      sourceUrl: materialUrl,
      excerpt: "需要保留的素材",
      whyValuable: "人工价值判断",
      topicIds: [lifecycleTopic.id]
    }]
  });
  await api(base, "/api/import", {
    materials: [{
      sourceUrl: `${materialUrl}?utm_campaign=duplicate`,
      excerpt: "需要保留的素材",
      whyValuable: "自动覆盖",
      topicIds: []
    }]
  });
  current = await state(base);
  equal(current.materials.length, 1, "material identity count");
  equal(current.materials[0].topicIds.length, 1, "material topic association count");
  equal(current.materials[0].whyValuable, "人工价值判断", "protected material judgment");
  pass("重复导入素材保留选题关联和人工价值判断");

  await updateStage(base, lifecycleTopic.id, "outline");
  await updateStage(base, lifecycleTopic.id, "draft");
  await updateStage(base, lifecycleTopic.id, "production");
  await api(base, "/api/update", {
    type: "topics",
    id: lifecycleTopic.id,
    patch: { gates: { evidence: true, opening: true, sample: true, final: true } }
  });
  await updateStage(base, lifecycleTopic.id, "review");
  await failingApi(base, "/api/update", {
    type: "topics",
    id: lifecycleTopic.id,
    patch: { stage: "ready-to-publish" }
  }, /七项生产检查/);
  await api(base, "/api/update", {
    type: "topics",
    id: lifecycleTopic.id,
    patch: {
      productionChecks: {
        coreIdea: true,
        targetReader: true,
        hook: true,
        outline: true,
        evidence: true,
        visuals: true,
        publishPackage: true
      }
    }
  });
  await updateStage(base, lifecycleTopic.id, "ready-to-publish");
  pass("选题按相邻阶段推进，并执行四关卡与七项检查");

    await failingApi(base, "/api/reviews/save", {
      advanceToReviewed: true,
      record: { topicId: lifecycleTopic.id, assumption: "未发布时不得推进", result: "应整体回滚" }
    }, /只有已发选题/);
    current = await state(base);
    equal(current.reviews.filter((review) => review.topicId === lifecycleTopic.id).length, 0, "failed review transaction leaves no record");

  await api(base, "/api/record", {
    type: "publications",
    record: { topicId: lifecycleTopic.id, platform: "douyin", status: "published" }
  });
  await failingApi(base, "/api/update", {
    type: "topics",
    id: lifecycleTopic.id,
    patch: { stage: "published" }
  }, /未全部发布/);
  await api(base, "/api/record", {
    type: "publications",
    record: { topicId: lifecycleTopic.id, platform: "xiaohongshu", status: "published" }
  });
  await api(base, "/api/record", {
    type: "publications",
    record: { topicId: lifecycleTopic.id, platform: "wechat", status: "published" }
  });
  await updateStage(base, lifecycleTopic.id, "published");
  await failingApi(base, "/api/update", {
    type: "topics",
    id: lifecycleTopic.id,
    patch: { stage: "reviewed" }
  }, /复盘记录/);
    await api(base, "/api/reviews/save", {
      advanceToReviewed: true,
      record: { topicId: lifecycleTopic.id, assumption: "测试假设", result: "通过回归" }
  });
    current = await state(base);
    equal(current.topics.find((topic) => topic.id === lifecycleTopic.id)?.stage, "reviewed", "review transaction advances stage");
    pass("三平台台账与复盘记录是 published / reviewed 的硬门槛，失败复盘事务不落盘");

  await api(base, "/api/record", {
    type: "publications",
    record: { topicId: lifecycleTopic.id, platform: "douyin", status: "failed", failureReason: "重复导入" }
  });
  current = await state(base);
  equal(current.publications.length, 3, "publication identity count");
  pass("同一选题同一平台发布台账幂等");

  const guardTopic = await addTopic(base, "Guard topic");
  await failingApi(base, "/api/update", {
    type: "topics",
    id: guardTopic.id,
    patch: { stage: "draft" }
  }, /不能跳级或回退/);
  await updateStage(base, guardTopic.id, "outline");
  await failingApi(base, "/api/update", {
    type: "topics",
    id: guardTopic.id,
    patch: { stage: "topic" }
  }, /不能跳级或回退/);
  await failingApi(base, "/api/update", {
    type: "topics",
    id: guardTopic.id,
    patch: { id: "overwritten", internalRuntime: "overwritten" }
  }, /fields are not editable/);
  const firstSettingsUpdate = await api(base, "/api/update", {
    type: "settings",
    patch: { inboxTime: "00:00", inboxDailyLimit: 1 }
  });
  equal(firstSettingsUpdate.settings.inboxTime, "00:00", "earliest valid inbox time");
  equal(firstSettingsUpdate.settings.inboxDailyLimit, 1, "minimum valid inbox daily limit");
  await api(base, "/api/update", {
    type: "settings",
    patch: { inboxTime: "23:59", inboxDailyLimit: 100 }
  });
  await api(base, "/api/update", {
    type: "settings",
    patch: { inboxTime: "09:00", inboxDailyLimit: 10 }
  });
  current = await state(base);
  equal(current.settings.inboxTime, "09:00", "saved inbox time");
  equal(current.settings.inboxDailyLimit, 10, "saved inbox daily limit");
  const settingsBeforeInvalid = JSON.stringify(current.settings);
  const invalidSettingsUpdates = [
    [{ patch: {} }, /patch cannot be empty/],
    [{ patch: [] }, /patch must be an object/],
    [{ patch: { automationEnabled: false } }, /fields are not editable/],
    [{ patch: { inboxTime: "24:00" } }, /inboxTime must use HH:MM/],
    [{ patch: { inboxTime: "12:60" } }, /inboxTime must use HH:MM/],
    [{ patch: { inboxTime: "9:00" } }, /inboxTime must use HH:MM/],
    [{ patch: { inboxTime: "09:00 " } }, /inboxTime must use HH:MM/],
    [{ patch: { inboxTime: 900 } }, /inboxTime must use HH:MM/],
    [{ patch: { inboxDailyLimit: 0 } }, /inboxDailyLimit must be an integer between 1 and 100/],
    [{ patch: { inboxDailyLimit: 101 } }, /inboxDailyLimit must be an integer between 1 and 100/],
    [{ patch: { inboxDailyLimit: 1.5 } }, /inboxDailyLimit must be an integer between 1 and 100/],
    [{ patch: { inboxDailyLimit: "10" } }, /inboxDailyLimit must be an integer between 1 and 100/]
  ];
  for (const [payload, messagePattern] of invalidSettingsUpdates) {
    const rejected = await failingApi(base, "/api/update", { type: "settings", ...payload }, messagePattern);
    equal(rejected.status, 400, "invalid settings return HTTP 400");
  }
  current = await state(base);
  equal(current.topics.find((topic) => topic.id === guardTopic.id)?.stage, "outline", "guarded topic stage after rejected patch");
  truthy(current.topics.some((topic) => topic.id === guardTopic.id), "guarded topic identity after rejected patch");
  equal(JSON.stringify(current.settings), settingsBeforeInvalid, "settings stay unchanged after rejected patches");
  equal(current.settings.automationEnabled, true, "automation setting remains outside generic settings patch");
  pass("选题阶段不能跳级或回退，settings 仅允许严格校验的时间与每日上限");

  // Agent tasks stay local unless explicitly mirrored, and outline/script imports respect the topic state machine.
  await api(base, "/api/agent-bridge/settings", { driveRoot });
  const agentTopic = await addTopic(base, "Agent topic");
  const outlineTask = (await api(base, "/api/agent-tasks/create", {
    agent: "codex",
    kind: "outline",
    title: "Outline task",
    objective: "Write an outline.",
    topicId: agentTopic.id,
    mirrorToDrive: false
  })).task;
  equal(outlineTask.driveStatus, "local-only", "outline task drive status");
  const persistedOutlineTask = JSON.parse(await fs.readFile(path.join(outlineTask.outboxPath, "task.json"), "utf8"));
  equal(persistedOutlineTask.drivePath, "", "persisted outline task drive path");
  equal(persistedOutlineTask.driveStatus, "local-only", "persisted outline task drive status");
  const launcherScript = await fs.readFile(path.join(outlineTask.outboxPath, "run-codex.ps1"), "utf8");
  truthy(launcherScript.includes("task.lock"), "Agent launcher lock file");
  truthy(launcherScript.includes("result.pending.md"), "Agent atomic result file");
  checkPowerShellSyntax(path.join(outlineTask.outboxPath, "run-codex.ps1"), "Codex launcher");
  const driveTaskParent = path.join(driveRoot, "ContentFlowWorkbench", "Outbox");
  const driveEntries = await fs.readdir(driveTaskParent, { withFileTypes: true }).catch(() => []);
  equal(driveEntries.length, 0, "Drive task directory count");
  await fs.writeFile(path.join(outlineTask.outboxPath, "result.md"), "# Outline\n\n- First point", "utf8");
  await api(base, "/api/agent-tasks/import", { id: outlineTask.id });
  current = await state(base);
  equal(current.topics.find((topic) => topic.id === agentTopic.id).stage, "outline", "topic stage after outline import");
  equal(current.scripts.filter((script) => script.topicId === agentTopic.id).length, 1, "outline script count");
  await failingApi(base, "/api/agent-tasks/import", { id: outlineTask.id }, /已导入/);
  pass("Agent 默认 local-only，提纲结果导入并推进到 outline，重复导入被拒绝");

  const scriptGuardTopic = await addTopic(base, "Script guard topic");
  const scriptTask = (await api(base, "/api/agent-tasks/create", {
    agent: "claude",
    kind: "script",
    title: "Script too early",
    objective: "Write a script.",
    topicId: scriptGuardTopic.id,
    mirrorToDrive: false
  })).task;
  checkPowerShellSyntax(path.join(scriptTask.outboxPath, "run-claude.ps1"), "Claude launcher");
  await fs.writeFile(path.join(scriptTask.outboxPath, "result.md"), "# Script\n\nToo early", "utf8");
  await failingApi(base, "/api/agent-tasks/import", { id: scriptTask.id }, /提纲阶段/);
  current = await state(base);
  equal(current.topics.find((topic) => topic.id === scriptGuardTopic.id).stage, "topic", "script guard topic stage");
  equal(current.scripts.filter((script) => script.topicId === scriptGuardTopic.id).length, 0, "script guard script count");
  pass("口播稿结果不能绕过 outline 阶段直接导入");

  await api(base, "/api/import", {
    sources: [{
      name: "Legacy browser source",
      url: "https://www.xiaohongshu.com/user/profile/legacy-regression",
      platform: "xiaohongshu",
      collectionMethod: "browser-assisted",
      keepReason: "旧数据没有 coverage 字段"
    }]
  });
  current = await state(base);
  const legacyBrowserSource = current.sources.find((source) => source.name === "Legacy browser source");
  const legacyCommand = current.runtime.commandCenter.records.find((record) => record.sourceId === legacyBrowserSource.id);
  equal(legacyCommand.controlStatus, "backfill", "legacy browser source command status");
  equal(legacyCommand.primaryAction, "capture", "legacy browser source command action");
  match(legacyCommand.nextAction, /主页总数待确认/, "legacy browser source command next action");

  const xhsSource = (await api(base, "/api/source-intake", {
    text: "@回归博主 在小红书已经有1.2万个粉丝、3000次赞与收藏、5篇笔记 https://www.xiaohongshu.com/user/profile/regressionprofile"
  })).source;
  equal(xhsSource.platform, "xiaohongshu", "source intake platform");
  equal(xhsSource.collectionMethod, "browser-assisted", "source intake collection method");
  equal(xhsSource.profileFollowers, 12000, "source intake follower count");
  equal(xhsSource.profileEngagement, 3000, "source intake profile engagement count");
  equal(xhsSource.coverage.status, "partial", "source intake initial coverage");

  const firstCapture = (await api(base, "/api/browser-capture", {
    sourceId: xhsSource.id,
    context: { profileNoteCount: 5, profileFollowers: 12000, profileEngagement: 3000 },
    items: [
      { url: "https://www.xiaohongshu.com/explore/one", title: "One", engagement: "10" },
      { url: "https://www.xiaohongshu.com/explore/two", title: "Two", engagement: "20" },
      { url: "https://www.xiaohongshu.com/explore/three", title: "Three", engagement: "30" }
    ]
  })).run;
  equal(firstCapture.loadedCount, 3, "first visible capture loaded count");
  equal(firstCapture.profileNoteCount, 5, "first visible capture profile total");
  equal(firstCapture.profileEngagement, 3000, "first visible capture profile engagement");
  equal(firstCapture.collectedCount, 3, "first visible capture collected count");
  equal(firstCapture.coveragePercent, 60, "first visible capture coverage percent");
  equal(firstCapture.coverageStatus, "partial", "first visible capture coverage status");
  equal(firstCapture.envelope.found, 3, "browser capture envelope found count");
  equal(firstCapture.envelope.created, 3, "browser capture envelope created count");
  equal(firstCapture.envelope.duplicates, 0, "browser capture envelope duplicate count");
  equal(firstCapture.envelope.coverage.collectedCount, 3, "browser capture envelope coverage count");
  equal(firstCapture.envelope.coverage.status, "partial", "browser capture envelope coverage status");
  current = await state(base);
  const firstCommand = current.runtime.commandCenter.records.find((record) => record.sourceId === xhsSource.id);
  equal(firstCommand.controlStatus, "backfill", "command center status after partial capture");
  equal(firstCommand.primaryAction, "capture", "command center primary action after partial capture");
  match(firstCommand.nextAction, /3\/5/, "command center next action after partial capture");

  const secondCapture = (await api(base, "/api/browser-capture", {
    sourceId: xhsSource.id,
    context: { profileNoteCount: 5, profileFollowers: 12000 },
    items: [
      { url: "https://www.xiaohongshu.com/explore/one", title: "One", engagement: "10" },
      { url: "https://www.xiaohongshu.com/explore/two", title: "Two", engagement: "20" },
      { url: "https://www.xiaohongshu.com/explore/three", title: "Three", engagement: "30" },
      { url: "https://www.xiaohongshu.com/explore/four", title: "Four", engagement: "40" },
      { url: "https://www.xiaohongshu.com/explore/five", title: "Five", engagement: "50" }
    ]
  })).run;
  equal(secondCapture.created, 2, "second visible capture created count");
  equal(secondCapture.duplicates, 3, "second visible capture duplicate count");
  equal(secondCapture.collectedCount, 5, "second visible capture collected count");
  equal(secondCapture.coverageStatus, "complete", "second visible capture coverage status");
  current = await state(base);
  equal(current.sources.find((source) => source.id === xhsSource.id).coverage.percent, 100, "source coverage after repeated capture");
  const completeCommand = current.runtime.commandCenter.records.find((record) => record.sourceId === xhsSource.id);
  equal(completeCommand.controlStatus, "complete", "command center status after complete capture");
  equal(completeCommand.primaryAction, "wait", "command center primary action after complete capture");
  match(completeCommand.nextAction, /5\/5/, "command center next action after complete capture");
  const duplicateIntake = (await api(base, "/api/source-intake", {
    text: "@回归博主 在小红书已经有1.3万个粉丝、3400次赞与收藏 https://www.xiaohongshu.com/user/profile/regressionprofile"
  })).source;
  equal(duplicateIntake.profileFollowers, 13000, "duplicate source intake follower metadata");
  equal(duplicateIntake.profileEngagement, 3400, "duplicate source intake profile engagement metadata");
  equal(duplicateIntake.coverage.collectedCount, 5, "duplicate source intake collected coverage");
  equal(duplicateIntake.coverage.percent, 100, "duplicate source intake coverage percent");
  truthy(current.rawSnapshots.some((snapshot) => snapshot.context?.profileNoteCount === 5), "visible capture snapshot context");
  pass("对标分享文案可登记，重复采集和重复登记都会保留覆盖率");

  const blockedProfileSource = (await api(base, "/api/source-intake", {
    text: "@游客态受限博主 在小红书已经有232篇笔记 https://www.xiaohongshu.com/user/profile/blockedregression"
  })).source;
  const inboxBeforeBlocked = (await state(base)).runtime.inbox;
  const blockedProfileCapture = (await api(base, "/api/browser-capture", {
    sourceId: blockedProfileSource.id,
    context: {
      profileNoteCount: 232,
      profileFollowers: 8000,
      profileEngagement: 20000,
      captureScope: "user-visible-profile-state",
      autoScroll: false,
      privateApiCalled: false
    },
    items: [],
    blockedItems: Array.from({ length: 12 }, (_, index) => ({
      title: "游客态可见笔记 " + (index + 1),
      engagement: String(100 + index),
      coverUrl: "https://sns-img-xhscdn.xhscdn.com/blocked-" + index + ".jpg",
      xsecToken: "token-" + index,
      noteId: "",
      reason: "note-id-unavailable"
    }))
  })).run;
  equal(blockedProfileCapture.status, "blocked", "blocked profile capture status");
  equal(blockedProfileCapture.loadedCount, 12, "blocked profile capture loaded count");
  equal(blockedProfileCapture.created, 0, "blocked profile capture created count");
  equal(blockedProfileCapture.blockedNoteCount, 12, "blocked profile capture blocked note count");
  equal(blockedProfileCapture.coverageStatus, "blocked", "blocked profile capture coverage status");
  equal(blockedProfileCapture.envelope.blocked, 1, "blocked profile capture envelope blocked count");
  current = await state(base);
  const blockedSource = current.sources.find((source) => source.id === blockedProfileSource.id);
  equal(blockedSource.coverage.identityStatus, "note-id-unavailable", "blocked source identity status");
  equal(current.signals.filter((signal) => signal.sourceId === blockedProfileSource.id).length, 0, "blocked profile signals withheld from Inbox");
  const blockedCommand = current.runtime.commandCenter.records.find((record) => record.sourceId === blockedProfileSource.id);
  equal(blockedCommand.controlStatus, "manual", "blocked source command status");
  equal(blockedCommand.primaryAction, "capture", "blocked source command action");
  match(blockedCommand.nextAction, /缺少可打开 noteId.*App 分享/, "blocked source command next action");
  equal(blockedCommand.blockedPreviews.length, 12, "blocked source command preview count");
  const allowedPreviewKeys = new Set([
    "title",
    "description",
    "engagement",
    "publishedAt",
    "coverUrl",
    "reason",
    "isNew",
    "firstSeenAt",
    "lastSeenAt"
  ]);
  truthy(
    blockedCommand.blockedPreviews.every((preview) => (
      Object.keys(preview).every((key) => allowedPreviewKeys.has(key))
    )),
    "blocked source command preview exposes only safe fields"
  );
  equal(
    blockedCommand.blockedPreviews.some((preview) => JSON.stringify(preview).includes("token-")),
    false,
    "blocked source command preview strips xsec token"
  );
  equal(current.runtime.inbox.total, inboxBeforeBlocked.total, "blocked previews do not change Inbox total");
  equal(current.runtime.inbox.pending, inboxBeforeBlocked.pending, "blocked previews do not change Inbox pending count");
  const blockedSnapshot = current.rawSnapshots.find((snapshot) => snapshot.runId === blockedProfileCapture.id);
  const blockedSnapshotContent = JSON.parse(blockedSnapshot.content);
  equal(blockedSnapshotContent.blockedItems.length, 12, "blocked profile raw snapshot item count");
  equal(
    blockedSnapshotContent.blockedItems.some((item) => Object.hasOwn(item, "xsecToken")),
    false,
    "blocked profile raw snapshot strips xsec token"
  );
  equal(blockedSnapshotContent.context.privateApiCalled, false, "blocked profile raw snapshot boundary");
  pass("小红书主页游客态可见但缺 noteId 时保留安全预览，不伪造链接或污染 Inbox");

  const historicalSnapshotState = {
    signals: [{
      id: "historical-signal",
      url: "https://www.xiaohongshu.com/explore/historical?xsec_token=keep-signal-token"
    }],
    rawSnapshots: [{
      id: "historical-snapshot",
      content: JSON.stringify({
        items: [{
          url: "https://www.xiaohongshu.com/explore/importable?xsec_token=keep-item-token"
        }],
        blockedItems: [{
          title: "历史受限卡片",
          engagement: "88",
          publishedAt: "2026-10-21T00:00:00.000Z",
          coverUrl: "https://sns-img-xhscdn.xhscdn.com/historical.jpg",
          reason: "note-id-unavailable",
          xsecToken: "remove-snapshot-token",
          noteId: ""
        }],
        context: { privateApiCalled: false }
      })
    }]
  };
  const sanitizedHistoricalState = sanitizeStateBlockedSnapshots(historicalSnapshotState);
  equal(sanitizedHistoricalState.changedSnapshots, 1, "historical blocked snapshot changed count");
  equal(sanitizedHistoricalState.removedFields, 2, "historical blocked snapshot removed field count");
  const sanitizedHistoricalContent = JSON.parse(sanitizedHistoricalState.state.rawSnapshots[0].content);
  equal(
    Object.keys(sanitizedHistoricalContent.blockedItems[0]).sort().join(","),
    "coverUrl,engagement,publishedAt,reason,title",
    "historical blocked snapshot exposes only safe fields"
  );
  equal(
    sanitizedHistoricalState.state.signals[0].url,
    historicalSnapshotState.signals[0].url,
    "historical sanitizer preserves signal URLs"
  );
  equal(
    sanitizedHistoricalContent.items[0].url,
    "https://www.xiaohongshu.com/explore/importable?xsec_token=keep-item-token",
    "historical sanitizer preserves importable item URLs"
  );
  equal(
    sanitizeStateBlockedSnapshots(sanitizedHistoricalState.state).changedSnapshots,
    0,
    "historical blocked snapshot sanitizer is idempotent"
  );
  pass("历史受限快照只保留安全预览字段，账号信号和可导入链接不变");

  const evidenceSignal = current.signals.find((signal) => signal.url === "https://www.xiaohongshu.com/explore/four");
  const firstEvidence = await api(base, "/api/evidence-packages/create", { signalId: evidenceSignal.id });
  truthy(firstEvidence.created, "first evidence package created flag");
  truthy(path.isAbsolute(firstEvidence.record.packageDirectory), "evidence package local directory path");
  equal(firstEvidence.record.missingLayers.length, 0, "evidence package raw snapshot layer");
  const evidenceDirectory = path.join(evidenceDir, firstEvidence.record.packageKey);
  const evidenceMeta = JSON.parse(await fs.readFile(path.join(evidenceDirectory, "meta.json"), "utf8"));
  equal(evidenceMeta.evidence.id, firstEvidence.record.id, "evidence meta ID");
  equal(evidenceMeta.provenance.rawSnapshotIds.length, 1, "evidence meta raw snapshot count");
  truthy(await fs.stat(path.join(evidenceDirectory, "raw", "snapshot.json")), "evidence raw snapshot file");
  truthy(await fs.stat(path.join(evidenceDirectory, "candidate", "excerpt.md")), "evidence candidate excerpt file");
  truthy(await fs.stat(path.join(evidenceDirectory, "media-manifest.json")), "evidence media manifest file");
  const checksumText = await fs.readFile(path.join(evidenceDirectory, "checksums.sha256"), "utf8");
  truthy(checksumText.includes(firstEvidence.record.metaSha256), "evidence checksum manifest");

  await api(base, "/api/evidence-packages/verify", {
    id: firstEvidence.record.id,
    state: "verified",
    checkedBy: "regression-user",
    note: "已核对 synthetic 原始快照"
  });
  const verifiedMeta = JSON.parse(await fs.readFile(path.join(evidenceDirectory, "meta.json"), "utf8"));
  equal(verifiedMeta.verification.state, "verified", "evidence meta verification state");
  const secondEvidence = await api(base, "/api/evidence-packages/create", { signalId: evidenceSignal.id });
  equal(secondEvidence.created, false, "duplicate evidence package created flag");
  equal(secondEvidence.record.verification.state, "verified", "evidence verification preserved after rebuild");
  current = await state(base);
  equal(current.evidencePackages.length, 1, "evidence package identity count");
  equal(current.runtime.evidencePackages.total, 1, "evidence runtime total");
  equal(current.runtime.evidencePackages.verified, 1, "evidence runtime verified count");

  const detailCapture = await api(base, "/api/browser-detail-capture", {
    signalId: evidenceSignal.id,
    sourceId: xhsSource.id,
    capture: {
      noteId: "four",
      captureUrl: "https://www.xiaohongshu.com/explore/four?xsec_token=detail",
      title: "Four detail",
      author: "回归博主",
      bodyText: "这是详情正文，包含一个数据口径：转化率 37%。",
      coverUrl: "https://sns-webpic-qc.xhscdn.com/cover.jpg",
      mediaItems: [
        { type: "image", url: "https://sns-webpic-qc.xhscdn.com/cover.jpg", description: "封面图" },
        { type: "video", url: "https://sns-video-hw.xhscdn.com/stream.mp4", description: "视频" }
      ],
      engagement: "58",
      transcriptStatus: "missing",
      rawPageText: "可见页面文本"
    }
  });
  truthy(detailCapture.ok, "browser detail capture result flag");
  equal(detailCapture.signal.contentText, "这是详情正文，包含一个数据口径：转化率 37%。", "detail capture body text");
  equal(detailCapture.signal.coverUrl, "https://sns-webpic-qc.xhscdn.com/cover.jpg", "detail capture cover URL");
  equal(detailCapture.signal.mediaItems.length, 2, "detail capture media count");
  equal(detailCapture.signal.transcriptStatus, "missing", "detail capture missing transcript status");
  equal(detailCapture.signal.transcriptText, "", "detail capture does not fabricate transcript text");
  equal(detailCapture.signal.url, "https://www.xiaohongshu.com/explore/four?xsec_token=detail", "successful detail capture updates signal URL");
  truthy(detailCapture.rebuildEvidenceRecommended, "detail capture evidence rebuild recommendation");
  equal(detailCapture.evidencePackageId, firstEvidence.record.id, "detail capture evidence identity");
  const legacyDetail = normalizeDetailCapture(
    { id: "legacy-signal", sourceId: xhsSource.id, url: "https://www.xiaohongshu.com/user/profile/regressionprofile/legacy-note" },
    { noteId: "legacy-note", captureUrl: "https://www.xiaohongshu.com/user/profile/regressionprofile/legacy-note", bodyText: "旧链接详情正文" }
  );
  equal(legacyDetail.capture.noteId, "legacy-note", "legacy XHS profile detail note ID");
  const blockedDetail = normalizeDetailCapture(
    { id: "blocked-signal", sourceId: xhsSource.id, url: "https://www.xiaohongshu.com/explore/blocked-note" },
    {
      noteId: "blocked-note",
      captureUrl: "https://www.xiaohongshu.com/explore/blocked-note",
      effectiveUrl: "https://www.xiaohongshu.com/404?error_code=300031",
      transcriptStatus: "blocked",
      rawPageText: "当前笔记暂时无法浏览"
    }
  );
  equal(blockedDetail.patch.transcriptStatus, "blocked", "blocked detail transcript status");
  equal(Object.prototype.hasOwnProperty.call(blockedDetail.patch, "contentText"), false, "blocked detail does not collect unrelated content");
  equal(blockedDetail.capture.extraction.redirectedFromDetailUrl, true, "blocked detail redirect boundary");
  await failingApi(base, "/api/browser-detail-capture", {
    signalId: evidenceSignal.id,
    sourceId: xhsSource.id,
    capture: { ...detailCapture.snapshot, noteId: "wrong", captureUrl: "https://www.xiaohongshu.com/explore/wrong" }
  }, /does not match signal/);
  current = await state(base);
  const detailSignal = current.signals.find((signal) => signal.id === evidenceSignal.id);
  const detailSnapshot = current.rawSnapshots.find((snapshot) => snapshot.id === detailSignal.rawSnapshotId);
  equal(detailSnapshot.format, "browser-detail-assisted", "detail capture snapshot format");
  equal(detailSnapshot.context.transcriptStatus, "missing", "detail capture snapshot transcript status");
  match(detailSnapshot.content, /privateApiCalled": false/, "detail capture snapshot boundary");
  const rebuiltEvidence = await api(base, "/api/evidence-packages/create", { signalId: evidenceSignal.id });
  equal(rebuiltEvidence.created, false, "detail capture rebuild preserves evidence identity");
  const rebuiltMediaManifest = JSON.parse(await fs.readFile(
    path.join(evidenceDir, rebuiltEvidence.record.packageKey, "media-manifest.json"),
    "utf8"
  ));
  equal(rebuiltMediaManifest.items.length, 2, "detail evidence media manifest count");
  equal(rebuiltMediaManifest.items.some((item) => item.type === "video"), true, "detail evidence video manifest type");
  pass("小红书详情书签可补齐正文、封面、媒体清单并如实标记逐字稿缺失");
  pass("分层证据包支持原始快照、候选摘录、媒体清单、哈希和人工核对留痕");

  equal(selectTranscriptMedia({
    mediaItems: [{ type: "video", url: "https://sns-video-hw.xhscdn.com/stream.m4s" }]
  }), null, "local ASR media selector rejects m4s segments");
  equal(selectTranscriptMedia({
    mediaItems: [
      { type: "video", url: "https://sns-video-hw.xhscdn.com/stream.m4s" },
      { type: "video", url: "https://sns-video-hw.xhscdn.com/stream.mp4" }
    ]
  }).url, "https://sns-video-hw.xhscdn.com/stream.mp4", "local ASR media selector accepts full MP4");

  const transcriptState = {
    signals: [{ id: "transcript-regression", transcriptStatus: "missing", transcriptText: "" }],
    transcriptRuns: []
  };
  const failedTranscript = applyTranscriptResult(transcriptState, "transcript-regression", {
    ok: false,
    error: "本地 ASR 未配置",
    run: { id: "failed-run", status: "failed", error: "本地 ASR 未配置" }
  });
  equal(failedTranscript.signal.transcriptStatus, "failed", "failed ASR result status");
  equal(failedTranscript.signal.transcriptText, "", "failed ASR result does not fabricate text");
  applyTranscriptResult(transcriptState, "transcript-regression", {
    ok: true,
    patch: {
      transcriptStatus: "captured",
      transcriptText: "这是真实转写文本。",
      transcriptSegments: [{ start: 0, end: 1, text: "这是真实转写文本。" }]
    },
    run: { id: "captured-run", status: "captured" }
  });
  applyTranscriptResult(transcriptState, "transcript-regression", {
    ok: false,
    error: "第二次运行失败",
    run: { id: "second-failed-run", status: "failed", error: "第二次运行失败" }
  });
  equal(transcriptState.signals[0].transcriptStatus, "captured", "later failed ASR preserves captured status");
  equal(transcriptState.signals[0].transcriptText, "这是真实转写文本。", "later failed ASR preserves captured text");
  equal(transcriptState.transcriptRuns.length, 3, "transcript run retention count");
  const replacementRunId = "transcript-replacement-run";
  transcriptState.transcriptRuns.unshift({
    id: replacementRunId,
    signalId: "transcript-regression",
    status: "running",
    startedAt: "2026-10-22T00:00:00.000Z"
  });
  applyTranscriptResult(transcriptState, "transcript-regression", {
    ok: true,
    patch: {
      transcriptStatus: "captured",
      transcriptText: "这是真实转写文本。",
      transcriptSegments: [{ start: 0, end: 1, text: "这是真实转写文本。" }]
    },
    run: {
      id: replacementRunId,
      signalId: "transcript-regression",
      status: "captured",
      startedAt: "2026-10-22T00:00:00.000Z",
      finishedAt: "2026-10-22T00:00:02.000Z"
    }
  });
  equal(
    transcriptState.transcriptRuns.filter((run) => run.id === replacementRunId).length,
    1,
    "background transcript result replaces its running placeholder"
  );
  equal(
    transcriptState.transcriptRuns.find((run) => run.id === replacementRunId).status,
    "captured",
    "background transcript placeholder final status"
  );
  pass("本地 ASR 只在成功时升级 captured，失败不覆盖旧真实逐字稿");

  const transcriptEvidence = await createSignalEvidencePackage({
    state: transcriptState,
    signalId: "transcript-regression",
    evidenceRoot: path.join(evidenceDir, "transcript-manual")
  });
  const transcriptEvidenceDirectory = path.join(evidenceDir, "transcript-manual", transcriptEvidence.record.packageKey);
  const transcriptEvidenceText = await fs.readFile(path.join(transcriptEvidenceDirectory, "candidate", "transcript.md"), "utf8");
  truthy(transcriptEvidenceText.includes("这是真实转写文本。"), "evidence package transcript text");
  truthy(transcriptEvidenceText.includes("00:00.000 - 00:01.000"), "evidence package transcript timeline");
  truthy(transcriptEvidence.record.layers.includes("candidate-transcript"), "evidence package transcript layer");
  const transcriptChecksums = await fs.readFile(path.join(transcriptEvidenceDirectory, "checksums.sha256"), "utf8");
  truthy(transcriptChecksums.includes("candidate/transcript.md"), "evidence package transcript checksum");
  pass("证据包会把本地 ASR 全文和时间轴作为待人工校对层保存");

  const transcriptFailure = await requestJson(base, "/api/signals/transcript", {
    signalId: evidenceSignal.id,
    force: false
  });
  equal(transcriptFailure.status, 200, "transcript API failure HTTP status");
  equal(transcriptFailure.payload.ok, false, "transcript API failure result flag");
  match(transcriptFailure.payload.error, /本地 ASR 未配置/, "transcript API ASR configuration error");
  equal(transcriptFailure.payload.run.status, "failed", "transcript API failed run status");
  current = await state(base);
  equal(current.signals.find((signal) => signal.id === evidenceSignal.id).transcriptStatus, "failed", "transcript API persists failed status");
  equal(current.transcriptRuns.length, 1, "transcript API run persistence count");
  pass("单条信号转写 API 失败时保留可重试运行记录，不伪造成功");

  const backgroundTranscript = await requestJson(base, "/api/signals/transcript", {
    signalId: evidenceSignal.id,
    force: true,
    background: true
  });
  equal(backgroundTranscript.status, 200, "background transcript HTTP status");
  equal(backgroundTranscript.payload.ok, true, "background transcript request flag");
  equal(backgroundTranscript.payload.accepted, true, "background transcript accepted flag");
  equal(backgroundTranscript.payload.background, true, "background transcript mode flag");
  equal(backgroundTranscript.payload.run.status, "running", "background transcript running placeholder");
  const backgroundRunId = backgroundTranscript.payload.run.id;
  let backgroundFinalRun = null;
  const backgroundDeadline = Date.now() + 10000;
  while (Date.now() < backgroundDeadline) {
    current = await state(base);
    const matchingRuns = current.transcriptRuns.filter((run) => run.id === backgroundRunId);
    equal(matchingRuns.length, 1, "background transcript run identity count while polling");
    if (matchingRuns[0]?.status !== "running") {
      backgroundFinalRun = matchingRuns[0];
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  truthy(backgroundFinalRun, "background transcript reaches terminal status");
  equal(backgroundFinalRun.status, "failed", "unconfigured background transcript final status");
  match(backgroundFinalRun.error, /本地 ASR 未配置/, "background transcript actionable failure");
  current = await state(base);
  equal(
    current.transcriptRuns.filter((run) => run.id === backgroundRunId).length,
    1,
    "background transcript run persistence count"
  );
  pass("后台转写立即返回 running 占位，轮询到终态且不会重复插入运行记录");

  await failingApi(
    base,
    "/api/signals/analysis",
    { signalId: evidenceSignal.id },
    /还没有逐字稿/
  );
  const invalidTimelineImport = await api(base, "/api/import", {
    signals: [{
      url: evidenceSignal.url,
      transcriptStatus: "captured",
      transcriptText: "这条逐字稿有全文，但时间轴分段无效。",
      transcriptSegments: [{ start: "invalid", end: 2, text: "这条逐字稿有全文，但时间轴分段无效。" }]
    }]
  });
  equal(invalidTimelineImport.totals.signals.merged, 1, "invalid timeline fixture merges existing signal");
  current = await state(base);
  const invalidTimelineSignal = current.signals.find((signal) => signal.id === evidenceSignal.id);
  equal(
    invalidTimelineSignal.transcriptText,
    "这条逐字稿有全文，但时间轴分段无效。",
    "invalid timeline fixture persists transcript text"
  );
  equal(invalidTimelineSignal.transcriptSegments.length, 1, "invalid timeline fixture persists segment");
  const invalidTimelineAnalysis = await failingApi(
    base,
    "/api/signals/analysis",
    { signalId: evidenceSignal.id },
    /可用的时间轴分段/
  );
  equal(invalidTimelineAnalysis.status, 400, "invalid timeline analysis HTTP status");

  const transcriptFixture = {
    transcriptStatus: "captured",
    transcriptText: "很多普通人以为社交靠讨好，但其实真正重要的是边界。第一，先识别自己的感受。第二，表达需求。最后，勇敢承担关系变化。你不需要让所有人满意。",
    transcriptModel: "regression-local-asr",
    transcriptDurationSeconds: 42,
    transcriptCapturedAt: "2026-10-22T00:00:00.000Z",
    transcriptSegments: [
      {
        start: 0,
        end: 8,
        startTimestamp: "00:00.000",
        endTimestamp: "00:08.000",
        text: "很多普通人以为社交靠讨好。"
      },
      {
        start: 8,
        end: 18,
        startTimestamp: "00:08.000",
        endTimestamp: "00:18.000",
        text: "但其实真正重要的是边界。"
      },
      {
        start: 18,
        end: 29,
        startTimestamp: "00:18.000",
        endTimestamp: "00:29.000",
        text: "第一，先识别自己的感受；第二，表达需求。"
      },
      {
        start: 29,
        end: 42,
        startTimestamp: "00:29.000",
        endTimestamp: "00:42.000",
        text: "最后，勇敢承担关系变化，你不需要让所有人满意。"
      }
    ]
  };
  await api(base, "/api/import", {
    signals: [{ url: evidenceSignal.url, ...transcriptFixture }]
  });
  current = await state(base);
  const mergedTranscriptSignal = current.signals.find((signal) => signal.id === evidenceSignal.id);
  equal(mergedTranscriptSignal.transcriptStatus, "captured", "analysis fixture transcript status");
  equal(mergedTranscriptSignal.transcriptSegments.length, 4, "analysis fixture segment count");
  truthy(
    current.signals.length === current.signals.filter((signal, index, list) => (
      list.findIndex((candidate) => candidate.id === signal.id) === index
    )).length,
    "analysis fixture preserves unique signal identities"
  );

  const firstAnalysisResponse = await api(base, "/api/signals/analysis", {
    signalId: evidenceSignal.id
  });
  equal(firstAnalysisResponse.reused, false, "first transcript analysis is newly generated");
  const firstAnalysis = firstAnalysisResponse.analysis;
  equal(firstAnalysis.evidenceState, "unverified", "transcript analysis evidence state");
  equal(firstAnalysis.input.transcriptModel, transcriptFixture.transcriptModel, "analysis transcript model");
  equal(firstAnalysis.input.segmentCount, transcriptFixture.transcriptSegments.length, "analysis segment count");
  truthy(firstAnalysis.analysis.quotes.length > 0, "analysis returns traceable quotes");
  const quoteCandidates = [
    firstAnalysis.analysis.hook.quote,
    firstAnalysis.analysis.promiseAndTension.quote,
    ...firstAnalysis.analysis.structure.map((part) => part.quote),
    ...firstAnalysis.analysis.audience.map((item) => item.quote),
    ...firstAnalysis.analysis.retention.map((item) => item.quote),
    ...firstAnalysis.analysis.emotionalPayoff.cues.map((item) => item.quote),
    ...firstAnalysis.analysis.quotes
  ].filter(Boolean);
  for (const quote of quoteCandidates) {
    truthy(quote.startTimestamp, "analysis quote start timestamp");
    truthy(quote.endTimestamp, "analysis quote end timestamp");
    match(quote.startTimestamp, /^(?:\d{2}:)?\d{2}:\d{2}\.\d{3}$/, "analysis quote start format");
    match(quote.endTimestamp, /^(?:\d{2}:)?\d{2}:\d{2}\.\d{3}$/, "analysis quote end format");
  }
  const serializedAnalysis = JSON.stringify(firstAnalysis);
  truthy(!/NaN|Invalid Date|\bundefined\b/.test(serializedAnalysis), "analysis contains no invalid display values");

  current = await state(base);
  const firstSignalAnalysisRuns = current.analysisRuns.filter((run) => run.signalId === evidenceSignal.id);
  equal(firstSignalAnalysisRuns.length, 1, "first analysis run persistence count");

  const reusedAnalysisResponse = await api(base, "/api/signals/analysis", {
    signalId: evidenceSignal.id
  });
  equal(reusedAnalysisResponse.reused, true, "unchanged transcript reuses analysis");
  equal(reusedAnalysisResponse.analysis.id, firstAnalysis.id, "reused analysis keeps identity");
  current = await state(base);
  equal(
    current.analysisRuns.filter((run) => run.signalId === evidenceSignal.id).length,
    1,
    "reused analysis does not duplicate persisted runs"
  );

  const forcedAnalysisResponse = await api(base, "/api/signals/analysis", {
    signalId: evidenceSignal.id,
    force: true
  });
  equal(forcedAnalysisResponse.reused, false, "forced analysis creates a new run");
  truthy(forcedAnalysisResponse.analysis.id !== firstAnalysis.id, "forced analysis receives a new ID");
  current = await state(base);
  equal(
    current.analysisRuns.filter((run) => run.signalId === evidenceSignal.id).length,
    2,
    "forced analysis persists a second run"
  );
  pass("逐字稿分析拒绝缺失文本和无效时间轴，并保留 unverified 带时间戳引文与可复用输入哈希");

  const analysisTaskResponse = await api(base, "/api/agent-tasks/create", {
    agent: "codex",
    kind: "dissect",
    title: "深挖流量结构：回归样本",
    objective: "基于全文逐字稿和时间轴解释内容结构，并给出可验证的创作假设。",
    signalId: evidenceSignal.id
  });
  const analysisTask = analysisTaskResponse.task;
  equal(analysisTask.signalId, evidenceSignal.id, "analysis Agent task signal binding");
  const analysisTaskJson = JSON.parse(await fs.readFile(path.join(analysisTask.outboxPath, "task.json"), "utf8"));
  const analysisTaskMarkdown = await fs.readFile(path.join(analysisTask.outboxPath, "task.md"), "utf8");
  equal(analysisTaskJson.signalId, evidenceSignal.id, "analysis task.json signal binding");
  truthy(analysisTaskJson.prompt.includes(transcriptFixture.transcriptText), "analysis task.json preserves full transcript");
  truthy(analysisTaskMarkdown.includes(transcriptFixture.transcriptText), "analysis task.md preserves full transcript");
  truthy(analysisTaskMarkdown.includes('"startTimestamp": "00:18.000"'), "analysis task includes segment start timestamp");
  truthy(analysisTaskMarkdown.includes('"endTimestamp": "00:29.000"'), "analysis task includes segment end timestamp");
  truthy(analysisTaskMarkdown.includes(transcriptFixture.transcriptModel), "analysis task includes ASR model");
  truthy(analysisTaskMarkdown.includes("unverified"), "analysis task preserves unverified evidence state");
  truthy(analysisTaskMarkdown.includes('"textTruncated": false'), "analysis task does not truncate the focused transcript");
  current = await state(base);
  const persistedAnalysisTask = current.agentTasks.find((task) => task.id === analysisTask.id);
  equal(persistedAnalysisTask.signalId, evidenceSignal.id, "persisted analysis Agent task signal binding");
  pass("Agent 深挖任务携带绑定 signalId、全文逐字稿、时间轴、ASR 模型和 unverified 边界");

  await fs.writeFile(path.join(analysisTask.outboxPath, "result.md"), "# 回归拆解\n\n只作为待核对假设。", "utf8");
  await api(base, "/api/agent-tasks/import", { id: analysisTask.id });
  current = await state(base);
  const importedAnalysisMaterial = current.materials.find((material) => (
    material.sourceUrl === `workbench://agent-task/${analysisTask.id}`
  ));
  equal(importedAnalysisMaterial?.evidenceState, "unverified", "imported analysis material evidence state");
  pass("Agent 深挖结果导入素材时保持 unverified，不自动升级为已核实证据");

  await api(base, "/api/agent-bridge/settings", { driveRoot });
  const knowledgeExportResponse = await api(base, "/api/knowledge/export", { driveRoot });
  equal(knowledgeExportResponse.export.evidenceState, "unverified", "knowledge export evidence state");
  equal(knowledgeExportResponse.export.analysisCount, 2, "knowledge export analysis count");
  equal(knowledgeExportResponse.export.transcriptCount, 2, "knowledge export transcript count");
  const knowledgeRoot = path.join(driveRoot, "ContentFlowWorkbench", "Knowledge");
  const knowledgeManifest = JSON.parse(await fs.readFile(path.join(knowledgeRoot, "manifest.json"), "utf8"));
  equal(knowledgeManifest.evidenceState, "unverified", "knowledge manifest evidence state");
  equal(knowledgeManifest.privacy.credentialsIncluded, false, "knowledge manifest excludes credentials");
  equal(knowledgeManifest.privacy.cookiesIncluded, false, "knowledge manifest excludes cookies");
  equal(knowledgeManifest.privacy.loginStateIncluded, false, "knowledge manifest excludes login state");
  truthy(knowledgeManifest.files.length >= 3, "knowledge manifest lists exported files");
  for (const file of knowledgeManifest.files) {
    match(file.sha256, /^[a-f0-9]{64}$/, "knowledge manifest SHA-256 format");
    const content = await fs.readFile(path.join(knowledgeRoot, ...file.path.split("/")));
    const actualHash = crypto.createHash("sha256").update(content).digest("hex");
    equal(file.sha256, actualHash, `knowledge manifest hash for ${file.path}`);
  }
  equal(
    publicShareUrl("https://user:secret@example.com/article?xsec_token=secret#access_token=fragment"),
    "",
    "knowledge export rejects URL credentials"
  );
  equal(
    publicShareUrl("https://example.com/article?xsec_token=secret&ref=share#access_token=fragment"),
    "https://example.com/article?ref=share",
    "knowledge export strips sensitive query values and fragments"
  );
  pass("Google Drive 显式导出生成可重算 SHA-256 清单，并声明不包含凭据、Cookie 和登录态");

  const pluginManifestResponse = await requestJson(base, "/api/agent-plugin/manifest", null, "GET");
  equal(pluginManifestResponse.status, 200, "agent plugin manifest HTTP status");
  equal(
    pluginManifestResponse.payload.protocolVersion,
    agentPluginContractVersion,
    "agent plugin manifest protocol version"
  );
  equal(
    pluginManifestResponse.payload.capabilities.length,
    agentPluginMethods.length,
    "agent plugin capability count"
  );
  equal(
    pluginManifestResponse.payload.runtime.baseUrl,
    base,
    "agent plugin manifest uses the running local service origin"
  );
  const pluginRoutes = new Set(pluginManifestResponse.payload.capabilities.map((capability) => capability.endpoint));
  for (let index = 0; index < agentPluginMethods.length; index += 1) {
    const expected = agentPluginMethods[index];
    const actual = pluginManifestResponse.payload.capabilities[index];
    equal(actual.name, expected.name, `agent plugin method ${index} name`);
    equal(actual.method, expected.httpMethod, `agent plugin method ${index} HTTP verb`);
    equal(actual.endpoint, expected.endpoint, `agent plugin method ${index} endpoint`);
    truthy(pluginRoutes.has(expected.endpoint), `agent plugin manifest route ${expected.endpoint}`);
  }
  equal(pluginManifestResponse.payload.runtime.credentialsIncluded, false, "agent plugin excludes credentials");
  pass(`本地插件协议 v${pluginManifestResponse.payload.protocolVersion} 固定公开 ${agentPluginMethods.length} 个方法，覆盖读取、矩阵、登记、逐字稿、分析、Agent 任务、Drive 导出、流水线和游客详情采集`);

  // A 200 HTML response is a failed collection, not a successful RSS import.
  const feedSource = (await api(base, "/api/import", {
    sources: [{
      name: "HTML feed",
      url: `http://127.0.0.1:${mockPort}/html-feed`,
      platform: "other",
      collectionMethod: "public-rss",
      keepReason: "回归测试"
    }]
  }));
  equal(feedSource.totals.sources.added, 1, "RSS source import count");
  current = await state(base);
  const htmlFeedSource = current.sources.find((source) => source.name === "HTML feed");
  const htmlRun = (await api(base, "/api/collect", { sourceId: htmlFeedSource.id })).run;
  equal(htmlRun.status, "failed", "HTML response collection status");
  equal(htmlRun.envelope.failed, 1, "failed collection envelope failed flag");
  equal(htmlRun.envelope.found, 0, "failed collection envelope found count");
  equal(htmlRun.envelope.error, htmlRun.failureReason, "failed collection envelope error");
  match(htmlRun.failureReason, /RSS \/ Atom/, "HTML response failure reason");
  equal((await state(base)).signals.length, 6, "signal count after HTML feed");
  current = await state(base);
  const failedCommand = current.runtime.commandCenter.records.find((record) => record.sourceId === htmlFeedSource.id);
  equal(failedCommand.controlStatus, "failed", "command center status after failed collection");
  equal(failedCommand.primaryAction, "inspect", "command center primary action after failed collection");
  match(failedCommand.error, /RSS \/ Atom/, "command center failure reason");
  pass("RSS 收到 200 HTML 时记录 failed，不生成假信号");

  // Drop-folder writes must be stable across two scans before import.
  const dropFile = path.join(dropDir, "half-write.json");
  await fs.writeFile(dropFile, JSON.stringify({
    signals: [{ url: "https://example.com/drop-signal", title: "Drop signal", platform: "other" }]
  }), "utf8");
  const firstScan = await api(base, "/api/drop-folder/scan", {});
  equal(firstScan.results[0].status, "pending", "first drop scan status");
  current = await state(base);
  const pendingDropRun = current.collectionRuns.find((run) => run.fileName === "half-write.json" && run.status === "pending");
  equal(pendingDropRun.envelope.failed, 0, "pending drop envelope failed flag");
  equal(pendingDropRun.envelope.nextAction, "等待文件写入稳定后自动重试", "pending drop envelope next action");
  const secondScan = await api(base, "/api/drop-folder/scan", {});
  equal(secondScan.results[0].status, "ok", "second drop scan status");
  equal(secondScan.results[0].created, 1, "second drop scan created count");
  current = await state(base);
  const stableDropRun = current.collectionRuns.find((run) => run.fileName === "half-write.json" && run.status === "ok");
  equal(stableDropRun.envelope.created, 1, "stable drop envelope created count");
  equal(stableDropRun.envelope.failed, 0, "stable drop envelope failed flag");
  truthy(await fs.stat(path.join(dropDir, "processed", "half-write.json")), "archived drop file");
  current = await state(base);
  truthy(current.signals.some((signal) => signal.url === "https://example.com/drop-signal"), "drop signal imported");
  pass("投递箱文件首轮 pending，第二轮稳定后入库并归档");

  const capability = platformCapabilityRuntime({
    sources: [
      { platform: "x" },
      { platform: "x" },
      { platform: "xiaohongshu" }
    ]
  });
  equal(capability.platforms.map((platform) => platform.id).join(","), "x,xiaohongshu,douyin,bilibili,wechat", "platform capability platform order");
  equal(capability.platforms.find((platform) => platform.id === "x").sourceCount, 2, "X platform source count");
  equal(capability.platforms.find((platform) => platform.id === "x").capabilities.comments.status, "unsupported", "X comments capability status");
  equal(capability.platforms.find((platform) => platform.id === "xiaohongshu").capabilities.list.status, "partial", "XHS list capability status");
  equal(capability.platforms.find((platform) => platform.id === "xiaohongshu").capabilities.transcript.status, "partial", "XHS transcript capability status");
  equal(capability.platforms.find((platform) => platform.id === "bilibili").capabilities.transcript.status, "partial", "Bilibili transcript capability status");
  equal(capability.platforms.find((platform) => platform.id === "wechat").capabilities.detail.status, "partial", "WeChat detail capability remains partial until fixture proof");
  equal(capability.platforms.find((platform) => platform.id === "wechat").capabilities.body.status, "partial", "WeChat body capability remains partial until fixture proof");
  const allowedCapabilityStatuses = new Set(["complete", "partial", "unsupported", "unknown"]);
  truthy(
    capability.platforms.every((platform) => (
      Object.values(platform.capabilities).every((item) => allowedCapabilityStatuses.has(item.status))
      && platform.loginBoundary
      && platform.riskBoundary
    )),
    "platform capability statuses and boundaries"
  );

  await fs.writeFile(path.join(dropDir, "morning-invalid.json"), "{}", "utf8");
  const firstMorningPipelineRun = await api(base, "/api/morning-pipeline/run", {});
  equal(firstMorningPipelineRun.ok, true, "pending morning pipeline request flag");
  equal(firstMorningPipelineRun.completed, true, "pending morning pipeline completed flag");
  equal(firstMorningPipelineRun.run.status, "pending", "pending morning pipeline aggregate status");
  equal(firstMorningPipelineRun.run.operations.dropFolder.status, "pending", "morning pipeline pending drop operation");
  equal(firstMorningPipelineRun.run.operations.collection.status, "skipped", "morning pipeline collection operation status");
  equal(firstMorningPipelineRun.collection.skipped, true, "morning pipeline disabled collection skip flag");
  const secondMorningPipelineRun = await api(base, "/api/morning-pipeline/run", {});
  equal(secondMorningPipelineRun.ok, true, "failed morning pipeline request flag");
  equal(secondMorningPipelineRun.completed, true, "failed morning pipeline completed flag");
  equal(secondMorningPipelineRun.run.status, "failed", "failed morning pipeline aggregate status");
  equal(secondMorningPipelineRun.run.operations.dropFolder.status, "failed", "morning pipeline failed drop operation");
  truthy(secondMorningPipelineRun.run.finishedAt, "morning pipeline finished timestamp");
  current = await state(base);
  equal(
    current.runtime.morningPipeline.stages.map((stage) => stage.id).join(","),
    "drop-folder,collection,agent-results,brief,inbox,production",
    "morning pipeline stage order"
  );
  equal(
    current.runtime.morningPipeline.stages.find((stage) => stage.id === "drop-folder").status,
    "failed",
    "morning pipeline failed stage status"
  );
  equal(
    current.runtime.morningPipeline.stages.find((stage) => stage.id === "collection").status,
    "skipped",
    "morning pipeline skipped collection stage status"
  );
  equal(current.morningPipelineRuns.length, 2, "persisted morning pipeline run count");
  equal(current.morningPipelineRuns[0].id, secondMorningPipelineRun.run.id, "latest morning pipeline run is first");
  equal(current.morningPipelineRuns[1].id, firstMorningPipelineRun.run.id, "older morning pipeline run is second");
  truthy(
    new Date(current.morningPipelineRuns[0].startedAt).getTime()
      >= new Date(current.morningPipelineRuns[1].startedAt).getTime(),
    "morning pipeline runs are newest-first"
  );
  const morningDropRuns = current.collectionRuns.filter((run) => run.fileName === "morning-invalid.json").slice(0, 2);
  equal(morningDropRuns[0].status, "failed", "latest collection run is first");
  equal(morningDropRuns[1].status, "pending", "older collection run is second");
  truthy(
    new Date(morningDropRuns[0].startedAt).getTime()
      >= new Date(morningDropRuns[1].startedAt).getTime(),
    "collection runs are newest-first"
  );
  equal(
    current.runtime.platformCapabilities.platforms.map((platform) => platform.id).join(","),
    "x,xiaohongshu,douyin,bilibili,wechat",
    "runtime platform capability platform order"
  );
  pass("晨间流水线保留 pending / failed 真实状态，运行记录按最新在前排列");

  const indexResponse = await fetch(`${base}/`);
  equal(indexResponse.status, 200, "workbench page status");
  const indexHtml = await indexResponse.text();
  const deepLinkResponse = await fetch(`${base}/workflow`);
  equal(deepLinkResponse.status, 200, "SPA deep-link status");
  truthy((await deepLinkResponse.text()).includes('id="root"'), "SPA deep-link falls back to React shell");
  const missingAssetResponse = await fetch(`${base}/assets/not-built.js`);
  equal(missingAssetResponse.status, 404, "missing built asset status");
  const missingExtensionlessAssetResponse = await fetch(`${base}/assets/no-extension`);
  equal(missingExtensionlessAssetResponse.status, 404, "missing extensionless built asset status");
  const traversalResponse = await requestRoute(base, "/..%2fpackage.json");
  equal(traversalResponse.status, 403, "static traversal response status");
  const topicCountBeforeBodyLimit = (await state(base)).topics.length;
  const oversizedBody = JSON.stringify({
    topics: [{ title: "Oversized body", padding: "x".repeat(3 * 1024 * 1024) }]
  });
  const oversizedResponse = await requestRoute(base, "/api/import", {
    method: "POST",
    body: oversizedBody,
    headers: { "content-type": "application/json" }
  });
  equal(oversizedResponse.status, 413, "oversized request response status");
  match(oversizedResponse.payload.error, /request body exceeds/, "oversized request error");
  equal((await state(base)).topics.length, topicCountBeforeBodyLimit, "topic count after oversized request");
  pass("单端口 SPA 回落、缺失资源拒绝、静态路径越界返回 403，超大请求返回 413 且不写主数据");

  const xhsCaptureSource = await fs.readFile(path.join(repoRoot, "web/src/lib/xhs-capture.ts"), "utf8");
  const flowSource = await fs.readFile(path.join(repoRoot, "web/src/features/flow.tsx"), "utf8");
  truthy(
    xhsCaptureSource.includes("/api/browser-capture")
      && xhsCaptureSource.includes("/api/browser-detail-capture")
      && xhsCaptureSource.includes("capture-bridge.html")
      && xhsCaptureSource.includes("expiresAt"),
    "React XHS capture keeps profile, detail, bridge and token expiry contracts"
  );
  truthy(
    flowSource.includes("canCaptureXhsProfile")
      && flowSource.includes("canCaptureXhsDetail")
      && flowSource.includes("xhsDetailBookmarkletHref")
      && flowSource.includes("BookmarkletActions"),
    "React flow exposes gated XHS profile and detail capture actions"
  );
  truthy(
    !existsSync(path.join(repoRoot, "app/app.js"))
      && !existsSync(path.join(repoRoot, "app/index.html"))
      && !existsSync(path.join(repoRoot, "app/styles.css"))
      && existsSync(path.join(repoRoot, "app/capture-bridge.html")),
    "legacy UI is removed while the capture bridge remains"
  );
  truthy(indexHtml.includes("cfw.theme") && indexHtml.includes('data-theme="light"'), "single-port React theme bootstrap");
  truthy(indexHtml.includes("/assets/index-") && indexHtml.includes('id="root"'), "single-port React asset entry");
  const serverJs = await fs.readFile(path.join(repoRoot, "scripts/server.mjs"), "utf8");
  truthy(serverJs.includes('from "./backup-store.mjs"'), "backup store module import");
  truthy(serverJs.includes("process.env.DROP_SCAN_MS || 30000"), "local file scan default interval");
  truthy(
    serverJs.includes('"/api/signals/transcript"') && serverJs.includes("runningTranscriptSignalIds"),
    "signal transcript API and per-signal concurrency lock"
  );
  equal((serverJs.match(/async function createBackup/g) || []).length, 0, "server-local backup writer count");
  pass("React 单入口、小红书采集契约、旧 UI 清理和备份模块边界冒烟通过");
  pass("生产台直接展示稿件正文、字数和相对上一版变更摘要");
  pass("已复盘选题在复盘区保留稿件正文和历史版本");
  pass("本地投递箱和 Agent 结果扫描默认间隔收紧到 30 秒");

  // A persisted task lock must survive a server restart and prevent duplicate detached Agent runs.
  await stopProcess(workbenchProcess);
  let diskState = JSON.parse(await fs.readFile(dataFile, "utf8"));
  const lockTask = diskState.agentTasks.find((task) => task.id === outlineTask.id);
  lockTask.status = "running";
  lockTask.localProcessPid = process.pid;
  lockTask.lastError = "";
  await fs.writeFile(path.join(lockTask.outboxPath, "task.lock"), JSON.stringify({
    taskId: lockTask.id,
    pid: process.pid,
    acquiredAt: new Date().toISOString()
  }), "utf8");
  await fs.writeFile(dataFile, JSON.stringify(diskState, null, 2), "utf8");
  workbenchProcess = await startWorkbench(workbenchPort, dataFile, dropDir, bridgeRoot, backupDir, evidenceDir, transcriptDir);
  await waitForServer(base);
  let restartedState = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    restartedState = await state(base);
    if (restartedState.agentTasks.find((task) => task.id === outlineTask.id)?.lastError?.includes("仍在运行")) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  equal(restartedState.agentTasks.find((task) => task.id === outlineTask.id).status, "running", "restarted live Agent task status");
  pass("服务重启后发现仍存活的 Agent 进程时保持 running，不允许重复启动");

  await stopProcess(workbenchProcess);
  await fs.writeFile(path.join(lockTask.outboxPath, "task.lock"), JSON.stringify({
    taskId: lockTask.id,
    pid: 999999,
    acquiredAt: new Date().toISOString()
  }), "utf8");
  workbenchProcess = await startWorkbench(workbenchPort, dataFile, dropDir, bridgeRoot, backupDir, evidenceDir, transcriptDir);
  await waitForServer(base);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    restartedState = await state(base);
    if (restartedState.agentTasks.find((task) => task.id === outlineTask.id)?.status === "outbox") break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  equal(restartedState.agentTasks.find((task) => task.id === outlineTask.id).status, "outbox", "restarted dead Agent task status");
  equal(await fs.readFile(path.join(lockTask.outboxPath, "task.lock"), "utf8").catch(() => ""), "", "removed stale Agent lock");
  pass("Agent 进程消失后恢复为 outbox，并清理 stale lock");

  const resultRecoveryTask = (await api(base, "/api/agent-tasks/create", {
    agent: "codex",
    kind: "research",
    title: "Recovered result task",
    objective: "Return a result after a stale local process lock."
  })).task;
  await fs.writeFile(path.join(resultRecoveryTask.outboxPath, "result.md"), "# Recovered\n\nResult survived a stale lock.", "utf8");
  await stopProcess(workbenchProcess);
  diskState = JSON.parse(await fs.readFile(dataFile, "utf8"));
  const recoveryTask = diskState.agentTasks.find((task) => task.id === resultRecoveryTask.id);
  recoveryTask.status = "running";
  recoveryTask.localProcessPid = 999999;
  await fs.writeFile(path.join(recoveryTask.outboxPath, "task.lock"), JSON.stringify({
    taskId: recoveryTask.id,
    pid: 999999,
    acquiredAt: new Date().toISOString()
  }), "utf8");
  await fs.writeFile(dataFile, JSON.stringify(diskState, null, 2), "utf8");
  workbenchProcess = await startWorkbench(workbenchPort, dataFile, dropDir, bridgeRoot, backupDir, evidenceDir, transcriptDir);
  await waitForServer(base);
  let recoveredResultState = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    recoveredResultState = await state(base);
    if (recoveredResultState.agentTasks.find((task) => task.id === resultRecoveryTask.id)?.status === "result-ready") break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const recoveredTask = recoveredResultState.agentTasks.find((task) => task.id === resultRecoveryTask.id);
  equal(recoveredTask.status, "result-ready", "dead local process with a result becomes result-ready");
  equal(recoveredTask.resultText, "# Recovered\n\nResult survived a stale lock.", "recovered result text");
  equal(recoveredTask.localProcessPid, null, "recovered result clears stale local process pid");
  equal(await fs.readFile(path.join(recoveryTask.outboxPath, "task.lock"), "utf8").catch(() => ""), "", "recovered result clears stale lock");
  pass("Agent 结果先于失效进程回流时进入 result-ready，并清理 PID 与锁");

  await api(base, "/api/agent-tasks/import", { id: resultRecoveryTask.id });
  await stopProcess(workbenchProcess);
  diskState = JSON.parse(await fs.readFile(dataFile, "utf8"));
  const importedRecoveryTask = diskState.agentTasks.find((task) => task.id === resultRecoveryTask.id);
  importedRecoveryTask.localProcessPid = 999998;
  await fs.writeFile(path.join(importedRecoveryTask.outboxPath, "task.lock"), JSON.stringify({
    taskId: importedRecoveryTask.id,
    pid: 999997,
    acquiredAt: new Date().toISOString()
  }), "utf8");
  await fs.writeFile(dataFile, JSON.stringify(diskState, null, 2), "utf8");
  workbenchProcess = await startWorkbench(workbenchPort, dataFile, dropDir, bridgeRoot, backupDir, evidenceDir, transcriptDir);
  await waitForServer(base);
  let cleanedImportedState = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    cleanedImportedState = await state(base);
    const task = cleanedImportedState.agentTasks.find((item) => item.id === resultRecoveryTask.id);
    const lockExists = await fs.stat(path.join(task.outboxPath, "task.lock")).then(() => true).catch(() => false);
    if (task.localProcessPid == null && !lockExists) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const cleanedImportedTask = cleanedImportedState.agentTasks.find((task) => task.id === resultRecoveryTask.id);
  equal(cleanedImportedTask.status, "imported", "imported result task status retained");
  equal(cleanedImportedTask.localProcessPid, null, "imported result task clears dead local process pid");
  equal(await fs.readFile(path.join(cleanedImportedTask.outboxPath, "task.lock"), "utf8").catch(() => ""), "", "imported result task clears dead lock");
  truthy(cleanedImportedTask.localRunMetadataCleanedAt, "imported result task records stale metadata cleanup");
  pass("已导入任务只在结果哈希匹配且 PID 与锁均已失效时清理旧运行元数据");

  const manualBackup = (await api(base, "/api/backups/create", {})).backup;
  equal(manualBackup.created, true, "manual backup created flag");
  truthy(await fs.stat(path.join(backupDir, manualBackup.filename)), "manual backup file");
  const duplicateBackup = (await api(base, "/api/backups/create", {})).backup;
  equal(duplicateBackup.created, false, "duplicate backup created flag");
  equal(duplicateBackup.filename, manualBackup.filename, "duplicate backup filename");
  await api(base, "/api/record", {
    type: "topics",
    record: { title: "Backup restore marker" }
  });
  truthy((await state(base)).topics.some((topic) => topic.title === "Backup restore marker"), "backup marker before restore");
  await api(base, "/api/backups/restore", { filename: manualBackup.filename });
  equal((await state(base)).topics.some((topic) => topic.title === "Backup restore marker"), false, "backup marker after restore");
  const backupList = (await requestJson(base, "/api/backups", null, "GET")).payload;
  truthy(backupList.backups.some((backup) => backup.filename === manualBackup.filename), "restored manual backup listed");
  truthy(backupList.backups.some((backup) => backup.reason === "pre-restore"), "pre-restore backup listed");
  await failingApi(base, "/api/backups/restore", { filename: "workbench-invalid.json" }, /invalid backup filename/);
  equal(path.resolve(dataFile), path.join(tempRoot, "workbench.json"), "regression data file isolation");
  pass("本地备份支持哈希去重、恢复前保底、显式恢复和非法文件拒绝");

  console.log(`\n${checks.length} chain regression checks passed`);
}

try {
  await main();
} finally {
  await stopProcess(workbenchProcess);
  await new Promise((resolve) => {
    if (!mockServer) return resolve();
    mockServer.close(() => resolve());
  });
  if (tempRoot) await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
}
