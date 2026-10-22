import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const protocolVersion = 3;
const defaultTimeoutMs = 15_000;
const bundledManifestPath = fileURLToPath(new URL("./manifest.json", import.meta.url));
const bundledManifest = JSON.parse(fs.readFileSync(bundledManifestPath, "utf8"));
const bundledMethods = new Map(
  (bundledManifest.methods || []).map((method) => [method.name, method])
);
const loopbackHosts = new Set(["127.0.0.1", "localhost"]);

export class WorkbenchPluginError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "WorkbenchPluginError";
    this.code = options.code || "WORKBENCH_PLUGIN_ERROR";
    this.status = options.status ?? null;
    this.details = options.details ?? null;
  }
}

export function normalizeLoopbackBaseUrl(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new WorkbenchPluginError("Workbench base URL is invalid", {
      code: "INVALID_BASE_URL"
    });
  }
  if (url.protocol !== "http:") {
    throw new WorkbenchPluginError("Workbench base URL must use http", {
      code: "INVALID_BASE_URL"
    });
  }
  if (!loopbackHosts.has(url.hostname)) {
    throw new WorkbenchPluginError("Workbench base URL must use 127.0.0.1 or localhost", {
      code: "NON_LOOPBACK_BASE_URL"
    });
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new WorkbenchPluginError("Workbench base URL cannot contain credentials, query, or hash", {
      code: "INVALID_BASE_URL"
    });
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    throw new WorkbenchPluginError("Workbench base URL cannot contain a path", {
      code: "INVALID_BASE_URL"
    });
  }
  return url.origin;
}

function defaultRuntimeLocatorFile() {
  return path.join(os.tmpdir(), "content-flow-workbench-runtime.json");
}

function assertRelativeApiEndpoint(endpoint) {
  const value = String(endpoint || "");
  if (
    !value.startsWith("/api/")
    || value.startsWith("//")
    || value.includes("..")
    || value.includes("?")
    || value.includes("#")
    || !/^\/api\/[A-Za-z0-9._/-]+$/.test(value)
  ) {
    throw new WorkbenchPluginError("Manifest endpoint must be a relative /api/** path", {
      code: "UNSAFE_MANIFEST_ENDPOINT"
    });
  }
  return value;
}

function validateSchemaValue(value, schema, valuePath = "input") {
  if (!schema || typeof schema !== "object") return;
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    throw new WorkbenchPluginError(`${valuePath} must be one of: ${schema.enum.join(", ")}`, {
      code: "INVALID_INPUT"
    });
  }
  if (schema.type === "string" && typeof value !== "string") {
    throw new WorkbenchPluginError(`${valuePath} must be a string`, { code: "INVALID_INPUT" });
  }
  if (schema.type === "boolean" && typeof value !== "boolean") {
    throw new WorkbenchPluginError(`${valuePath} must be a boolean`, { code: "INVALID_INPUT" });
  }
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new WorkbenchPluginError(`${valuePath} must be an object`, { code: "INVALID_INPUT" });
    }
    for (const required of schema.required || []) {
      if (!Object.prototype.hasOwnProperty.call(value, required)) {
        throw new WorkbenchPluginError(`${valuePath}.${required} is required`, { code: "INVALID_INPUT" });
      }
    }
    const properties = schema.properties || {};
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(properties, key)) {
          throw new WorkbenchPluginError(`${valuePath}.${key} is not allowed`, { code: "INVALID_INPUT" });
        }
      }
    }
    for (const [key, childValue] of Object.entries(value)) {
      if (Object.prototype.hasOwnProperty.call(properties, key)) {
        validateSchemaValue(childValue, properties[key], `${valuePath}.${key}`);
      }
    }
  }
}

