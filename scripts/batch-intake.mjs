const urlPattern = /https?:\/\/[^\s<>"'`]+/gi;
const trailingPunctuation = /[.,;:!?，。；：！？、）】》"'”’]+$/;
const xhsNotePattern = /^\/(?:explore|discovery\/item)\/([A-Za-z0-9_-]+)\/?$/;
const xhsProfilePattern = /^\/user\/profile\/([A-Za-z0-9_-]+)\/?$/;

function cleanUrl(value) {
  return String(value || "").trim().replace(trailingPunctuation, "");
}

function scanUrls(text) {
  return [...String(text || "").matchAll(urlPattern)]
    .map((match) => ({
      url: cleanUrl(match[0]),
      index: Number(match.index || 0)
    }))
    .filter((item) => item.url);
}

function hostnameOf(value) {
  try {
    return new URL(value).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return "";
  }
}

function isXiaohongshuHost(hostname) {
  return hostname === "xiaohongshu.com" || hostname.endsWith(".xiaohongshu.com");
}

function isXhsShortHost(hostname) {
  return hostname === "xhslink.cn" || hostname.endsWith(".xhslink.cn");
}

export function intakeUrlIdentity(value) {
  let url;
  try {
    url = new URL(cleanUrl(value));
  } catch {
    return "";
  }
  if (!/^https?:$/.test(url.protocol)) return "";

  const hostname = hostnameOf(url.toString());
  if (isXhsShortHost(hostname)) {
    return `xiaohongshu:short:${url.pathname}`;
  }
  if (isXiaohongshuHost(hostname)) {
    const noteId = url.pathname.match(xhsNotePattern)?.[1] || "";
    if (noteId) return `xiaohongshu:note:${noteId}`;
    const profileId = url.pathname.match(xhsProfilePattern)?.[1] || "";
    if (profileId) return `xiaohongshu:profile:${profileId}`;
  }

  url.hash = "";
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  const retained = [...url.searchParams.entries()]
    .filter(([key]) => !/^(?:utm_.+|ref|spm|xsec_token|xsec_source|source)$/i.test(key))
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => (
      leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue)
    ));
  url.search = "";
  retained.forEach(([key, item]) => url.searchParams.append(key, item));
  return `url:${url.toString()}`;
}

export function intakeTitleCandidate(contextText) {
  const text = String(contextText || "");
  const explicitTitle = text.match(/^(?:标题|题目)\s*[:：]\s*(.{2,160})$/mu)?.[1]?.trim() || "";
  if (explicitTitle) return explicitTitle;
  const bracket = text.match(/【([^】\n]{2,160})】/)?.[1]?.trim() || "";
  if (bracket) {
    const withoutCommunitySuffix = bracket.split(/\s+\|\s+小红书(?:\s+-.*)?$/)[0].trim();
    const withoutAuthorSuffix = withoutCommunitySuffix
      .replace(/\s+-\s+[^|]{1,40}\s*$/u, "")
      .trim();
    return (withoutAuthorSuffix || withoutCommunitySuffix).slice(0, 160);
  }

  const withoutUrls = text.replace(urlPattern, " ");
  const line = withoutUrls
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => (
      item.length >= 4
      && !/^(?:点击链接|复制口令|打开小红书|查看Ta的主页|\d+\s*$)/u.test(item)
      && !/^(?:来源|作者|标题)\s*[:：]\s*$/u.test(item)
    ));
  return String(line || "").slice(0, 160);
}

export function intakeAuthorCandidate(contextText) {
  const text = String(contextText || "");
  const mention = text.match(/@([^\s@，。；;|【】]{1,40})/u)?.[1]?.trim() || "";
  if (mention) return mention;
  const xhsShareAuthor = text.match(/【[^】\n]+?\s+-\s+([^|\n]{1,40})\s*\|\s*小红书/u)?.[1]?.trim() || "";
  if (xhsShareAuthor) return xhsShareAuthor;
  return text.match(/^(?:作者|账号|博主)\s*[:：]\s*(.{1,40})$/mu)?.[1]?.trim() || "";
}

function itemFromContext(url, contextText, ordinal) {
  const identityKey = intakeUrlIdentity(url);
  return {
    ordinal,
    url,
    identityKey,
    contextText: String(contextText || url).trim().slice(0, 12000),
    titleCandidate: intakeTitleCandidate(contextText),
    authorCandidate: intakeAuthorCandidate(contextText),
    platformHint: isXiaohongshuHost(hostnameOf(url)) || isXhsShortHost(hostnameOf(url))
      ? "xiaohongshu"
      : "other"
  };
}

export function parseBatchIntakeText(text, options = {}) {
  const maxItems = Math.max(1, Math.min(100, Number(options.maxItems) || 50));
  const normalized = String(text || "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];

  const items = [];
  const blocks = normalized.split(/\n[ \t]*\n+/);
  for (const block of blocks) {
    const lineMatches = scanUrls(block);
    if (lineMatches.length <= 1) {
      if (lineMatches[0]) items.push(itemFromContext(lineMatches[0].url, block, items.length + 1));
      continue;
    }

    let pendingContext = [];
    for (const line of block.split("\n")) {
      const urlsInLine = scanUrls(line);
      if (!urlsInLine.length) {
        if (line.trim()) pendingContext.push(line.trim());
        continue;
      }
      const contextText = [...pendingContext, line.trim()].filter(Boolean).join("\n");
      for (const match of urlsInLine) {
        items.push(itemFromContext(match.url, contextText, items.length + 1));
      }
      pendingContext = [];
    }
  }

  const seen = new Set();
  return items
    .filter((item) => {
      const key = item.identityKey || item.url;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, maxItems)
    .map((item, index) => ({ ...item, ordinal: index + 1 }));
}

export function intakeStatusFromClassification(classification) {
  if (!classification?.ok) {
    return classification?.detectedType === "xhs-short-link-unresolved"
      ? "needs-browser"
      : "blocked";
  }
  if (classification.existingRecord) return "duplicate";
  if (classification.detectedType === "xhs-profile") return "registered";
  if (classification.detectedType === "xhs-note") return "captured";
  return "registered";
}

export function batchIntakeNextAction(summary = {}) {
  const failed = Number(summary.failed || 0);
  const needsReview = Number(summary.blocked || 0) + Number(summary["needs-browser"] || 0);
  const captured = Number(summary.captured || 0);
  const registered = Number(summary.registered || 0);
  const duplicate = Number(summary.duplicate || 0);

  if (failed > 0) return "修正失败条目后重新投递";
  if (needsReview > 0) return "打开队列处理浏览器补采或访问阻断";
  if (captured > 0) return "到 Inbox 选择内容补采详情并生成逐字稿";
  if (registered > 0) return "到对标账号区打开主页，读取目标范围";
  if (duplicate > 0) return `${duplicate} 条内容已存在，可直接打开已有记录继续处理`;
  return "查看本次批次明细";
}
