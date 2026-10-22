import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const defaultTimeoutMs = 90_000;
const defaultMaxItems = 20;
const maxProcessOutputBytes = 24 * 1024 * 1024;
const subtitleExtensions = new Set([".json3", ".srt", ".vtt"]);

function cleanText(value = "", limit = 10_000) {
  return String(value ?? "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function validHttpUrl(value = "") {
  try {
    const url = new URL(String(value));
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function epochMilliseconds(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return number > 10_000_000_000 ? number : number * 1000;
}

function publishedAtFromInfo(info = {}) {
  const timestamp = epochMilliseconds(info.timestamp ?? info.release_timestamp);
  if (timestamp) return new Date(timestamp).toISOString();
  const uploadDate = String(info.upload_date || "").trim();
  const match = uploadDate.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match) return "";
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00+08:00`);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

export function bilibiliContentId(value = "") {
  const text = String(value || "");
  return text.match(/\/video\/(BV[A-Za-z0-9]+)/i)?.[1]
    || text.match(/\/video\/(av\d+)/i)?.[1]
    || text.match(/^(BV[A-Za-z0-9]+)$/i)?.[1]
    || text.match(/^(av\d+)$/i)?.[1]
    || "";
}

function flattenInfoEntries(value, output = [], depth = 0) {
  if (!value || depth > 8) return output;
  if (Array.isArray(value)) {
    for (const item of value) flattenInfoEntries(item, output, depth + 1);
    return output;
  }
  if (typeof value !== "object") return output;
  if (Array.isArray(value.entries)) return flattenInfoEntries(value.entries, output, depth + 1);
  const url = value.webpage_url || value.original_url || (
    value.extractor_key && value.id ? `https://www.bilibili.com/video/${value.id}` : ""
  );
  if (url || value.title) output.push(value);
  return output;
}

export function parseBilibiliDump(output = "") {
  const objects = [];
  for (const line of String(output || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) continue;
    try {
      objects.push(JSON.parse(trimmed));
    } catch {
      // yt-dlp can print non-JSON progress lines; metadata extraction stays strict.
    }
  }
  if (!objects.length) {
    try {
      objects.push(JSON.parse(String(output || "").trim()));
    } catch {
      return [];
    }
  }
  return objects.flatMap((item) => flattenInfoEntries(item));
}

function subtitleLanguage(info = {}, filePath = "") {
  const basename = path.basename(filePath);
  const known = [
    ...Object.keys(info.subtitles || {}),
    ...Object.keys(info.automatic_captions || {})
  ].sort((left, right) => right.length - left.length);
  return known.find((language) => basename.includes(`.${language}.`)) || "unknown";
}

function formatTimestamp(value) {
  const totalMilliseconds = Math.max(0, Math.round((Number(value) || 0) * 1000));
  const hours = Math.floor(totalMilliseconds / 3_600_000);
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMilliseconds % 60_000) / 1000);
  const milliseconds = totalMilliseconds % 1000;
  return [
    hours ? String(hours).padStart(2, "0") : "",
    String(minutes).padStart(2, "0"),
    `${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`
  ].filter(Boolean).join(":");
}

function subtitleSegmentsFromJson(value) {
  const segments = [];
  const events = Array.isArray(value?.events)
    ? value.events
    : Array.isArray(value?.body)
      ? value.body
      : Array.isArray(value)
        ? value
        : [];
  for (const event of events) {
    const rawText = event?.segs
      ? event.segs.map((segment) => segment?.utf8 || "").join("")
      : event?.content || event?.text || "";
    const text = cleanText(rawText, 5000);
    if (!text) continue;
    const startMilliseconds = Number(event?.tStartMs);
    const durationMilliseconds = Number(event?.dDurationMs);
    const usesMilliseconds = Number.isFinite(startMilliseconds);
    const start = usesMilliseconds
      ? startMilliseconds / 1000
      : Number(event?.from ?? event?.start);
    const duration = usesMilliseconds
      ? durationMilliseconds / 1000
      : Number(event?.duration);
    const end = usesMilliseconds
      ? Number.isFinite(durationMilliseconds)
        ? (startMilliseconds + durationMilliseconds) / 1000
        : null
      : Number(event?.to ?? event?.end);
    if (!Number.isFinite(start) || start < 0) continue;
    segments.push({
      start,
      end: Number.isFinite(duration) && duration > 0
        ? start + duration
        : Number.isFinite(end) && end >= start ? end : start,
      startTimestamp: formatTimestamp(start),
      endTimestamp: formatTimestamp(
        Number.isFinite(duration) && duration > 0
          ? start + duration
          : Number.isFinite(end) && end >= start ? end : start
      ),
      text
    });
  }
  return segments;
}

