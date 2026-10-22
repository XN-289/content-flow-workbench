import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createPlatformMediaCache,
  isAllowedPlatformMediaUrl,
  platformMediaCandidates,
  stableXiaohongshuImageUrl
} from "./platform-media.mjs";

const checks = [];
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "content-flow-media-"));

function pass(name) {
  checks.push(name);
  console.log(`ok - ${name}`);
}

try {
  const expiredFlat = "http://sns-webpic-qc.xhscdn.com/202610211105/hash/1040g008325gaipid4q004bqnb34iiqlrg6h46p0!nd_dft_wlteh_webp_3";
  assert.equal(
    stableXiaohongshuImageUrl(expiredFlat),
    "https://ci.xiaohongshu.com/1040g008325gaipid4q004bqnb34iiqlrg6h46p0!nd_dft_wlteh_webp_3"
  );
  pass("过期的小红书扁平临时地址还原为稳定对象地址");

  const spectrum = "https://sns-webpic-qc.xhscdn.com/202610211124/hash/spectrum/1040g34o31p5ibu2b24105o2ll2g09a0kpjis0ug!nd_dft_wlteh_webp_3";
  assert.equal(
    stableXiaohongshuImageUrl(spectrum),
    "https://ci.xiaohongshu.com/spectrum/1040g34o31p5ibu2b24105o2ll2g09a0kpjis0ug!nd_dft_wlteh_webp_3"
  );
  pass("Spectrum 封面保留稳定路径层级");

  const signed = "https://sns-na-i2.xhscdn.com/notes_pre_post/1040g3k83268m5j7n4e004aql8ntem7u1svtbgmo?sign=abc&t=123";
  assert.equal(
    stableXiaohongshuImageUrl(signed),
    "https://ci.xiaohongshu.com/notes_pre_post/1040g3k83268m5j7n4e004aql8ntem7u1svtbgmo!nd_dft_wlteh_webp_3"
  );
  assert.deepEqual(platformMediaCandidates(signed), [
    "https://ci.xiaohongshu.com/notes_pre_post/1040g3k83268m5j7n4e004aql8ntem7u1svtbgmo!nd_dft_wlteh_webp_3",
    signed
  ]);
  pass("签名封面优先尝试无签名稳定地址并保留原始回退");

  assert.equal(isAllowedPlatformMediaUrl(expiredFlat), true);
  assert.equal(isAllowedPlatformMediaUrl("https://i0.hdslb.com/bfs/archive/demo.jpg"), true);
  assert.equal(isAllowedPlatformMediaUrl("http://127.0.0.1/private.jpg"), false);
  assert.equal(isAllowedPlatformMediaUrl("file:///C:/private.jpg"), false);
  assert.equal(isAllowedPlatformMediaUrl("https://user:pass@i0.hdslb.com/demo.jpg"), false);
  pass("媒体网关只允许平台 CDN 且拒绝本地、文件与带凭据地址");

  const cacheDir = path.join(tempRoot, "cache");
  const calls = [];
  const media = createPlatformMediaCache({
    cacheDir,
    fetchImpl: async (url) => {
      calls.push(url);
      return new Response(new Uint8Array([82, 73, 70, 70, 87, 69, 66, 80]), {
        status: 200,
        headers: { "content-type": "image/webp", "content-length": "8" }
      });
    }
  });
  const first = await media.get(expiredFlat);
  const second = await media.get(expiredFlat);
  assert.equal(first.cache, "miss");
  assert.equal(second.cache, "hit");
  assert.equal(first.content.length, 8);
  assert.equal(calls.length, 1);
  pass("封面首次抓取后落盘，重复展示不再请求平台");

  const metadataFiles = (await fs.readdir(cacheDir)).filter((name) => name.endsWith(".json"));
  assert.equal(metadataFiles.length, 1);
  const metadata = JSON.parse(await fs.readFile(path.join(cacheDir, metadataFiles[0]), "utf8"));
  assert.equal(metadata.contentType, "image/webp");
  assert.equal(metadata.resolvedUrl, stableXiaohongshuImageUrl(expiredFlat));
  pass("缓存元数据记录实际来源、类型和字节数");

  const fallbackCalls = [];
  const fallbackMedia = createPlatformMediaCache({
    cacheDir: path.join(tempRoot, "fallback-cache"),
    fetchImpl: async (url) => {
      fallbackCalls.push(url);
      if (fallbackCalls.length === 1) return new Response(null, { status: 403 });
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/jpeg", "content-length": "3" }
      });
    }
  });
  const fallback = await fallbackMedia.get(signed);
  assert.equal(fallback.resolvedUrl, signed);
  assert.equal(fallbackCalls.length, 2);
  pass("稳定地址失败时回退原始签名地址");

  await assert.rejects(
    () => fallbackMedia.get("http://127.0.0.1/private.jpg"),
    (error) => error.status === 400
  );
  pass("非法图片来源返回明确 400");

  const redirectMedia = createPlatformMediaCache({
    cacheDir: path.join(tempRoot, "redirect-cache"),
    fetchImpl: async () => new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1/private.jpg" }
    })
  });
  await assert.rejects(
    () => redirectMedia.get(expiredFlat),
    /left the approved platform hosts/
  );
  pass("平台 CDN 重定向到本地地址时拒绝跟随");

  console.log(`\nPlatform media regression passed (${checks.length} checks).`);
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
