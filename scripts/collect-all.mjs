const base = process.env.WORKBENCH_URL || "http://127.0.0.1:5177";

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

const force = process.argv.includes("--force");
const dropFolder = await post("/api/drop-folder/scan", {});
const collection = await post("/api/automation/tick", { force });

console.log(JSON.stringify({ dropFolder, collection }, null, 2));
