import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

function timingSafeTokenEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

const TEST_TOKEN = crypto.randomBytes(32).toString('hex');
let server;
let port;

function makeRequest(urlPath, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path: urlPath, method, headers },
      (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

before(async () => {
  const tmpDir = fs.mkdtempSync(path.join('/tmp', 'zalo-test-'));

  server = http.createServer((req, res) => {
    if (req.url.startsWith('/internal/')) {
      const token = req.headers['x-internal-token'];
      if (!timingSafeTokenEqual(token, TEST_TOKEN)) {
        res.writeHead(403).end('forbidden');
        return;
      }
    }

    if (req.method === 'GET' && req.url === '/internal/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
        connected: true, wsHealthy: true, uptime: 123
      }));
      return;
    }

    if (req.method === 'GET' && req.url === '/internal/qr') {
      const qrPath = path.join(tmpDir, 'qr.png');
      if (fs.existsSync(qrPath)) {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        fs.createReadStream(qrPath).pipe(res);
      } else {
        res.writeHead(404).end('no qr');
      }
      return;
    }

    if (req.method === 'POST' && req.url === '/internal/record-outgoing') {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        try {
          const { chatId, text } = JSON.parse(Buffer.concat(chunks).toString());
          if (!chatId || !text) { res.writeHead(400).end('missing fields'); return; }
          res.writeHead(200).end('ok');
        } catch { res.writeHead(400).end('bad json'); }
      });
      return;
    }

    res.writeHead(404).end();
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

after(() => { if (server) server.close(); });

describe('timingSafeTokenEqual', () => {
  it('returns true for matching tokens', () => {
    assert.equal(timingSafeTokenEqual('abc123', 'abc123'), true);
  });

  it('returns false for mismatched tokens', () => {
    assert.equal(timingSafeTokenEqual('abc123', 'xyz789'), false);
  });

  it('returns false for different lengths', () => {
    assert.equal(timingSafeTokenEqual('short', 'muchlongertoken'), false);
  });

  it('returns false for non-string input', () => {
    assert.equal(timingSafeTokenEqual(undefined, 'abc'), false);
    assert.equal(timingSafeTokenEqual(null, 'abc'), false);
    assert.equal(timingSafeTokenEqual(123, 'abc'), false);
  });

  it('returns false for array header values', () => {
    assert.equal(timingSafeTokenEqual(['token1', 'token2'], 'token1'), false);
  });
});

describe('GET /internal/status', () => {
  it('rejects missing token with 403', async () => {
    const res = await makeRequest('/internal/status');
    assert.equal(res.status, 403);
    assert.equal(res.body, 'forbidden');
  });

  it('rejects wrong token with 403', async () => {
    const res = await makeRequest('/internal/status', {
      headers: { 'x-internal-token': 'wrong-token' }
    });
    assert.equal(res.status, 403);
  });

  it('accepts correct token', async () => {
    const res = await makeRequest('/internal/status', {
      headers: { 'x-internal-token': TEST_TOKEN }
    });
    assert.equal(res.status, 200);
    const data = JSON.parse(res.body);
    assert.equal(data.connected, true);
  });
});

describe('GET /internal/qr', () => {
  it('rejects missing token with 403', async () => {
    const res = await makeRequest('/internal/qr');
    assert.equal(res.status, 403);
    assert.equal(res.body, 'forbidden');
  });

  it('rejects wrong token with 403', async () => {
    const res = await makeRequest('/internal/qr', {
      headers: { 'x-internal-token': 'bad' }
    });
    assert.equal(res.status, 403);
  });

  it('returns 404 (no qr) only after auth succeeds', async () => {
    const res = await makeRequest('/internal/qr', {
      headers: { 'x-internal-token': TEST_TOKEN }
    });
    assert.equal(res.status, 404);
    assert.equal(res.body, 'no qr');
  });
});

describe('POST /internal/record-outgoing', () => {
  it('rejects missing token with 403', async () => {
    const res = await makeRequest('/internal/record-outgoing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: '123', text: 'hello' })
    });
    assert.equal(res.status, 403);
  });

  it('rejects wrong token with 403', async () => {
    const res = await makeRequest('/internal/record-outgoing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-token': 'nope' },
      body: JSON.stringify({ chatId: '123', text: 'hello' })
    });
    assert.equal(res.status, 403);
  });

  it('accepts correct token and valid body', async () => {
    const res = await makeRequest('/internal/record-outgoing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-token': TEST_TOKEN },
      body: JSON.stringify({ chatId: '123', text: 'hello' })
    });
    assert.equal(res.status, 200);
  });
});
