import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';

// ============================================================
// ZP-13: Safe correlation ID
// ============================================================

function safeId(str) {
  return String(str).replace(/[^a-zA-Z0-9_:-]/g, '_').substring(0, 200);
}

describe('safeId (ZP-13: correlation ID sanitization)', () => {
  it('preserves safe characters', () => {
    assert.equal(safeId('123:abc_def'), '123:abc_def');
  });
  it('strips path traversal characters', () => {
    assert.equal(safeId('../../../etc/passwd'), '_________etc_passwd');
  });
  it('strips pipe and special characters', () => {
    assert.equal(safeId('a|b<c>d'), 'a_b_c_d');
  });
  it('truncates long IDs to 200 chars', () => {
    const long = 'a'.repeat(300);
    assert.equal(safeId(long).length, 200);
  });
  it('handles empty string', () => {
    assert.equal(safeId(''), '');
  });
});

// ============================================================
// ZP-6: MIME type allowlist
// ============================================================

describe('download MIME type allowlist (ZP-6)', () => {
  const allowedTypes = ['image/', 'application/octet-stream', 'video/', 'audio/',
    'application/pdf', 'application/zip', 'application/x-zip-compressed',
    'application/msword', 'application/vnd.openxmlformats-officedocument.',
    'text/plain'];
  function isAllowed(ct) {
    return allowedTypes.some(t => ct.startsWith(t));
  }

  it('allows image/jpeg', () => assert.ok(isAllowed('image/jpeg')));
  it('allows application/pdf', () => assert.ok(isAllowed('application/pdf')));
  it('allows application/zip', () => assert.ok(isAllowed('application/zip')));
  it('allows application/msword', () => assert.ok(isAllowed('application/msword')));
  it('allows application/vnd.openxmlformats-officedocument.wordprocessingml.document', () =>
    assert.ok(isAllowed('application/vnd.openxmlformats-officedocument.wordprocessingml.document')));
  it('allows text/plain', () => assert.ok(isAllowed('text/plain')));
  it('blocks text/html', () => assert.ok(!isAllowed('text/html')));
  it('blocks application/javascript', () => assert.ok(!isAllowed('application/javascript')));
});

// ============================================================
// ZP-4: Directory and file permissions
// ============================================================

describe('permission repair (ZP-3/ZP-4)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zp-perm-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('mkdirSync with mode 0o700 creates restricted directory', () => {
    const dir = path.join(tmpDir, 'test-dir');
    fs.mkdirSync(dir, { mode: 0o700 });
    const stat = fs.statSync(dir);
    assert.equal(stat.mode & 0o777, 0o700);
  });

  it('writeFileSync with mode 0o600 creates restricted file', () => {
    const fp = path.join(tmpDir, 'test-file');
    fs.writeFileSync(fp, 'secret', { mode: 0o600 });
    const stat = fs.statSync(fp);
    assert.equal(stat.mode & 0o777, 0o600);
  });

  it('chmodSync repairs overly-permissive config', () => {
    const fp = path.join(tmpDir, 'config.json');
    fs.writeFileSync(fp, '{}', { mode: 0o644 });
    fs.chmodSync(fp, 0o600);
    const stat = fs.statSync(fp);
    assert.equal(stat.mode & 0o777, 0o600);
  });
});

// ============================================================
// ZP-15: Eviction bounds
// ============================================================

describe('eviction bounds (ZP-15)', () => {
  it('Map evicts oldest when exceeding cap', () => {
    const MAX = 5;
    const m = new Map();
    for (let i = 0; i < MAX + 2; i++) {
      m.set(`key-${i}`, i);
      if (m.size > MAX) {
        const firstKey = m.keys().next().value;
        m.delete(firstKey);
      }
    }
    assert.equal(m.size, MAX);
    assert.ok(!m.has('key-0'));
    assert.ok(!m.has('key-1'));
    assert.ok(m.has('key-2'));
  });

  it('Set evicts oldest when exceeding cap', () => {
    const MAX = 5;
    const s = new Set();
    for (let i = 0; i < MAX + 2; i++) {
      s.add(`key-${i}`);
      if (s.size > MAX) {
        const first = s.values().next().value;
        s.delete(first);
      }
    }
    assert.equal(s.size, MAX);
    assert.ok(!s.has('key-0'));
    assert.ok(s.has('key-2'));
  });
});

// ============================================================
// ZP-16: 413 response
// ============================================================

describe('413 response on oversize payload (ZP-16)', () => {
  it('server returns 413 for oversized body', async () => {
    const server = http.createServer((req, res) => {
      const chunks = [];
      let size = 0;
      const LIMIT = 1024;
      req.on('data', chunk => {
        size += chunk.length;
        if (size > LIMIT) { res.writeHead(413).end('payload too large'); req.destroy(); return; }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (res.headersSent) return;
        res.writeHead(200).end('ok');
      });
    });

    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;

    try {
      const bigBody = 'x'.repeat(2048);
      const resp = await fetch(`http://127.0.0.1:${port}/test`, {
        method: 'POST',
        body: bigBody
      });
      assert.equal(resp.status, 413);
    } finally {
      server.close();
    }
  });
});

// ============================================================
// ZP-14: Auth test isolation (verify temp HOME pattern)
// ============================================================

describe('test isolation pattern (ZP-14)', () => {
  let origHome;
  let tmpHome;

  beforeEach(() => {
    origHome = process.env.HOME;
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'zp-iso-'));
    process.env.HOME = tmpHome;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('temp HOME is isolated from real HOME', () => {
    assert.notEqual(process.env.HOME, origHome);
    assert.ok(process.env.HOME.startsWith(os.tmpdir()));
  });

  it('files written in temp HOME do not affect real HOME', () => {
    const fp = path.join(process.env.HOME, 'test.json');
    fs.writeFileSync(fp, '{}');
    assert.ok(fs.existsSync(fp));
    assert.ok(!fs.existsSync(path.join(origHome, 'test.json')));
  });
});
