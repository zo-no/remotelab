function cloneJson(value) {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim()
    ? value
    : undefined;
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

function truthyBoolean(value) {
  return value === true ? true : undefined;
}

function sessionBaseShape(session) {
  if (!session || typeof session !== 'object') return null;
  return {
    id: session.id,
    folder: nonEmptyString(session.folder),
    tool: nonEmptyString(session.tool),
    name: nonEmptyString(session.name),
    appId: nonEmptyString(session.appId),
    appName: nonEmptyString(session.appName),
    templateAppId: nonEmptyString(session.templateAppId),
    sourceId: nonEmptyString(session.sourceId),
    sourceName: nonEmptyString(session.sourceName),
    userId: nonEmptyString(session.userId),
    visitorId: nonEmptyString(session.visitorId),
    visitorName: nonEmptyString(session.visitorName),
    group: nonEmptyString(session.group),
    description: nonEmptyString(session.description),
    workflowState: nonEmptyString(session.workflowState),
    workflowPriority: nonEmptyString(session.workflowPriority),
    created: nonEmptyString(session.created),
    updatedAt: nonEmptyString(session.updatedAt),
    lastEventAt: nonEmptyString(session.lastEventAt),
    archivedAt: nonEmptyString(session.archivedAt),
    latestSeq: positiveInteger(session.latestSeq),
    messageCount: positiveInteger(session.messageCount),
    activeMessageCount: positiveInteger(session.activeMessageCount),
    pinned: truthyBoolean(session.pinned),
    archived: truthyBoolean(session.archived),
    activity: session.activity && typeof session.activity === 'object'
      ? cloneJson(session.activity)
      : undefined,
  };
}

export function createSessionListItem(session) {
  return sessionBaseShape(session);
}

export function createSessionDetail(session) {
  const base = sessionBaseShape(session);
  if (!base) return null;
  return {
    ...base,
    model: nonEmptyString(session.model),
    effort: nonEmptyString(session.effort),
    thinking: session.thinking === true ? true : undefined,
    queuedMessages: Array.isArray(session.queuedMessages) && session.queuedMessages.length > 0
      ? cloneJson(session.queuedMessages)
      : undefined,
  };
}
