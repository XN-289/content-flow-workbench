import { chromium } from "playwright-core";
import { findChromeExecutable } from "./xhs-guest-detail.mjs";

const PROFILE_URL_PATTERN = /^https:\/\/www\.xiaohongshu\.com\/user\/profile\/([A-Za-z0-9_-]+)(?:[/?#]|$)/;
const CHALLENGE_PATTERN = /(IP存在风险|请切换可靠网络环境|扫码登录后查看完整内容|验证码|拖动滑块|访问频次异常|操作过于频繁|安全限制|页面不见了)/;

export class XhsProfileRefreshError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "XhsProfileRefreshError";
    this.code = options.code || "refresh-blocked";
    this.nextAction = options.nextAction || "";
  }
}

function cleanText(value, limit = 2000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function allowedCoverUrl(value) {
  if (!/^https?:\/\//i.test(String(value || ""))) return "";
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return host.endsWith(".xiaohongshu.com") || host.endsWith(".xhscdn.com") || host.endsWith(".xhscdn.net")
      ? url.toString()
      : "";
  } catch {
    return "";
  }
}

function countFromText(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.round(value);
  const match = String(value || "").match(/([\d,.]+)\s*(万|亿|[kK])?/);
  if (!match) return 0;
  const base = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(base)) return 0;
  const multiplier = match[2] === "亿" ? 100000000 : match[2] === "万" ? 10000 : match[2] ? 1000 : 1;
  return Math.round(base * multiplier);
}

function normalizeProfileSource(source = {}) {
  const url = String(source.url || "").trim();
  const match = url.match(PROFILE_URL_PATTERN);
  if (!match) {
    throw new XhsProfileRefreshError("账号主页必须是公开的小红书用户主页链接", {
      code: "invalid-profile-url",
      nextAction: "重新登记 https://www.xiaohongshu.com/user/profile/... 形式的账号主页"
    });
  }
  return {
    ...source,
    profileId: match[1],
    url: `https://www.xiaohongshu.com/user/profile/${match[1]}`
  };
}

export function normalizeXhsProfilePayload(payload = {}, source = {}) {
  if (!payload || typeof payload !== "object") {
    throw new XhsProfileRefreshError("主页没有返回可读取的页面状态", {
      nextAction: "稍后重试，或在小红书主页运行主页采集书签补一次可见快照"
    });
  }
  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  const rawBlockedItems = Array.isArray(payload.blockedItems) ? payload.blockedItems : [];
  if (!payload.readable && rawItems.length === 0 && rawBlockedItems.length === 0) {
    throw new XhsProfileRefreshError("主页没有加载出可见笔记", {
      nextAction: "稍后重试，或在小红书主页运行主页采集书签补一次可见快照"
    });
  }

  const items = rawItems
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      title: cleanText(item.title ?? item.displayTitle, 500),
      description: cleanText(item.description ?? item.desc, 5000),
      url: String(item.url || "").trim(),
      noteId: cleanText(item.noteId, 200),
      engagement: cleanText(item.engagement, 100),
      publishedAt: cleanText(item.publishedAt, 100),
      coverUrl: allowedCoverUrl(item.coverUrl)
    }))
    .filter((item) => item.url && item.noteId && (item.title || item.coverUrl));
  const blockedItems = rawBlockedItems
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      title: cleanText(item.title ?? item.displayTitle, 500),
      description: cleanText(item.description ?? item.desc, 5000),
      engagement: cleanText(item.engagement, 100),
      publishedAt: cleanText(item.publishedAt, 100),
      coverUrl: allowedCoverUrl(item.coverUrl),
      reason: "note-id-unavailable"
    }))
    .filter((item) => item.title || item.coverUrl);

  if (items.length === 0 && blockedItems.length === 0) {
    throw new XhsProfileRefreshError("主页返回了页面，但没有可确认的笔记标题或封面", {
      nextAction: "先确认账号主页在游客窗口可见，再用主页采集书签补一次快照"
    });
  }

  const pageText = cleanText(payload.pageText, 20000);
  const noteTextMatch = pageText.match(/([\d,.]+)\s*(万|亿|[kK])?\s*(?:篇)?笔记/);
  const followerTextMatch = pageText.match(/([\d,.]+)\s*(万|亿|[kK])?\s*(?:个)?粉丝/);
  const engagementTextMatch = pageText.match(/([\d,.]+)\s*(万|亿|[kK])?\s*\+?\s*(?:次)?(?:获)?赞与收藏/);
  const context = {
    ...(payload.context && typeof payload.context === "object" ? payload.context : {}),
    profileNoteCount: countFromText(payload.context?.profileNoteCount)
      || countFromText(noteTextMatch?.[0]),
    profileFollowers: countFromText(payload.context?.profileFollowers)
      || countFromText(followerTextMatch?.[0]),
    profileEngagement: countFromText(payload.context?.profileEngagement)
      || countFromText(engagementTextMatch?.[0]),
    source: "public-profile-playwright",
    readScope: "guest-visible-profile",
    privateApiCalled: false,
    credentialsIncluded: false,
    loginStateUsed: false,
    sourceProfileUrl: source.url || "",
    profileName: cleanText(payload.context?.profileName || source.name, 200)
  };
  return {
    items,
    blockedItems,
    context,
    pageText,
    effectiveUrl: String(payload.effectiveUrl || ""),
    title: cleanText(payload.title, 300)
  };
}

