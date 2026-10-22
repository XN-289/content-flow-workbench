import crypto from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checks = [];
const speechText = "今天我们来聊一聊真实的逐字稿链路，先听清楚，再认真校对。";
let tempRoot = "";
let workbenchProcess = null;

function pass(name) {
  checks.push(name);
  console.log(`ok - ${name}`);
}

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

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function commandLabel(command, args) {
  return [command, ...args].map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(" ");
}

function runCommand(command, args, { timeoutMs = 120000, allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true,
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024
  });
  if (!allowFailure && (result.error || result.status !== 0)) {
    const detail = result.error?.message || result.stderr || result.stdout || `exit ${result.status}`;
    throw new Error(`${commandLabel(command, args)} failed: ${String(detail).trim()}`);
  }
  return result;
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

async function loadRuntime() {
  if (process.platform !== "win32") {
    throw new Error("transcript E2E currently requires Windows SAPI to generate local Chinese speech");
  }
  const configPath = process.env.WORKBENCH_ASR_CONFIG
    ? path.resolve(process.env.WORKBENCH_ASR_CONFIG)
    : path.join(repoRoot, "data", "asr-runtime.local.json");
  let config;
  try {
    config = JSON.parse(await fs.readFile(configPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`missing local ASR config: ${configPath}. Run test:transcript:e2e only after the local model is configured.`);
    }
    throw error;
  }

  const resolveOptionalPath = (value) => {
    const normalized = String(value || "").trim();
    return normalized ? path.resolve(normalized) : "";
  };
  const runtime = {
    configPath,
    pythonCommand: process.env.WORKBENCH_PYTHON || config.pythonCommand || "python",
    ffmpegCommand: process.env.WORKBENCH_FFMPEG || config.ffmpegCommand || "ffmpeg",
    packageDir: resolveOptionalPath(process.env.WORKBENCH_ASR_PACKAGES_DIR || config.packageDir),
    modelPath: resolveOptionalPath(process.env.WORKBENCH_ASR_MODEL_PATH || config.modelPath),
    modelLabel: process.env.WORKBENCH_ASR_MODEL || config.modelLabel || "faster-whisper-small"
  };
  if (!runtime.packageDir || !runtime.modelPath) {
    throw new Error(`local ASR config must set packageDir and modelPath: ${configPath}`);
  }

  runCommand(runtime.ffmpegCommand, ["-version"], { timeoutMs: 15000 });
  runCommand(runtime.pythonCommand, ["--version"], { timeoutMs: 15000 });
  await fs.access(path.join(runtime.packageDir, "faster_whisper"));
  for (const filename of ["config.json", "model.bin", "tokenizer.json"]) {
    await fs.access(path.join(runtime.modelPath, filename));
  }
  return runtime;
}

function generateSpeech(wavPath) {
  const escapedPath = wavPath.replace(/'/g, "''");
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName System.Speech",
    "$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer",
    "$voices = @($synth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -like 'zh-*' })",
    "if ($voices.Count -eq 0) { throw 'No enabled Chinese SAPI voice is installed' }",
    "$synth.SelectVoice($voices[0].VoiceInfo.Name)",
    "$synth.Rate = -1",
    "$synth.Volume = 100",
    `$synth.SetOutputToWaveFile('${escapedPath}')`,
    `$synth.Speak('${speechText}')`,
    "$synth.Dispose()"
  ].join("\n");
  runCommand("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    script
  ], { timeoutMs: 60000 });
}

function createMedia(runtime, wavPath, mediaPath) {
  runCommand(runtime.ffmpegCommand, [
    "-y",
    "-f", "lavfi",
    "-i", "color=c=0x101820:s=320x240:r=24:d=30",
    "-i", wavPath,
    "-map", "0:v:0",
    "-map", "1:a:0",
    "-c:v", "mpeg4",
    "-q:v", "5",
    "-c:a", "aac",
    "-b:a", "128k",
    "-shortest",
    "-movflags", "+faststart",
    mediaPath
  ], { timeoutMs: 60000 });
}

