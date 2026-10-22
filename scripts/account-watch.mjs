const XHS_PROFILE_HOST = "www.xiaohongshu.com";
const DAY_MS = 24 * 60 * 60 * 1000;

export function isAccountWatchSource(source = {}) {
  const hasWatchIntent = source.accountWatch === true
    || source.lastRunTrigger === "account-watch"
    || source.checkFrequency === "daily";
  return Boolean(source)
    && source.enabled !== false
    && source.accountWatch !== false
    && source.platform === "xiaohongshu"
    && source.collectionMethod === "browser-assisted"
    && source.checkFrequency !== "on-demand"
    && hasWatchIntent;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

export function normalizeWatchTitle(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function normalizeWatchDate(value) {
  if (value === null || value === undefined || value === "") return "";
  const numeric = typeof value === "number" ? value : Number(value);
  const date = Number.isFinite(numeric) && numeric > 0 ? new Date(numeric) : new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

export function xhsNoteIdFromUrl(value) {
  const url = String(value || "").trim();
  const match = url.match(
    /\/(?:explore|discovery\/item)\/([A-Za-z0-9_-]+)|\/user\/profile\/[A-Za-z0-9_-]+\/([A-Za-z0-9_-]+)/
  );
  return match?.[1] || match?.[2] || "";
}

function unwrapObjectId(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const withoutSuffix = text.replace(/![^/?#]+$/, "");
  const candidates = withoutSuffix.match(/[A-Za-z0-9][A-Za-z0-9_-]{15,}/g) || [];
  return candidates.sort((left, right) => right.length - left.length)[0] || "";
}

export function stableCoverIdentity(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    const fromPath = unwrapObjectId(decodeURIComponent(url.pathname));
    if (fromPath) return fromPath;
    url.search = "";
    url.hash = "";
    return url.pathname.replace(/\/+$/, "");
  } catch {
    return unwrapObjectId(raw);
  }
}

export function normalizeWatchedItem(item = {}) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const title = String(item.title ?? item.displayTitle ?? item.display_title ?? "").trim();
  const description = String(
    item.description ?? item.desc ?? item.contentText ?? item.content ?? ""
  ).trim();
  const rawCoverUrl = String(
    item.coverUrl ?? item.cover_url ?? item.cover ?? ""
  ).trim();
  const coverUrl = /^https?:\/\//i.test(rawCoverUrl) ? rawCoverUrl : "";
  const url = String(item.url ?? "").trim();
  const noteId = String(item.noteId ?? item.note_id ?? xhsNoteIdFromUrl(url) ?? "").trim();
  if (!title && !coverUrl && !noteId && !url) return null;

  const publishedAt = normalizeWatchDate(
    item.publishedAt ?? item.publishTime ?? item.time ?? item.createdAt
  );
  const engagement = String(item.engagement ?? item.likedCount ?? item.liked_count ?? "").trim();
  return {
    title: title || description.slice(0, 80) || noteId || "未命名笔记",
    description,
    engagement,
    publishedAt,
    coverUrl,
    coverIdentity: stableCoverIdentity(coverUrl),
    url,
    noteId,
    reason: String(item.reason || "").trim(),
    previewOnly: Boolean(!noteId || !url),
    fingerprint: watchedItemFingerprint({ title, publishedAt, coverUrl, noteId, url }),
    identityKeys: watchedItemIdentityKeys({ title, publishedAt, coverUrl, noteId, url })
  };
}

export function watchedItemFingerprint(item = {}) {
  const noteId = String(item.noteId ?? xhsNoteIdFromUrl(item.url) ?? "").trim();
  if (noteId) return `note:${noteId}`;
  const title = normalizeWatchTitle(item.title);
  const publishedAt = normalizeWatchDate(item.publishedAt);
  const coverIdentity = stableCoverIdentity(item.coverUrl ?? item.cover);
  return `preview:${title}|${publishedAt}|${coverIdentity}`;
}

export function watchedItemIdentityKeys(item = {}) {
  const noteId = String(item.noteId ?? xhsNoteIdFromUrl(item.url) ?? "").trim();
  const title = normalizeWatchTitle(item.title);
  const publishedAt = normalizeWatchDate(item.publishedAt);
  const coverIdentity = stableCoverIdentity(item.coverUrl ?? item.cover);
  const keys = [];
  if (noteId) keys.push(`note:${noteId}`);
  if (title) keys.push(`title:${title}`);
  if (title && publishedAt) keys.push(`title-date:${title}|${publishedAt}`);
  if (title && coverIdentity) keys.push(`title-cover:${title}|${coverIdentity}`);
  if (!noteId && title) keys.push(`preview:${title}|${publishedAt}|${coverIdentity}`);
  return keys;
}

function parseSnapshotPayload(snapshot = {}) {
  if (snapshot.format !== "browser-assisted") return null;
  if (typeof snapshot.content !== "string" || !snapshot.content.trim()) return null;
  let payload;
  try {
    payload = JSON.parse(snapshot.content);
  } catch {
    return null;
  }
  const object = asObject(payload);
  const directItems = Array.isArray(payload) ? payload : null;
  if (!object && !directItems) return null;

  let rawItems = [];
  let rawBlockedItems = [];
  if (directItems) {
    rawItems = directItems;
  } else if (Array.isArray(object.items) || Array.isArray(object.blockedItems)) {
    rawItems = Array.isArray(object.items) ? object.items : [];
    rawBlockedItems = Array.isArray(object.blockedItems) ? object.blockedItems : [];
  } else {
    rawItems = Object.keys(object)
      .filter((key) => /^\d+$/.test(key))
      .sort((left, right) => Number(left) - Number(right))
      .map((key) => object[key]);
  }
  if (!Array.isArray(rawItems) && !Array.isArray(rawBlockedItems)) return null;

  const normalized = [...rawItems, ...rawBlockedItems]
    .map(normalizeWatchedItem)
    .filter(Boolean);
  const deduped = [];
  const seen = new Set();
  for (const item of normalized) {
    const key = item.fingerprint || item.identityKeys[0];
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return {
    capturedAt: normalizeWatchDate(snapshot.capturedAt) || String(snapshot.capturedAt || ""),
    snapshotId: String(snapshot.id || ""),
    runId: String(snapshot.runId || ""),
    context: asObject(object?.context) || {},
    items: deduped
  };
}

function itemMatches(left = {}, right = {}) {
  const leftKeys = new Set(left.identityKeys || watchedItemIdentityKeys(left));
  const leftTitle = normalizeWatchTitle(left.title);
  const rightTitle = normalizeWatchTitle(right.title);
  const leftDate = normalizeWatchDate(left.publishedAt);
  const rightDate = normalizeWatchDate(right.publishedAt);
  const leftCover = stableCoverIdentity(left.coverIdentity || left.coverUrl);
  const rightCover = stableCoverIdentity(right.coverIdentity || right.coverUrl);

  if (left.noteId && right.noteId) return left.noteId === right.noteId;
  if (left.noteId || right.noteId) {
    // Legacy snapshots only exposed a note URL; preview snapshots may hide it.
    return Boolean(leftTitle && leftTitle === rightTitle);
  }
  return Boolean(
    leftTitle
    && leftTitle === rightTitle
    && leftDate
    && leftDate === rightDate
    && leftCover
    && leftCover === rightCover
  );
}

function sortWatchedItems(items = []) {
  return items.sort((left, right) => {
    const published = String(right.publishedAt || "").localeCompare(String(left.publishedAt || ""));
    if (published) return published;
    return String(left.title || "").localeCompare(String(right.title || ""), "zh-CN");
  });
}

function itemView(item, firstSeenAt, lastSeenAt, snapshot) {
  return {
    ...item,
    firstSeenAt,
    lastSeenAt,
    snapshotId: snapshot.snapshotId,
    runId: snapshot.runId
  };
}

export function buildAccountWatchReport(snapshots = [], options = {}) {
  const validSnapshots = (Array.isArray(snapshots) ? snapshots : [])
    .map(parseSnapshotPayload)
    .filter(Boolean)
    .sort((left, right) => (
      String(left.capturedAt).localeCompare(String(right.capturedAt))
      || String(left.snapshotId).localeCompare(String(right.snapshotId))
    ));

  if (!validSnapshots.length) {
    return {
      state: "unavailable",
      lastSnapshotAt: "",
      lastSnapshotId: "",
      lastRunId: "",
      context: {},
      itemCount: 0,
      items: [],
      newItems: [],
      seenItems: [],
      disappearedItems: [],
      engagementChanges: [],
      todayNewCount: 0,
      newPreviewCount: 0,
      previewOnly: false,
      ignoredSnapshotCount: Array.isArray(snapshots) ? snapshots.length : 0
    };
  }

  let active = [];
  let latestTransition = {
    newItems: [],
    disappearedItems: [],
    engagementChanges: []
  };
  for (const [snapshotIndex, snapshot] of validSnapshots.entries()) {
    const matchedPrevious = new Set();
    const nextActive = [];
    const newItems = [];
    const engagementChanges = [];

    for (const current of snapshot.items) {
      const previousIndex = active.findIndex((entry, index) => (
        !matchedPrevious.has(index) && itemMatches(entry.item, current)
      ));
      if (previousIndex < 0) {
        nextActive.push({
          item: current,
          firstSeenAt: snapshot.capturedAt,
          lastSeenAt: snapshot.capturedAt,
          snapshot
        });
        if (snapshotIndex > 0) {
          newItems.push(itemView(current, snapshot.capturedAt, snapshot.capturedAt, snapshot));
        }
        continue;
      }

      matchedPrevious.add(previousIndex);
      const previous = active[previousIndex];
      if (String(previous.item.engagement || "") !== String(current.engagement || "")) {
        engagementChanges.push({
          title: current.title,
          fingerprint: current.fingerprint,
          before: previous.item.engagement,
          after: current.engagement,
          changedAt: snapshot.capturedAt,
          snapshotId: snapshot.snapshotId,
          runId: snapshot.runId
        });
      }
      nextActive.push({
        item: current,
        firstSeenAt: previous.firstSeenAt,
        lastSeenAt: snapshot.capturedAt,
        snapshot
      });
    }

    const disappearedItems = active
      .filter((_, index) => !matchedPrevious.has(index))
      .map((entry) => ({
        ...entry.item,
        firstSeenAt: entry.firstSeenAt,
        lastSeenAt: entry.lastSeenAt,
        disappearedAt: snapshot.capturedAt,
        snapshotId: snapshot.snapshotId,
        runId: snapshot.runId
      }));

    active = nextActive;
    latestTransition = {
      newItems: snapshotIndex > 0 ? newItems : [],
      disappearedItems: snapshotIndex > 0 ? disappearedItems : [],
      engagementChanges: snapshotIndex > 0 ? engagementChanges : []
    };
  }

  const latestSnapshot = validSnapshots[validSnapshots.length - 1];
  const newFingerprints = new Set(latestTransition.newItems.map((item) => item.fingerprint));
  const items = active
    .map((entry) => ({
      ...itemView(entry.item, entry.firstSeenAt, entry.lastSeenAt, entry.snapshot),
      isNew: newFingerprints.has(entry.item.fingerprint)
    }))
    .sort((left, right) => Number(right.isNew) - Number(left.isNew));
  const newItems = items.filter((item) => item.isNew);
  const seenItems = items.filter((item) => !item.isNew);
  const timeZone = options.timeZone || "Asia/Shanghai";
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const dayKey = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(date);
  };
  const latestDay = dayKey(latestSnapshot.capturedAt);
  const todayKey = dayKey(now);
  const todayNewItems = latestDay && latestDay === todayKey ? newItems : [];
  const ignoredSnapshotCount = (Array.isArray(snapshots) ? snapshots : [])
    .filter((snapshot) => snapshot?.format === "browser-assisted")
    .filter((snapshot) => !parseSnapshotPayload(snapshot))
    .length;

  return {
    state: "ready",
    lastSnapshotAt: latestSnapshot.capturedAt,
    lastSnapshotId: latestSnapshot.snapshotId,
    lastRunId: latestSnapshot.runId,
    context: latestSnapshot.context,
    itemCount: items.length,
    items,
    newItems,
    seenItems,
    disappearedItems: latestTransition.disappearedItems,
    engagementChanges: latestTransition.engagementChanges,
    todayNewItems,
    todayNewCount: todayNewItems.length,
    newPreviewCount: newItems.filter((item) => item.previewOnly).length,
    previewOnly: items.length > 0 && items.every((item) => item.previewOnly),
    ignoredSnapshotCount
  };
}

function latestRunForSource(state, sourceId) {
  return (state.collectionRuns || [])
    .filter((run) => run.sourceId === sourceId && run.trigger === "account-watch")
    .sort((left, right) => String(right.startedAt || "").localeCompare(String(left.startedAt || "")))[0] || null;
}

export function buildAccountWatchRuntime(state = {}, options = {}) {
  const generatedAt = (options.now instanceof Date ? options.now : new Date(options.now || Date.now())).toISOString();
  const sources = (state.sources || [])
    .filter((source) => source.platform === "xiaohongshu")
    .map((source) => {
      const sourceSnapshots = (state.rawSnapshots || [])
        .filter((snapshot) => snapshot.sourceId === source.id);
      const report = buildAccountWatchReport(sourceSnapshots, options);
      const latestRun = latestRunForSource(state, source.id);
      const latestSnapshotTime = Date.parse(report.lastSnapshotAt || "");
      const latestRunTime = Date.parse(latestRun?.finishedAt || latestRun?.startedAt || "");
      const runIsNewer = Number.isFinite(latestRunTime)
        && (!Number.isFinite(latestSnapshotTime) || latestRunTime > latestSnapshotTime);
      const refreshStatus = runIsNewer
        ? ({ blocked: "refresh-blocked", failed: "refresh-failed", running: "refreshing" }[latestRun.status] || "idle")
        : (report.state === "ready" ? "current" : "baseline-missing");
      return {
        sourceId: source.id,
        name: source.name || source.account || source.id,
        url: source.url || "",
        refreshStatus,
        nextRunAt: source.nextRunAt || "",
        nextRunDueAt: Number.isFinite(Date.parse(source.nextRunAt || ""))
          ? new Date(Math.min(Date.parse(source.nextRunAt), Date.parse(generatedAt) + DAY_MS)).toISOString()
          : "",
        latestRun: latestRun ? {
          id: latestRun.id,
          status: latestRun.status,
          trigger: latestRun.trigger,
          startedAt: latestRun.startedAt,
          finishedAt: latestRun.finishedAt,
          failureReason: latestRun.failureReason || "",
          nextAction: latestRun.nextAction || "",
          found: latestRun.found || 0,
          created: latestRun.created || 0
        } : null,
        ...report
      };
    });
  return {
    generatedAt,
    sourceCount: sources.length,
    readySourceCount: sources.filter((source) => source.state === "ready").length,
    blockedSourceCount: sources.filter((source) => source.refreshStatus === "refresh-blocked").length,
    sources,
    bySource: Object.fromEntries(sources.map((source) => [source.sourceId, source]))
  };
}

export function accountWatchRuntimeForSource(state = {}, sourceId = "", options = {}) {
  return buildAccountWatchRuntime(state, options).bySource[sourceId] || null;
}
