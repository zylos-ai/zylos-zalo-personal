import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  cleanupMediaTree, sweepTimestampCache, truncateLogFileAtomic, unlinkQuiet
} from '../src/lib/resource-lifecycle.js';

describe('resource lifecycle helpers', () => {
  it('recursively removes stale media, including staging files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zalo-media-cleanup-'));
    try {
      const staging = path.join(dir, 'staging');
      fs.mkdirSync(staging);
      const oldTop = path.join(dir, 'old.jpg');
      const oldStaging = path.join(staging, 'old.pdf');
      const freshStaging = path.join(staging, 'fresh.pdf');
      fs.writeFileSync(oldTop, 'old');
      fs.writeFileSync(oldStaging, 'old');
      fs.writeFileSync(freshStaging, 'fresh');

      const now = Date.now();
      const oldTime = new Date(now - 20_000);
      fs.utimesSync(oldTop, oldTime, oldTime);
      fs.utimesSync(oldStaging, oldTime, oldTime);

      cleanupMediaTree(dir, 10_000, now);

      assert.equal(fs.existsSync(oldTop), false);
      assert.equal(fs.existsSync(oldStaging), false);
      assert.equal(fs.existsSync(freshStaging), true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sweeps timestamp cache entries by age and size', () => {
    const cache = new Map([
      ['old', { name: 'old', cachedAt: 1000 }],
      ['a', { name: 'a', cachedAt: 8000 }],
      ['b', { name: 'b', cachedAt: 9000 }],
      ['c', { name: 'c', cachedAt: 9500 }],
    ]);

    sweepTimestampCache(cache, { ttlMs: 5000, maxSize: 2, now: 10_000 });

    assert.equal(cache.has('old'), false);
    assert.deepEqual([...cache.keys()], ['b', 'c']);
  });

  it('truncates logs with a tmp+rename write', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zalo-log-truncate-'));
    try {
      const logPath = path.join(dir, 'chat.jsonl');
      fs.writeFileSync(logPath, 'line1\nline2\nline3\n', { mode: 0o600 });

      const result = truncateLogFileAtomic(logPath, { maxBytes: 10, keepBytes: 12 });

      assert.equal(result.truncated, true);
      assert.equal(fs.readFileSync(logPath, 'utf8'), 'line3\n');
      assert.deepEqual(fs.readdirSync(dir), ['chat.jsonl']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ignores unlink failures', () => {
    assert.doesNotThrow(() => unlinkQuiet('/path/that/does/not/exist'));
  });
});
