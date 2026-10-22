import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBackupStore } from "./backup-store.mjs";
import { sanitizeStateBlockedSnapshots } from "./blocked-snapshot-sanitizer.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "data");
const dataFile = process.env.DATA_FILE
  ? path.resolve(process.env.DATA_FILE)
  : path.join(dataDir, "workbench.json");
const backupDir = process.env.BACKUP_DIR
  ? path.resolve(process.env.BACKUP_DIR)
  : process.env.DATA_FILE
    ? null
    : path.join(dataDir, "backups");
const backupRetentionLimit = Math.max(10, Number(process.env.BACKUP_RETENTION || 100));
const dryRun = process.argv.includes("--dry-run");

const emptyState = () => ({
  version: 1,
  settings: {},
  sources: [],
  signals: [],
  materials: [],
  topics: []
});

async function main() {
  const original = JSON.parse(await fs.readFile(dataFile, "utf8"));
  const result = sanitizeStateBlockedSnapshots(original);
  const summary = {
    ok: true,
    dryRun,
    dataFile,
    inspectedSnapshots: result.inspectedSnapshots,
    changedSnapshots: result.changedSnapshots,
    inspectedItems: result.inspectedItems,
    removedFields: result.removedFields,
    discardedItems: result.discardedItems,
    backup: null
  };

  if (result.changedSnapshots === 0 || dryRun) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  if (backupDir) {
    const backupStore = createBackupStore({
      backupDir,
      retentionLimit: backupRetentionLimit,
      emptyState
    });
    summary.backup = await backupStore.createBackup(original, "pre-blocked-snapshot-sanitize");
  }

  await fs.mkdir(path.dirname(dataFile), { recursive: true });
  const temp = `${dataFile}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(result.state, null, 2), "utf8");
  try {
    await fs.rename(temp, dataFile);
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => {});
    throw error;
  }

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
