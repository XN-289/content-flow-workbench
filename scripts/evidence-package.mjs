import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const evidencePackageSchemaVersion = 2;

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function safePackageKey(subjectType, subjectId) {
  const digest = crypto.createHash("sha256").update(`${subjectType}:${subjectId}`).digest("hex").slice(0, 12);
  const slug = String(subjectId)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${subjectType}-${slug || "subject"}-${digest}`;
}

function writeFileAtomic(filePath, content) {
  const temporary = `${filePath}.${crypto.randomUUID()}.tmp`;
  return (async () => {
    await fs.writeFile(temporary, content, "utf8");
    await fs.rename(temporary, filePath);
  })();
}

async function writeJsonFile(filePath, value) {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  await writeFileAtomic(filePath, content);
  return { content, hash: sha256(content) };
}

function sourceCoverage(source, rawSnapshot, collectionRun) {
  if (source?.coverage) {
    return {
      ...source.coverage,
      scope: "source-visible-range",
      note: "来自信源当前覆盖率；unknown 不代表不存在，只代表总数未确认。"
    };
  }
  return {
    status: "unknown",
    note: rawSnapshot
      ? "该证据保留了采集原始输入，但信源没有可确认的总数口径。"
      : "该信号缺少采集原始快照，先按候选证据处理。",
    scope: collectionRun ? "single-capture" : "manual-record"
  };
}

function mediaItems(signal = {}) {
  const rawItems = [
    ...(Array.isArray(signal.mediaItems) ? signal.mediaItems : []),
    ...(Array.isArray(signal.imageDescriptions) ? signal.imageDescriptions : [])
  ];
  return rawItems
    .filter((item) => item && typeof item === "object" && item.url)
    .filter((item, index, items) => items.findIndex((other) => other.url === item.url) === index)
    .map((item) => ({
      type: ["image", "video"].includes(item.type) ? item.type : "unknown",
      url: String(item.url),
      description: String(item.description || ""),
      status: "not-downloaded",
      filePath: "",
      downloadedAt: "",
      checksum: ""
    }));
}

function publicPageUrl(value) {
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

function transcriptReviewNote(sourceType) {
  if (sourceType === "platform-subtitle") {
    return "平台字幕轨也不等于已核验文本；错字、断句和覆盖范围仍需人工核对。";
  }
  if (sourceType === "local-asr") {
    return "本地 ASR 可能有同音字、断句和术语错误，引用前必须人工核对。";
  }
  if (sourceType === "imported") {
    return "导入或人工记录需核对原始来源、完整性与时间轴。";
  }
  return "逐字稿来源未明确标注，不能假定它来自 ASR 或平台字幕。";
}

function transcriptEvidence(signal = {}) {
  const source = String(signal.transcriptSource || "");
  const model = String(signal.transcriptModel || "");
  const sourceType = transcriptSourceType(source, model);
  return {
    evidenceState: "unverified",
    status: String(signal.transcriptStatus || "missing"),
    source,
    sourceType,
    model,
    capturedAt: String(signal.transcriptCapturedAt || ""),
    durationSeconds: Number(signal.transcriptDurationSeconds || 0),
    reviewRequired: true,
    reviewNote: transcriptReviewNote(sourceType)
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

function chapterEvidence(signal = {}) {
  const chapters = Array.isArray(signal.chapters) ? signal.chapters : [];
  return chapters
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
        startTimestamp: String(chapter.startTimestamp || "").trim()
          || (startSeconds === null ? "" : formatTranscriptTimestamp(startSeconds))
      };
    })
    .filter((chapter) => chapter && (chapter.title || chapter.startSeconds !== null))
    .sort((left, right) => (left.startSeconds ?? 0) - (right.startSeconds ?? 0))
    .map((chapter, index) => ({ ...chapter, index }));
}

function commentEvidence(signal = {}) {
  const comments = Array.isArray(signal.comments) ? signal.comments : [];
  const sourceScope = signal.commentScope && typeof signal.commentScope === "object"
    ? signal.commentScope
    : {};
  const capturedCount = Number(sourceScope.capturedCount ?? comments.length);
  const samples = comments
    .filter((comment) => comment && typeof comment === "object" && String(comment.content || "").trim())
    .slice(0, 20)
    .map((comment, index) => ({
      index,
      id: String(comment.id || ""),
      content: String(comment.content || "").trim().slice(0, 1000),
      author: String(comment.author || "").trim(),
      likes: Number(comment.likes || 0),
      createdAt: String(comment.createdAt || ""),
      ipLocation: String(comment.ipLocation || "").trim(),
      isAuthor: comment.isAuthor === true,
      subCommentCount: Number(comment.subCommentCount || 0)
    }));
  return {
    evidenceState: "unverified",
    scope: {
      ...sourceScope,
      capturedCount: Number.isFinite(capturedCount) ? Math.max(0, capturedCount) : comments.length,
      hasMore: sourceScope.hasMore === true,
      complete: sourceScope.complete === true,
      note: String(sourceScope.note || "只记录页面可见或导入的评论，不代表全部评论。").trim()
    },
    samples,
    samplesTruncated: comments.length > samples.length,
    totalSamplesAvailable: comments.length
  };
}

function safePageAccess(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return {
    ...value,
    ...(value.finalUrl ? { finalUrl: publicPageUrl(value.finalUrl) } : {}),
    ...(value.effectiveUrl ? { effectiveUrl: publicPageUrl(value.effectiveUrl) } : {})
  };
}

function formatTranscriptTimestamp(value) {
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  const seconds = Number.isFinite(Number(value)) ? Number(value) : 0;
  const totalMilliseconds = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(totalMilliseconds / 3600000);
  const minutes = Math.floor((totalMilliseconds % 3600000) / 60000);
  const secondPart = Math.floor((totalMilliseconds % 60000) / 1000);
  const milliseconds = totalMilliseconds % 1000;
  const minutePart = hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
    : String(minutes).padStart(2, "0");
  return `${minutePart}:${String(secondPart).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}

function verificationFrom(existing = {}) {
  return {
    state: ["unverified", "verified", "rejected"].includes(existing.state) ? existing.state : "unverified",
    checkedAt: String(existing.checkedAt || ""),
    checkedBy: String(existing.checkedBy || ""),
    note: String(existing.note || "")
  };
}

export function createEvidenceRuntime(state) {
  const packages = Array.isArray(state.evidencePackages) ? state.evidencePackages : [];
  return {
    total: packages.length,
    unverified: packages.filter((item) => item.verification?.state === "unverified").length,
    verified: packages.filter((item) => item.verification?.state === "verified").length,
    rejected: packages.filter((item) => item.verification?.state === "rejected").length,
    missingRawEvidence: packages.filter((item) => item.missingLayers?.includes("raw-snapshot")).length
  };
}

export async function createSignalEvidencePackage({
  state,
  signalId,
  evidenceRoot,
  now = () => new Date().toISOString()
}) {
  const signal = (state.signals || []).find((item) => item.id === signalId);
  if (!signal) throw new Error("signal not found");

  const source = (state.sources || []).find((item) => item.id === signal.sourceId) || null;
  const collectionRun = (state.collectionRuns || []).find((item) => item.id === signal.collectionRunId) || null;
  const transcript = transcriptEvidence(signal);
  const chapters = chapterEvidence(signal);
  const comments = commentEvidence(signal);
  const captureState = String(signal.captureState || "").trim();
  const authorId = String(signal.authorId || "").trim();
  const sourceProfileUrl = publicPageUrl(signal.sourceProfileUrl);
  const pageAccess = safePageAccess(signal.pageAccess);
  const extraction = signal.extraction && typeof signal.extraction === "object"
    ? { ...signal.extraction }
    : {};
  const rawSnapshots = (state.rawSnapshots || [])
    .filter((snapshot) => (
      (Boolean(snapshot.runId) && snapshot.runId === signal.collectionRunId)
      || snapshot.id === signal.rawSnapshotId
    ))
    .slice(0, 3);
  const rawSnapshot = rawSnapshots[0] || null;
  const timestamp = now();
  const evidenceId = `evidence-${crypto.createHash("sha256").update(`signal:${signal.id}`).digest("hex").slice(0, 16)}`;
  const packageKey = safePackageKey("signal", signal.id);
  const packageDirectory = path.resolve(evidenceRoot, packageKey);
  const relativePackagePath = `evidence/${packageKey}`;
  const contained = path.relative(path.resolve(evidenceRoot), packageDirectory);
  if (!contained || path.isAbsolute(contained) || contained.startsWith("..")) {
    throw new Error("evidence package path escapes evidence root");
  }

  const packages = Array.isArray(state.evidencePackages) ? state.evidencePackages : [];
  const existing = packages.find((item) => item.signalId === signal.id) || null;
  const verification = verificationFrom(existing?.verification);
  await fs.mkdir(packageDirectory, { recursive: true });
  await fs.mkdir(path.join(packageDirectory, "raw"), { recursive: true });
  await fs.mkdir(path.join(packageDirectory, "candidate"), { recursive: true });

  const hashes = new Map();
  const signalEvidence = {
    schemaVersion: evidencePackageSchemaVersion,
    layer: "raw-signal",
    capturedFrom: "workbench structured signal",
    signal
  };
  const signalFile = await writeJsonFile(path.join(packageDirectory, "raw", "signal.json"), signalEvidence);
  hashes.set("raw/signal.json", signalFile.hash);

  if (rawSnapshot) {
    const snapshotFile = await writeJsonFile(path.join(packageDirectory, "raw", "snapshot.json"), {
      schemaVersion: evidencePackageSchemaVersion,
      layer: "raw-snapshot",
      snapshot: rawSnapshot
    });
    hashes.set("raw/snapshot.json", snapshotFile.hash);
  }

  const transcriptSegments = Array.isArray(signal.transcriptSegments) ? signal.transcriptSegments : [];
  const hasTranscript = signal.transcriptStatus === "captured" && Boolean(String(signal.transcriptText || "").trim());
  if (hasTranscript) {
    const transcriptLines = [
      "# Candidate Transcript",
      "",
      "This transcript is candidate evidence and requires human review.",
      "",
      `- Signal ID: ${signal.id}`,
      `- Status: ${signal.transcriptStatus}`,
      `- Evidence state: ${transcript.evidenceState}`,
      `- Source type: ${transcript.sourceType}`,
      `- Source: ${transcript.source || "unknown"}`,
      `- Model: ${transcript.model || "unknown"}`,
      `- Captured at: ${transcript.capturedAt || "unknown"}`,
      `- Duration seconds: ${transcript.durationSeconds || "unknown"}`,
      `- Segment count: ${transcriptSegments.length}`,
      `- Review note: ${transcript.reviewNote}`,
      `- Artifact path: ${signal.transcriptArtifactPath || "missing"}`,
      "",
      "## Transcript",
      "",
      String(signal.transcriptText || ""),
      "",
      "## Timeline",
      ""
    ];
    for (const segment of transcriptSegments) {
      transcriptLines.push(`${formatTranscriptTimestamp(segment.startTimestamp ?? segment.start)} - ${formatTranscriptTimestamp(segment.endTimestamp ?? segment.end)}: ${String(segment.text || "")}`);
    }
    if (chapters.length) {
      transcriptLines.push("", "## Platform Chapters", "");
      for (const chapter of chapters) {
        transcriptLines.push(`- ${chapter.startTimestamp || "unknown"} ${chapter.title || "(untitled)"}`);
      }
    }
    const transcriptContent = `${transcriptLines.join("\n")}\n`;
    await writeFileAtomic(path.join(packageDirectory, "candidate", "transcript.md"), transcriptContent);
    hashes.set("candidate/transcript.md", sha256(transcriptContent));
  }

  const candidateLines = [
    "# Candidate Evidence",
    "",
    "This file is a human-review working copy. It is not a verified fact.",
    "",
    `- Evidence ID: ${evidenceId}`,
    `- Signal ID: ${signal.id}`,
    `- Platform: ${signal.platform || "other"}`,
    `- Author: ${signal.author || "unknown"}`,
    `- Author ID: ${authorId || "unknown"}`,
    `- Source profile: ${sourceProfileUrl || "missing"}`,
    `- Source URL: ${publicPageUrl(signal.url) || "missing"}`,
    `- Captured at: ${signal.capturedAt || "unknown"}`,
    `- Capture state: ${captureState || "unknown"}`,
    `- Verification: ${verification.state}`,
    `- Chapters: ${chapters.length}`,
    `- Comments: ${comments.scope.capturedCount} captured, hasMore=${comments.scope.hasMore}`,
    "",
    "## Title",
    "",
    signal.title || "(missing title)",
    "",
    "## Machine-Extracted Text",
    "",
    String(signal.contentText || "(no extracted text)"),
    "",
    "## Data Point Candidates",
    ""
  ];
  for (const item of Array.isArray(signal.dataPointCandidates) ? signal.dataPointCandidates : []) {
    candidateLines.push(`- ${String(item || "")}`);
  }
  if (!candidateLines.at(-1)) candidateLines.push("(none)");
  const candidateContent = `${candidateLines.join("\n")}\n`;
  await writeFileAtomic(path.join(packageDirectory, "candidate", "excerpt.md"), candidateContent);
  hashes.set("candidate/excerpt.md", sha256(candidateContent));

  const media = mediaItems(signal);
  const mediaManifest = {
    schemaVersion: evidencePackageSchemaVersion,
    evidenceId,
    status: media.length ? "not-downloaded" : "empty",
    urlPolicy: "URLs are retained only in this local evidence package for current capture/download; signed or expiring media URLs must not be copied into Drive knowledge exports.",
    items: media
  };
  const mediaFile = await writeJsonFile(path.join(packageDirectory, "media-manifest.json"), mediaManifest);
  hashes.set("media-manifest.json", mediaFile.hash);

  const files = [...hashes.entries()].map(([relativePath, hash]) => ({ path: relativePath, sha256: hash }));
  const missingLayers = rawSnapshot ? [] : ["raw-snapshot"];
  const meta = {
    schemaVersion: evidencePackageSchemaVersion,
    evidence: {
      id: evidenceId,
      subjectType: "signal",
      signalId: signal.id,
      packageKey,
      packagePath: relativePackagePath,
      status: "candidate",
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp
    },
    provenance: {
      sourceId: signal.sourceId || "",
      sourceName: source?.name || source?.account || "",
      sourceUrl: publicPageUrl(source?.url || signal.url || ""),
      sourceProfileUrl,
      authorId,
      platform: signal.platform || "other",
      collectionMethod: source?.collectionMethod || "manual",
      dataBoundary: source?.dataBoundary || "unknown",
      captureState,
      collectionRunId: collectionRun?.id || signal.collectionRunId || "",
      collectionRunStatus: collectionRun?.status || "",
      rawSnapshotIds: rawSnapshots.map((snapshot) => snapshot.id)
    },
    candidate: {
      title: signal.title || "",
      url: publicPageUrl(signal.url),
      author: signal.author || "",
      authorId,
      publishedAt: signal.publishedAt || "",
      capturedAt: signal.capturedAt || "",
      engagement: signal.engagement ?? null,
      relativeMultiple: signal.relativeMultiple ?? null,
      dataPointCandidates: Array.isArray(signal.dataPointCandidates) ? signal.dataPointCandidates : [],
      commentScope: comments.scope
    },
    verification,
    coverage: sourceCoverage(source, rawSnapshot, collectionRun),
    transcript: {
      ...transcript,
      segmentCount: transcriptSegments.length,
      artifactPath: signal.transcriptArtifactPath || ""
    },
    chapters,
    comments: {
      evidenceState: comments.evidenceState,
      scope: comments.scope,
      samples: comments.samples,
      samplesTruncated: comments.samplesTruncated,
      totalSamplesAvailable: comments.totalSamplesAvailable
    },
    capture: {
      state: captureState,
      pageAccess,
      extraction
    },
    media: {
      status: mediaManifest.status,
      count: media.length,
      downloadPolicy: "manifest-only; download later with idempotent checksums",
      urlPolicy: mediaManifest.urlPolicy
    },
    files,
    missingLayers,
    boundaries: {
      localOnly: true,
      gitIgnored: true,
      aiOutputsAreCandidates: true
    }
  };
  const metaFile = await writeJsonFile(path.join(packageDirectory, "meta.json"), meta);
  const manifestLines = [
    `${metaFile.hash}  meta.json`,
    ...files.map((file) => `${file.sha256}  ${file.path}`)
  ].sort((left, right) => left.slice(65).localeCompare(right.slice(65)));
  await writeFileAtomic(path.join(packageDirectory, "checksums.sha256"), `${manifestLines.join("\n")}\n`);

  const record = {
    schemaVersion: evidencePackageSchemaVersion,
    id: evidenceId,
    subjectType: "signal",
    signalId: signal.id,
    sourceId: signal.sourceId || "",
    collectionRunId: collectionRun?.id || signal.collectionRunId || "",
    rawSnapshotId: rawSnapshot?.id || "",
    authorId,
    sourceProfileUrl,
    captureState,
    packageKey,
    packagePath: relativePackagePath,
    packageDirectory,
    status: "candidate",
    verification,
    transcript: {
      evidenceState: transcript.evidenceState,
      source: transcript.source,
      sourceType: transcript.sourceType,
      model: transcript.model,
      capturedAt: transcript.capturedAt,
      reviewRequired: transcript.reviewRequired
    },
    chapterCount: chapters.length,
    commentScope: comments.scope,
    layers: [
      "meta",
      "raw-signal",
      "candidate",
      "media-manifest",
      ...(hasTranscript ? ["candidate-transcript"] : []),
      ...(rawSnapshot ? ["raw-snapshot"] : [])
    ],
    missingLayers,
    mediaCount: media.length,
    metaSha256: metaFile.hash,
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp
  };

  if (existing) {
    const index = packages.indexOf(existing);
    packages[index] = record;
  } else {
    packages.unshift(record);
  }
  state.evidencePackages = packages;
  return { created: !existing, record, packageDirectory };
}

export async function verifyEvidencePackage(state, evidenceId, patch = {}, evidenceRoot) {
  const packages = Array.isArray(state.evidencePackages) ? state.evidencePackages : [];
  const record = packages.find((item) => item.id === evidenceId);
  if (!record) throw new Error("evidence package not found");
  const nextState = String(patch.state || "");
  if (!["unverified", "verified", "rejected"].includes(nextState)) {
    throw new Error("verification state must be unverified, verified, or rejected");
  }
  if (nextState === "verified" && !String(patch.note || "").trim()) {
    throw new Error("verified evidence needs a human review note");
  }
  record.verification = {
    state: nextState,
    checkedAt: new Date().toISOString(),
    checkedBy: String(patch.checkedBy || "local-user"),
    note: String(patch.note || "").trim().slice(0, 2000)
  };
  record.updatedAt = new Date().toISOString();
  if (evidenceRoot) {
    const packageDirectory = path.resolve(evidenceRoot, record.packageKey);
    const contained = path.relative(path.resolve(evidenceRoot), packageDirectory);
    if (!contained || path.isAbsolute(contained) || contained.startsWith("..")) {
      throw new Error("evidence package path escapes evidence root");
    }
    const metaPath = path.join(packageDirectory, "meta.json");
    const meta = JSON.parse(await fs.readFile(metaPath, "utf8"));
    meta.evidence.updatedAt = record.updatedAt;
    meta.verification = record.verification;
    const metaFile = await writeJsonFile(metaPath, meta);
    record.metaSha256 = metaFile.hash;
    const manifestLines = [
      `${metaFile.hash}  meta.json`,
      ...meta.files.map((file) => `${file.sha256}  ${file.path}`)
    ];
    await writeFileAtomic(path.join(packageDirectory, "checksums.sha256"), `${manifestLines.join("\n")}\n`);
  }
  return record;
}
