import crypto from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const maxMediaBytes = 500 * 1024 * 1024;
const maxTranscriptCharacters = 100000;
const maxTranscriptSegments = 2000;

function now() {
  return new Date().toISOString();
}

function runId() {
  return `transcript-${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}`;
}

function cleanError(error) {
  return String(error?.message || error || "").replace(/\s+/g, " ").trim().slice(0, 1000);
}

function allowedMediaUrl(value = "") {
  try {
    const url = new URL(String(value));
    if (!["http:", "https:"].includes(url.protocol)) return null;
    const host = url.hostname.toLowerCase();
    const allowed = host === "xhscdn.com" || host.endsWith(".xhscdn.com")
      || host === "xhscdn.net" || host.endsWith(".xhscdn.net")
      || host === "xiaohongshu.com" || host.endsWith(".xiaohongshu.com");
    return allowed ? url : null;
  } catch {
    return null;
  }
}

export function selectTranscriptMedia(signal = {}) {
  const videos = (Array.isArray(signal.mediaItems) ? signal.mediaItems : [])
    .filter((item) => item?.type === "video" && allowedMediaUrl(item.url));
  return videos.find((item) => /\.mp4(?:[?#]|$)/i.test(new URL(item.url).pathname)) || null;
}

export async function resolveAsrRuntime(root = moduleRoot) {
  const configPath = process.env.WORKBENCH_ASR_CONFIG
    ? path.resolve(process.env.WORKBENCH_ASR_CONFIG)
    : path.join(root, "data", "asr-runtime.local.json");
  let config = {};
  try {
    config = JSON.parse(await fs.readFile(configPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const resolveOptionalPath = (value) => (String(value || "").trim() ? path.resolve(value) : "");
  const packageDir = resolveOptionalPath(process.env.WORKBENCH_ASR_PACKAGES_DIR || config.packageDir);
  const modelPath = resolveOptionalPath(process.env.WORKBENCH_ASR_MODEL_PATH || config.modelPath);
  return {
    configPath,
    pythonCommand: process.env.WORKBENCH_PYTHON || config.pythonCommand || "python",
    ffmpegCommand: process.env.WORKBENCH_FFMPEG || config.ffmpegCommand || "ffmpeg",
    packageDir,
    modelPath,
    modelLabel: process.env.WORKBENCH_ASR_MODEL || config.modelLabel || "faster-whisper-small"
  };
}

async function pathExists(value) {
  return Boolean(value) && fs.stat(value).then(() => true, (error) => (error.code === "ENOENT" ? false : Promise.reject(error)));
}

async function downloadMedia(url, targetPath) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`媒体下载失败：HTTP ${response.status}`);
  const finalUrl = allowedMediaUrl(response.url || url);
  if (!finalUrl) throw new Error("媒体下载重定向到了非小红书 CDN 地址");
  const length = Number(response.headers.get("content-length") || 0);
  if (length > maxMediaBytes) throw new Error("媒体超过 500MB 下载上限");
  if (!response.body) throw new Error("媒体下载响应为空");

  let bytes = 0;
  const body = Readable.fromWeb(response.body);
  body.on("data", (chunk) => {
    bytes += chunk.length;
    if (bytes > maxMediaBytes) body.destroy(new Error("媒体超过 500MB 下载上限"));
  });
  await pipeline(body, createWriteStream(targetPath));
}

function runCommand(command, args, { timeoutMs = 15 * 60 * 1000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: moduleRoot,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, error: cleanError(error), stdout, stderr });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code, stdout, stderr });
    });
  });
}

function failureResult({ signal, media, startedAt, error, runtime = {} }) {
  const finishedAt = now();
  return {
    ok: false,
    signalId: String(signal.id || ""),
    mediaUrl: media?.url || "",
    model: runtime.modelLabel || "",
    error,
    nextAction: /Python|模型|依赖/.test(error)
      ? "在 data/asr-runtime.local.json 配置本机 Python faster-whisper 包和已下载模型"
      : "检查媒体链接是否仍有效、ffmpeg 是否可用后重试",
    run: {
      id: runId(),
      signalId: String(signal.id || ""),
      startedAt,
      finishedAt,
      status: "failed",
      mediaUrl: media?.url || "",
      model: runtime.modelLabel || "",
      error,
      nextAction: "检查本地 ASR 配置或媒体链接后重试"
    }
  };
}