async function extractPublicProfileState(page) {
  return page.evaluate(() => {
    const unwrap = (value) => {
      let current = value;
      for (let index = 0; index < 8 && current && typeof current === "object" && "_rawValue" in current; index += 1) {
        current = current._rawValue;
      }
      if (typeof current === "string" && /^[\[{]/.test(current.trim()) && current.length <= 500000) {
        try {
          current = JSON.parse(current);
        } catch {
          return current;
        }
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
    const allowedCoverUrl = (value) => {
      if (!/^https?:\/\//i.test(String(value || ""))) return "";
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
    const countFromText = (value) => {
      if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.round(value);
      const match = String(value || "").match(/([\d,.]+)\s*(万|亿|[kK])?/);
      if (!match) return 0;
      const base = Number(match[1].replace(/,/g, ""));
      if (!Number.isFinite(base)) return 0;
      const multiplier = match[2] === "亿" ? 100000000 : match[2] === "万" ? 10000 : match[2] ? 1000 : 1;
      return Math.round(base * multiplier);
    };

    const state = unwrap(window.__INITIAL_STATE__ || {});
    const user = unwrap(state?.user) || {};
    const notesRoot = unwrap(user.notes);
    const groups = Array.isArray(notesRoot) ? notesRoot : Object.values(notesRoot || {});
    const items = [];
    const blockedItems = [];
    const seen = new Set();
    for (const group of groups) {
      const unwrappedGroup = unwrap(group);
      const list = Array.isArray(unwrappedGroup) ? unwrappedGroup : Object.values(unwrappedGroup || {});
      for (const entry of list) {
        const unwrappedEntry = unwrap(entry);
        if (!unwrappedEntry || typeof unwrappedEntry !== "object") continue;
        const note = unwrap(unwrappedEntry.noteCard) || unwrap(unwrappedEntry.note_card) || {};
        const noteId = String(
          unwrap(unwrappedEntry.id) || unwrap(unwrappedEntry.noteId) || unwrap(unwrappedEntry.note_id)
          || unwrap(note.noteId) || unwrap(note.note_id) || ""
        ).trim();
        const interaction = unwrap(unwrappedEntry.interactInfo) || unwrap(unwrappedEntry.interact_info)
          || unwrap(note.interactInfo) || unwrap(note.interact_info) || {};
        const engagement = unwrap(interaction.likedCount) || unwrap(interaction.liked_count)
          || unwrap(interaction.liked) || "";
        const timeValue = Number(
          unwrap(unwrappedEntry.time) || unwrap(note.time)
          || unwrap(note.lastUpdateTime) || unwrap(note.last_update_time) || 0
        );
        const timestamp = timeValue > 0 && timeValue < 10000000000 ? timeValue * 1000 : timeValue;
        const publishedAt = timestamp > 0 && !Number.isNaN(new Date(timestamp).getTime())
          ? new Date(timestamp).toISOString()
          : "";
        const coverUrl = allowedCoverUrl(
          unwrap(unwrap(note.cover)?.urlDefault)
          || unwrap(unwrap(note.cover)?.url_default)
          || unwrap(unwrap(note.cover)?.url)
        );
        const title = firstString(note, ["displayTitle", "display_title", "title"])
          || firstString(unwrappedEntry, ["displayTitle", "display_title", "title"]);
        const description = firstString(note, ["desc", "description", "content"]);
        if (!noteId) {
          if (title || coverUrl || description) {
            blockedItems.push({
              title: title || description.slice(0, 80),
              description,
              engagement: String(engagement || ""),
              publishedAt,
              coverUrl,
              reason: "note-id-unavailable"
            });
          }
          continue;
        }
        if (seen.has(noteId)) continue;
        const token = unwrap(unwrappedEntry.xsecToken) || unwrap(unwrappedEntry.xsec_token)
          || unwrap(note.xsecToken) || unwrap(note.xsec_token) || "";
        const query = token
          ? `?xsec_token=${encodeURIComponent(token)}&xsec_source=pc_user`
          : "";
        seen.add(noteId);
        items.push({
          title: title || description.slice(0, 80) || noteId,
          description,
          url: `https://www.xiaohongshu.com/explore/${encodeURIComponent(noteId)}${query}`,
          noteId,
          engagement: String(engagement || ""),
          publishedAt,
          coverUrl
        });
      }
    }

    const profileState = unwrap(user.userPageData) || {};
    const interactions = Array.isArray(unwrap(profileState.interactions))
      ? unwrap(profileState.interactions)
      : [];
    const interactionCount = (type) => interactions.find((item) => item?.type === type)?.count || "";
    const pageText = (document.body?.innerText || "").slice(0, 30000);
    const domCardCount = document.querySelectorAll(
      "section.note-item, [class*='note-item'], [data-v-a264b01a] section"
    ).length;
    return {
      items,
      blockedItems,
      readable: Boolean(notesRoot) || domCardCount > 0,
      effectiveUrl: location.href,
      title: document.title,
      pageText,
      context: {
        profileName: firstString(profileState, ["nickname", "nickName", "name"]),
        profileNoteCount: countFromText(profileState.posted),
        profileFollowers: countFromText(interactionCount("fans")),
        profileEngagement: countFromText(interactionCount("interaction")),
        capturedCardCount: items.length + blockedItems.length,
        domCardCount
      }
    };
  });
}

function assertPublicProfilePage(payload) {
  const effectiveUrl = String(payload?.effectiveUrl || "");
  if (/\/website-login\/error/i.test(effectiveUrl)) {
    throw new XhsProfileRefreshError("小红书公开主页触发网络风控，未取得账号内容", {
      code: "300012",
      nextAction: "当前网络环境被小红书判定为风险 IP；换到可信家庭网络后重试，工作台会保留上一份有效快照"
    });
  }
  const challenge = String(payload?.pageText || "").match(CHALLENGE_PATTERN)?.[0] || "";
  if (challenge) {
    throw new XhsProfileRefreshError(`小红书公开主页要求额外验证：${challenge}`, {
      code: "refresh-blocked",
      nextAction: "在小红书主页运行主页采集书签补一次可见快照；不要绕过验证码或登录墙"
    });
  }
}

export async function refreshXhsProfileSources(sources = [], options = {}) {
  const normalizedSources = sources.map(normalizeProfileSource);
  const results = [];
  if (!normalizedSources.length) return results;

  const executablePath = await findChromeExecutable(options);
  const browser = await chromium.launch({
    executablePath,
    headless: options.headless !== false,
    args: ["--no-first-run", "--no-default-browser-check"]
  });
  let context;
  try {
    context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      locale: "zh-CN",
      timezoneId: "Asia/Shanghai",
      colorScheme: "light",
      serviceWorkers: "block"
    });
    const page = await context.newPage();
    await page.route("**/*", (route) => {
      const resourceType = route.request().resourceType();
      if (["image", "media", "font"].includes(resourceType)) return route.abort();
      return route.continue();
    });

    for (const source of normalizedSources) {
      const checkedAt = new Date().toISOString();
      try {
        await page.goto(source.url, {
          waitUntil: "domcontentloaded",
          timeout: Math.max(15000, Number(options.timeoutMs) || 35000)
        });
        await page.waitForTimeout(Math.max(500, Number(options.settleMs) || 1800));
        const payload = await extractPublicProfileState(page);
        assertPublicProfilePage(payload);
        const normalized = normalizeXhsProfilePayload(payload, source);
        results.push({
          ok: true,
          status: "ok",
          sourceId: source.id,
          sourceName: source.name || source.profileId,
          checkedAt,
          effectiveUrl: payload.effectiveUrl,
          ...normalized
        });
      } catch (error) {
        const blocked = error instanceof XhsProfileRefreshError
          || /timeout|net::|ERR_|navigation/i.test(String(error?.message || ""));
        results.push({
          ok: false,
          status: blocked ? "blocked" : "failed",
          sourceId: source.id,
          sourceName: source.name || source.profileId,
          checkedAt,
          effectiveUrl: page.url(),
          challengeCode: error?.code || "",
          failureReason: cleanText(error?.message || error, 2000),
          nextAction: error?.nextAction || "保留上一份有效快照，稍后重试公开主页读取"
        });
      }
    }
  } finally {
    await context?.close().catch(() => {});
    await browser.close().catch(() => {});
  }
  return results;
}