function capabilityMap(manifest) {
  const capabilities = Array.isArray(manifest?.capabilities) ? manifest.capabilities : [];
  const result = new Map();
  for (const capability of capabilities) {
    const name = String(capability?.name || "");
    if (!name || result.has(name)) {
      throw new WorkbenchPluginError("Manifest contains a missing or duplicate method name", {
        code: "INVALID_MANIFEST"
      });
    }
    const httpMethod = String(capability.method || "").toUpperCase();
    if (!["GET", "POST"].includes(httpMethod)) {
      throw new WorkbenchPluginError(`Manifest method ${name} has an unsupported HTTP method`, {
        code: "INVALID_MANIFEST"
      });
    }
    result.set(name, {
      name,
      httpMethod,
      endpoint: assertRelativeApiEndpoint(capability.endpoint),
      inputSchema: capability.inputSchema || { type: "object", properties: {}, additionalProperties: false }
    });
  }
  for (const name of bundledMethods.keys()) {
    if (!result.has(name)) {
      throw new WorkbenchPluginError(`Manifest is missing required method ${name}`, {
        code: "INCOMPATIBLE_MANIFEST"
      });
    }
  }
  return result;
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new WorkbenchPluginError("Workbench manifest must be an object", {
      code: "INVALID_MANIFEST"
    });
  }
  if (manifest.name !== bundledManifest.name) {
    throw new WorkbenchPluginError("Workbench manifest has an unexpected name", {
      code: "INVALID_MANIFEST"
    });
  }
  if (Number(manifest.protocolVersion) !== protocolVersion) {
    throw new WorkbenchPluginError(
      `Workbench protocol ${manifest.protocolVersion} is incompatible with client protocol ${protocolVersion}`,
      { code: "INCOMPATIBLE_MANIFEST" }
    );
  }
  if (manifest.runtime?.mode !== "local-http") {
    throw new WorkbenchPluginError("Workbench manifest must use local-http runtime mode", {
      code: "INVALID_MANIFEST"
    });
  }
  const baseUrl = normalizeLoopbackBaseUrl(manifest.runtime?.baseUrl);
  const methods = capabilityMap(manifest);
  return { manifest, baseUrl, methods };
}

function extractErrorMessage(text) {
  try {
    const payload = JSON.parse(text);
    return String(payload?.error || payload?.message || text || "").trim();
  } catch {
    return String(text || "").trim();
  }
}

async function readRuntimeLocator(filePath) {
  try {
    const descriptor = JSON.parse(await fs.promises.readFile(filePath, "utf8"));
    if (
      descriptor?.name !== bundledManifest.name
      || Number(descriptor?.protocolVersion) !== protocolVersion
    ) {
      return "";
    }
    return normalizeLoopbackBaseUrl(descriptor.baseUrl);
  } catch {
    return "";
  }
}

function normalizeMethodInput(input, allowStringField = "") {
  if (typeof input === "string" && allowStringField) return { [allowStringField]: input };
  if (input == null) return {};
  return input;
}

export class ContentFlowWorkbenchClient {
  constructor(options = {}) {
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    if (typeof this.fetchImpl !== "function") {
      throw new WorkbenchPluginError("This plugin requires a fetch implementation", {
        code: "FETCH_UNAVAILABLE"
      });
    }
    this.timeoutMs = Number(options.timeoutMs || defaultTimeoutMs);
    this.runtimeFile = String(
      options.runtimeFile
      || process.env[bundledManifest.runtime.discovery.runtimeFileEnv]
      || defaultRuntimeLocatorFile()
    );
    const explicitBaseUrl = options.baseUrl
      || process.env[bundledManifest.runtime.discovery.baseUrlEnv]
      || "";
    this.forcedBaseUrl = explicitBaseUrl ? normalizeLoopbackBaseUrl(explicitBaseUrl) : "";
    this.baseUrl = this.forcedBaseUrl;
    this._manifest = null;
    this._methods = null;
  }

  async _discoveryCandidates() {
    if (this.forcedBaseUrl) return [this.forcedBaseUrl];
    const candidates = [];
    const locatorBaseUrl = await readRuntimeLocator(this.runtimeFile);
    if (locatorBaseUrl) candidates.push(locatorBaseUrl);
    const defaultPort = Number(bundledManifest.runtime.discovery.defaultPort || 5177);
    candidates.push(`http://127.0.0.1:${defaultPort}`, `http://localhost:${defaultPort}`);
    return [...new Set(candidates)];
  }

