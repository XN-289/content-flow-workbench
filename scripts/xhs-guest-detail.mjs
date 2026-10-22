import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { classifySourceIntakeUrl, SOURCE_INTAKE_TYPES } from "./source-intake.mjs";

const noteIdPattern = /\/(?:explore|discovery\/item)\/([A-Za-z0-9_-]+)/;
const allowedMediaHosts = new Set(["xhscdn.com", "xhscdn.net", "xiaohongshu.com"]);
const maxSubtitleCharacters = 100000;
const maxTranscriptSegments = 2000;
const maxComments = 80;
const defaultHumanWaitMs = 10 * 60 * 1000;
const defaultHumanPollMs = 2000;

function cleanText(value = "", limit = 2000) {
  return String(value ?? "").replace(/\u0000/g, "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function unwrapValue(value) {
  let current = value;
  for (let index = 0; index < 6; index += 1) {
    if (current && typeof current === "object" && current._rawValue) {
      current = current._rawValue;
      continue;
    }
    if (typeof current === "string" && /^[\[{]/.test(current.trim()) && current.length <= 500000) {
      try {
        current = JSON.parse(current);
        continue;
      } catch {
        return current;
      }
    }
    break;
  }
  return current;
}

function firstUrlInText(value = "") {
  return String(value || "").match(/https?:\/\/[^\s<>"'`，。；：！？）】》]+/i)?.[0] || "";
}

function noteIdFromUrl(value = "") {
  return String(value || "").match(noteIdPattern)?.[1] || "";
}

function publicCaptureUrl(noteId = "", fallback = "") {
  if (noteId) return `https://www.xiaohongshu.com/explore/${noteId}`;
  try {
    const url = new URL(String(fallback || ""));
    if (!url.hostname.endsWith("xiaohongshu.com")) return "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function allowedMediaUrl(value = "") {
  try {
    const url = new URL(String(value || ""));
    if (!["http:", "https:"].includes(url.protocol)) return "";
    const host = url.hostname.toLowerCase();
    const allowed = [...allowedMediaHosts].some((candidate) => host === candidate || host.endsWith(`.${candidate}`));
    return allowed ? url.toString() : "";
  } catch {
    return "";
  }
}

function normalizedCount(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.round(value));
  const match = String(value ?? "").trim().match(/^([\d,.]+)\s*(万|亿|[kK])?\+?$/);
  if (!match) return String(value ?? "").trim().slice(0, 50);
  const base = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(base)) return String(value ?? "").trim().slice(0, 50);
  const multiplier = match[2] === "亿" ? 100000000 : match[2] === "万" ? 10000 : match[2] ? 1000 : 1;
  return Math.max(0, Math.round(base * multiplier));
}

function timestampToSeconds(value = "") {
  const raw = String(value || "").trim().replace(",", ".");
  if (!raw) return null;
  const parts = raw.split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts.length === 1 ? parts[0] : null;
}

function formatTimestamp(value) {
  const totalMilliseconds = Math.max(0, Math.round((Number(value) || 0) * 1000));
  const hours = Math.floor(totalMilliseconds / 3600000);
  const minutes = Math.floor((totalMilliseconds % 3600000) / 60000);
  const seconds = Math.floor((totalMilliseconds % 60000) / 1000);
  const milliseconds = totalMilliseconds % 1000;
  const hourPrefix = hours > 0 ? `${String(hours).padStart(2, "0")}:` : "";
  return `${hourPrefix}${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}

export function parseSubtitleText(content = "") {
  const source = String(content || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!source) return { text: "", segments: [] };
  if (source.startsWith("{") || source.startsWith("[")) {
    try {
      const parsed = JSON.parse(source);
      const rawSegments = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.segments)
          ? parsed.segments
          : Array.isArray(parsed?.body)
            ? parsed.body
            : [];
      const segments = rawSegments.map((segment, index) => {
        const text = cleanText(segment?.text ?? segment?.content ?? segment?.transcript, 5000);
        const start = Number(segment?.start ?? segment?.from ?? segment?.startTime);
        const end = Number(segment?.end ?? segment?.to ?? segment?.endTime);
        if (!text || !Number.isFinite(start)) return null;
        return {
          index,
          start,
          end: Number.isFinite(end) && end >= start ? end : start,
          startTimestamp: formatTimestamp(start),
          endTimestamp: formatTimestamp(Number.isFinite(end) && end >= start ? end : start),
          text
        };
      }).filter(Boolean).slice(0, maxTranscriptSegments);
      return {
        text: segments.map((segment) => segment.text).join("\n").slice(0, maxSubtitleCharacters),
        segments
      };
    } catch {
      return { text: "", segments: [] };
    }
  }

  const blocks = source.split(/\n{2,}/);
  const segments = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    const timeIndex = lines.findIndex((line) => line.includes("-->"));
    if (timeIndex < 0) continue;
    const [startRaw, endRaw] = lines[timeIndex].split("-->").map((part) => part.trim().split(/\s+/)[0]);
    const start = timestampToSeconds(startRaw);
    const end = timestampToSeconds(endRaw);
    const text = cleanText(lines.slice(timeIndex + 1).join(" "), 5000);
    if (!text || !Number.isFinite(start)) continue;
    segments.push({
      index: segments.length,
      start,
      end: Number.isFinite(end) && end >= start ? end : start,
      startTimestamp: formatTimestamp(start),
      endTimestamp: formatTimestamp(Number.isFinite(end) && end >= start ? end : start),
      text
    });
    if (segments.length >= maxTranscriptSegments) break;
  }
  return {
    text: segments.map((segment) => segment.text).join("\n").slice(0, maxSubtitleCharacters),
    segments
  };
}

export async function findChromeExecutable(options = {}) {
  const candidates = [
    options.executablePath,
    process.env.CHROME_PATH,
    process.env.GOOGLE_CHROME_PATH,
    process.platform === "win32" ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" : "",
    process.platform === "win32" ? "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe" : "",
    process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "",
    process.platform === "linux" ? "/usr/bin/google-chrome" : "",
    process.platform === "linux" ? "/usr/bin/google-chrome-stable" : ""
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Continue through the known browser locations.
    }
  }
  throw new Error("未找到 Google Chrome；可通过 CHROME_PATH 指定浏览器路径。");
}

async function resolveInput(text = "") {
  const inputUrl = firstUrlInText(text);
  if (!inputUrl) throw new Error("分享文本中没有可识别的小红书链接");
  const classification = await classifySourceIntakeUrl(inputUrl, { timeoutMs: 15000 });
  if (classification.detectedType === SOURCE_INTAKE_TYPES.profile) {
    throw new Error("首页批量采集请使用主页流程；单条原子采集只接受小红书笔记链接");
  }
  if (
    classification.ok
    && classification.detectedType !== SOURCE_INTAKE_TYPES.note
    && classification.platform === "xiaohongshu"
  ) {
    throw new Error("链接没有指向可识别的小红书笔记");
  }
  return {
    inputUrl,
    targetUrl: classification.canonicalUrl || inputUrl,
    classification
  };
}

async function extractPageEvidence(page, resolvedRunId) {
  return page.evaluate(({ runId }) => {
    function unwrap(value) {
      let current = value;
      for (let index = 0; index < 8; index += 1) {
        if (current && typeof current === "object" && current._rawValue) {
          current = current._rawValue;
          continue;
        }
        if (typeof current === "string" && /^[\[{]/.test(current.trim()) && current.length <= 500000) {
          try {
            current = JSON.parse(current);
            continue;
          } catch {
            return current;
          }
        }
        break;
      }
      return current;
    }

    function firstString(...values) {
      for (const value of values) {
        const text = String(value ?? "").trim();
        if (text) return text;
      }
      return "";
    }

    function array(value) {
      const unwrapped = unwrap(value);
      return Array.isArray(unwrapped) ? unwrapped.map(unwrap) : [];
    }

    function imageUrl(item) {
      const image = unwrap(item) || {};
      const direct = firstString(image.urlDefault, image.urlPre, image.url, image.original);
      if (direct) return direct;
      const info = array(image.infoList).find((candidate) => (
        candidate?.imageScene === "WB_DFT"
        || candidate?.imageScene === "WB_PRV"
        || candidate?.url
      ));
      return firstString(info?.url, info?.urlDefault, info?.urlPre);
    }

    function videoUrls(videoValue) {
      const video = unwrap(videoValue) || {};
      const mediaV2 = unwrap(video.mediaV2) || unwrap(video.media) || {};
      const videoMedia = unwrap(mediaV2.video) || {};
      const stream = unwrap(mediaV2.stream) || unwrap(video.stream) || {};
      const h264 = array(stream.h264)[0] || {};
      const h265 = array(stream.h265)[0] || {};
      return {
        mp4Url: firstString(h264.masterUrl, h264.master_url, h265.masterUrl, h265.master_url),
        subtitles: unwrap(videoMedia.subtitles) || unwrap(video.subtitles) || {}
      };
    }

    const state = unwrap(window.__INITIAL_STATE__) || {};
    const noteState = unwrap(state.note) || {};
    const map = unwrap(noteState.noteDetailMap) || unwrap(state.noteDetailMap) || {};
    const urlNoteId = String(location.href).match(/\/(?:explore|discovery\/item)\/([A-Za-z0-9_-]+)/)?.[1] || "";
    const noteIds = Object.keys(map);
    const selectedId = noteIds.includes(urlNoteId) ? urlNoteId : noteIds[0] || urlNoteId;
    const entry = unwrap(map[selectedId]) || {};
    const note = unwrap(entry.note) || unwrap(entry.noteCard?.note) || unwrap(entry.noteCard) || {};
    const user = unwrap(note.user) || {};
    const interact = unwrap(note.interactInfo) || {};
    const video = unwrap(note.video) || {};
    const urls = videoUrls(video);
    const images = array(note.imageList).map(imageUrl).filter(Boolean);
    const consumer = unwrap(video.consumer) || {};
    const chapters = array(
      video.chapters
      || video.chapterList
      || consumer.chapters
      || video.mediaV2?.chapters
    )
      .map((chapter) => {
        const raw = unwrap(chapter) || {};
        const time = Number(raw.time ?? raw.startTime ?? raw.start ?? NaN);
        return {
          title: firstString(raw.text, raw.title, raw.name),
          timeMilliseconds: Number.isFinite(time) ? Math.max(0, Math.round(time)) : null
        };
      })
      .filter((chapter) => chapter.title || chapter.timeMilliseconds !== null);
    const subtitleEntries = [];
    for (const [language, value] of Object.entries(urls.subtitles || {})) {
      const candidates = Array.isArray(value) ? value : [value];
      for (const candidate of candidates) {
        const raw = unwrap(candidate) || {};
        const url = firstString(raw.url, raw.urlDefault, raw.src);
        if (url) subtitleEntries.push({ language, url });
      }
    }
    const pageText = String(document.body?.innerText || "").slice(0, 50000);
    const title = firstString(note.title, note.displayTitle, note.noteCard?.displayTitle);
    const desc = firstString(note.desc, note.content, note.noteCard?.desc);
    const noteId = firstString(note.noteId, note.id, selectedId, urlNoteId);
    const loginPromptPresent = /登录后|请先登录|扫码登录|登录小红书|手机号登录/.test(pageText);
    const verificationPresent = /安全验证|访问异常|滑动验证|拖动滑块|请完成验证|当前环境存在风险/.test(pageText)
      || /\/(?:captcha|verify|security)/i.test(location.pathname);
    return {
      runId,
      noteId,
      title,
      desc,
      author: firstString(user.nickname, user.nickName, user.name, note.noteCard?.user?.nickname),
      authorId: firstString(user.userId, user.user_id, user.id),
      sourceProfileUrl: firstString(user.profileUrl, user.userPage, user.homepage),
      publishedAt: firstString(note.time, note.publishTime, note.noteCard?.time),
      engagement: firstString(interact.likedCount, interact.likeCount, note.likedCount, note.noteCard?.interactInfo?.likedCount),
      commentCount: firstString(interact.commentCount, note.commentCount, note.noteCard?.interactInfo?.commentCount),
      collectCount: firstString(interact.collectedCount, interact.collectCount, note.collectedCount),
      shareCount: firstString(interact.shareCount, note.shareCount),
      coverUrl: images[0] || firstString(note.coverUrl, note.image, video.coverUrl),
      images,
      mediaMp4Url: urls.mp4Url,
      chapters,
      subtitleEntries,
      rawPageText: pageText,
      effectiveUrl: location.href,
      pageTitle: document.title,
      loginPromptPresent,
      verificationPresent
    };
  }, { runId: resolvedRunId });
}

function normalizeComment(item, index, depth = 0) {
  const raw = unwrapValue(item);
  if (!raw || typeof raw !== "object") return null;
  const user = unwrapValue(raw.user_info || raw.userInfo || raw.user) || {};
  const content = cleanText(raw.content || raw.text || raw.note?.content, 3000);
  if (!content) return null;
  const tags = unwrapValue(raw.show_tags || raw.showTags) || [];
  const rawCreatedAt = raw.create_time ?? raw.createTime ?? raw.time ?? raw.createdAt;
  const createdAtNumber = Number(rawCreatedAt);
  const createdAt = Number.isFinite(createdAtNumber) && createdAtNumber > 0
    ? new Date(createdAtNumber > 0 && createdAtNumber < 10000000000 ? createdAtNumber * 1000 : createdAtNumber).toISOString()
    : cleanText(rawCreatedAt, 100);
  const replies = depth === 0
    ? (unwrapValue(raw.sub_comments || raw.subComments) || [])
      .map((reply, replyIndex) => normalizeComment(reply, replyIndex, depth + 1))
      .filter(Boolean)
      .slice(0, 5)
    : [];
  return {
    id: cleanText(raw.id || raw.commentId, 200) || `comment-${index + 1}`,
    content,
    author: cleanText(user.nickname || user.nickName || user.name || raw.author, 200),
    authorId: cleanText(user.user_id || user.userId || raw.userId, 200),
    likes: normalizedCount(raw.like_count ?? raw.likeCount ?? raw.likedCount ?? raw.likes ?? 0),
    createdAt,
    ipLocation: cleanText(raw.ip_location || raw.ipLocation, 100),
    isAuthor: Array.isArray(tags) && tags.some((tag) => /^(?:is_author|作者|author)$/i.test(String(tag))),
    subCommentCount: normalizedCount(raw.sub_comment_count ?? raw.subCommentCount ?? 0),
    ...(replies.length ? { replies } : {})
  };
}

function normalizeCommentPayload(payload) {
  const root = unwrapValue(payload);
  const data = unwrapValue(root?.data) || root;
  const comments = Array.isArray(data?.comments) ? data.comments : [];
  return {
    comments: comments.map(normalizeComment).filter(Boolean).slice(0, maxComments),
    hasMore: data?.has_more === true || data?.hasMore === true,
    cursorPresent: Boolean(data?.cursor),
    source: "natural-first-page"
  };
}

async function fetchPlatformSubtitle(page, subtitleEntries, referer) {
  const ordered = [...subtitleEntries].sort((left, right) => {
    const score = (entry) => entry.language === "zh-CN" ? 0 : entry.language === "source" ? 1 : 2;
    return score(left) - score(right);
  });
  for (const entry of ordered) {
    const url = allowedMediaUrl(entry.url);
    if (!url) continue;
    try {
      const response = await page.request.get(url, {
        headers: { referer },
        timeout: 30000
      });
      if (!response.ok()) continue;
      const content = await response.text();
      const parsed = parseSubtitleText(content);
      if (!parsed.text || !parsed.segments.length) continue;
      return {
        language: entry.language,
        sourceLabel: `platform-subtitle:${entry.language}`,
        text: parsed.text,
        segments: parsed.segments,
        capturedAt: new Date().toISOString()
      };
    } catch {
      // Try the next platform subtitle track without making the whole detail capture fail.
    }
  }
  return null;
}

function accessStatus(evidence) {
  if (evidence.verificationPresent) {
    return {
      status: "waiting-for-human",
      captureState: "verification-required",
      reason: "页面出现安全验证或验证码；可见 Chrome 会保持打开，等待用户人工接管。",
      humanAction: "请在 Chrome 窗口完成平台要求的人工验证；完成后无需重新提交，服务会自动续跑。"
    };
  }
  const hasEvidence = Boolean(evidence.title || evidence.desc || evidence.coverUrl || evidence.mediaMp4Url);
  if (!hasEvidence && evidence.loginPromptPresent) {
    return {
      status: "waiting-for-human",
      captureState: "login-required",
      reason: "公开页面没有暴露笔记数据，并出现登录提示；可见 Chrome 会保持打开。",
      humanAction: "如需登录，请在 Chrome 窗口人工完成；完成后服务会自动继续读取当前笔记。"
    };
  }
  if (!hasEvidence) {
    return {
      status: "blocked",
      captureState: "no-evidence",
      reason: "页面已打开，但公开状态中没有标题、正文、封面或视频地址。",
      humanAction: "请在浏览器中确认笔记仍公开可访问，或改用 App 分享文本后重试。"
    };
  }
  return {
    status: "captured",
    captureState: "captured-public",
    reason: "已读取游客可见的笔记详情。",
    humanAction: ""
  };
}

async function emitCaptureStatus(options, payload) {
  if (typeof options.onStatus !== "function") return;
  try {
    await options.onStatus(payload);
  } catch {
    // Status persistence is best-effort and must not abort a live browser capture.
  }
}

function waitBudget(options) {
  const configured = Number(options.humanWaitMs);
  if (Number.isFinite(configured)) return Math.max(0, Math.min(30 * 60 * 1000, configured));
  return options.headless === true ? 0 : defaultHumanWaitMs;
}

function waitPollInterval(options) {
  const configured = Number(options.humanPollMs);
  if (Number.isFinite(configured)) return Math.max(500, Math.min(10000, configured));
  return defaultHumanPollMs;
}

async function waitForManualAccess(page, {
  runId,
  captureUrl,
  initialEvidence,
  initialAccess,
  options
}) {
  const deadline = Date.now() + waitBudget(options);
  const pollMs = waitPollInterval(options);
  let evidence = initialEvidence;
  let access = initialAccess;
  let reloadedAfterClear = false;
  let lastReportedState = "";
  await emitCaptureStatus(options, {
    runId,
    status: "waiting-for-human",
    noteId: evidence.noteId,
    finalUrl: captureUrl,
    captureState: access.captureState,
    reason: access.reason,
    humanAction: access.humanAction,
    checkedAt: new Date().toISOString()
  });

  while (Date.now() < deadline) {
    await page.waitForTimeout(Math.min(pollMs, Math.max(0, deadline - Date.now())));
    evidence = await extractPageEvidence(page, runId);
    access = accessStatus(evidence);
    if (access.captureState === "captured-public") {
      await emitCaptureStatus(options, {
        runId,
        status: "running",
        noteId: evidence.noteId,
        finalUrl: captureUrl,
        captureState: access.captureState,
        reason: "人工接管已完成，正在继续读取笔记详情。",
        humanAction: "",
        checkedAt: new Date().toISOString()
      });
      return { evidence, access, timedOut: false };
    }

    const promptCleared = !evidence.verificationPresent && !evidence.loginPromptPresent;
    if (promptCleared && !reloadedAfterClear) {
      reloadedAfterClear = true;
      try {
        await page.goto(captureUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForTimeout(1200);
        evidence = await extractPageEvidence(page, runId);
        access = accessStatus(evidence);
        if (access.captureState === "captured-public") {
          return { evidence, access, timedOut: false };
        }
      } catch {
        // Keep the same visible session alive and continue polling the current page.
      }
    }

    const reportKey = `${access.captureState}:${evidence.loginPromptPresent}:${evidence.verificationPresent}`;
    if (reportKey !== lastReportedState) {
      lastReportedState = reportKey;
      await emitCaptureStatus(options, {
        runId,
        status: "waiting-for-human",
        noteId: evidence.noteId,
        finalUrl: captureUrl,
        captureState: access.captureState,
        reason: access.reason,
        humanAction: access.humanAction,
        checkedAt: new Date().toISOString()
      });
    }
  }

  return {
    evidence,
    access: {
      ...access,
      status: "blocked",
      reason: `等待人工接管超时（${Math.round(waitBudget(options) / 1000)} 秒）；浏览器已关闭，未尝试破解登录或验证。`,
      humanAction: access.humanAction || "重新发起采集后，在可见 Chrome 中完成登录或验证。"
    },
    timedOut: true
  };
}

export async function captureXhsGuestNote(text, options = {}) {
  const startedAt = new Date().toISOString();
  const runId = cleanText(options.runId, 200) || `guest-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  let context = null;
  let profileDir = "";
  let resolved = null;
  let captureUrl = "";
  try {
    await emitCaptureStatus(options, {
      runId,
      status: "running",
      noteId: "",
      finalUrl: "",
      captureState: "starting",
      reason: "正在解析分享链接并启动可见 Chrome。",
      humanAction: "",
      checkedAt: startedAt
    });
    resolved = await resolveInput(text);
    const executablePath = await findChromeExecutable(options);
    profileDir = await fs.mkdtemp(path.join(os.tmpdir(), "content-flow-xhs-guest-"));
    context = await chromium.launchPersistentContext(profileDir, {
      executablePath,
      headless: options.headless === true,
      viewport: { width: 1440, height: 1000 },
      locale: "zh-CN",
      timezoneId: "Asia/Shanghai",
      colorScheme: "light",
      args: ["--no-first-run", "--no-default-browser-check"]
    });
    const page = context.pages()[0] || await context.newPage();
    await emitCaptureStatus(options, {
      runId,
      status: "running",
      noteId: noteIdFromUrl(resolved.targetUrl),
      finalUrl: publicCaptureUrl(noteIdFromUrl(resolved.targetUrl), resolved.targetUrl),
      captureState: "navigating",
      reason: "可见 Chrome 已启动，正在读取游客可见的页面状态。",
      humanAction: "",
      checkedAt: new Date().toISOString()
    });
    const commentPayloads = [];
    page.on("response", async (response) => {
      if (commentPayloads.length >= 6) return;
      if (!response.url().includes("/api/sns/web/v2/comment/page")) return;
      try {
        const contentType = response.headers()["content-type"] || "";
        if (!contentType.includes("json")) return;
        const payload = await response.json();
        const normalized = normalizeCommentPayload(payload);
        if (normalized.comments.length) commentPayloads.push(normalized);
      } catch {
        // Comment interception is best-effort and limited to naturally loaded first-page requests.
      }
    });

    let navigationError = "";
    try {
      await page.goto(resolved.targetUrl, {
        waitUntil: "domcontentloaded",
        timeout: Math.max(15000, Number(options.timeoutMs) || 45000)
      });
    } catch (error) {
      navigationError = cleanText(error?.message || error, 1000);
    }
    await page.waitForTimeout(2500);
    try {
      await page.waitForFunction(
        () => Boolean(window.__INITIAL_STATE__?.note?.noteDetailMap || window.__INITIAL_STATE__?.noteDetailMap),
        { timeout: 12000 }
      );
    } catch {
      // Some blocked states expose no note state at all; access detection below explains why.
    }
    await page.evaluate(() => window.scrollTo({ top: Math.round(document.body.scrollHeight * 0.58), behavior: "instant" }));
    await page.waitForTimeout(1800);
    await page.waitForTimeout(800);

    let evidence = await extractPageEvidence(page, runId);
    let access = accessStatus(evidence);
    let finalNoteId = evidence.noteId || noteIdFromUrl(evidence.effectiveUrl) || noteIdFromUrl(resolved.targetUrl);
    captureUrl = publicCaptureUrl(finalNoteId, evidence.effectiveUrl);
    if (["verification-required", "login-required"].includes(access.captureState) && waitBudget(options) > 0) {
      const waited = await waitForManualAccess(page, {
        runId,
        captureUrl,
        initialEvidence: evidence,
        initialAccess: access,
        options
      });
      evidence = waited.evidence;
      access = waited.access;
      finalNoteId = evidence.noteId || finalNoteId;
      captureUrl = publicCaptureUrl(finalNoteId, evidence.effectiveUrl || captureUrl);
    }
    const subtitle = access.status === "captured"
      ? await fetchPlatformSubtitle(page, evidence.subtitleEntries, evidence.effectiveUrl || resolved.targetUrl)
      : null;
    await context.close();
    context = null;

    const comments = commentPayloads[0] || {
      comments: [],
      hasMore: false,
      cursorPresent: false,
      source: "natural-first-page"
    };
    const mediaItems = [];
    const coverUrl = allowedMediaUrl(evidence.coverUrl) || evidence.coverUrl || "";
    if (coverUrl) {
      mediaItems.push({
        type: "image",
        url: coverUrl,
        description: "笔记封面"
      });
    }
    for (const image of evidence.images.slice(1)) {
      const url = allowedMediaUrl(image) || image;
      if (url && !mediaItems.some((item) => item.url === url)) {
        mediaItems.push({ type: "image", url, description: `笔记图片 ${mediaItems.length + 1}` });
      }
    }
    const mp4Url = allowedMediaUrl(evidence.mediaMp4Url);
    if (mp4Url) mediaItems.push({ type: "video", url: mp4Url, description: "公开视频 MP4" });

    const chapters = evidence.chapters.map((chapter, index) => {
      const seconds = chapter.timeMilliseconds === null ? null : chapter.timeMilliseconds / 1000;
      return {
        index,
        title: cleanText(chapter.title, 500),
        startSeconds: seconds,
        startTimestamp: seconds === null ? "" : formatTimestamp(seconds)
      };
    });
    const capturedAt = new Date().toISOString();
    const warnings = [];
    if (navigationError) warnings.push(`页面导航未完整结束：${navigationError}`);
    if (!comments.comments.length) warnings.push("未捕获自然加载的首屏评论；不声称评论已完整采集。");
    if (!subtitle) warnings.push("未发现可读取的平台字幕；可由本地 ASR 补采逐字稿。");
    if (!mp4Url) warnings.push("公开页面没有暴露完整 MP4；不会用 m4s 分片冒充可转写视频。");

    const result = {
      ok: access.status === "captured",
      runId,
      status: access.status,
      reason: access.reason,
      humanAction: access.humanAction,
      startedAt,
      finishedAt: capturedAt,
      resolvedFrom: resolved.inputUrl,
      finalUrl: captureUrl,
      warnings,
      capture: {
        schemaVersion: 2,
        noteId: finalNoteId,
        captureUrl,
        effectiveUrl: captureUrl,
        capturedAt,
        title: cleanText(evidence.title, 500),
        bodyText: String(evidence.desc || "").replace(/\u0000/g, "").trim().slice(0, 100000),
        author: cleanText(evidence.author, 200),
        authorId: cleanText(evidence.authorId, 200),
        sourceProfileUrl: evidence.authorId
          ? `https://www.xiaohongshu.com/user/profile/${encodeURIComponent(evidence.authorId)}`
          : cleanText(evidence.sourceProfileUrl, 1000),
        publishedAt: cleanText(evidence.publishedAt, 100),
        engagement: cleanText(evidence.engagement, 100),
        engagementDetails: {
          likes: normalizedCount(evidence.engagement),
          comments: normalizedCount(evidence.commentCount),
          collects: normalizedCount(evidence.collectCount),
          shares: normalizedCount(evidence.shareCount)
        },
        coverUrl,
        mediaItems,
        chapters,
        comments: comments.comments,
        commentScope: {
          source: "natural-first-page",
          capturedCount: comments.comments.length,
          hasMore: comments.hasMore,
          cursorPresent: comments.cursorPresent,
          complete: false,
          note: "只记录页面自然加载的首屏评论，不代表全部评论。"
        },
        rawPageText: evidence.rawPageText,
        captureState: access.captureState,
        pageAccess: {
          mode: "guest-chrome",
          loginPromptPresent: evidence.loginPromptPresent,
          verificationPresent: evidence.verificationPresent,
          finalUrl: captureUrl
        },
        transcriptText: subtitle?.text || "",
        transcriptStatus: subtitle ? "captured" : "missing",
        transcriptSource: subtitle?.sourceLabel || "",
        transcriptNote: subtitle
          ? `平台提供的 ${subtitle.language} 字幕，状态仍为 unverified，引用前需人工核对。`
          : "公开页面未暴露平台字幕；未把正文冒充逐字稿。",
        transcriptSegments: subtitle?.segments || [],
        transcriptModel: subtitle ? `platform-subtitle:${subtitle.language}` : "",
        transcriptDurationSeconds: subtitle?.segments?.at(-1)?.end || 0,
        transcriptCapturedAt: subtitle?.capturedAt || "",
        extraction: {
          autoScroll: true,
          autoScrollScope: "single-natural-comment-trigger",
          privateApiCalled: false,
          capturedCookies: false,
          capturedTokens: false,
          mediaDownloaded: false
        }
      }
    };
    await emitCaptureStatus(options, {
      runId,
      status: access.status,
      noteId: finalNoteId,
      finalUrl: captureUrl,
      captureState: access.captureState,
      reason: access.reason,
      humanAction: access.humanAction,
      checkedAt: capturedAt
    });
    return result;
  } catch (error) {
    const result = {
      ok: false,
      runId,
      status: "failed",
      reason: cleanText(error?.message || error, 2000),
      humanAction: "检查 Chrome、网络和分享链接后重试。",
      startedAt,
      finishedAt: new Date().toISOString(),
      warnings: []
    };
    await emitCaptureStatus(options, {
      runId,
      status: "failed",
      noteId: resolved ? noteIdFromUrl(resolved.targetUrl) : "",
      finalUrl: captureUrl || (resolved ? publicCaptureUrl(noteIdFromUrl(resolved.targetUrl), resolved.targetUrl) : ""),
      captureState: "failed",
      reason: result.reason,
      humanAction: result.humanAction,
      checkedAt: result.finishedAt
    });
    return result;
  } finally {
    if (context) await context.close().catch(() => {});
    if (profileDir) await fs.rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
}
