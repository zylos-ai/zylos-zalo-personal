import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';

let tmpDir, origHome;

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zp-pairing-'));
  origHome = process.env.HOME;
  process.env.HOME = tmpDir;
  fs.mkdirSync(path.join(tmpDir, 'zylos/components/zalo-personal'), { recursive: true });
}
function teardown() {
  process.env.HOME = origHome;
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

describe('dm-pairing', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('unknown → pending → approve adds to dmAllowFrom and clears pending; persists 0600', async () => {
    const m = await import(`../src/lib/dm-pairing.js?t=${Date.now()}`);
    assert.equal(m.getPairingStatus('u1'), 'unknown');
    let state = m.markPairingPending({ userId: 'u1', userName: 'S', chatId: 'c1', firstMessage: 'hi' });
    m.savePairingState(state);
    assert.equal(m.getPairingStatus('u1'), 'pending');
    const mode = fs.statSync(path.join(tmpDir, 'zylos/components/zalo-personal/dm-pairing.json')).mode & 0o777;
    assert.equal(mode, 0o600);

    const config = { dmAllowFrom: [] };
    state = m.loadPairingState();
    assert.equal(m.approvePairingUser(config, 'u1', state), true);
    m.savePairingState(state);
    assert.deepEqual(config.dmAllowFrom, ['u1']);
    assert.equal(m.getPairingStatus('u1'), 'unknown');
  });

  it('deny removes from allowlist and blocks re-queue', async () => {
    const m = await import(`../src/lib/dm-pairing.js?t=${Date.now()}`);
    let state = m.markPairingPending({ userId: 'u2', userName: 'A', chatId: 'c' });
    const config = { dmAllowFrom: ['u2'] };
    m.denyPairingUser(config, 'u2', 'spam', state);
    assert.equal(m.getPairingStatus('u2', state), 'denied');
    assert.deepEqual(config.dmAllowFrom, []);
    state = m.markPairingPending({ userId: 'u2', userName: 'A', chatId: 'c' }, state);
    assert.equal(m.getPairingStatus('u2', state), 'denied');
  });
});
