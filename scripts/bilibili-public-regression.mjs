import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  bilibiliContentId,
  collectBilibiliPublic,
  parseBilibiliDump
} from "./bilibili-public.mjs";
import {
  automaticCollectionMethods,
  isAutomaticCollectionDue
} from "./morning-pipeline.mjs";

const videoId = "BV1xx411c7mD";
const videoUrl = `https://www.bilibili.com/video/${videoId}`;
let tempRoot = "";
let passed = 0;

function pass(name) {
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

function fixtureInfo(overrides = {}) {
  return {
    id: videoId,
    webpage_url: videoUrl,
    title: "公开字幕时间轴回归",
    description: "这里只是公开简介，不能冒充逐字稿。",
    uploader: "回归账号",
    uploader_id: "fixture-uploader",
    uploader_url: "https://space.bilibili.com/12345",
    thumbnail: "https://i.example.com/bilibili-cover.jpg",
    timestamp: 1_760_000_000,
    subtitles: { "zh-CN": [{ ext: "json3" }] },
    ...overrides
  };
}

function fakeRunner(onRun) {
  return async (_executable, args) => {
    const pathsIndex = args.indexOf("--paths");
    const outputDir = pathsIndex >= 0 ? args[pathsIndex + 1] : "";
    return onRun({ args, outputDir });
  };
}

async function main() {
  assert.equal(bilibiliContentId(`${videoUrl}?p=1`), videoId);
  assert.equal(bilibiliContentId("av123456"), "av123456");
  const parsed = parseBilibiliDump(JSON.stringify({
    entries: [{ id: videoId, webpage_url: videoUrl, title: "列表条目" }]
  }));
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].title, "列表条目");
  pass("B 站 URL、BV/av ID 和 yt-dlp JSON 列表解析");

  const captured = await collectBilibiliPublic(videoUrl, {
    executable: process.execPath,
    runProcess: fakeRunner(async ({ outputDir }) => {
      await fs.writeFile(
        path.join(outputDir, `${videoId}.zh-CN.json3`),
        JSON.stringify({
          events: [
            {
              tStartMs: 420,
              dDurationMs: 1580,
              segs: [{ utf8: "首段从零点四二秒开始。" }]
            },
            {
              from: 2,
              to: 3.25,
              text: "第二段使用秒字段。"
            }
          ]
        }),
        "utf8"
      );
      return { code: 0, stdout: JSON.stringify(fixtureInfo()), stderr: "" };
    })
  });
  assert.equal(captured.status, "ok");
  assert.equal(captured.items.length, 1);
  assert.equal(captured.subtitleCount, 1);
  const item = captured.items[0];
  assert.equal(item.id, videoId);
  assert.equal(item.title, "公开字幕时间轴回归");
  assert.equal(item.description, "这里只是公开简介，不能冒充逐字稿。");
  assert.equal(item.coverUrl, "https://i.example.com/bilibili-cover.jpg");
  assert.equal(item.sourceProfileUrl, "https://space.bilibili.com/12345");
  assert.equal(item.transcriptStatus, "captured");
  assert.match(item.transcriptSource, /bilibili-public-subtitle:zh-CN/);
  assert.equal(item.transcriptText, "首段从零点四二秒开始。\n第二段使用秒字段。");
  assert.equal(item.transcriptSegments[0].start, 0.42);
  assert.equal(item.transcriptSegments[0].end, 2);
  assert.equal(item.transcriptSegments[0].startTimestamp, "00:00.420");
  assert.equal(item.transcriptSegments[0].endTimestamp, "00:02.000");
  assert.equal(item.transcriptSegments[1].start, 2);
  assert.equal(item.transcriptSegments[1].end, 3.25);
  assert.equal(item.transcriptSegments[1].endTimestamp, "00:03.250");
  assert.match(item.transcriptNote, /unverified/);
  pass("公开 JSON3 字幕转为带 startTimestamp / endTimestamp 的 unverified 逐字稿");

  const missing = await collectBilibiliPublic(videoUrl, {
    executable: process.execPath,
    runProcess: fakeRunner(async () => ({
      code: 0,
      stdout: JSON.stringify(fixtureInfo({ subtitles: {}, automatic_captions: {} })),
      stderr: ""
    }))
  });
  assert.equal(missing.status, "ok");
  assert.equal(missing.items[0].transcriptStatus, "missing");
  assert.equal(missing.items[0].transcriptText, "");
  assert.equal(missing.subtitleCount, 0);
  pass("无公开字幕时明确 missing，简介不会冒充逐字稿");

  const blocked = await collectBilibiliPublic(videoUrl, {
    executable: process.execPath,
    runProcess: fakeRunner(async () => ({
      code: 1,
      stdout: "",
      stderr: "ERROR: HTTP Error 412: Precondition Failed"
    }))
  });
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.executableAvailable, true);
  assert.match(blocked.reason, /412\/403/);
  assert.match(blocked.humanAction, /浏览器/);
  assert.deepEqual(blocked.items, []);
  pass("B 站 412 风控映射为 blocked 并保留人工处理边界");

  assert.equal(automaticCollectionMethods.has("bilibili-public"), true);
  assert.equal(isAutomaticCollectionDue({
    collectionMethod: "bilibili-public",
    enabled: true,
    checkFrequency: "daily",
    nextRunAt: "2026-10-22T00:00:00.000Z"
  }, Date.parse("2026-10-22T08:00:00.000Z")), true);
  pass("B 站公开适配器进入每日自动采集候选");
}

try {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "content-flow-bilibili-"));
  await main();
  console.log(`\nBilibili public regression passed: ${passed}/${passed}`);
} catch (error) {
  console.error(`\nBilibili public regression failed: ${error.stack || error.message}`);
  process.exitCode = 1;
} finally {
  if (tempRoot) {
    const contained = path.relative(os.tmpdir(), tempRoot);
    if (contained && !contained.startsWith("..") && !path.isAbsolute(contained)) {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  }
}
