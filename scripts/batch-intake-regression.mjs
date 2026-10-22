import assert from "node:assert/strict";
import {
  batchIntakeNextAction,
  intakeAuthorCandidate,
  intakeTitleCandidate,
  intakeUrlIdentity,
  parseBatchIntakeText
} from "./batch-intake.mjs";

let passed = 0;

function check(name, fn) {
  fn();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

const firstTitle = "父母老师不教的社会化潜规则！必学“心眼子”";
const secondTitle = "命运不分对错，勇敢是唯一答案";
const twoShares = [
  `12 【${firstTitle} - 刘旺豪啊 | 小红书 - 你的生活兴趣社区】`,
  "口令 K6oJ8ikLRt7iQ3T",
  "https://www.xiaohongshu.com/discovery/item/6ab0badb000000003a02fab8?source=webshare&xsec_token=TOKEN-A&xsec_source=pc_share",
  "",
  `73 【${secondTitle} - 山迪迪Sandy | 小红书 - 你的生活兴趣社区】`,
  "https://www.xiaohongshu.com/explore/6ac77fd6000000001303faf9?xsec_token=TOKEN-B&xsec_source=pc_share"
].join("\n");

check("two blank-line share blocks become two queue items", () => {
  const items = parseBatchIntakeText(twoShares);
  assert.equal(items.length, 2);
  assert.equal(items[0].titleCandidate, firstTitle);
  assert.equal(items[0].authorCandidate, "刘旺豪啊");
  assert.match(items[0].url, /xsec_token=TOKEN-A/);
  assert.equal(items[1].titleCandidate, secondTitle);
  assert.equal(items[1].authorCandidate, "山迪迪Sandy");
  assert.equal(items[1].identityKey, "xiaohongshu:note:6ac77fd6000000001303faf9");
});

check("one dense block splits by URL-bearing lines", () => {
  const text = [
    `【${firstTitle} - 刘旺豪啊 | 小红书】 https://www.xiaohongshu.com/explore/note-one?xsec_token=A`,
    `【${secondTitle} - 山迪迪Sandy | 小红书】 https://www.xiaohongshu.com/explore/note-two?xsec_token=B`
  ].join("\n");
  const items = parseBatchIntakeText(text);
  assert.equal(items.length, 2);
  assert.equal(items[0].titleCandidate, firstTitle);
  assert.equal(items[1].titleCandidate, secondTitle);
});

check("the same note with different share tokens is deduplicated", () => {
  const text = [
    "https://www.xiaohongshu.com/explore/same-note?xsec_token=OLD",
    "https://www.xiaohongshu.com/discovery/item/same-note?xsec_token=NEW&xsec_source=pc_share"
  ].join("\n");
  const items = parseBatchIntakeText(text);
  assert.equal(items.length, 1);
  assert.match(items[0].url, /xsec_token=OLD/);
});

check("profile identity ignores query parameters", () => {
  assert.equal(
    intakeUrlIdentity("https://www.xiaohongshu.com/user/profile/abc123?from=share"),
    "xiaohongshu:profile:abc123"
  );
});

check("ordinary URL identity removes tracking parameters but keeps stable query values", () => {
  const first = intakeUrlIdentity("https://example.com/post/1?utm_source=a&page=2#section");
  const second = intakeUrlIdentity("https://example.com/post/1?page=2&ref=share");
  assert.equal(first, second);
  assert.equal(first, "url:https://example.com/post/1?page=2");
});

check("Chinese punctuation after a pasted URL is trimmed", () => {
  const items = parseBatchIntakeText(
    "https://www.xiaohongshu.com/explore/trailing?xsec_token=T，"
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].url, "https://www.xiaohongshu.com/explore/trailing?xsec_token=T");
});

check("plain share title and author fallbacks remain usable", () => {
  assert.equal(intakeTitleCandidate("作者：徐大金\n标题：高敏感也可以做好自媒体"), "高敏感也可以做好自媒体");
  assert.equal(intakeAuthorCandidate("@徐大金 的主页"), "徐大金");
});

check("a duplicate-only batch points to the existing records", () => {
  assert.equal(
    batchIntakeNextAction({ duplicate: 2, captured: 0, registered: 0, blocked: 0, "needs-browser": 0 }),
    "2 条内容已存在，可直接打开已有记录继续处理"
  );
});

check("blocked items take precedence over reusable duplicates", () => {
  assert.equal(
    batchIntakeNextAction({ duplicate: 1, blocked: 1, captured: 0, registered: 0, "needs-browser": 0 }),
    "打开队列处理浏览器补采或访问阻断"
  );
});

console.log(`\nbatch intake regression: ${passed} passed`);
