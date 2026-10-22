import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { analysisSchemaVersion, createTranscriptAnalysis } from "./analysis-workflow.mjs";
import { createSignalEvidencePackage, evidencePackageSchemaVersion } from "./evidence-package.mjs";
import { exportKnowledgeToDrive, knowledgeExportSchemaVersion } from "./knowledge-export.mjs";

const transcriptSegments = [
  { start: 0, end: 6, startTimestamp: "00:00.000", endTimestamp: "00:06.000", text: "很多普通人以为社交只能靠讨好。" },
  { start: 6, end: 14, startTimestamp: "00:06.000", endTimestamp: "00:14.000", text: "但真正关键的是边界和自我感受。" },
  { start: 14, end: 24, startTimestamp: "00:14.000", endTimestamp: "00:24.000", text: "第一识别感受，第二表达需求。" },
  { start: 24, end: 32, startTimestamp: "00:24.000", endTimestamp: "00:32.000", text: "最后承担关系变化，不用让所有人满意。" }
];

function platformSignal() {
  return {
    id: "signal-platform-subtitle",
    sourceId: "source-xhs",
    collectionRunId: "run-xhs",
    platform: "xiaohongshu",
    url: "https://www.xiaohongshu.com/explore/platform-note?xsec_token=share-secret&ref=web",
    title: "平台字幕证据链回归样本",
    author: "回归作者",
    authorId: "author-123",
    sourceProfileUrl: "https://www.xiaohongshu.com/user/profile/author-123?xsec_token=profile-secret",
    capturedAt: "2026-10-22T00:00:00.000Z",
    contentText: "这是笔记正文，不是逐字稿。",
    coverUrl: "https://sns-webpic-qc.xhscdn.com/cover.jpg?signature=cover-secret",
    mediaItems: [{
      type: "video",
      description: "公开视频 MP4",
      url: "https://sns-video-hw.xhscdn.com/video.mp4?signature=media-secret&expires=9999999999"
    }],
    captureState: "captured-public",
    pageAccess: {
      mode: "guest-chrome",
      loginPromptPresent: false,
      verificationPresent: false,
      finalUrl: "https://www.xiaohongshu.com/explore/platform-note?xsec_token=page-secret"
    },
    extraction: {
      privateApiCalled: false,
      capturedCookies: false,
      mediaDownloaded: false
    },
    chapters: [
      { index: 0, title: "开场判断", startSeconds: 0, startTimestamp: "00:00.000" },
      { index: 1, title: "机制拆解", startSeconds: 14, startTimestamp: "00:14.000" }
    ],
    comments: [
      { id: "c1", content: "说到边界了", author: "用户A", likes: 18, isAuthor: false, subCommentCount: 1 },
      {
        id: "c2",
        content: "这个角度很有用 https://sns-webpic-qc.xhscdn.com/comment.jpg?signature=comment-secret",
        author: "用户B",
        likes: 7,
        isAuthor: false,
        subCommentCount: 0
      }
    ],
    commentScope: {
      source: "natural-first-page",
      capturedCount: 2,
      hasMore: true,
      cursorPresent: true,
      complete: false,
      note: "仅首屏自然加载评论。"
    },
    transcriptStatus: "captured",
    transcriptText: transcriptSegments.map((segment) => segment.text).join(""),
    transcriptSource: "platform-subtitle:zh-CN",
    transcriptModel: "platform-subtitle:zh-CN",
    transcriptDurationSeconds: 32,
    transcriptCapturedAt: "2026-10-22T00:01:00.000Z",
    transcriptSegments
  };
}

