#!/usr/bin/env node
/**
 * zylos-zalo-personal — Zalo personal account channel for Zylos Agent
 *
 * Uses zca-js to automate a personal Zalo account via reverse-engineered
 * Zalo Web protocol. Supports DMs, groups, files, reactions, typing.
 *
 * WARNING: Unofficial API — risk of account ban and API breakage.
 */

import { execFile } from 'child_process';
import http from 'http';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import dns from 'dns/promises';
import { Zalo, LoginQRCallbackEventType, ThreadType, Reactions } from 'zca-js';

import { loadConfig, saveConfig, DATA_DIR } from './lib/config.js';
import {
  hasOwner, bindOwner, isOwner, isDmAllowed,
  isGroupAllowed, isGroupSenderAllowed, getGroupConfig, getGroupMode, registerGroup
} from './lib/auth.js';
import {
  logAndRecord, ensureReplay, getHistory, formatMessage
} from './lib/context.js';
import {
  isPrivateIp, isAllowedDownloadHost, isIpLikeHostname, validateUrlSyntax
} from './lib/url-validator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const C4_RECEIVE = path.join(process.env.HOME, 'zylos/.claude/skills/comm-bridge/scripts/c4-receive.js');
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');
const MEDIA_DIR = path.join(DATA_DIR, 'media');
const CREDENTIALS_PATH = path.join(SESSIONS_DIR, 'credentials.json');

fs.mkdirSync(SESSIONS_DIR, { recursive: true, mode: 0o700 });
fs.mkdirSync(MEDIA_DIR, { recursive: true, mode: 0o700 });

let config = loadConfig();

function repairPermissions() {
  const configPath = path.join(DATA_DIR, 'config.json');
  try { fs.chmodSync(DATA_DIR, 0o700); } catch {}
  try { if (fs.existsSync(configPath)) fs.chmodSync(configPath, 0o600); } catch {}
  for (const sub of ['logs', 'media', 'typing', 'sessions']) {
    try { fs.chmodSync(path.join(DATA_DIR, sub), 0o700); } catch {}
  }
  try { if (fs.existsSync(CREDENTIALS_PATH)) fs.chmodSync(CREDENTIALS_PATH, 0o600); } catch {}
  const logsDir = path.join(DATA_DIR, 'logs');
  try {
    for (const f of fs.readdirSync(logsDir)) {
      if (f.endsWith('.jsonl')) {
        try { fs.chmodSync(path.join(logsDir, f), 0o600); } catch {}
      }
    }
  } catch {}
}
repairPermissions();

let api = null;
let ownId = null;
let stopped = false;
let wsHealthy = false;
let disconnectedSince = null;

const MENTION_WINDOW_MS = 30000;
const recentMentions = new Map();
const pendingThinking = new Map();
const PENDING_THINKING_TTL_MS = 5 * 60 * 1000;

function clearPendingThinking(correlationId) {
  const pending = pendingThinking.get(correlationId);
  if (pending && api) {
    api.addReaction(Reactions.NONE, {
      data: { msgId: pending.msgId, cliMsgId: pending.cliMsgId },
      threadId: pending.threadId,
      type: pending.threadType
    }).catch(() => {});
  }
  pendingThinking.delete(correlationId);
}

// ============================================================
// C4 bridge
// ============================================================

function parseC4Response(stdout) {
  if (!stdout) return null;
  try { return JSON.parse(stdout.trim()); } catch { return null; }
}

function execC4(source, endpoint, content, callback) {
  const args = [C4_RECEIVE, '--channel', source, '--endpoint', endpoint, '--json', '--content', content];
  execFile('node', args, { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 }, callback);
}

function sendToC4(source, endpoint, content, onReject, onFinalFailure) {
  if (!content) return;

  execC4(source, endpoint, content, (error, stdout) => {
    if (!error) {
      console.log(`[zalo-personal] Sent to C4: ${content.length > 60 ? content.substring(0, 60) + '...' : content}`);
      return;
    }
    const response = parseC4Response(stdout);
    if (response && response.ok === false && response.error?.message) {
      console.warn(`[zalo-personal] C4 rejected: ${response.error.message}`);
      if (onReject) onReject(response.error.message);
      return;
    }
    console.warn(`[zalo-personal] C4 send failed, retrying in 2s: ${error.message}`);
    setTimeout(() => {
      execC4(source, endpoint, content, (retryError, retryStdout) => {
        if (!retryError) return;
        const r = parseC4Response(retryStdout);
        if (r?.ok === false && r.error?.message && onReject) {
          onReject(r.error.message);
        } else if (onFinalFailure) {
          console.error(`[zalo-personal] C4 delivery failed after retry: ${retryError.message}`);
          onFinalFailure();
        }
      });
    }, 2000);
  });
}

// ============================================================
// Typing indicator
// ============================================================

