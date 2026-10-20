const navItems = [
  ["overview", "总览"],
  ["flow", "信息流"],
  ["workflow", "工作流"],
  ["system", "系统"]
];

const stageOrder = [
  "topic",
  "outline",
  "draft",
  "production",
  "review",
  "ready-to-publish",
  "published",
  "reviewed"
];

const stageLabels = {
  topic: "选题",
  outline: "提纲",
  draft: "草稿",
  production: "制作",
  review: "待审",
  "ready-to-publish": "待发",
  published: "已发",
  reviewed: "已复盘"
};

const platformLabels = {
  x: "X",
  xiaohongshu: "小红书",
  douyin: "抖音",
  wechat: "公众号",
  other: "其他"
};

const publicationStatusLabels = {
  "not-ready": "未准备",
  manual: "待人工",
  published: "已发",
  failed: "失败",
  skipped: "跳过"
};

const publicationStatusVariants = {
  "not-ready": "",
  manual: "warn",
  published: "accent",
  failed: "danger",
  skipped: ""
};

const publicationPlatforms = ["douyin", "xiaohongshu", "wechat", "x"];
const publicationStatusOrder = ["not-ready", "manual", "failed", "skipped", "published"];

const methodLabels = {
  manual: "手动导入",
  "browser-assisted": "浏览器辅助",
  "public-rss": "公开 RSS",
  "public-page": "公开页面",
  "platform-export": "平台导出",
  "research-only": "仅研究"
};

const automationLabels = {
  scheduled: "已排程",
  running: "运行中",
  retrying: "失败重试",
  "manual-required": "待人工",
  "on-demand": "按需",
  disabled: "已停用",
  "research-only": "仅研究"
};

const dispositionLabels = {
  inbox: "待处理",
  discard: "丢弃",
  watch: "观察",
  dissect: "拆解",
  material: "素材",
  topic: "选题",
  produce: "生产"
};

const automationTierLabels = {
  "high-potential": "高潜力",
  "worth-watching": "值得观察",
  normal: "常规",
  "needs-review": "待补数据"
};

const agentLabels = {
  grok: "Grok",
  muse: "Muse",
  codex: "Codex",
  claude: "Claude",
  cursor: "Cursor"
};

const agentTaskKindLabels = {
  research: "研究",
  dissect: "拆解",
  outline: "提纲",
  script: "口播稿",
  title: "标题",
  "platform-copy": "平台文案",
  visual: "视觉方案"
};

const agentTaskStatusLabels = {
  outbox: "待处理",
  running: "运行中",
  "result-ready": "结果待导入",
  imported: "已导入"
};

const backupReasonLabels = {
  manual: "手动",
  auto: "自动",
  "pre-restore": "恢复前"
};

const triggerLabels = {
  automatic: "自动",
  force: "强制",
  manual: "手动",
  "browser-assisted": "浏览器辅助",
  "drop-folder": "投递箱",
  "drop-folder-manual": "投递箱手动",
  "quick-capture": "快速粘贴"
};

const coverageLabels = {
  unknown: "覆盖范围待确认",
  partial: "历史补采未完成",
  complete: "已覆盖显示总数"
};

const controlStatusLabels = {
  running: "运行中",
  manual: "待人工",
  backfill: "待补采",
  due: "已到期",
  failed: "失败",
  cooldown: "冷却",
  complete: "已覆盖",
  monitoring: "监控中",
  "on-demand": "按需",
  research: "仅研究",
  disabled: "已停用"
};

const controlStatusVariants = {
  running: "info",
  manual: "warn",
  backfill: "warn",
  due: "warn",
  failed: "danger",
  cooldown: "danger",
  complete: "accent",
  monitoring: "info",
  "on-demand": "",
  research: "",
  disabled: ""
};

const commandCenterStatusOrder = [
  "running",
  "manual",
  "backfill",
  "due",
  "failed",
  "cooldown",
  "complete",
  "monitoring",
  "on-demand",
  "research",
  "disabled"
];

const productionCheckLabels = {
  coreIdea: "核心观点",
  targetReader: "目标读者",
  hook: "开头钩子",
  outline: "结构大纲",
  evidence: "证据案例",
  visuals: "配图素材",
  publishPackage: "发布包"
};

const gateLabels = {
  evidence: "证据核对",
  opening: "开头确认",
  sample: "样片确认",
  final: "终审"
};

let state = null;
let currentView = viewFromLocationHash();
let inboxFilter = "inbox";
let materialQuery = "";
let backups = null;
let backupRoot = "";
let backupRetentionLimit = 100;

const appNav = document.getElementById("nav");
const viewEl = document.getElementById("view");
const dataState = document.getElementById("data-state");
const themeStorageKey = "workbench-theme";
const themeValues = new Set(["auto", "light", "dark"]);

function normalizeTheme(value) {
  return themeValues.has(value) ? value : "auto";
}

function setTheme(theme, { persist = true } = {}) {
  const nextTheme = normalizeTheme(theme);
  document.documentElement.dataset.theme = nextTheme;
  for (const button of document.querySelectorAll("[data-theme-value]")) {
    button.setAttribute("aria-pressed", String(button.dataset.themeValue === nextTheme));
  }
  if (persist) localStorage.setItem(themeStorageKey, nextTheme);
}

setTheme(normalizeTheme(localStorage.getItem(themeStorageKey)), { persist: false });

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function viewFromLocationHash() {
  const value = decodeURIComponent(window.location.hash.slice(1));
  return navItems.some(([key]) => key === value) ? value : "overview";
}