  async _request(baseUrl, method, endpoint, body) {
    const safeEndpoint = assertRelativeApiEndpoint(endpoint);
    const base = normalizeLoopbackBaseUrl(baseUrl);
    const url = new URL(safeEndpoint, `${base}/`);
    if (url.origin !== base || url.pathname !== safeEndpoint) {
      throw new WorkbenchPluginError("Resolved request left the selected loopback origin", {
        code: "UNSAFE_REQUEST_ORIGIN"
      });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;
    try {
      response = await this.fetchImpl(url, {
        method,
        redirect: "error",
        headers: {
          accept: "application/json",
          ...(method === "POST" ? { "content-type": "application/json" } : {})
        },
        body: method === "POST" ? JSON.stringify(body || {}) : undefined,
        signal: controller.signal
      });
    } catch (error) {
      throw new WorkbenchPluginError(`Cannot reach local workbench at ${base}`, {
        code: error?.name === "AbortError" ? "WORKBENCH_TIMEOUT" : "WORKBENCH_UNREACHABLE",
        cause: error
      });
    } finally {
      clearTimeout(timer);
    }
    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        if (response.ok) {
          throw new WorkbenchPluginError("Workbench returned a non-JSON response", {
            code: "INVALID_RESPONSE",
            status: response.status,
            details: text.slice(0, 500)
          });
        }
      }
    }
    if (!response.ok) {
      throw new WorkbenchPluginError(
        extractErrorMessage(text) || `Workbench request failed with HTTP ${response.status}`,
        {
          code: "WORKBENCH_REQUEST_FAILED",
          status: response.status,
          details: payload
        }
      );
    }
    return payload;
  }

  async getManifest({ refresh = false } = {}) {
    if (this._manifest && !refresh) return this._manifest;
    const manifestMethod = bundledMethods.get("getManifest");
    const candidates = await this._discoveryCandidates();
    const failures = [];
    for (const candidate of candidates) {
      try {
        const manifest = await this._request(
          candidate,
          manifestMethod.httpMethod,
          manifestMethod.endpoint
        );
        const validated = validateManifest(manifest);
        this.baseUrl = validated.baseUrl;
        this._manifest = validated.manifest;
        this._methods = validated.methods;
        return this._manifest;
      } catch (error) {
        failures.push(error);
      }
    }
    const detail = failures.map((error) => error.message).filter(Boolean).join("; ");
    throw new WorkbenchPluginError(
      detail || "Content Flow Workbench was not found on loopback",
      {
        code: "WORKBENCH_NOT_FOUND",
        details: failures.map((error) => ({ code: error.code, message: error.message }))
      }
    );
  }

  async _ensureConnected() {
    if (this._manifest && this._methods) return;
    await this.getManifest();
  }

  async _invoke(name, input = {}) {
    await this._ensureConnected();
    const capability = this._methods.get(name);
    if (!capability) {
      throw new WorkbenchPluginError(`Unknown workbench method ${name}`, {
        code: "UNKNOWN_METHOD"
      });
    }
    const normalizedInput = input == null ? {} : input;
    validateSchemaValue(normalizedInput, capability.inputSchema);
    return this._request(
      this.baseUrl,
      capability.httpMethod,
      capability.endpoint,
      capability.httpMethod === "POST" ? normalizedInput : undefined
    );
  }

  async getState() {
    return this._invoke("getState");
  }

  async getPlatformCapabilities() {
    return this._invoke("getPlatformCapabilities");
  }

  async intakeSource(input) {
    return this._invoke("intakeSource", normalizeMethodInput(input, "text"));
  }

  async captureXiaohongshuNote(input) {
    return this._invoke(
      "captureXiaohongshuNote",
      normalizeMethodInput(input, "text")
    );
  }

  async captureTranscript(input) {
    const normalized = normalizeMethodInput(input, "signalId");
    return this._invoke("captureTranscript", {
      ...normalized,
      force: normalized.force === true,
      background: normalized.background === true
    });
  }

  async createAnalysis(input) {
    const normalized = normalizeMethodInput(input, "signalId");
    return this._invoke("createAnalysis", {
      ...normalized,
      force: normalized.force === true
    });
  }

  async createAgentTask(input) {
    return this._invoke("createAgentTask", input);
  }

  async exportKnowledge(input = {}) {
    return this._invoke("exportKnowledge", normalizeMethodInput(input, "driveRoot"));
  }

  async runMorningPipeline() {
    return this._invoke("runMorningPipeline", {});
  }
}

export async function connectContentFlowWorkbench(options = {}) {
  const client = new ContentFlowWorkbenchClient(options);
  await client.getManifest();
  return client;
}

export default ContentFlowWorkbenchClient;
