import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const allowedMediaDomains = [
  "xiaohongshu.com",
  "xhscdn.com",
  "xhscdn.net",
  "bilibili.com",
  "bilivideo.com",
  "hdslb.com",
  "douyin.com",
  "douyinpic.com",
  "douyinvod.com",
  "byteimg.com",
  "bytedance.com",
  "weixin.qq.com",
  "qpic.cn",
  "gtimg.com",
  "twimg.com",
  "ytimg.com",
  "ggpht.com",
  "googleusercontent.com"
];

const imageExtensions = new Map([
  ["image/avif", ".avif"],
  ["image/gif", ".gif"],
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"]
]);

function hostMatches(hostname, domain) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function isAllowedPlatformMediaUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (!["http:", "https:"].includes(url.protocol)) return false;
    if (url.username || url.password) return false;
    const hostname = url.hostname.toLowerCase();
    return allowedMediaDomains.some((domain) => hostMatches(hostname, domain));
  } catch {
    return false;
  }
}

function xiaohongshuStableAsset(url) {
  if (!hostMatches(url.hostname.toLowerCase(), "xhscdn.com")
    && !hostMatches(url.hostname.toLowerCase(), "xhscdn.net")
    && !hostMatches(url.hostname.toLowerCase(), "xiaohongshu.com")) {
    return "";
  }

  const segments = url.pathname.split("/").filter(Boolean);
  const anchor = segments.findIndex((segment) => segment === "notes_pre_post" || segment === "spectrum");
  if (anchor >= 0 && segments[anchor + 1]) {
    return segments.slice(anchor, anchor + 2).join("/");
  }
  return segments.at(-1) || "";
}

export function stableXiaohongshuImageUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (!isAllowedPlatformMediaUrl(url.toString())) return "";
    if (hostMatches(url.hostname.toLowerCase(), "ci.xiaohongshu.com")) return url.toString();
    const asset = xiaohongshuStableAsset(url);
    if (!asset) return "";
    const withVariant = asset.includes("!") ? asset : `${asset}!nd_dft_wlteh_webp_3`;
    return new URL(withVariant, "https://ci.xiaohongshu.com/").toString();
  } catch {
    return "";
  }
}

export function platformMediaCandidates(value) {
  const source = String(value || "").trim();
  if (!isAllowedPlatformMediaUrl(source)) return [];
  const stable = stableXiaohongshuImageUrl(source);
  return [...new Set([stable, source].filter(isAllowedPlatformMediaUrl))];
}

function refererForMedia(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    if (hostMatches(hostname, "xiaohongshu.com") || hostMatches(hostname, "xhscdn.com") || hostMatches(hostname, "xhscdn.net")) {
      return "https://www.xiaohongshu.com/";
    }
    if (hostMatches(hostname, "bilibili.com") || hostMatches(hostname, "hdslb.com") || hostMatches(hostname, "bilivideo.com")) {
      return "https://www.bilibili.com/";
    }
    if (hostMatches(hostname, "douyin.com") || hostMatches(hostname, "douyinpic.com") || hostMatches(hostname, "douyinvod.com")) {
      return "https://www.douyin.com/";
    }
    if (hostMatches(hostname, "weixin.qq.com") || hostMatches(hostname, "qpic.cn")) {
      return "https://mp.weixin.qq.com/";
    }
  } catch {
    // The caller validates the URL before requesting media.
  }
  return "";
}

