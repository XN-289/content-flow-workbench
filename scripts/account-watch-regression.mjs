import assert from "node:assert/strict";
import {
  buildAccountWatchReport,
  buildAccountWatchRuntime,
  isAccountWatchSource,
  normalizeWatchedItem,
  watchedItemFingerprint
} from "./account-watch.mjs";
import { normalizeXhsProfilePayload } from "./xhs-public-profile.mjs";

const checks = [];
const sourceId = "source-xhs-watch-test";

function pass(name) {
  checks.push(name);
  console.log(`ok - ${name}`);
}

function snapshot(id, capturedAt, payload, runId = "") {
  return {
    id,
    runId,
    sourceId,
    capturedAt,
    format: "browser-assisted",
    content: typeof payload === "string" ? payload : JSON.stringify(payload)
  };
}

function item(title, overrides = {}) {
  return {
    title,
    engagement: "10",
    publishedAt: "2026-10-20T02:00:00.000Z",
    coverUrl: `https://sns-webpic-qc.xhscdn.com/20261020/hash/1040g${title.length}abcdefghijkl`,
    reason: "note-id-unavailable",
    ...overrides
  };
}

try {
  assert.equal(isAccountWatchSource({
    platform: "xiaohongshu",
    collectionMethod: "browser-assisted",
    accountWatch: true,
    checkFrequency: "daily"
  }), true);
  assert.equal(isAccountWatchSource({
    platform: "xiaohongshu",
    collectionMethod: "browser-assisted",
    lastRunTrigger: "account-watch"
  }), true);
  assert.equal(isAccountWatchSource({
    platform: "xiaohongshu",
    collectionMethod: "browser-assisted"
  }), false);
  pass("账号监控意图兼容显式标记、既有运行记录，并排除旧版人工书签来源");

  const baseline = snapshot("snapshot-baseline", "2026-10-20T03:00:00.000Z", {
    items: [],
    blockedItems: [item("第一条"), item("第二条", { engagement: "20" })]
  });
  const baselineReport = buildAccountWatchReport([baseline], {
    now: new Date("2026-10-20T04:00:00.000Z")
  });
  assert.equal(baselineReport.state, "ready");
  assert.equal(baselineReport.items.length, 2);
  assert.equal(baselineReport.newItems.length, 0);
  assert.equal(baselineReport.todayNewCount, 0);
  assert.equal(baselineReport.previewOnly, true);
  pass("首个有效历史快照只建立基线，不制造新内容");

  const unchanged = snapshot("snapshot-unchanged", "2026-10-20T05:00:00.000Z", {
    items: [],
    blockedItems: [item("第一条"), item("第二条", { engagement: "20" })]
  });
  const unchangedReport = buildAccountWatchReport([unchanged, baseline], {
    now: new Date("2026-10-20T06:00:00.000Z")
  });
  assert.equal(unchangedReport.newItems.length, 0);
  assert.equal(unchangedReport.disappearedItems.length, 0);
  assert.equal(unchangedReport.engagementChanges.length, 0);
  pass("相同快照不会重复判定新增");

  const withNew = snapshot("snapshot-new", "2026-10-20T07:00:00.000Z", {
    items: [],
    blockedItems: [
      item("刚发布"),
      item("第一条"),
      item("第二条", { engagement: "20" })
    ]
  });
  const newReport = buildAccountWatchReport([baseline, withNew], {
    now: new Date("2026-10-20T08:00:00.000Z")
  });
  assert.deepEqual(newReport.newItems.map((entry) => entry.title), ["刚发布"]);
  assert.equal(newReport.todayNewCount, 1);
  assert.equal(newReport.newPreviewCount, 1);
  pass("真实新增内容排在最前并计入今日新预览");

  const disappeared = snapshot("snapshot-gone", "2026-10-20T09:00:00.000Z", {
    items: [],
    blockedItems: [item("刚发布"), item("第一条")]
  });
  const disappearedReport = buildAccountWatchReport([baseline, withNew, disappeared], {
    now: new Date("2026-10-20T10:00:00.000Z")
  });
  assert.deepEqual(disappearedReport.disappearedItems.map((entry) => entry.title), ["第二条"]);
  assert.equal(disappearedReport.newItems.length, 0);
  pass("消失内容进入 disappeared，不混入新内容");

  const engagementChanged = snapshot("snapshot-engagement", "2026-10-20T11:00:00.000Z", {
    items: [],
    blockedItems: [
      item("刚发布", { engagement: "99" }),
      item("第一条")
    ]
  });
  const engagementReport = buildAccountWatchReport(
    [baseline, withNew, disappeared, engagementChanged],
    { now: new Date("2026-10-20T12:00:00.000Z") }
  );
  assert.equal(engagementReport.engagementChanges.length, 1);
  assert.equal(engagementReport.engagementChanges[0].before, "10");
  assert.equal(engagementReport.engagementChanges[0].after, "99");
  pass("同一内容的互动变化单独记录，不误判为新内容");

  const malformed = snapshot("snapshot-malformed", "2026-10-20T13:00:00.000Z", "{not-json");
  const recovered = snapshot("snapshot-recovered", "2026-10-20T14:00:00.000Z", {
    items: [],
    blockedItems: [item("第一条"), item("第二条", { engagement: "20" })]
  });
  const recoveredReport = buildAccountWatchReport(
    [baseline, malformed, recovered],
    { now: new Date("2026-10-20T15:00:00.000Z") }
  );
  assert.equal(recoveredReport.newItems.length, 0);
  assert.equal(recoveredReport.ignoredSnapshotCount, 1);
  assert.equal(recoveredReport.items.length, 2);
  pass("坏主页快照被忽略，下一条有效快照仍对最后基线做比较");

  const legacy = snapshot("snapshot-legacy", "2026-10-18T03:00:00.000Z", {
    0: {
      title: "迁移前旧笔记",
      url: "https://www.xiaohongshu.com/explore/64f00d8a000000001f01a111",
      engagement: "12"
    },
    1: {
      title: "迁移前第二条",
      url: "https://www.xiaohongshu.com/explore/64f00d8a000000001f01a222",
      engagement: "18"
    }
  });
  const legacyReport = buildAccountWatchReport([legacy], {
    now: new Date("2026-10-18T04:00:00.000Z")
  });
  assert.equal(legacyReport.items.length, 2);
  assert.match(legacyReport.items[0].fingerprint, /^note:/);
  pass("旧版数字键快照仍可建立基线");

  const legacyArray = snapshot("snapshot-legacy-array", "2026-10-18T03:30:00.000Z", [
    {
      title: "数组版旧笔记一",
      url: "https://www.xiaohongshu.com/user/profile/demo/64f00d8a000000001f01a333",
      engagement: "26"
    },
    {
      title: "数组版旧笔记二",
      url: "https://www.xiaohongshu.com/user/profile/demo/64f00d8a000000001f01a444",
      engagement: "48"
    }
  ]);
  const legacyArrayReport = buildAccountWatchReport([legacyArray], {
    now: new Date("2026-10-18T04:00:00.000Z")
  });
  assert.equal(legacyArrayReport.items.length, 2);
  assert.equal(legacyArrayReport.items[0].previewOnly, false);
  assert.equal(legacyArrayReport.items[0].noteId, "64f00d8a000000001f01a333");
  pass("旧版数组快照仍可恢复标题、链接和互动数据");

  const migrated = snapshot("snapshot-migrated", "2026-10-19T03:00:00.000Z", {
    items: [],
    blockedItems: [
      item("迁移前旧笔记", {
        publishedAt: "2023-08-31T00:00:00.000Z",
        coverUrl: "https://sns-na-i2.xhscdn.com/notes_pre_post/1040g3k83268m5j7n4e004aql8ntem7u1svtbgmo?sign=abc"
      }),
      item("迁移前第二条", {
        publishedAt: "2023-09-01T00:00:00.000Z",
        coverUrl: "https://sns-na-i2.xhscdn.com/notes_pre_post/1040g3k83268m5j7n4e004aql8ntem7u1svtbgmp?sign=def"
      })
    ]
  });
  const migrationReport = buildAccountWatchReport([legacy, migrated], {
    now: new Date("2026-10-19T04:00:00.000Z")
  });
  assert.equal(migrationReport.newItems.length, 0);
  assert.equal(migrationReport.items.length, 2);
  pass("旧版带链接快照迁移到无 noteId 预览时不会全量误报新内容");

  assert.equal(
    normalizeWatchedItem({
      title: "封面身份",
      coverUrl: "https://sns-webpic-qc.xhscdn.com/20261020/hash/1040g3k83268m5j7n4e004aql8ntem7u1svtbgmo?sign=x"
    }).coverIdentity,
    "1040g3k83268m5j7n4e004aql8ntem7u1svtbgmo"
  );
  assert.equal(
    watchedItemFingerprint({ title: "只有标题", publishedAt: "", coverUrl: "" }),
    "preview:只有标题||"
  );
  pass("签名封面按稳定对象身份去重，标题兜底指纹稳定");

  const titleOnlyDrift = snapshot("snapshot-title-only-drift", "2026-10-20T15:30:00.000Z", {
    items: [],
    blockedItems: [
      item("第一条", {
        publishedAt: "2026-10-21T02:00:00.000Z",
        coverUrl: "https://sns-webpic-qc.xhscdn.com/20261021/hash/1040g3k83268m5j7n4e004aql8ntem7u1svtbgn0"
      }),
      item("第二条", { engagement: "20" })
    ]
  });
  const titleOnlyReport = buildAccountWatchReport(
    [baseline, recovered, titleOnlyDrift],
    { now: new Date("2026-10-20T16:00:00.000Z") }
  );
  assert.equal(titleOnlyReport.newItems.length, 1);
  assert.equal(titleOnlyReport.newItems[0].title, "第一条");
  pass("普通预览缺日期或封面时不会仅凭标题误判为同一内容");

  const normalizedPayload = normalizeXhsProfilePayload({
    readable: true,
    items: [{
      title: "可打开笔记",
      description: "简介",
      url: "https://www.xiaohongshu.com/explore/64f00d8a000000001f01a333",
      noteId: "64f00d8a000000001f01a333",
      engagement: "1.2万",
      publishedAt: "2026-10-20T00:00:00.000Z",
      coverUrl: "https://sns-webpic-qc.xhscdn.com/cover/1040g3k83268m5j7n4e004aql8ntem7u1svtbgn1"
    }],
    blockedItems: [{
      title: "仅预览笔记",
      description: "公开可见简介",
      engagement: "8",
      coverUrl: "https://sns-webpic-qc.xhscdn.com/cover/1040g3k83268m5j7n4e004aql8ntem7u1svtbgn2"
    }],
    context: {
      profileNoteCount: "1.2万",
      profileFollowers: "3,400",
      profileEngagement: "8.1万"
    },
    effectiveUrl: "https://www.xiaohongshu.com/user/profile/demo"
  }, {
    id: sourceId,
    name: "测试账号",
    url: "https://www.xiaohongshu.com/user/profile/demo"
  });
  assert.equal(normalizedPayload.items.length, 1);
  assert.equal(normalizedPayload.blockedItems.length, 1);
  assert.equal(normalizedPayload.context.profileNoteCount, 12000);
  assert.equal(normalizedPayload.context.profileFollowers, 3400);
  assert.equal(normalizedPayload.context.privateApiCalled, false);
  pass("公开主页载荷只保留可确认笔记和游客可见预览");

  const runtime = buildAccountWatchRuntime({
    sources: [{
      id: sourceId,
      name: "测试账号",
      platform: "xiaohongshu",
      collectionMethod: "browser-assisted",
      url: "https://www.xiaohongshu.com/user/profile/demo",
      nextRunAt: "2026-10-23T00:40:00.000Z"
    }],
    rawSnapshots: [baseline],
    collectionRuns: [{
      id: "run-blocked",
      sourceId,
      trigger: "account-watch",
      status: "blocked",
      startedAt: "2026-10-20T05:00:00.000Z",
      finishedAt: "2026-10-20T05:00:10.000Z",
      failureReason: "IP risk"
    }]
  }, { now: new Date("2026-10-20T06:00:00.000Z") });
  assert.equal(runtime.sourceCount, 1);
  assert.equal(runtime.bySource[sourceId].refreshStatus, "refresh-blocked");
  assert.equal(runtime.bySource[sourceId].newItems.length, 0);
  pass("刷新失败标记为 refresh-blocked，不覆盖最后有效快照");

  console.log(`\nAccount watch regression passed (${checks.length} checks).`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