test("platform subtitle evidence propagates without exposing signed media URLs", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "content-flow-downstream-"));
  try {
    const signal = platformSignal();
    const state = {
      sources: [{
        id: "source-xhs",
        name: "回归信源",
        account: "回归作者",
        url: "https://www.xiaohongshu.com/user/profile/author-123?xsec_token=source-secret",
        platform: "xiaohongshu",
        collectionMethod: "browser-assisted",
        dataBoundary: "guest-visible"
      }],
      collectionRuns: [{ id: "run-xhs", status: "ok" }],
      rawSnapshots: [{ id: "snapshot-xhs", runId: "run-xhs", capturedAt: signal.capturedAt }],
      signals: [signal],
      analysisRuns: [],
      evidencePackages: []
    };

    const analysis = createTranscriptAnalysis({
      state,
      signalId: signal.id,
      timestamp: "2026-10-22T00:02:00.000Z",
      runId: "analysis-platform-subtitle"
    });
    assert.equal(analysisSchemaVersion, 2);
    assert.equal(analysis.input.transcriptSource, signal.transcriptSource);
    assert.equal(analysis.input.transcriptSourceType, "platform-subtitle");
    assert.equal(analysis.input.transcriptModel, signal.transcriptModel);
    assert.equal(analysis.input.transcriptDurationSeconds, signal.transcriptDurationSeconds);
    assert.equal(analysis.input.transcriptCapturedAt, signal.transcriptCapturedAt);
    assert.equal(analysis.input.transcriptSegments.length, transcriptSegments.length);
    assert.equal(analysis.input.chapters.length, 2);
    assert.equal(analysis.input.commentScope.hasMore, true);
    assert.equal(analysis.analysis.agentContext.transcript.sourceType, "platform-subtitle");
    assert.equal(analysis.analysis.agentContext.transcriptSegments.length, transcriptSegments.length);
    assert.equal(analysis.analysis.agentContext.commentScope.capturedCount, 2);
    assert.doesNotMatch(analysis.analysis.evidenceGaps.join("\n"), /逐字稿来自本地 ASR/);

    const evidence = await createSignalEvidencePackage({
      state,
      signalId: signal.id,
      evidenceRoot: path.join(tempRoot, "evidence"),
      now: () => "2026-10-22T00:03:00.000Z"
    });
    assert.equal(evidencePackageSchemaVersion, 2);
    const evidenceDirectory = path.join(tempRoot, "evidence", evidence.record.packageKey);
    const meta = JSON.parse(await fs.readFile(path.join(evidenceDirectory, "meta.json"), "utf8"));
    const transcriptMarkdown = await fs.readFile(path.join(evidenceDirectory, "candidate", "transcript.md"), "utf8");
    assert.equal(meta.schemaVersion, 2);
    assert.equal(meta.provenance.authorId, signal.authorId);
    assert.equal(meta.provenance.captureState, "captured-public");
    assert.equal(meta.transcript.sourceType, "platform-subtitle");
    assert.equal(meta.transcript.model, signal.transcriptModel);
    assert.equal(meta.transcript.capturedAt, signal.transcriptCapturedAt);
    assert.equal(meta.transcript.durationSeconds, signal.transcriptDurationSeconds);
    assert.equal(meta.transcript.evidenceState, "unverified");
    assert.equal(meta.chapters.length, 2);
    assert.equal(meta.comments.scope.hasMore, true);
    assert.match(transcriptMarkdown, /Evidence state: unverified/);
    assert.match(transcriptMarkdown, /Source type: platform-subtitle/);
    assert.doesNotMatch(transcriptMarkdown, /local ASR candidate/);

    state.analysisRuns.push(analysis);
    const driveRoot = path.join(tempRoot, "drive");
    await fs.mkdir(driveRoot);
    const exported = await exportKnowledgeToDrive({
      state,
      driveRoot,
      timestamp: "2026-10-22T00:04:00.000Z",
      exportId: "knowledge-platform-subtitle"
    });
    const knowledgeRoot = path.join(driveRoot, "ContentFlowWorkbench", "Knowledge");
    const manifest = JSON.parse(await fs.readFile(path.join(knowledgeRoot, "manifest.json"), "utf8"));
    assert.equal(knowledgeExportSchemaVersion, 2);
    assert.equal(manifest.privacy.signedMediaUrlsIncluded, false);
    const transcriptFile = manifest.files.find((file) => file.path.startsWith("transcripts/"));
    const analysisFile = manifest.files.find((file) => file.path.endsWith(".json") && file.path.startsWith("analyses/"));
    const analysisMarkdownFile = manifest.files.find((file) => file.path.endsWith(".md") && file.path.startsWith("analyses/"));
    assert.ok(transcriptFile);
    assert.ok(analysisFile);
    assert.ok(analysisMarkdownFile);
    const transcriptDocument = JSON.parse(await fs.readFile(path.join(knowledgeRoot, ...transcriptFile.path.split("/")), "utf8"));
    const analysisDocument = await fs.readFile(path.join(knowledgeRoot, ...analysisFile.path.split("/")), "utf8");
    const analysisMarkdown = await fs.readFile(path.join(knowledgeRoot, ...analysisMarkdownFile.path.split("/")), "utf8");
    assert.equal(transcriptDocument.transcriptSourceType, "platform-subtitle");
    assert.equal(transcriptDocument.transcriptEvidenceState, "unverified");
    assert.equal(transcriptDocument.chapters.length, 2);
    assert.equal(transcriptDocument.comments.scope.hasMore, true);
    assert.equal(transcriptDocument.mediaReferences[0].sourceUrlStored, false);
    assert.equal(exported.ok, true);
    assert.doesNotMatch(transcriptDocument.url, /xsec_token/);
    assert.doesNotMatch(JSON.stringify(transcriptDocument), /signature=media-secret|share-secret|profile-secret/);
    assert.doesNotMatch(analysisDocument, /signature=media-secret|share-secret|profile-secret|comment-secret/);
    assert.doesNotMatch(analysisMarkdown, /signature=media-secret|share-secret|profile-secret|comment-secret/);
    assert.match(analysisMarkdown, /来源类型：platform-subtitle/);
    assert.match(analysisMarkdown, /评论范围/);
    assert.match(analysisMarkdown, /hasMore：true/);
    assert.match(analysisMarkdown, /章节/);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("local ASR remains explicitly labeled and unverified", () => {
  const signal = {
    ...platformSignal(),
    id: "signal-local-asr",
    transcriptSource: "local-asr:whisper-int8-cpu",
    transcriptModel: "whisper-int8-cpu"
  };
  const analysis = createTranscriptAnalysis({
    state: { signals: [signal] },
    signalId: signal.id,
    timestamp: "2026-10-22T00:02:00.000Z",
    runId: "analysis-local-asr"
  });
  assert.equal(analysis.input.transcriptSourceType, "local-asr");
  assert.equal(analysis.analysis.agentContext.transcript.evidenceState, "unverified");
  assert.match(analysis.analysis.evidenceGaps.join("\n"), /逐字稿来自本地 ASR/);
});
