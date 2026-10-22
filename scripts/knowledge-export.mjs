import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const knowledgeExportSchemaVersion = 2;

function now() {
  return new Date().toISOString();
}

function safeSlug(value, fallback = "item") {
  const slug = String(value || "")
    .replace(/[^A-Za-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
  return slug || fallback;
}

function hashContent(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export function publicShareUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (!["http:", "https:"].includes(url.protocol)) return "";
    if (url.username || url.password) return "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/token|session|cookie|auth|signature|^xsec_/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return "";
  }
}

function transcriptSourceType(source = "", model = "") {
  const marker = `${source} ${model}`.toLowerCase();
  if (marker.includes("platform-subtitle")) return "platform-subtitle";
  if (marker.includes("local-asr")) return "local-asr";
  if (/import|manual|human|pasted|visible-page/.test(marker)) return "imported";
  return "unknown";
}

function transcriptEvidence(run, signal = {}) {
  const input = run.input || {};
  const source = String(input.transcriptSource || signal.transcriptSource || "");
  const model = String(input.transcriptModel || signal.transcriptModel || "");
  const sourceType = input.transcriptSourceType || transcriptSourceType(source, model);
  return {
    evidenceState: input.transcriptEvidenceState || run.evidenceState || "unverified",
    source,
    sourceType,
    model,
    capturedAt: String(input.transcriptCapturedAt || signal.transcriptCapturedAt || ""),
    durationSeconds: Number(input.transcriptDurationSeconds || signal.transcriptDurationSeconds || 0),
    segmentCount: Number(input.segmentCount || (Array.isArray(signal.transcriptSegments) ? signal.transcriptSegments.length : 0)),
    reviewRequired: true
  };
}

function timestampValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, value);
  const text = String(value ?? "").trim();
  if (!text) return null;
  const direct = Number(text);
  if (Number.isFinite(direct)) return Math.max(0, direct);
  const parts = text.split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return null;
}

function chapterEvidence(run, signal = {}) {
  const source = Array.isArray(run.input?.chapters) && run.input.chapters.length
    ? run.input.chapters
    : Array.isArray(signal.chapters) ? signal.chapters : [];
  return source
    .map((chapter, index) => {
      if (!chapter || typeof chapter !== "object") return null;
      const milliseconds = Number(chapter.timeMilliseconds);
      const startSeconds = timestampValue(
        chapter.startSeconds
        ?? chapter.start
        ?? chapter.startTimestamp
        ?? (Number.isFinite(milliseconds) ? milliseconds / 1000 : null)
      );
      return {
        index,
        title: String(chapter.title || "").trim(),
        startSeconds,
        startTimestamp: String(chapter.startTimestamp || "").trim(),
        transcriptExcerpt: String(chapter.transcriptExcerpt || "").trim()
      };
    })
    .filter((chapter) => chapter && (chapter.title || chapter.startSeconds !== null))
    .sort((left, right) => (left.startSeconds ?? 0) - (right.startSeconds ?? 0))
    .map((chapter, index) => ({ ...chapter, index }));
}

function commentEvidence(run, signal = {}) {
  const sourceScope = run.input?.commentScope && typeof run.input.commentScope === "object"
    ? run.input.commentScope
    : signal.commentScope && typeof signal.commentScope === "object" ? signal.commentScope : {};
  const sourceComments = Array.isArray(run.input?.comments)
    ? run.input.comments
    : Array.isArray(signal.comments) ? signal.comments : [];
  const capturedCount = Number(sourceScope.capturedCount ?? sourceComments.length);
  return {
    evidenceState: run.evidenceState || "unverified",
    scope: {
      ...sourceScope,
      capturedCount: Number.isFinite(capturedCount) ? Math.max(0, capturedCount) : sourceComments.length,
      hasMore: sourceScope.hasMore === true,
      complete: sourceScope.complete === true,
      note: String(sourceScope.note || "只保留页面可见或导入的评论样本，不代表全部评论。").trim()
    },
    samples: sourceComments.slice(0, 12).map((comment, index) => ({
      index,
      id: String(comment.id || ""),
      content: String(comment.content || "").trim().slice(0, 600),
      author: String(comment.author || "").trim(),
      likes: Number(comment.likes || 0),
      createdAt: String(comment.createdAt || ""),
      ipLocation: String(comment.ipLocation || "").trim(),
      isAuthor: comment.isAuthor === true,
      subCommentCount: Number(comment.subCommentCount || 0)
    }))
  };
}

