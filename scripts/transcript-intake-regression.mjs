import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0;
let tempRoot = "";
let child = null;

function pass(name) {
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

async function getPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function request(base, route, body = null) {
  const response = await fetch(`${base}${route}`, {
    method: body === null ? "GET" : "POST",
    headers: body === null ? undefined : { "content-type": "application/json" },
    body: body === null ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${route} failed with HTTP ${response.status}: ${text}`);
  return payload;
}

function startWorkbench(port, paths) {
  const process = spawn(nodeExecutable(), [path.join(repoRoot, "scripts", "server.mjs")], {
    cwd: repoRoot,
    env: {
      ...globalThis.process.env,
      PORT: String(port),
      DATA_FILE: paths.dataFile,
      BACKUP_DIR: paths.backupDir,
      DROP_DIR: paths.dropDir,
      BRIDGE_ROOT: paths.bridgeRoot,
      EVIDENCE_DIR: paths.evidenceDir,
      TRANSCRIPT_DIR: paths.transcriptDir,
      CONTENT_FLOW_WORKBENCH_RUNTIME_FILE: paths.runtimeLocator,
      AUTOMATION_ENABLED: "false",
      DROP_SCAN_MS: "60000",
      AUTOMATION_TICK_MS: "60000"
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  let output = "";
  const append = (chunk) => {
    output += chunk.toString("utf8");
    if (output.length > 100000) output = output.slice(-100000);
  };
  process.stdout.on("data", append);
  process.stderr.on("data", append);
  process.getOutput = () => output;
  return process;
}

function nodeExecutable() {
  return globalThis.process.execPath;
}

async function waitForServer(base) {
  let lastError = "";
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child?.exitCode !== null) throw new Error(`workbench exited early:\n${child.output}`);
    try {
      await request(base, "/api/state");
      return;
    } catch (error) {
      lastError = error.message;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`workbench did not start: ${lastError}\n${child?.getOutput?.() || ""}`);
}

async function stopWorkbench() {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5000))
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function main() {
  const port = await getPort();
  const base = `http://127.0.0.1:${port}`;
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "content-flow-intake-"));
  const paths = {
    dataFile: path.join(tempRoot, "workbench.json"),
    backupDir: path.join(tempRoot, "backups"),
    dropDir: path.join(tempRoot, "drops"),
    bridgeRoot: path.join(tempRoot, "bridge"),
    evidenceDir: path.join(tempRoot, "evidence"),
    transcriptDir: path.join(tempRoot, "transcripts"),
    driveRoot: path.join(tempRoot, "drive"),
    runtimeLocator: path.join(tempRoot, "runtime-locator.json")
  };
  await fs.mkdir(paths.driveRoot, { recursive: true });
  child = startWorkbench(port, paths);
  await waitForServer(base);

  const canonicalUrl = "https://www.bilibili.com/video/BV1xx411c7mD";
  const transcript = [
    "很多人以为做内容靠灵感，其实真正稳定输出的关键是素材系统。",
    "先收集真实表达，再找反复出现的痛点，最后才写标题和结构。",
    "所以今天先做一件小事：把一条有启发的逐字稿放进自己的素材库。"
  ].join("\n");
  const pasted = [
    "标题：为什么你的选题总是不够用",
    `链接：${canonicalUrl}`,
    "作者：内容实验室",
    "平台：bilibili",
    "封面：https://i.example.com/cover.jpg",
    "逐字稿：",
    transcript
  ].join("\n");

  const first = await request(base, "/api/capture", { text: pasted });
  assert.equal(first.ok, true);
  assert.deepEqual(first.signals, { added: 1, merged: 0 });
  assert.deepEqual(first.materials, { added: 0, merged: 0 });

  let state = await request(base, "/api/state");
  assert.equal(state.signals.length, 1);
  const signal = state.signals[0];
  assert.equal(signal.title, "为什么你的选题总是不够用");
  assert.equal(signal.url, canonicalUrl);
  assert.equal(signal.platform, "bilibili");
  assert.equal(signal.author, "内容实验室");
  assert.equal(signal.coverUrl, "https://i.example.com/cover.jpg");
  assert.equal(signal.disposition, "material");
  assert.equal(signal.transcriptStatus, "captured");
  assert.equal(signal.transcriptSource, "user-provided");
  assert.equal(signal.transcriptModel, "user-provided");
  assert.equal(signal.evidenceState, "unverified");
  assert.equal(signal.transcriptText, transcript);
  assert.match(signal.note, /人工核对/);
  assert.ok(signal.transcriptCapturedAt);
  pass("中文标签粘贴生成一条带逐字稿和封面的素材信号");

  const repeated = await request(base, "/api/capture", {
    text: pasted.replace(canonicalUrl, `${canonicalUrl}?utm_source=copy`)
  });
  assert.deepEqual(repeated.signals, { added: 0, merged: 1 });
  state = await request(base, "/api/state");
  assert.equal(state.signals.length, 1);
  assert.equal(state.signals[0].transcriptText, transcript);
  pass("同一链接重复粘贴原位合并，不产生逐字稿副本");

  const analysis = await request(base, "/api/signals/analysis", { signalId: signal.id });
  assert.equal(analysis.reused, false);
  assert.equal(analysis.analysis.evidenceState, "unverified");
  assert.equal(analysis.analysis.input.transcriptSourceType, "imported");
  assert.equal(analysis.analysis.input.timelineAvailable, false);
  assert.ok(analysis.analysis.input.segmentCount >= 2);
  assert.equal(analysis.analysis.analysis.pacing.timelineAvailable, false);
  for (const segment of analysis.analysis.input.transcriptSegments) {
    assert.equal(segment.timingState, "not-provided");
    assert.equal(segment.startTimestamp, "");
  }
  for (const quote of analysis.analysis.analysis.quotes) {
    assert.equal(quote.startTimestamp, "");
    assert.equal(quote.endTimestamp, "");
  }
  pass("无时间轴的人工逐字稿可做候选分析，但明确不伪造时间戳");

  const evidence = await request(base, "/api/evidence-packages/create", { signalId: signal.id });
  const evidenceText = await fs.readFile(
    path.join(paths.evidenceDir, evidence.record.packageKey, "candidate", "transcript.md"),
    "utf8"
  );
  assert.match(evidenceText, /很多人以为做内容靠灵感/);
  assert.match(evidenceText, /user-provided/);
  pass("证据包保留完整人工逐字稿与来源状态");

  const jsonDrop = JSON.stringify([
    {
      sourceUrl: "https://www.douyin.com/video/7520000000000000000?previous_page=app_code_link",
      link: "https://v.douyin.com/short-only",
      transcriptText: "第一条通过 sourceUrl 和 transcriptText 导入的逐字稿。",
      coverUrl: "https://p.example.com/douyin-cover.jpg"
    },
    {
      link: "https://www.xiaohongshu.com/explore/abc123",
      transcriptText: "第二条通过 link 和 transcriptText 导入的逐字稿。",
      author: "小红书作者"
    },
    {
      url: "https://www.bilibili.com/video/BV1yy411c7mE",
      transcript: "第三条通过 url 和 transcript 导入的逐字稿。"
    },
    {
      url: "https://www.bilibili.com/video/BV1zz411c7mF",
      description: "这是一段很长的简介，只应该进入正文，不应该被误判成逐字稿。它包含账号介绍、内容背景、合作方式、更新时间说明，以及用户可能关心的其他补充信息，用来验证描述字段与逐字稿字段之间的边界。"
    }
  ]);
  const jsonResult = await request(base, "/api/capture", { text: jsonDrop });
  assert.deepEqual(jsonResult.signals, { added: 4, merged: 0 });
  state = await request(base, "/api/state");
  const douyin = state.signals.find((item) => item.platform === "douyin");
  assert.equal(douyin.url, "https://www.douyin.com/video/7520000000000000000?previous_page=app_code_link");
  assert.equal(douyin.transcriptText, "第一条通过 sourceUrl 和 transcriptText 导入的逐字稿。");
  assert.equal(douyin.title, "未命名逐字稿 · douyin");
  const descriptionOnly = state.signals.find((item) => item.url === "https://www.bilibili.com/video/BV1zz411c7mF");
  assert.equal(descriptionOnly.transcriptStatus, undefined);
  assert.equal(descriptionOnly.disposition, "inbox");
  assert.match(descriptionOnly.contentText, /不应该被误判成逐字稿/);
  assert.equal(state.signals.filter((item) => item.transcriptStatus === "captured").length, 4);
  pass("JSON 只把显式逐字稿字段当作证据，简介保留为正文且不制造逐字稿状态");

  await request(base, "/api/agent-bridge/settings", { driveRoot: paths.driveRoot });
  const cloudInboxDir = path.join(paths.driveRoot, "ContentFlowWorkbench", "Inbox");
  await fs.mkdir(cloudInboxDir, { recursive: true });
  const cloudUrl = "https://www.xiaohongshu.com/explore/cloud-note-001";
  const cloudTranscript = "这条逐字稿来自 Google Drive 的 Inbox，工作台不需要下载文件，只读取本地同步目录就能进入素材库。";
  const cloudDrop = [
    "标题：云盘投递也能直接变成素材",
    `链接：${cloudUrl}`,
    "平台：xiaohongshu",
    "作者：云盘作者",
    "逐字稿：",
    cloudTranscript
  ].join("\n");
  await fs.writeFile(path.join(cloudInboxDir, "cloud-note.md"), cloudDrop, "utf8");
  const firstCloudScan = await request(base, "/api/drop-folder/scan", {});
  assert.equal(firstCloudScan.cloudInbox.total, 1);
  assert.equal(firstCloudScan.cloudInbox.results[0].status, "pending");
  const cloudScan = await request(base, "/api/drop-folder/scan", {});
  assert.equal(cloudScan.cloudInbox.results[0].created, 1);
  state = await request(base, "/api/state");
  const cloudSignal = state.signals.find((item) => item.url === cloudUrl);
  assert.equal(cloudSignal.transcriptText, cloudTranscript);
  assert.equal(cloudSignal.disposition, "material");
  assert.equal(state.cloudInboxLedger.length, 1);
  await fs.access(path.join(cloudInboxDir, "Processed", "cloud-note.md"));
  await assert.rejects(fs.access(path.join(cloudInboxDir, "cloud-note.md")));
  pass("Google Drive 本地同步 Inbox 自动读取逐字稿并归档，不依赖应用下载");

  await fs.writeFile(path.join(cloudInboxDir, "cloud-note-copy.md"), cloudDrop, "utf8");
  await request(base, "/api/drop-folder/scan", {});
  const duplicateScan = await request(base, "/api/drop-folder/scan", {});
  assert.equal(duplicateScan.cloudInbox.results[0].created || 0, 0);
  assert.equal(duplicateScan.cloudInbox.results[0].duplicateContent, true);
  state = await request(base, "/api/state");
  assert.equal(state.signals.filter((item) => item.url === cloudUrl).length, 1);
  pass("云盘 Inbox 用持久内容哈希去重，同一内容换文件名不会重复入库");
}

try {
  await main();
  console.log(`\ntranscript intake regression passed: ${passed}/${passed}`);
} catch (error) {
  console.error(`\ntranscript intake regression failed: ${error.stack || error.message}`);
  if (child?.getOutput?.()) {
    console.error("\n--- workbench output ---");
    console.error(child.getOutput().trim());
  }
  process.exitCode = 1;
} finally {
  await stopWorkbench();
  if (tempRoot) {
    const contained = path.relative(os.tmpdir(), tempRoot);
    if (contained && !contained.startsWith("..") && !path.isAbsolute(contained)) {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  }
}
