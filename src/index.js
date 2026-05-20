#!/usr/bin/env node
/**
 * zylos-zalo-personal — Zalo personal account channel for Zylos Agent
 *
 * Uses zca-js to automate a personal Zalo account via reverse-engineered
 * Zalo Web protocol. Supports DMs, groups, files, reactions, typing.
 *
 * WARNING: Unofficial API — risk of account ban and API breakage.
 */

import { exec } from 'child_process';
import http from 'http';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { Zalo, LoginQRCallbackEventType, ThreadType } from 'zca-js';

import { loadConfig, saveConfig, DATA_DIR } from './lib/config.js';
import {
  hasOwner, bindOwner, isOwner, isDmAllowed,
  isGroupAllowed, isGroupSenderAllowed, getGroupConfig
} from './lib/auth.js';
import {
  logAndRecord, ensureReplay, getHistory, formatMessage
} from './lib/context.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const C4_RECEIVE = path.join(process.env.HOME, 'zylos/.claude/skills/comm-bridge/scripts/c4-receive.js');
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');
const MEDIA_DIR = path.join(DATA_DIR, 'media');
const CREDENTIALS_PATH = path.join(SESSIONS_DIR, 'credentials.json');

fs.mkdirSync(SESSIONS_DIR, { recursive: true });
fs.mkdirSync(MEDIA_DIR, { recursive: true });

let config = loadConfig();
let api = null;
let ownId = null;
let stopped = false;

// ============================================================
// C4 bridge
// ============================================================

function parseC4Response(stdout) {
  if (!stdout) return null;
  try { return JSON.parse(stdout.trim()); } catch { return null; }
}

function sendToC4(source, endpoint, content, onReject) {
  if (!content) return;
  const safeContent = content.replace(/'/g, "'\\''");
  const cmd = `node "${C4_RECEIVE}" --channel "${source}" --endpoint "${endpoint}" --json --content '${safeContent}'`;

  exec(cmd, { encoding: 'utf8', timeout: 30000 }, (error, stdout) => {
    if (!error) {
      console.log(`[zalo-personal] Sent to C4: ${content.substring(0, 60)}...`);
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
      exec(cmd, { encoding: 'utf8', timeout: 30000 }, (retryError, retryStdout) => {
        if (!retryError) return;
        const r = parseC4Response(retryStdout);
        if (r?.ok === false && r.error?.message && onReject) onReject(r.error.message);
      });
    }, 2000);
  });
}

// ============================================================
// Typing indicator
// ============================================================

const TYPING_DIR = path.join(DATA_DIR, 'typing');
fs.mkdirSync(TYPING_DIR, { recursive: true });

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

function buildEndpoint(threadId, { messageId, threadType } = {}) {
  let endpoint = String(threadId);
  const typeStr = threadType === ThreadType.Group ? 'group' : 'dm';
  if (messageId) {
    const correlationId = `${threadId}:${messageId}`;
    endpoint += `|msg:${messageId}|req:${correlationId}|type:${typeStr}`;
  }
  return endpoint;
}

// ============================================================
// User info cache
// ============================================================

const userNameCache = new Map();

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

  // Access control
  if (isGroup) {
    if (!isGroupAllowed(config, threadId)) return;
    if (!isGroupSenderAllowed(config, threadId, senderId)) return;
  } else {
    if (!hasOwner(config)) {
      bindOwner(config, senderId, userName);
      await api.sendMessage('You are now the admin of this bot.', threadId, threadType).catch(() => {});
      return;
    }
    if (!isDmAllowed(config, senderId)) {
      await api.sendMessage("Sorry, I'm not available. Please ask my admin for access.", threadId, threadType).catch(() => {});
      return;
    }
  }

  // Parse content
  let text = '';
  let mediaPath = null;
  const content = data.content;

  if (typeof content === 'string') {
    text = content;
  } else if (content && typeof content === 'object') {
    if (content.href) {
      text = `[sent a link: ${content.href}]`;
    } else if (content.title) {
      text = `[attachment: ${content.title}]`;
    } else {
      text = JSON.stringify(content);
    }
  }

  if (!text && !mediaPath) {
    text = '[unsupported message type]';
  }

  // Log entry
  const logEntry = {
    timestamp: new Date().toISOString(),
    message_id: messageId,
    user_id: senderId,
    user_name: userName,
    text: text.substring(0, 500)
  };

  ensureReplay(threadId, config);
  logAndRecord(threadId, logEntry, config);

  const endpoint = buildEndpoint(threadId, { messageId, threadType });
  const correlationId = `${threadId}:${messageId}`;
  startTyping(threadId, correlationId, threadType);

  // Build C4 message
  let groupName = null;
  let contextMessages = null;

  if (isGroup) {
    const gc = getGroupConfig(config, threadId);
    groupName = gc?.name || threadId;
    contextMessages = getHistory(threadId, messageId, config);
  }

  const msg = formatMessage({
    chatType: isGroup ? 'group' : 'dm',
    groupName,
    userName,
    text,
    contextMessages: isGroup ? contextMessages : null,
    mediaPath
  });

  sendToC4('zalo-personal', endpoint, msg, async (errMsg) => {
    stopTyping(correlationId);
    await api.sendMessage(errMsg, threadId, threadType).catch(() => {});
  });
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
  fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(credentials, null, 2));
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
let internalServer = null;

function startInternalServer() {
  const internalToken = crypto.createHash('sha256')
    .update(String(ownId || 'zalo-personal'))
    .digest('hex');

  internalServer = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/internal/record-outgoing') {
      const token = req.headers['x-internal-token'];
      if (token !== internalToken) { res.writeHead(403).end('forbidden'); return; }

      const chunks = [];
      let size = 0;
      req.on('data', chunk => {
        size += chunk.length;
        if (size > 64 * 1024) { req.destroy(); return; }
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
      const token = req.headers['x-internal-token'];
      if (token !== internalToken) { res.writeHead(403).end('forbidden'); return; }

      const chunks = [];
      let size = 0;
      req.on('data', chunk => {
        size += chunk.length;
        if (size > 256 * 1024) { req.destroy(); return; }
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
            const content = action.quote
              ? { msg: action.text, quote: undefined }
              : action.text;
            await api.sendMessage(content, chatId, threadType);
            res.writeHead(200).end(JSON.stringify({ ok: true }));
          } else if (action.type === 'attachment') {
            await api.uploadAttachment(action.filePath, chatId, threadType);
            res.writeHead(200).end(JSON.stringify({ ok: true }));
          } else {
            res.writeHead(400).end('unknown action type');
          }
        } catch (err) {
          res.writeHead(500).end(JSON.stringify({ ok: false, error: err.message }));
        }
      });
      return;
    }

    if (req.method === 'GET' && req.url === '/internal/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
        connected: !!api,
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

  internalServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[zalo-personal] Port ${INTERNAL_PORT} in use, retrying in 3s`);
      setTimeout(() => internalServer.listen(INTERNAL_PORT, '127.0.0.1'), 3000);
    }
  });

  internalServer.listen(INTERNAL_PORT, '127.0.0.1', () => {
    console.log(`[zalo-personal] Internal server on 127.0.0.1:${INTERNAL_PORT}`);
  });
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.log('[zalo-personal] Starting zylos-zalo-personal v0.1.0...');
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

  api.listener.on('error', (error) => {
    console.error(`[zalo-personal] Listener error:`, error);
  });

  api.listener.on('connected', () => {
    console.log('[zalo-personal] WebSocket connected');
  });

  api.listener.on('closed', (code, reason) => {
    console.log(`[zalo-personal] WebSocket closed: ${code} ${reason}`);
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
