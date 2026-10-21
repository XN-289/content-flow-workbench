import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let mockServer = null;
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

async function getPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
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
  return {
    status: response.status,
    payload: text ? JSON.parse(text) : null
  };
}

async function waitForServer(base, child) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`temporary server exited: ${child.getOutput()}`);
    try {
      const response = await requestJson(base, "/api/state", null, "GET");
      if (response.status === 200) return response.payload;
    } catch {
      // The server may still be binding its port.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`temporary server did not start: ${child.getOutput()}`);
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

async function waitForSignal(signal, label, timeoutMs = 5000) {
  let timer;
  try {
    await Promise.race([
      signal,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "content-flow-backend-pipeline-"));
  const dataFile = path.join(tempRoot, "workbench.json");
  const dropDir = path.join(tempRoot, "drops");
  const bridgeRoot = path.join(tempRoot, "bridge");
  const backupDir = path.join(tempRoot, "backups");
  const evidenceDir = path.join(tempRoot, "evidence");
  const transcriptDir = path.join(tempRoot, "transcripts");
  await Promise.all([
    fs.mkdir(dropDir, { recursive: true }),
    fs.mkdir(bridgeRoot, { recursive: true }),
    fs.mkdir(backupDir, { recursive: true }),
    fs.mkdir(evidenceDir, { recursive: true }),
    fs.mkdir(transcriptDir, { recursive: true })
  ]);

  const mockPort = await getPort();
  const workbenchPort = await getPort();
  const base = `http://127.0.0.1:${workbenchPort}`;
  let slowFeedResponse = null;
  let markSlowFeedStarted;
  const slowFeedStarted = new Promise((resolve) => {
    markSlowFeedStarted = resolve;
  });
  mockServer = http.createServer((request, response) => {
    if (request.url === "/feed.xml") {
      response.writeHead(200, { "content-type": "application/rss+xml; charset=utf-8" });
      response.end(`<?xml version="1.0"?>
        <rss version="2.0"><channel><title>Regression feed</title>
          <item><title>Automatic source item</title><link>https://example.com/automatic-item</link></item>
        </channel></rss>`);
      return;
    }
    if (request.url === "/slow-feed.xml") {
      slowFeedResponse = response;
      markSlowFeedStarted();
      return;
    }
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("not found");
  });
  await new Promise((resolve) => mockServer.listen(mockPort, "127.0.0.1", resolve));

  const dueAt = new Date(Date.now() - 60_000).toISOString();
  const sources = [
    {
      id: "source-auto-rss",
      name: "Automatic RSS",
      platform: "other",
      collectionMethod: "public-rss",
      url: `http://127.0.0.1:${mockPort}/feed.xml`,
      enabled: true,
      checkFrequency: "daily",
      nextRunAt: dueAt
    },
    {
      id: "source-manual",
      name: "Manual source",
      platform: "other",
      collectionMethod: "manual",
      url: "https://example.invalid/manual",
      enabled: true,
      checkFrequency: "daily",
      nextRunAt: dueAt
    },
    {
      id: "source-browser-assisted",
      name: "Browser-assisted source",
      platform: "xiaohongshu",
      collectionMethod: "browser-assisted",
      url: "https://www.xiaohongshu.com/user/profile/backend-regression",
      enabled: true,
      checkFrequency: "daily",
      nextRunAt: dueAt
    }
  ];
  await fs.writeFile(dataFile, JSON.stringify({
    version: 1,
    settings: {
      collectionTime: "08:40",
      automationEnabled: true,
      morningBriefEnabled: true,
      inboxTime: "09:00",
      inboxDailyLimit: 10
    },
    sources
  }, null, 2), "utf8");

  workbenchProcess = spawn(process.execPath, [path.join(repoRoot, "scripts/server.mjs")], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(workbenchPort),
      DATA_FILE: dataFile,
      DROP_DIR: dropDir,
      BRIDGE_ROOT: bridgeRoot,
      BACKUP_DIR: backupDir,
      EVIDENCE_DIR: evidenceDir,
      TRANSCRIPT_DIR: transcriptDir,
      AUTOMATION_ENABLED: "true",
      AUTOMATION_TICK_MS: "60000",
      DROP_SCAN_MS: "60000"
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  let output = "";
  workbenchProcess.stdout.on("data", (chunk) => {
    output += chunk.toString("utf8");
  });
  workbenchProcess.stderr.on("data", (chunk) => {
    output += chunk.toString("utf8");
  });
  workbenchProcess.getOutput = () => output;

  await waitForServer(base, workbenchProcess);

  const forceTick = await requestJson(base, "/api/automation/tick", { force: true });
  equal(forceTick.status, 200, "force tick HTTP status");
  equal(forceTick.payload.results.length, 1, "force tick result count");
  equal(forceTick.payload.results[0].sourceId, "source-auto-rss", "force tick only runs automatic source");
  equal(forceTick.payload.results.filter((result) => result.sourceId === "source-manual").length, 0, "force tick excludes manual source");
  equal(
    forceTick.payload.results.filter((result) => result.sourceId === "source-browser-assisted").length,
    0,
    "force tick excludes browser-assisted source"
  );

  let current = (await requestJson(base, "/api/state", null, "GET")).payload;
  equal(current.collectionRuns.length, 1, "force tick collection run count");
  equal(current.collectionRuns[0].sourceId, "source-auto-rss", "force tick recorded automatic run only");
  truthy(current.sources.find((source) => source.id === "source-manual").nextRunAt, "manual source remains queued");
  truthy(
    current.sources.find((source) => source.id === "source-browser-assisted").nextRunAt,
    "browser-assisted source remains queued"
  );

  const stateForSchedule = JSON.parse(await fs.readFile(dataFile, "utf8"));
  stateForSchedule.sources.push({
    id: "source-auto-slow",
    name: "Slow automatic RSS",
    platform: "other",
    collectionMethod: "public-rss",
    url: `http://127.0.0.1:${mockPort}/slow-feed.xml`,
    enabled: true,
    checkFrequency: "daily",
    nextRunAt: dueAt
  });
  await fs.writeFile(dataFile, JSON.stringify(stateForSchedule, null, 2), "utf8");

  const morningRequest = requestJson(base, "/api/morning-pipeline/run", {});
  await waitForSignal(slowFeedStarted, "slow automatic feed start");

  current = (await requestJson(base, "/api/state", null, "GET")).payload;
  equal(current.morningPipelineRuns[0].status, "running", "morning pipeline persists running before collection");
  equal(
    current.morningPipelineRuns[0].operations.collection.status,
    "running",
    "morning pipeline persists in-flight collection operation"
  );

  const interleavedTick = await requestJson(base, "/api/automation/tick", { force: true });
  equal(interleavedTick.status, 200, "interleaved force tick HTTP status");
  equal(interleavedTick.payload.skipped, true, "interleaved force tick is skipped");
  equal(
    interleavedTick.payload.reason,
    "morning pipeline owns scheduler",
    "interleaved force tick reports pipeline ownership"
  );

  slowFeedResponse.writeHead(200, { "content-type": "application/rss+xml; charset=utf-8" });
  slowFeedResponse.end(`<?xml version="1.0"?>
    <rss version="2.0"><channel><title>Slow regression feed</title>
      <item><title>Slow automatic source item</title><link>https://example.com/slow-automatic-item</link></item>
    </channel></rss>`);

  const morning = await morningRequest;
  equal(morning.status, 200, "morning pipeline HTTP status");
  equal(morning.payload.ok, true, "morning pipeline ok for successful automatic-only run");
  equal(morning.payload.completed, true, "morning pipeline reports completed orchestration");
  equal(morning.payload.collection.total, 1, "morning pipeline runs only the due automatic source");
  current = (await requestJson(base, "/api/state", null, "GET")).payload;
  equal(current.collectionRuns.length, 2, "morning pipeline records one automatic collection run");
  equal(
    current.collectionRuns.some((run) => ["source-manual", "source-browser-assisted"].includes(run.sourceId)),
    false,
    "morning pipeline records no human-method collection runs"
  );
  equal(current.morningPipelineRuns[0].operations.collection.status, "ok", "morning pipeline collection status");
  equal(current.morningPipelineRuns[0].operations.dropFolder.status, "ok", "morning pipeline drop status");
  equal(current.morningPipelineRuns[0].operations.agentResults.status, "ok", "morning pipeline agent status");

  const disableAutomation = await requestJson(base, "/api/automation/settings", { automationEnabled: false });
  equal(disableAutomation.status, 200, "disable automation HTTP status");
  equal(disableAutomation.payload.ok, true, "disable automation response");

  const skippedMorning = await requestJson(base, "/api/morning-pipeline/run", {});
  equal(skippedMorning.status, 200, "skipped morning pipeline HTTP status");
  equal(skippedMorning.payload.ok, true, "skipped morning pipeline request flag");
  equal(skippedMorning.payload.completed, true, "skipped morning pipeline completed flag");
  equal(skippedMorning.payload.run.status, "skipped", "skipped morning pipeline aggregate status");
  equal(skippedMorning.payload.collection.status, "skipped", "skipped morning pipeline collection status");
  equal(skippedMorning.payload.run.stages.length, 6, "skipped morning pipeline stage count");
  equal(
    skippedMorning.payload.run.stages.find((stage) => stage.id === "collection")?.status,
    "skipped",
    "skipped morning pipeline collection stage status"
  );

  console.log("backend pipeline regression passed");
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
