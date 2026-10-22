const textLimit = 100000;
const maxMediaItems = 50;
const maxChapters = 100;
const maxComments = 80;
const allowedTranscriptStatuses = new Set(["captured", "missing", "blocked"]);
const allowedCaptureStates = new Set([
  "captured-public",
  "verification-required",
  "login-required",
  "no-evidence"
]);

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

function nonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : null;
}

function canonicalProfileUrl(value, authorId = "") {
  if (authorId) return `https://www.xiaohongshu.com/user/profile/${encodeURIComponent(authorId)}`;
  const url = validUrl(value);
  if (!url) return "";
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (!(host === "xiaohongshu.com" || host.endsWith(".xiaohongshu.com"))) return "";
    const match = parsed.pathname.match(/^\/user\/profile\/([A-Za-z0-9_-]+)\/?$/);
    return match ? `https://www.xiaohongshu.com/user/profile/${match[1]}` : "";
  } catch {
    return "";
  }
}

function normalizeChapters(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxChapters).map((chapter, index) => {
    if (!chapter || typeof chapter !== "object") return null;
    const startSeconds = nonNegativeNumber(chapter.startSeconds);
    return {
      index,
      title: text(chapter.title, 500),
      startSeconds,
      startTimestamp: text(chapter.startTimestamp, 50)
    };
  }).filter((chapter) => chapter && (chapter.title || chapter.startSeconds !== null));
}

function normalizeCommentReplies(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 5).map((reply, index) => {
    if (!reply || typeof reply !== "object") return null;
    const content = text(reply.content, 3000);
    if (!content) return null;
    return {
      id: text(reply.id, 200) || `reply-${index + 1}`,
      content,
      author: text(reply.author, 200),
      authorId: text(reply.authorId, 200),
      likes: nonNegativeNumber(reply.likes),
      createdAt: text(reply.createdAt, 100),
      ipLocation: text(reply.ipLocation, 100),
      isAuthor: reply.isAuthor === true
    };
  }).filter(Boolean);
}

function normalizeComments(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxComments).map((comment, index) => {
    if (!comment || typeof comment !== "object") return null;
    const content = text(comment.content, 3000);
    if (!content) return null;
    const replies = normalizeCommentReplies(comment.replies);
    return {
      id: text(comment.id, 200) || `comment-${index + 1}`,
      content,
      author: text(comment.author, 200),
      authorId: text(comment.authorId, 200),
      likes: nonNegativeNumber(comment.likes),
      createdAt: text(comment.createdAt, 100),
      ipLocation: text(comment.ipLocation, 100),
      isAuthor: comment.isAuthor === true,
      subCommentCount: nonNegativeNumber(comment.subCommentCount),
      ...(replies.length ? { replies } : {})
    };
  }).filter(Boolean);
}

function normalizeCommentScope(value, comments) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const hasMore = input.hasMore === true;
  return {
    source: text(input.source, 200) || "natural-first-page",
    capturedCount: comments.length,
    hasMore,
    cursorPresent: input.cursorPresent === true,
    complete: input.complete === true && !hasMore,
    note: text(input.note, 1000) || (
      comments.length
        ? "只记录页面自然加载的评论样本；hasMore 表示评论未完整采集。"
        : "未捕获自然加载的评论；不声称评论已完整采集。"
    )
  };
}

function transcriptEvidence(value = {}) {
  const transcriptText = longText(value.transcriptText);
  let status = String(value.transcriptStatus || "").trim();
  if (!allowedTranscriptStatuses.has(status)) status = transcriptText ? "captured" : "missing";
  if (transcriptText && status !== "captured") status = "captured";
  if (!transcriptText && status === "captured") status = "missing";
  const source = text(value.transcriptSource || (status === "captured" ? "visible-page" : ""), 500);
  const note = text(value.transcriptNote, 1000);
  const segments = Array.isArray(value.transcriptSegments)
    ? value.transcriptSegments.slice(0, 2000).map((segment, index) => {
      if (!segment || typeof segment !== "object") return null;
      const segmentText = text(segment.text, 5000);
      const start = nonNegativeNumber(segment.start);
      const end = nonNegativeNumber(segment.end);
      if (!segmentText || start === null) return null;
      return {
        index,
        start,
        end: end !== null && end >= start ? end : start,
        startTimestamp: text(segment.startTimestamp, 50),
        endTimestamp: text(segment.endTimestamp, 50),
        text: segmentText
      };
    }).filter(Boolean)
    : [];
  return {
    transcriptText,
    transcriptStatus: status,
    transcriptSource: status === "captured" ? source || "visible-page" : "",
    transcriptSegments: status === "captured" ? segments : [],
    transcriptModel: status === "captured" ? text(value.transcriptModel, 500) : "",
    transcriptDurationSeconds: status === "captured" ? nonNegativeNumber(value.transcriptDurationSeconds) : null,
    transcriptCapturedAt: status === "captured" ? text(value.transcriptCapturedAt, 100) : "",
    transcriptNote: status === "captured" ? note : note || (
      status === "blocked"
        ? "当前页面被登录墙或风控限制，未能取得逐字稿。"
        : "当前人工可见范围未暴露逐字稿；未把正文或描述冒充逐字稿。"
    )
  };
}