async function request(base, route, { method = "POST", body = null } = {}) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: method === "GET" ? undefined : { "content-type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(body || {})
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  if (!response.ok) {
    throw new Error(`${route} failed with HTTP ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function waitForServer(base) {
  let lastError = "";
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (workbenchProcess?.exitCode !== null) {
      throw new Error(`temporary workbench exited before readiness:\n${workbenchProcess.getOutput()}`);
    }
    try {
      await request(base, "/api/state", { method: "GET" });
      return;
    } catch (error) {
      lastError = error.message;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`temporary workbench did not start: ${lastError}\n${workbenchProcess?.getOutput() || ""}`);
}

function startWorkbench(paths, runtime) {
  const child = spawn(process.execPath, [path.join(repoRoot, "scripts", "server.mjs")], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(paths.port),
      DATA_FILE: paths.dataFile,
      BACKUP_DIR: paths.backupDir,
      DROP_DIR: paths.dropDir,
      BRIDGE_ROOT: paths.bridgeRoot,
      EVIDENCE_DIR: paths.evidenceDir,
      TRANSCRIPT_DIR: paths.transcriptDir,
      WORKBENCH_ASR_CONFIG: runtime.configPath,
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
    if (output.length > 200000) output = output.slice(-200000);
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  child.getOutput = () => output;
  return child;
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5000))
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function pollTranscriptRun(base, signalId, runId) {
  const deadline = Date.now() + 10 * 60 * 1000;
  let lastRun = null;
  let lastProgress = "";
  while (Date.now() < deadline) {
    const current = await request(base, "/api/state", { method: "GET" });
    const matchingRuns = current.transcriptRuns.filter((run) => run.id === runId);
    equal(matchingRuns.length, 1, "transcript run identity count while polling");
    const signal = current.signals.find((item) => item.id === signalId);
    truthy(signal, "transcript signal remains present while polling");
    lastRun = matchingRuns[0];
    const progress = `${lastRun.status}:${lastRun.stage?.id || ""}`;
    if (progress !== lastProgress) {
      console.log(`  transcript ${progress}${lastRun.stage?.label ? ` - ${lastRun.stage.label}` : ""}`);
      lastProgress = progress;
    }
    if (lastRun.status !== "running") {
      return { state: current, signal, run: lastRun };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`transcript E2E timed out after 10 minutes; last run: ${JSON.stringify(lastRun)}`);
}

async function main() {
  const runtime = await loadRuntime();
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "content-flow-transcript-e2e-"));
  const transcriptDir = path.join(tempRoot, "transcripts");
  const evidenceDir = path.join(tempRoot, "evidence");
  const signalId = `transcript-e2e-${Date.now()}`;
  const mediaDir = path.join(transcriptDir, signalId);
  const sourceMediaPath = path.join(mediaDir, "source.mp4");
  const speechWavPath = path.join(tempRoot, "speech-zh.wav");
  await fs.mkdir(mediaDir, { recursive: true });
  await fs.mkdir(evidenceDir, { recursive: true });

  generateSpeech(speechWavPath);
  const speechStat = await fs.stat(speechWavPath);
  truthy(speechStat.size > 1000, "SAPI generated non-empty speech WAV");
  createMedia(runtime, speechWavPath, sourceMediaPath);
  const sourceMediaStat = await fs.stat(sourceMediaPath);
  truthy(sourceMediaStat.size > 1000, "ffmpeg generated non-empty MP4");
  pass("Windows SAPI 中文语音与 ffmpeg 生成临时 MP4，预置为本地转写媒体");

  const port = await getPort();
  const base = `http://127.0.0.1:${port}`;
  const paths = {
    port,
    base,
    dataFile: path.join(tempRoot, "workbench.json"),
    backupDir: path.join(tempRoot, "backups"),
    dropDir: path.join(tempRoot, "drops"),
    bridgeRoot: path.join(tempRoot, "bridge"),
    evidenceDir,
    transcriptDir,
    runtimeLocator: path.join(tempRoot, "runtime-locator.json")
  };
  workbenchProcess = startWorkbench(paths, runtime);
  await waitForServer(base);

  const importResult = await request(base, "/api/import", {
    body: {
      signals: [{
        id: signalId,
        platform: "xiaohongshu",
        url: `https://www.xiaohongshu.com/explore/${signalId}`,
        title: "真实逐字稿端到端回归样本",
        author: "本地 ASR E2E",
        mediaItems: [{
          type: "video",
          url: `https://sns-video-hw.xhscdn.com/e2e/no-network-${signalId}.mp4`,
          description: "本地预置、不可下载的测试媒体地址"
        }],
        transcriptStatus: "missing",
        transcriptText: ""
      }]
    }
  });
  equal(importResult.totals.signals.added, 1, "E2E signal inserted once");

  const accepted = await request(base, "/api/signals/transcript", {
    body: { signalId, background: true }
  });
  equal(accepted.accepted, true, "background transcript accepted");
  equal(accepted.run.status, "running", "background transcript placeholder status");
  const runId = accepted.run.id;
  const completed = await pollTranscriptRun(base, signalId, runId);
  if (completed.run.status !== "captured") {
    throw new Error(`real transcript failed: ${completed.run.error || "unknown error"}\n${workbenchProcess.getOutput()}`);
  }

  const signal = completed.signal;
  equal(signal.transcriptStatus, "captured", "real transcript captured status");
  match(signal.transcriptSource, /^local-asr:/, "local ASR transcript source");
  truthy(signal.transcriptText.length >= 8, "real transcript has meaningful text");
  match(signal.transcriptText, /[\u4e00-\u9fff]/, "real transcript contains Chinese text");
  match(signal.transcriptText, /(逐字稿|真实|链路|校对|今天|清楚)/, "real transcript preserves spoken vocabulary");
  truthy(Array.isArray(signal.transcriptSegments) && signal.transcriptSegments.length > 0, "real transcript has timeline segments");
  for (const segment of signal.transcriptSegments) {
    truthy(segment.text, "transcript segment text");
    truthy(Number.isFinite(Number(segment.start)) && Number(segment.start) >= 0, "transcript segment start");
    truthy(Number.isFinite(Number(segment.end)) && Number(segment.end) >= Number(segment.start), "transcript segment end");
    match(segment.startTimestamp, /^(?:\d{2}:)?\d{2}:\d{2}\.\d{3}$/, "transcript segment start timestamp");
    match(segment.endTimestamp, /^(?:\d{2}:)?\d{2}:\d{2}\.\d{3}$/, "transcript segment end timestamp");
  }
  truthy(Number(signal.transcriptDurationSeconds) > 0, "real transcript duration");
  truthy(path.isAbsolute(signal.transcriptArtifactPath), "transcript artifact absolute path");
  equal(path.resolve(signal.transcriptMediaPath), path.resolve(sourceMediaPath), "transcript reuses preseeded MP4");
  truthy((await fs.stat(signal.transcriptArtifactPath)).size > 0, "transcript JSON artifact exists");
  truthy((await fs.stat(path.join(mediaDir, "audio-16k-mono.wav"))).size > 1000, "16 kHz mono WAV artifact exists");
  const artifact = JSON.parse(await fs.readFile(signal.transcriptArtifactPath, "utf8"));
  truthy(artifact.segments.length > 0, "artifact contains timeline segments");
  equal(artifact.transcript.length > 0, true, "artifact contains transcript text");
  equal(completed.state.transcriptRuns.filter((run) => run.id === runId).length, 1, "completed run replaces placeholder in place");
  pass("POST /api/signals/transcript 跑通真实 ffmpeg + faster-whisper，并原位持久化 captured 全文与时间轴");

  const evidenceResponse = await request(base, "/api/evidence-packages/create", {
    body: { signalId }
  });
  equal(evidenceResponse.created, true, "transcript evidence package created");
  equal(evidenceResponse.record.transcript.evidenceState, "unverified", "transcript evidence remains unverified");
  equal(evidenceResponse.record.transcript.sourceType, "local-asr", "evidence transcript source type");
  truthy(evidenceResponse.record.layers.includes("candidate-transcript"), "evidence package transcript layer");
  const packageDir = path.join(evidenceDir, evidenceResponse.record.packageKey);
  const transcriptEvidencePath = path.join(packageDir, "candidate", "transcript.md");
  const transcriptEvidence = await fs.readFile(transcriptEvidencePath, "utf8");
  truthy(transcriptEvidence.includes(signal.transcriptText), "evidence candidate contains full transcript");
  truthy(transcriptEvidence.includes("## Timeline"), "evidence candidate contains timeline");
  truthy(transcriptEvidence.includes(signal.transcriptSegments[0].startTimestamp), "evidence candidate contains first segment timestamp");
  const meta = JSON.parse(await fs.readFile(path.join(packageDir, "meta.json"), "utf8"));
  equal(meta.transcript.evidenceState, "unverified", "evidence meta unverified state");
  equal(meta.transcript.sourceType, "local-asr", "evidence meta local ASR source");
  equal(meta.transcript.artifactPath, signal.transcriptArtifactPath, "evidence meta artifact path");
  const checksums = await fs.readFile(path.join(packageDir, "checksums.sha256"), "utf8");
  const transcriptHash = sha256(transcriptEvidence);
  truthy(checksums.includes(`${transcriptHash}  candidate/transcript.md`), "evidence checksum matches rendered transcript");
  truthy(checksums.includes(`${evidenceResponse.record.metaSha256}  meta.json`), "evidence checksum matches meta");
  pass("证据包落盘完整逐字稿、时间轴和匹配的 SHA-256，同时保持 unverified");

  const analysisResponse = await request(base, "/api/signals/analysis", {
    body: { signalId }
  });
  equal(analysisResponse.analysis.evidenceState, "unverified", "analysis evidence state");
  equal(analysisResponse.analysis.input.transcriptSourceType, "local-asr", "analysis transcript source type");
  equal(analysisResponse.analysis.input.segmentCount, signal.transcriptSegments.length, "analysis uses real segment count");
  equal(analysisResponse.analysis.input.transcriptModel, signal.transcriptModel, "analysis uses real ASR model");
  truthy(analysisResponse.analysis.analysis.quotes.length > 0, "analysis returns timestamped quotes");
  for (const quote of analysisResponse.analysis.analysis.quotes) {
    match(quote.startTimestamp, /^(?:\d{2}:)?\d{2}:\d{2}\.\d{3}$/, "analysis quote start timestamp");
    match(quote.endTimestamp, /^(?:\d{2}:)?\d{2}:\d{2}\.\d{3}$/, "analysis quote end timestamp");
  }
  const reusedAnalysis = await request(base, "/api/signals/analysis", {
    body: { signalId }
  });
  equal(reusedAnalysis.reused, true, "analysis reuses unchanged transcript hash");
  const finalState = await request(base, "/api/state", { method: "GET" });
  equal(finalState.analysisRuns.filter((run) => run.signalId === signalId).length, 1, "analysis persisted once");
  pass("真实逐字稿生成带时间戳的候选分析，并保持 unverified 与输入哈希复用");
}

try {
  await main();
  console.log(`\ntranscript E2E passed: ${checks.length}/${checks.length}`);
} catch (error) {
  console.error(`\ntranscript E2E failed: ${error.stack || error.message}`);
  if (workbenchProcess?.getOutput()) {
    console.error("\n--- workbench output ---");
    console.error(workbenchProcess.getOutput().trim());
  }
  process.exitCode = 1;
} finally {
  await stopProcess(workbenchProcess);
  if (tempRoot) {
    const contained = path.relative(os.tmpdir(), tempRoot);
    if (contained && !contained.startsWith("..") && !path.isAbsolute(contained)) {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  }
}