const TYPING_DIR = path.join(DATA_DIR, 'typing');
fs.mkdirSync(TYPING_DIR, { recursive: true, mode: 0o700 });

const TYPING_TIMEOUT = 120000;
const activeTyping = new Map();

function startTyping(threadId, correlationId, threadType) {
  if (api) {
    api.sendTypingEvent(threadId, threadType).catch(() => {});
  }
  const interval = setInterval(() => {
    if (api) api.sendTypingEvent(threadId, threadType).catch(() => {});
  }, 5000);
  const timeout = setTimeout(() => stopTyping(correlationId), TYPING_TIMEOUT);
  activeTyping.set(correlationId, { interval, timeout, startedAt: Date.now() });
}

function stopTyping(correlationId) {
  const state = activeTyping.get(correlationId);
  if (!state) return;
  clearInterval(state.interval);
  clearTimeout(state.timeout);
  activeTyping.delete(correlationId);
}

function handleTypingDoneFile(filename) {
  if (!filename || !filename.endsWith('.done')) return;
  const correlationId = filename.replace('.done', '');
  const filePath = path.join(TYPING_DIR, filename);
  if (activeTyping.has(correlationId)) stopTyping(correlationId);
  try { fs.unlinkSync(filePath); } catch {}
}

let typingWatcher = null;
try {
  typingWatcher = fs.watch(TYPING_DIR, (eventType, filename) => {
    if (eventType === 'rename' && filename) handleTypingDoneFile(filename);
  });
  typingWatcher.on('error', () => { typingWatcher = null; });
} catch {}

const typingPollInterval = setInterval(() => {
  try {
    for (const f of fs.readdirSync(TYPING_DIR)) handleTypingDoneFile(f);
  } catch {}
  const now = Date.now();
  for (const [id, state] of activeTyping) {
    if (now - state.startedAt > TYPING_TIMEOUT) stopTyping(id);
  }
  for (const [key, ts] of recentMentions) {
    if (now - ts > MENTION_WINDOW_MS) recentMentions.delete(key);
  }
  for (const [id, entry] of pendingThinking) {
    if (entry.createdAt && now - entry.createdAt > PENDING_THINKING_TTL_MS) {
      clearPendingThinking(id);
    }
  }
  const MSG_CACHE_TTL_MS = 10 * 60 * 1000;
  for (const [id, entry] of messageCache) {
    if (entry.cachedAt && now - entry.cachedAt > MSG_CACHE_TTL_MS) messageCache.delete(id);
  }
}, 30000);

// Clean stale markers
try {
  for (const f of fs.readdirSync(TYPING_DIR)) {
    try { fs.unlinkSync(path.join(TYPING_DIR, f)); } catch {}
  }
} catch {}

// ============================================================
// Endpoint builder
// ============================================================

function safeId(str) {
  return String(str).replace(/[^a-zA-Z0-9_:-]/g, '_').substring(0, 200);
}

function buildEndpoint(threadId, { messageId, threadType } = {}) {
  let endpoint = String(threadId);
  const typeStr = threadType === ThreadType.Group ? 'group' : 'dm';
  if (messageId) {
    const correlationId = safeId(`${threadId}:${messageId}`);
    endpoint += `|msg:${safeId(messageId)}|req:${correlationId}|type:${typeStr}`;
  }
  return endpoint;
}

// ============================================================
// User info cache + message cache (for quote-reply)
// ============================================================

const userNameCache = new Map();
const messageCache = new Map();

function cacheMessage(msgId, data) {
  messageCache.set(String(msgId), {
    msgId: data.msgId,
    cliMsgId: data.cliMsgId,
    uidFrom: data.uidFrom,
    msgType: data.msgType || 'webchat',
    ts: data.ts,
    content: data.content,
    ttl: data.ttl || 0,
    cachedAt: Date.now()
  });
  if (messageCache.size > 200) {
    const firstKey = messageCache.keys().next().value;
    messageCache.delete(firstKey);
  }
}

async function getUserName(userId) {
  if (userNameCache.has(userId)) return userNameCache.get(userId);
  try {
    const info = await api.getUserInfo(userId);
    if (info) {
      const profile = Object.values(info)[0];
      const name = profile?.zaloName || profile?.displayName || String(userId);
      userNameCache.set(userId, name);
      setTimeout(() => userNameCache.delete(userId), 600000);
      return name;
    }
  } catch {}
  return String(userId);
}

// ============================================================
// Message handlers
// ============================================================

function isBotMentioned(data) {
  if (!ownId) return false;
  const mentions = data.mentions;
  if (!mentions || !Array.isArray(mentions)) return false;
  return mentions.some(m => String(m.uid) === String(ownId) || m.type === 1);
}

