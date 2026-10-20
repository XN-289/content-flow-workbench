import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

function stableJsonValue(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableJsonValue(item)).join(",")}]`;
  if (value && typeof value === "object") {
    const body = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJsonValue(value[key])}`)
      .join(",");
    return `{${body}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function stateHash(state) {
  return crypto.createHash("sha256").update(stableJsonValue(state), "utf8").digest("hex");
}

function backupCounts(state) {
  return {
    sources: (state.sources || []).length,
    signals: (state.signals || []).length,
    materials: (state.materials || []).length,
    topics: (state.topics || []).length,
    scripts: (state.scripts || []).length,
    publications: (state.publications || []).length,
    reviews: (state.reviews || []).length,
    agentTasks: (state.agentTasks || []).length
  };
}

function backupFilename(hash) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
  return `workbench-${stamp}-${hash.slice(0, 8)}.json`;
}

function isBackupFilename(filename) {
  return /^workbench-\d{8}T\d{6}-[a-f0-9]{8}\.json$/.test(filename);
}

export function createBackupStore({ backupDir, retentionLimit, emptyState }) {
  async function readBackupFile(filename) {
    if (!isBackupFilename(filename)) throw new Error("invalid backup filename");
    if (!backupDir) throw new Error("BACKUP_DIR is required when DATA_FILE is overridden");
    const filePath = path.join(backupDir, filename);
    if (path.dirname(filePath) !== backupDir) throw new Error("invalid backup filename");
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
    if (parsed?.kind !== "content-flow-workbench-backup" || parsed?.version !== 1 || !parsed?.state) {
      throw new Error("backup format is invalid");
    }
    validateRestorableState(parsed.state);
    const stat = await fs.stat(filePath);
    return {
      id: filename,
      filename,
      createdAt: parsed.metadata?.createdAt || stat.mtime.toISOString(),
      reason: parsed.metadata?.reason || "unknown",
      hash: String(parsed.metadata?.hash || stateHash(parsed.state)),
      size: stat.size,
      counts: parsed.metadata?.counts || backupCounts(parsed.state),
      state: parsed.state
    };
  }

  async function listBackups() {
    if (!backupDir) return { backups: [], retentionLimit, backupRoot: "" };
    const entries = await fs.readdir(backupDir, { withFileTypes: true }).catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    const backups = [];
    for (const entry of entries) {
      if (!entry.isFile() || !isBackupFilename(entry.name)) continue;
      try {
        const backup = await readBackupFile(entry.name);
        backups.push({ ...backup, state: undefined });
      } catch {
        backups.push({ id: entry.name, filename: entry.name, invalid: true });
      }
    }
    backups.sort((a, b) => String(b.createdAt || b.filename).localeCompare(String(a.createdAt || b.filename)));
    return { backups, retentionLimit, backupRoot: backupDir };
  }

  async function createBackup(state, reason = "manual") {
    if (!backupDir) throw new Error("BACKUP_DIR is required when DATA_FILE is overridden");
    const hash = stateHash(state);
    const existing = await listBackups();
    const duplicate = existing.backups.find((backup) => backup.hash === hash && !backup.invalid);
    if (duplicate) return { ...duplicate, created: false };

    const createdAt = new Date().toISOString();
    const filename = backupFilename(hash);
    const payload = {
      kind: "content-flow-workbench-backup",
      version: 1,
      metadata: { createdAt, reason, hash, counts: backupCounts(state) },
      state
    };
    await fs.mkdir(backupDir, { recursive: true });
    const temp = path.join(backupDir, `.${filename}.${crypto.randomUUID()}.tmp`);
    await fs.writeFile(temp, JSON.stringify(payload, null, 2), "utf8");
    await fs.rename(temp, path.join(backupDir, filename));
    await pruneBackups();
    const stat = await fs.stat(path.join(backupDir, filename));
    return {
      id: filename,
      filename,
      createdAt,
      reason,
      hash,
      size: stat.size,
      counts: payload.metadata.counts,
      created: true
    };
  }

  async function pruneBackups() {
    const entries = await fs.readdir(backupDir, { withFileTypes: true });
    const backups = [];
    for (const entry of entries) {
      if (!entry.isFile() || !isBackupFilename(entry.name)) continue;
      try {
        const backup = await readBackupFile(entry.name);
        backups.push({ filename: entry.name, createdAt: backup.createdAt });
      } catch {
        continue;
      }
    }
    backups.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || a.filename.localeCompare(b.filename));
    for (const backup of backups.slice(0, Math.max(0, backups.length - retentionLimit))) {
      await fs.rm(path.join(backupDir, backup.filename), { force: true });
    }
  }

  function validateRestorableState(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("backup state must be an object");
    if (value.version !== 1) throw new Error("backup state version is not supported");
    if (!value.settings || typeof value.settings !== "object" || Array.isArray(value.settings)) {
      throw new Error("backup settings are invalid");
    }
    const defaults = emptyState();
    for (const [key, defaultValue] of Object.entries(defaults)) {
      if (Array.isArray(defaultValue) && value[key] !== undefined && !Array.isArray(value[key])) {
        throw new Error(`backup ${key} must be an array`);
      }
    }
    for (const key of ["sources", "signals", "materials", "topics"]) {
      if (!Array.isArray(value[key])) throw new Error(`backup ${key} must be an array`);
    }
  }

  return { stableJsonValue, readBackupFile, listBackups, createBackup };
}