function mediaError(message, status = 502) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function readLimitedBody(response, maxBytes) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw mediaError("remote cover exceeds size limit", 413);
  }
  if (!response.body) return Buffer.alloc(0);

  const chunks = [];
  let received = 0;
  for await (const chunk of response.body) {
    received += chunk.length;
    if (received > maxBytes) throw mediaError("remote cover exceeds size limit", 413);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function readCacheEntry(cacheDir, key) {
  try {
    const metadataPath = path.join(cacheDir, `${key}.json`);
    const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
    if (!metadata?.filename || path.basename(metadata.filename) !== metadata.filename) return null;
    const content = await fs.readFile(path.join(cacheDir, metadata.filename));
    return { ...metadata, content, cache: "hit" };
  } catch {
    return null;
  }
}

async function writeCacheEntry(cacheDir, key, entry) {
  await fs.mkdir(cacheDir, { recursive: true });
  const extension = imageExtensions.get(entry.contentType) || ".image";
  const filename = `${key}${extension}`;
  const imagePath = path.join(cacheDir, filename);
  const imageTemp = `${imagePath}.${crypto.randomUUID()}.tmp`;
  const metadataPath = path.join(cacheDir, `${key}.json`);
  const metadataTemp = `${metadataPath}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(imageTemp, entry.content);
  await fs.rename(imageTemp, imagePath);
  await fs.writeFile(metadataTemp, JSON.stringify({
    sourceUrl: entry.sourceUrl,
    resolvedUrl: entry.resolvedUrl,
    contentType: entry.contentType,
    bytes: entry.content.length,
    cachedAt: new Date().toISOString(),
    filename
  }, null, 2), "utf8");
  await fs.rename(metadataTemp, metadataPath);
}

export function createPlatformMediaCache({
  cacheDir,
  fetchImpl = globalThis.fetch,
  timeoutMs = 12_000,
  maxBytes = 12 * 1024 * 1024
}) {
  if (!cacheDir) throw new Error("cacheDir is required");
  if (typeof fetchImpl !== "function") throw new Error("fetch implementation is required");
  const inflight = new Map();

  async function fetchValidatedMedia(startUrl) {
    let currentUrl = startUrl;
    for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
      const response = await fetchImpl(currentUrl, {
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          accept: "image/avif,image/webp,image/apng,image/png,image/jpeg,image/gif,image/*;q=0.8",
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
          ...(refererForMedia(currentUrl) ? { referer: refererForMedia(currentUrl) } : {})
        }
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) {
        return { response, resolvedUrl: currentUrl };
      }
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => {});
      if (!location) throw mediaError("media redirect has no location");
      const nextUrl = new URL(location, currentUrl).toString();
      if (!isAllowedPlatformMediaUrl(nextUrl)) {
        throw mediaError("media redirect left the approved platform hosts");
      }
      currentUrl = nextUrl;
    }
    throw mediaError("media redirect limit exceeded");
  }

  async function cacheCover(sourceUrl) {
    const candidates = platformMediaCandidates(sourceUrl);
    if (!candidates.length) throw mediaError("unsupported cover host", 400);

    const key = crypto.createHash("sha256").update(sourceUrl).digest("hex");
    const cached = await readCacheEntry(cacheDir, key);
    if (cached) return cached;

    const failures = [];
    for (const candidate of candidates) {
      try {
        const { response, resolvedUrl } = await fetchValidatedMedia(candidate);
        if (!response.ok) {
          failures.push(`${response.status} ${candidate}`);
          await response.body?.cancel().catch(() => {});
          continue;
        }
        const contentType = String(response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
        if (!imageExtensions.has(contentType)) {
          failures.push(`unsupported type ${contentType || "unknown"} ${candidate}`);
          await response.body?.cancel().catch(() => {});
          continue;
        }
        const content = await readLimitedBody(response, maxBytes);
        if (!content.length) {
          failures.push(`empty response ${candidate}`);
          continue;
        }
        const entry = {
          sourceUrl,
          resolvedUrl,
          contentType,
          content,
          cache: "miss"
        };
        await writeCacheEntry(cacheDir, key, entry);
        return entry;
      } catch (error) {
        failures.push(error.message);
      }
    }
    throw mediaError(`cover unavailable: ${failures.join(" | ")}`);
  }

  return {
    async get(value) {
      const sourceUrl = String(value || "").trim();
      const candidates = platformMediaCandidates(sourceUrl);
      if (!candidates.length) throw mediaError("unsupported cover host", 400);
      const key = crypto.createHash("sha256").update(sourceUrl).digest("hex");
      const cached = await readCacheEntry(cacheDir, key);
      if (cached) return cached;
      if (!inflight.has(key)) {
        inflight.set(key, cacheCover(sourceUrl).finally(() => inflight.delete(key)));
      }
      return inflight.get(key);
    }
  };
}
