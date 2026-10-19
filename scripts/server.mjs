import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appDir = path.join(root, "app");
const dataDir = path.join(root, "data");
const dataFile = process.env.DATA_FILE ? path.resolve(process.env.DATA_FILE) : path.join(dataDir, "workbench.json");
const dropDir = process.env.DROP_DIR ? path.resolve(process.env.DROP_DIR) : path.join(root, "drops");
const dropProcessedDir = path.join(dropDir, "processed");
const dropFailedDir = path.join(dropDir, "failed");
const port = Number(process.env.PORT || 5177);
const automationTickMs = Math.max(1000, Number(process.env.AUTOMATION_TICK_MS || 60000));
const dropScanMs = Math.max(1000, Number(process.env.DROP_SCAN_MS || 10000));
const automaticMethods = new Set(["public-rss", "public-page"]);
const dropExtensions = new Set([".json", ".md", ".txt"]);
const runningSourceIds = new Set();
let automationTickRunning = false;
let pipelineBusy = false;

const emptyState = () => ({
  version: 1,
  settings: {
    collectionTime: "08:40",
    automationEnabled: true,
    morningBriefEnabled: true,
    inboxTime: "09:00",
    inboxDailyLimit: 10,
    streakDefinition: ""
  },
  sources: [],
  signals: [],
  materials: [],
  topics: [],
  scripts: [],
  publications: [],
  reviews: [],
  collectionRuns: [],
  rawSnapshots: [],
  morningBriefs: [],
  frictionLog: []
});

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

async function readState() {
  try {
    const text = await fs.readFile(dataFile, "utf8");
    const parsed = JSON.parse(text);
    const state = { ...emptyState(), ...parsed, settings: { ...emptyState().settings, ...(parsed.settings || {}) } };
    refreshEngagementMetrics(state);
    prepareAutomationState(state);
    return state;
  } catch (error) {
    if (error.code === "ENOENT") return emptyState();
    throw error;
  }
}

