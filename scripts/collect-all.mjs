const base = process.env.WORKBENCH_URL || "http://127.0.0.1:5177";

async function get(path) {
  const response = await fetch(`${base}${path}`);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `GET ${path}: HTTP ${response.status}`);
  return payload;
}

async function post(path, body) {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json();
  if (!response.ok || payload.ok === false) throw new Error(payload.error || `POST ${path}: HTTP ${response.status}`);
  return payload;
}

const state = await get("/api/state");
const targets = state.sources.filter((source) => source.checkFrequency !== "on-demand" && source.collectionMethod !== "research-only");
const results = [];

for (const source of targets) {
  const result = await post("/api/collect", { sourceId: source.id });
  results.push({
    source: source.name || source.account || source.id,
    status: result.run.status,
    found: result.run.found,
    created: result.run.created,
    failureReason: result.run.failureReason,
    nextAction: result.run.nextAction
  });
}

console.log(JSON.stringify({
  ranAt: new Date().toISOString(),
  total: results.length,
  ok: results.filter((item) => item.status.startsWith("ok")).length,
  blocked: results.filter((item) => item.status === "blocked").length,
  failed: results.filter((item) => item.status === "failed").length,
  results
}, null, 2));
