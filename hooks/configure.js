#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { deepMerge, freshDefaults } from '../src/lib/config.js';

const HOME = process.env.HOME;
const DATA_DIR = path.join(HOME, 'zylos/components/zalo-personal');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

const DEFAULT_CONFIG = freshDefaults();

const KEY_MAP = {
  dmpolicy: ['dmPolicy', String],
  dm_policy: ['dmPolicy', String],
  grouppolicy: ['groupPolicy', String],
  group_policy: ['groupPolicy', String],
  internal_port: ['internal_port', Number],
  internalport: ['internal_port', Number],
  voicetranscription: ['voiceTranscription', String],
  voice_transcription: ['voiceTranscription', String],
  whispermodel: ['whisperModel', String],
  whisper_model: ['whisperModel', String],
  download_media: ['features.download_media', Boolean],
  downloadmedia: ['features.download_media', Boolean],
  max_download_mb: ['features.max_download_mb', Number],
  maxdownloadmb: ['features.max_download_mb', Number],
  inbound_rate_limit_window_ms: ['features.inbound_rate_limit.window_ms', Number],
  inboundratelimitwindowms: ['features.inbound_rate_limit.window_ms', Number],
  inbound_rate_limit_max: ['features.inbound_rate_limit.max', Number],
  inboundratelimitmax: ['features.inbound_rate_limit.max', Number],
  session_alert_disconnect_grace_ms: ['features.session_alert.disconnect_grace_ms', Number],
  sessionalertdisconnectgracems: ['features.session_alert.disconnect_grace_ms', Number],
  session_alert_cooldown_ms: ['features.session_alert.cooldown_ms', Number],
  sessionalertcooldownms: ['features.session_alert.cooldown_ms', Number],
  textmode: ['message.textMode', String],
  text_mode: ['message.textMode', String]
};

function normalizeKey(name) {
  return String(name)
    .replace(/^ZALO_PERSONAL_/i, '')
    .toLowerCase();
}

function coerceValue(value, type) {
  if (type === Number) {
    const n = Number(value);
    if (!Number.isFinite(n)) throw new Error(`Invalid numeric config value: ${value}`);
    return n;
  }
  if (type === Boolean) {
    if (typeof value === 'boolean') return value;
    const normalized = String(value).trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
    throw new Error(`Invalid boolean config value: ${value}`);
  }
  return String(value);
}

function setPath(target, dottedPath, value) {
  const parts = dottedPath.split('.');
  let node = target;
  for (const part of parts.slice(0, -1)) {
    if (!node[part] || typeof node[part] !== 'object' || Array.isArray(node[part])) node[part] = {};
    node = node[part];
  }
  node[parts[parts.length - 1]] = value;
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { input += chunk; });
    process.stdin.on('end', () => resolve(input));
    process.stdin.on('error', reject);
  });
}

try {
  const raw = (await readStdin()).trim();
  if (!raw) {
    throw new Error('Expected stdin JSON');
  }

  const collected = JSON.parse(raw);
  let config = DEFAULT_CONFIG;
  if (fs.existsSync(CONFIG_PATH)) {
    config = deepMerge(DEFAULT_CONFIG, JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')));
  }

  for (const [name, value] of Object.entries(collected)) {
    if (value === undefined || value === null || value === '') continue;
    const mapping = KEY_MAP[normalizeKey(name)];
    if (!mapping) {
      console.warn(`[configure] Ignoring unsupported config key: ${name}`);
      continue;
    }
    const [configPath, type] = mapping;
    setPath(config, configPath, coerceValue(value, type));
  }

  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true, mode: 0o700 });
  const tmp = `${CONFIG_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, CONFIG_PATH);
  fs.chmodSync(CONFIG_PATH, 0o600);
  console.log(`[configure] Wrote config to ${CONFIG_PATH}`);
} catch (err) {
  console.error(`[configure] ${err.message}`);
  process.exit(1);
}