export async function transcribeSignal(signal, {
  root = moduleRoot,
  transcriptRoot = path.join(root, "data", "transcripts"),
  asrRuntime = null,
  force = false,
  timestamp = now()
} = {}) {
  const startedAt = timestamp;
  if (!signal?.id) return failureResult({ signal: {}, media: null, startedAt, error: "signalId is required" });
  if (!force && signal.transcriptStatus === "captured" && String(signal.transcriptText || "").trim()) {
    return {
      ok: true,
      skipped: true,
      signalId: signal.id,
      reason: "这条信号已有真实逐字稿；如需覆盖请显式重新转写。",
      run: {
        id: runId(),
        signalId: signal.id,
        startedAt,
        finishedAt: now(),
        status: "skipped",
        error: "",
        nextAction: "无需重复转写"
      }
    };
  }

  const media = selectTranscriptMedia(signal);
  if (!media) {
    return failureResult({
      signal,
      media: null,
      startedAt,
      error: "媒体清单中没有可下载的完整 MP4；不使用 m4s 分片或正文冒充逐字稿。"
    });
  }

  try {
    const runtime = asrRuntime || await resolveAsrRuntime(root);
    if (!runtime.packageDir || !runtime.modelPath) {
      throw new Error("本地 ASR 未配置：需要 Python faster-whisper 包目录和已下载模型目录。");
    }
    await fs.access(path.join(runtime.packageDir, "faster_whisper"), fs.constants.R_OK);
    for (const filename of ["config.json", "model.bin", "tokenizer.json"]) {
      await fs.access(path.join(runtime.modelPath, filename), fs.constants.R_OK);
    }

    const safeSignalId = String(signal.id).replace(/[^A-Za-z0-9_-]/g, "_");
    const outputDir = path.join(transcriptRoot, safeSignalId);
    await fs.mkdir(outputDir, { recursive: true });
    const mediaPath = path.join(outputDir, "source.mp4");
    const audioPath = path.join(outputDir, "audio-16k-mono.wav");
    const artifactPath = path.join(outputDir, "transcript.json");

    if (!await pathExists(mediaPath)) {
      const tempMediaPath = `${mediaPath}.download`;
      await downloadMedia(media.url, tempMediaPath);
      await fs.rename(tempMediaPath, mediaPath);
    }
    if (!await pathExists(audioPath)) {
      const ffmpeg = await runCommand(runtime.ffmpegCommand, [
        "-y",
        "-i", mediaPath,
        "-vn",
        "-ac", "1",
        "-ar", "16000",
        "-f", "wav",
        "-acodec", "pcm_s16le",
        audioPath
      ], { timeoutMs: 5 * 60 * 1000 });
      if (!ffmpeg.ok) {
        throw new Error(`ffmpeg 转码失败：${cleanError(ffmpeg.error || ffmpeg.stderr || `exit ${ffmpeg.code}`)}`);
      }
    }

    const pythonScript = path.join(moduleRoot, "scripts", "transcribe_audio.py");
    const asr = await runCommand(runtime.pythonCommand, [
      pythonScript,
      "--media", audioPath,
      "--output", artifactPath,
      "--model-path", runtime.modelPath,
      "--model-label", `${runtime.modelLabel}-int8-cpu`,
      "--package-dir", runtime.packageDir
    ]);
    if (!asr.ok) {
      throw new Error(`本地 ASR 运行失败：${cleanError(asr.error || asr.stderr || asr.stdout || `exit ${asr.code}`)}`);
    }

    const artifact = JSON.parse(await fs.readFile(artifactPath, "utf8"));
    const transcriptText = String(artifact.transcript || "").trim().slice(0, maxTranscriptCharacters);
    const segments = (Array.isArray(artifact.segments) ? artifact.segments : []).slice(0, maxTranscriptSegments);
    if (!transcriptText || !segments.length) throw new Error("本地 ASR 没有生成有效文本或时间轴。");
    const finishedAt = now();

    return {
      ok: true,
      skipped: false,
      signalId: signal.id,
      mediaUrl: media.url,
      patch: {
        transcriptText,
        transcriptStatus: "captured",
        transcriptSource: `local-asr:${runtime.modelLabel}-int8-cpu`,
        transcriptNote: "由实际音频本地转写生成；ASR 可能有同音字和术语错误，引用前需人工校对。",
        transcriptSegments: segments,
        transcriptArtifactPath: artifactPath,
        transcriptMediaPath: mediaPath,
        transcriptModel: String(artifact.model || `${runtime.modelLabel}-int8-cpu`),
        transcriptDurationSeconds: Number(artifact.durationSeconds || 0),
        transcriptCapturedAt: finishedAt
      },
      run: {
        id: runId(),
        signalId: signal.id,
        startedAt,
        finishedAt,
        status: "captured",
        mediaUrl: media.url,
        artifactPath,
        model: String(artifact.model || `${runtime.modelLabel}-int8-cpu`),
        durationSeconds: Number(artifact.durationSeconds || 0),
        segmentCount: segments.length,
        textLength: transcriptText.length,
        error: "",
        nextAction: "人工校对 ASR 同音字和术语后，再用于选题或写稿"
      }
    };
  } catch (error) {
    return failureResult({ signal, media, startedAt, error: cleanError(error) });
  }
}

export function applyTranscriptResult(state, signalId, result, timestamp = now()) {
  const index = (state.signals || []).findIndex((signal) => signal.id === signalId);
  if (index < 0) throw new Error("signal not found");
  const signal = state.signals[index];
  if (result.ok && result.patch) {
    Object.assign(signal, result.patch, { updatedAt: timestamp });
  } else if (signal.transcriptStatus !== "captured") {
    signal.transcriptText = "";
    signal.transcriptSource = "";
    signal.transcriptStatus = "failed";
    signal.transcriptNote = `本地转写失败：${result.error || "未知错误"}`;
    signal.updatedAt = timestamp;
  }

  state.transcriptRuns = [result.run, ...(Array.isArray(state.transcriptRuns) ? state.transcriptRuns : [])].slice(0, 30);
  return { signal, run: result.run };
}
