import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appDir = path.join(root, "app");
const dataDir = path.join(root, "data");
const dataFile = process.env.DATA_FILE ? path.resolve(process.env.DATA_FILE) : path.join(dataDir, "workbench.json");
const port = Number(process.env.PORT || 5177);
const automationTickMs = Math.max(1000, Number(process.env.AUTOMATION_TICK_MS || 60000));
const automaticMethods = new Set(["public-rss", "public-page"]);
const runningSourceIds = new Set();
let automationTickRunning = false;

const emptyState = () => ({
  version: 1,
  settings: {
    collectionTime: "08:40",
    automationEnabled: true,
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

function identityKey(type, record = {}) {
  if (type === "sources") return record.url || record.id || id("source");
  if (type === "signals") return signalIdentityKey(record) || record.id || id("signal");
  if (type === "materials") return `${record.sourceUrl || ""}||${record.excerpt || ""}` || record.id || id("material");
  if (type === "topics") return (record.title || "").trim().toLowerCase() || record.id || id("topic");
  return record.id || id(type.replace(/s$/, ""));
}

function importRecords(state, type, records = []) {
  const existing = state[type] || [];
  const index = new Map(existing.map((record) => [identityKey(type, record), record]));
  let added = 0;
  let merged = 0;
  for (const incoming of records) {
    if (!incoming || typeof incoming !== "object") continue;
    const key = identityKey(type, incoming);
    const patch = Object.fromEntries(
      Object.entries(incoming).filter(([, value]) => value !== undefined && value !== null && value !== "")
    );
    if (index.has(key)) {
      const current = index.get(key);
      index.set(key, {
        ...current,
        ...patch,
        id: current.id,
        updatedAt: now()
      });
      merged += 1;
    } else {
      const record = {
        ...incoming,
        id: incoming.id || id(type.replace(/s$/, "").replace("-", "-")),
        createdAt: incoming.createdAt || now(),
        updatedAt: now()
      };
      index.set(key, record);
      added += 1;
    }
  }
  state[type] = [...index.values()];
  return { added, merged };
}

function signalIdentityKey(record = {}) {
  const url = canonicalSignalUrl(record.url);
  if (url) return url;
  const parts = [
    record.platform || "",
    record.author || "",
    record.title || "",
    record.publishedAt || ""
  ].map((value) => String(value).trim().toLowerCase());
  return parts.some(Boolean) ? parts.join("||") : "";
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
    }
  }
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
    return {
      title: pick(block, "title"),
      link,
      publishedAt: pick(block, "pubDate") || pick(block, "published") || pick(block, "updated")
    };
  }).filter((item) => item.link);
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
        if (state.signals.some((signal) => signalIdentityKey(signal) === canonicalSignalUrl(item.link))) {
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
      run.status = "ok";
      run.found = 0;
      run.created = 0;
      run.nextAction = "原始快照已保存，等待页面解析器";
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
  if (automationTickRunning) {
    return { ok: true, skipped: true, reason: "another automation tick is running" };
  }
  automationTickRunning = true;

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

    if (results.some((item) => item.status !== "skipped")) {
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
});

const automationTimer = setInterval(() => {
  runAutomationTick(false).catch((error) => {
    console.error(`Automation tick failed: ${error.message}`);
  });
}, automationTickMs);

server.on("close", () => clearInterval(automationTimer));
