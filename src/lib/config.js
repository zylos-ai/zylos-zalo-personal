import fs from 'fs';
import path from 'path';

const HOME = process.env.HOME;
export const DATA_DIR = path.join(HOME, 'zylos/components/zalo-personal');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

const DEFAULT_CONFIG = {
  enabled: true,
  dmPolicy: 'owner',
  dmAllowFrom: [],
  groupPolicy: 'allowlist',
  groups: {},
  owner: { user_id: null, name: null, bound_at: null },
  features: {
    download_media: true
  },
  message: {
    context_messages: 5,
    textMode: 'plain'
  },
  internal_port: 3463
};

export function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return { ...DEFAULT_CONFIG };
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return { ...DEFAULT_CONFIG, ...raw };
  } catch (err) {
    console.warn(`[zalo-personal] Config read failed: ${err.message}`);
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config) {
  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    const tmp = `${CONFIG_PATH}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n');
    fs.renameSync(tmp, CONFIG_PATH);
  } catch (err) {
    console.error(`[zalo-personal] Config write failed: ${err.message}`);
  }
}
