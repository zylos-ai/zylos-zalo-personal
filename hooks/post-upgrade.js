#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const HOME = process.env.HOME;
const DATA_DIR = path.join(HOME, 'zylos/components/zalo-personal');

console.log('[post-upgrade] Repairing permissions...');

try { fs.chmodSync(DATA_DIR, 0o700); } catch {}
const configPath = path.join(DATA_DIR, 'config.json');
try { if (fs.existsSync(configPath)) fs.chmodSync(configPath, 0o600); } catch {}

for (const sub of ['logs', 'media', 'typing', 'sessions']) {
  const dir = path.join(DATA_DIR, sub);
  try { if (fs.existsSync(dir)) fs.chmodSync(dir, 0o700); } catch {}
}

const credPath = path.join(DATA_DIR, 'sessions', 'credentials.json');
try { if (fs.existsSync(credPath)) fs.chmodSync(credPath, 0o600); } catch {}

const logsDir = path.join(DATA_DIR, 'logs');
try {
  for (const f of fs.readdirSync(logsDir)) {
    if (f.endsWith('.jsonl')) {
      try { fs.chmodSync(path.join(logsDir, f), 0o600); } catch {}
    }
  }
} catch {}

console.log('[post-upgrade] Permissions repaired.');