function stripBotMention(text, data) {
  if (!ownId || !text || !data.mentions || !Array.isArray(data.mentions)) return text;
  const botMentions = data.mentions
    .filter(m => String(m.uid) === String(ownId) && typeof m.pos === 'number' && typeof m.len === 'number')
    .sort((a, b) => b.pos - a.pos);
  let result = text;
  for (const m of botMentions) {
    result = result.slice(0, m.pos) + result.slice(m.pos + m.len);
  }
  return result.replace(/^\s+/, '').replace(/\s{2,}/g, ' ');
}

async function parseContent(content, { shouldDownload }) {
  let text = '';
  let mediaPath = null;
  let mediaMetadata = null;

  if (typeof content === 'string') {
    text = content;
  } else if (content && typeof content === 'object') {
    if (content.params?.photoId || content.thumbUrl || content.hdUrl) {
      const imgUrl = content.hdUrl || content.normalUrl || content.thumbUrl || content.href;
      if (!shouldDownload) {
        text = content.desc || content.description || content.title || '[sent an image]';
        mediaMetadata = imgUrl ? `[image, url: ${imgUrl}]` : '[image]';
      } else if (imgUrl) {
        const buf = await downloadUrl(imgUrl);
        if (buf) {
          const ext = imgUrl.includes('.png') ? 'png' : 'jpg';
          const imgPath = path.join(MEDIA_DIR, `img_${Date.now()}.${ext}`);
          const tmpImg = `${imgPath}.tmp`;
          fs.writeFileSync(tmpImg, buf, { mode: 0o600 });
          fs.renameSync(tmpImg, imgPath);
          mediaPath = imgPath;
          text = content.desc || content.description || content.title || '[sent an image]';
        } else {
          text = '[sent an image — download failed]';
        }
      } else {
        text = '[sent an image]';
      }
    } else if (content.href) {
      const isZaloCdn = /\.(dlfl\.vn|zadn\.vn|zdn\.vn|zaloapp\.com)\//i.test(content.href);
      const isImageUrl = /\.(jpg|jpeg|png|gif|webp|bmp)(\?|$)/i.test(content.href) ||
                         /photo[-.].*\.(zdn\.vn|zadn\.vn)/i.test(content.href);
      const isDownloadable = isZaloCdn || (content.action === 'oa.open.inapp' && content.title);
      const isImage = isImageUrl;
      const fileName = isImage
        ? null
        : (content.title || (() => { try { return path.basename(new URL(content.href).pathname); } catch { return null; } })() || `file_${Date.now()}`);

      if (!isDownloadable) {
        text = `[sent a link: ${content.href}]`;
      } else if (!shouldDownload) {
        text = isImage
          ? (content.desc || content.description || content.title || '[sent an image]')
          : `[sent a file: ${fileName}]`;
        mediaMetadata = isImage ? `[image, url: ${content.href}]` : `[file: ${fileName}]`;
      } else {
        const ext = isImage ? (content.href.match(/\.(jpg|jpeg|png|gif|webp|bmp)/i)?.[1] || 'jpg') : null;
        const dlName = isImage ? `img_${Date.now()}.${ext}` : fileName;
        const safeName = dlName.replace(/[^a-zA-Z0-9._-]/g, '_');
        const filePath = path.join(MEDIA_DIR, safeName);
        const buf = await downloadUrl(content.href);
        if (buf) {
          const tmpFile = `${filePath}.tmp`;
          fs.writeFileSync(tmpFile, buf, { mode: 0o600 });
          fs.renameSync(tmpFile, filePath);
          mediaPath = filePath;
          text = isImage ? (content.desc || content.description || content.title || '[sent an image]') : `[sent a file: ${content.title || dlName}]`;
        } else {
          text = isImage ? '[sent an image — download failed]' : `[sent a file: ${dlName} — download failed]`;
        }
      }
    } else if (content.id != null && content.type != null && content.catId != null) {
      text = `[sent a sticker]`;
    } else if (content.title) {
      text = `[attachment: ${content.title}]`;
    } else {
      text = JSON.stringify(content);
    }
  }

  if (!text && !mediaPath && !mediaMetadata) {
    text = '[unsupported message type]';
  }

  return { text, mediaPath, mediaMetadata };
}

const DOWNLOAD_TIMEOUT_MS = 30000;

async function validateDownloadUrl(url) {
  const check = validateUrlSyntax(url);
  if (!check.valid) return false;
  try {
    const { address } = await dns.lookup(check.hostname);
    if (isPrivateIp(address)) return false;
  } catch { return false; }
  return true;
}