function normalizeEngagementDetails(value) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    likes: nonNegativeNumber(input.likes),
    comments: nonNegativeNumber(input.comments),
    collects: nonNegativeNumber(input.collects),
    shares: nonNegativeNumber(input.shares)
  };
}

function normalizePageAccess(value, captureUrl) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    mode: text(input.mode, 100) || "guest-chrome",
    loginPromptPresent: input.loginPromptPresent === true,
    verificationPresent: input.verificationPresent === true,
    finalUrl: captureUrl
  };
}

function normalizeExtraction(value, redirectedFromDetailUrl) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    scope: text(input.scope, 200) || "user-visible-page-state",
    autoScroll: input.autoScroll === true,
    autoScrollScope: text(input.autoScrollScope, 200),
    privateApiCalled: input.privateApiCalled === true,
    mediaDownloaded: input.mediaDownloaded === true,
    capturedCookies: input.capturedCookies === true,
    capturedTokens: input.capturedTokens === true,
    redirectedFromDetailUrl
  };
}

function normalizeWarnings(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((warning) => text(warning, 500))
    .filter(Boolean)
    .slice(0, 20);
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
  const chapters = normalizeChapters(capture.chapters);
  const comments = normalizeComments(capture.comments);
  const commentScope = normalizeCommentScope(capture.commentScope, comments);
  const authorId = text(capture.authorId, 200);
  const sourceProfileUrl = canonicalProfileUrl(capture.sourceProfileUrl, authorId);
  const captureState = allowedCaptureStates.has(String(capture.captureState || ""))
    ? String(capture.captureState)
    : "captured-public";
  const redirectedFromDetailUrl = Boolean(effectiveUrl && platformContentId(effectiveUrl) !== expectedNoteId);
  const usableEvidence = Boolean(title || contentText || coverUrl || mediaItems.length || rawPageText || transcript.transcriptText);
  if (!usableEvidence) throw new Error("detail capture has no usable evidence");

  const normalizedCapture = {
    schemaVersion: 2,
    signalId: String(signal.id || ""),
    sourceId: String(signal.sourceId || ""),
    platform: "xiaohongshu",
    noteId: suppliedNoteId,
    captureUrl,
    ...(effectiveUrl ? { effectiveUrl } : {}),
    capturedAt: timestamp,
    title,
    author: text(capture.author, 200),
    authorId,
    sourceProfileUrl,
    publishedAt: normalizedDate(capture.publishedAt),
    engagement: text(capture.engagement, 100),
    engagementDetails: normalizeEngagementDetails(capture.engagementDetails),
    contentText,
    coverUrl,
    mediaItems,
    chapters,
    comments,
    commentScope,
    rawPageText,
    captureState,
    pageAccess: normalizePageAccess(capture.pageAccess, captureUrl),
    ...transcript,
    extraction: normalizeExtraction(capture.extraction, redirectedFromDetailUrl),
    warnings: normalizeWarnings(capture.warnings),
    boundaries: {
      localOnly: true,
      rawPageTextMayContainPrivateState: Boolean(rawPageText),
      mediaUrlsMayExpire: mediaItems.length > 0
    }
  };

  const existingTranscriptProtected = signal.transcriptStatus === "captured"
    && Boolean(String(signal.transcriptText || "").trim())
    && transcript.transcriptStatus !== "captured";
  const transcriptPatch = existingTranscriptProtected
    ? {}
    : {
      transcriptText: transcript.transcriptText,
      transcriptStatus: transcript.transcriptStatus,
      transcriptSource: transcript.transcriptSource,
      transcriptSegments: transcript.transcriptSegments,
      transcriptModel: transcript.transcriptModel,
      transcriptDurationSeconds: transcript.transcriptDurationSeconds,
      transcriptCapturedAt: transcript.transcriptCapturedAt,
      transcriptNote: transcript.transcriptNote
    };
  const patch = {
    ...(normalizedCapture.title ? { title: normalizedCapture.title } : {}),
    ...(normalizedCapture.author ? { author: normalizedCapture.author } : {}),
    ...(authorId ? { authorId } : {}),
    ...(sourceProfileUrl ? { sourceProfileUrl } : {}),
    ...(normalizedCapture.publishedAt ? { publishedAt: normalizedCapture.publishedAt } : {}),
    ...(engagementCount(normalizedCapture.engagement) !== null
      ? { engagement: engagementCount(normalizedCapture.engagement) }
      : {}),
    engagementDetails: normalizedCapture.engagementDetails,
    ...(contentText ? { contentText } : {}),
    ...(coverUrl ? { coverUrl } : {}),
    ...(mediaItems.length ? { mediaItems } : {}),
    chapters,
    comments,
    commentScope,
    captureState,
    pageAccess: normalizedCapture.pageAccess,
    extraction: normalizedCapture.extraction,
    captureWarnings: normalizedCapture.warnings,
    ...transcriptPatch,
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
