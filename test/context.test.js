import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';

let tmpDir;
let origHome;

function setupTmpHome() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zalo-test-'));
  origHome = process.env.HOME;
  process.env.HOME = tmpDir;
  const dataDir = path.join(tmpDir, 'zylos/components/zalo-personal');
  fs.mkdirSync(path.join(dataDir, 'logs'), { recursive: true });
  return dataDir;
}

function teardownTmpHome() {
  process.env.HOME = origHome;
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

describe('context.js', () => {
  let contextModule;

  beforeEach(async () => {
    setupTmpHome();
    // Fresh import each time to reset module state
    const modulePath = `../src/lib/context.js?t=${Date.now()}`;
    contextModule = await import(modulePath);
  });

  afterEach(() => {
    teardownTmpHome();
  });

  describe('formatMessage', () => {
    it('formats DM message', () => {
      const msg = contextModule.formatMessage({
        chatType: 'dm',
        userName: 'Felix',
        text: 'hello',
        contextMessages: null,
        mediaPath: null,
      });
      assert.ok(msg.includes('[Zalo DM]'));
      assert.ok(msg.includes('Felix said:'));
      assert.ok(msg.includes('hello'));
    });

    it('formats group message', () => {
      const msg = contextModule.formatMessage({
        chatType: 'group',
        groupName: 'Test Group',
        userName: 'Felix',
        text: 'hi everyone',
        contextMessages: null,
        mediaPath: null,
      });
      assert.ok(msg.includes('[Zalo GROUP:Test Group]'));
      assert.ok(msg.includes('Felix said:'));
      assert.ok(msg.includes('hi everyone'));
    });

    it('includes group context messages', () => {
      const msg = contextModule.formatMessage({
        chatType: 'group',
        groupName: 'Test',
        userName: 'Felix',
        text: 'latest msg',
        contextMessages: [
          { user_name: 'Alice', text: 'earlier message' },
          { user_name: 'Bob', text: 'another one' },
        ],
        mediaPath: null,
      });
      assert.ok(msg.includes('<group-context>'));
      assert.ok(msg.includes('[Alice]: earlier message'));
      assert.ok(msg.includes('[Bob]: another one'));
      assert.ok(msg.includes('</group-context>'));
    });

    it('includes media path', () => {
      const msg = contextModule.formatMessage({
        chatType: 'dm',
        userName: 'Felix',
        text: '[sent a file: doc.pdf]',
        contextMessages: null,
        mediaPath: '/tmp/doc.pdf',
      });
      assert.ok(msg.includes('---- file: /tmp/doc.pdf'));
    });

    it('includes smart-mode hint', () => {
      const msg = contextModule.formatMessage({
        chatType: 'group',
        groupName: 'Test',
        userName: 'Felix',
        text: 'random chat',
        contextMessages: null,
        mediaPath: null,
        smartHint: true,
      });
      assert.ok(msg.includes('<smart-mode>'));
      assert.ok(msg.includes('silently observed'));
      assert.ok(msg.includes('</smart-mode>'));
    });

    it('omits smart-mode hint when false', () => {
      const msg = contextModule.formatMessage({
        chatType: 'group',
        groupName: 'Test',
        userName: 'Felix',
        text: 'mentioned msg',
        contextMessages: null,
        mediaPath: null,
        smartHint: false,
      });
      assert.ok(!msg.includes('<smart-mode>'));
    });

    it('escapes XML special characters', () => {
      const msg = contextModule.formatMessage({
        chatType: 'dm',
        userName: 'User<script>',
        text: 'test & "quote"',
        contextMessages: null,
        mediaPath: null,
      });
      assert.ok(msg.includes('User&lt;script&gt;'));
      assert.ok(msg.includes('test &amp; &quot;quote&quot;'));
    });

    it('defaults group name to "group" when null', () => {
      const msg = contextModule.formatMessage({
        chatType: 'group',
        groupName: null,
        userName: 'Felix',
        text: 'test',
        contextMessages: null,
        mediaPath: null,
      });
      assert.ok(msg.includes('[Zalo GROUP:group]'));
    });

    it('wraps current message in tags', () => {
      const msg = contextModule.formatMessage({
        chatType: 'dm',
        userName: 'Felix',
        text: 'hello world',
        contextMessages: null,
        mediaPath: null,
      });
      assert.ok(msg.includes('<current-message>'));
      assert.ok(msg.includes('hello world'));
      assert.ok(msg.includes('</current-message>'));
    });

    it('uses user_id as fallback in context messages', () => {
      const msg = contextModule.formatMessage({
        chatType: 'group',
        groupName: 'Test',
        userName: 'Felix',
        text: 'latest',
        contextMessages: [
          { user_id: '12345', text: 'no name message' },
        ],
        mediaPath: null,
      });
      assert.ok(msg.includes('[12345]: no name message'));
    });
  });
});