async function downloadUrl(url) {
  if (!(await validateDownloadUrl(url))) {
    console.warn(`[zalo-personal] Download blocked: ${url}`);
    return null;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const maxBytes = (config.features?.max_download_mb || 50) * 1024 * 1024;
    let currentUrl = url;
    let redirects = 0;
    const MAX_REDIRECTS = 5;
    let resp;
    while (redirects <= MAX_REDIRECTS) {
      resp = await fetch(currentUrl, { signal: controller.signal, redirect: 'manual' });
      if ([301, 302, 303, 307, 308].includes(resp.status)) {
        const location = resp.headers.get('location');
        if (!location) return null;
        currentUrl = new URL(location, currentUrl).href;
        if (!(await validateDownloadUrl(currentUrl))) {
          console.warn(`[zalo-personal] Redirect blocked: ${currentUrl}`);
          return null;
        }
        redirects++;
        continue;
      }
      break;
    }
    if (redirects > MAX_REDIRECTS) return null;
    if (!resp.ok) return null;
    const contentType = resp.headers.get('content-type') || '';
    const allowedTypes = ['image/', 'application/octet-stream', 'video/', 'audio/',
      'application/pdf', 'application/zip', 'application/x-zip-compressed',
      'application/msword', 'application/vnd.openxmlformats-officedocument.',
      'text/plain'];
    if (!allowedTypes.some(t => contentType.startsWith(t))) {
      return null;
    }
    const contentLength = parseInt(resp.headers.get('content-length') || '0', 10);
    if (contentLength > maxBytes) return null;
    const chunks = [];
    let received = 0;
    for await (const chunk of resp.body) {
      received += chunk.length;
      if (received > maxBytes) return null;
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function handleMessage(message) {
  if (message.isSelf) return;
  config = loadConfig();

  const data = message.data;
  const threadId = message.threadId;
  const senderId = data.uidFrom;
  const messageId = data.msgId || data.cliMsgId || `${Date.now()}`;
  const isGroup = message.type === ThreadType.Group;
  const threadType = isGroup ? ThreadType.Group : ThreadType.User;

  const userName = data.dName || await getUserName(senderId);
  cacheMessage(messageId, data);

  // Access control
  if (isGroup) {
    if (config.groupPolicy === 'disabled') return;
    if (!isGroupAllowed(config, threadId)) {
      if (isOwner(config, senderId) && isBotMentioned(data)) {
        let groupName = threadId;
        try {
          const info = await api.getGroupInfo([threadId]);
          const gd = info?.gridInfoMap?.[threadId];
          if (gd?.name) groupName = gd.name;
        } catch {}
        if (!registerGroup(config, threadId, { name: groupName })) return;
        config = loadConfig();
      } else {
        return;
      }
    }
    if (!isGroupSenderAllowed(config, threadId, senderId)) return;
  } else {
    if (!hasOwner(config)) {
      if (bindOwner(config, senderId, userName)) {
        await api.sendMessage('You are now the admin of this bot.', threadId, threadType).catch(() => {});
      }
      return;
    }
    if (!isDmAllowed(config, senderId)) {
      await api.sendMessage("Sorry, I'm not available. Please ask my admin for access.", threadId, threadType).catch(() => {});
      return;
    }
  }

  // Determine mention and mode for groups
  const mentioned = isGroup ? isBotMentioned(data) : false;
  const groupMode = isGroup ? getGroupMode(config, threadId) : null;

  // Track @mention timestamps for look-back window (attachments after @mention)
  if (isGroup && mentioned) {
    recentMentions.set(`${threadId}:${senderId}`, Date.now());
  }
  const inMentionWindow = isGroup && !mentioned && groupMode === 'mention'
    && recentMentions.has(`${threadId}:${senderId}`)
    && (Date.now() - recentMentions.get(`${threadId}:${senderId}`)) < MENTION_WINDOW_MS;

  // In mention mode: forward @mentioned messages + messages within look-back window
  // In smart mode: always forward but defer downloads when not @mentioned
  const shouldForward = !isGroup || groupMode === 'smart' || mentioned || inMentionWindow;
  const smartNoMention = isGroup && groupMode === 'smart' && !mentioned;
  const shouldDownload = config.features?.download_media !== false && !smartNoMention;

  let { text, mediaPath, mediaMetadata } = await parseContent(
    data.content,
    { shouldDownload }
  );

  if (mentioned) text = stripBotMention(text, data);

  // Always log for context history
  const logEntry = {
    timestamp: new Date().toISOString(),
    message_id: messageId,
    user_id: senderId,
    user_name: userName,
    text: text.substring(0, 500)
  };

  ensureReplay(threadId, config);
  logAndRecord(threadId, logEntry, config);

  if (!shouldForward) {
    console.log(`[zalo-personal] Group ${threadId} mention-mode: no @mention, logged only`);
    return;
  }

  const endpoint = buildEndpoint(threadId, { messageId, threadType });
  const correlationId = safeId(`${threadId}:${messageId}`);

  if (!smartNoMention) {
    startTyping(threadId, correlationId, threadType);
    if (api && data.msgId) {
      api.addReaction(Reactions.LIKE, {
        data: { msgId: String(data.msgId), cliMsgId: String(data.cliMsgId || data.msgId) },
        threadId,
        type: threadType
      }).then(() => {
        pendingThinking.set(correlationId, {
          msgId: String(data.msgId),
          cliMsgId: String(data.cliMsgId || data.msgId),
          threadId,
          threadType,
          createdAt: Date.now()
        });
      }).catch(() => {});
    }
  }

  // Build C4 message
  let groupName = null;
  let contextMessages = null;

  if (isGroup) {
    const gc = getGroupConfig(config, threadId);
    groupName = gc?.name || threadId;
    contextMessages = getHistory(threadId, messageId, config);
  }

  // In smart mode without @mention, append metadata instead of file path
  let displayText = text;
  if (smartNoMention && mediaMetadata) {
    displayText = text + '\n' + mediaMetadata;
  }

  const msg = formatMessage({
    chatType: isGroup ? 'group' : 'dm',
    groupName,
    userName,
    text: displayText,
    contextMessages: isGroup ? contextMessages : null,
    mediaPath: smartNoMention ? null : mediaPath,
    smartHint: smartNoMention
  });

  sendToC4('zalo-personal', endpoint, msg, async (errMsg) => {
    stopTyping(correlationId);
    clearPendingThinking(correlationId);
    await api.sendMessage(errMsg, threadId, threadType).catch(() => {});
  }, () => {
    stopTyping(correlationId);
    clearPendingThinking(correlationId);
  });
}

// ============================================================
// Reaction handler
// ============================================================

async function handleReaction(reaction) {
  if (reaction.isSelf) return;
  config = loadConfig();

  const data = reaction.data;
  const threadId = reaction.threadId;
  const senderId = data.uidFrom;
  const isGroup = reaction.isGroup;

  if (isGroup) {
    if (!isGroupAllowed(config, threadId)) return;
  } else {
    if (!isDmAllowed(config, senderId)) return;
  }

  const userName = data.dName || await getUserName(senderId);
  const reactionContent = data.content;
  const rIcon = reactionContent?.rIcon || '';
  const isRemoved = rIcon === '' || reactionContent?.rType === -1;

  const text = isRemoved ? '[removed reaction]' : `[reacted ${rIcon}]`;
  const endpoint = buildEndpoint(threadId, {
    messageId: `react:${Date.now()}`,
    threadType: isGroup ? ThreadType.Group : ThreadType.User,
  });

  const msg = formatMessage({
    chatType: isGroup ? 'group' : 'dm',
    groupName: isGroup ? (getGroupConfig(config, threadId)?.name || threadId) : null,
    userName,
    text,
    contextMessages: null,
    mediaPath: null,
  });

  sendToC4('zalo-personal', endpoint, msg);
}

// ============================================================
// Keep-alive
// ============================================================

let keepAliveInterval = null;

function startKeepAlive() {
  keepAliveInterval = setInterval(async () => {
    if (!api || stopped) return;
    try {
      await api.keepAlive();
    } catch (err) {
      console.warn(`[zalo-personal] Keep-alive failed: ${err.message}`);
    }
  }, 60000);
}

// ============================================================
// Authentication
// ============================================================

function saveCredentials(credentials) {
  const tmp = `${CREDENTIALS_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(credentials, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, CREDENTIALS_PATH);
  console.log('[zalo-personal] Credentials saved');
}

function loadCredentials() {
  if (!fs.existsSync(CREDENTIALS_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
  } catch {
    return null;
  }
}

async function authenticate() {
  const zalo = new Zalo({
    selfListen: false,
    checkUpdate: false,
    logging: false
  });

  const saved = loadCredentials();

  if (saved) {
    console.log('[zalo-personal] Attempting login with saved credentials...');
    try {
      api = await zalo.login(saved);
      console.log('[zalo-personal] Logged in with saved credentials');
      return true;
    } catch (err) {
      console.warn(`[zalo-personal] Saved credentials failed: ${err.message}`);
      console.log('[zalo-personal] Falling back to QR login...');
    }
  }

  // QR code login
  console.log('[zalo-personal] Starting QR code login...');
  const qrPath = path.join(SESSIONS_DIR, 'qr.png');

  try {
    api = await zalo.loginQR({ qrPath }, (event) => {
      switch (event.type) {
        case LoginQRCallbackEventType.QRCodeGenerated:
          console.log(`[zalo-personal] QR code saved to: ${qrPath}`);
          console.log(`[zalo-personal] Scan the QR code with your Zalo mobile app`);
          break;
        case LoginQRCallbackEventType.QRCodeExpired:
          console.log('[zalo-personal] QR code expired, retrying...');
          event.actions.retry();
          break;
        case LoginQRCallbackEventType.QRCodeScanned:
          console.log(`[zalo-personal] QR scanned by: ${event.data.display_name}`);
          break;
        case LoginQRCallbackEventType.QRCodeDeclined:
          console.log('[zalo-personal] QR login declined, retrying...');
          event.actions.retry();
          break;
        case LoginQRCallbackEventType.GotLoginInfo:
          console.log('[zalo-personal] Login info received, saving credentials...');
          saveCredentials({
            imei: event.data.imei,
            cookie: event.data.cookie,
            userAgent: event.data.userAgent
          });
          break;
      }
    });

    console.log('[zalo-personal] QR login successful');
    return true;
  } catch (err) {
    console.error(`[zalo-personal] Login failed: ${err.message}`);
    return false;
  }
}

// ============================================================
// Internal HTTP for recording outgoing + session info
// ============================================================

const INTERNAL_PORT = config.internal_port || 3463;

function timingSafeTokenEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}
let internalServer = null;

const INTERNAL_TOKEN_PATH = path.join(SESSIONS_DIR, '.internal-token');

function getOrCreateInternalToken() {
  try {
    if (fs.existsSync(INTERNAL_TOKEN_PATH)) {
      return fs.readFileSync(INTERNAL_TOKEN_PATH, 'utf8').trim();
    }
  } catch {}
  const token = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(INTERNAL_TOKEN_PATH, token, { mode: 0o600 });
  return token;
}

function startInternalServer() {
  const internalToken = getOrCreateInternalToken();

  internalServer = http.createServer((req, res) => {
    if (req.url.startsWith('/internal/')) {
      const token = req.headers['x-internal-token'];
      if (!timingSafeTokenEqual(token, internalToken)) { res.writeHead(403).end('forbidden'); return; }
    }

    if (req.method === 'POST' && req.url === '/internal/record-outgoing') {
      const chunks = [];
      let size = 0;
      req.on('data', chunk => {
        size += chunk.length;
        if (size > 64 * 1024) { res.writeHead(413).end('payload too large'); req.destroy(); return; }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (res.headersSent) return;
        try {
          const { chatId, text } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!chatId || !text) { res.writeHead(400).end('missing fields'); return; }
          logAndRecord(chatId, {
            timestamp: new Date().toISOString(),
            message_id: `bot:${Date.now()}`,
            user_id: 'bot',
            user_name: 'bot',
            text: text.substring(0, 500)
          }, config);
          res.writeHead(200).end('ok');
        } catch { res.writeHead(400).end('bad json'); }
      });
      return;
    }

    if (req.method === 'POST' && req.url === '/internal/send') {
      const chunks = [];
      let size = 0;
      req.on('data', chunk => {
        size += chunk.length;
        if (size > 256 * 1024) { res.writeHead(413).end('payload too large'); req.destroy(); return; }
        chunks.push(chunk);
      });
      req.on('end', async () => {
        if (res.headersSent) return;
        try {
          const { chatId, action } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!chatId || !action) { res.writeHead(400).end('missing fields'); return; }
          if (!api) { res.writeHead(503).end('not connected'); return; }

          const threadType = action.threadType === 'group' ? ThreadType.Group : ThreadType.User;

          if (action.type === 'text') {
            let quoteObj = null;
            if (action.quote) {
              if (typeof action.quote === 'object' && action.quote.msgId) {
                quoteObj = action.quote;
              } else {
                const cached = messageCache.get(String(action.quote));
                if (cached) quoteObj = cached;
              }
            }
            if (quoteObj) {
              try {
                await api.sendMessage({ msg: action.text, quote: quoteObj }, chatId, threadType);
              } catch (quoteErr) {
                console.warn(`[zalo-personal] Quote-reply failed (${quoteErr.message}), falling back to plain text`);
                await api.sendMessage(action.text, chatId, threadType);
              }
            } else {
              await api.sendMessage(action.text, chatId, threadType);
            }
            res.writeHead(200).end(JSON.stringify({ ok: true }));
          } else if (action.type === 'attachment') {
            const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
            const STAGING_DIR = path.join(MEDIA_DIR, 'staging');
            fs.mkdirSync(STAGING_DIR, { recursive: true, mode: 0o700 });
            const resolved = fs.realpathSync(path.resolve(action.filePath));
            const allowed = [MEDIA_DIR, STAGING_DIR].some(d => resolved.startsWith(d + path.sep));
            if (!allowed) {
              res.writeHead(403).end(JSON.stringify({ ok: false, error: 'path not allowed — must be in component media dir' }));
            } else if (!fs.existsSync(resolved)) {
              res.writeHead(404).end(JSON.stringify({ ok: false, error: 'file not found' }));
            } else {
              const stat = fs.statSync(resolved);
              if (!stat.isFile()) {
                res.writeHead(403).end(JSON.stringify({ ok: false, error: 'not a regular file' }));
              } else if (stat.size > MAX_ATTACHMENT_BYTES) {
                res.writeHead(413).end(JSON.stringify({ ok: false, error: `file too large (${(stat.size / 1024 / 1024).toFixed(1)}MB, max 25MB)` }));
              } else {
                await api.sendMessage({ msg: '', attachments: [resolved] }, chatId, threadType);
                res.writeHead(200).end(JSON.stringify({ ok: true }));
              }
            }
          } else if (action.type === 'reaction') {
            const reactionMap = {
              'heart': Reactions.HEART, '❤️': Reactions.HEART, '❤': Reactions.HEART,
              'like': Reactions.LIKE, '👍': Reactions.LIKE,
              'haha': Reactions.HAHA, '😆': Reactions.HAHA,
              'wow': Reactions.WOW, '😮': Reactions.WOW,
              'cry': Reactions.CRY, '😢': Reactions.CRY,
              'angry': Reactions.ANGRY, '😠': Reactions.ANGRY,
            };
            const icon = reactionMap[(action.icon || '').toLowerCase()] || reactionMap[action.icon] || Reactions.HEART;
            await api.addReaction(icon, { data: { msgId: action.msgId, cliMsgId: action.cliMsgId }, threadId: chatId, type: threadType });
            res.writeHead(200).end(JSON.stringify({ ok: true }));
          } else if (action.type === 'seen') {
            await api.sendSeenEvent(action.messages, threadType);
            res.writeHead(200).end(JSON.stringify({ ok: true }));
          } else if (action.type === 'delivered') {
            await api.sendDeliveredEvent(action.isSeen || false, action.messages, threadType);
            res.writeHead(200).end(JSON.stringify({ ok: true }));
          } else if (action.type === 'link') {
            await api.sendLink({ link: action.url, msg: action.title || '' }, chatId, threadType);
            res.writeHead(200).end(JSON.stringify({ ok: true }));
          } else if (action.type === 'voice') {
            await api.sendVoice({ voiceUrl: action.voiceUrl }, chatId, threadType);
            res.writeHead(200).end(JSON.stringify({ ok: true }));
          } else if (action.type === 'fetchAccountInfo') {
            const info = await api.fetchAccountInfo();
            res.writeHead(200).end(JSON.stringify({ ok: true, data: info }));
          } else if (action.type === 'getAllFriends') {
            const friends = await api.getAllFriends();
            res.writeHead(200).end(JSON.stringify({ ok: true, data: friends }));
          } else if (action.type === 'getAllGroups') {
            const groups = await api.getAllGroups();
            res.writeHead(200).end(JSON.stringify({ ok: true, data: groups }));
          } else if (action.type === 'getGroupInfo') {
            const info = await api.getGroupInfo(action.groupIds || [chatId]);
            res.writeHead(200).end(JSON.stringify({ ok: true, data: info }));
          } else if (action.type === 'getGroupMembersInfo') {
            const info = await api.getGroupMembersInfo(action.memberIds);
            res.writeHead(200).end(JSON.stringify({ ok: true, data: info }));
          } else if (action.type === 'sendSticker') {
            await api.sendSticker(
              { id: action.stickerId, cateId: action.cateId, type: action.stickerType || 2 },
              chatId, threadType
            );
            res.writeHead(200).end(JSON.stringify({ ok: true }));
          } else if (action.type === 'searchSticker') {
            const result = await api.searchSticker(action.keyword || 'hello');
            res.writeHead(200).end(JSON.stringify({ ok: true, data: result }));
          } else if (action.type === 'getStickers') {
            const result = await api.getStickers(action.stickerType || 7);
            res.writeHead(200).end(JSON.stringify({ ok: true, data: result }));
          } else {
            res.writeHead(400).end('unknown action type');
          }
        } catch (err) {
          res.writeHead(500).end(JSON.stringify({ ok: false, error: err.message }));
        }
      });
      return;
    }

    if (req.method === 'POST' && req.url === '/internal/clear-thinking') {
      const chunks = [];
      let size = 0;
      req.on('data', chunk => {
        size += chunk.length;
        if (size > 4096) { res.writeHead(413).end('payload too large'); req.destroy(); return; }
        chunks.push(chunk);
      });
      req.on('end', async () => {
        if (res.headersSent) return;
        try {
          const { correlationId } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          clearPendingThinking(correlationId);
          res.writeHead(200).end(JSON.stringify({ ok: true }));
        } catch { res.writeHead(400).end('bad json'); }
      });
      return;
    }

    if (req.method === 'GET' && req.url === '/internal/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
        connected: !!api && wsHealthy,
        wsHealthy,
        disconnectedSince,
        ownId,
        uptime: process.uptime()
      }));
      return;
    }

    if (req.method === 'GET' && req.url === '/internal/qr') {
      const qrPath = path.join(SESSIONS_DIR, 'qr.png');
      if (fs.existsSync(qrPath)) {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        fs.createReadStream(qrPath).pipe(res);
      } else {
        res.writeHead(404).end('no qr');
      }
      return;
    }

    res.writeHead(404).end();
  });

  let portRetries = 0;
  internalServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      portRetries++;
      if (portRetries > 3) {
        console.error(`[zalo-personal] Port ${INTERNAL_PORT} still in use after ${portRetries} attempts, exiting`);
        process.exit(1);
      }
      console.error(`[zalo-personal] Port ${INTERNAL_PORT} in use, retry ${portRetries}/3 in 3s`);
      setTimeout(() => internalServer.listen(INTERNAL_PORT, '127.0.0.1'), 3000);
    }
  });

  internalServer.listen(INTERNAL_PORT, '127.0.0.1', () => {
    console.log(`[zalo-personal] Internal server on 127.0.0.1:${INTERNAL_PORT}`);
  });
}

// ============================================================
// Cleanup: media + log rotation
// ============================================================

const MEDIA_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const LOG_MAX_BYTES = 5 * 1024 * 1024;
const LOGS_DIR = path.join(DATA_DIR, 'logs');

function runCleanup() {
  try {
    const now = Date.now();
    for (const file of fs.readdirSync(MEDIA_DIR)) {
      try {
        const fp = path.join(MEDIA_DIR, file);
        const stat = fs.statSync(fp);
        if (stat.isDirectory()) continue;
        if (now - stat.mtimeMs > MEDIA_MAX_AGE_MS) fs.unlinkSync(fp);
      } catch {}
    }
  } catch {}
  try {
    for (const file of fs.readdirSync(LOGS_DIR)) {
      if (!file.endsWith('.jsonl')) continue;
      try {
        const fp = path.join(LOGS_DIR, file);
        const stat = fs.statSync(fp);
        if (stat.size <= LOG_MAX_BYTES) continue;
        const keepBytes = 1024 * 1024;
        const buf = Buffer.alloc(keepBytes);
        const fd = fs.openSync(fp, 'r');
        fs.readSync(fd, buf, 0, keepBytes, stat.size - keepBytes);
        fs.closeSync(fd);
        let content = buf.toString('utf-8');
        const nl = content.indexOf('\n');
        if (nl >= 0) content = content.substring(nl + 1);
        fs.writeFileSync(fp, content, { mode: 0o600 });
        console.log(`[zalo-personal] Truncated log ${file}: ${(stat.size / 1024).toFixed(0)}KB → ${(content.length / 1024).toFixed(0)}KB`);
      } catch {}
    }
  } catch {}
}

const cleanupInterval = setInterval(runCleanup, 6 * 60 * 60 * 1000);
runCleanup();

// ============================================================
// Main
// ============================================================

async function main() {
  console.log('[zalo-personal] Starting zylos-zalo-personal v0.1.1...');
  console.log(`[zalo-personal] Data directory: ${DATA_DIR}`);

  if (!config.enabled) {
    console.log('[zalo-personal] Component disabled in config, exiting.');
    process.exit(0);
  }

  startInternalServer();

  const loggedIn = await authenticate();
  if (!loggedIn) {
    console.error('[zalo-personal] Authentication failed. Set up credentials and restart.');
    process.exit(1);
  }

  try {
    ownId = api.getOwnId();
    console.log(`[zalo-personal] Logged in as: ${ownId}`);
  } catch {
    console.log('[zalo-personal] Could not get own ID');
  }

  // Set up listener
  api.listener.on('message', (message) => {
    handleMessage(message).catch(err => {
      console.error(`[zalo-personal] Message handler error: ${err.message}`);
    });
  });

  api.listener.on('reaction', (reaction) => {
    handleReaction(reaction).catch(err => {
      console.error(`[zalo-personal] Reaction handler error: ${err.message}`);
    });
  });

  api.listener.on('error', (error) => {
    console.error(`[zalo-personal] Listener error:`, error);
  });

  api.listener.on('connected', () => {
    console.log('[zalo-personal] WebSocket connected');
    wsHealthy = true;
    disconnectedSince = null;
  });

  api.listener.on('closed', (code, reason) => {
    console.log(`[zalo-personal] WebSocket closed: ${code} ${reason}`);
    wsHealthy = false;
    if (!disconnectedSince) disconnectedSince = new Date().toISOString();
    if (!stopped && code !== 1000) {
      console.log('[zalo-personal] Will auto-restart via PM2');
    }
  });

  api.listener.start({ retryOnClose: true });
  console.log('[zalo-personal] Listener started');

  startKeepAlive();
  console.log('[zalo-personal] Keep-alive started');
}

function shutdown() {
  console.log('[zalo-personal] Shutting down...');
  stopped = true;

  clearInterval(typingPollInterval);
  clearInterval(cleanupInterval);
  if (typingWatcher) typingWatcher.close();
  if (keepAliveInterval) clearInterval(keepAliveInterval);

  for (const [, state] of activeTyping) {
    clearInterval(state.interval);
    clearTimeout(state.timeout);
  }
  activeTyping.clear();

  if (api?.listener) api.listener.stop();
  if (internalServer) internalServer.close();

  setTimeout(() => process.exit(0), 1000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch(err => {
  console.error('[zalo-personal] Fatal error:', err);
  process.exit(1);
});