function parseTimestamp(value = "") {
  const match = String(value).trim().match(/^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/);
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
}

function subtitleSegmentsFromCueFile(content = "") {
  const lines = String(content || "").replace(/\r/g, "").split("\n");
  const segments = [];
  for (let index = 0; index < lines.length; index += 1) {
    const timing = lines[index].match(/^(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})/);
    if (!timing) continue;
    const start = parseTimestamp(timing[1]);
    const end = parseTimestamp(timing[2]);
    const textLines = [];
    for (index += 1; index < lines.length && lines[index].trim(); index += 1) {
      textLines.push(lines[index].replace(/<[^>]+>/g, ""));
    }
    const text = cleanText(textLines.join(" "), 5000);
    if (text && start !== null && end !== null) {
      segments.push({
        start,
        end,
        startTimestamp: formatTimestamp(start),
        endTimestamp: formatTimestamp(end),
        text
      });
    }
  }
  return segments;
}

async function readSubtitleFile(filePath, info = {}) {
  const content = await fs.readFile(filePath, "utf8");
  let segments = [];
  if (path.extname(filePath).toLowerCase() === ".json3") {
    try {
      segments = subtitleSegmentsFromJson(JSON.parse(content));
    } catch {
      segments = [];
    }
  } else {
    segments = subtitleSegmentsFromCueFile(content);
  }
  if (!segments.length) return null;
  const language = subtitleLanguage(info, filePath);
  return {
    transcriptText: segments.map((segment) => segment.text).join("\n").slice(0, 500_000),
    transcriptStatus: "captured",
    transcriptSource: `bilibili-public-subtitle:${language}`,
    transcriptModel: `bilibili-public-subtitle:${language}`,
    transcriptSegments: segments.slice(0, 2000).map((segment, index) => ({
      index,
      ...segment
    })),
    transcriptDurationSeconds: segments.at(-1)?.end || 0,
    transcriptCapturedAt: new Date().toISOString(),
    transcriptNote: "B 站公开字幕轨，状态为 unverified；引用前需人工核对。"
  };
}

function normalizedItem(info, subtitle = null) {
  const url = validHttpUrl(info.webpage_url || info.original_url)
    || (bilibiliContentId(info.id) ? `https://www.bilibili.com/video/${info.id}` : "");
  if (!url || !bilibiliContentId(url)) return null;
  const coverUrl = validHttpUrl(info.thumbnail);
  return {
    id: bilibiliContentId(url),
    url,
    title: cleanText(info.title, 500),
    description: cleanText(info.description, 100_000),
    author: cleanText(info.uploader || info.channel || info.creator, 200),
    authorId: cleanText(info.uploader_id || info.channel_id, 200),
    sourceProfileUrl: validHttpUrl(info.uploader_url || info.channel_url),
    publishedAt: publishedAtFromInfo(info),
    coverUrl,
    mediaItems: coverUrl ? [{ type: "image", url: coverUrl, description: "B 站视频封面" }] : [],
    ...(subtitle || {
      transcriptText: "",
      transcriptStatus: "missing",
      transcriptSource: "",
      transcriptNote: "B 站公开元数据未提供可读取字幕；未把简介冒充逐字稿。"
    })
  };
}

export async function findYtDlpExecutable(options = {}) {
  const candidates = [
    options.executable,
    process.env.YT_DLP_PATH,
    process.platform === "win32"
      ? path.join(process.env.LOCALAPPDATA || "", "Programs", "Python", "Python314", "Scripts", "yt-dlp.exe")
      : "",
    "yt-dlp"
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate.includes(path.sep) || (process.platform === "win32" && candidate.includes("/"))) {
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        continue;
      }
    }
    const probe = await runProcess(candidate, ["--version"], { timeoutMs: 10_000, maxBytes: 4096 });
    if (probe.code === 0) return candidate;
  }
  return "";
}

function runProcess(executable, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(executable, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let killedByLimit = false;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, Math.max(1000, Number(options.timeoutMs) || defaultTimeoutMs));
    const append = (current, chunk) => {
      const next = current + chunk.toString("utf8");
      if (Buffer.byteLength(next, "utf8") > (options.maxBytes || maxProcessOutputBytes)) {
        killedByLimit = true;
        child.kill();
      }
      return next;
    };
    child.stdout.on("data", (chunk) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = append(stderr, chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      resolve({ code: -1, stdout, stderr: `${stderr}\n${error.message}`.trim(), timedOut, killedByLimit });
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ code: Number(code), stdout, stderr, timedOut, killedByLimit });
    });
  });
}

