import http from "node:http";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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

async function startWorkbench(port, dataFile, dropDir, bridgeRoot, backupDir, evidenceDir) {
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
  await fs.mkdir(dropDir, { recursive: true });
  await fs.mkdir(bridgeRoot, { recursive: true });
  await fs.mkdir(driveRoot, { recursive: true });
  await fs.mkdir(backupDir, { recursive: true });
  await fs.mkdir(evidenceDir, { recursive: true });

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

  workbenchProcess = await startWorkbench(workbenchPort, dataFile, dropDir, bridgeRoot, backupDir, evidenceDir);
  await waitForServer(base);

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

  const lifecycleTopic = await addTopic(base, "Lifecycle topic", {
    coreIdea: "人工核心观点",
    stage: "published",
    sourceSignalIds: []
  });
  equal(lifecycleTopic.stage, "topic", "new imported topic stage");
  truthy(lifecycleTopic.productionChecks, "new topic production checks");
  truthy(lifecycleTopic.gates, "new topic gates");
  pass("API 新导入选题强制从 topic 开始");

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
  await api(base, "/api/record", {
    type: "reviews",
    record: { topicId: lifecycleTopic.id, assumption: "测试假设", result: "通过回归" }
  });
  await updateStage(base, lifecycleTopic.id, "reviewed");
  pass("三平台台账与复盘记录是 published / reviewed 的硬门槛");

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
  await failingApi(base, "/api/update", {
    type: "settings",
    id: "automation",
    patch: { automationEnabled: false }
  }, /unknown or read-only record type/);
  current = await state(base);
  equal(current.topics.find((topic) => topic.id === guardTopic.id)?.stage, "outline", "guarded topic stage after rejected patch");
  truthy(current.topics.some((topic) => topic.id === guardTopic.id), "guarded topic identity after rejected patch");
  equal(current.settings.automationEnabled, true, "automation setting after rejected patch");
  pass("选题阶段不能跳级或回退，更新字段有白名单");

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
    text: "@回归博主 在小红书已经有1.2万个粉丝、5篇笔记 https://www.xiaohongshu.com/user/profile/regression-profile"
  })).source;
  equal(xhsSource.platform, "xiaohongshu", "source intake platform");
  equal(xhsSource.collectionMethod, "browser-assisted", "source intake collection method");
  equal(xhsSource.profileFollowers, 12000, "source intake follower count");
  equal(xhsSource.coverage.status, "partial", "source intake initial coverage");

  const firstCapture = (await api(base, "/api/browser-capture", {
    sourceId: xhsSource.id,
    context: { profileNoteCount: 5, profileFollowers: 12000 },
    items: [
      { url: "https://www.xiaohongshu.com/explore/one", title: "One", engagement: "10" },
      { url: "https://www.xiaohongshu.com/explore/two", title: "Two", engagement: "20" },
      { url: "https://www.xiaohongshu.com/explore/three", title: "Three", engagement: "30" }
    ]
  })).run;
  equal(firstCapture.loadedCount, 3, "first visible capture loaded count");
  equal(firstCapture.profileNoteCount, 5, "first visible capture profile total");
  equal(firstCapture.collectedCount, 3, "first visible capture collected count");
  equal(firstCapture.coveragePercent, 60, "first visible capture coverage percent");
  equal(firstCapture.coverageStatus, "partial", "first visible capture coverage status");
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
    text: "@回归博主 在小红书已经有1.3万个粉丝 https://www.xiaohongshu.com/user/profile/regression-profile"
  })).source;
  equal(duplicateIntake.profileFollowers, 13000, "duplicate source intake follower metadata");
  equal(duplicateIntake.coverage.collectedCount, 5, "duplicate source intake collected coverage");
  equal(duplicateIntake.coverage.percent, 100, "duplicate source intake coverage percent");
  truthy(current.rawSnapshots.some((snapshot) => snapshot.context?.profileNoteCount === 5), "visible capture snapshot context");
  pass("对标分享文案可登记，重复采集和重复登记都会保留覆盖率");

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
  pass("分层证据包支持原始快照、候选摘录、媒体清单、哈希和人工核对留痕");

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
  const secondScan = await api(base, "/api/drop-folder/scan", {});
  equal(secondScan.results[0].status, "ok", "second drop scan status");
  equal(secondScan.results[0].created, 1, "second drop scan created count");
  truthy(await fs.stat(path.join(dropDir, "processed", "half-write.json")), "archived drop file");
  current = await state(base);
  truthy(current.signals.some((signal) => signal.url === "https://example.com/drop-signal"), "drop signal imported");
  pass("投递箱文件首轮 pending，第二轮稳定后入库并归档");

  const indexResponse = await fetch(`${base}/`);
  equal(indexResponse.status, 200, "workbench page status");
  const indexHtml = await indexResponse.text();
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
  pass("静态路径越界返回 403，超大请求返回 413 且不写主数据");

  const appJs = await fs.readFile(path.join(repoRoot, "app/app.js"), "utf8");
  truthy(appJs.includes("function browserCaptureToken"), "browser capture token helper");
  equal((appJs.match(/data-edit-form=/g) || []).length, 3, "record edit form count");
  truthy(appJs.includes("form.dataset.editForm"), "record edit submit handler");
  truthy(
    appJs.includes("if (directProduction)") && appJs.includes('updateRecord("topics", createdTopic.id, { stage: "outline" })'),
    "direct production stage advance helper"
  );
  truthy(appJs.includes("function renderBackups"), "backup view renderer");
  truthy(appJs.includes("function renderCommandCenter"), "command center renderer");
  truthy(appJs.includes("function renderInbox"), "inbox renderer");
  truthy(
    appJs.includes("create-evidence-package") && appJs.includes("copy-evidence-path") && appJs.includes("data-evidence-form"),
    "inbox evidence package controls"
  );
  truthy(
    appJs.includes("标记“证据已核对”前，请填写人工核对说明。"),
    "verified evidence requires a visible human note"
  );
  truthy(appJs.includes("commandCoverageText"), "command center coverage helper");
  truthy(appJs.includes("const navItems"), "primary tab navigation definition");
  truthy(appJs.includes('["overview", "总览"]'), "overview primary tab");
  truthy(appJs.includes('["flow", "信息流"]'), "information flow primary tab");
  truthy(appJs.includes('["workflow", "工作流"]'), "workflow primary tab");
  truthy(appJs.includes('["system", "系统"]'), "system primary tab");
  truthy(!appJs.includes('["today", "今日"]'), "no former today child tab");
  truthy(!appJs.includes('["sources", "账号"]'), "no former sources child tab");
  truthy(appJs.includes("function renderInformationFlow"), "information flow combined renderer");
  truthy(appJs.includes("function renderWorkflowWorkspace"), "workflow combined renderer");
  truthy(appJs.includes("function renderSystemWorkspace"), "system combined renderer");
  truthy(appJs.includes("function renderFlowRhythm"), "information flow rhythm renderer");
  truthy(appJs.includes("function dailyPriorityQueue"), "daily priority queue renderer");
  truthy(appJs.includes("function renderWorkflowPipeline"), "workflow pipeline renderer");
  truthy(appJs.includes("function renderPublishBoard"), "publish board renderer");
  truthy(appJs.includes("function comparePublications"), "publish queue sorting helper");
  truthy(appJs.includes("function recentFrictionLog") && appJs.includes("function renderFrictionSummary"), "three-day friction summary helper");
  truthy(appJs.includes("function viewFromLocationHash"), "primary tab deep-link helper");
  truthy(appJs.includes("async function activateView"), "primary tab activation helper");
  truthy(appJs.includes('window.addEventListener("hashchange"'), "primary tab hash-change handler");
  truthy(indexHtml.includes('data-theme="auto"') && indexHtml.includes('data-action="set-theme"'), "explicit theme mode switch");
  truthy(appJs.includes("function setTheme") && appJs.includes("localStorage.setItem(themeStorageKey"), "theme mode persistence helper");
  const todayRenderer = appJs.slice(
    appJs.indexOf("function renderToday"),
    appJs.indexOf("function renderSources")
  );
  truthy(todayRenderer.includes('id="quick-capture"'), "today quick capture placement");
  truthy(todayRenderer.includes("sprint-progress"), "today sprint progress placement");
  truthy(todayRenderer.includes("priority-list"), "today priority queue placement");
  truthy(todayRenderer.includes('class="priority-action"') && todayRenderer.includes('data-action="nav"'), "today priority actions navigate directly");
  truthy(!todayRenderer.includes('id="friction-form"'), "today friction form separation");
  const reviewRenderer = appJs.slice(
    appJs.indexOf("function renderReview"),
    appJs.indexOf("function renderRuns")
  );
  truthy(reviewRenderer.includes('id="friction-form"'), "review friction form placement");
  truthy(reviewRenderer.includes("${renderFrictionSummary()}"), "three-day friction summary placement");
  const serverJs = await fs.readFile(path.join(repoRoot, "scripts/server.mjs"), "utf8");
  truthy(serverJs.includes('from "./backup-store.mjs"'), "backup store module import");
  equal((serverJs.match(/async function createBackup/g) || []).length, 0, "server-local backup writer count");
  pass("工作台页面、信息架构、采集书签 helper、记录编辑、备份视图与备份模块边界冒烟通过");

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
  workbenchProcess = await startWorkbench(workbenchPort, dataFile, dropDir, bridgeRoot, backupDir, evidenceDir);
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
  workbenchProcess = await startWorkbench(workbenchPort, dataFile, dropDir, bridgeRoot, backupDir, evidenceDir);
  await waitForServer(base);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    restartedState = await state(base);
    if (restartedState.agentTasks.find((task) => task.id === outlineTask.id)?.status === "outbox") break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  equal(restartedState.agentTasks.find((task) => task.id === outlineTask.id).status, "outbox", "restarted dead Agent task status");
  equal(await fs.readFile(path.join(lockTask.outboxPath, "task.lock"), "utf8").catch(() => ""), "", "removed stale Agent lock");
  pass("Agent 进程消失后恢复为 outbox，并清理 stale lock");

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
