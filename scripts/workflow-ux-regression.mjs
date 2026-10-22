import crypto from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chromePath =
  process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const checks = [];
let tempRoot = "";
let workbenchProcess = null;
let browser = null;

function pass(name) {
  checks.push(name);
  console.log(`ok - ${name}`);
}

function equal(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function truthy(value, label) {
  if (!value) throw new Error(`${label}: expected truthy, received ${JSON.stringify(value)}`);
}

async function getPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function startWorkbench(paths) {
  const child = spawn(process.execPath, [path.join(repoRoot, "scripts", "server.mjs")], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PORT: String(paths.port),
      DATA_FILE: paths.dataFile,
      BACKUP_DIR: paths.backupDir,
      DROP_DIR: paths.dropDir,
      BRIDGE_ROOT: paths.bridgeRoot,
      EVIDENCE_DIR: paths.evidenceDir,
      TRANSCRIPT_DIR: paths.transcriptDir,
      CONTENT_FLOW_WORKBENCH_RUNTIME_FILE: paths.runtimeLocator,
      AUTOMATION_ENABLED: "false",
      DROP_SCAN_MS: "60000",
      AUTOMATION_TICK_MS: "60000"
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  let output = "";
  const append = (chunk) => {
    output += chunk.toString("utf8");
    if (output.length > 200000) output = output.slice(-200000);
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  child.getOutput = () => output;
  return child;
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5000))
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function request(base, route, { method = "POST", body = null } = {}) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: method === "GET" ? undefined : { "content-type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(body || {})
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  if (!response.ok) {
    throw new Error(`${route} failed with HTTP ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function waitForServer(base) {
  let lastError = "";
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (workbenchProcess?.exitCode !== null) {
      throw new Error(`temporary workbench exited before readiness:\n${workbenchProcess.getOutput()}`);
    }
    try {
      await request(base, "/api/state", { method: "GET" });
      return;
    } catch (error) {
      lastError = error.message;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`temporary workbench did not start: ${lastError}\n${workbenchProcess?.getOutput() || ""}`);
}

function bindDiagnostics(page, pageErrors, consoleErrors) {
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
}

async function assertNoHorizontalOverflow(page, label) {
  const metrics = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth
  }));
  truthy(
    metrics.document <= metrics.viewport + 1,
    `${label} horizontal overflow: ${JSON.stringify(metrics)}`
  );
}

async function main() {
  await fs.access(chromePath);
  await fs.access(path.join(repoRoot, "app", "dist", "index.html"));

  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "content-flow-workflow-ux-"));
  const port = await getPort();
  const base = `http://127.0.0.1:${port}`;
  const paths = {
    port,
    dataFile: path.join(tempRoot, "workbench.json"),
    backupDir: path.join(tempRoot, "backups"),
    dropDir: path.join(tempRoot, "drops"),
    bridgeRoot: path.join(tempRoot, "bridge"),
    evidenceDir: path.join(tempRoot, "evidence"),
    transcriptDir: path.join(tempRoot, "transcripts"),
    runtimeLocator: path.join(tempRoot, "runtime-locator.json")
  };

  workbenchProcess = startWorkbench(paths);
  await waitForServer(base);

  const token = crypto.randomUUID().slice(0, 8);
  const sourceId = `ux-source-${token}`;
  const signalId = `ux-signal-${token}`;
  const sourceName = `UX source ${token}`;
  const signalTitle = `UX signal ${token}`;
  const updatedTitle = `UX topic ${token}`;
  const coreIdea = `Core idea ${token}`;
  const targetReader = `Target reader ${token}`;
  const minimalPublishableVersion = `Minimal version ${token}`;
  const imported = await request(base, "/api/import", {
    body: {
      sources: [{
        id: sourceId,
        name: sourceName,
        platform: "xiaohongshu",
        url: `https://www.xiaohongshu.com/user/profile/${token}`
      }],
      signals: [{
        id: signalId,
        sourceId,
        platform: "xiaohongshu",
        url: `https://www.xiaohongshu.com/explore/${token}`,
        title: signalTitle,
        excerpt: `Workflow UX regression ${token}`,
        disposition: "inbox",
        seen: false,
        capturedAt: new Date().toISOString(),
        transcriptStatus: "missing"
      }]
    }
  });
  equal(imported.totals.sources.added, 1, "temporary source inserted once");
  equal(imported.totals.signals.added, 1, "temporary signal inserted once");
  pass("Temporary source and inbox signal imported through /api/import");

  browser = await chromium.launch({
    executablePath: chromePath,
    headless: process.env.HEADED !== "1",
    args: ["--disable-features=Translate", "--no-first-run", "--disable-sync"]
  });

  const pageErrors = [];
  const consoleErrors = [];
  const desktop = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: "zh-CN",
    colorScheme: "light"
  });
  await desktop.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("cfw.theme", "light");
  });
  const page = await desktop.newPage();
  bindDiagnostics(page, pageErrors, consoleErrors);
  await page.goto(`${base}/flow`);
  await page.getByRole("navigation", { name: "主导航" }).waitFor();

  const signalRow = page.locator(`[data-signal-id="${signalId}"]`);
  await signalRow.waitFor();
  const createTopicResponse = page.waitForResponse(
    (response) => response.url().endsWith("/api/record") && response.request().method() === "POST"
  );
  await signalRow.getByRole("button", { name: "开选题", exact: true }).click();
  const createTopicPayload = await (await createTopicResponse).json();
  const topicId = createTopicPayload.record?.id;
  truthy(topicId, "create-topic response contains a record id");
  equal(createTopicPayload.record.title, signalTitle, "created topic title");
  await page.waitForURL(/\/workflow$/);
  await page.waitForFunction(
    (id) => localStorage.getItem("cfw.topic") === id,
    topicId
  );
  await page.getByRole("heading", { name: signalTitle, exact: true }).waitFor();
  pass("Opening a topic selects it, persists cfw.topic, and routes directly to /workflow");

  await page.getByRole("button", { name: "编辑信息", exact: true }).click();
  const topicDialog = page.getByRole("dialog", { name: "编辑选题信息" });
  await topicDialog.waitFor();
  await topicDialog.getByLabel("选题标题").fill(`  ${updatedTitle}  `);
  await topicDialog.getByLabel("核心观点").fill(`  ${coreIdea}  `);
  await topicDialog.getByLabel("目标读者").fill(`  ${targetReader}  `);
  await topicDialog.getByLabel("最小可发布版本").fill(`  ${minimalPublishableVersion}  `);
  const updateResponse = page.waitForResponse(
    (response) => response.url().endsWith("/api/update") && response.request().method() === "POST"
  );
  await topicDialog.getByRole("button", { name: "保存", exact: true }).click();
  const updatePayload = await (await updateResponse).json();
  equal(updatePayload.ok, true, "topic update response");
  await topicDialog.waitFor({ state: "detached" });
  await page.getByRole("heading", { name: updatedTitle, exact: true }).waitFor();

  const afterEdit = await request(base, "/api/state", { method: "GET" });
  const editedTopic = afterEdit.topics.find((topic) => topic.id === topicId);
  truthy(editedTopic, "edited topic remains present");
  equal(editedTopic.title, updatedTitle, "topic title is trimmed");
  equal(editedTopic.coreIdea, coreIdea, "topic core idea is trimmed");
  equal(editedTopic.targetReader, targetReader, "topic target reader is trimmed");
  equal(
    editedTopic.minimalPublishableVersion,
    minimalPublishableVersion,
    "topic minimal publishable version is trimmed"
  );
  pass("Current-topic card edits all four fields and persists trimmed values");

  const scriptRecord = await request(base, "/api/record", {
    body: {
      type: "scripts",
      record: {
        topicId,
        tool: "口播稿",
        versionNote: "E2E",
        text: `Workflow record fallback ${token}`
      }
    }
  });
  equal(scriptRecord.added, 1, "script inserted once");
  truthy(scriptRecord.record?.id, "/api/record returns a new record without identity keys");
  equal(scriptRecord.record.topicId, topicId, "returned script belongs to the edited topic");
  pass("/api/record returns newly created records that have no identity key");

  await page.goto(`${base}/flow`);
  await page.getByRole("navigation", { name: "主导航" }).waitFor();
  await page.getByRole("button", { name: /做选题/ }).click();
  await signalRow.waitFor();
  const evidenceResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/evidence-packages/create") &&
      response.request().method() === "POST"
  );
  await signalRow.getByRole("button", { name: "建证据包", exact: true }).click();
  const evidencePayload = await (await evidenceResponse).json();
  truthy(evidencePayload.record?.id, "evidence response contains a record");
  const verifyDialog = page.getByRole("dialog", { name: "核对证据包" });
  await verifyDialog.waitFor();
  const afterEvidence = await request(base, "/api/state", { method: "GET" });
  truthy(
    afterEvidence.evidencePackages.some(
      (item) => item.id === evidencePayload.record.id && item.signalId === signalId
    ),
    "created evidence package is persisted for the signal"
  );
  pass("Creating an evidence package opens the verification sheet automatically");

  equal(pageErrors.length, 0, `desktop page errors: ${JSON.stringify(pageErrors)}`);
  equal(consoleErrors.length, 0, `desktop console errors: ${JSON.stringify(consoleErrors)}`);
  await desktop.close();

  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: "zh-CN",
    colorScheme: "light",
    isMobile: true,
    hasTouch: true
  });
  await mobile.addInitScript((id) => {
    localStorage.setItem("cfw.theme", "light");
    localStorage.setItem("cfw.topic", id);
  }, topicId);
  const mobilePage = await mobile.newPage();
  const mobilePageErrors = [];
  const mobileConsoleErrors = [];
  bindDiagnostics(mobilePage, mobilePageErrors, mobileConsoleErrors);
  await mobilePage.goto(`${base}/workflow`);
  await mobilePage.getByRole("heading", { name: updatedTitle, exact: true }).waitFor();
  await assertNoHorizontalOverflow(mobilePage, "workflow at 390px");
  equal(mobilePageErrors.length, 0, `mobile page errors: ${JSON.stringify(mobilePageErrors)}`);
  equal(mobileConsoleErrors.length, 0, `mobile console errors: ${JSON.stringify(mobileConsoleErrors)}`);
  await mobile.close();
  pass("Workflow main card has no horizontal overflow at 390px");
}

try {
  await main();
  console.log(`\nWorkflow UX E2E passed: ${checks.length}/${checks.length}`);
} catch (error) {
  console.error(`\nWorkflow UX E2E failed: ${error.stack || error.message}`);
  if (workbenchProcess?.getOutput()) {
    console.error("\n--- workbench output ---");
    console.error(workbenchProcess.getOutput().trim());
  }
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  await stopProcess(workbenchProcess);
  if (tempRoot) {
    const contained = path.relative(os.tmpdir(), tempRoot);
    if (contained && !contained.startsWith("..") && !path.isAbsolute(contained)) {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  }
}
