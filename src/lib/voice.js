const URL_KEYS = ['href', 'voiceUrl', 'm4aUrl', 'url'];
const NESTED_KEYS = ['params', 'msgInfo'];

function parseJsonString(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed || !/^[{[]/.test(trimmed)) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function isHttpUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim());
}

function asObject(value) {
  const parsed = parseJsonString(value);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
}

function extractFromObject(value, depth = 0) {
  if (depth > 4) return null;
  const object = asObject(value);
  if (!object) return null;

  for (const key of URL_KEYS) {
    if (isHttpUrl(object[key])) return object[key].trim();
  }

  for (const key of NESTED_KEYS) {
    const found = extractFromObject(object[key], depth + 1);
    if (found) return found;
  }

  return null;
}

export function extractVoiceUrl(content) {
  try {
    return extractFromObject(content);
  } catch {
    return null;
  }
}

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function summarizeObject(value, depth = 0) {
  const object = asObject(value);
  if (!object) return typeOf(parseJsonString(value));
  const keys = Object.keys(object).slice(0, 12);
  if (depth >= 2) return `object(${keys.join(',')})`;
  const nested = keys
    .filter(key => NESTED_KEYS.includes(key))
    .map(key => `${key}:${summarizeObject(object[key], depth + 1)}`);
  return nested.length > 0
    ? `object(${keys.join(',')}; ${nested.join('; ')})`
    : `object(${keys.join(',')})`;
}

export function summarizeVoiceContentShape(content) {
  try {
    if (typeof content === 'string') {
      const parsed = parseJsonString(content);
      if (parsed !== content) return `json-string:${summarizeObject(parsed)}`;
      return `string(length=${content.length})`;
    }
    return summarizeObject(content);
  } catch {
    return 'unknown';
  }
}

export function isVoiceMessageData(data) {
  return data?.msgType === 'chat.voice';
}
