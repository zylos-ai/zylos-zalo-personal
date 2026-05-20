#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const HOME = process.env.HOME;
const DATA_DIR = path.join(HOME, 'zylos/components/zalo-personal');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

const DEFAULT_CONFIG = {
  enabled: true,
  dmPolicy: 'owner',
  dmAllowFrom: [],
  groupPolicy: 'allowlist',
  groups: {},
  internal_port: 3463
};

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
    config = { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
  }

  for (const [name, value] of Object.entries(collected)) {
    if (value === undefined || value === null || value === '') continue;
    const key = name.replace(/^ZALO_PERSONAL_/, '').toLowerCase();
    config[key] = value;
  }

  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  const tmp = `${CONFIG_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n');
  fs.renameSync(tmp, CONFIG_PATH);
  console.log(`[configure] Wrote config to ${CONFIG_PATH}`);
} catch (err) {
  console.error(`[configure] ${err.message}`);
  process.exit(1);
}