function blockingResult(reason, humanAction) {
  return {
    status: "blocked",
    reason,
    humanAction,
    nextAction: "在浏览器中人工确认页面可访问；必要时手动复制标题、简介、字幕和链接。",
    items: []
  };
}

export async function collectBilibiliPublic(url, options = {}) {
  const target = validHttpUrl(url);
  if (!target) throw new Error("Bilibili collection needs a valid public URL");
  const executable = await findYtDlpExecutable(options);
  if (!executable) {
    return {
      ...blockingResult(
        "未找到 yt-dlp，无法读取 B 站公开元数据。",
        "安装 yt-dlp 或设置 YT_DLP_PATH；也可手动导入标题、简介、字幕和链接。"
      ),
      executableAvailable: false
    };
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "content-flow-bilibili-"));
  const maxItems = Math.max(1, Math.min(Number(options.maxItems) || defaultMaxItems, 50));
  const args = [
    "--dump-single-json",
    "--skip-download",
    "--no-warnings",
    "--write-subs",
    "--write-auto-subs",
    "--sub-langs", "zh-CN,zh-Hans,zh,ai-zh",
    "--sub-format", "json3/srt/vtt/best",
    "--paths", tempDir,
    "--output", "%(id)s.%(ext)s",
    "--playlist-end", String(maxItems),
    target
  ];
  try {
    const invokeProcess = typeof options.runProcess === "function" ? options.runProcess : runProcess;
    const processResult = await invokeProcess(executable, args, {
      timeoutMs: options.timeoutMs || defaultTimeoutMs
    });
    const diagnostics = `${processResult.stderr}\n${processResult.stdout}`;
    if (processResult.timedOut || processResult.killedByLimit) {
      return {
        ...blockingResult(
          processResult.timedOut ? "B 站公开读取超时。" : "B 站公开读取输出超过安全上限。",
          "检查网络后在浏览器确认页面，再重试或手动导入。"
        ),
        executableAvailable: true
      };
    }
    if (processResult.code !== 0) {
      if (/(?:HTTP Error )?(?:412|403)\b|precondition failed|risk control|security check/i.test(diagnostics)) {
        return {
          ...blockingResult(
            "B 站返回 412/403 风控或访问限制，未取得公开数据。",
            "请在浏览器中人工确认页面可访问；工作台不会绕过登录、验证码或风控。"
          ),
          executableAvailable: true,
          diagnostic: cleanText(processResult.stderr, 1000)
        };
      }
      return {
        status: "failed",
        reason: cleanText(processResult.stderr || "yt-dlp 读取失败", 2000),
        humanAction: "检查链接和 yt-dlp 版本后重试。",
        nextAction: "检查失败原因，或改为手动导入公开信息。",
        items: [],
        executableAvailable: true
      };
    }

    const infoEntries = parseBilibiliDump(processResult.stdout).slice(0, maxItems);
    if (!infoEntries.length) {
      return {
        status: "failed",
        reason: "yt-dlp 未返回可识别的 B 站视频元数据。",
        humanAction: "确认链接是公开视频、主页或合集。",
        nextAction: "检查链接后重试，或手动导入。",
        items: [],
        executableAvailable: true
      };
    }
    const subtitleFiles = (await fs.readdir(tempDir).catch(() => []))
      .filter((fileName) => subtitleExtensions.has(path.extname(fileName).toLowerCase()));
    const items = [];
    for (const info of infoEntries) {
      const id = bilibiliContentId(info.id || info.webpage_url || "");
      const subtitleFile = subtitleFiles.find((fileName) => id && fileName.startsWith(`${id}.`));
      const subtitle = subtitleFile
        ? await readSubtitleFile(path.join(tempDir, subtitleFile), info).catch(() => null)
        : null;
      const item = normalizedItem(info, subtitle);
      if (item) items.push(item);
    }
    return {
      status: items.length ? "ok" : "failed",
      reason: items.length ? "" : "公开元数据中没有可识别的 B 站视频。",
      humanAction: items.length ? "" : "确认链接是公开视频、主页或合集。",
      nextAction: items.length ? "到 Inbox 查看新内容" : "检查链接后重试，或手动导入。",
      items,
      executableAvailable: true,
      subtitleCount: items.filter((item) => item.transcriptStatus === "captured").length
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
