import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

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
  return (Array.isArray(signal.imageDescriptions) ? signal.imageDescriptions : [])
    .filter((item) => item && typeof item === "object" && item.url)
    .map((item) => ({
      type: "image",
      url: String(item.url),
      description: String(item.description || ""),
      status: "not-downloaded",
      filePath: "",
      downloadedAt: "",
      checksum: ""
    }));
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
  const rawSnapshots = (state.rawSnapshots || [])
    .filter((snapshot) => (
      snapshot.runId === signal.collectionRunId
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
    schemaVersion: 1,
    layer: "raw-signal",
    capturedFrom: "workbench structured signal",
    signal
  };
  const signalFile = await writeJsonFile(path.join(packageDirectory, "raw", "signal.json"), signalEvidence);
  hashes.set("raw/signal.json", signalFile.hash);

  if (rawSnapshot) {
    const snapshotFile = await writeJsonFile(path.join(packageDirectory, "raw", "snapshot.json"), {
      schemaVersion: 1,
      layer: "raw-snapshot",
      snapshot: rawSnapshot
    });
    hashes.set("raw/snapshot.json", snapshotFile.hash);
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
    `- Source URL: ${signal.url || "missing"}`,
    `- Captured at: ${signal.capturedAt || "unknown"}`,
    `- Verification: ${verification.state}`,
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
    schemaVersion: 1,
    evidenceId,
    status: media.length ? "not-downloaded" : "empty",
    items: media
  };
  const mediaFile = await writeJsonFile(path.join(packageDirectory, "media-manifest.json"), mediaManifest);
  hashes.set("media-manifest.json", mediaFile.hash);

  const files = [...hashes.entries()].map(([relativePath, hash]) => ({ path: relativePath, sha256: hash }));
  const missingLayers = rawSnapshot ? [] : ["raw-snapshot"];
  const meta = {
    schemaVersion: 1,
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
      sourceUrl: source?.url || signal.url || "",
      platform: signal.platform || "other",
      collectionMethod: source?.collectionMethod || "manual",
      dataBoundary: source?.dataBoundary || "unknown",
      collectionRunId: collectionRun?.id || signal.collectionRunId || "",
      collectionRunStatus: collectionRun?.status || "",
      rawSnapshotIds: rawSnapshots.map((snapshot) => snapshot.id)
    },
    candidate: {
      title: signal.title || "",
      url: signal.url || "",
      author: signal.author || "",
      publishedAt: signal.publishedAt || "",
      capturedAt: signal.capturedAt || "",
      engagement: signal.engagement ?? null,
      relativeMultiple: signal.relativeMultiple ?? null,
      dataPointCandidates: Array.isArray(signal.dataPointCandidates) ? signal.dataPointCandidates : []
    },
    verification,
    coverage: sourceCoverage(source, rawSnapshot, collectionRun),
    media: {
      status: mediaManifest.status,
      count: media.length,
      downloadPolicy: "manifest-only; download later with idempotent checksums"
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
    id: evidenceId,
    subjectType: "signal",
    signalId: signal.id,
    sourceId: signal.sourceId || "",
    collectionRunId: collectionRun?.id || signal.collectionRunId || "",
    rawSnapshotId: rawSnapshot?.id || "",
    packageKey,
    packagePath: relativePackagePath,
    packageDirectory,
    status: "candidate",
    verification,
    layers: ["meta", "raw-signal", "candidate", "media-manifest", ...(rawSnapshot ? ["raw-snapshot"] : [])],
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
