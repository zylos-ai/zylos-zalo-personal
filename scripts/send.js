#!/usr/bin/env node
/**
 * C4 send interface for zylos-zalo-personal
 *
 * Usage:
 *   echo "message" | node scripts/send.js <endpoint_id>
 *   echo "[MEDIA:image]/path/to/image.png" | node scripts/send.js <endpoint_id>
 *   echo "[MEDIA:file]/path/to/file.pdf" | node scripts/send.js <endpoint_id>
 *   echo "[SKIP]" | node scripts/send.js <endpoint_id>
 *
 * Reads message from stdin (preferred) or as CLI argument.
 * Uses zca-js API via the running service's internal endpoint.
 *
 * NOTE: Because zca-js requires an active authenticated session, this script
 * communicates with the running service via its internal HTTP API rather than
 * directly calling zca-js.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { loadConfig, DATA_DIR } from '../src/lib/config.js';

const MAX_LENGTH = 2000;

const args = process.argv.slice(2);
if (args.length < 1) {
  console.error('Usage: send.js <endpoint_id> [message]');
  console.error('       echo "message" | send.js <endpoint_id>');
  process.exit(1);
}

const endpointRaw = args[0];
const cliMessage = args.slice(1).join(' ');

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) { resolve(''); return; }
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    setTimeout(() => resolve(data), 5000);
  });
}

function parseEndpoint(raw) {
  const result = { chatId: null, msg: null, req: null, type: 'dm' };
  const parts = raw.split('|');
  result.chatId = parts[0];
  for (const p of parts.slice(1)) {
    const [key, ...rest] = p.split(':');
    result[key] = rest.join(':');
  }
  return result;
}

function stripMarkdown(text) {
  return text
    .replace(/```[\s\S]*?```/g, m => m.slice(3, -3).replace(/^\w*\n/, ''))
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s/gm, '- ')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');
}

function splitMessage(text, maxLen) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) { chunks.push(remaining); break; }
    let breakAt = maxLen;
    const chunk = remaining.substring(0, breakAt);
    const lastParaBreak = chunk.lastIndexOf('\n\n');
    if (lastParaBreak > maxLen * 0.3) {
      breakAt = lastParaBreak + 1;
    } else {
      const lastNewline = chunk.lastIndexOf('\n');
      if (lastNewline > maxLen * 0.3) breakAt = lastNewline;
      else {
        const lastSpace = chunk.lastIndexOf(' ');
        if (lastSpace > maxLen * 0.3) breakAt = lastSpace;
      }
    }
    const part = remaining.substring(0, breakAt).trim();
    remaining = remaining.substring(breakAt).trim();
    if (part.length > 0) chunks.push(part);
  }
  return chunks;
}

function markTypingDone(correlationId) {
  if (!correlationId) return;
  try {
    const typingDir = path.join(DATA_DIR, 'typing');
    fs.mkdirSync(typingDir, { recursive: true });
    fs.writeFileSync(path.join(typingDir, `${correlationId}.done`), String(Date.now()));
  } catch {}
}

const config = loadConfig();
const internalPort = config.internal_port || 3463;
const internalToken = crypto.createHash('sha256')
  .update(String(config.ownId || 'zalo-personal'))
  .digest('hex');

async function recordOutgoing(chatId, text) {
  try {
    const body = JSON.stringify({ chatId, text: text.substring(0, 500) });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    await fetch(`http://127.0.0.1:${internalPort}/internal/record-outgoing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Token': internalToken },
      body,
      signal: controller.signal
    });
    clearTimeout(timer);
  } catch {}
}

async function sendViaService(chatId, action) {
  const body = JSON.stringify({ chatId, action });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  const resp = await fetch(`http://127.0.0.1:${internalPort}/internal/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Token': internalToken },
    body,
    signal: controller.signal
  });
  clearTimeout(timer);
  if (!resp.ok) throw new Error(`Service returned ${resp.status}`);
  return resp.json();
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  const stdinData = await readStdin();
  const message = stdinData.trim() || cliMessage;

  if (!message) {
    console.error('Error: no message provided');
    process.exit(1);
  }

  const parsed = parseEndpoint(endpointRaw);
  const chatId = parsed.chatId;
  const correlationId = parsed.req || null;
  const threadType = parsed.type === 'group' ? 'group' : 'dm';

  if (!chatId) {
    console.error('Error: invalid endpoint (missing chatId)');
    process.exit(1);
  }

  try {
    if (message.trim() === '[SKIP]') {
      markTypingDone(correlationId);
      console.log('Skipped (smart mode)');
      return;
    }

    if (message.startsWith('[MEDIA:image]') || message.startsWith('[MEDIA:file]')) {
      const isImage = message.startsWith('[MEDIA:image]');
      const prefix = isImage ? '[MEDIA:image]' : '[MEDIA:file]';
      const filePath = message.substring(prefix.length);
      if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);

      await sendViaService(chatId, {
        type: 'attachment',
        filePath,
        threadType
      });

      markTypingDone(correlationId);
      await recordOutgoing(chatId, isImage ? '[sent a photo]' : `[sent a file: ${path.basename(filePath)}]`);
      console.log(`${isImage ? 'Photo' : 'File'} sent successfully`);
      return;
    }

    // Text message
    const cleaned = stripMarkdown(message);
    const chunks = splitMessage(cleaned, MAX_LENGTH);

    for (let i = 0; i < chunks.length; i++) {
      await sendViaService(chatId, {
        type: 'text',
        text: chunks[i],
        threadType,
        quote: (i === 0) ? parsed.msg : null
      });
      console.log(`Sent chunk ${i + 1}/${chunks.length}`);
      if (i < chunks.length - 1) await sleep(500);
    }

    markTypingDone(correlationId);
    await recordOutgoing(chatId, message);
    console.log('Message sent successfully');
  } catch (err) {
    markTypingDone(correlationId);
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