async function writeState(state) {
  await fs.mkdir(dataDir, { recursive: true });
  const temp = `${dataFile}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(state, null, 2), "utf8");
  await fs.rename(temp, dataFile);
}

function id(prefix) {
  return `${prefix}-${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}`;
}

function now() {
  return new Date().toISOString();
}

function localDateKey(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function localMinuteOfDay(date = new Date()) {
  return date.getHours() * 60 + date.getMinutes();
}

function collectionSlot(value, from = new Date()) {
  const [hours, minutes] = String(value || "08:40").split(":").map(Number);
  const slot = new Date(from.getFullYear(), from.getMonth(), from.getDate(), hours || 0, minutes || 0, 0, 0);
  if (slot.getTime() <= from.getTime()) slot.setDate(slot.getDate() + 1);
  return slot;
}

function nextCollectionRun(source, collectionTime, from = new Date()) {
  const intervalDays = source.checkFrequency === "weekly" ? 7 : 1;
  const slot = collectionSlot(collectionTime || "08:40", from);
  slot.setDate(slot.getDate() + intervalDays - 1);
  return slot.toISOString();
}

function failureDelay(failureCount) {
  const fiveMinutes = 5 * 60 * 1000;
  const sixHours = 6 * 60 * 60 * 1000;
  return Math.min(fiveMinutes * 2 ** Math.max(0, failureCount - 1), sixHours);
}

function isScheduledSource(source) {
  return source.enabled !== false
    && source.checkFrequency !== "on-demand"
    && source.collectionMethod !== "research-only";
}

function prepareAutomationState(state) {
  for (const source of state.sources || []) {
    source.failureCount = Number(source.failureCount || 0);
    if (!isScheduledSource(source)) {
      source.nextRunAt = source.nextRunAt || "";
      source.automationStatus = source.enabled === false
        ? "disabled"
        : source.checkFrequency === "on-demand"
          ? "on-demand"
          : "research-only";
      continue;
    }

    if (!source.nextRunAt) {
      source.nextRunAt = collectionSlot(state.settings.collectionTime).toISOString();
    }
    if (source.automationStatus !== "retrying") {
      source.automationStatus = automaticMethods.has(source.collectionMethod) ? "scheduled" : "manual-required";
    }
  }
}

function isDue(source, timestamp = Date.now()) {
  return isScheduledSource(source) && Boolean(source.nextRunAt) && new Date(source.nextRunAt).getTime() <= timestamp;
}

function automationEnabled(state) {
  const envDisabled = ["false", "0", "off"].includes(String(process.env.AUTOMATION_ENABLED || "").toLowerCase());
  return !envDisabled && state.settings.automationEnabled !== false;
}

function automationTier(signal = {}) {
  if (signal.relativeMultiple === null || signal.relativeMultiple === undefined) return "needs-review";
  if (signal.relativeMultiple >= 3) return "high-potential";
  if (signal.relativeMultiple >= 1.5) return "worth-watching";
  return "normal";
}

function corsHeaders(request) {
  const origin = request.headers?.origin || "";
  const allowedOrigins = new Set([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    "https://www.xiaohongshu.com"
  ]);
  if (!origin || !allowedOrigins.has(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-allow-private-network": "true",
    "access-control-max-age": "86400",
    vary: "origin"
  };
}

function sendJson(response, status, payload, request = null) {
  const body = JSON.stringify(payload, null, 2);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...(request ? corsHeaders(request) : {})
  });
  response.end(body);
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function identityKeys(type, record = {}) {
  if (type === "sources") return [normalizeUrl(record.url) || record.id].filter(Boolean);
  if (type === "signals") return signalIdentityKeys(record);
  if (type === "materials") {
    const key = `${normalizeUrl(record.sourceUrl) || ""}||${String(record.excerpt || "").replace(/\s+/g, " ").trim()}`;
    return [key].filter(Boolean);
  }
  if (type === "topics") return [(record.title || "").trim().toLowerCase()].filter(Boolean);
  return [record.id].filter(Boolean);
}

function importRecords(state, type, records = []) {
  const existing = state[type] || [];
  const recordIndex = new Map(existing.map((record) => [record.id, record]));
  const keyIndex = new Map();
  for (const record of [...recordIndex.values()]) {
    for (const key of identityKeys(type, record)) {
      if (!keyIndex.has(key)) keyIndex.set(key, record.id);
    }
  }
  let added = 0;
  let merged = 0;
  for (const incoming of records) {
    if (!incoming || typeof incoming !== "object") continue;
    const incomingKeys = identityKeys(type, incoming).filter(Boolean);
    const matchedKey = incomingKeys.find((key) => keyIndex.has(key));
    const patch = Object.fromEntries(
      Object.entries(incoming).filter(([, value]) => value !== undefined && value !== null && value !== "")
    );
    if (matchedKey) {
      const currentId = keyIndex.get(matchedKey);
      const current = recordIndex.get(currentId);
      const mergedRecord = {
        ...current,
        ...patch,
        id: current.id,
        updatedAt: now()
      };
      recordIndex.set(current.id, mergedRecord);
      for (const key of identityKeys(type, mergedRecord)) keyIndex.set(key, current.id);
      merged += 1;
    } else {
      const record = {
        ...incoming,
        id: incoming.id || id(type.replace(/s$/, "").replace("-", "-")),
        createdAt: incoming.createdAt || now(),
        updatedAt: now()
      };
      recordIndex.set(record.id, record);
      for (const key of identityKeys(type, record)) keyIndex.set(key, record.id);
      added += 1;
    }
  }
  state[type] = [...recordIndex.values()];
  return { added, merged };
}

function normalizedTitle(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function normalizedDate(value = "") {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : String(value || "").trim();
}

function platformContentId(platform = "", value = "") {
  const url = String(value || "");
  const patterns = {
    xiaohongshu: /\/(?:explore|discovery\/item)\/([A-Za-z0-9]+)/,
    x: /\/status(?:es)?\/(\d+)/,
    douyin: /\/video\/(\d+)/,
    wechat: /\/s\/([A-Za-z0-9_-]+)/
  };
  const pattern = patterns[platform];
  return pattern ? (url.match(pattern)?.[1] || "") : "";
}

function signalIdentityKeys(record = {}) {
  const url = canonicalSignalUrl(record.url);
  const platform = String(record.platform || "").trim().toLowerCase() || "other";
  const contentId = platformContentId(platform, url || record.url || "");
  const title = normalizedTitle(record.title);
  const author = normalizedTitle(record.author);
  const publishedAt = normalizedDate(record.publishedAt);
  const keys = [];
  if (url) keys.push(`url:${url}`);
  if (contentId) keys.push(`content:${platform}:${contentId}`);
  if (title && author) keys.push(`title-author:${platform}:${author}:${title}`);
  if (title && publishedAt) keys.push(`title-date:${platform}:${title}:${publishedAt}`);
  const parts = [
    platform,
    author,
    title,
    publishedAt
  ];
  if (parts.some(Boolean)) keys.push(`fallback:${parts.join("||")}`);
  return keys;
}

function signalIdentityKey(record = {}) {
  return signalIdentityKeys(record)[0] || "";
}

function hasSignal(state, candidate) {
  const keys = new Set(signalIdentityKeys(candidate));
  return (state.signals || []).some((signal) => signalIdentityKeys(signal).some((key) => keys.has(key)));
}

function parseCount(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const match = String(value ?? "").trim().match(/^([\d,.]+)\s*(万|亿|[kK])?\+?$/);
  if (!match) return null;
  const base = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(base)) return null;
  const multiplier = match[2] === "亿" ? 100000000 : match[2] === "万" ? 10000 : match[2] ? 1000 : 1;
  return Math.round(base * multiplier);
}

function normalizeUrl(value) {
  try {
    const url = new URL(String(value).trim());
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function canonicalSignalUrl(value) {
  const normalized = normalizeUrl(value);
  if (!normalized) return "";
  const url = new URL(normalized);
  const canonicalParams = new URLSearchParams();
  for (const key of [...url.searchParams.keys()].sort()) {
    if (/^utm_/i.test(key)) continue;
    for (const paramValue of url.searchParams.getAll(key)) {
      canonicalParams.append(key, paramValue);
    }
  }
  const query = canonicalParams.toString();
  url.search = query ? `?${query}` : "";
  return url.toString();
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
  return Number(value.toFixed(2));
}

function refreshEngagementMetrics(state) {
  const groups = new Map();
  for (const signal of state.signals || []) {
    const engagement = parseCount(signal.engagement);
    if (engagement !== null) signal.engagement = engagement;
    if (!signal.sourceId) continue;
    if (!groups.has(signal.sourceId)) groups.set(signal.sourceId, []);
    groups.get(signal.sourceId).push(signal);
  }

  for (const [sourceId, signals] of groups) {
    const source = (state.sources || []).find((item) => item.id === sourceId);
    if (!source) continue;
    const samples = signals
      .map((signal) => signal.engagement)
      .filter((value) => Number.isFinite(value) && value > 0);
    source.engagementSampleCount = samples.length;

    let authorMedian = samples.length >= 3 ? median(samples) : null;
    if (authorMedian === null && Number.isFinite(source.authorMedianEngagement) && source.authorMedianEngagement > 0) {
      authorMedian = source.authorMedianEngagement;
    }
    if (authorMedian === null) {
      source.authorMedianEngagement = null;
      source.engagementSampleUpdatedAt = "";
      for (const signal of signals) {
        signal.authorMedianEngagement = null;
        signal.relativeMultiple = null;
      }
      continue;
    }

    source.authorMedianEngagement = authorMedian;
    source.engagementSampleUpdatedAt = samples.length >= 3 ? now() : "";
    for (const signal of signals) {
      signal.authorMedianEngagement = authorMedian;
      signal.relativeMultiple = Number.isFinite(signal.engagement)
        ? Number((signal.engagement / authorMedian).toFixed(2))
        : null;
      signal.automationTier = automationTier(signal);
    }
  }
}

function signalPriority(signal = {}) {
  const multiple = Number(signal.relativeMultiple);
  const engagement = Number(signal.engagement);
  const time = Math.max(
    new Date(signal.publishedAt || 0).getTime() || 0,
    new Date(signal.capturedAt || 0).getTime() || 0
  );
  return [
    Number.isFinite(multiple) ? multiple : -1,
    Number.isFinite(engagement) ? engagement : -1,
    time
  ];
}

function compareSignals(left, right) {
  const leftPriority = signalPriority(left);
  const rightPriority = signalPriority(right);
  for (let index = 0; index < leftPriority.length; index += 1) {
    if (leftPriority[index] !== rightPriority[index]) return rightPriority[index] - leftPriority[index];
  }
  return String(left.title || "").localeCompare(String(right.title || ""), "zh-CN");
}

function buildMorningBrief(state) {
  const timestamp = new Date();
  const pending = (state.signals || []).filter((signal) => signal.disposition === "inbox");
  const topSignals = [...pending].sort(compareSignals).slice(0, 5);
  const manualSources = (state.sources || []).filter((source) => source.automationStatus === "manual-required");
  const retryingSources = (state.sources || []).filter((source) => source.automationStatus === "retrying");
  const nextActions = [];

  if (topSignals.length) nextActions.push(`先看 ${Math.min(topSignals.length, 3)} 条优先信号`);
  if (manualSources.length) nextActions.push(`处理 ${manualSources.length} 个待人工账号`);
  if (retryingSources.length) nextActions.push(`复核 ${retryingSources.length} 个失败重试账号`);
  if (!nextActions.length) nextActions.push("采集链路稳定，直接进入生产块");

  return {
    id: `brief-${localDateKey(timestamp)}`,
    date: localDateKey(timestamp),
    generatedAt: timestamp.toISOString(),
    inboxCount: pending.length,
    highPotentialCount: pending.filter((signal) => signal.automationTier === "high-potential").length,
    worthWatchingCount: pending.filter((signal) => signal.automationTier === "worth-watching").length,
    manualActionCount: manualSources.length,
    retryingCount: retryingSources.length,
    topicCount: (state.topics || []).filter((topic) => !["published", "reviewed"].includes(topic.stage)).length,
    topSignalIds: topSignals.map((signal) => signal.id),
    nextActions
  };
}

function refreshMorningBrief(state) {
  if (state.settings.morningBriefEnabled === false) return false;
  const timestamp = new Date();
  const [hours, minutes] = String(state.settings.inboxTime || "09:00").split(":").map(Number);
  if (localMinuteOfDay(timestamp) < (hours || 0) * 60 + (minutes || 0)) return false;

  const briefs = state.morningBriefs || [];
  const brief = buildMorningBrief(state);
  const index = briefs.findIndex((item) => item.date === brief.date);
  if (index >= 0) {
    const current = briefs[index];
    const unchanged = JSON.stringify({ ...current, generatedAt: "" }) === JSON.stringify({ ...brief, generatedAt: "" });
    if (unchanged) return false;
    briefs[index] = brief;
  } else {
    briefs.unshift(brief);
  }
  state.morningBriefs = briefs.slice(0, 30);
  return true;
}

function parseFeed(xml) {
  const decode = (value = "") => value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

  const itemBlocks = [
    ...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi),
    ...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)
  ].map((match) => match[0]);

  const pick = (block, tag) => {
    const match = block.match(new RegExp(`<(?:[^:>:]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[^:>:]+:)?${tag}>`, "i"));
    return match ? decode(match[1]) : "";
  };

  return itemBlocks.map((block) => {
    const link = pick(block, "link") || (block.match(/<link\b[^>]*href=["']([^"']+)["']/i)?.[1] || "");
    const contentText = pick(block, "content:encoded") || pick(block, "description") || pick(block, "summary");
    return {
      title: pick(block, "title"),
      link,
      publishedAt: pick(block, "pubDate") || pick(block, "published") || pick(block, "updated"),
      contentText,
      dataPointCandidates: extractDataPointCandidates([contentText])
    };
  }).filter((item) => item.link);
}

function decodeHtmlText(value = "") {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function htmlAttribute(tag = "", name = "") {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return decodeHtmlText(match?.[2] || match?.[3] || match?.[4] || "");
}

function htmlTagText(html, tag) {
  return decodeHtmlText(html.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1] || "");
}

function readableHtmlText(fragment = "") {
  const withoutInactiveBlocks = String(fragment || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg|iframe|nav|header|footer|aside|form)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  const text = decodeHtmlText(
    withoutInactiveBlocks
      .replace(/<br\b[^>]*>/gi, "\n")
      .replace(/<\/(?:p|div|section|article|li|h[1-6]|blockquote|figcaption)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  );
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, 100000);
}

function extractArticleText(html) {
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] || html;
  const blocks = [
    ...body.matchAll(/<article\b[^>]*>[\s\S]*?<\/article>/gi),
    ...body.matchAll(/<main\b[^>]*>[\s\S]*?<\/main>/gi)
  ].map((match) => readableHtmlText(match[0]));
  const preferred = blocks.filter((text) => text.length >= 120).sort((a, b) => b.length - a.length)[0];
  const pageText = readableHtmlText(body);
  return preferred && preferred.length >= 120 ? preferred : pageText;
}

function addImageDescription(images, url, description) {
  const imageUrl = normalizeUrl(url);
  const text = decodeHtmlText(String(description || "")).replace(/\s+/g, " ").trim();
  if (!imageUrl || text.length < 2 || text.length > 300 || /^(?:image|photo|img|picture|logo|icon)$/i.test(text)) return;
  const key = `${imageUrl}||${text.toLowerCase()}`;
  if (images.has(key)) return;
  images.set(key, { url: imageUrl, description: text });
}

function extractImageDescriptions(html, pageUrl, meta = new Map()) {
  const images = new Map();
  addImageDescription(images, absoluteUrl(meta.get("og:image") || meta.get("twitter:image"), pageUrl), meta.get("og:image:alt") || meta.get("twitter:image:alt"));

  for (const figure of html.match(/<figure\b[^>]*>[\s\S]*?<\/figure>/gi) || []) {
    const imageTag = figure.match(/<img\b[^>]*>/i)?.[0] || "";
    const imageUrl = absoluteUrl(htmlAttribute(imageTag, "src") || htmlAttribute(imageTag, "data-src"), pageUrl);
    const caption = figure.match(/<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i)?.[1] || "";
    addImageDescription(images, imageUrl, readableHtmlText(caption));
  }

  for (const tag of html.match(/<img\b[^>]*>/gi) || []) {
    const imageUrl = absoluteUrl(htmlAttribute(tag, "src") || htmlAttribute(tag, "data-src"), pageUrl);
    const description = htmlAttribute(tag, "alt") || htmlAttribute(tag, "title") || htmlAttribute(tag, "aria-label");
    addImageDescription(images, imageUrl, description);
  }
  return [...images.values()].slice(0, 20);
}

function extractDataPointCandidates(texts = []) {
  const candidates = new Map();
  const strongNumber = /(?:\d+(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)\s*(?:%|％|pp|个百分点|万|亿|千元|万元|亿元|美元|元|倍|[xX])/;
  const dataWord = /(增长|下降|上涨|下跌|同比|环比|超过|达到|平均|约|占比|渗透率|收入|利润|用户|流量|成本|毛利|市场规模|中位数)/;
  for (const source of texts) {
    const text = String(source || "").trim();
    if (!text) continue;
    for (const sentence of text.match(/[^\n。！？!?；;]+[。！？!?；;]?/g) || []) {
      const value = sentence.replace(/\s+/g, " ").trim();
      const isCandidate = (strongNumber.test(value) && value.length <= 400) || (dataWord.test(value) && /\d/.test(value) && value.length <= 400);
      if (!isCandidate) continue;
      const key = value.toLowerCase();
      if (!candidates.has(key)) candidates.set(key, value);
      if (candidates.size >= 30) return [...candidates.values()];
    }
  }
  return [...candidates.values()];
}

function collectJsonLdArticles(html) {
  const blocks = html.match(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  const articles = [];
  const visit = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== "object") return;
    const type = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]].filter(Boolean);
    if (type.some((item) => String(item).toLowerCase().includes("article"))) {
      articles.push(value);
    }
    Object.values(value).forEach(visit);
  };

  for (const block of blocks) {
    try {
      visit(JSON.parse(block.replace(/^<script\b[^>]*>/i, "").replace(/<\/script>$/i, "")));
    } catch {
      // A malformed third-party structured-data block does not invalidate the whole page.
    }
  }
  return articles;
}

function absoluteUrl(value, baseUrl) {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return "";
  }
}

function parsePublicPage(html, pageUrl) {
  const meta = new Map();
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const name = htmlAttribute(tag, "property") || htmlAttribute(tag, "name");
    const content = htmlAttribute(tag, "content");
    if (name && content && !meta.has(name)) meta.set(name, content);
  }
  const canonicalTag = (html.match(/<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*>/i) || [])[0] || "";
  const canonicalUrl = canonicalTag ? absoluteUrl(htmlAttribute(canonicalTag, "href"), pageUrl) : pageUrl;
  const title = meta.get("og:title") || meta.get("twitter:title") || htmlTagText(html, "title");
  const article = collectJsonLdArticles(html)[0] || {};
  const jsonLdAuthor = Array.isArray(article.author) ? article.author[0] : article.author;
  const author = meta.get("author")
    || meta.get("article:author")
    || (typeof jsonLdAuthor === "string" ? jsonLdAuthor : jsonLdAuthor?.name)
    || "";
  const publishedAt = meta.get("article:published_time") || meta.get("date") || article.datePublished || "";
  const pageType = String(meta.get("og:type") || "").toLowerCase();
  const contentText = readableHtmlText(article.articleBody || "") || extractArticleText(html);
  const description = meta.get("description") || meta.get("og:description") || "";
  const imageDescriptions = extractImageDescriptions(html, pageUrl, meta);
  const dataPointCandidates = extractDataPointCandidates([article.articleBody, contentText, description]);

  if (title && (pageType.includes("article") || publishedAt || article["@type"])) {
    return [{
      title,
      url: absoluteUrl(meta.get("og:url") || canonicalUrl, pageUrl),
      author,
      publishedAt,
      description,
      contentText,
      imageDescriptions,
      dataPointCandidates
    }];
  }

  let host = "";
  try {
    host = new URL(pageUrl).hostname;
  } catch {
    host = "";
  }
  const links = new Map();
  for (const tag of html.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) || []) {
    const href = absoluteUrl(htmlAttribute(tag, "href"), pageUrl);
    const text = decodeHtmlText(tag.replace(/<[^>]+>/g, " "));
    if (!href || !text || text.length < 4) continue;
    let linkHost = "";
    try {
      linkHost = new URL(href).hostname;
    } catch {
      linkHost = "";
    }
    if (host && linkHost && linkHost !== host) continue;
    if (/\?(utm_|ref|spm)/i.test(href) || /\/(login|signup|about|contact)(\/|$)/i.test(href)) continue;
    const key = canonicalSignalUrl(href);
    if (key && !links.has(key)) links.set(key, { title: text, url: href, author: "", publishedAt: "", description: "" });
  }
  return [...links.values()].slice(0, 100);
}

async function runCollection(state, sourceId, trigger = "manual") {
  const source = state.sources.find((item) => item.id === sourceId);
  if (!source) throw new Error("source not found");
  const scheduledRun = trigger === "automatic" || trigger === "force";

  const run = {
    id: id("run"),
    sourceId: source.id,
    status: "running",
    trigger,
    startedAt: now(),
    finishedAt: "",
    found: 0,
    created: 0,
    failureReason: "",
    nextAction: ""
  };
  state.collectionRuns.unshift(run);
  source.automationStatus = isScheduledSource(source)
    ? (automaticMethods.has(source.collectionMethod) ? "running" : "manual-required")
    : "on-demand";

  try {
    if (source.collectionMethod === "public-rss") {
      const response = await fetch(source.url, {
        headers: { "user-agent": "PersonalContentWorkbench/0.1 single-user" },
        redirect: "follow"
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const xml = await response.text();
      state.rawSnapshots.unshift({
        id: id("snapshot"),
        runId: run.id,
        sourceId: source.id,
        url: source.url,
        capturedAt: now(),
        format: "rss",
        content: xml.slice(0, 500000)
      });
      const items = parseFeed(xml);
      run.found = items.length;
      run.duplicates = 0;
      for (const item of items) {
        const candidate = {
          platform: source.platform,
          author: source.account || source.name,
          title: item.title,
          url: item.link,
          publishedAt: item.publishedAt,
          contentText: item.contentText || "",
          dataPointCandidates: item.dataPointCandidates || []
        };
        if (hasSignal(state, candidate)) {
          run.duplicates += 1;
          continue;
        }
        state.signals.unshift({
          id: id("signal"),
          sourceId: source.id,
          collectionRunId: run.id,
          platform: source.platform,
          author: source.account || source.name,
          url: item.link,
          title: item.title,
          publishedAt: item.publishedAt,
          capturedAt: now(),
          engagement: null,
          authorMedianEngagement: source.authorMedianEngagement ?? null,
          relativeMultiple: null,
          seen: false,
          disposition: "inbox",
          note: "RSS 采集候选，互动数据待确认",
          contentText: item.contentText || "",
          imageDescriptions: [],
          dataPointCandidates: item.dataPointCandidates || [],
          createdAt: now(),
          updatedAt: now()
        });
        run.created += 1;
      }
      run.status = run.created > 0 ? "ok" : "ok-no-new";
      run.nextAction = run.created > 0 ? "到 Inbox 分流" : "无新内容，保持监控";
    } else if (source.collectionMethod === "public-page") {
      const response = await fetch(source.url, {
        headers: { "user-agent": "PersonalContentWorkbench/0.1 single-user" },
        redirect: "follow"
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      state.rawSnapshots.unshift({
        id: id("snapshot"),
        runId: run.id,
        sourceId: source.id,
        url: source.url,
        capturedAt: now(),
        format: "html",
        content: html.slice(0, 500000)
      });
      const items = parsePublicPage(html, response.url || source.url);
      run.found = items.length;
      run.duplicates = 0;
      for (const item of items) {
        const candidate = {
          platform: source.platform,
          author: item.author || source.account || source.name,
          title: item.title,
          url: item.url,
          publishedAt: item.publishedAt,
          contentText: item.contentText || "",
          imageDescriptions: item.imageDescriptions || [],
          dataPointCandidates: item.dataPointCandidates || []
        };
        if (hasSignal(state, candidate)) {
          run.duplicates += 1;
          continue;
        }
        state.signals.unshift({
          id: id("signal"),
          sourceId: source.id,
          collectionRunId: run.id,
          ...candidate,
          capturedAt: now(),
          engagement: null,
          authorMedianEngagement: source.authorMedianEngagement ?? null,
          relativeMultiple: null,
          automationTier: "needs-review",
          seen: false,
          disposition: "inbox",
          note: item.description || "公开页面自动解析",
          contentText: item.contentText || "",
          imageDescriptions: item.imageDescriptions || [],
          dataPointCandidates: item.dataPointCandidates || [],
          createdAt: now(),
          updatedAt: now()
        });
        run.created += 1;
      }
      run.status = run.created > 0 ? "ok" : "ok-no-new";
      run.nextAction = run.created > 0 ? "到 Inbox 分流" : "页面无新增信号，原始快照已保留";
    } else {
      run.status = "blocked";
      run.failureReason = `${source.collectionMethod} 需要人工动作或专用 adapter`;
      run.nextAction = source.collectionMethod === "manual"
        ? "用快速收集或 JSON 导入"
        : "导出文件后导入，或补充浏览器辅助 adapter";
    }
  } catch (error) {
    run.status = "failed";
    run.failureReason = error.message;
    run.nextAction = "检查链接、平台限制或改用浏览器辅助导入";
  } finally {
    run.finishedAt = now();
    source.lastRunStatus = run.status;
    source.lastRunAt = run.finishedAt;
    source.lastRunTrigger = trigger;
    source.lastCollectionError = run.status === "failed" ? run.failureReason : "";

    if (scheduledRun && isScheduledSource(source)) {
      const finishedAt = new Date(run.finishedAt);
      if (run.status === "failed") {
        source.failureCount = Number(source.failureCount || 0) + 1;
        source.nextRunAt = new Date(finishedAt.getTime() + failureDelay(source.failureCount)).toISOString();
        source.automationStatus = "retrying";
      } else {
        source.failureCount = 0;
        source.lastAutomaticRunAt = run.finishedAt;
        source.nextRunAt = nextCollectionRun(source, state.settings.collectionTime, finishedAt);
        source.automationStatus = run.status === "blocked" ? "manual-required" : "scheduled";
      }
    }
  }

  return run;
}

async function collectWithLock(state, sourceId, trigger = "manual") {
  if (runningSourceIds.has(sourceId)) return null;
  runningSourceIds.add(sourceId);
  try {
    return await runCollection(state, sourceId, trigger);
  } finally {
    runningSourceIds.delete(sourceId);
  }
}

async function runAutomationTick(force = false) {
  if (pipelineBusy) {
    return { ok: true, skipped: true, reason: "another automation pipeline is running" };
  }
  automationTickRunning = true;
  pipelineBusy = true;

  try {
    const state = await readState();
    if (!automationEnabled(state)) {
      return { ok: true, skipped: true, reason: "automation is disabled" };
    }

    const candidates = state.sources.filter((source) => (force ? isScheduledSource(source) : isDue(source)));
    const results = [];
    for (const source of candidates) {
      if (runningSourceIds.has(source.id)) {
        results.push({ sourceId: source.id, source: source.name || source.account || source.id, status: "skipped", reason: "already running" });
        continue;
      }

      const run = await collectWithLock(state, source.id, force ? "force" : "automatic");
      if (run) {
        results.push({
          sourceId: source.id,
          source: source.name || source.account || source.id,
          status: run.status,
          found: run.found,
          created: run.created,
          failureReason: run.failureReason,
          nextAction: run.nextAction
        });
      }
    }

    const briefChanged = refreshMorningBrief(state);
    if (results.some((item) => item.status !== "skipped") || briefChanged) {
      refreshEngagementMetrics(state);
      await writeState(state);
    }

    return {
      ok: true,
      ranAt: now(),
      mode: force ? "force" : "scheduled",
      total: results.length,
      okCount: results.filter((item) => String(item.status).startsWith("ok")).length,
      blocked: results.filter((item) => item.status === "blocked").length,
      failed: results.filter((item) => item.status === "failed").length,
      skipped: results.filter((item) => item.status === "skipped").length,
      results
    };
  } finally {
    automationTickRunning = false;
    pipelineBusy = false;
  }
}

function importBrowserCapture(state, sourceId, items) {
  const source = state.sources.find((item) => item.id === sourceId);
  if (!source) throw new Error("source not found");
  if (source.collectionMethod !== "browser-assisted") {
    throw new Error("only browser-assisted sources can use browser capture");
  }
  if (!Array.isArray(items) || items.length === 0) throw new Error("items must be a non-empty array");

  const seen = new Set((state.signals || []).map((signal) => signalIdentityKey(signal)));
  const candidates = [];
  const duplicateInputs = new Set();
  for (const item of items) {
    if (!item || typeof item !== "object") throw new Error("each item must be an object");
    const url = normalizeUrl(item.url);
    if (!url) throw new Error("each item needs a valid URL");
    const key = canonicalSignalUrl(url);
    if (seen.has(key) || duplicateInputs.has(key)) continue;
    duplicateInputs.add(key);
    candidates.push({ ...item, url });
  }

  const run = {
    id: id("run"),
    sourceId: source.id,
    status: "running",
    startedAt: now(),
    finishedAt: "",
    found: items.length,
    created: 0,
    duplicates: items.length - candidates.length,
    failureReason: "",
    nextAction: ""
  };
  state.collectionRuns.unshift(run);
  state.rawSnapshots.unshift({
    id: id("snapshot"),
    runId: run.id,
    sourceId: source.id,
    url: source.url,
    capturedAt: now(),
    format: "browser-assisted",
    content: JSON.stringify(items, null, 2).slice(0, 500000)
  });

  for (const item of candidates) {
    const engagement = parseCount(item.engagement);
    state.signals.unshift({
      id: id("signal"),
      sourceId: source.id,
      collectionRunId: run.id,
      platform: source.platform,
      author: source.account || source.name,
      url: item.url,
      title: String(item.title ?? "").trim(),
      publishedAt: item.publishedAt || "",
      capturedAt: now(),
      engagement,
      authorMedianEngagement: source.authorMedianEngagement ?? null,
      relativeMultiple: engagement !== null && source.authorMedianEngagement
        ? Number((engagement / source.authorMedianEngagement).toFixed(2))
        : null,
      seen: false,
      disposition: "inbox",
      note: "浏览器辅助采集，数据来自人工确认的可见列表",
      createdAt: now(),
      updatedAt: now()
    });
    run.created += 1;
  }

  run.status = run.created > 0 ? "ok" : "ok-no-new";
  run.finishedAt = now();
  run.nextAction = run.created > 0 ? "到 Inbox 分流" : "无新内容，保持监控";
  source.lastRunStatus = run.status;
  source.lastRunAt = run.finishedAt;
  refreshEngagementMetrics(state);
  return run;
}

function parseDropFile(fileName, text) {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === ".json") {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return {
        context: {},
        signals: parsed.filter((item) => item && typeof item === "object" && item.url),
        materials: parsed.filter((item) => item && typeof item === "object" && item.excerpt && !item.url)
      };
    }
    if (!parsed || typeof parsed !== "object") throw new Error("JSON must be an array or object");
    return {
      context: parsed,
      signals: Array.isArray(parsed.signals) ? parsed.signals : parsed.url ? [parsed] : [],
      materials: Array.isArray(parsed.materials) ? parsed.materials : parsed.excerpt ? [parsed] : []
    };
  }

  if (!extension || extension === ".md" || extension === ".txt") {
    const lines = text.split(/\r?\n/);
    const metadata = {};
    const bodyLines = [];
    for (const line of lines) {
      const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
      if (match && bodyLines.length === 0) {
        metadata[match[1].toLowerCase()] = match[2].trim();
        continue;
      }
      bodyLines.push(line);
    }

    let body = bodyLines.join("\n").trim();
    let title = metadata.title || "";
    const heading = body.match(/^#\s+(.+)$/m);
    if (heading) {
      title = title || heading[1].trim();
      body = body.replace(heading[0], "").trim();
    }
    const url = metadata.url || metadata.sourceurl || body.match(/https?:\/\/[^\s)]+/)?.[0] || "";
    const kind = String(metadata.kind || "").toLowerCase();
    const type = String(metadata.type || "").toLowerCase();
    const materialTypes = new Set(["opinion", "case", "data", "quote", "hot-comment", "counter-example", "lead"]);
    const context = {
      sourceId: metadata.sourceid || "",
      platform: metadata.platform || "",
      author: metadata.author || ""
    };

    if (kind === "material" || (!kind && !url && body)) {
      return {
        context,
        signals: [],
        materials: [{
          ...metadata,
          type: materialTypes.has(type) ? type : "opinion",
          possibleUse: metadata.possibleuse || metadata.use || "evidence",
          sourceUrl: url,
          excerpt: body
        }]
      };
    }

    if (!url) throw new Error("text drop needs url, sourceUrl, or kind: material");
    return {
      context,
      signals: [{
        title,
        url,
        engagement: metadata.engagement || null,
        author: metadata.author || "",
        platform: metadata.platform || "",
        publishedAt: metadata.publishedat || "",
        note: body ? "本地文本信号，正文已保存" : metadata.note || "",
        contentText: body,
        imageDescriptions: [],
        dataPointCandidates: extractDataPointCandidates([body])
      }],
      materials: []
    };
  }

  throw new Error("unsupported drop file type");
}

function platformFromUrl(value = "") {
  const host = (() => {
    try {
      return new URL(value).hostname.toLowerCase();
    } catch {
      return "";
    }
  })();
  if (host.includes("xiaohongshu")) return "xiaohongshu";
  if (host.includes("douyin")) return "douyin";
  if (host.includes("x.com") || host.includes("twitter.com")) return "x";
  if (host.includes("weixin.qq.com") || host.includes("mp.weixin.qq.com")) return "wechat";
  return "other";
}

function sourceForUrl(state, value = "") {
  let host = "";
  try {
    host = new URL(value).hostname.toLowerCase();
  } catch {
    host = "";
  }
  if (!host) return null;
  return (state.sources || []).find((source) => {
    try {
      return new URL(source.url).hostname.toLowerCase() === host;
    } catch {
      return false;
    }
  }) || null;
}

function parseLooseCapture(state, text) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return parseDropFile("capture.json", trimmed);
  }

  const lines = trimmed.split(/\r?\n/);
  const metadata = {};
  const bodyLines = [];
  for (const line of lines) {
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (match && bodyLines.length === 0) {
      metadata[match[1].toLowerCase()] = match[2].trim();
      continue;
    }
    bodyLines.push(line);
  }

  const urls = [...trimmed.matchAll(/https?:\/\/[^\s<>"')]+/g)].map((match) => match[0]);
  const primaryUrl = metadata.url || metadata.sourceurl || urls[0] || "";
  const source = (state.sources || []).find((item) => item.id === (metadata.sourceid || "")) || sourceForUrl(state, primaryUrl);
  const platform = metadata.platform || source?.platform || platformFromUrl(primaryUrl);
  const contentLines = bodyLines
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^https?:\/\//.test(line));
  const titleLine = contentLines.find((line) => line.length >= 4 && !/^(?:赞|点赞|喜欢|评论|转发|收藏|阅读|发布时间)\b/.test(line));
  const title = metadata.title
    || (titleLine?.match(/^(?:标题|题目)\s*[:：]\s*(.+)$/)?.[1] || "")
    || titleLine
    || "";
  const engagementValue = trimmed.match(/(?:赞|点赞|喜欢|liked?)\s*[:：]?\s*([\d,.]+\s*(?:万|亿|[kK])?\+?)/i)?.[1]
    || metadata.engagement
    || null;
  const noteLines = contentLines.filter((line) => line !== title);
  const signals = urls.length || primaryUrl
    ? [{
        sourceId: source?.id || metadata.sourceId || "",
        platform,
        author: metadata.author || source?.account || source?.name || "",
        title,
        url: primaryUrl,
        engagement: parseCount(engagementValue),
        publishedAt: metadata.publishedat || metadata.date || "",
        note: noteLines.length ? "快速粘贴文本，正文已保存" : metadata.note || "快速粘贴自动解析",
        contentText: noteLines.join("\n"),
        imageDescriptions: [],
        dataPointCandidates: extractDataPointCandidates([noteLines.join("\n")])
      }]
    : [];

  const materials = [];
  for (const line of contentLines) {
    const comment = line.match(/^(?:热评|评论|高赞评论)\s*[:：]\s*(.+)$/);
    if (comment) {
      materials.push({
        sourceUrl: primaryUrl,
        platform,
        author: metadata.author || source?.account || source?.name || "",
        type: "hot-comment",
        excerpt: comment[1],
        whyValuable: "自动识别的热评，价值待人工确认",
        possibleUse: "audience-language"
      });
      continue;
    }
    const mention = line.match(/^@([^：:]{1,30})[：:]\s*(.{4,})$/);
    if (mention) {
      materials.push({
        sourceUrl: primaryUrl,
        platform,
        author: mention[1],
        type: "hot-comment",
        excerpt: mention[2],
        whyValuable: "自动识别的用户评论，价值待人工确认",
        possibleUse: "audience-language"
      });
    }
  }

  return { context: { sourceId: source?.id || "" }, signals, materials };
}

function normalizeDropRecords({ state, signals = [], materials = [], context = {} }) {
  const normalizedSignals = [];
  let invalidSignals = 0;
  for (const record of signals) {
    if (!record || typeof record !== "object") {
      invalidSignals += 1;
      continue;
    }
    const url = normalizeUrl(record.url);
    if (!url) {
      invalidSignals += 1;
      continue;
    }
    const sourceId = record.sourceId || context.sourceId || "";
    const source = (state.sources || []).find((item) => item.id === sourceId);
    const engagement = parseCount(record.engagement);
    normalizedSignals.push({
      ...record,
      sourceId: source ? source.id : "",
      url,
      platform: record.platform || source?.platform || context.platform || "other",
      author: record.author || source?.account || source?.name || context.author || "",
      engagement,
      authorMedianEngagement: source?.authorMedianEngagement ?? null,
      relativeMultiple: null,
      automationTier: "needs-review",
      capturedAt: record.capturedAt || now(),
      seen: false,
      disposition: "inbox",
      note: record.note || "本地投递箱自动入库",
      contentText: String(record.contentText || "").slice(0, 100000),
      imageDescriptions: Array.isArray(record.imageDescriptions)
        ? record.imageDescriptions
          .filter((item) => item && typeof item === "object")
          .map((item) => ({
            url: normalizeUrl(item.url) || "",
            description: String(item.description || "").replace(/\s+/g, " ").trim().slice(0, 300)
          }))
          .filter((item) => item.url && item.description)
          .slice(0, 20)
        : [],
      dataPointCandidates: Array.isArray(record.dataPointCandidates)
        ? record.dataPointCandidates
          .map((item) => String(item || "").replace(/\s+/g, " ").trim().slice(0, 400))
          .filter(Boolean)
          .slice(0, 30)
        : [],
      createdAt: record.createdAt || now(),
      updatedAt: now()
    });
  }

  const normalizedMaterials = [];
  let invalidMaterials = 0;
  for (const record of materials) {
    if (!record || typeof record !== "object" || !String(record.excerpt || "").trim()) {
      invalidMaterials += 1;
      continue;
    }
    normalizedMaterials.push({
      ...record,
      sourceUrl: normalizeUrl(record.sourceUrl) || "",
      platform: record.platform || context.platform || "other",
      type: record.type || "opinion",
      possibleUse: record.possibleUse || "evidence",
      topicIds: Array.isArray(record.topicIds) ? record.topicIds : [],
      createdAt: record.createdAt || now(),
      updatedAt: now()
    });
  }

  return { signals: normalizedSignals, materials: normalizedMaterials, invalidSignals, invalidMaterials };
}

async function archiveDropFile(fileName, targetDir) {
  await fs.mkdir(targetDir, { recursive: true });
  const source = path.join(dropDir, fileName);
  const extension = path.extname(fileName);
  const stem = path.basename(fileName, extension);
  let target = path.join(targetDir, fileName);
  try {
    await fs.access(target);
    target = path.join(targetDir, `${stem}-${Date.now()}${extension}`);
  } catch {
    // Target name is available.
  }
  await fs.rename(source, target);
}

async function runDropFolderScan(trigger = "automatic", allowDisabled = false) {
  if (pipelineBusy) {
    return { ok: true, skipped: true, reason: "another automation pipeline is running" };
  }
  pipelineBusy = true;

  try {
    const state = await readState();
    if (!allowDisabled && !automationEnabled(state)) {
      return { ok: true, skipped: true, reason: "automation is disabled" };
    }

    await Promise.all([fs.mkdir(dropDir, { recursive: true }), fs.mkdir(dropProcessedDir, { recursive: true }), fs.mkdir(dropFailedDir, { recursive: true })]);
    const entries = await fs.readdir(dropDir, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && dropExtensions.has(path.extname(entry.name).toLowerCase()))
      .filter((entry) => entry.name.toLowerCase() !== "readme.md")
      .map((entry) => entry.name)
      .slice(0, 0 + 20);
    const results = [];
    let changed = false;

    for (const fileName of files) {
      const filePath = path.join(dropDir, fileName);
      const run = {
        id: id("run"),
        sourceId: "local-drop",
        status: "running",
        trigger,
        startedAt: now(),
        finishedAt: "",
        found: 0,
        created: 0,
        duplicates: 0,
        failureReason: "",
        nextAction: "",
        fileName
      };
      state.collectionRuns.unshift(run);
      changed = true;

      try {
        const stat = await fs.stat(filePath);
        if (stat.size > 2 * 1024 * 1024) throw new Error("file exceeds 2 MB");
        const text = await fs.readFile(filePath, "utf8");
        state.rawSnapshots.unshift({
          id: id("snapshot"),
          runId: run.id,
          sourceId: "local-drop",
          url: `drop://${fileName}`,
          capturedAt: now(),
          format: `local-drop${path.extname(fileName).toLowerCase()}`,
          content: text.slice(0, 500000)
        });

        const parsed = parseDropFile(fileName, text);
        const normalized = normalizeDropRecords({ state, ...parsed });
        if (!normalized.signals.length && !normalized.materials.length) {
          throw new Error("drop file has no valid signal or material");
        }
        const signalTotals = importRecords(state, "signals", normalized.signals);
        const materialTotals = importRecords(state, "materials", normalized.materials);
        refreshEngagementMetrics(state);

        run.found = normalized.signals.length + normalized.materials.length;
        run.created = signalTotals.added + materialTotals.added;
        run.duplicates = signalTotals.merged + materialTotals.merged;
        run.status = run.created > 0 ? "ok" : "ok-no-new";
        run.nextAction = run.created > 0 ? "到 Inbox / 素材库查看" : "无新增，已归档";
        await writeState(state);
        await archiveDropFile(fileName, dropProcessedDir);
        results.push({ fileName, status: run.status, created: run.created, duplicates: run.duplicates, invalid: normalized.invalidSignals + normalized.invalidMaterials });
      } catch (error) {
        run.status = "failed";
        run.failureReason = error.message;
        run.nextAction = "查看 drops/failed 中的文件并修正格式";
        await writeState(state);
        try {
          await archiveDropFile(fileName, dropFailedDir);
        } catch (archiveError) {
          run.failureReason += `; archive failed: ${archiveError.message}`;
        }
        results.push({ fileName, status: "failed", error: error.message });
      }
    }

    changed = refreshMorningBrief(state) || changed;
    if (changed) await writeState(state);
    return {
      ok: true,
      scannedAt: now(),
      total: results.length,
      created: results.reduce((total, item) => total + (item.created || 0), 0),
      failed: results.filter((item) => item.status === "failed").length,
      results
    };
  } finally {
    pipelineBusy = false;
  }
}

