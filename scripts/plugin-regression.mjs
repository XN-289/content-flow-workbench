import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  ContentFlowWorkbenchClient,
  WorkbenchPluginError,
  normalizeLoopbackBaseUrl
} from "../plugin/content-flow-workbench/client.mjs";
import {
  agentPluginContractVersion,
  agentPluginMethods
} from "./agent-plugin-contract.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = path.join(repoRoot, "plugin", "content-flow-workbench");
const bundledManifestPath = path.join(pluginRoot, "manifest.json");
const checks = [];
let workbenchProcess = null;
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

function expectThrows(callback, code, label) {
  try {
    callback();
  } catch (error) {
    equal(error?.code, code, `${label} error code`);
    return error;
  }
  throw new Error(`${label}: expected ${code}`);
}

function fixtureState(driveRoot) {
  return {
    version: 1,
    settings: {
      collectionTime: "08:40",
      automationEnabled: false,
      morningBriefEnabled: true,
      inboxTime: "09:00",
      inboxDailyLimit: 20,
      streakDefinition: "",
      driveRoot
    },
    sources: [{
      id: "source-plugin",
      name: "插件回归博主",
      account: "插件回归博主",
      platform: "xiaohongshu",
      url: "https://www.xiaohongshu.com/user/profile/pluginprofile",
      role: "benchmark",
      collectionMethod: "browser-assisted",
      dataBoundary: "manual-copy",
      profileFollowers: 37000,
      profileEngagement: 22000,
      coverage: {
        totalNotes: 12,
        collectedCount: 1,
        lastLoadedCount: 1,
        status: "partial",
        percent: 8,
        updatedAt: "2026-10-22T00:00:00.000Z"
      }
    }],
    signals: [{
      id: "signal-plugin",
      sourceId: "source-plugin",
      url: "https://www.xiaohongshu.com/explore/plugin-regression?xsec_token=secret-token",
      title: "插件回归信号",
      note: "插件回归信号",
      author: "插件回归博主",
      platform: "xiaohongshu",
      capturedAt: "2026-10-22T00:00:00.000Z",
      createdAt: "2026-10-22T00:00:00.000Z",
      updatedAt: "2026-10-22T00:00:00.000Z",
      engagement: 100,
      authorMedianEngagement: 500,
      relativeMultiple: 2,
      automationTier: "high-potential",
      contentText: "这是详情正文。",
      mediaItems: [{
        type: "image",
        url: "https://sns-webpic-qc.xhscdn.com/cover.jpg"
      }],
      transcriptStatus: "captured",
      transcriptText: "很多普通人以为社交靠讨好，但其实真正重要的是边界。第一，先识别自己的感受。第二，表达需求。最后，勇敢承担关系变化。",
      transcriptModel: "fixture-asr",
      transcriptDurationSeconds: 30,
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
          text: "但其实真正重要的是边界。第一，先识别自己的感受。"
        },
        {
          start: 18,
          end: 30,
          startTimestamp: "00:18.000",
          endTimestamp: "00:30.000",
          text: "第二，表达需求。最后，勇敢承担关系变化。"
        }
      ]
    }],
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
    captureRuns: []
  };
}

async function waitForLocator(filePath) {
  let lastError = "";
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const descriptor = JSON.parse(await fs.readFile(filePath, "utf8"));
      if (descriptor.name === "content-flow-workbench" && descriptor.baseUrl) return descriptor;
      lastError = "descriptor does not name the workbench";
    } catch (error) {
      lastError = error.message;
    }
    if (workbenchProcess?.exitCode != null) {
      throw new Error(`temporary workbench exited early: ${workbenchProcess.getOutput()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`runtime locator was not published: ${lastError}`);
}

async function waitForState(baseUrl) {
  let lastError = "";
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/state`);
      if (response.ok) return response.json();
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`temporary workbench did not become healthy: ${lastError}`);
}