async function api(path, method = "GET", body = null) {
  const response = await fetch(path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json();
  if (!response.ok || payload.ok === false) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

async function loadState() {
  state = await api("/api/state");
  dataState.textContent = `${state.sources.length} 账号 / ${state.signals.length} 信号`;
  renderNav();
  render();
}

function renderNav() {
  appNav.innerHTML = navItems.map(([key, label]) => (
    `<button type="button" class="nav-button ${currentView === key ? "active" : ""}" data-action="nav" data-view="${key}">${label}</button>`
  )).join("");
}

async function activateView(targetView) {
  if (!navItems.some(([key]) => key === targetView)) return;
  currentView = targetView;
  renderNav();
  render();
  if (currentView === "system") await loadBackups();
}

function sourceById(id) {
  return state.sources.find((source) => source.id === id);
}

function topicById(id) {
  return state.topics.find((topic) => topic.id === id);
}

function browserCaptureToken(sourceId) {
  const record = (state.runtime?.browserCapture || []).find((item) => item.sourceId === sourceId);
  if (!record) throw new Error("采集 token 不存在，请刷新工作台后重新复制采集书签。");
  if (new Date(record.expiresAt).getTime() <= Date.now()) throw new Error("采集 token 已过期，请刷新工作台后重新复制采集书签。");
  return record.token;
}

function sourceOptions(selectedId = "") {
  const placeholder = state.sources.length
    ? `<option value="">自动匹配账号</option>`
    : `<option value="">自动匹配，未匹配则入其他</option>`;
  return placeholder + state.sources.map((source) => (
    `<option value="${escapeHtml(source.id)}" ${source.id === selectedId ? "selected" : ""}>${escapeHtml(source.name || source.account || source.url)}</option>`
  )).join("");
}

function xhsCollectorSource(sourceId) {
  const endpoint = `http://127.0.0.1:${window.location.port || "5177"}/api/browser-capture`;
  const expectedProfile = sourceById(sourceId)?.url.match(/\/user\/profile\/([A-Za-z0-9]+)/)?.[1] || "";
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

  const sourceId = ${JSON.stringify(sourceId)};
  const notesRoot = window.__INITIAL_STATE__?.user?.notes?._rawValue
    || window.__INITIAL_STATE__?.user?.notes
    || [];
  const groups = Array.isArray(notesRoot) ? notesRoot : Object.values(notesRoot || {});
  const items = [];
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
  const profileState = window.__INITIAL_STATE__?.user?.userPageData || {};
  const pageText = document.body?.innerText || "";
  const noteTextMatch = pageText.match(/([\\d,.]+)\\s*(万|亿|[kK])?\\s*(?:篇)?笔记/);
  const followerTextMatch = pageText.match(/([\\d,.]+)\\s*(万|亿|[kK])?\\s*(?:个)?粉丝/);
  const context = {
    profileNoteCount: countFromText(profileState.notes) || countFromText(noteTextMatch?.[0]),
    profileFollowers: countFromText(profileState.followers) || countFromText(followerTextMatch?.[0])
  };

  for (const group of groups) {
    const list = Array.isArray(group) ? group : Object.values(group || {});
    for (const entry of list) {
      if (!entry || typeof entry !== "object") continue;
      const note = entry.noteCard || entry.note_card || {};
      const noteId = entry.id || entry.noteId || entry.note_id || note.noteId || note.note_id;
      if (!noteId || seen.has(noteId)) continue;

      const token = entry.xsecToken || entry.xsec_token || "";
      const interaction = entry.interactInfo || entry.interact_info || note.interactInfo || note.interact_info || {};
      const engagement = interaction.likedCount || interaction.liked_count || interaction.liked || "";
      const timeValue = Number(entry.time || note.time || entry.lastUpdateTime || note.last_update_time || 0);
      const timestamp = timeValue > 0 && timeValue < 10000000000 ? timeValue * 1000 : timeValue;
      const date = timestamp > 0 ? new Date(timestamp) : null;
      const query = token
        ? "?xsec_token=" + encodeURIComponent(token) + "&xsec_source=pc_user"
        : "";

      seen.add(noteId);
      items.push({
        title: entry.displayTitle || entry.display_title || note.displayTitle || note.title || note.desc || noteId,
        url: "https://www.xiaohongshu.com/explore/" + encodeURIComponent(noteId) + query,
        engagement: String(engagement || ""),
        publishedAt: date && !Number.isNaN(date.getTime()) ? date.toISOString() : "",
        noteId
      });
    }
  }

  if (!items.length) {
    alert("页面状态里没有可用笔记。请先停留在“笔记”页签；如列表未加载完，先手动滚动，再重新点击。");
    return;
  }

  try {
    const response = await fetch(${JSON.stringify(endpoint)}, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      headers: {
        "content-type": "application/json",
        "x-capture-token": ${JSON.stringify(browserCaptureToken(sourceId))}
      },
      body: JSON.stringify({ sourceId, items, context })
    });
    const payload = await response.json();
    if (!response.ok || payload.ok === false) throw new Error(payload.error || "HTTP " + response.status);
    let message = "采集完成：发现 " + payload.run.found + " 条，新增 " + payload.run.created + " 条。";
    if (payload.run.profileNoteCount) {
      message += "\\n本页已加载 " + payload.run.loadedCount + " 条，主页显示 " + payload.run.profileNoteCount + " 条，工作台累计 " + payload.run.collectedCount + " 条。";
    } else {
      message += "\\n本页已加载 " + payload.run.loadedCount + " 条；未识别到主页总笔记数，请继续滚动补齐目标范围。";
    }
    alert(message);
  } catch (error) {
    console.error("Personal Content Workbench capture", items, error);
    alert("直连本地工作台失败：" + error.message + "。已在控制台输出 items，可复制后回到账号页手动导入。");
  }
})();
`.trim();
}

function xhsBookmarkletHref(sourceId) {
  return `javascript:${encodeURIComponent(xhsCollectorSource(sourceId))}`;
}

function topicOptions(selectedId = "") {
  if (!state.topics.length) return `<option value="">先添加选题</option>`;
  return state.topics.map((topic) => (
    `<option value="${escapeHtml(topic.id)}" ${topic.id === selectedId ? "selected" : ""}>${escapeHtml(topic.title)}</option>`
  )).join("");
}

function tag(text, variant = "") {
  return `<span class="tag ${variant}">${escapeHtml(text)}</span>`;
}

function displayDate(value) {
  if (!value) return "未记时间";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function automationVariant(status) {
  if (status === "running" || status === "scheduled") return "accent";
  if (status === "retrying") return "danger";
  if (status === "manual-required") return "warn";
  return "";
}

function sourceScheduleTags(source) {
  const status = automationLabels[source.automationStatus] || "未排程";
  const tags = [tag(status, automationVariant(source.automationStatus))];
  if (["scheduled", "running", "retrying", "manual-required"].includes(source.automationStatus) && source.nextRunAt) {
    tags.push(tag(`下次 ${displayDate(source.nextRunAt)}`, new Date(source.nextRunAt).getTime() <= Date.now() ? "warn" : "info"));
  }
  if (source.failureCount > 0) tags.push(tag(`失败 ${source.failureCount} 次`, "danger"));
  return tags.join("");
}

function controlRecordById(sourceId) {
  return (state.runtime?.commandCenter?.records || []).find((record) => record.sourceId === sourceId) || null;
}

function commandCoverageText(record) {
  if (!record?.coverage) return "覆盖范围待登记";
  if (!record.coverage.totalNotes) {
    return `本页加载 ${record.coverage.lastLoadedCount || 0} 条 · 主页总数待确认`;
  }
  const percent = record.coverage.percent === null || record.coverage.percent === undefined
    ? ""
    : ` · ${record.coverage.percent}%`;
  return `累计 ${record.coverage.collectedCount || 0}/${record.coverage.totalNotes}${percent}`;
}

function renderCommandCenter() {
  const commandCenter = state.runtime?.commandCenter;
  if (!commandCenter) {
    return `
      <section class="panel">
        <h2 class="panel-title">采集指挥中心</h2>
        <div class="empty">指挥中心数据待加载，请刷新页面</div>
      </section>
    `;
  }

  const counts = commandCenterStatusOrder
    .filter((status) => commandCenter.counts?.[status])
    .map((status) => tag(`${controlStatusLabels[status]} ${commandCenter.counts[status]}`, controlStatusVariants[status]));

  return `
    <section class="panel command-center">
      <div class="item-head">
        <div>
          <h2 class="panel-title">采集指挥中心</h2>
          <p class="panel-note">按运行中、人工、补采、到期、失败优先排列；complete 只代表当前主页显示总数已覆盖。</p>
        </div>
        ${tag(commandCenter.automationEnabled ? "自动开" : "自动关", commandCenter.automationEnabled ? "accent" : "warn")}
      </div>
      <div class="item-meta command-counts">${counts.join("") || tag("暂无账号")}</div>
      <div class="list command-queue">
        ${commandCenter.records.length ? commandCenter.records.map((record) => {
          const source = sourceById(record.sourceId);
          return `
            <article class="command-item" data-command-source="${escapeHtml(record.sourceId)}">
              <div class="item-head">
                <div>
                  <h3 class="item-title">${escapeHtml(record.name)}</h3>
                  <p class="item-note">${escapeHtml(record.nextAction || "暂无下一步")}</p>
                </div>
                ${tag(controlStatusLabels[record.controlStatus] || record.controlStatus, controlStatusVariants[record.controlStatus] || "")}
              </div>
              <div class="item-meta">
                ${tag(platformLabels[record.platform] || record.platform || "未知平台", "info")}
                ${tag(methodLabels[record.collectionMethod] || record.collectionMethod || "未设置")}
                ${tag(commandCoverageText(record), record.controlStatus === "complete" ? "accent" : record.controlStatus === "backfill" ? "warn" : "")}
                ${record.nextRunAt ? tag(`下次 ${displayDate(record.nextRunAt)}`) : ""}
                ${record.failureCount ? tag(`失败 ${record.failureCount} 次`, "danger") : ""}
              </div>
              ${record.error ? `<p class="item-note danger-text">${escapeHtml(record.error)}</p>` : ""}
              <div class="item-actions">
                ${record.controlStatus === "running" || record.controlStatus === "disabled" ? "" : `<button type="button" class="small-button ${record.primaryAction === "run" ? "accent" : ""}" data-action="run-source" data-id="${escapeHtml(record.sourceId)}">运行采集</button>`}
                ${source?.url ? `<a class="small-button" href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">打开主页</a>` : ""}
                ${record.platform === "xiaohongshu" && record.collectionMethod === "browser-assisted" ? `
                  <a class="small-button accent" draggable="true" href="${escapeHtml(xhsBookmarkletHref(record.sourceId))}" title="拖到浏览器书签栏">采集书签</a>
                  <button type="button" class="small-button" data-action="copy-xhs-collector" data-id="${escapeHtml(record.sourceId)}">复制脚本</button>
                ` : ""}
              </div>
              ${record.lastRun ? `
                <details class="details command-details">
                  <summary>最近运行：${escapeHtml(triggerLabels[record.lastRun.trigger] || record.lastRun.trigger || "手动")} · ${escapeHtml(displayDate(record.lastRun.startedAt))}</summary>
                  <div class="item-meta">
                    ${tag(`状态 ${record.lastRun.status}`, record.lastRun.status === "ok" ? "accent" : record.lastRun.status === "failed" ? "danger" : "warn")}
                    ${tag(`发现 ${record.lastRun.found}`)}
                    ${tag(`新增 ${record.lastRun.created}`)}
                    ${tag(`重复 ${record.lastRun.duplicates}`)}
                  </div>
                  ${record.lastRun.failureReason ? `<p class="item-note danger-text">${escapeHtml(record.lastRun.failureReason)}</p>` : ""}
                  ${record.lastRun.nextAction ? `<p class="item-note">运行建议：${escapeHtml(record.lastRun.nextAction)}</p>` : ""}
                </details>
              ` : `<p class="item-note">暂无采集运行记录</p>`}
            </article>
          `;
        }).join("") : `<div class="empty">暂无账号，先用左侧快速登记导入对标博主</div>`}
      </div>
    </section>
  `;
}

function isScheduledSource(source) {
  return source.enabled !== false
    && source.checkFrequency !== "on-demand"
    && source.collectionMethod !== "research-only";
}

function isDueSource(source) {
  return isScheduledSource(source) && Boolean(source.nextRunAt) && new Date(source.nextRunAt).getTime() <= Date.now();
}

function signalStrength(signal) {
  if (signal.relativeMultiple !== null && signal.relativeMultiple !== undefined) return Number(signal.relativeMultiple);
  if (signal.engagement !== null && signal.engagement !== undefined) return Number(signal.engagement);
  return -1;
}

function signalTime(signal) {
  const published = new Date(signal.publishedAt || 0).getTime() || 0;
  const captured = new Date(signal.capturedAt || 0).getTime() || 0;
  return Math.max(published, captured);
}

function latestDailyBrief() {
  const today = new Date().toLocaleDateString("sv-SE");
  return (state.morningBriefs || []).find((brief) => brief.date === today) || null;
}

function readNumberInput(input) {
  const value = input.value.trim();
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error("请输入有效的非负数字");
  return parsed;
}

function topicDefaults(record = {}) {
  return {
    ...record,
    format: record.format || "spoken-video",
    platforms: record.platforms || ["douyin", "xiaohongshu", "wechat"],
    stage: record.stage || "topic",
    productionChecks: record.productionChecks || {
      coreIdea: false,
      targetReader: false,
      hook: false,
      outline: false,
      evidence: false,
      visuals: false,
      publishPackage: false
    },
    gates: record.gates || { evidence: false, opening: false, sample: false, final: false }
  };
}

function render() {
  const views = {
    overview: renderToday,
    flow: renderInformationFlow,
    workflow: renderWorkflowWorkspace,
    system: renderSystemWorkspace
  };
  viewEl.innerHTML = views[currentView]();
}

function renderInformationFlow() {
  return `
    <section class="page-head">
      <div><h1 class="page-title">信息流</h1><p class="page-subtitle">对标账号 · Inbox 清零 · 素材沉淀</p></div>
    </section>
    ${renderFlowRhythm()}
    <div class="category-stack">
      <div class="category-section" id="flow-sources">${renderSources()}</div>
      <div class="category-section" id="flow-inbox">${renderInbox()}</div>
      <div class="category-section" id="flow-materials">${renderMaterials()}</div>
    </div>
  `;
}

function renderWorkflowWorkspace() {
  return `
    <section class="page-head">
      <div><h1 class="page-title">工作流</h1><p class="page-subtitle">选题 · 生产 · 发布 · 复盘</p></div>
    </section>
    ${renderWorkflowPipeline()}
    <div class="category-stack">
      <div class="category-section" id="workflow-topics">${renderTopics()}</div>
      <div class="category-section" id="workflow-production">${renderProduction()}</div>
      <div class="category-section" id="workflow-publish">${renderPublish()}</div>
      <div class="category-section" id="workflow-review">${renderReview()}</div>
    </div>
  `;
}

function renderSystemWorkspace() {
  return `
    <section class="page-head">
      <div><h1 class="page-title">系统</h1><p class="page-subtitle">采集运行 · Agent 桥接 · 本地备份</p></div>
    </section>
    <div class="category-stack">
      <div class="category-section" id="system-runs">${renderRuns()}</div>
      <div class="category-section" id="system-agents">${renderAgents()}</div>
      <div class="category-section" id="system-backups">${renderBackups()}</div>
    </div>
  `;
}

function renderFlowRhythm() {
  const dueCount = state.sources.filter(isDueSource).length;
  const manualCount = state.sources.filter((source) => source.automationStatus === "manual-required").length;
  const inbox = state.runtime?.inbox;
  const pendingCount = inbox?.pending ?? state.signals.filter((signal) => signal.disposition === "inbox").length;
  const pushRate = inbox?.pushRate;
  const materialCount = state.materials.length;
  const hotCommentCount = state.materials.filter((material) => material.kind === "hot-comment").length;

  return `
    <section class="flow-rhythm" aria-label="信息流状态">
      <article>
        <span>进料</span>
        <strong>${dueCount}</strong>
        <small>${manualCount ? `${manualCount} 个账号待人工` : "无人工阻塞"}</small>
      </article>
      <article>
        <span>Inbox</span>
        <strong>${pendingCount}</strong>
        <small>${pushRate === null || pushRate === undefined ? "推进率待判断" : `推进率 ${pushRate}%`}</small>
      </article>
      <article>
        <span>素材沉淀</span>
        <strong>${materialCount}</strong>
        <small>热评 ${hotCommentCount}</small>
      </article>
    </section>
  `;
}

function dailyPriorityQueue() {
  const manualActionCount = state.sources.filter((source) => source.automationStatus === "manual-required").length;
  const inboxCount = state.runtime?.inbox?.pending ?? state.signals.filter((signal) => signal.disposition === "inbox").length;
  const producingCount = state.topics.filter((topic) => ["outline", "draft", "production", "review"].includes(topic.stage)).length;
  const readyCount = state.topics.filter((topic) => topic.stage === "ready-to-publish").length;
  const queue = [];

  if (manualActionCount) queue.push({ label: "处理采集账号", detail: `${manualActionCount} 个账号需要人工动作`, view: "flow", anchor: "flow-sources", count: manualActionCount });
  if (inboxCount) queue.push({ label: "清 Inbox", detail: `${inboxCount} 条信号待判断`, view: "flow", anchor: "flow-inbox", count: inboxCount });
  if (producingCount) queue.push({ label: "推进生产", detail: `${producingCount} 个选题正在生产`, view: "workflow", anchor: "workflow-production", count: producingCount });
  if (readyCount) queue.push({ label: "处理发布", detail: `${readyCount} 个选题待发布`, view: "workflow", anchor: "workflow-publish", count: readyCount });
  if (!queue.length) queue.push({ label: "补一个新选题", detail: "当前没有阻塞和生产任务", view: "workflow", anchor: "workflow-topics", count: null });
  return queue.slice(0, 3);
}

function renderWorkflowPipeline() {
  const groups = [
    { label: "选题", stages: ["topic"], anchor: "workflow-topics" },
    { label: "提纲 / 草稿", stages: ["outline", "draft"], anchor: "workflow-production" },
    { label: "制作 / 待审", stages: ["production", "review"], anchor: "workflow-production" },
    { label: "待发", stages: ["ready-to-publish"], anchor: "workflow-publish" },
    { label: "发布 / 复盘", stages: ["published", "reviewed"], anchor: "workflow-review" }
  ].map((group) => ({
    ...group,
    count: state.topics.filter((topic) => group.stages.includes(topic.stage)).length
  }));
  const activeGroup = groups.find((group) => group.count > 0 && group.label !== "发布 / 复盘");
  const total = state.topics.length;

  return `
    <section class="panel workflow-pipeline" aria-label="工作流阶段">
      <div class="item-head">
        <div>
          <h2 class="panel-title">阶段漏斗</h2>
          <p class="panel-note">${activeGroup ? `当前重心：${activeGroup.label} · ${activeGroup.count} 个` : total ? "当前批次已进入收尾" : "还没有选题"}</p>
        </div>
        ${tag(`选题 ${total}`, "info")}
      </div>
      <div class="pipeline-track">
        ${groups.map((group) => `
          <button type="button" data-action="nav" data-view="workflow" data-anchor="${group.anchor}">
            <span>${group.label}</span>
            <strong>${group.count}</strong>
          </button>
        `).join("")}
      </div>
    </section>
  `;
}

function renderToday() {
  const inbox = state.runtime?.inbox;
  const inboxCount = inbox?.pending ?? state.signals.filter((signal) => signal.disposition === "inbox").length;
  const manualActionCount = state.sources.filter((source) => source.automationStatus === "manual-required").length;
  const producing = state.topics.filter((topic) => ["outline", "draft", "production", "review"].includes(topic.stage)).length;
  const ready = state.topics.filter((topic) => topic.stage === "ready-to-publish").length;
  const completedWorks = state.topics.filter((topic) => ["published", "reviewed"].includes(topic.stage)).length;
  const sprintTarget = 3;
  const sprintPercent = Math.min(100, Math.round((completedWorks / sprintTarget) * 100));
  const priorities = dailyPriorityQueue();
  const focusTopics = state.topics
    .filter((topic) => !["published", "reviewed"].includes(topic.stage))
    .slice(0, 3);
  const brief = latestDailyBrief();

  return `
    <section class="page-head">
      <div>
        <h1 class="page-title">今日</h1>
        <p class="page-subtitle">${escapeHtml(state.settings.inboxTime)} Inbox · ${escapeHtml(state.settings.collectionTime)} 采集</p>
      </div>
    </section>
    <div class="metric-grid">
      <div class="metric"><div class="metric-value">${inboxCount}</div><div class="metric-label">待处理信号</div></div>
      <div class="metric"><div class="metric-value">${manualActionCount}</div><div class="metric-label">待人工账号</div></div>
      <div class="metric"><div class="metric-value">${producing}</div><div class="metric-label">生产中</div></div>
      <div class="metric"><div class="metric-value">${ready}</div><div class="metric-label">待发布</div></div>
    </div>
    <div class="today-layout">
      <section class="panel">
        <div class="item-head">
          <h2 class="panel-title">今日动作</h2>
          ${brief ? tag(displayDate(brief.generatedAt), "accent") : ""}
        </div>
        <div class="sprint-progress">
          <div><span>作品目标</span><strong>${completedWorks}/${sprintTarget}</strong></div>
          <div class="progress-track" role="img" aria-label="作品目标完成度 ${sprintPercent}%"><span style="width:${sprintPercent}%"></span></div>
        </div>
        <ol class="priority-list">
          ${priorities.map((item, index) => `
            <li>
              <span>${["现在", "接着", "稍后"][index]}</span>
              <button
                type="button"
                class="priority-action"
                data-action="nav"
                data-view="${item.view}"
                data-anchor="${item.anchor}"
              >
                <strong>${escapeHtml(item.label)}</strong>
                <small>${escapeHtml(item.detail)}</small>
              </button>
            </li>
          `).join("")}
        </ol>
        <div class="today-actions">
          <button type="button" data-action="nav" data-view="flow" data-anchor="flow-inbox"><span>清 Inbox</span><strong>${inboxCount}</strong></button>
          <button type="button" data-action="nav" data-view="flow" data-anchor="flow-sources"><span>处理账号</span><strong>${manualActionCount}</strong></button>
          <button type="button" data-action="nav" data-view="workflow" data-anchor="workflow-production"><span>推进生产</span><strong>${producing}</strong></button>
          <button type="button" data-action="nav" data-view="workflow" data-anchor="workflow-publish"><span>处理发布</span><strong>${ready}</strong></button>
        </div>
        ${brief?.nextActions?.length ? `<div class="item-meta">${brief.nextActions.slice(0, 3).map((action) => tag(action, "accent")).join("")}</div>` : ""}
      </section>
      <section class="panel">
        <h2 class="panel-title">快速粘贴</h2>
        <form id="quick-capture" class="form-grid">
          <div class="field full"><label>来源账号</label><select name="sourceId">${sourceOptions()}</select></div>
          <div class="field full"><label>粘贴原文</label><textarea name="text" rows="8" required placeholder="链接、标题、点赞数、热评或 JSON"></textarea></div>
          <div class="form-actions"><button class="primary-button" type="submit">解析入库</button></div>
        </form>
        <p class="panel-note">识别结果先进 Inbox / 素材库，不自动替你判断价值。</p>
      </section>
      <section class="panel">
        <h2 class="panel-title">生产焦点</h2>
        <div class="list">
          ${focusTopics.length ? focusTopics.map((topic) => `
            <article class="item-card">
              <div class="item-head">
                <h3 class="item-title">${escapeHtml(topic.title)}</h3>
                ${tag(stageLabels[topic.stage] || topic.stage, "accent")}
              </div>
              <p class="item-body">${escapeHtml(topic.coreIdea || "核心观点待补")}</p>
            </article>
          `).join("") : `<div class="empty">暂无生产中选题</div>`}
        </div>
      </section>
    </div>
  `;
}

function renderSources() {
  const dueCount = state.sources.filter(isDueSource).length;
  const retryingCount = state.sources.filter((source) => source.automationStatus === "retrying").length;
  const runtimeAutomation = state.runtime?.automation || {};
  const effectiveAutomation = runtimeAutomation.effectiveEnabled ?? state.settings.automationEnabled !== false;
  const envDisabled = runtimeAutomation.envDisabled === true;
  const pageEnabled = runtimeAutomation.pageEnabled ?? state.settings.automationEnabled !== false;
  const automationLabel = envDisabled ? "环境变量强制关" : effectiveAutomation ? "开" : "关";

  return `
    <section class="section-head">
      <div>
        <h2 class="section-title">对标账号</h2>
        <p class="section-subtitle">账号注册表 · 自动化${automationLabel} · 到期 ${dueCount} · 重试 ${retryingCount}</p>
      </div>
      <div class="head-actions">
        <button type="button" class="small-button accent" data-action="run-automation">检查到期采集</button>
        <button type="button" class="small-button" data-action="run-all">强制检查全部</button>
        <button type="button" class="small-button" data-action="toggle-automation" ${envDisabled ? "disabled title=\"AUTOMATION_ENABLED=false 正在强制关闭自动化\"" : ""}>${pageEnabled ? "暂停页面自动化" : "开启页面自动化"}</button>
      </div>
    </section>
    ${renderCommandCenter()}
    <div class="split">
      <div>
        <section class="panel">
          <h2 class="panel-title">对标账号快速登记</h2>
          <form id="source-intake-form" class="form-grid">
            <div class="field full">
              <label>平台分享文案 / 主页链接</label>
              <textarea name="text" rows="5" required placeholder="@博主名 在小红书已经有17.3万个粉丝，点击链接查看主页 >> https://..."></textarea>
            </div>
            <div class="form-actions"><button class="primary-button">登记并生成采集方案</button></div>
          </form>
          <p class="panel-note">小红书短链只解析到最终主页；历史内容仍按“手动滚动到哪、采集到哪”的可见范围入库，不做后台全量抓取。</p>
        </section>
        <section class="panel">
          <h2 class="panel-title">添加账号</h2>
          <form id="source-form" class="form-grid">
            <div class="field"><label>名称</label><input name="name" required></div>
            <div class="field"><label>平台</label><select name="platform">${Object.entries(platformLabels).map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></div>
            <div class="field"><label>账号</label><input name="account"></div>
            <div class="field"><label>角色</label><select name="role"><option value="benchmark">对标</option><option value="material">素材</option><option value="comment">评论</option><option value="insight">洞察</option><option value="counter-example">反例</option></select></div>
            <div class="field full"><label>链接 / RSS</label><input name="url" required placeholder="https://"></div>
            <div class="field"><label>频率</label><select name="checkFrequency"><option value="daily">每天</option><option value="weekly">每周</option><option value="on-demand">按需</option></select></div>
            <div class="field"><label>采集方式</label><select name="collectionMethod"><option value="manual">手动导入</option><option value="browser-assisted">浏览器辅助</option><option value="public-rss">公开 RSS</option><option value="public-page">公开页面</option><option value="platform-export">平台导出</option><option value="research-only">仅研究</option></select></div>
            <div class="field"><label>互动中位数</label><input name="authorMedianEngagement" type="number" min="0" step="1"></div>
            <div class="field"><label>数据边界</label><select name="dataBoundary"><option value="public">公开</option><option value="own-account-export">自有账号导出</option><option value="manual-copy">人工复制</option><option value="research-only">仅研究</option></select></div>
            <div class="field full"><label>保留原因</label><textarea name="keepReason"></textarea></div>
            <div class="form-actions"><button class="primary-button" type="submit">保存账号</button></div>
          </form>
        </section>
        <section class="panel">
          <h2 class="panel-title">JSON 导入</h2>
          <form id="import-form" class="form-grid">
            <div class="field full"><label>导入文件</label><input name="file" type="file" accept="application/json,.json" required></div>
            <div class="form-actions"><button class="primary-button" type="submit">导入</button></div>
          </form>
        </section>
        <section class="panel">
          <div class="item-head">
            <h2 class="panel-title">本地投递箱</h2>
            <button type="button" class="small-button accent" data-action="scan-drop-folder">立即检查</button>
          </div>
          <p class="panel-note">drops/*.json · *.md · *.txt</p>
        </section>
        <section class="panel">
          <h2 class="panel-title">浏览器采集导入</h2>
          <form id="browser-capture-form" class="form-grid">
            <div class="field full"><label>来源账号</label><select name="sourceId">${sourceOptions()}</select></div>
            <div class="field full">
              <label>可见列表 JSON</label>
              <textarea name="items" rows="8" required placeholder='[{"title":"笔记标题","url":"https://...","engagement":"5.9万"}]'></textarea>
            </div>
            <div class="form-actions"><button class="primary-button" type="submit">导入 Inbox</button></div>
          </form>
          <p class="panel-note">小红书账号可先生成采集书签：手动滚动到目标范围后点击，只读取当前页面已加载的数据。</p>
        </section>
      </div>
      <section class="panel">
        <h2 class="panel-title">账号列表</h2>
        <div class="list">
          ${state.sources.length ? state.sources.map((source) => `
            <article class="item-card">
              <div class="item-head">
                <div>
                  <h3 class="item-title">${escapeHtml(source.name || source.account || "未命名账号")}</h3>
                  <a class="link" href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.url)}</a>
                </div>
                ${tag(source.lastRunStatus || "never-run", source.lastRunStatus === "ok" ? "accent" : source.lastRunStatus === "failed" ? "danger" : "")}
              </div>
              ${(() => {
                const control = controlRecordById(source.id);
                return control ? `
                  <div class="item-meta source-control-meta">
                    ${tag(controlStatusLabels[control.controlStatus] || control.controlStatus, controlStatusVariants[control.controlStatus] || "")}
                    ${tag(commandCoverageText(control), control.controlStatus === "complete" ? "accent" : control.controlStatus === "backfill" ? "warn" : "")}
                  </div>
                  <p class="item-note">指挥中心：${escapeHtml(control.nextAction || "暂无下一步")}</p>
                ` : "";
              })()}
              <div class="item-meta">
                ${tag(platformLabels[source.platform] || source.platform, "info")}
                ${tag(methodLabels[source.collectionMethod] || source.collectionMethod || "未设置")}
                ${tag(source.checkFrequency || "daily")}
                ${sourceScheduleTags(source)}
                ${source.authorMedianEngagement ? tag(`中位数 ${source.authorMedianEngagement} · 样本 ${source.engagementSampleCount || 0}`) : ""}
                ${source.coverage ? tag(
                  source.coverage.totalNotes
                    ? `已入库 ${source.coverage.collectedCount || 0}/${source.coverage.totalNotes}${source.coverage.percent === null ? "" : ` · ${source.coverage.percent}%`}`
                    : `本页最近加载 ${source.coverage.lastLoadedCount || 0} 条 · 总数待确认`,
                  source.coverage.status === "complete" ? "accent" : source.coverage.status === "partial" ? "warn" : ""
                ) : ""}
              </div>
              ${source.coverage ? `<p class="item-note">${escapeHtml(coverageLabels[source.coverage.status] || source.coverage.status)}；需要补历史时，在原主页继续向下滚动并重复点击采集书签。</p>` : ""}
              ${source.lastCollectionError ? `<p class="item-note danger-text">${escapeHtml(source.lastCollectionError)}</p>` : ""}
              ${source.keepReason ? `<p class="item-note">${escapeHtml(source.keepReason)}</p>` : ""}
              <div class="item-actions">
                <button type="button" class="small-button accent" data-action="run-source" data-id="${escapeHtml(source.id)}">运行采集</button>
                ${source.platform === "xiaohongshu" && source.collectionMethod === "browser-assisted" ? `
                  <a class="small-button accent" draggable="true" href="${escapeHtml(xhsBookmarkletHref(source.id))}" title="拖到浏览器书签栏">采集书签</a>
                  <button type="button" class="small-button" data-action="copy-xhs-collector" data-id="${escapeHtml(source.id)}">复制脚本</button>
                ` : ""}
              </div>
            </article>
          `).join("") : `<div class="empty">暂无账号</div>`}
        </div>
      </section>
    </div>
  `;
}