function mediaReferences(signal = {}) {
  const items = [
    ...(signal.coverUrl ? [{ type: "image", url: signal.coverUrl, description: "笔记封面" }] : []),
    ...(Array.isArray(signal.mediaItems) ? signal.mediaItems : []),
    ...(Array.isArray(signal.imageDescriptions) ? signal.imageDescriptions : [])
  ];
  const seen = new Set();
  return items
    .filter((item) => item && typeof item === "object" && item.url)
    .filter((item) => {
      const key = String(item.url);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 50)
    .map((item, index) => ({
      index,
      type: ["image", "video"].includes(item.type) ? item.type : "unknown",
      description: String(item.description || "").trim().slice(0, 500),
      storage: item.filePath ? "local-evidence-file" : "local-evidence-manifest",
      localReference: String(item.filePath || ""),
      sha256: String(item.checksum || ""),
      sourceUrlStored: false
    }));
}

function evidencePackageReference(state, signalId) {
  const record = (state.evidencePackages || []).find((item) => item.signalId === signalId);
  if (!record) return null;
  return {
    evidenceState: record.verification?.state || "unverified",
    packageId: record.id || "",
    packagePath: record.packagePath || "",
    transcriptEvidenceState: record.transcript?.evidenceState || "unverified",
    transcriptSourceType: record.transcript?.sourceType || "",
    transcriptModel: record.transcript?.model || "",
    transcriptCapturedAt: record.transcript?.capturedAt || "",
    transcriptReviewRequired: record.transcript?.reviewRequired === true,
    chapterCount: Number(record.chapterCount || 0),
    commentScope: record.commentScope || null
  };
}

function safeUrlToken(value) {
  const url = publicShareUrl(value);
  if (!url) return "";
  const hostname = new URL(url).hostname.toLowerCase();
  const isMediaHost = hostname === "xhscdn.com" || hostname.endsWith(".xhscdn.com")
    || hostname === "xhscdn.net" || hostname.endsWith(".xhscdn.net");
  return isMediaHost ? `[media-url-omitted:${hostname}]` : url;
}

function sanitizeKnowledgeValue(value, key = "") {
  if (Array.isArray(value)) return value.map((item) => sanitizeKnowledgeValue(item, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([entryKey]) => !/^(?:cookie|cookies|session|sessionId|authorization|password|accessToken|refreshToken|xsecToken)$/i.test(entryKey))
        .map(([entryKey, entryValue]) => [entryKey, sanitizeKnowledgeValue(entryValue, entryKey)])
    );
  }
  if (typeof value !== "string") return value;
  return value.replace(/https?:\/\/[^\s<>"')]+/gi, (url) => safeUrlToken(url) || "[url-omitted]");
}

function markdownEscape(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function renderQuote(quote) {
  if (!quote) return "无可用引文";
  return `> ${markdownEscape(quote.text)}\n>\n> 时间：${quote.startTimestamp} - ${quote.endTimestamp}  \n> 用途：${markdownEscape(quote.why || "候选证据")}\n> 状态：unverified`;
}

function analysisMarkdown(run, signal, evidenceReference) {
  const analysis = run.analysis || {};
  const transcript = transcriptEvidence(run, signal || {});
  const chapters = chapterEvidence(run, signal || {});
  const comments = commentEvidence(run, signal || {});
  const media = mediaReferences(signal || {});
  const structure = (analysis.structure || []).map((part) => (
    `### ${part.label}\n\n${part.candidateSummary || ""}\n\n${renderQuote(part.quote)}\n`
  )).join("\n");
  const retention = (analysis.retention || []).map((item) => (
    `- **${item.label}**（${item.count} 次）：${item.why}`
  )).join("\n");
  const gaps = (analysis.evidenceGaps || []).map((gap) => `- ${gap}`).join("\n");
  const quotes = (analysis.quotes || []).map((quote, index) => (
    `### 引文 ${index + 1}\n\n${renderQuote(quote)}`
  )).join("\n\n");
  const chapterLines = chapters.map((chapter) => (
    `- ${chapter.startTimestamp || "时间未标注"} ${chapter.title || "(无标题)"}`
  )).join("\n");
  const commentLines = comments.samples.slice(0, 8).map((comment) => (
    `> ${markdownEscape(comment.content)}\n>\n> 作者：${markdownEscape(comment.author || "未知")} · 赞：${comment.likes} · 状态：unverified`
  )).join("\n\n");
  const mediaLines = media.map((item) => (
    `- ${item.type}：${item.description || "未描述"}；长期导出不保存签名 URL${item.localReference ? `；本地引用 ${markdownEscape(item.localReference)}` : ""}`
  )).join("\n");
  return `# ${signal?.title || "逐字稿分析"}

> 证据状态：unverified
>
> 分析模式：${run.sourceMode || ""}
>
> 生成时间：${run.finishedAt || run.createdAt || ""}

## 逐字稿证据

- 来源类型：${transcript.sourceType}
- 原始来源标记：${transcript.source || "未标注"}
- 模型：${transcript.model || "未标注"}
- 采集时间：${transcript.capturedAt || "未标注"}
- 时长：${transcript.durationSeconds || 0} 秒
- 分段：${transcript.segmentCount}
- 人工核对：必需
- 证据包：${evidenceReference?.packagePath || "未创建/未关联"}

## 一句话结论

${analysis.summary || "暂无结论"}

## 开头钩子

${analysis.hook?.candidateRead || "暂无判断"}

${renderQuote(analysis.hook?.quote)}

## 结构与原文

${structure || "暂无结构分析"}

## 节奏

${analysis.pacing?.candidateRead || "暂无节奏判断"}

- 时长：${analysis.pacing?.durationSeconds ?? 0} 秒
- 字数：${analysis.pacing?.characterCount ?? 0}
- 平均语速：${analysis.pacing?.charsPerSecond ?? 0} 字/秒
- 最快 15 秒：${analysis.pacing?.fastestWindow?.startTimestamp || "未识别"} - ${analysis.pacing?.fastestWindow?.endTimestamp || "未识别"}

## 章节

${chapterLines || "- 未发现平台章节元数据"}

## 评论范围

- 当前采集：${comments.scope.capturedCount} 条
- hasMore：${comments.scope.hasMore}
- complete：${comments.scope.complete}
- 口径：${comments.scope.note}

${commentLines || "暂无可展示评论样本"}

## 留存机制候选

${retention || "未识别到明显的文本机制"}

## 情绪回报候选

${analysis.emotionalPayoff?.candidateRead || "暂无判断"}

## 作者相对表现

${analysis.authorBaseline?.candidateRead || "暂无同作者基线"}

## 可复用公式（假设）

- 名称：${analysis.reusableFormula?.name || "未生成"}
- 骨架：${analysis.reusableFormula?.skeleton || "未生成"}
- 使用边界：${analysis.reusableFormula?.candidateUse || "只能作为待验证假设"}

## 待核对与证据缺口

${gaps || "- 暂无记录"}

## 媒体引用

- 长期知识导出不保存 CDN 签名 URL；原始地址只留在本地证据包按需使用。

${mediaLines || "- 无媒体引用"}

## 可回溯引文

${quotes || "暂无引用"}
`;
}

function transcriptDocument(signal, run, evidenceReference) {
  const transcript = transcriptEvidence(run, signal);
  const chapters = chapterEvidence(run, signal);
  const comments = commentEvidence(run, signal);
  return {
    schemaVersion: knowledgeExportSchemaVersion,
    evidenceState: "unverified",
    transcriptEvidenceState: transcript.evidenceState,
    id: signal.id,
    signalId: signal.id,
    title: signal.title || "",
    author: signal.author || "",
    authorId: signal.authorId || "",
    platform: signal.platform || "",
    url: publicShareUrl(signal.url),
    sourceProfileUrl: publicShareUrl(signal.sourceProfileUrl),
    capturedAt: signal.capturedAt || "",
    captureState: signal.captureState || "",
    pageAccess: {
      loginPromptPresent: signal.pageAccess?.loginPromptPresent === true,
      verificationPresent: signal.pageAccess?.verificationPresent === true,
      mode: signal.pageAccess?.mode || ""
    },
    extraction: signal.extraction && typeof signal.extraction === "object" ? signal.extraction : {},
    transcriptSource: transcript.source,
    transcriptSourceType: transcript.sourceType,
    transcriptModel: transcript.model,
    transcriptCapturedAt: transcript.capturedAt,
    transcriptDurationSeconds: transcript.durationSeconds,
    transcriptNote: signal.transcriptNote || "",
    transcriptText: signal.transcriptText || "",
    transcriptSegments: Array.isArray(signal.transcriptSegments) ? signal.transcriptSegments : [],
    chapters,
    comments,
    mediaReferences: mediaReferences(signal),
    evidencePackage: evidenceReference,
    privacy: {
      signedMediaUrlsIncluded: false,
      credentialsIncluded: false,
      rawBrowserArtifactsIncluded: false
    }
  };
}

async function writeAtomicFile(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${crypto.randomUUID().slice(0, 8)}.tmp`;
  await fs.writeFile(temporary, content, "utf8");
  try {
    await fs.rename(temporary, filePath);
  } catch (error) {
    if (!["EEXIST", "EPERM"].includes(error.code)) {
      await fs.rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
    const backup = `${filePath}.${crypto.randomUUID().slice(0, 8)}.bak`;
    const targetExists = await fs.stat(filePath).then(() => true, () => false);
    if (targetExists) await fs.rename(filePath, backup);
    try {
      await fs.rename(temporary, filePath);
      if (targetExists) await fs.rm(backup, { force: true });
    } catch (renameError) {
      if (targetExists) await fs.rename(backup, filePath).catch(() => {});
      await fs.rm(temporary, { force: true }).catch(() => {});
      throw renameError;
    }
  }
}

export async function exportKnowledgeToDrive({
  state = {},
  driveRoot = "",
  timestamp = now(),
  exportId = `knowledge-${String(timestamp).slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}`
} = {}) {
  const root = String(driveRoot || "").trim();
  if (!root) throw new Error("未配置 Google Drive 同步目录");
  const rootStat = await fs.stat(path.resolve(root)).catch(() => null);
  if (!rootStat?.isDirectory()) throw new Error("Google Drive 同步目录不存在");
  const targetRoot = path.join(path.resolve(root), "ContentFlowWorkbench", "Knowledge");
  const analyses = (state.analysisRuns || []).filter((run) => run.status === "completed");
  if (!analyses.length) throw new Error("暂无可导出的逐字稿分析，请先生成候选拆解");

  const stagingRoot = path.join(path.resolve(root), "ContentFlowWorkbench", `.Knowledge-${crypto.randomUUID().slice(0, 8)}.tmp`);
  const stagedFiles = [];
  const stageFile = async (relativePath, content) => {
    const contentText = typeof content === "string" ? content : JSON.stringify(content, null, 2);
    const stagedPath = path.join(stagingRoot, ...relativePath.split("/"));
    await fs.mkdir(path.dirname(stagedPath), { recursive: true });
    await fs.writeFile(stagedPath, contentText, "utf8");
    stagedFiles.push({
      relativePath,
      stagedPath,
      sha256: hashContent(contentText),
      bytes: Buffer.byteLength(contentText, "utf8")
    });
  };

  try {
    for (const run of analyses) {
      const signal = (state.signals || []).find((item) => item.id === run.signalId) || null;
      const evidenceReference = evidencePackageReference(state, run.signalId);
      const analysisStem = safeSlug(run.id, "analysis");
      await stageFile(`analyses/${analysisStem}.json`, sanitizeKnowledgeValue(run));
      await stageFile(
        `analyses/${analysisStem}.md`,
        sanitizeKnowledgeValue(analysisMarkdown(run, signal, evidenceReference))
      );
      if (signal?.transcriptText) {
        await stageFile(
          `transcripts/${safeSlug(signal.id, "signal")}.json`,
          sanitizeKnowledgeValue(transcriptDocument(signal, run, evidenceReference))
        );
      }
    }

    const manifest = {
      schemaVersion: knowledgeExportSchemaVersion,
      exportId,
      generatedAt: timestamp,
      evidenceState: "unverified",
      sourceOfWorkbenchState: "local",
      workspace: {
        sourceCount: (state.sources || []).length,
        signalCount: (state.signals || []).length,
        analysisCount: analyses.length
      },
      privacy: {
        credentialsIncluded: false,
        cookiesIncluded: false,
        loginStateIncluded: false,
        rawBrowserArtifactsIncluded: false,
        signedMediaUrlsIncluded: false,
        urlParametersSanitized: true
      },
      files: stagedFiles.map((file) => ({
        path: file.relativePath,
        sha256: file.sha256,
        bytes: file.bytes
      }))
    };
    await stageFile("manifest.json", manifest);

    await fs.mkdir(targetRoot, { recursive: true });
    for (const file of stagedFiles.sort((a, b) => a.relativePath === "manifest.json" ? 1 : b.relativePath === "manifest.json" ? -1 : a.relativePath.localeCompare(b.relativePath))) {
      const destination = path.join(targetRoot, ...file.relativePath.split("/"));
      const content = await fs.readFile(file.stagedPath);
      await writeAtomicFile(destination, content);
    }
    await writeAtomicFile(
      path.join(targetRoot, "README.md"),
      `# Content Flow Workbench Knowledge\n\nGenerated: ${timestamp}\n\n- Treat all transcript and analysis material as unverified.\n- Preserve transcript source, model, timestamps, chapter boundaries, and comment scope when citing it.\n- Quote timestamps are required for traceability.\n- Do not treat heuristics as platform causal evidence.\n- Signed or expiring media URLs are intentionally omitted; use the local evidence package for the raw reference.\n`
    );
    return {
      ok: true,
      exportId,
      generatedAt: timestamp,
      targetRoot,
      analysisCount: analyses.length,
      transcriptCount: analyses.filter((run) => (state.signals || []).some((signal) => signal.id === run.signalId && signal.transcriptText)).length,
      fileCount: stagedFiles.length + 1,
      manifest
    };
  } finally {
    await fs.rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
  }
}

export function knowledgeExportRuntime(state = {}) {
  const runs = Array.isArray(state.knowledgeExports) ? state.knowledgeExports : [];
  return {
    generatedAt: now(),
    exportCount: runs.length,
    latest: runs[0] || null,
    configuredDriveRoot: Boolean(String(state.settings?.driveRoot || "").trim()),
    boundary: "只在用户显式触发时写入 Google Drive 同步目录；不导出 Cookie、登录态或浏览器 profile。"
  };
}
