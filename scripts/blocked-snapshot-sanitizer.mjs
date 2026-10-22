export const blockedPreviewFields = Object.freeze([
  "title",
  "engagement",
  "publishedAt",
  "coverUrl",
  "reason"
]);

const allowedBlockedPreviewFields = new Set(blockedPreviewFields);

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function sanitizeBlockedItems(blockedItems) {
  const sanitizedItems = [];
  let removedFields = 0;
  let discardedItems = 0;
  let changed = false;

  for (const item of blockedItems) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      discardedItems += 1;
      changed = true;
      continue;
    }

    const keys = Object.keys(item);
    if (keys.some((key) => !allowedBlockedPreviewFields.has(key))) changed = true;
    removedFields += keys.filter((key) => !allowedBlockedPreviewFields.has(key)).length;

    const preview = {};
    for (const field of blockedPreviewFields) {
      if (Object.hasOwn(item, field)) preview[field] = item[field];
    }
    sanitizedItems.push(preview);
  }

  return { sanitizedItems, removedFields, discardedItems, changed };
}

export function sanitizeStateBlockedSnapshots(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new Error("state must be an object");
  }

  const sanitizedState = cloneJson(state);
  const snapshots = Array.isArray(sanitizedState.rawSnapshots) ? sanitizedState.rawSnapshots : [];
  const result = {
    state: sanitizedState,
    inspectedSnapshots: 0,
    changedSnapshots: 0,
    inspectedItems: 0,
    removedFields: 0,
    discardedItems: 0
  };

  for (const snapshot of snapshots) {
    if (!snapshot || typeof snapshot !== "object" || typeof snapshot.content !== "string") continue;

    let content;
    try {
      content = JSON.parse(snapshot.content);
    } catch {
      continue;
    }
    if (!content || typeof content !== "object" || !Array.isArray(content.blockedItems)) continue;

    result.inspectedSnapshots += 1;
    result.inspectedItems += content.blockedItems.length;
    const sanitized = sanitizeBlockedItems(content.blockedItems);
    if (!sanitized.changed) continue;

    snapshot.content = JSON.stringify({
      ...content,
      blockedItems: sanitized.sanitizedItems
    }, null, 2);
    result.changedSnapshots += 1;
    result.removedFields += sanitized.removedFields;
    result.discardedItems += sanitized.discardedItems;
  }

  return result;
}
