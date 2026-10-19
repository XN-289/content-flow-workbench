const navItems = [
  ["today", "今日"],
  ["sources", "账号"],
  ["inbox", "Inbox"],
  ["materials", "素材"],
  ["topics", "选题"],
  ["production", "生产"],
  ["publish", "发布"],
  ["review", "复盘"],
  ["runs", "采集"]
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

const triggerLabels = {
  automatic: "自动",
  force: "强制",
  manual: "手动",
  "drop-folder": "投递箱",
  "drop-folder-manual": "投递箱手动",
  "quick-capture": "快速粘贴"
};

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
let currentView = "today";
let inboxFilter = "inbox";
let materialQuery = "";

const appNav = document.getElementById("nav");
const viewEl = document.getElementById("view");
const dataState = document.getElementById("data-state");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

function sourceById(id) {
  return state.sources.find((source) => source.id === id);
}

function topicById(id) {
  return state.topics.find((topic) => topic.id === id);
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
  return `
(async () => {
  if (location.hostname !== "www.xiaohongshu.com" || !location.pathname.startsWith("/user/profile/")) {
    alert("请在小红书博主主页运行这个采集脚本。");
    return;
  }

  const sourceId = ${JSON.stringify(sourceId)};
  const notesRoot = window.__INITIAL_STATE__?.user?.notes?._rawValue
    || window.__INITIAL_STATE__?.user?.notes
    || [];
  const groups = Array.isArray(notesRoot) ? notesRoot : Object.values(notesRoot || {});
  const items = [];
  const seen = new Set();

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
    const response = await fetch("http://127.0.0.1:5177/api/browser-capture", {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceId, items })
    });
    const payload = await response.json();
    if (!response.ok || payload.ok === false) throw new Error(payload.error || "HTTP " + response.status);
    alert("采集完成：发现 " + payload.run.found + " 条，新增 " + payload.run.created + " 条。");
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
    today: renderToday,
    sources: renderSources,
    inbox: renderInbox,
    materials: renderMaterials,
    topics: renderTopics,
    production: renderProduction,
    publish: renderPublish,
    review: renderReview,
    runs: renderRuns
  };
  viewEl.innerHTML = views[currentView]();
}

function renderToday() {
  const inboxCount = state.signals.filter((signal) => signal.disposition === "inbox").length;
  const highPotentialCount = state.signals.filter((signal) => signal.disposition === "inbox" && signal.automationTier === "high-potential").length;
  const manualActionCount = state.sources.filter((source) => source.automationStatus === "manual-required").length;
  const producing = state.topics.filter((topic) => ["outline", "draft", "production", "review"].includes(topic.stage)).length;
  const ready = state.topics.filter((topic) => topic.stage === "ready-to-publish").length;
  const published = state.publications.filter((item) => item.status === "published").length;
  const focusTopics = state.topics
    .filter((topic) => !["published", "reviewed"].includes(topic.stage))
    .slice(0, 5);
  const brief = latestDailyBrief();
  const briefSignals = brief
    ? brief.topSignalIds.map((signalId) => state.signals.find((signal) => signal.id === signalId)).filter(Boolean)
    : [];

  return `
    <section class="page-head">
      <div>
        <h1 class="page-title">今日</h1>
        <p class="page-subtitle">${escapeHtml(state.settings.inboxTime)} Inbox · ${escapeHtml(state.settings.collectionTime)} 采集</p>
      </div>
    </section>
    <div class="metric-grid">
      <div class="metric"><div class="metric-value">${inboxCount}</div><div class="metric-label">待处理信号</div></div>
      <div class="metric"><div class="metric-value">${highPotentialCount}</div><div class="metric-label">高潜力信号</div></div>
      <div class="metric"><div class="metric-value">${manualActionCount}</div><div class="metric-label">待人工账号</div></div>
      <div class="metric"><div class="metric-value">${producing}</div><div class="metric-label">生产中</div></div>
      <div class="metric"><div class="metric-value">${ready}</div><div class="metric-label">待发布</div></div>
      <div class="metric"><div class="metric-value">${published}</div><div class="metric-label">已发布记录</div></div>
    </div>
    <div class="split">
      <div>
        <section class="panel">
          <div class="item-head">
            <h2 class="panel-title">晨报</h2>
            ${brief ? tag(displayDate(brief.generatedAt), "accent") : tag("等待生成", "warn")}
          </div>
          <div class="list">
            ${brief ? `
              <article class="item-card">
                <div class="item-meta">
                  ${brief.nextActions.map((action) => tag(action, "accent")).join("")}
                </div>
              </article>
              ${briefSignals.length ? briefSignals.map((signal) => `
                <article class="item-card">
                  <div class="item-head">
                    <h3 class="item-title">${escapeHtml(signal.title || signal.note || "未命名信号")}</h3>
                    ${tag(automationTierLabels[signal.automationTier] || "待补数据", signal.automationTier === "high-potential" ? "accent" : "warn")}
                  </div>
                  <div class="item-meta">
                    ${tag(platformLabels[signal.platform] || signal.platform, "info")}
                    ${tag(`互动 ${signal.engagement ?? "未填"}`)}
                    ${signal.relativeMultiple !== null && signal.relativeMultiple !== undefined ? tag(`${signal.relativeMultiple}x`, "accent") : ""}
                  </div>
                </article>
              `).join("") : `<div class="empty">暂无待处理信号</div>`}
            ` : `<div class="empty">到达 Inbox 时间后自动生成</div>`}
          </div>
        </section>
        <section class="panel">
          <h2 class="panel-title">快速粘贴</h2>
          <form id="quick-capture" class="form-grid">
            <div class="field full"><label>来源账号</label><select name="sourceId">${sourceOptions()}</select></div>
            <div class="field full"><label>粘贴原文</label><textarea name="text" rows="7" required placeholder="直接粘贴链接、标题、点赞数、热评或 JSON。系统会自动识别 URL、账号、互动数和热评。"></textarea></div>
            <div class="form-actions"><button class="primary-button" type="submit">自动解析入库</button></div>
          </form>
          <p class="panel-note">支持“热评： ...”“@评论者： ...”和 JSON。识别结果仍先进 Inbox / 素材库，不自动替你判断价值。</p>
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
      </div>
      <div>
        <section class="panel">
          <h2 class="panel-title">今日焦点</h2>
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
        <section class="panel">
          <h2 class="panel-title">最近摩擦</h2>
          <div class="list">
            ${state.frictionLog.slice(0, 3).map((item) => `
              <article class="item-card">
                <div class="item-head"><h3 class="item-title">${escapeHtml(item.stuckAt)}</h3>${tag(`${item.minutes || 0} 分钟`, "warn")}</div>
                ${item.note ? `<p class="item-note">${escapeHtml(item.note)}</p>` : ""}
              </article>
            `).join("") || `<div class="empty">暂无记录</div>`}
          </div>
        </section>
      </div>
    </div>
  `;
}

function renderSources() {
  const dueCount = state.sources.filter(isDueSource).length;
  const retryingCount = state.sources.filter((source) => source.automationStatus === "retrying").length;

  return `
    <section class="page-head">
      <div>
        <h1 class="page-title">对标账号</h1>
        <p class="page-subtitle">账号注册表 · 自动化${state.settings.automationEnabled === false ? "关" : "开"} · 到期 ${dueCount} · 重试 ${retryingCount}</p>
      </div>
      <div class="head-actions">
        <button type="button" class="small-button accent" data-action="run-automation">检查到期采集</button>
        <button type="button" class="small-button" data-action="run-all">强制检查全部</button>
        <button type="button" class="small-button" data-action="toggle-automation">${state.settings.automationEnabled === false ? "开启自动化" : "暂停自动化"}</button>
      </div>
    </section>
    <div class="split">
      <div>
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
              <div class="item-meta">
                ${tag(platformLabels[source.platform] || source.platform, "info")}
                ${tag(methodLabels[source.collectionMethod] || source.collectionMethod || "未设置")}
                ${tag(source.checkFrequency || "daily")}
                ${sourceScheduleTags(source)}
                ${source.authorMedianEngagement ? tag(`中位数 ${source.authorMedianEngagement} · 样本 ${source.engagementSampleCount || 0}`) : ""}
              </div>
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
  const filtered = state.signals.filter((signal) => {
    if (inboxFilter === "inbox") return signal.disposition === "inbox";
    if (inboxFilter === "unseen") return !signal.seen;
    return signal.disposition === inboxFilter;
  });
  const filters = [["inbox", "待处理"], ["unseen", "未看"], ["watch", "观察"], ["dissect", "拆解"], ["discard", "丢弃"]];
  const visibleSignals = [...filtered].sort((a, b) => (
    signalStrength(b) - signalStrength(a)
    || signalTime(b) - signalTime(a)
    || String(a.title || "").localeCompare(String(b.title || ""), "zh-CN")
  ));

  return `
    <section class="page-head">
      <div>
        <h1 class="page-title">Inbox</h1>
        <p class="page-subtitle">每条信号必须有去向</p>
      </div>
    </section>
    <div class="filter-row">${filters.map(([value, label]) => `<button type="button" class="small-button ${inboxFilter === value ? "accent" : ""}" data-action="filter-inbox" data-value="${value}">${label}</button>`).join("")}</div>
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
            <div class="inline-grid">
              <input name="engagement" type="number" min="0" placeholder="互动" value="${signal.engagement ?? ""}">
              <input name="authorMedianEngagement" type="number" min="0" placeholder="中位数" value="${signal.authorMedianEngagement ?? ""}" ${medianIsAuto ? "readonly title=\"自动计算\"" : ""}>
              <input name="relativeMultiple" type="number" min="0" step="0.1" placeholder="倍数" value="${signal.relativeMultiple ?? ""}" readonly title="自动计算">
            </div>
            <div class="item-actions">
              <button type="button" class="small-button" data-action="save-signal" data-id="${escapeHtml(signal.id)}">保存数据</button>
              <button type="button" class="small-button" data-action="disposition" data-id="${escapeHtml(signal.id)}" data-value="dissect">拆解</button>
              <button type="button" class="small-button" data-action="signal-material" data-id="${escapeHtml(signal.id)}">入素材</button>
              <button type="button" class="small-button" data-action="signal-topic" data-id="${escapeHtml(signal.id)}">入选题</button>
              <button type="button" class="small-button accent" data-action="signal-produce" data-id="${escapeHtml(signal.id)}">直接生产</button>
              <button type="button" class="small-button" data-action="disposition" data-id="${escapeHtml(signal.id)}" data-value="watch">观察</button>
              <button type="button" class="danger-button" data-action="disposition" data-id="${escapeHtml(signal.id)}" data-value="discard">丢弃</button>
            </div>
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
    <section class="page-head">
      <div>
        <h1 class="page-title">素材与热评</h1>
        <p class="page-subtitle">观点 · 案例 · 数据 · 金句 · 热评</p>
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
    <section class="page-head">
      <div><h1 class="page-title">选题池</h1><p class="page-subtitle">目标读者 · 核心观点 · 最小版本</p></div>
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
    <section class="page-head"><div><h1 class="page-title">生产台</h1><p class="page-subtitle">七项检查 · 四个人工关卡</p></div></section>
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
    <section class="page-head"><div><h1 class="page-title">发布台账</h1><p class="page-subtitle">平台逐列追踪</p></div></section>
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
          ${state.publications.length ? state.publications.map((item) => {
            const topic = topicById(item.topicId);
            return `
              <article class="item-card">
                <div class="item-head"><h3 class="item-title">${escapeHtml(topic?.title || "未关联选题")}</h3>${tag(platformLabels[item.platform] || item.platform, "info")}</div>
                <div class="item-meta">${tag(item.status || "not-ready", item.status === "published" ? "accent" : item.status === "failed" ? "danger" : "warn")}${tag(displayDate(item.publishedAt))}</div>
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

function renderReview() {
  return `
    <section class="page-head"><div><h1 class="page-title">复盘</h1><p class="page-subtitle">数据 · 评论 · 下一条改法</p></div></section>
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

function renderRuns() {
  const dueCount = state.sources.filter(isDueSource).length;
  const manualCount = state.sources.filter((source) => source.automationStatus === "manual-required").length;
  const retryingCount = state.sources.filter((source) => source.automationStatus === "retrying").length;
  const failedRuns = state.collectionRuns.filter((run) => run.status === "failed").length;

  return `
    <section class="page-head">
      <div><h1 class="page-title">采集运行</h1><p class="page-subtitle">状态 · 数量 · 失败原因 · 人工下一步</p></div>
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
          <thead><tr><th>时间</th><th>账号</th><th>触发</th><th>状态</th><th>发现 / 新增</th><th>失败原因</th><th>下一步</th></tr></thead>
          <tbody>
            ${state.collectionRuns.length ? state.collectionRuns.slice(0, 50).map((run) => `
              <tr>
                <td class="mono">${escapeHtml(displayDate(run.startedAt))}</td>
                <td>${escapeHtml(sourceById(run.sourceId)?.name || run.sourceId)}</td>
                <td>${escapeHtml(triggerLabels[run.trigger] || run.trigger || "手动")}</td>
                <td>${escapeHtml(run.status)}</td>
                <td>${run.found || 0} / ${run.created || 0}</td>
                <td>${escapeHtml(run.failureReason || "-")}</td>
                <td>${escapeHtml(run.nextAction || "-")}</td>
              </tr>
            `).join("") : `<tr><td colspan="7"><div class="empty">暂无运行记录</div></td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
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
  const excerpt = dataPoint
    || String(signal.contentText || "").trim().slice(0, 600)
    || signal.title
    || signal.note
    || signal.url;
  await saveRecord("materials", {
    sourceUrl: signal.url,
    platform: signal.platform,
    author: signal.author,
    type: dataPoint ? "data" : "lead",
    excerpt,
    whyValuable: "待判断",
    possibleUse: "evidence",
    citationNote: dataPoint ? "自动抽取的数据口径候选，发布前必须回原文核对" : "来自 Inbox 转入，引用前核对上下文",
    topicIds: []
  });
  await updateRecord("signals", signalId, { disposition: "material", seen: true });
}

async function signalToTopic(signalId, directProduction = false) {
  const signal = state.signals.find((item) => item.id === signalId);
  if (!signal) return;
  await saveRecord("topics", topicDefaults({
    title: signal.title || signal.note || "未命名选题",
    coreIdea: signal.note || "待补核心观点",
    targetReader: "待补",
    sourceSignalIds: [signalId],
    materialIds: [],
    minimalPublishableVersion: "一条 60-120 秒口播",
    stage: directProduction ? "outline" : "topic"
  }));
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
      currentView = button.dataset.view;
      renderNav();
      render();
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
    if (form.id === "quick-capture") {
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

loadState().catch((error) => {
  viewEl.innerHTML = `<section class="empty">加载失败：${escapeHtml(error.message)}</section>`;
});
