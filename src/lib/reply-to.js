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

function contentText(content) {
  if (typeof content === 'string') return content;
  if (!content || typeof content !== 'object') return null;
  return firstString(
    content.msg,
    content.text,
    content.desc,
    content.description,
    content.title
  );
}

export function truncateReplyBody(value, limit = 100) {
  const text = stringValue(value);
  if (!text) return null;
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 3))}...`;
}

export function cacheKeysForMessage(data = {}) {
  return [
    data.globalMsgId,
    data.msgId,
    data.cliMsgId,
  ].map(stringValue).filter(Boolean);
}

export function cacheRecordFromMessage(data = {}) {
  return {
    msgId: data.msgId,
    globalMsgId: data.globalMsgId,
    cliMsgId: data.cliMsgId,
    uidFrom: data.uidFrom,
    msgType: data.msgType || 'webchat',
    ts: data.ts,
    content: data.content,
    ttl: data.ttl || 0,
    cachedAt: Date.now()
  };
}

export function buildReplyTo(data = {}, messageCache) {
  const quote = data.quote;
  if (!quote || typeof quote !== 'object') return null;

  const keys = [
    quote.globalMsgId,
    quote.msgId,
    quote.cliMsgId,
  ].map(stringValue).filter(Boolean);
  const cached = keys.map(key => messageCache?.get(String(key))).find(Boolean) || null;

  const messageId = firstString(
    quote.globalMsgId,
    quote.msgId,
    quote.cliMsgId,
    cached?.globalMsgId,
    cached?.msgId,
    cached?.cliMsgId
  );
  if (!messageId) return null;

  const body = truncateReplyBody(firstString(
    quote.msg,
    quote.text,
    contentText(quote.content),
    contentText(cached?.content)
  ));
  const fromUserId = firstString(
    quote.ownerId,
    quote.fromD,
    quote.uidFrom,
    quote.fromUserId,
    cached?.uidFrom
  );

  return {
    messageId,
    body,
    fromUserId,
  };
}