async function runQuickCapture(text, preferredSourceId = "") {
  if (pipelineBusy) {
    return { ok: true, skipped: true, reason: "another automation pipeline is running" };
  }
  pipelineBusy = true;
  try {
    const state = await readState();
    const parsed = parseLooseCapture(state, String(text || ""));
    const preferredSource = (state.sources || []).find((source) => source.id === preferredSourceId);
    if (preferredSource) {
      parsed.context = {
        ...parsed.context,
        sourceId: preferredSource.id,
        platform: preferredSource.platform,
        author: preferredSource.account || preferredSource.name
      };
      parsed.signals = parsed.signals.map((signal) => ({
        ...signal,
        sourceId: signal.sourceId || preferredSource.id,
        platform: signal.platform === "other" ? preferredSource.platform : signal.platform,
        author: signal.author || preferredSource.account || preferredSource.name || ""
      }));
    }
    const normalized = normalizeDropRecords({ state, ...parsed });
    if (!normalized.signals.length && !normalized.materials.length) {
      return { ok: false, error: "未识别到链接、信号或热评" };
    }

    const timestamp = now();
    const run = {
      id: id("run"),
      sourceId: parsed.context.sourceId || "quick-capture",
      status: "running",
      trigger: "quick-capture",
      startedAt: timestamp,
      finishedAt: "",
      found: normalized.signals.length + normalized.materials.length,
      created: 0,
      duplicates: 0,
      failureReason: "",
      nextAction: ""
    };
    state.collectionRuns.unshift(run);
    state.rawSnapshots.unshift({
      id: id("snapshot"),
      runId: run.id,
      sourceId: run.sourceId,
      url: normalized.signals[0]?.url || normalized.materials[0]?.sourceUrl || "workbench://quick-capture",
      capturedAt: timestamp,
      format: "text",
      content: String(text).slice(0, 500000)
    });

    const signalTotals = importRecords(state, "signals", normalized.signals);
    const materialTotals = importRecords(state, "materials", normalized.materials);
    refreshEngagementMetrics(state);
    run.created = signalTotals.added + materialTotals.added;
    run.duplicates = signalTotals.merged + materialTotals.merged;
    run.status = "ok";
    run.finishedAt = now();
    run.nextAction = run.created > 0 ? "到 Inbox / 素材库查看" : "重复内容，未新增";
    refreshMorningBrief(state);
    await writeState(state);
    return {
      ok: true,
      run,
      signals: signalTotals,
      materials: materialTotals,
      invalid: normalized.invalidSignals + normalized.invalidMaterials
    };
  } finally {
    pipelineBusy = false;
  }
}

