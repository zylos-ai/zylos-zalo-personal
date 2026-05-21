import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';

let tmpDir;
let origHome;

function setupTmpHome() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zalo-cfg-'));
  origHome = process.env.HOME;
  process.env.HOME = tmpDir;
  const dataDir = path.join(tmpDir, 'zylos/components/zalo-personal');
  fs.mkdirSync(dataDir, { recursive: true });
  return dataDir;
}

function teardownTmpHome() {
  process.env.HOME = origHome;
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

describe('config.js', () => {
  let configModule;
  let dataDir;

  beforeEach(async () => {
    dataDir = setupTmpHome();
    const modulePath = `../src/lib/config.js?t=${Date.now()}`;
    configModule = await import(modulePath);
  });

  afterEach(() => {
    teardownTmpHome();
  });

  describe('loadConfig', () => {
    it('returns defaults when no config file exists', () => {
      const config = configModule.loadConfig();
      assert.equal(config.enabled, true);
      assert.equal(config.dmPolicy, 'owner');
      assert.equal(config.groupPolicy, 'allowlist');
      assert.equal(config.internal_port, 3463);
      assert.deepEqual(config.dmAllowFrom, []);
      assert.deepEqual(config.groups, {});
    });

    it('loads config from file', () => {
      const configPath = path.join(dataDir, 'config.json');
      fs.writeFileSync(configPath, JSON.stringify({
        enabled: false,
        dmPolicy: 'open',
        owner: { user_id: '123', name: 'Test', bound_at: '2026-01-01' }
      }));
      const config = configModule.loadConfig();
      assert.equal(config.enabled, false);
      assert.equal(config.dmPolicy, 'open');
      assert.equal(config.owner.user_id, '123');
    });

    it('merges defaults with partial config', () => {
      const configPath = path.join(dataDir, 'config.json');
      fs.writeFileSync(configPath, JSON.stringify({ dmPolicy: 'open' }));
      const config = configModule.loadConfig();
      assert.equal(config.dmPolicy, 'open');
      assert.equal(config.groupPolicy, 'allowlist');
      assert.equal(config.internal_port, 3463);
    });

    it('returns defaults on malformed JSON', () => {
      const configPath = path.join(dataDir, 'config.json');
      fs.writeFileSync(configPath, 'not json!!!');
      const config = configModule.loadConfig();
      assert.equal(config.enabled, true);
      assert.equal(config.dmPolicy, 'owner');
    });
  });

  describe('saveConfig', () => {
    it('writes config to file', () => {
      const config = { enabled: true, dmPolicy: 'open', custom: 'value' };
      configModule.saveConfig(config);
      const configPath = path.join(dataDir, 'config.json');
      const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      assert.equal(saved.dmPolicy, 'open');
      assert.equal(saved.custom, 'value');
    });

    it('overwrites existing config', () => {
      configModule.saveConfig({ version: 1 });
      configModule.saveConfig({ version: 2 });
      const configPath = path.join(dataDir, 'config.json');
      const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      assert.equal(saved.version, 2);
    });
  });
});
