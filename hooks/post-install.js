#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const HOME = process.env.HOME;
const DATA_DIR = path.join(HOME, 'zylos/components/zalo-personal');

console.log('[post-install] Running zalo-personal setup...\n');

fs.mkdirSync(path.join(DATA_DIR, 'logs'), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'media'), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'typing'), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'sessions'), { recursive: true });
console.log('  - logs/\n  - media/\n  - typing/\n  - sessions/');

const configPath = path.join(DATA_DIR, 'config.json');
if (!fs.existsSync(configPath)) {
  console.log('\nCreating default config.json...');
  fs.writeFileSync(configPath, JSON.stringify({ enabled: true }, null, 2));
  console.log('  - config.json created');
} else {
  console.log('\nConfig already exists, skipping.');
}

console.log('\n[post-install] Complete!');
