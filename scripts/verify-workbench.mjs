import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");

const steps = [
  {
    name: "build syntax",
    command: process.execPath,
    args: ["--check", "scripts/build-ui.mjs"],
  },
  {
    name: "server syntax",
    command: process.execPath,
    args: ["--check", "scripts/server.mjs"],
  },
  {
    name: "plugin syntax",
    command: process.execPath,
    args: ["--check", "plugin/content-flow-workbench/client.mjs"],
  },
  {
    name: "platform media syntax",
    command: process.execPath,
    args: ["--check", "scripts/platform-media.mjs"],
  },
  {
    name: "main chain",
    command: process.execPath,
    args: ["scripts/chain-regression.mjs"],
  },
  {
    name: "backend pipeline",
    command: process.execPath,
    args: ["scripts/backend-pipeline-regression.mjs"],
  },
  {
    name: "source intake",
    command: process.execPath,
    args: ["scripts/source-intake-regression.mjs"],
  },
  {
    name: "account watch",
    command: process.execPath,
    args: ["scripts/account-watch-regression.mjs"],
  },
  {
    name: "batch intake",
    command: process.execPath,
    args: ["scripts/batch-intake-regression.mjs"],
  },
  {
    name: "platform media",
    command: process.execPath,
    args: ["scripts/platform-media-regression.mjs"],
  },
  {
    name: "Bilibili public transcript",
    command: process.execPath,
    args: ["scripts/bilibili-public-regression.mjs"],
  },
  {
    name: "agent plugin",
    command: process.execPath,
    args: ["scripts/plugin-regression.mjs"],
  },
  {
    name: "TypeScript",
    command: process.execPath,
    args: [
      "web/node_modules/typescript/bin/tsc",
      "--noEmit",
      "-p",
      "web/tsconfig.json",
    ],
  },
  {
    name: "git diff check",
    command: "git",
    args: ["diff", "--check"],
  },
  {
    name: "UI build",
    command: process.execPath,
    args: ["scripts/build-ui.mjs"],
  },
];

const failures = [];

for (const [index, step] of steps.entries()) {
  const label = `[${index + 1}/${steps.length}] ${step.name}`;
  process.stdout.write(`${label} ... `);
  const result = spawnSync(step.command, step.args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      AUTOMATION_ENABLED: "false",
    },
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });

  if (result.error || result.status !== 0) {
    process.stdout.write("FAIL\n");
    failures.push({
      label,
      error: result.error?.stack || result.error?.message || "",
      stdout: result.stdout?.trimEnd() || "",
      stderr: result.stderr?.trimEnd() || "",
    });
    continue;
  }

  process.stdout.write("PASS\n");
}

const distIndex = path.join(repoRoot, "app", "dist", "index.html");
if (!fs.existsSync(distIndex)) {
  failures.push({
    label: "UI artifact",
    stdout: "",
    stderr: `Missing built artifact: ${distIndex}`,
  });
}

if (failures.length === 0) {
  process.stdout.write(`\nWorkbench verification passed (${steps.length} checks).\n`);
} else {
  for (const failure of failures) {
    process.stderr.write(`\nFAIL ${failure.label}\n`);
    if (failure.error) process.stderr.write(`${failure.error}\n`);
    if (failure.stdout) process.stderr.write(`${failure.stdout}\n`);
    if (failure.stderr) process.stderr.write(`${failure.stderr}\n`);
  }
  process.stderr.write(`\nWorkbench verification failed with ${failures.length} issue(s).\n`);
  process.exitCode = 1;
}
