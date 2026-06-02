import fs from 'fs';
import path from 'path';

const HOME = process.env.HOME;
export const DATA_DIR = path.join(HOME, 'zylos/components/zalo-personal');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

export function freshDefaults() {
  return {
    enabled: true,
    dmPolicy: 'owner',
    dmAllowFrom: [],
    groupPolicy: 'allowlist',
    groups: {},
    owner: { user_id: null, name: null, bound_at: null },
    features: {
      download_media: true,
      inbound_rate_limit: {
        window_ms: 60 * 1000,
        max: 60
      },
      session_alert: {
        disconnect_grace_ms: 5 * 60 * 1000,
        cooldown_ms: 30 * 60 * 1000
      }
    },
    message: {
      context_messages: 5,
      textMode: 'markdown'
    },
    voiceTranscription: 'auto',
    whisperModel: '',
    internal_port: 3463
  };
}

export function deepMerge(defaults, overrides) {
  const result = { ...defaults };
  for (const key of Object.keys(overrides)) {
    if (
      overrides[key] && typeof overrides[key] === 'object' && !Array.isArray(overrides[key])
      && defaults[key] && typeof defaults[key] === 'object' && !Array.isArray(defaults[key])
    ) {
      result[key] = deepMerge(defaults[key], overrides[key]);
    } else {
      result[key] = overrides[key];
    }
  }
  return result;
}

let cachedConfig = null;
let cachedMtime = 0;
let lastStatCheckAt = 0;
const CONFIG_STAT_THROTTLE_MS = 1000;

export function loadConfig() {
  try {
    const now = Date.now();
    if (cachedConfig && now - lastStatCheckAt < CONFIG_STAT_THROTTLE_MS) return cachedConfig;
    if (!fs.existsSync(CONFIG_PATH)) return freshDefaults();
    const stat = fs.statSync(CONFIG_PATH);
    lastStatCheckAt = now;
    if (cachedConfig && stat.mtimeMs === cachedMtime) return cachedConfig;
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    cachedConfig = deepMerge(freshDefaults(), raw);
    cachedMtime = stat.mtimeMs;
    return cachedConfig;
  } catch (err) {
    console.warn(`[zalo-personal] Config read failed: ${err.message}`);
    return freshDefaults();
  }
}

export function saveConfig(config) {
  const tmp = `${CONFIG_PATH}.tmp`;
  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true, mode: 0o700 });
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, CONFIG_PATH);
    cachedConfig = null;
    cachedMtime = 0;
    lastStatCheckAt = 0;
    return true;
  } catch (err) {
    console.error(`[zalo-personal] Config write failed: ${err.message}`);
    try { fs.unlinkSync(tmp); } catch {}
    return false;
  }
}