async function handleApi(request, response, pathname) {
  if (request.method === "GET" && pathname === "/api/state") {
    return sendJson(response, 200, await readState(), request);
  }

  if (request.method === "OPTIONS" && pathname.startsWith("/api/")) {
    if (!corsHeaders(request)["access-control-allow-origin"]) {
      return sendJson(response, 403, { error: "origin not allowed" }, request);
    }
    response.writeHead(204, {
      "cache-control": "no-store",
      ...corsHeaders(request)
    });
    return response.end();
  }

  if (request.method === "GET" && pathname === "/api/export") {
    const state = await readState();
    response.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": 'attachment; filename="workbench-export.json"'
    });
    return response.end(JSON.stringify(state, null, 2));
  }

  if (request.method !== "POST") return sendJson(response, 405, { error: "method not allowed" }, request);

  const body = await readBody(request);
  const state = await readState();

  if (pathname === "/api/import") {
    const totals = {};
    for (const type of ["sources", "signals", "materials", "topics"]) {
      totals[type] = importRecords(state, type, body[type] || []);
    }
    refreshEngagementMetrics(state);
    await writeState(state);
    return sendJson(response, 200, { ok: true, totals }, request);
  }

  if (pathname === "/api/record") {
    const type = body.type;
    const allowed = ["sources", "signals", "materials", "topics", "scripts", "publications", "reviews", "frictionLog"];
    if (!allowed.includes(type)) return sendJson(response, 400, { error: "unknown record type" }, request);
    const result = importRecords(state, type, [body.record || {}]);
    refreshEngagementMetrics(state);
    await writeState(state);
    return sendJson(response, 200, { ok: true, ...result }, request);
  }

  if (pathname === "/api/update") {
    const { type, id: recordId, patch = {} } = body;
    if (!state[type]) return sendJson(response, 400, { error: "unknown record type" }, request);
    const index = state[type].findIndex((record) => record.id === recordId);
    if (index < 0) return sendJson(response, 404, { error: "record not found" }, request);
    state[type][index] = { ...state[type][index], ...patch, id: recordId, updatedAt: now() };
    refreshEngagementMetrics(state);
    await writeState(state);
    return sendJson(response, 200, { ok: true, record: state[type][index] }, request);
  }

  if (pathname === "/api/collect") {
    try {
      const run = await collectWithLock(state, body.sourceId, "manual");
      if (run) {
        refreshEngagementMetrics(state);
        await writeState(state);
        return sendJson(response, 200, { ok: true, run }, request);
      }
      return sendJson(response, 200, { ok: true, skipped: true, reason: "source is already running" }, request);
    } catch (error) {
      return sendJson(response, 400, { ok: false, error: error.message }, request);
    }
  }

  if (pathname === "/api/automation/tick") {
    const result = await runAutomationTick(body.force === true);
    return sendJson(response, 200, result, request);
  }

  if (pathname === "/api/automation/settings") {
    if (typeof body.automationEnabled !== "boolean") {
      return sendJson(response, 400, { ok: false, error: "automationEnabled must be boolean" }, request);
    }
    state.settings.automationEnabled = body.automationEnabled;
    await writeState(state);
    return sendJson(response, 200, { ok: true, settings: state.settings }, request);
  }

  if (pathname === "/api/drop-folder/scan") {
    const result = await runDropFolderScan("drop-folder-manual", true);
    return sendJson(response, 200, result, request);
  }

  if (pathname === "/api/capture") {
    if (!String(body.text || "").trim()) {
      return sendJson(response, 400, { ok: false, error: "text is required" }, request);
    }
    const result = await runQuickCapture(body.text, body.sourceId);
    return sendJson(response, result.ok ? 200 : 400, result, request);
  }

  if (pathname === "/api/browser-capture") {
    try {
      const run = importBrowserCapture(state, body.sourceId, body.items);
      await writeState(state);
      return sendJson(response, 200, { ok: true, run }, request);
    } catch (error) {
      return sendJson(response, 400, { ok: false, error: error.message }, request);
    }
  }

  return sendJson(response, 404, { error: "not found" }, request);
}

