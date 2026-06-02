import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';

let tmpDir, origHome;

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zp-welcome-'));
  origHome = process.env.HOME;
  process.env.HOME = tmpDir;
  fs.mkdirSync(path.join(tmpDir, 'zylos/components/zalo-personal'), { recursive: true });
}
function teardown() {
  process.env.HOME = origHome;
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

describe('dm-welcome', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('welcomes a first-seen user once, then never again', async () => {
    const m = await import(`../src/lib/dm-welcome.js?t=${Date.now()}`);
    const seen = m.loadSeenDmUsers();
    const sent = [];
    const send = async (chatId, msg) => { sent.push({ chatId, msg }); };

    const first = await m.sendDmWelcomeIfFirstSeen({ send, userId: 'u1', chatId: 'c1', message: 'Hello!', seenUsers: seen });
    assert.equal(first, true);
    assert.deepEqual(sent, [{ chatId: 'c1', msg: 'Hello!' }]);

    const second = await m.sendDmWelcomeIfFirstSeen({ send, userId: 'u1', chatId: 'c1', message: 'Hello!', seenUsers: seen });
    assert.equal(second, false);
    assert.equal(sent.length, 1);

    // persisted across reload
    const reloaded = m.loadSeenDmUsers();
    assert.equal(reloaded.has('u1'), true);
  });

  it('is a no-op when no welcome message is configured', async () => {
    const m = await import(`../src/lib/dm-welcome.js?t=${Date.now()}`);
    const seen = m.loadSeenDmUsers();
    let called = false;
    const send = async () => { called = true; };
    const r = await m.sendDmWelcomeIfFirstSeen({ send, userId: 'u2', chatId: 'c2', message: '', seenUsers: seen });
    assert.equal(r, false);
    assert.equal(called, false);
  });
});
