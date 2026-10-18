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

const emptyState = () => ({
  version: 1,
  settings: {
    collectionTime: "08:40",
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
    return { ...emptyState(), ...parsed, settings: { ...emptyState().settings, ...(parsed.settings || {}) } };
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
  if (type === "signals") return record.url || record.id || id("signal");
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
    if (index.has(key)) {
      const current = index.get(key);
      index.set(key, {
        ...current,
        ...incoming,
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

async function runCollection(state, sourceId) {
  const source = state.sources.find((item) => item.id === sourceId);
  if (!source) throw new Error("source not found");

  const run = {
    id: id("run"),
    sourceId: source.id,
    status: "running",
    startedAt: now(),
    finishedAt: "",
    found: 0,
    created: 0,
    failureReason: "",
    nextAction: ""
  };
  state.collectionRuns.unshift(run);

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
      for (const item of items) {
        const exists = state.signals.some((signal) => signal.url === item.link);
        if (exists) continue;
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
  }

  return run;
}

function importBrowserCapture(state, sourceId, items) {
  const source = state.sources.find((item) => item.id === sourceId);
  if (!source) throw new Error("source not found");
  if (source.collectionMethod !== "browser-assisted") {
    throw new Error("only browser-assisted sources can use browser capture");
  }
  if (!Array.isArray(items) || items.length === 0) throw new Error("items must be a non-empty array");

  const seen = new Set(state.signals.map((signal) => signal.url));
  const candidates = [];
  const duplicateInputs = new Set();
  for (const item of items) {
    if (!item || typeof item !== "object") throw new Error("each item must be an object");
    const url = normalizeUrl(item.url);
    if (!url) throw new Error("each item needs a valid URL");
    if (seen.has(url) || duplicateInputs.has(url)) continue;
    duplicateInputs.add(url);
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
    await writeState(state);
    return sendJson(response, 200, { ok: true, totals }, request);
  }

  if (pathname === "/api/record") {
    const type = body.type;
    const allowed = ["sources", "signals", "materials", "topics", "scripts", "publications", "reviews", "frictionLog"];
    if (!allowed.includes(type)) return sendJson(response, 400, { error: "unknown record type" }, request);
    const result = importRecords(state, type, [body.record || {}]);
    await writeState(state);
    return sendJson(response, 200, { ok: true, ...result }, request);
  }

  if (pathname === "/api/update") {
    const { type, id: recordId, patch = {} } = body;
    if (!state[type]) return sendJson(response, 400, { error: "unknown record type" }, request);
    const index = state[type].findIndex((record) => record.id === recordId);
    if (index < 0) return sendJson(response, 404, { error: "record not found" }, request);
    state[type][index] = { ...state[type][index], ...patch, id: recordId, updatedAt: now() };
    await writeState(state);
    return sendJson(response, 200, { ok: true, record: state[type][index] }, request);
  }

  if (pathname === "/api/collect") {
    try {
      const run = await runCollection(state, body.sourceId);
      await writeState(state);
      return sendJson(response, 200, { ok: true, run }, request);
    } catch (error) {
      return sendJson(response, 400, { ok: false, error: error.message }, request);
    }
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
});
