import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { agentPluginContractVersion } from "./agent-plugin-contract.mjs";

export function defaultRuntimeLocatorFile() {
  return path.join(os.tmpdir(), "content-flow-workbench-runtime.json");
}

export function runtimeLocatorFile() {
  const configured = String(process.env.CONTENT_FLOW_WORKBENCH_RUNTIME_FILE || "").trim();
  return configured ? path.resolve(configured) : defaultRuntimeLocatorFile();
}

export function publishRuntimeLocator({ port, startedAt = new Date().toISOString() } = {}) {
  const numericPort = Number(port);
  if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
    throw new Error("runtime locator requires an active TCP port");
  }
  const target = runtimeLocatorFile();
  const descriptor = {
    name: "content-flow-workbench",
    protocolVersion: agentPluginContractVersion,
    baseUrl: `http://127.0.0.1:${numericPort}`,
    port: numericPort,
    pid: process.pid,
    startedAt
  };
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${crypto.randomUUID().slice(0, 8)}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(descriptor, null, 2), {
    encoding: "utf8",
    mode: 0o600
  });
  fs.renameSync(temporary, target);
  return { path: target, descriptor };
}

export function clearRuntimeLocator() {
  const target = runtimeLocatorFile();
  try {
    const descriptor = JSON.parse(fs.readFileSync(target, "utf8"));
    if (Number(descriptor?.pid) === process.pid) fs.rmSync(target, { force: true });
  } catch {
    // A missing or stale locator is safe to ignore.
  }
}