function renderInbox() {
  const funnel = state.runtime?.inbox;
  const filtered = state.signals.filter((signal) => {
    if (inboxFilter === "inbox") return signal.disposition === "inbox";
    if (inboxFilter === "unseen") return !signal.seen;
    return signal.disposition === inboxFilter;
  });
  const filters = [["inbox", "待处理"], ["unseen", "未看"], ["watch", "观察"], ["dissect", "拆解"], ["discard", "丢弃"]];
  const filterCounts = {
    inbox: funnel?.pending ?? 0,
    unseen: funnel?.unseenCount ?? state.signals.filter((signal) => !signal.seen).length,
    watch: funnel?.counts?.watch ?? 0,
    dissect: funnel?.counts?.dissect ?? 0,
    discard: funnel?.counts?.discard ?? 0
  };
  const visibleSignals = [...filtered].sort((a, b) => (
    signalStrength(b) - signalStrength(a)
    || signalTime(b) - signalTime(a)
    || String(a.title || "").localeCompare(String(b.title || ""), "zh-CN")
  ));
  const sourceRecords = (funnel?.sources || [])
    .filter((record) => record.total > 0)
    .slice(0, 8);

  return `
    <section class="section-head">
      <div>
        <h2 class="section-title">Inbox</h2>
        <p class="section-subtitle">每条信号必须有去向</p>
      </div>
    </section>
    <div class="metric-grid">
      <div class="metric"><div class="metric-value">${funnel?.pending ?? 0}</div><div class="metric-label">待处理信号</div></div>
      <div class="metric"><div class="metric-value">${funnel?.decided ?? 0}</div><div class="metric-label">已判断信号</div></div>
      <div class="metric"><div class="metric-value">${funnel?.actionable ?? 0}</div><div class="metric-label">已推进信号</div></div>
      <div class="metric"><div class="metric-value">${funnel?.pushRate === null || funnel?.pushRate === undefined ? "--" : `${funnel.pushRate}%`}</div><div class="metric-label">推进率</div></div>
    </div>
    <div class="filter-row">${filters.map(([value, label]) => `<button type="button" class="small-button ${inboxFilter === value ? "accent" : ""}" data-action="filter-inbox" data-value="${value}">${label} ${filterCounts[value] ?? 0}</button>`).join("")}</div>
    ${sourceRecords.length ? `
      <section class="panel inbox-funnel-panel">
        <h2 class="panel-title">来源清零质量</h2>
        <p class="panel-note">推进率 = 已判断信号里进入观察、拆解、素材、选题或生产的比例。</p>
        <div class="source-funnel-list">
          ${sourceRecords.map((record) => `
            <div class="source-funnel-row">
              <div class="source-funnel-name">${escapeHtml(record.name)}</div>
              <div class="source-funnel-stats">
                ${tag(`待处理 ${record.pending}`, record.pending ? "warn" : "accent")}
                ${tag(`已判断 ${record.decided}`)}
                ${tag(`已推进 ${record.actionable}`, record.actionable ? "accent" : "")}
                ${tag(record.pushRate === null || record.pushRate === undefined ? "待判断" : `推进率 ${record.pushRate}%`)}
              </div>
            </div>
          `).join("")}
        </div>
      </section>
    ` : ""}
    <div class="list">
      ${visibleSignals.length ? visibleSignals.map((signal) => {
        const source = sourceById(signal.sourceId);
        const medianIsAuto = Number(source?.engagementSampleCount || 0) >= 3;
        const median = signal.authorMedianEngagement;
        const multiple = signal.relativeMultiple;
        const contentText = String(signal.contentText || "").trim();
        const imageDescriptions = Array.isArray(signal.imageDescriptions) ? signal.imageDescriptions : [];
        const dataPoints = Array.isArray(signal.dataPointCandidates) ? signal.dataPointCandidates : [];
        return `
          <article class="item-card" data-signal-card="${escapeHtml(signal.id)}">
            <div class="item-head">
              <div>
                <h3 class="item-title">${escapeHtml(signal.title || signal.note || "未命名信号")}</h3>
                <a class="link" href="${escapeHtml(signal.url)}" target="_blank" rel="noreferrer">${escapeHtml(signal.url)}</a>
              </div>
              ${tag(dispositionLabels[signal.disposition] || signal.disposition, signal.disposition === "inbox" ? "warn" : "accent")}
            </div>
            <div class="item-meta">
              ${tag(platformLabels[signal.platform] || signal.platform, "info")}
              ${tag(source?.name || source?.account || "未关联账号")}
              ${tag(`发布 ${displayDate(signal.publishedAt)}`)}
              ${tag(`互动 ${signal.engagement ?? "未填"}`)}
              ${signal.automationTier ? tag(automationTierLabels[signal.automationTier] || signal.automationTier, signal.automationTier === "high-potential" ? "accent" : "") : ""}
              ${median !== null && median !== undefined ? tag(`中位数 ${median}`) : ""}
              ${multiple !== null && multiple !== undefined ? tag(`${multiple}x`, "accent") : ""}
              ${source ? tag(`样本 ${source.engagementSampleCount || 0}`) : ""}
              ${contentText ? tag(`正文 ${contentText.length} 字`) : ""}
              ${imageDescriptions.length ? tag(`图片描述 ${imageDescriptions.length}`) : ""}
              ${dataPoints.length ? tag(`数据口径 ${dataPoints.length}`, "warn") : ""}
            </div>
            ${signal.note ? `<p class="item-note">${escapeHtml(signal.note)}</p>` : ""}
            ${(contentText || imageDescriptions.length || dataPoints.length) ? `
              <details class="details">
                <summary>拆解线索</summary>
                ${dataPoints.length ? `
                  <div class="extract-block">
                    <p class="extract-label">数据口径候选</p>
                    <ul class="extract-list">${dataPoints.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
                  </div>
                ` : ""}
                ${imageDescriptions.length ? `
                  <div class="extract-block">
                    <p class="extract-label">图片描述</p>
                    <ul class="extract-list">${imageDescriptions.map((item) => `<li>${escapeHtml(item.description)}</li>`).join("")}</ul>
                  </div>
                ` : ""}
                ${contentText ? `
                  <div class="extract-block">
                    <p class="extract-label">正文全文</p>
                    <p class="extract-text">${escapeHtml(contentText)}</p>
                  </div>
                ` : ""}
              </details>
            ` : ""}
            <details class="details">
              <summary>编辑信号</summary>
              <form class="form-grid" data-edit-form="signals" data-id="${escapeHtml(signal.id)}">
                <div class="field full"><label>标题</label><input name="title" value="${escapeHtml(signal.title || "")}" required></div>
                <div class="field"><label>作者</label><input name="author" value="${escapeHtml(signal.author || "")}"></div>
                <div class="field"><label>去向</label>
                  <select name="disposition">
                    ${Object.entries(dispositionLabels).map(([value, label]) => `<option value="${escapeHtml(value)}" ${signal.disposition === value ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}
                  </select>
                </div>
                <div class="field full"><label>判断备注</label><textarea name="note">${escapeHtml(signal.note || "")}</textarea></div>
                <div class="form-actions"><button class="primary-button" type="submit">保存信号</button></div>
              </form>
            </details>
            <div class="inline-grid">
              <input name="engagement" type="number" min="0" placeholder="互动" value="${signal.engagement ?? ""}">
              <input name="authorMedianEngagement" type="number" min="0" placeholder="中位数" value="${signal.authorMedianEngagement ?? ""}" ${medianIsAuto ? "readonly title=\"自动计算\"" : ""}>
              <input name="relativeMultiple" type="number" min="0" step="0.1" placeholder="倍数" value="${signal.relativeMultiple ?? ""}" readonly title="自动计算">
            </div>
            <div class="item-actions">
              <button type="button" class="small-button" data-action="save-signal" data-id="${escapeHtml(signal.id)}">保存数据</button>
              <button type="button" class="small-button" data-action="disposition" data-id="${escapeHtml(signal.id)}" data-value="dissect">拆解</button>
              <button type="button" class="small-button" data-action="disposition" data-id="${escapeHtml(signal.id)}" data-value="watch">观察</button>
              <button type="button" class="danger-button" data-action="disposition" data-id="${escapeHtml(signal.id)}" data-value="discard">丢弃</button>
            </div>
            <details class="details workflow-transition">
              <summary>转入工作流</summary>
              <div class="item-actions">
                <button type="button" class="small-button" data-action="signal-material" data-id="${escapeHtml(signal.id)}">入素材</button>
                <button type="button" class="small-button" data-action="signal-topic" data-id="${escapeHtml(signal.id)}">入选题</button>
                <button type="button" class="small-button accent" data-action="signal-produce" data-id="${escapeHtml(signal.id)}">直接生产</button>
              </div>
            </details>
          </article>
        `;
      }).join("") : `<div class="empty">当前筛选无信号</div>`}
    </div>
  `;
}

function renderMaterials() {
  const query = materialQuery.trim().toLowerCase();
  const filtered = state.materials.filter((material) => {
    if (!query) return true;
    return [material.excerpt, material.whyValuable, material.author, material.sourceUrl, material.possibleUse]
      .some((value) => String(value || "").toLowerCase().includes(query));
  });

  return `
    <section class="section-head">
      <div>
        <h2 class="section-title">素材与热评</h2>
        <p class="section-subtitle">观点 · 案例 · 数据 · 金句 · 热评</p>
      </div>
      <input class="search-input" id="material-search" placeholder="搜索素材" value="${escapeHtml(materialQuery)}">
    </section>
    <div class="split">
      <section class="panel">
        <h2 class="panel-title">添加素材</h2>
        <form id="material-form" class="form-grid">
          <div class="field"><label>平台</label><select name="platform">${Object.entries(platformLabels).map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></div>
          <div class="field"><label>类型</label><select name="type"><option value="opinion">观点</option><option value="case">案例</option><option value="data">数据</option><option value="quote">金句</option><option value="hot-comment">热评</option><option value="counter-example">反例</option><option value="lead">线索</option></select></div>
          <div class="field full"><label>来源链接</label><input name="sourceUrl" placeholder="https://"></div>
          <div class="field"><label>作者 / 评论者</label><input name="author"></div>
          <div class="field"><label>可用方向</label><select name="possibleUse"><option value="hook">开头钩子</option><option value="evidence">论证证据</option><option value="case">案例</option><option value="title">标题</option><option value="audience-language">受众语言</option></select></div>
          <div class="field full"><label>原文摘录</label><textarea name="excerpt" required></textarea></div>
          <div class="field full"><label>为什么好</label><textarea name="whyValuable" required></textarea></div>
          <div class="field full"><label>引用注意</label><input name="citationNote"></div>
          <div class="form-actions"><button class="primary-button" type="submit">保存素材</button></div>
        </form>
      </section>
      <section class="panel">
        <h2 class="panel-title">素材列表</h2>
        <div class="list">
          ${filtered.length ? filtered.map((material) => `
            <article class="item-card">
              <div class="item-head">
                <h3 class="item-title">${escapeHtml(material.author || "未记录作者")}</h3>
                ${tag(material.type, "info")}
              </div>
              <p class="item-body">${escapeHtml(material.excerpt)}</p>
              <p class="item-note">${escapeHtml(material.whyValuable)}</p>
              <div class="item-meta">
                ${tag(material.possibleUse || "未标注用途")}
                ${material.sourceUrl ? tag("有来源") : tag("缺来源", "warn")}
              </div>
              <details class="details">
                <summary>编辑素材</summary>
                <form class="form-grid" data-edit-form="materials" data-id="${escapeHtml(material.id)}">
                  <div class="field"><label>平台</label>
                    <select name="platform">
                      ${Object.entries(platformLabels).map(([value, label]) => `<option value="${escapeHtml(value)}" ${material.platform === value ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}
                    </select>
                  </div>
                  <div class="field"><label>类型</label>
                    <select name="type">
                      ${[["opinion", "观点"], ["case", "案例"], ["data", "数据"], ["quote", "金句"], ["hot-comment", "热评"], ["counter-example", "反例"], ["lead", "线索"]].map(([value, label]) => `<option value="${escapeHtml(value)}" ${material.type === value ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}
                    </select>
                  </div>
                  <div class="field"><label>作者 / 评论者</label><input name="author" value="${escapeHtml(material.author || "")}"></div>
                  <div class="field"><label>可用方向</label>
                    <select name="possibleUse">
                      ${[["hook", "开头钩子"], ["evidence", "论证证据"], ["case", "案例"], ["title", "标题"], ["audience-language", "受众语言"]].map(([value, label]) => `<option value="${escapeHtml(value)}" ${material.possibleUse === value ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}
                    </select>
                  </div>
                  <div class="field full"><label>原文摘录</label><textarea name="excerpt" required>${escapeHtml(material.excerpt || "")}</textarea></div>
                  <div class="field full"><label>为什么好</label><textarea name="whyValuable" required>${escapeHtml(material.whyValuable || "")}</textarea></div>
                  <div class="field full"><label>引用注意</label><input name="citationNote" value="${escapeHtml(material.citationNote || "")}"></div>
                  <div class="form-actions"><button class="primary-button" type="submit">保存素材</button></div>
                </form>
              </details>
              <div class="item-actions">
                <button type="button" class="small-button accent" data-action="material-topic" data-id="${escapeHtml(material.id)}">转选题</button>
              </div>
            </article>
          `).join("") : `<div class="empty">暂无素材</div>`}
        </div>
      </section>
    </div>
  `;
}

function renderTopics() {
  return `
    <section class="section-head">
      <div><h2 class="section-title">选题池</h2><p class="section-subtitle">目标读者 · 核心观点 · 最小版本</p></div>
    </section>
    <div class="split">
      <section class="panel">
        <h2 class="panel-title">添加选题</h2>
        <form id="topic-form" class="form-grid">
          <div class="field full"><label>标题</label><input name="title" required></div>
          <div class="field full"><label>核心观点</label><textarea name="coreIdea" required></textarea></div>
          <div class="field full"><label>目标读者</label><input name="targetReader" required></div>
          <div class="field full"><label>最小可发布版本</label><input name="minimalPublishableVersion" required></div>
          <div class="form-actions"><button class="primary-button" type="submit">保存选题</button></div>
        </form>
      </section>
      <section class="panel">
        <h2 class="panel-title">选题列表</h2>
        <div class="list">
          ${state.topics.length ? state.topics.map((topic) => `
            <article class="item-card">
              <div class="item-head">
                <h3 class="item-title">${escapeHtml(topic.title)}</h3>
                ${tag(stageLabels[topic.stage] || topic.stage, topic.stage === "ready-to-publish" ? "warn" : "accent")}
              </div>
              <p class="item-body">${escapeHtml(topic.coreIdea || "")}</p>
              <div class="item-meta">${tag(topic.targetReader || "读者待补")}${tag(topic.minimalPublishableVersion || "最小版本待补")}</div>
              <details class="details">
                <summary>编辑选题</summary>
                <form class="form-grid" data-edit-form="topics" data-id="${escapeHtml(topic.id)}">
                  <div class="field full"><label>标题</label><input name="title" value="${escapeHtml(topic.title || "")}" required></div>
                  <div class="field full"><label>核心观点</label><textarea name="coreIdea" required>${escapeHtml(topic.coreIdea || "")}</textarea></div>
                  <div class="field full"><label>目标读者</label><input name="targetReader" value="${escapeHtml(topic.targetReader || "")}" required></div>
                  <div class="field full"><label>最小可发布版本</label><input name="minimalPublishableVersion" value="${escapeHtml(topic.minimalPublishableVersion || "")}" required></div>
                  <div class="form-actions"><button class="primary-button" type="submit">保存选题</button></div>
                </form>
              </details>
              <div class="item-actions"><button type="button" class="small-button accent" data-action="advance-topic" data-id="${escapeHtml(topic.id)}">下一阶段</button></div>
            </article>
          `).join("") : `<div class="empty">暂无选题</div>`}
        </div>
      </section>
    </div>
  `;
}

function renderChecks(topic, kind, labels) {
  const values = topic[kind] || {};
  return Object.entries(labels).map(([key, label]) => `
    <label class="check-item">
      <input type="checkbox" data-check-kind="${kind}" data-key="${key}" ${values[key] ? "checked" : ""}>
      <span>${escapeHtml(label)}</span>
    </label>
  `).join("");
}

function renderProduction() {
  const topics = state.topics.filter((topic) => !["published", "reviewed"].includes(topic.stage));
  return `
    <section class="section-head"><div><h2 class="section-title">生产台</h2><p class="section-subtitle">七项检查 · 四个人工关卡</p></div></section>
    <div class="split">
      <div>
        <section class="panel">
          <h2 class="panel-title">稿子版本</h2>
          <form id="script-form" class="form-grid">
            <div class="field full"><label>选题</label><select name="topicId">${topicOptions()}</select></div>
            <div class="field"><label>工具</label><select name="tool"><option>Gemini</option><option>Claude Opus</option><option>人工</option><option>其他</option></select></div>
            <div class="field"><label>版本说明</label><input name="versionNote" required></div>
            <div class="field full"><label>输入摘要</label><textarea name="inputSummary"></textarea></div>
            <div class="field full"><label>稿子</label><textarea name="text" required></textarea></div>
            <div class="form-actions"><button class="primary-button" type="submit">保存版本</button></div>
          </form>
        </section>
      </div>
      <div>
        <section class="panel">
          <h2 class="panel-title">生产检查</h2>
          <div class="list">
            ${topics.length ? topics.map((topic) => `
              <article class="item-card" data-production-card="${escapeHtml(topic.id)}">
                <div class="item-head"><h3 class="item-title">${escapeHtml(topic.title)}</h3>${tag(stageLabels[topic.stage] || topic.stage, "accent")}</div>
                <div class="check-grid">${renderChecks(topic, "productionChecks", productionCheckLabels)}</div>
                <div class="check-grid">${renderChecks(topic, "gates", gateLabels)}</div>
                <div class="item-actions"><button type="button" class="small-button accent" data-action="advance-topic" data-id="${escapeHtml(topic.id)}">下一阶段</button></div>
                <details class="details">
                  <summary>稿子版本</summary>
                  <div class="list">
                    ${state.scripts.filter((script) => script.topicId === topic.id).slice(0, 3).map((script) => `
                      <article class="item-card">
                        <div class="item-head"><h3 class="item-title">${escapeHtml(script.versionNote)}</h3>${tag(script.tool || "未记工具", "info")}</div>
                        <p class="item-note">${displayDate(script.createdAt)}</p>
                      </article>
                    `).join("") || `<div class="empty">暂无稿子</div>`}
                  </div>
                </details>
              </article>
            `).join("") : `<div class="empty">暂无生产中选题</div>`}
          </div>
        </section>
      </div>
    </div>
  `;
}

function renderPublish() {
  return `
    <section class="section-head"><div><h2 class="section-title">发布台账</h2><p class="section-subtitle">平台逐列追踪</p></div></section>
    ${renderPublishBoard()}
    <div class="split">
      <section class="panel">
        <h2 class="panel-title">添加发布记录</h2>
        <form id="publication-form" class="form-grid">
          <div class="field full"><label>选题</label><select name="topicId">${topicOptions()}</select></div>
          <div class="field"><label>平台</label><select name="platform"><option value="douyin">抖音</option><option value="xiaohongshu">小红书</option><option value="wechat">公众号</option><option value="x">X</option></select></div>
          <div class="field"><label>状态</label><select name="status"><option value="not-ready">未准备</option><option value="manual">待人工</option><option value="published">已发</option><option value="failed">失败</option><option value="skipped">跳过</option></select></div>
          <div class="field"><label>发布时间</label><input name="publishedAt" type="datetime-local"></div>
          <div class="field full"><label>链接</label><input name="url"></div>
          <div class="field full"><label>失败 / 跳过原因</label><input name="failureReason"></div>
          <div class="field full"><label>下一步</label><input name="nextAction"></div>
          <div class="form-actions"><button class="primary-button" type="submit">保存记录</button></div>
        </form>
      </section>
      <section class="panel">
        <h2 class="panel-title">平台状态</h2>
        <div class="list">
          ${state.publications.length ? [...state.publications].sort(comparePublications).map((item) => {
            const topic = topicById(item.topicId);
            return `
              <article class="item-card">
                <div class="item-head"><h3 class="item-title">${escapeHtml(topic?.title || "未关联选题")}</h3>${tag(platformLabels[item.platform] || item.platform, "info")}</div>
                <div class="item-meta">${tag(publicationStatusLabels[item.status || "not-ready"] || item.status, publicationStatusVariants[item.status || "not-ready"] || "")}${tag(displayDate(item.publishedAt))}</div>
                ${item.failureReason ? `<p class="item-note">${escapeHtml(item.failureReason)}</p>` : ""}
                ${item.nextAction ? `<p class="item-note">下一步：${escapeHtml(item.nextAction)}</p>` : ""}
              </article>
            `;
          }).join("") : `<div class="empty">暂无发布记录</div>`}
        </div>
      </section>
    </div>
  `;
}

function comparePublications(a, b) {
  const rank = (item) => publicationStatusOrder.indexOf(item.status || "not-ready");
  return rank(a) - rank(b)
    || new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime();
}

function renderPublishBoard() {
  const rows = publicationPlatforms.map((platform) => {
    const records = state.publications.filter((item) => item.platform === platform);
    const published = records.filter((item) => item.status === "published").length;
    const blocked = records.filter((item) => ["manual", "failed"].includes(item.status)).length;
    const percent = records.length ? Math.round((published / records.length) * 100) : 0;
    const statusTags = publicationStatusOrder
      .map((status) => ({ status, count: records.filter((item) => (item.status || "not-ready") === status).length }))
      .filter((entry) => entry.count > 0)
      .map((entry) => tag(`${publicationStatusLabels[entry.status]} ${entry.count}`, publicationStatusVariants[entry.status] || ""))
      .join("");

    return `
      <div class="publish-row">
        <div class="publish-platform">
          <strong>${platformLabels[platform]}</strong>
          <small>${records.length ? `记录 ${records.length}` : "未建记录"}</small>
        </div>
        <div class="publish-status">${statusTags || tag("未建记录")}</div>
        <div class="publish-progress">
          <div class="progress-track" role="img" aria-label="${platformLabels[platform]}发布完成度 ${percent}%"><span style="width:${percent}%"></span></div>
          <small>${records.length ? `${percent}%` : "--"}</small>
        </div>
        ${blocked ? tag(`阻塞 ${blocked}`, "danger") : ""}
      </div>
    `;
  }).join("");

  return `
    <section class="panel publish-board" aria-label="平台队列">
      <div class="item-head">
        <div><h2 class="panel-title">平台队列</h2><p class="panel-note">先看阻塞，再看各平台缺口</p></div>
      </div>
      ${rows}
    </section>
  `;
}

function renderReview() {
  return `
    <section class="section-head"><div><h2 class="section-title">复盘</h2><p class="section-subtitle">数据 · 评论 · 下一条改法</p></div></section>
    <div class="split">
      <section class="panel">
        <h2 class="panel-title">添加复盘</h2>
        <form id="review-form" class="form-grid">
          <div class="field full"><label>选题</label><select name="topicId">${topicOptions()}</select></div>
          <div class="field"><label>触达</label><input name="reach" type="number" min="0"></div>
          <div class="field"><label>互动</label><input name="engagement" type="number" min="0"></div>
          <div class="field full"><label>当时假设</label><textarea name="hypothesis" required></textarea></div>
          <div class="field full"><label>符合假设</label><select name="hypothesisMet"><option value="true">符合</option><option value="false">不符合</option><option value="unclear">不确定</option></select></div>
          <div class="field full"><label>保留</label><textarea name="keep"></textarea></div>
          <div class="field full"><label>砍掉</label><textarea name="cut"></textarea></div>
          <div class="field full"><label>下一条改法</label><select name="nextMove"><option value="replicate">完全复刻</option><option value="borrow">借结构</option><option value="stop">停止</option></select></div>
          <div class="field full"><label>核心评论</label><textarea name="comments"></textarea></div>
          <div class="form-actions"><button class="primary-button" type="submit">保存复盘</button></div>
        </form>
      </section>
      <section class="panel">
        <h2 class="panel-title">摩擦记录</h2>
        <form id="friction-form" class="form-grid">
          <div class="field full"><label>卡点</label><input name="stuckAt" required></div>
          <div class="field"><label>耗时</label><input name="minutes" type="number" min="0"></div>
          <div class="field"><label>可模板化</label><select name="templateCandidate"><option value="false">否</option><option value="true">是</option></select></div>
          <div class="field full"><label>备注</label><textarea name="note"></textarea></div>
          <div class="form-actions"><button class="primary-button" type="submit">记录</button></div>
        </form>
      </section>
      ${renderFrictionSummary()}
      <section class="panel">
        <h2 class="panel-title">复盘记录</h2>
        <div class="list">
          ${state.reviews.length ? state.reviews.map((review) => {
            const topic = topicById(review.topicId);
            return `
              <article class="item-card">
                <div class="item-head"><h3 class="item-title">${escapeHtml(topic?.title || "未关联选题")}</h3>${tag(review.nextMove || "未记改法", "accent")}</div>
                <div class="item-meta">${tag(`触达 ${review.reach || 0}`)}${tag(`互动 ${review.engagement || 0}`)}${tag(review.hypothesisMet || "unclear", "info")}</div>
                ${review.keep ? `<p class="item-note">保留：${escapeHtml(review.keep)}</p>` : ""}
                ${review.cut ? `<p class="item-note">砍掉：${escapeHtml(review.cut)}</p>` : ""}
              </article>
            `;
          }).join("") : `<div class="empty">暂无复盘</div>`}
        </div>
      </section>
    </div>
  `;
}

function recentFrictionLog(days = 3) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return state.frictionLog
    .map((item) => ({ ...item, createdAtValue: new Date(item.createdAt || 0).getTime() }))
    .filter((item) => Number.isFinite(item.createdAtValue) && item.createdAtValue >= cutoff)
    .sort((a, b) => b.createdAtValue - a.createdAtValue);
}

function renderFrictionSummary() {
  const recent = recentFrictionLog(3);
  const minutes = recent.reduce((total, item) => total + (Number.isFinite(Number(item.minutes)) ? Number(item.minutes) : 0), 0);
  const templateCandidates = recent.filter((item) => item.templateCandidate === true).length;

  return `
    <section class="panel friction-summary">
      <div class="item-head">
        <div><h2 class="panel-title">近 3 天摩擦</h2><p class="panel-note">工作台验收期重点看重复卡点</p></div>
        <div class="item-meta">
          ${tag(`记录 ${recent.length}`)}
          ${tag(`耗时 ${minutes} 分钟`, minutes ? "warn" : "")}
          ${tag(`可模板化 ${templateCandidates}`, templateCandidates ? "accent" : "")}
        </div>
      </div>
      <div class="list">
        ${recent.length ? recent.slice(0, 5).map((item) => `
          <article class="item-card">
            <div class="item-head">
              <h3 class="item-title">${escapeHtml(item.stuckAt)}</h3>
              ${tag(item.minutes ? `${item.minutes} 分钟` : "未记耗时", item.minutes ? "warn" : "")}
            </div>
            <div class="item-meta">${tag(displayDate(item.createdAt))}${item.templateCandidate ? tag("可模板化", "accent") : ""}</div>
            ${item.note ? `<p class="item-note">${escapeHtml(item.note)}</p>` : ""}
          </article>
        `).join("") : `<div class="empty">近 3 天暂无摩擦记录</div>`}
      </div>
    </section>
  `;
}

function renderRuns() {
  const dueCount = state.sources.filter(isDueSource).length;
  const manualCount = state.sources.filter((source) => source.automationStatus === "manual-required").length;
  const retryingCount = state.sources.filter((source) => source.automationStatus === "retrying").length;
  const failedRuns = state.collectionRuns.filter((run) => run.status === "failed").length;

  return `
    <section class="section-head">
      <div><h2 class="section-title">采集运行</h2><p class="section-subtitle">状态 · 数量 · 失败原因 · 人工下一步</p></div>
      <div class="head-actions">
        <button type="button" class="small-button accent" data-action="run-automation">检查到期采集</button>
        <button type="button" class="small-button" data-action="run-all">强制检查全部</button>
      </div>
    </section>
    <div class="metric-grid">
      <div class="metric"><div class="metric-value">${dueCount}</div><div class="metric-label">到期任务</div></div>
      <div class="metric"><div class="metric-value">${manualCount}</div><div class="metric-label">待人工账号</div></div>
      <div class="metric"><div class="metric-value">${retryingCount}</div><div class="metric-label">重试中账号</div></div>
      <div class="metric"><div class="metric-value">${failedRuns}</div><div class="metric-label">失败运行记录</div></div>
    </div>
    <section class="panel">
      <div class="table-wrap">
        <table class="run-table">
          <thead><tr><th>时间</th><th>账号</th><th>触发</th><th>状态</th><th>发现 / 新增</th><th>覆盖</th><th>失败原因</th><th>下一步</th></tr></thead>
          <tbody>
            ${state.collectionRuns.length ? state.collectionRuns.slice(0, 50).map((run) => `
              <tr>
                <td class="mono">${escapeHtml(displayDate(run.startedAt))}</td>
                <td>${escapeHtml(sourceById(run.sourceId)?.name || run.sourceId)}</td>
                <td>${escapeHtml(triggerLabels[run.trigger] || run.trigger || "手动")}</td>
                <td>${escapeHtml(run.status)}</td>
                <td>${run.found || 0} / ${run.created || 0}</td>
                <td>${run.profileNoteCount ? `${run.collectedCount || 0}/${run.profileNoteCount}${run.coveragePercent === null ? "" : ` · ${run.coveragePercent}%`}` : run.loadedCount ? `本页 ${run.loadedCount}` : "-"}</td>
                <td>${escapeHtml(run.failureReason || "-")}</td>
                <td>${escapeHtml(run.nextAction || "-")}</td>
              </tr>
            `).join("") : `<tr><td colspan="8"><div class="empty">暂无运行记录</div></td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function agentTaskVariant(status) {
  if (status === "running") return "info";
  if (status === "result-ready") return "accent";
  if (status === "imported") return "";
  return "warn";
}

function formatBytes(size) {
  const value = Number(size || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

async function loadBackups() {
  const result = await api("/api/backups");
  backups = result.backups;
  backupRoot = result.backupRoot;
  backupRetentionLimit = result.retentionLimit;
  if (currentView === "system") render();
}

function renderBackups() {
  return `
    <section class="section-head">
      <div><h2 class="section-title">备份</h2><p class="section-subtitle">${escapeHtml(backupRoot || "BACKUP_DIR 未配置")} · 保留 ${backupRetentionLimit} 份</p></div>
      <div class="head-actions">
        <button type="button" class="small-button" data-action="refresh-backups">刷新列表</button>
        <button type="button" class="small-button accent" data-action="create-backup">立即备份</button>
      </div>
    </section>
    <section class="panel">
      <h2 class="panel-title">备份列表</h2>
      <div class="list">
        ${backups === null ? `<div class="empty">正在读取备份</div>` : ""}
        ${backups !== null && !backups.length ? `<div class="empty">暂无备份</div>` : ""}
        ${(backups || []).map((backup) => `
          <article class="item-card">
            <div class="item-head">
              <h3 class="item-title mono">${escapeHtml(backup.filename || backup.id)}</h3>
              ${backup.invalid ? tag("无效", "danger") : tag(backupReasonLabels[backup.reason] || backup.reason || "未知")}
            </div>
            ${backup.invalid ? "" : `
              <div class="item-meta">
                ${tag(displayDate(backup.createdAt))}
                ${tag(formatBytes(backup.size))}
                ${tag(`账号 ${backup.counts.sources}`)}
                ${tag(`信号 ${backup.counts.signals}`)}
                ${tag(`素材 ${backup.counts.materials}`)}
                ${tag(`选题 ${backup.counts.topics}`)}
              </div>
              <div class="item-actions">
                <button type="button" class="small-button warn-button" data-action="restore-backup" data-id="${escapeHtml(backup.filename)}">恢复这份</button>
              </div>
            `}
          </article>
        `).join("")}
      </div>
      <p class="panel-note">备份包含账号链接、评论摘录和个人素材，只保存在本机。恢复会先自动保存当前状态。</p>
    </section>
  `;
}

function renderAgents() {
  const tasks = state.agentTasks || [];
  const counts = {
    outbox: tasks.filter((task) => task.status === "outbox").length,
    running: tasks.filter((task) => task.status === "running").length,
    ready: tasks.filter((task) => task.status === "result-ready").length,
    imported: tasks.filter((task) => task.status === "imported").length
  };
  const driveConnected = Boolean(state.settings.driveRoot);

  return `
    <section class="section-head">
      <div><h2 class="section-title">Agent 桥接</h2><p class="section-subtitle">任务包 · 云盘镜像 · 结果回流</p></div>
      <div class="head-actions">
        <button type="button" class="small-button" data-action="scan-agent-results">扫描结果</button>
      </div>
    </section>
    <div class="metric-grid">
      <div class="metric"><div class="metric-value">${counts.outbox}</div><div class="metric-label">待处理任务</div></div>
      <div class="metric"><div class="metric-value">${counts.running}</div><div class="metric-label">本机运行中</div></div>
      <div class="metric"><div class="metric-value">${counts.ready}</div><div class="metric-label">结果待导入</div></div>
      <div class="metric"><div class="metric-value">${counts.imported}</div><div class="metric-label">已导入</div></div>
    </div>
    <div class="split">
      <div>
        <section class="panel">
          <h2 class="panel-title">新建 Agent 任务</h2>
          <form id="agent-task-form" class="form-grid">
            <div class="field"><label>Agent</label><select name="agent">${Object.entries(agentLabels).map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></div>
            <div class="field"><label>任务类型</label><select name="kind">${Object.entries(agentTaskKindLabels).map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></div>
            <div class="field full"><label>选题</label><select name="topicId"><option value="">不绑定选题</option>${state.topics.map((topic) => `<option value="${escapeHtml(topic.id)}">${escapeHtml(topic.title)}</option>`).join("")}</select></div>
            <div class="field full"><label>任务名</label><input name="title" required></div>
            <div class="field full"><label>目标</label><textarea name="objective" required></textarea></div>
            <div class="field full"><label>输出要求</label><textarea name="outputRequirements"></textarea></div>
            <div class="field full">
              <label class="checkbox-option">
                <input type="checkbox" name="mirrorToDrive" ${driveConnected ? "" : "disabled"}>
                <span>同步任务包到 Google Drive（默认仅保存在本机）</span>
              </label>
            </div>
            <div class="form-actions"><button class="primary-button" type="submit">生成任务包</button></div>
          </form>
        </section>
        <section class="panel">
          <div class="item-head">
            <h2 class="panel-title">Google Drive</h2>
            ${tag(driveConnected ? "已连接" : "未连接", driveConnected ? "accent" : "warn")}
          </div>
          <form id="agent-drive-form" class="form-grid">
            <div class="field full"><label>本地同步目录</label><input name="driveRoot" placeholder="C:\\Users\\you\\Google Drive" value="${escapeHtml(state.settings.driveRoot || "")}" required></div>
            <div class="form-actions"><button class="primary-button" type="submit">保存连接</button></div>
          </form>
          <p class="panel-note">${driveConnected ? escapeHtml(state.settings.driveRoot) : "未配置时仅使用本地 bridge/"}</p>
        </section>
      </div>
      <section class="panel">
        <h2 class="panel-title">任务列表</h2>
        <div class="list">
          ${tasks.length ? tasks.map((task) => `
            <article class="item-card">
              <div class="item-head">
                <h3 class="item-title">${escapeHtml(task.title)}</h3>
                ${tag(agentTaskStatusLabels[task.status] || task.status, agentTaskVariant(task.status))}
              </div>
              <p class="item-body">${escapeHtml(task.objective)}</p>
              <div class="item-meta">
                ${tag(agentLabels[task.agent] || task.agent, "info")}
                ${tag(agentTaskKindLabels[task.kind] || task.kind)}
                ${tag(task.driveStatus === "synced" ? "Drive 已同步" : task.driveStatus === "not-configured" ? "仅本地" : task.driveStatus)}
                ${task.topicId ? tag(topicById(task.topicId)?.title || "选题已删除") : tag("未绑选题")}
              </div>
              ${task.lastError ? `<p class="item-note danger-text">${escapeHtml(task.lastError)}</p>` : ""}
              <details class="details">
                <summary>上下文与结果</summary>
                <p class="item-note">${escapeHtml(task.contextDigest)}</p>
                ${task.resultText ? `<p class="extract-text">${escapeHtml(task.resultText)}</p>` : `<div class="empty">暂无结果</div>`}
                <p class="mono item-note">${escapeHtml(task.outboxPath || "")}</p>
              </details>
              <div class="item-actions">
                ${["codex", "claude"].includes(task.agent) && task.status === "outbox" ? `<button type="button" class="small-button accent" data-action="run-agent-task" data-id="${escapeHtml(task.id)}">本机运行</button>` : ""}
                <button type="button" class="small-button" data-action="copy-agent-prompt" data-id="${escapeHtml(task.id)}">复制任务</button>
                <button type="button" class="small-button" data-action="copy-agent-path" data-id="${escapeHtml(task.id)}">复制目录</button>
                ${task.status === "result-ready" ? `<button type="button" class="small-button accent" data-action="import-agent-result" data-id="${escapeHtml(task.id)}">导入结果</button>` : ""}
              </div>
            </article>
          `).join("") : `<div class="empty">暂无 Agent 任务</div>`}
        </div>
      </section>
    </div>
  `;
}

async function saveRecord(type, record) {
  await api("/api/record", "POST", { type, record });
  await loadState();
}

async function updateRecord(type, recordId, patch) {
  await api("/api/update", "POST", { type, id: recordId, patch });
  await loadState();
}

async function signalToMaterial(signalId) {
  const signal = state.signals.find((item) => item.id === signalId);
  if (!signal) return;
  const dataPoint = Array.isArray(signal.dataPointCandidates) ? signal.dataPointCandidates[0] : "";
  const excerpt = String(signal.contentText || "").trim().slice(0, 600)
    || signal.title
    || signal.note
    || signal.url;
  await saveRecord("materials", {
    sourceUrl: signal.url,
    platform: signal.platform,
    author: signal.author,
    type: "lead",
    excerpt,
    whyValuable: "待判断",
    possibleUse: "evidence",
    citationNote: dataPoint
      ? `包含自动抽取数据口径候选，未经人工核对：${dataPoint}`
      : "来自 Inbox 转入，引用前核对上下文",
    topicIds: []
  });
  await updateRecord("signals", signalId, { disposition: "material", seen: true });
}

async function signalToTopic(signalId, directProduction = false) {
  const signal = state.signals.find((item) => item.id === signalId);
  if (!signal) return;
  const materialIds = state.materials
    .filter((material) => material.sourceUrl === signal.url)
    .map((material) => material.id);
  const title = signal.title || signal.note || "未命名选题";
  await saveRecord("topics", topicDefaults({
    title,
    coreIdea: signal.note || "待补核心观点",
    targetReader: "待补",
    sourceSignalIds: [signalId],
    materialIds,
    minimalPublishableVersion: "一条 60-120 秒口播",
    stage: "topic"
  }));
  if (directProduction) {
    const createdTopic = state.topics.find((topic) => (
      topic.title === title && (topic.sourceSignalIds || []).includes(signalId)
    ));
    if (createdTopic) await updateRecord("topics", createdTopic.id, { stage: "outline" });
  }
  await updateRecord("signals", signalId, { disposition: directProduction ? "produce" : "topic", seen: true });
}

async function advanceTopic(topicId) {
  const topic = topicById(topicId);
  if (!topic) return;
  const currentIndex = stageOrder.indexOf(topic.stage);
  if (currentIndex < 0 || currentIndex >= stageOrder.length - 1) return;
  if (topic.stage === "production" && Object.values(gateLabels).some((_, index) => !topic.gates?.[Object.keys(gateLabels)[index]])) {
    alert("四个人工关卡未全部通过。");
    return;
  }
  const nextStage = stageOrder[currentIndex + 1];
  await updateRecord("topics", topicId, { stage: nextStage });
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  const recordId = button.dataset.id;
  try {
    if (action === "nav") {
      const targetView = button.dataset.view;
      if (!navItems.some(([key]) => key === targetView)) return;
      const sameView = currentView === targetView;
      await activateView(targetView);
      window.history[sameView ? "replaceState" : "pushState"](null, "", `#${currentView}`);
      if (button.dataset.anchor) document.getElementById(button.dataset.anchor)?.scrollIntoView({ behavior: "smooth" });
    } else if (action === "set-theme") {
      setTheme(button.dataset.themeValue);
    } else if (action === "refresh") {
      await loadState();
    } else if (action === "filter-inbox") {
      inboxFilter = button.dataset.value;
      render();
    } else if (action === "run-source") {
      await api("/api/collect", "POST", { sourceId: recordId });
      await loadState();
    } else if (action === "run-automation") {
      await api("/api/automation/tick", "POST", { force: false });
      await loadState();
    } else if (action === "toggle-automation") {
      await api("/api/automation/settings", "POST", { automationEnabled: state.settings.automationEnabled === false });
      await loadState();
    } else if (action === "copy-xhs-collector") {
      await navigator.clipboard.writeText(xhsBookmarkletHref(recordId));
      button.textContent = "已复制";
      setTimeout(() => {
        button.textContent = "复制脚本";
      }, 1600);
    } else if (action === "run-all") {
      await api("/api/automation/tick", "POST", { force: true });
      await loadState();
    } else if (action === "scan-drop-folder") {
      await api("/api/drop-folder/scan", "POST", {});
      await loadState();
    } else if (action === "scan-agent-results") {
      const result = await api("/api/agent-tasks/scan", "POST", {});
      await loadState();
      alert(`扫描完成：${result.changed ? "有新结果" : "暂无更新"}，当前待导入 ${result.readyCount} 条。`);
    } else if (action === "refresh-backups") {
      await loadBackups();
    } else if (action === "create-backup") {
      const result = await api("/api/backups/create", "POST", {});
      await loadBackups();
      alert(result.backup.created ? `已创建备份：${result.backup.filename}` : `内容未变化，沿用备份：${result.backup.filename}`);
    } else if (action === "restore-backup") {
      if (!confirm("确认恢复这份备份？当前状态会先自动保存为“恢复前”备份。")) return;
      await api("/api/backups/restore", "POST", { filename: recordId });
      await loadState();
      await loadBackups();
      alert("备份已恢复。");
    } else if (action === "run-agent-task") {
      await api("/api/agent-tasks/run", "POST", { id: recordId });
      await loadState();
    } else if (action === "import-agent-result") {
      const result = await api("/api/agent-tasks/import", "POST", { id: recordId });
      await loadState();
      alert(result.target === "scripts" ? "已导入生产稿版本。" : "已导入素材库。");
    } else if (action === "copy-agent-prompt") {
      const task = (state.agentTasks || []).find((item) => item.id === recordId);
      if (!task?.prompt) throw new Error("任务 Prompt 不存在");
      await navigator.clipboard.writeText(task.prompt);
      button.textContent = "已复制";
      setTimeout(() => {
        button.textContent = "复制任务";
      }, 1600);
    } else if (action === "copy-agent-path") {
      const task = (state.agentTasks || []).find((item) => item.id === recordId);
      if (!task?.outboxPath) throw new Error("任务目录不存在");
      await navigator.clipboard.writeText(task.outboxPath);
      button.textContent = "目录已复制";
      setTimeout(() => {
        button.textContent = "复制目录";
      }, 1600);
    } else if (action === "disposition") {
      await updateRecord("signals", recordId, { disposition: button.dataset.value, seen: true });
    } else if (action === "signal-material") {
      await signalToMaterial(recordId);
    } else if (action === "signal-topic") {
      await signalToTopic(recordId, false);
    } else if (action === "signal-produce") {
      await signalToTopic(recordId, true);
    } else if (action === "material-topic") {
      const material = state.materials.find((item) => item.id === recordId);
      if (material) {
        await saveRecord("topics", topicDefaults({
          title: material.excerpt.slice(0, 40),
          coreIdea: material.whyValuable,
          targetReader: "待补",
          materialIds: [material.id],
          minimalPublishableVersion: "一条 60-120 秒口播"
        }));
      }
    } else if (action === "advance-topic") {
      await advanceTopic(recordId);
    } else if (action === "save-signal") {
      const card = document.querySelector(`[data-signal-card="${CSS.escape(recordId)}"]`);
      const signal = state.signals.find((item) => item.id === recordId);
      const engagementInput = card.querySelector("[name='engagement']");
      const medianInput = card.querySelector("[name='authorMedianEngagement']");
      const engagement = readNumberInput(engagementInput);
      await updateRecord("signals", recordId, { engagement, seen: true });
      if (!medianInput.readOnly && signal?.sourceId) {
        const authorMedianEngagement = readNumberInput(medianInput);
        await updateRecord("sources", signal.sourceId, { authorMedianEngagement });
      }
    }
  } catch (error) {
    alert(error.message);
  }
});

document.addEventListener("input", (event) => {
  if (event.target.id === "material-search") {
    materialQuery = event.target.value;
    const caret = event.target.selectionStart;
    render();
    const next = document.getElementById("material-search");
    if (next) {
      next.focus();
      next.setSelectionRange(caret, caret);
    }
  }
});

document.addEventListener("change", async (event) => {
  const input = event.target.closest("[data-check-kind]");
  if (!input) return;
  const card = input.closest("[data-production-card]");
  const topicId = card?.dataset.productionCard;
  const kind = input.dataset.checkKind;
  const key = input.dataset.key;
  if (!topicId || !kind || !key) return;
  const topic = topicById(topicId);
  if (!topic) return;
  const values = { ...(topic[kind] || {}), [key]: input.checked };
  try {
    await updateRecord("topics", topicId, { [kind]: values });
  } catch (error) {
    alert(error.message);
  }
});

function formObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}

document.addEventListener("submit", async (event) => {
  const form = event.target.closest("form");
  if (!form) return;
  event.preventDefault();
  try {
    if (form.dataset.editForm) {
      await updateRecord(form.dataset.editForm, form.dataset.id, formObject(form));
    } else if (form.id === "quick-capture") {
      const data = formObject(form);
      const result = await api("/api/capture", "POST", { text: data.text, sourceId: data.sourceId });
      alert(`解析完成：发现 ${result.run.found} 条，新增 ${result.run.created} 条，重复 ${result.run.duplicates} 条。`);
    } else if (form.id === "source-form") {
      const data = formObject(form);
      await saveRecord("sources", {
        ...data,
        authorMedianEngagement: data.authorMedianEngagement ? Number(data.authorMedianEngagement) : null,
        lastRunStatus: "never-run",
        failureCount: 0,
        lastCollectionError: "",
        tags: []
      });
    } else if (form.id === "source-intake-form") {
      const data = formObject(form);
      const result = await api("/api/source-intake", "POST", { text: data.text });
      await loadState();
      alert(result.nextAction);
    } else if (form.id === "import-form") {
      const file = form.file.files[0];
      const text = await file.text();
      const payload = JSON.parse(text);
      await api("/api/import", "POST", payload);
      await loadState();
    } else if (form.id === "browser-capture-form") {
      const data = formObject(form);
      if (!data.sourceId) throw new Error("请选择来源账号。");
      const items = JSON.parse(data.items);
      const result = await api("/api/browser-capture", "POST", { sourceId: data.sourceId, items });
      await loadState();
      alert(`采集完成：发现 ${result.run.found} 条，新增 ${result.run.created} 条。`);
    } else if (form.id === "agent-task-form") {
      const result = await api("/api/agent-tasks/create", "POST", formObject(form));
      await loadState();
      alert(`任务包已生成：${result.task.outboxPath}`);
    } else if (form.id === "agent-drive-form") {
      const data = formObject(form);
      await api("/api/agent-bridge/settings", "POST", { driveRoot: data.driveRoot });
      await loadState();
    } else if (form.id === "material-form") {
      await saveRecord("materials", { ...formObject(form), topicIds: [] });
    } else if (form.id === "topic-form") {
      await saveRecord("topics", topicDefaults(formObject(form)));
    } else if (form.id === "script-form") {
      const data = formObject(form);
      await saveRecord("scripts", data);
      if (data.topicId) await updateRecord("topics", data.topicId, { stage: "draft" });
    } else if (form.id === "publication-form") {
      const data = formObject(form);
      await saveRecord("publications", data);
      if (data.status === "published" && data.topicId) {
        const topic = topicById(data.topicId);
        if (topic && topic.stage !== "reviewed") await updateRecord("topics", data.topicId, { stage: "published" });
      }
    } else if (form.id === "review-form") {
      const data = formObject(form);
      await saveRecord("reviews", data);
      if (data.topicId) await updateRecord("topics", data.topicId, { stage: "reviewed" });
    } else if (form.id === "friction-form") {
      const data = formObject(form);
      await saveRecord("frictionLog", {
        ...data,
        minutes: data.minutes ? Number(data.minutes) : null,
        templateCandidate: data.templateCandidate === "true"
      });
    }
  } catch (error) {
    alert(error.message);
  }
});

window.addEventListener("hashchange", () => {
  const targetView = viewFromLocationHash();
  if (targetView === currentView) return;
  activateView(targetView).catch((error) => alert(error.message));
});

loadState().catch((error) => {
  viewEl.innerHTML = `<section class="empty">加载失败：${escapeHtml(error.message)}</section>`;
});