async function stopProcess(child) {
  if (!child || child.exitCode != null) return;
  child.kill();
  await Promise.race([
    once(child, "exit").catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 3000))
  ]);
  if (child.exitCode == null) {
    child.kill("SIGKILL");
    await Promise.race([
      once(child, "exit").catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 1000))
    ]);
  }
}

async function startWorkbench(paths) {
  const child = spawn(process.execPath, [path.join(repoRoot, "scripts", "server.mjs")], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: "0",
      DATA_FILE: paths.dataFile,
      BACKUP_DIR: paths.backupDir,
      DROP_DIR: paths.dropDir,
      BRIDGE_ROOT: paths.bridgeRoot,
      EVIDENCE_DIR: paths.evidenceDir,
      TRANSCRIPT_DIR: paths.transcriptDir,
      CONTENT_FLOW_WORKBENCH_RUNTIME_FILE: paths.runtimeFile,
      WORKBENCH_ASR_CONFIG: paths.missingAsrConfig,
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

async function verifyContractShape(liveManifest, bundledManifest) {
  equal(agentPluginContractVersion, 3, "agent plugin contract version");
  equal(bundledManifest.protocolVersion, 3, "bundled manifest protocol version");
  equal(liveManifest.protocolVersion, 3, "live manifest protocol version");
  equal(bundledManifest.$schema, undefined, "bundled manifest does not reference a missing schema");
  equal(bundledManifest.methods.length, 10, "bundled manifest method count");
  equal(liveManifest.capabilities.length, 10, "live manifest capability count");
  equal(agentPluginMethods.length, 10, "source contract method count");

  for (let index = 0; index < agentPluginMethods.length; index += 1) {
    const expected = agentPluginMethods[index];
    const bundled = bundledManifest.methods[index];
    const live = liveManifest.capabilities[index];
    equal(bundled.name, expected.name, `bundled method ${index} name`);
    equal(bundled.httpMethod, expected.httpMethod, `bundled method ${index} HTTP verb`);
    equal(bundled.endpoint, expected.endpoint, `bundled method ${index} endpoint`);
    equal(live.name, expected.name, `live method ${index} name`);
    equal(live.method, expected.httpMethod, `live method ${index} HTTP verb`);
    equal(live.endpoint, expected.endpoint, `live method ${index} endpoint`);
  }

  equal(liveManifest.runtime.credentialsIncluded, false, "live manifest credentials flag");
  equal(bundledManifest.runtime.credentialsIncluded, false, "bundled manifest credentials flag");
  equal(liveManifest.evidencePolicy.defaultState, "unverified", "live manifest evidence default");
  truthy(
    liveManifest.safetyBoundary.some((line) => /CAPTCHAs/i.test(line)),
    "live manifest preserves human CAPTCHA boundary"
  );
  truthy(
    liveManifest.safetyBoundary.some((line) => /does not request OAuth/.test(line)),
    "live manifest preserves Drive local-sync boundary"
  );

  const captureMethod = agentPluginMethods.find(
    (method) => method.name === "captureXiaohongshuNote"
  );
  truthy(captureMethod, "source contract declares captureXiaohongshuNote");
  equal(captureMethod.endpoint, "/api/xhs/guest-capture", "guest capture endpoint");
  equal(captureMethod.httpMethod, "POST", "guest capture HTTP verb");
  equal(captureMethod.inputSchema.required?.[0], "text", "guest capture required input");
  equal(captureMethod.inputSchema.additionalProperties, false, "guest capture closed input");
}

async function verifyClientSecurity(liveManifest) {
  equal(normalizeLoopbackBaseUrl("http://127.0.0.1:5177/"), "http://127.0.0.1:5177", "loopback base normalization");
  equal(normalizeLoopbackBaseUrl("http://localhost:5177"), "http://localhost:5177", "localhost base normalization");
  expectThrows(() => normalizeLoopbackBaseUrl("https://127.0.0.1:5177"), "INVALID_BASE_URL", "HTTPS rejection");
  expectThrows(() => normalizeLoopbackBaseUrl("http://example.com:5177"), "NON_LOOPBACK_BASE_URL", "non-loopback rejection");
  expectThrows(
    () => normalizeLoopbackBaseUrl("http://user:pass@127.0.0.1:5177"),
    "INVALID_BASE_URL",
    "credential rejection"
  );
  expectThrows(
    () => normalizeLoopbackBaseUrl("http://127.0.0.1:5177/api"),
    "INVALID_BASE_URL",
    "base path rejection"
  );
  expectThrows(
    () => normalizeLoopbackBaseUrl("http://127.0.0.1:5177?x=1"),
    "INVALID_BASE_URL",
    "base query rejection"
  );
  expectThrows(
    () => normalizeLoopbackBaseUrl("http://127.0.0.1:5177#state"),
    "INVALID_BASE_URL",
    "base hash rejection"
  );

  const requests = [];
  const spyClient = new ContentFlowWorkbenchClient({
    baseUrl: "http://127.0.0.1:5177",
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      const payload = new URL(url).pathname === "/api/agent-plugin/manifest"
        ? liveManifest
        : { ok: true, spy: true };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });
  equal(typeof spyClient.request, "undefined", "client does not expose arbitrary request");
  await spyClient.getManifest();
  await spyClient.getState();
  const discoveredBaseUrl = liveManifest.runtime.baseUrl;
  equal(requests.length, 2, "client performs only declared manifest and state requests");
  equal(requests[0].url, "http://127.0.0.1:5177/api/agent-plugin/manifest", "manifest request target");
  equal(requests[1].url, `${discoveredBaseUrl}/api/state`, "state request adopts manifest origin");
  for (const request of requests) {
    equal(request.options.redirect, "error", "client rejects redirects");
    equal(request.options.credentials, undefined, "client does not opt into credentials");
  }

  const hostileManifest = structuredClone(liveManifest);
  hostileManifest.capabilities = hostileManifest.capabilities.map((capability) => (
    capability.name === "getState"
      ? { ...capability, endpoint: "https://attacker.example/collect" }
      : capability
  ));
  const hostileClient = new ContentFlowWorkbenchClient({
    baseUrl: "http://127.0.0.1:5177",
    fetchImpl: async () => new Response(JSON.stringify(hostileManifest), {
      status: 200,
      headers: { "content-type": "application/json" }
    })
  });
  try {
    await hostileClient.getManifest();
    throw new Error("malicious manifest endpoint unexpectedly succeeded");
  } catch (error) {
    truthy(error instanceof WorkbenchPluginError, "malicious manifest returns plugin error");
    truthy(
      error.details?.some((detail) => detail.code === "UNSAFE_MANIFEST_ENDPOINT"),
      "malicious manifest endpoint is rejected"
    );
  }

  pass("插件客户端拒绝非 loopback、HTTPS、凭据、路径、query、hash、重定向和恶意 manifest endpoint");
}

async function verifyGuestCaptureTransport(liveManifest) {
  const requests = [];
  const client = new ContentFlowWorkbenchClient({
    baseUrl: "http://127.0.0.1:5177",
    fetchImpl: async (url, options) => {
      const pathname = new URL(url).pathname;
      requests.push({ url: String(url), options });
      const payload = pathname === "/api/agent-plugin/manifest"
        ? liveManifest
        : { ok: true, accepted: true };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  const shareText = "复制口令查看笔记 https://www.xiaohongshu.com/discovery/item/plugin-note?xsec_token=fixture-only";
  const stringResult = await client.captureXiaohongshuNote(shareText);
  equal(stringResult.ok, true, "captureXiaohongshuNote string input");
  equal(requests.length, 2, "guest capture performs manifest and declared method requests");
  equal(
    requests[1].url,
    `${liveManifest.runtime.baseUrl}/api/xhs/guest-capture`,
    "guest capture target"
  );
  equal(requests[1].options.method, "POST", "guest capture request verb");
  equal(
    JSON.parse(requests[1].options.body).text,
    shareText,
    "guest capture string normalization"
  );

  await client.captureXiaohongshuNote({ text: "小红书分享文本" });
  equal(requests.length, 3, "guest capture reuses connected manifest");
  equal(
    JSON.parse(requests[2].options.body).text,
    "小红书分享文本",
    "guest capture object input"
  );

  const invalidInputError = await client.captureXiaohongshuNote({
    text: shareText,
    cookie: "must-not-pass"
  }).then(
    () => null,
    (error) => error
  );
  equal(invalidInputError?.code, "INVALID_INPUT", "guest capture rejects unknown fields");

  pass("captureXiaohongshuNote 固定映射到 POST /api/xhs/guest-capture，并支持字符串或 { text } 入参");
}

async function verifyLiveMethods(client, paths) {
  const state = await client.getState();
  truthy(Array.isArray(state.signals), "getState returns signal collection");
  equal(state.signals.find((signal) => signal.id === "signal-plugin")?.transcriptStatus, "captured", "getState fixture transcript");

  const capabilities = await client.getPlatformCapabilities();
  equal(capabilities.platforms.length, 5, "getPlatformCapabilities platform count");
  equal(capabilities.dimensions.length, 6, "getPlatformCapabilities dimension count");
  equal(capabilities.platforms.find((platform) => platform.id === "xiaohongshu").sourceCount, 1, "Xiaohongshu source count");
  equal(capabilities.platforms.find((platform) => platform.id === "bilibili").sourceCount, 0, "Bilibili source count");

  const intake = await client.intakeSource(
    "@插件新博主 3.7万粉丝 https://www.xiaohongshu.com/user/profile/pluginnewprofile"
  );
  equal(intake.ok, true, "intakeSource ok");
  equal(intake.source.platform, "xiaohongshu", "intakeSource platform");
  equal(intake.source.profileFollowers, 37000, "intakeSource follower metadata");
  equal(intake.source.collectionMethod, "browser-assisted", "intakeSource browser boundary");

  const transcript = await client.captureTranscript({
    signalId: "signal-plugin",
    force: true,
    background: false
  });
  equal(transcript.ok, false, "captureTranscript does not fake success without MP4");
  match(transcript.error, /完整 MP4/, "captureTranscript missing-MP4 message");
  match(transcript.error, /不使用 m4s 分片或正文冒充逐字稿/, "captureTranscript transcript boundary");

  const firstAnalysis = await client.createAnalysis({ signalId: "signal-plugin" });
  equal(firstAnalysis.ok, true, "createAnalysis ok");
  equal(firstAnalysis.reused, false, "createAnalysis first run is new");
  equal(firstAnalysis.analysis.evidenceState, "unverified", "createAnalysis evidence state");
  equal(firstAnalysis.analysis.input.segmentCount, 3, "createAnalysis segment count");
  truthy(firstAnalysis.analysis.analysis.quotes.length > 0, "createAnalysis includes timestamped quotes");
  for (const quote of firstAnalysis.analysis.analysis.quotes) {
    truthy(quote.startTimestamp, "analysis quote has start timestamp");
    truthy(quote.endTimestamp, "analysis quote has end timestamp");
  }

  const reusedAnalysis = await client.createAnalysis({ signalId: "signal-plugin" });
  equal(reusedAnalysis.reused, true, "createAnalysis reuses unchanged transcript");
  equal(reusedAnalysis.analysis.id, firstAnalysis.analysis.id, "createAnalysis reuse keeps ID");

  const task = await client.createAgentTask({
    agent: "codex",
    kind: "dissect",
    title: "插件回归：深挖流量结构",
    objective: "基于全文逐字稿和时间轴解释内容结构，并给出待验证的创作假设。",
    signalId: "signal-plugin",
    outputRequirements: "保留时间戳、unverified 边界和可复用公式。"
  });
  equal(task.ok, true, "createAgentTask ok");
  equal(task.task.signalId, "signal-plugin", "createAgentTask signal binding");
  const taskJson = JSON.parse(await fs.readFile(path.join(task.task.outboxPath, "task.json"), "utf8"));
  const taskMarkdown = await fs.readFile(path.join(task.task.outboxPath, "task.md"), "utf8");
  truthy(
    taskJson.prompt.includes(state.signals.find((signal) => signal.id === "signal-plugin").transcriptText),
    "Agent task preserves full transcript"
  );
  truthy(taskMarkdown.includes("00:18.000"), "Agent task preserves timeline");
  truthy(taskMarkdown.includes("unverified"), "Agent task preserves evidence state");

  const exported = await client.exportKnowledge({ driveRoot: paths.driveRoot });
  equal(exported.ok, true, "exportKnowledge ok");
  equal(exported.export.evidenceState, "unverified", "exportKnowledge evidence state");
  equal(exported.export.transcriptCount, 1, "exportKnowledge transcript count");
  equal(exported.export.analysisCount, 1, "exportKnowledge analysis count");
  const knowledgeRoot = path.join(paths.driveRoot, "ContentFlowWorkbench", "Knowledge");
  const manifest = JSON.parse(await fs.readFile(path.join(knowledgeRoot, "manifest.json"), "utf8"));
  equal(manifest.privacy.credentialsIncluded, false, "knowledge export excludes credentials");
  equal(manifest.privacy.cookiesIncluded, false, "knowledge export excludes cookies");
  equal(manifest.privacy.loginStateIncluded, false, "knowledge export excludes login state");
  for (const file of manifest.files) {
    match(file.sha256, /^[a-f0-9]{64}$/, `knowledge hash format for ${file.path}`);
    const content = await fs.readFile(path.join(knowledgeRoot, ...file.path.split("/")));
    const actual = crypto.createHash("sha256").update(content).digest("hex");
    equal(file.sha256, actual, `knowledge hash for ${file.path}`);
  }
  const transcriptFile = manifest.files.find((file) => file.path.startsWith("transcripts/"));
  truthy(transcriptFile, "knowledge export contains transcript file");
  const exportedTranscript = JSON.parse(
    await fs.readFile(path.join(knowledgeRoot, ...transcriptFile.path.split("/")), "utf8")
  );
  truthy(!exportedTranscript.url.includes("secret-token"), "knowledge export strips capture token");

  const pipeline = await client.runMorningPipeline();
  equal(pipeline.ok, true, "runMorningPipeline ok");
  equal(pipeline.completed, true, "runMorningPipeline completed");
  equal(pipeline.run.stages.length, 6, "runMorningPipeline stage count");
  truthy(Array.isArray(pipeline.run.nextActions), "runMorningPipeline returns next actions");

  pass("九个既有插件方法真实调用：状态、平台矩阵、登记、逐字稿失败边界、分析、Agent 任务、Drive 导出和晨间流水线");
}

async function verifyGuestCaptureBackendReadiness(baseUrl, liveManifest, client) {
  const serverSource = await fs.readFile(path.join(repoRoot, "scripts", "server.mjs"), "utf8");
  truthy(serverSource.includes('pathname === "/api/xhs/guest-capture"'), "guest capture backend route");
  truthy(serverSource.includes("captureXhsGuestNote(text"), "guest capture backend adapter invocation");
  truthy(serverSource.includes("publicCaptureRun"), "guest capture public run projection");

  const runtimeMethod = (liveManifest.capabilities || liveManifest.methods || [])
    .find((method) => method.name === "captureXiaohongshuNote");
  truthy(runtimeMethod, "runtime guest capture method");
  equal(runtimeMethod.endpoint, "/api/xhs/guest-capture", "runtime guest capture endpoint");
  equal(runtimeMethod.inputSchema?.additionalProperties, false, "runtime guest capture closed schema");
  const contractMethod = agentPluginMethods.find((method) => method.name === "captureXiaohongshuNote");
  truthy(contractMethod, "source guest capture contract");
  equal(contractMethod.endpoint, runtimeMethod.endpoint, "guest capture source/runtime endpoint");
  equal(contractMethod.inputSchema?.additionalProperties, false, "guest capture source closed schema");

  const before = await client.getState();
  const response = await fetch(`${baseUrl}/api/xhs/guest-capture`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}"
  });
  const payload = await response.json();
  equal(response.status, 400, "guest capture empty input status");
  match(payload.error, /text is required/, "guest capture empty input reason");
  const after = await client.getState();
  equal(
    (after.captureRuns || []).length,
    (before.captureRuns || []).length,
    "guest capture empty input does not start browser run"
  );
  pass("小红书真实采集路由已接入，空输入在启动 Chrome 前返回 400，源码/运行时契约一致");
}

async function main() {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "content-flow-plugin-"));
  const paths = {
    dataFile: path.join(tempRoot, "workbench.json"),
    backupDir: path.join(tempRoot, "backups"),
    dropDir: path.join(tempRoot, "drops"),
    bridgeRoot: path.join(tempRoot, "bridge"),
    evidenceDir: path.join(tempRoot, "evidence"),
    transcriptDir: path.join(tempRoot, "transcripts"),
    runtimeFile: path.join(tempRoot, "runtime.json"),
    missingAsrConfig: path.join(tempRoot, "missing-asr-runtime.local.json"),
    driveRoot: path.join(tempRoot, "Google Drive")
  };
  await Promise.all([
    fs.mkdir(paths.backupDir, { recursive: true }),
    fs.mkdir(paths.dropDir, { recursive: true }),
    fs.mkdir(paths.bridgeRoot, { recursive: true }),
    fs.mkdir(paths.evidenceDir, { recursive: true }),
    fs.mkdir(paths.transcriptDir, { recursive: true }),
    fs.mkdir(paths.driveRoot, { recursive: true })
  ]);
  await fs.writeFile(paths.dataFile, JSON.stringify(fixtureState(paths.driveRoot), null, 2), "utf8");

  workbenchProcess = await startWorkbench(paths);
  const locator = await waitForLocator(paths.runtimeFile);
  equal(locator.pid, workbenchProcess.pid, "runtime locator PID");
  truthy(Number.isInteger(locator.port) && locator.port > 0, "runtime locator dynamic port");
  equal(locator.baseUrl, `http://127.0.0.1:${locator.port}`, "runtime locator URL");
  equal(locator.protocolVersion, 3, "runtime locator protocol");
  await waitForState(locator.baseUrl);
  pass("服务使用 PORT=0 启动，并在真实监听后发布可发现的 PID、端口、URL 和协议 locator");

  const savedBaseUrl = process.env.CONTENT_FLOW_WORKBENCH_URL;
  delete process.env.CONTENT_FLOW_WORKBENCH_URL;
  const client = new ContentFlowWorkbenchClient({ runtimeFile: paths.runtimeFile });
  const liveManifest = await client.getManifest();
  equal(client.baseUrl, locator.baseUrl, "client discovers locator base URL");

  const bundledManifest = JSON.parse(await fs.readFile(bundledManifestPath, "utf8"));
  await verifyContractShape(liveManifest, bundledManifest);
  pass("静态 manifest、运行时 manifest 和源码契约为协议 v3 的同一组十方法十路由顺序");

  await verifyClientSecurity(liveManifest);
  await verifyGuestCaptureTransport(liveManifest);
  await verifyLiveMethods(client, paths);
  await verifyGuestCaptureBackendReadiness(locator.baseUrl, liveManifest, client);

  if (savedBaseUrl === undefined) {
    delete process.env.CONTENT_FLOW_WORKBENCH_URL;
  } else {
    process.env.CONTENT_FLOW_WORKBENCH_URL = savedBaseUrl;
  }

  await stopProcess(workbenchProcess);
  workbenchProcess = null;
  pass("隔离服务退出后清除全部临时数据，不接触正式工作台状态");

  console.log(`\n${checks.length} plugin regression checks passed`);
}

try {
  await main();
} finally {
  await stopProcess(workbenchProcess);
  if (tempRoot) await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
}
