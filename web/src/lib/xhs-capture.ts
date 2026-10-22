export interface XhsCaptureSource {
  id: string;
  name?: string;
  url?: string;
  platform?: string;
  collectionMethod?: string;
}

export interface XhsCaptureSignal {
  id: string;
  sourceId: string;
  url?: string;
  title?: string;
  author?: string;
  platform?: string;
}

interface BrowserCaptureToken {
  sourceId: string;
  token: string;
  expiresAt: string;
}

interface CaptureRuntime {
  browserCapture?: BrowserCaptureToken[];
}

function captureOrigin(): string {
  if (window.location.port === "5181") {
    const host = window.location.hostname === "localhost" ? "127.0.0.1" : window.location.hostname;
    return `http://${host}:5177`;
  }
  return window.location.origin;
}

function captureTokenRecord(runtime: CaptureRuntime | undefined, sourceId: string): BrowserCaptureToken | null {
  const record = (runtime?.browserCapture || []).find((item) => item.sourceId === sourceId);
  if (!record) return null;
  const expiresAt = Date.parse(record.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
  return record;
}

export function hasBrowserCaptureToken(runtime: CaptureRuntime | undefined, sourceId: string): boolean {
  return Boolean(captureTokenRecord(runtime, sourceId));
}

export function isXhsBrowserCaptureSource(source: XhsCaptureSource | null | undefined): boolean {
  return source?.platform === "xiaohongshu" && source.collectionMethod === "browser-assisted";
}

export function canCaptureXhsProfile(
  source: XhsCaptureSource | null | undefined,
  runtime: CaptureRuntime | undefined
): boolean {
  return isXhsBrowserCaptureSource(source) && hasBrowserCaptureToken(runtime, source.id);
}

export function canCaptureXhsDetail(
  signal: XhsCaptureSignal | null | undefined,
  source: XhsCaptureSource | null | undefined,
  runtime: CaptureRuntime | undefined
): boolean {
  return Boolean(
    signal?.platform === "xiaohongshu"
      && isXhsBrowserCaptureSource(source)
      && hasBrowserCaptureToken(runtime, signal.sourceId)
  );
}

function browserCaptureToken(runtime: CaptureRuntime | undefined, sourceId: string): string {
  const record = captureTokenRecord(runtime, sourceId);
  if (!record) {
    throw new Error("采集 token 不存在或已过期，请刷新工作台后重新复制采集书签。");
  }
  return record.token;
}

export function xhsCollectorSource(
  source: XhsCaptureSource,
  runtime: CaptureRuntime | undefined
): string {
  const endpoint = `${captureOrigin()}/api/browser-capture`;
  const localOrigin = new URL(endpoint).origin;
  const expectedProfile = String(source.url || "").match(/\/user\/profile\/([A-Za-z0-9_-]+)/)?.[1] || "";
  return `
(async () => {
  if (location.hostname !== "www.xiaohongshu.com" || !location.pathname.startsWith("/user/profile/")) {
    alert("请在小红书博主主页运行这个采集脚本。");
    return;
  }
  const expectedProfile = ${JSON.stringify(expectedProfile)};
  if (expectedProfile && !location.pathname.startsWith("/user/profile/" + expectedProfile)) {
    alert("当前博主和这个采集书签不匹配，请使用对应账号的书签。");
    return;
  }

  const sourceId = ${JSON.stringify(source.id)};
  const bridgeOrigin = ${JSON.stringify(localOrigin)};
  const unwrap = (value) => {
    let current = value;
    for (let index = 0; index < 6 && current && typeof current === "object" && "_rawValue" in current; index += 1) {
      current = current._rawValue;
    }
    return current;
  };
  const notesRoot = unwrap(window.__INITIAL_STATE__?.user?.notes) || [];
  const groups = Array.isArray(notesRoot) ? notesRoot : Object.values(notesRoot || {});
  const items = [];
  const blockedItems = [];
  const seen = new Set();
  const countFromText = (value) => {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.round(value);
    const match = String(value || "").match(/([\\d,.]+)\\s*(万|亿|[kK])?/);
    if (!match) return 0;
    const base = Number(match[1].replace(/,/g, ""));
    if (!Number.isFinite(base)) return 0;
    const multiplier = match[2] === "亿" ? 100000000 : match[2] === "万" ? 10000 : match[2] ? 1000 : 1;
    return Math.round(base * multiplier);
  };
  const profileState = unwrap(window.__INITIAL_STATE__?.user?.userPageData) || {};
  const profileInteractions = Array.isArray(unwrap(profileState.interactions)) ? unwrap(profileState.interactions) : [];
  const profileInteractionCount = (type) => profileInteractions.find((item) => item?.type === type)?.count || "";
  const pageText = document.body?.innerText || "";
  const noteTextMatch = pageText.match(/([\\d,.]+)\\s*(万|亿|[kK])?\\s*(?:篇)?笔记/);
  const followerTextMatch = pageText.match(/([\\d,.]+)\\s*(万|亿|[kK])?\\s*(?:个)?粉丝/);
  const engagementTextMatch = pageText.match(/([\\d,.]+)\\s*(万|亿|[kK])?\\s*\\+?\\s*(?:次)?(?:获)?赞与收藏/);
  const context = {
    profileNoteCount: countFromText(profileState.posted) || countFromText(noteTextMatch?.[0]),
    profileFollowers: countFromText(profileInteractionCount("fans")) || countFromText(followerTextMatch?.[0]),
    profileEngagement: countFromText(profileInteractionCount("interaction")) || countFromText(engagementTextMatch?.[0]),
    captureScope: "user-visible-profile-state",
    autoScroll: false,
    privateApiCalled: false
  };
  const allowedCoverUrl = (value) => {
    if (!/^https?:\\/\\//i.test(String(value || ""))) return "";
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase();
      return host.endsWith(".xiaohongshu.com") || host.endsWith(".xhscdn.com") || host.endsWith(".xhscdn.net")
        ? url.toString()
        : "";
    } catch {
      return "";
    }
  };

  for (const group of groups) {
    const unwrappedGroup = unwrap(group);
    const list = Array.isArray(unwrappedGroup) ? unwrappedGroup : Object.values(unwrappedGroup || {});
    for (const entry of list) {
      if (!entry || typeof entry !== "object") continue;
      const unwrappedEntry = unwrap(entry);
      if (!unwrappedEntry || typeof unwrappedEntry !== "object") continue;
      const note = unwrap(unwrappedEntry.noteCard) || unwrap(unwrappedEntry.note_card) || {};
      const noteId = String(
        unwrap(unwrappedEntry.id) || unwrap(unwrappedEntry.noteId) || unwrap(unwrappedEntry.note_id)
        || unwrap(note.noteId) || unwrap(note.note_id) || ""
      ).trim();
      if (!noteId) {
        const blockedInteraction = unwrap(note.interactInfo) || unwrap(note.interact_info) || {};
        const blockedTime = Number(unwrap(note.time) || unwrap(unwrappedEntry.time) || 0);
        const blockedTimestamp = blockedTime > 0 && blockedTime < 10000000000 ? blockedTime * 1000 : blockedTime;
        const blockedDate = blockedTimestamp > 0 ? new Date(blockedTimestamp) : null;
        blockedItems.push({
          title: unwrap(note.displayTitle) || unwrap(note.title) || unwrap(note.desc) || "",
          engagement: String(unwrap(blockedInteraction.likedCount) || unwrap(blockedInteraction.liked_count) || unwrap(blockedInteraction.liked) || ""),
          publishedAt: blockedDate && !Number.isNaN(blockedDate.getTime()) ? blockedDate.toISOString() : "",
          coverUrl: allowedCoverUrl(unwrap(unwrap(note.cover)?.urlDefault) || unwrap(unwrap(note.cover)?.url)),
          reason: "note-id-unavailable"
        });
        continue;
      }
      if (seen.has(noteId)) continue;

      const token = unwrap(unwrappedEntry.xsecToken) || unwrap(unwrappedEntry.xsec_token) || unwrap(note.xsecToken) || "";
      const interaction = unwrap(unwrappedEntry.interactInfo) || unwrap(unwrappedEntry.interact_info)
        || unwrap(note.interactInfo) || unwrap(note.interact_info) || {};
      const engagement = unwrap(interaction.likedCount) || unwrap(interaction.liked_count) || unwrap(interaction.liked) || "";
      const timeValue = Number(unwrap(unwrappedEntry.time) || unwrap(note.time) || unwrap(note.lastUpdateTime) || 0);
      const timestamp = timeValue > 0 && timeValue < 10000000000 ? timeValue * 1000 : timeValue;
      const date = timestamp > 0 ? new Date(timestamp) : null;
      const query = token
        ? "?xsec_token=" + encodeURIComponent(token) + "&xsec_source=pc_user"
        : "";

      seen.add(noteId);
      items.push({
        title: unwrap(unwrappedEntry.displayTitle) || unwrap(unwrappedEntry.display_title) || unwrap(note.displayTitle) || unwrap(note.title) || unwrap(note.desc) || noteId,
        url: "https://www.xiaohongshu.com/explore/" + encodeURIComponent(noteId) + query,
        engagement: String(engagement || ""),
        publishedAt: date && !Number.isNaN(date.getTime()) ? date.toISOString() : "",
        noteId
      });
    }
  }

  if (!items.length && !blockedItems.length) {
    alert("页面状态里没有可见笔记。请先停留在“笔记”页签；如列表未加载完，先手动滚动，再重新点击。");
    return;
  }

  try {
    const captureToken = ${JSON.stringify(browserCaptureToken(runtime, source.id))};
    let resolveBridgeReady;
    let resolveBridgeResult;
    const bridgeReady = new Promise((resolve) => { resolveBridgeReady = resolve; });
    const bridgeResult = new Promise((resolve) => { resolveBridgeResult = resolve; });
    window.addEventListener("message", (event) => {
      if (event.origin !== bridgeOrigin) return;
      if (event.data?.type === "workbench-bridge-ready") {
        resolveBridgeReady(true);
        return;
      }
      if (event.data?.type === "workbench-profile-capture-result") {
        resolveBridgeReady(false);
        resolveBridgeResult(event.data);
      }
    }, { once: false });
    const bridgeWindow = window.open(bridgeOrigin + "/capture-bridge.html", "_blank", "width=520,height=420");
    let payload = null;
    if (bridgeWindow) {
      const ready = await Promise.race([
        bridgeReady,
        new Promise((resolve) => setTimeout(() => resolve(false), 15000))
      ]);
      if (ready) {
        bridgeWindow.postMessage({
          type: "workbench-profile-capture",
          sourceId,
          token: captureToken,
          items,
          blockedItems,
          context
        }, bridgeOrigin);
        payload = await Promise.race([
          bridgeResult,
          new Promise((resolve) => setTimeout(() => resolve({ ok: false, error: "本地桥接页没有返回结果" }), 20000))
        ]);
        if (payload.ok === false) throw new Error(payload.error || "本地桥接提交失败");
      }
    }
    if (!payload) {
      const response = await fetch(${JSON.stringify(endpoint)}, {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        headers: {
          "content-type": "application/json",
          "x-capture-token": captureToken
        },
        body: JSON.stringify({ sourceId, items, blockedItems, context })
      });
      payload = await response.json();
      if (!response.ok || payload.ok === false) throw new Error(payload.error || "HTTP " + response.status);
    }
    let message = payload.run.blockedNoteCount
      ? "主页快照已保存：可见 " + payload.run.loadedCount + " 条，其中 " + payload.run.blockedNoteCount + " 条缺少可打开 noteId，暂不进入 Inbox。"
      : "采集完成：发现 " + payload.run.found + " 条，新增 " + payload.run.created + " 条。";
    if (payload.run.coverageStatus === "blocked") {
      message += "\\n当前游客态无法生成笔记详情链接。想补正文或逐字稿时，请从 App 分享这条笔记，再用详情书签采集。";
    } else if (payload.run.profileNoteCount) {
      message += "\\n主页显示 " + payload.run.profileNoteCount + " 条，工作台已入库 " + payload.run.collectedCount + " 条。";
    } else {
      message += "\\n本页已加载 " + payload.run.loadedCount + " 条；未识别到主页总笔记数，请继续滚动补齐目标范围。";
    }
    alert(message);
  } catch (error) {
    console.error("Personal Content Workbench capture", { items, blockedItems, context }, error);
    alert("本地提交失败：" + error.message + "。已在控制台输出本次可见快照。");
  }
})();
`.trim();
}

export function xhsBookmarkletHref(source: XhsCaptureSource, runtime: CaptureRuntime | undefined): string {
  return `javascript:${encodeURIComponent(xhsCollectorSource(source, runtime))}`;
}

export function xhsDetailCollectorSource(
  signal: XhsCaptureSignal,
  runtime: CaptureRuntime | undefined
): string {
  const endpoint = `${captureOrigin()}/api/browser-detail-capture`;
  const expectedCaptureUrl = String(signal.url || "");
  const expectedMatch = expectedCaptureUrl.match(
    /\/(?:explore|discovery\/item)\/([A-Za-z0-9_-]+)|\/user\/profile\/[A-Za-z0-9_-]+\/([A-Za-z0-9_-]+)/
  );
  const expectedNoteId = expectedMatch?.[1] || expectedMatch?.[2] || "";
  return `
(async () => {
  if (location.hostname !== "www.xiaohongshu.com") {
    alert("请在小红书笔记详情页运行这个采集脚本。");
    return;
  }
  const currentMatch = location.pathname.match(/\\/(?:explore|discovery\\/item)\\/([A-Za-z0-9_-]+)|\\/user\\/profile\\/[A-Za-z0-9_-]+\\/([A-Za-z0-9_-]+)/);
  const currentNoteId = currentMatch?.[1] || currentMatch?.[2] || "";
  const expectedNoteId = ${JSON.stringify(expectedNoteId)};
  const rawPageText = (document.body?.innerText || "").slice(0, 100000);
  const visibleRoute = decodeURIComponent(location.href) + "\\n" + rawPageText;
  const blockedPage = currentNoteId !== expectedNoteId && /(当前笔记暂时无法浏览|扫码登录后查看完整内容|访问受限|操作过于频繁|页面不见了|安全限制|访问链接异常)/.test(visibleRoute);
  if (!expectedNoteId || (currentNoteId !== expectedNoteId && !blockedPage)) {
    alert("当前详情页和工作台信号不匹配，请先打开这条信号的链接。");
    return;
  }

  const localOrigin = new URL(${JSON.stringify(endpoint)}).origin;
  const captureToken = ${JSON.stringify(browserCaptureToken(runtime, signal.sourceId))};
  let resolveBridgeReady;
  let resolveBridgeResult;
  const bridgeReady = new Promise((resolve) => { resolveBridgeReady = resolve; });
  const bridgeResult = new Promise((resolve) => { resolveBridgeResult = resolve; });
  window.addEventListener("message", (event) => {
    if (event.origin !== localOrigin) return;
    if (event.data?.type === "workbench-bridge-ready") {
      resolveBridgeReady(true);
      return;
    }
    if (event.data?.type === "workbench-detail-capture-result") {
      resolveBridgeReady(false);
      resolveBridgeResult(event.data);
    }
  }, { once: false });
  const bridgeWindow = window.open(localOrigin + "/capture-bridge.html", "_blank", "width=520,height=420");
  if (!bridgeWindow) resolveBridgeReady(false);

  const unwrap = (value) => {
    let current = value;
    for (let index = 0; index < 6 && current && typeof current === "object" && "_rawValue" in current; index += 1) {
      current = current._rawValue;
    }
    return current;
  };
  const firstString = (value, keys) => {
    for (const key of keys) {
      const item = unwrap(value?.[key]);
      if (typeof item === "string" && item.trim()) return item.trim();
    }
    return "";
  };
  const countFromText = (value) => {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return String(Math.round(value));
    return String(value || "").trim();
  };
  const allowedMediaUrl = (value) => {
    if (!/^https?:\\/\\//i.test(String(value || ""))) return "";
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase();
      const allowed = host.endsWith(".xiaohongshu.com") || host === "xiaohongshu.com"
        || host.endsWith(".xhscdn.com") || host === "xhscdn.com"
        || host.endsWith(".xhscdn.net") || host === "xhscdn.net";
      return allowed ? url.toString() : "";
    } catch {
      return "";
    }
  };
  const mediaFromObject = (value, depth = 0, output = [], seenObjects = new Set()) => {
    if (!value || typeof value !== "object" || depth > 5 || output.length >= 30) return output;
    if (seenObjects.has(value)) return output;
    seenObjects.add(value);
    const mediaUrlKeys = ["urlDefault", "url", "originalUrl", "masterUrl", "backupUrls", "master_url", "backup_urls"];
    const directUrls = mediaUrlKeys.flatMap((key) => {
      const item = unwrap(value[key]);
      if (typeof item === "string") return [item];
      if (Array.isArray(item)) return item.filter((entry) => typeof entry === "string");
      return [];
    });
    for (const candidate of directUrls) {
      const url = allowedMediaUrl(candidate);
      if (!url || output.some((item) => item.url === url)) continue;
      const lower = url.toLowerCase();
      const isVideo = /\\.(mp4|m3u8)(?:[?#]|$)/.test(lower) || /master|stream|video/i.test(url);
      output.push({ type: isVideo ? "video" : "image", url, description: firstString(value, ["desc", "description", "alt", "title"]) });
      if (output.length >= 30) return output;
    }
    for (const entry of Object.values(value)) {
      const child = unwrap(entry);
      if (child && typeof child === "object") mediaFromObject(child, depth + 1, output, seenObjects);
    }
    return output;
  };
  const subtitleUrls = [];
  const findSubtitleUrl = (value, key = "", depth = 0, seenObjects = new Set()) => {
    if (!value || typeof value !== "object" || depth > 6 || seenObjects.has(value)) return;
    seenObjects.add(value);
    for (const [childKey, entry] of Object.entries(value)) {
      const child = unwrap(entry);
      if (typeof child === "string" && /subtitle|caption/i.test(childKey) && /^https?:\\/\\//i.test(child)) {
        subtitleUrls.push(child);
      } else if (child && typeof child === "object") {
        findSubtitleUrl(child, childKey, depth + 1, seenObjects);
      }
    }
  };

  const pageState = unwrap(window.__INITIAL_STATE__ || {});
  const noteMap = unwrap(pageState?.note?.noteDetailMap);
  const roots = [
    noteMap?.[currentNoteId],
    unwrap(noteMap?.[currentNoteId]?.note),
    unwrap(pageState?.noteData?.data),
    unwrap(pageState?.noteData),
    pageState
  ].filter(Boolean);
  const queue = roots.map((root) => [root, 0]);
  const seenObjects = new Set();
  const detailCandidates = [];
  while (queue.length && detailCandidates.length < 50) {
    const [value, depth] = queue.shift();
    if (!value || typeof value !== "object" || depth > 8 || seenObjects.has(value)) continue;
    seenObjects.add(value);
    const note = unwrap(value.note);
    const source = note || value;
    const title = firstString(source, ["title", "displayTitle", "display_title"]);
    const desc = firstString(source, ["desc", "description", "content"]);
    const noteId = firstString(source, ["noteId", "note_id", "id"]);
    if ((title || desc) && (noteId === currentNoteId || value === roots[0] || value === roots[1])) {
      detailCandidates.push(source);
    }
    for (const entry of Object.values(value)) {
      const child = unwrap(entry);
      if (child && typeof child === "object") queue.push([child, depth + 1]);
    }
  }
  const detail = detailCandidates[0] || {};
  const detailNote = unwrap(detail.note) || detail;
  findSubtitleUrl(pageState);

  let trackText = "";
  for (const video of Array.from(document.querySelectorAll("video"))) {
    for (const track of Array.from(video.textTracks || [])) {
      if (track.mode === "disabled") track.mode = "hidden";
      const cues = Array.from(track.cues || []).map((cue) => cue.text || "").join("\\n").trim();
      if (cues) {
        trackText = cues;
        break;
      }
    }
    if (trackText) break;
  }
  const stateTranscript = firstString(detailNote, ["transcriptText", "transcript", "subtitleText"]);
  const transcriptText = trackText || (/^https?:\\/\\//i.test(stateTranscript) ? "" : stateTranscript);
  const mediaItems = mediaFromObject(detailNote);
  const coverCandidate = firstString(unwrap(detailNote.cover), ["urlDefault", "url", "originalUrl"]);
  const domTitle = document.querySelector("#detail-title, h1")?.textContent?.trim() || "";
  const metaTitle = document.querySelector('meta[property="og:title"]')?.content?.trim() || "";
  const domDesc = document.querySelector("#detail-desc, [class*='desc']")?.textContent?.trim() || "";
  const title = firstString(detailNote, ["title", "displayTitle", "display_title"]) || domTitle || metaTitle || document.title.replace(/ - 小红书$/, "");
  const contentText = firstString(detailNote, ["desc", "description", "content"]) || domDesc;
  const authorObject = unwrap(detailNote.user);
  const author = firstString(authorObject, ["nickname", "nickName", "name"]) || ${JSON.stringify(signal.author || "")};
  const timeValue = Number(detailNote.time || detailNote.lastUpdateTime || detailNote.last_update_time || 0);
  const timestamp = timeValue > 0 && timeValue < 10000000000 ? timeValue * 1000 : timeValue;
  const interaction = unwrap(detailNote.interactInfo) || unwrap(detailNote.interact_info) || {};
  const engagement = countFromText(interaction.likedCount || interaction.liked_count || interaction.liked || "");
  const hasPageEvidence = Boolean(title || contentText || mediaItems.length || rawPageText);
  const blockedText = /(验证码|滑块|拖动滑块|访问受限|操作过于频繁|异常|扫码登录后查看完整内容)/.test(rawPageText);
  if (!hasPageEvidence) {
    alert("当前页面没有可采集的详情内容。");
    return;
  }

  const capture = blockedPage ? {
    noteId: expectedNoteId,
    captureUrl: ${JSON.stringify(expectedCaptureUrl)},
    effectiveUrl: location.href,
    title: "",
    author: "",
    contentText: "",
    coverUrl: "",
    mediaItems: [],
    transcriptText: "",
    transcriptStatus: "blocked",
    transcriptNote: "笔记详情页被登录墙、删除、下架或风控重定向，未取得内容、封面、媒体和逐字稿。",
    rawPageText
  } : {
    noteId: currentNoteId,
    captureUrl: location.href,
    title,
    author,
    contentText,
    coverUrl: allowedMediaUrl(coverCandidate) || (mediaItems[0]?.type === "image" ? mediaItems[0].url : ""),
    mediaItems,
    publishedAt: timestamp ? new Date(timestamp).toISOString() : "",
    engagement,
    transcriptText,
    transcriptStatus: transcriptText ? "captured" : blockedText && !contentText ? "blocked" : "missing",
    transcriptSource: transcriptText ? (trackText ? "video-text-tracks" : "page-state") : "",
    transcriptNote: transcriptText ? "" : subtitleUrls.length ? "页面暴露了字幕文件链接，但本版不下载或解析文件，未生成逐字稿。" : "",
    rawPageText
  };

  try {
    let payload = null;
    if (bridgeWindow) {
      const ready = await Promise.race([
        bridgeReady,
        new Promise((resolve) => setTimeout(() => resolve(false), 15000))
      ]);
      if (ready) {
        bridgeWindow.postMessage({
          type: "workbench-detail-capture",
          signalId: ${JSON.stringify(signal.id)},
          sourceId: ${JSON.stringify(signal.sourceId)},
          token: captureToken,
          capture
        }, localOrigin);
        payload = await Promise.race([
          bridgeResult,
          new Promise((resolve) => setTimeout(() => resolve({ ok: false, error: "本地桥接页没有返回结果" }), 20000))
        ]);
        if (payload.ok === false) throw new Error(payload.error || "本地桥接提交失败");
      }
    }
    if (!payload) {
      const response = await fetch(${JSON.stringify(endpoint)}, {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        headers: {
          "content-type": "application/json",
          "x-capture-token": captureToken
        },
        body: JSON.stringify({
          signalId: ${JSON.stringify(signal.id)},
          sourceId: ${JSON.stringify(signal.sourceId)},
          capture
        })
      });
      payload = await response.json();
      if (!response.ok || payload.ok === false) throw new Error(payload.error || "HTTP " + response.status);
    }
    const transcript = payload.signal.transcriptStatus === "captured"
      ? "已取得 " + payload.signal.transcriptText.length + " 字"
      : payload.signal.transcriptStatus === "blocked" ? "被页面限制" : "当前可见范围缺失";
    alert("详情采集完成：正文 " + (payload.signal.contentText || "").length + " 字，媒体 " + (payload.signal.mediaItems || []).length + " 项，逐字稿" + transcript + "。");
  } catch (error) {
    console.error("Personal Content Workbench detail capture", capture, error);
    alert("直连本地工作台失败：" + error.message + "。已在控制台输出 capture，请复制后交给工作台。");
  }
})();
`.trim();
}

export function xhsDetailBookmarkletHref(
  signal: XhsCaptureSignal,
  runtime: CaptureRuntime | undefined
): string {
  return `javascript:${encodeURIComponent(xhsDetailCollectorSource(signal, runtime))}`;
}
