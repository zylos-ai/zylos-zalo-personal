import fs from 'fs';
import path from 'path';
import { DATA_DIR } from './config.js';

const LOGS_DIR = path.join(DATA_DIR, 'logs');
fs.mkdirSync(LOGS_DIR, { recursive: true, mode: 0o700 });

const chatHistories = new Map();
const replayedKeys = new Set();
const MAX_TRACKED_CHATS = 500;

function escapeXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function logFileName(chatId) {
  return `${String(chatId).replace(/[^a-zA-Z0-9_-]/g, '_')}.jsonl`;
}

function getHistoryLimit(chatId, config) {
  const gc = config?.groups?.[String(chatId)];
  return gc?.historyLimit || config?.message?.context_messages || 5;
}

export function recordEntry(chatId, entry, config) {
  chatId = String(chatId);
  if (!chatHistories.has(chatId)) chatHistories.set(chatId, []);
  const history = chatHistories.get(chatId);

  if (entry.message_id && !String(entry.message_id).startsWith('bot:')) {
    if (history.some(m => m.message_id === entry.message_id)) return;
  }

  history.push(entry);
  const limit = getHistoryLimit(chatId, config);
  if (history.length > limit * 2) {
    chatHistories.set(chatId, history.slice(-limit));
  }
  if (chatHistories.size > MAX_TRACKED_CHATS) {
    const firstKey = chatHistories.keys().next().value;
    chatHistories.delete(firstKey);
  }
}

export function logAndRecord(chatId, entry, config) {
  chatId = String(chatId);
  const logFile = path.join(LOGS_DIR, logFileName(chatId));
  try {
    fs.appendFileSync(logFile, JSON.stringify(entry) + '\n', { mode: 0o600 });
  } catch (err) {
    console.error(`[zalo-personal] Log write failed for ${chatId}: ${err.message}`);
  }
  recordEntry(chatId, entry, config);
}

export function ensureReplay(chatId, config) {
  chatId = String(chatId);
  if (replayedKeys.has(chatId)) return;

  const logFile = path.join(LOGS_DIR, logFileName(chatId));
  if (!fs.existsSync(logFile)) {
    replayedKeys.add(chatId);
    if (replayedKeys.size > MAX_TRACKED_CHATS) {
      const first = replayedKeys.values().next().value;
      replayedKeys.delete(first);
    }
    return;
  }

  const limit = getHistoryLimit(chatId, config);
  try {
    const TAIL_BYTES = 64 * 1024;
    const stat = fs.statSync(logFile);
    let content;
    if (stat.size <= TAIL_BYTES) {
      content = fs.readFileSync(logFile, 'utf-8');
    } else {
      const buf = Buffer.alloc(TAIL_BYTES);
      const fd = fs.openSync(logFile, 'r');
      fs.readSync(fd, buf, 0, TAIL_BYTES, stat.size - TAIL_BYTES);
      fs.closeSync(fd);
      content = buf.toString('utf-8');
      const nl = content.indexOf('\n');
      if (nl >= 0) content = content.substring(nl + 1);
    }
    const lines = content.trim().split('\n').filter(l => l);
    const tail = lines.slice(-limit);
    for (const line of tail) {
      try {
        recordEntry(chatId, JSON.parse(line), config);
      } catch {}
    }
    replayedKeys.add(chatId);
    if (replayedKeys.size > MAX_TRACKED_CHATS) {
      const first = replayedKeys.values().next().value;
      replayedKeys.delete(first);
    }
    if (tail.length > 0) {
      console.log(`[zalo-personal] Replayed ${tail.length} log entries for ${chatId}`);
    }
  } catch (err) {
    console.error(`[zalo-personal] Log replay failed for ${chatId}: ${err.message}`);
  }
}

export function getHistory(chatId, excludeMessageId, config) {
  const history = chatHistories.get(String(chatId));
  if (!history || history.length === 0) return [];
  const limit = getHistoryLimit(chatId, config);
  const filtered = excludeMessageId
    ? history.filter(m => m.message_id !== excludeMessageId)
    : history;
  return filtered.slice(-limit);
}

export function formatMessage(opts) {
  const { chatType, groupName, userName, text, contextMessages, mediaPath, smartHint } = opts;

  let prefix;
  if (chatType === 'dm') {
    prefix = '[Zalo DM]';
  } else {
    prefix = `[Zalo GROUP:${escapeXml(groupName || 'group')}]`;
  }

  const parts = [`${prefix} ${escapeXml(userName)} said: `];

  if (smartHint) {
    parts.push(`<smart-mode>
You are observing this group in smart mode. Only respond if the message is directed at you, asks a question you can help with, or you have something genuinely useful to add. Most messages should be silently observed.
</smart-mode>\n\n`);
  }

  if (contextMessages && contextMessages.length > 0) {
    const contextLines = contextMessages.map(m =>
      `[${escapeXml(m.user_name || String(m.user_id))}]: ${escapeXml(m.text)}`
    ).join('\n');
    parts.push(`<group-context>\n${contextLines}\n</group-context>\n\n`);
  }

  parts.push(`<current-message>\n${escapeXml(text)}\n</current-message>`);

  let message = parts.join('');
  if (mediaPath) {
    message += ` ---- file: ${escapeXml(mediaPath)}`;
  }
  return message;
}
