const textLimit = 100000;
const maxMediaItems = 50;
const allowedTranscriptStatuses = new Set(["captured", "missing", "blocked"]);

function text(value, limit = 2000) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, limit);
}

function longText(value) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, textLimit);
}

function platformContentId(value = "") {
  const match = String(value || "").match(/\/(?:explore|discovery\/item)\/([A-Za-z0-9_-]+)|\/user\/profile\/[A-Za-z0-9_-]+\/([A-Za-z0-9_-]+)/);
  return match?.[1] || match?.[2] || "";
}

function validUrl(value, { allowExternalMedia = false } = {}) {
  const raw = String(value || "").trim();
  if (!/^https?:\/\//i.test(raw)) return "";
  let url;
  try {
    url = new URL(raw);
  } catch {
    return "";
  }
  if (!allowExternalMedia) return url.toString();
  const host = url.hostname.toLowerCase();
  const isXhsHost = host === "xiaohongshu.com" || host.endsWith(".xiaohongshu.com")
    || host === "xhscdn.com" || host.endsWith(".xhscdn.com")
    || host === "xhscdn.net" || host.endsWith(".xhscdn.net");
  return isXhsHost ? url.toString() : "";
}

function normalizedDate(value = "") {
  if (!value) return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    const timestamp = value > 0 && value < 10000000000 ? value * 1000 : value;
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
  }
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function engagementCount(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.round(value));
  const match = String(value ?? "").trim().match(/^([\d,.]+)\s*(万|亿|[kK])?\+?$/);
  if (!match) return null;
  const base = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(base)) return null;
  const multiplier = match[2] === "亿" ? 100000000 : match[2] === "万" ? 10000 : match[2] ? 1000 : 1;
  return Math.max(0, Math.round(base * multiplier));
}

function normalizeMediaItems(value) {
  if (!Array.isArray(value)) return [];
  const items = [];
  const seen = new Set();
  for (const input of value.slice(0, maxMediaItems * 2)) {
    if (!input || typeof input !== "object") continue;
    const url = validUrl(input.url, { allowExternalMedia: true });
    if (!url || seen.has(url)) continue;
    const type = ["image", "video"].includes(input.type) ? input.type : "unknown";
    seen.add(url);
    items.push({
      type,
      url,
      description: text(input.description || input.alt, 1000),
      status: "not-downloaded"
    });
    if (items.length >= maxMediaItems) break;
  }
  return items;
}

function transcriptEvidence(value = {}) {
  const transcriptText = longText(value.transcriptText);
  let status = String(value.transcriptStatus || "").trim();
  if (!allowedTranscriptStatuses.has(status)) status = transcriptText ? "captured" : "missing";
  if (transcriptText && status !== "captured") status = "captured";
  if (!transcriptText && status === "captured") status = "missing";
  const source = text(value.transcriptSource || (status === "captured" ? "visible-page" : ""), 500);
  const note = text(value.transcriptNote, 1000);
  return {
    transcriptText,
    transcriptStatus: status,
    transcriptSource: status === "captured" ? source || "visible-page" : "",
    transcriptNote: status === "captured" ? note : note || (
      status === "blocked"
        ? "当前页面被登录墙或风控限制，未能取得逐字稿。"
        : "当前人工可见范围未暴露逐字稿；未把正文或描述冒充逐字稿。"
    )
  };
}

export function normalizeDetailCapture(signal = {}, capture = {}, timestamp = new Date().toISOString()) {
  if (!capture || typeof capture !== "object" || Array.isArray(capture)) {
    throw new Error("capture must be an object");
  }
  const expectedNoteId = platformContentId(signal.url);
  const suppliedNoteId = text(capture.noteId, 200);
  const captureUrl = validUrl(capture.captureUrl);
  const effectiveUrl = validUrl(capture.effectiveUrl);
  if (!expectedNoteId) throw new Error("signal does not have a Xiaohongshu note URL");
  if (suppliedNoteId !== expectedNoteId) throw new Error("capture note ID does not match signal");
  if (!captureUrl || platformContentId(captureUrl) !== expectedNoteId) {
    throw new Error("capture URL does not match signal note ID");
  }

  const title = text(capture.title, 500);
  const contentText = longText(capture.bodyText ?? capture.desc ?? capture.contentText);
  const coverUrl = validUrl(capture.coverUrl, { allowExternalMedia: true });
  const mediaItems = normalizeMediaItems(capture.mediaItems);
  const rawPageText = longText(capture.rawPageText);
  const transcript = transcriptEvidence(capture);
  const usableEvidence = Boolean(title || contentText || coverUrl || mediaItems.length || rawPageText || transcript.transcriptText);
  if (!usableEvidence) throw new Error("detail capture has no usable evidence");

  const normalizedCapture = {
    schemaVersion: 1,
    signalId: String(signal.id || ""),
    sourceId: String(signal.sourceId || ""),
    platform: "xiaohongshu",
    noteId: suppliedNoteId,
    captureUrl,
    ...(effectiveUrl ? { effectiveUrl } : {}),
    capturedAt: timestamp,
    title,
    author: text(capture.author, 200),
    publishedAt: normalizedDate(capture.publishedAt),
    engagement: text(capture.engagement, 100),
    contentText,
    coverUrl,
    mediaItems,
    rawPageText,
    ...transcript,
    extraction: {
      scope: "user-visible-page-state",
      autoScroll: false,
      privateApiCalled: false,
      mediaDownloaded: false,
      redirectedFromDetailUrl: Boolean(effectiveUrl && platformContentId(effectiveUrl) !== expectedNoteId)
    }
  };

  const patch = {
    ...(normalizedCapture.title ? { title: normalizedCapture.title } : {}),
    ...(normalizedCapture.author ? { author: normalizedCapture.author } : {}),
    ...(normalizedCapture.publishedAt ? { publishedAt: normalizedCapture.publishedAt } : {}),
    ...(engagementCount(normalizedCapture.engagement) !== null
      ? { engagement: engagementCount(normalizedCapture.engagement) }
      : {}),
    ...(contentText ? { contentText } : {}),
    ...(coverUrl ? { coverUrl } : {}),
    ...(mediaItems.length ? { mediaItems } : {}),
    transcriptText: transcript.transcriptText,
    transcriptStatus: transcript.transcriptStatus,
    transcriptSource: transcript.transcriptSource,
    transcriptNote: transcript.transcriptNote,
    detailCapturedAt: timestamp,
    detailCaptureUrl: captureUrl,
    updatedAt: timestamp
  };

  return { capture: normalizedCapture, patch };
}

export function mediaDescriptions(mediaItems = [], existing = []) {
  const descriptions = Array.isArray(existing) ? existing.filter(Boolean) : [];
  const seen = new Set(descriptions.map((item) => String(item?.url || "")));
  for (const item of mediaItems) {
    if (!item?.url || seen.has(item.url)) continue;
    seen.add(item.url);
    descriptions.push({
      type: item.type,
      url: item.url,
      description: String(item.description || "")
    });
  }
  return descriptions.slice(0, maxMediaItems);
}
