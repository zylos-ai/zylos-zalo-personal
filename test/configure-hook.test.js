import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const scriptPath = path.resolve('hooks/configure.js');

describe('configure hook', () => {
  let tmpHome;
  let dataDir;
  let origHome;

  beforeEach(() => {
    origHome = process.env.HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'zp-configure-'));
    dataDir = path.join(tmpHome, 'zylos/components/zalo-personal');
    fs.mkdirSync(dataDir, { recursive: true });
    process.env.HOME = tmpHome;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  function runConfigure(payload) {
    execFileSync(process.execPath, [scriptPath], {
      input: JSON.stringify(payload),
      encoding: 'utf8',
      env: { ...process.env, HOME: tmpHome }
    });
    return JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8'));
  }

  it('maps allowed collected keys to runtime config casing', () => {
    const config = runConfigure({
      ZALO_PERSONAL_DM_POLICY: 'pairing',
      ZALO_PERSONAL_GROUP_POLICY: 'open',
      ZALO_PERSONAL_INTERNAL_PORT: '4567',
      ZALO_PERSONAL_VOICETRANSCRIPTION: 'api',
      ZALO_PERSONAL_WHISPER_MODEL: '/models/ggml.bin',
      ZALO_PERSONAL_DOWNLOAD_MEDIA: 'false',
      ZALO_PERSONAL_INBOUND_RATE_LIMIT_MAX: '12',
      ZALO_PERSONAL_TEXT_MODE: 'plain'
    });

    assert.equal(config.dmPolicy, 'pairing');
    assert.equal(config.groupPolicy, 'open');
    assert.equal(config.internal_port, 4567);
    assert.equal(config.voiceTranscription, 'api');
    assert.equal(config.whisperModel, '/models/ggml.bin');
    assert.equal(config.features.download_media, false);
    assert.equal(config.features.inbound_rate_limit.max, 12);
    assert.equal(config.message.textMode, 'plain');
  });

  it('ignores unsupported keys that would inject protected config', () => {
    const config = runConfigure({
      ZALO_PERSONAL_OWNER: '{"user_id":"attacker"}',
      ZALO_PERSONAL_GROUPS: '{"g":{"allowFrom":["*"]}}',
      ZALO_PERSONAL_ENABLED: 'false',
      ZALO_PERSONAL_INTERNAL_PORT: '4567'
    });

    assert.deepEqual(config.owner, undefined);
    assert.deepEqual(config.groups, {});
    assert.equal(config.enabled, true);
    assert.equal(config.internal_port, 4567);
  });
});
