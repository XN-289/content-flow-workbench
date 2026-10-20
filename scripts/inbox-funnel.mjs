const actionableDispositions = new Set(["watch", "dissect", "material", "topic", "produce"]);

function latestSignalTime(signals) {
  return signals
    .map((signal) => new Date(signal.capturedAt || signal.publishedAt || 0).getTime() || 0)
    .reduce((latest, time) => Math.max(latest, time), 0);
}

function funnelFor(signals) {
  const counts = signals.reduce((accumulator, signal) => {
    const disposition = String(signal.disposition || "inbox");
    accumulator[disposition] = (accumulator[disposition] || 0) + 1;
    return accumulator;
  }, {});
  const total = signals.length;
  const pending = counts.inbox || 0;
  const decided = total - pending;
  const actionable = signals.filter((signal) => actionableDispositions.has(signal.disposition)).length;
  const discarded = counts.discard || 0;
  return {
    total,
    pending,
    decided,
    actionable,
    discarded,
    counts,
    pushRate: decided ? Math.round((actionable / decided) * 100) : null
  };
}

export function inboxFunnelRuntime(state = {}) {
  const signals = state.signals || [];
  const global = funnelFor(signals);
  const knownSourceIds = new Set((state.sources || []).map((source) => source.id));
  const sourceRecords = (state.sources || []).map((source) => {
    const sourceSignals = signals.filter((signal) => signal.sourceId === source.id);
    return {
      sourceId: source.id,
      name: source.name || source.account || source.url || "未命名来源",
      platform: source.platform || "other",
      ...funnelFor(sourceSignals),
      lastSignalAt: latestSignalTime(sourceSignals)
    };
  });

  const quickSignals = signals.filter((signal) => !signal.sourceId || !knownSourceIds.has(signal.sourceId));
  if (quickSignals.length) {
    sourceRecords.push({
      sourceId: "quick-capture",
      name: "快速收集 / 未关联来源",
      platform: "mixed",
      ...funnelFor(quickSignals),
      lastSignalAt: latestSignalTime(quickSignals)
    });
  }

  sourceRecords.sort((left, right) => (
    right.pending - left.pending
    || right.total - left.total
    || String(left.name).localeCompare(String(right.name), "zh-CN")
  ));

  return {
    ...global,
    unseenCount: signals.filter((signal) => !signal.seen).length,
    sources: sourceRecords
  };
}
