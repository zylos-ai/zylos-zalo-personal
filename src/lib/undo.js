function stringValue(value) {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text ? text : null;
}

function firstString(...values) {
  for (const value of values) {
    const text = stringValue(value);
    if (text) return text;
  }
  return null;
}

export function getUndoContent(undo) {
  const content = undo?.data?.content;
  return content && typeof content === 'object' ? content : {};
}

export function getUndoActorId(undo) {
  const content = getUndoContent(undo);
  return firstString(content.srcId, undo?.data?.uidFrom);
}

export function getUndoThreadId(undo) {
  const content = getUndoContent(undo);
  return firstString(undo?.threadId, content.destId, undo?.data?.idTo);
}

export function getUndoDeletedMessageId(undo) {
  const content = getUndoContent(undo);
  return firstString(content.globalMsgId, content.cliMsgId, undo?.data?.msgId, undo?.data?.cliMsgId);
}

export function getUndoCacheKeys(undo) {
  const content = getUndoContent(undo);
  return [
    content.globalMsgId,
    content.cliMsgId,
    content.deleteMsg,
    undo?.data?.msgId,
    undo?.data?.cliMsgId
  ].map(stringValue).filter(Boolean);
}

export function buildUndoAwarenessText({ isGroup, threadName } = {}) {
  if (isGroup && threadName) return `[recalled a message in ${threadName}]`;
  return '[recalled a message]';
}
