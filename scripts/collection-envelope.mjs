const allowedStatuses = new Set(["running", "pending", "ok", "ok-no-new", "blocked", "failed"]);

function count(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

function text(value) {
  return String(value || "").trim();
}

function runCoverage(run) {
  if (run?.coverage && typeof run.coverage === "object") return run.coverage;
  if (!run?.profileNoteCount) return null;
  return {
    totalNotes: count(run.profileNoteCount),
    collectedCount: count(run.collectedCount),
    lastLoadedCount: count(run.loadedCount),
    status: text(run.coverageStatus) || "unknown",
    percent: run.coveragePercent === null || run.coveragePercent === undefined ? null : count(run.coveragePercent)
  };
}

export function collectionEnvelopeFromRun(run) {
  const status = allowedStatuses.has(run?.status) ? run.status : "running";
  const cursor = text(run?.cursor) || null;
  const error = text(run?.error || run?.failureReason) || null;
  return {
    found: count(run?.found),
    created: count(run?.created),
    duplicates: count(run?.duplicates),
    blocked: status === "blocked" ? 1 : 0,
    failed: status === "failed" ? 1 : 0,
    coverage: runCoverage(run),
    nextAction: text(run?.nextAction),
    cursor,
    error
  };
}

export function finalizeCollectionRun(run) {
  const envelope = collectionEnvelopeFromRun(run);
  run.found = envelope.found;
  run.created = envelope.created;
  run.duplicates = envelope.duplicates;
  run.blocked = envelope.blocked;
  run.failed = envelope.failed;
  run.cursor = envelope.cursor;
  run.error = envelope.error;
  run.envelope = envelope;
  return run;
}

export function aggregateCollectionEnvelopes(runs = []) {
  const envelopes = runs.map((run) => collectionEnvelopeFromRun(run));
  const firstError = envelopes.find((envelope) => envelope.error)?.error || null;
  const firstNextAction = envelopes.find((envelope) => envelope.nextAction)?.nextAction || "";
  return {
    found: envelopes.reduce((total, envelope) => total + envelope.found, 0),
    created: envelopes.reduce((total, envelope) => total + envelope.created, 0),
    duplicates: envelopes.reduce((total, envelope) => total + envelope.duplicates, 0),
    blocked: envelopes.reduce((total, envelope) => total + envelope.blocked, 0),
    failed: envelopes.reduce((total, envelope) => total + envelope.failed, 0),
    coverage: null,
    nextAction: firstNextAction,
    cursor: null,
    error: firstError
  };
}