async function serveStatic(request, response, pathname) {
  const relative = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(appDir, relative));
  if (!filePath.startsWith(appDir)) {
    response.writeHead(403);
    return response.end("forbidden");
  }
  try {
    const content = await fs.readFile(filePath);
    response.writeHead(200, {
      "content-type": contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-store"
    });
    response.end(content);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("not found");
  }
}

const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
    if (pathname.startsWith("/api/")) await handleApi(request, response, pathname);
    else await serveStatic(request, response, pathname);
  } catch (error) {
    sendJson(response, 500, { ok: false, error: error.message }, request);
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Personal Content Workbench: http://127.0.0.1:${port}`);
  console.log(`Automation scheduler: ${["false", "0", "off"].includes(String(process.env.AUTOMATION_ENABLED || "").toLowerCase()) ? "disabled" : "enabled"}, tick ${automationTickMs}ms`);
  console.log(`Drop folder scanner: ${dropDir}, scan ${dropScanMs}ms`);
});

const automationTimer = setInterval(() => {
  runAutomationTick(false).catch((error) => {
    console.error(`Automation tick failed: ${error.message}`);
  });
}, automationTickMs);

const dropTimer = setInterval(() => {
  runDropFolderScan("drop-folder", false).catch((error) => {
    console.error(`Drop folder scan failed: ${error.message}`);
  });
}, dropScanMs);

server.on("close", () => {
  clearInterval(automationTimer);
  clearInterval(dropTimer);
});
